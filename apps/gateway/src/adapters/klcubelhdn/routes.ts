/**
 * KLCubeLHDN API Routes
 * Implements the 4 submission endpoints per PRD-HASH-001
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  SubmitConsolidateSchema,
  SubmitJustSaveSchema,
  SubmitBuyerSchema,
  SubmitPersonalSchema,
  OriginalSubmitSchema,
  type SubmitConsolidateRequest,
  type SubmitJustSaveRequest,
  type SubmitBuyerRequest,
  type SubmitPersonalRequest,
  type SubmissionResponse,
  type ErrorResponse,
  type OriginalSubmitRequest,
} from "./schemas.js";
import { transformToUBL, type CompanyInfo, type TransformOptions } from "./transformer.js";
import { normalizeRequest, validateNormalizedRequest, type OriginalRequest } from "./normalizer.js";
import {
  findCompanyById,
  createInvoice,
  updateInvoiceStatus,
  updateAllInvoicesByMyinvoisUuid,
  updateDraftInvoice,
  findInvoiceByNumber,
  findInvoiceByTrackingId,
  findInvoiceByMyinvoisUuid,
  findInvoiceById,
  findInvoiceByPosInvoiceId,
  listInvoices,
  deleteInvoice,
  findUserByIdWithCompanies,
  getPrismaClient,
  type InvoiceStatus,
  type InvoiceType,
  type UpdateInvoiceStatusInput,
  type UpdateDraftInvoiceInput,
} from "@myinvois/storage";
import {
  authenticate,
  requirePermission,
  AuthorizationError,
  AuthenticationError,
  isSuperadmin,
} from "../../auth/middleware.js";
import {
  submitDocuments,
  createTokenManager,
  changeDocumentState,
  getDocument,
} from "@myinvois/myinvois-client";
import { enqueueInvoicePoll } from "../../polling/pollInvoice.queue.js";
import { triggerPoll } from "../../polling/autoPoller.js";
import { triggerConsolidation, getConsolidatorStatus } from "../../polling/monthlyConsolidator.js";
import type { Environment, Mode } from "@myinvois/core";
import { submissionLogger } from "../../lib/appLogger.js";
import { AppError } from "../../lib/AppError.js";
import type { DocumentVersion } from "@myinvois/signing";
import crypto from "crypto";
import {
  signDocument,
  getSigningStatus,
  type SignableDocument,
  type SigningOptions,
} from "../../middleware/signing.js";
import QRCode from "qrcode";

/**
 * MyInvois document link formats
 */
const MYINVOIS_BASE_URL = "https://myinvois.hasil.gov.my";

/**
 * Generate document links for valid documents
 */
function generateDocumentLinks(
  uuid: string,
  longId: string
): {
  shareLink: string;
  verifyLink: string;
  qrCodeUrl: string;
  viewLink: string;
} {
  return {
    shareLink: `${MYINVOIS_BASE_URL}/${uuid}/share/${longId}`,
    verifyLink: `${MYINVOIS_BASE_URL}/verify/${longId}`,
    qrCodeUrl: `/api/v1/documents/${uuid}/qr`,
    viewLink: `${MYINVOIS_BASE_URL}/${uuid}/share/${longId}`,
  };
}

/**
 * Generate a tracking ID for submissions
 */
function generateTrackingId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `HASH-${timestamp}-${random}`.toUpperCase();
}

/**
 * Generate a session ID
 */
function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate a POS invoice ID for public registration URL
 * Format: {2-char prefix from company name}-{8-char random}
 * Example: "BP-12ys8Uy4" for "Example Corp"
 */
function generatePosInvoiceId(companyName: string): string {
  // Derive prefix from company name (first 2 uppercase letters)
  const prefix =
    companyName
      .replace(/[^a-zA-Z]/g, "")
      .substring(0, 2)
      .toUpperCase() || "XX";

  // Generate 8-char random (case-sensitive alphanumeric)
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 8; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `${prefix}-${random}`;
}

/**
 * Generate a unique POS invoice ID with retry logic
 * Ensures no collision with existing IDs in database
 */
async function generateUniquePosInvoiceId(companyName: string): Promise<string> {
  let posInvoiceId = generatePosInvoiceId(companyName);
  let attempts = 0;

  while (attempts < 5) {
    const existing = await findInvoiceByPosInvoiceId(posInvoiceId);
    if (!existing) break;
    posInvoiceId = generatePosInvoiceId(companyName);
    attempts++;
  }

  if (attempts >= 5) {
    throw new Error("Failed to generate unique POS invoice ID after 5 attempts");
  }

  return posInvoiceId;
}

/**
 * ERP On-Behalf Mode Configuration
 * When enabled, uses a single set of ERP credentials for all suppliers
 * instead of per-company credentials.
 */
interface ErpConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  env: string;
  erpTin?: string; // TIN of the ERP entity itself (to skip onBehalfOf for own companies)
}

/**
 * Check if ERP on-behalf mode is enabled and get ERP credentials
 */
function getErpConfig(): ErpConfig {
  const enabled = process.env.ERP_MODE === "true";

  if (!enabled) {
    return { enabled: false, clientId: "", clientSecret: "", env: "SANDBOX" };
  }

  const clientId = process.env.ERP_MYINVOIS_CLIENT_ID;
  const clientSecret = process.env.ERP_MYINVOIS_CLIENT_SECRET;
  const env = process.env.ERP_MYINVOIS_ENV || "SANDBOX";
  const erpTin = process.env.ERP_TIN; // Optional: TIN of the ERP entity itself

  if (!clientId || !clientSecret) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(
      500,
      "ERP mode is enabled but ERP_MYINVOIS_CLIENT_ID or ERP_MYINVOIS_CLIENT_SECRET is not configured",
      "ERP_CONFIG_ERROR"
    );
  }

  return { enabled: true, clientId, clientSecret, env, erpTin };
}

/**
 * Get session credentials for MyInvois API calls
 * In ERP mode:
 *   - If company TIN matches ERP_TIN: use TAXPAYER mode (ERP's own company)
 *   - Otherwise: use INTERMEDIARY mode with onBehalfOf header
 * In standard mode: uses company credentials with TAXPAYER mode
 */
function getSessionCredentials(company: {
  tin: string;
  myinvoisClientId?: string | null;
  myinvoisClientSecret?: string | null;
  myinvoisEnv: string;
}): {
  clientId: string;
  clientSecret: string;
  env: Environment;
  mode: Mode;
  onBehalfOf?: string;
} {
  const erpConfig = getErpConfig();

  if (erpConfig.enabled) {
    const erpEnv = (
      erpConfig.env === "PROD" || erpConfig.env === "prod" ? "PROD" : "SANDBOX"
    ) as Environment;

    // Always use INTERMEDIARY mode with onBehalfOf for ALL companies in ERP mode
    // This includes the ERP's own company - MyInvois requires consistent mode for document operations
    // Documents submitted via ERP with onBehalfOf must be cancelled/managed with the same onBehalfOf header
    return {
      clientId: erpConfig.clientId,
      clientSecret: erpConfig.clientSecret,
      env: erpEnv,
      mode: "INTERMEDIARY" as Mode,
      onBehalfOf: company.tin,
    };
  }

  // Standard mode: use company's own credentials
  if (!company.myinvoisClientId || !company.myinvoisClientSecret) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(400, "Company MyInvois credentials not configured", "MISSING_CREDENTIALS");
  }

  return {
    clientId: company.myinvoisClientId,
    clientSecret: company.myinvoisClientSecret,
    env: (company.myinvoisEnv === "PROD" ? "PROD" : "SANDBOX") as Environment,
    mode: "TAXPAYER" as Mode,
  };
}

/**
 * Get company with credentials check
 * In ERP mode, uses ERP credentials instead of per-company credentials
 */
async function getCompanyWithCredentials(companyId: string): Promise<
  CompanyInfo & {
    myinvoisClientId: string;
    myinvoisClientSecret: string;
    myinvoisEnv: string;
  }
> {
  const company = await findCompanyById(companyId);

  if (!company) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(404, "Company not found", "COMPANY_NOT_FOUND");
  }

  if (!company.isActive) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(403, "Company is not active", "COMPANY_INACTIVE");
  }

  // Check if ERP mode is enabled
  const erpConfig = getErpConfig();

  if (erpConfig.enabled) {
    // In ERP mode, use ERP credentials - no per-company credentials needed
    // Include ALL company fields for UBL transformation
    return {
      tin: company.tin,
      idValue: company.idValue,
      idType: company.idType,
      name: company.name,
      address: company.address ?? undefined,
      city: company.city ?? undefined,
      state: company.state ?? undefined,
      postalCode: company.postalCode ?? undefined,
      country: company.country ?? undefined,
      phone: company.phone ?? undefined,
      email: company.email ?? undefined,
      sstRegistration: company.sstRegistration ?? undefined,
      ttxRegistration: company.ttxRegistration ?? undefined,
      industryCode: company.industryCode ?? undefined,
      industryName: company.industryName ?? undefined,
      myinvoisClientId: erpConfig.clientId,
      myinvoisClientSecret: erpConfig.clientSecret,
      myinvoisEnv: erpConfig.env,
    };
  }

  // Standard mode: require per-company credentials
  if (!company.myinvoisClientId || !company.myinvoisClientSecret) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(400, "Company MyInvois credentials not configured", "MISSING_CREDENTIALS");
  }

  // Include ALL company fields for UBL transformation
  return {
    tin: company.tin,
    idValue: company.idValue,
    idType: company.idType,
    name: company.name,
    address: company.address ?? undefined,
    city: company.city ?? undefined,
    state: company.state ?? undefined,
    postalCode: company.postalCode ?? undefined,
    country: company.country ?? undefined,
    phone: company.phone ?? undefined,
    email: company.email ?? undefined,
    sstRegistration: company.sstRegistration ?? undefined,
    ttxRegistration: company.ttxRegistration ?? undefined,
    industryCode: company.industryCode ?? undefined,
    industryName: company.industryName ?? undefined,
    myinvoisClientId: company.myinvoisClientId,
    myinvoisClientSecret: company.myinvoisClientSecret,
    myinvoisEnv: company.myinvoisEnv,
  };
}

/**
 * Submit document to MyInvois
 * Supports both TAXPAYER mode (per-company credentials) and
 * INTERMEDIARY mode (ERP on-behalf-of with single credentials)
 */
async function submitToMyInvois(
  ublDocument: unknown,
  company: {
    myinvoisClientId: string;
    myinvoisClientSecret: string;
    myinvoisEnv: string;
    tin: string;
  },
  invoiceNumber: string
): Promise<{
  ok: boolean;
  trackingId?: string;
  submissionUid?: string;
  uuid?: string;
  error?: { code: string; message: string; details?: unknown[] };
}> {
  try {
    const env: Environment = company.myinvoisEnv === "PROD" ? "PROD" : "SANDBOX";

    // Check if ERP on-behalf mode is enabled
    const erpConfig = getErpConfig();

    // Create token manager
    const tokenManager = createTokenManager();

    // Encode document to base64
    const documentJson = JSON.stringify(ublDocument);
    const documentBase64 = Buffer.from(documentJson).toString("base64");

    // Create document hash (SHA256 of raw JSON in HEX format - MyInvois requirement)
    const documentHash = crypto.createHash("sha256").update(documentJson).digest("hex");

    // P2-01: Structured logging for UBL submission
    const ublInvoice = (ublDocument as { Invoice?: Array<Record<string, unknown>> })?.Invoice?.[0];
    submissionLogger.info(
      JSON.stringify({
        event: "submitting",
        invoiceNumber,
        hasInvoice: !!ublInvoice,
        invoiceId: ublInvoice?.ID,
        hasSupplier: !!ublInvoice?.AccountingSupplierParty,
        hasCustomer: !!ublInvoice?.AccountingCustomerParty,
        hasInvoicePeriod: !!ublInvoice?.InvoicePeriod,
        hasTaxTotal: !!ublInvoice?.TaxTotal,
        hasLegalMonetaryTotal: !!ublInvoice?.LegalMonetaryTotal,
        lineCount: (ublInvoice?.InvoiceLine as unknown[])?.length,
        erpMode: erpConfig.enabled,
        onBehalfOf: erpConfig.enabled ? company.tin : undefined,
      })
    );

    // Submit to MyInvois
    // In ERP mode: use INTERMEDIARY mode with onBehalfOf = supplier's TIN
    // In standard mode: use TAXPAYER mode with company's own credentials
    const result = await submitDocuments(
      {
        sessionId: generateSessionId(),
        env: erpConfig.enabled
          ? ((erpConfig.env === "PROD" || erpConfig.env === "prod"
              ? "PROD"
              : "SANDBOX") as Environment)
          : env,
        mode: erpConfig.enabled ? ("INTERMEDIARY" as Mode) : ("TAXPAYER" as Mode),
        clientId: erpConfig.enabled ? erpConfig.clientId : company.myinvoisClientId,
        clientSecret: erpConfig.enabled ? erpConfig.clientSecret : company.myinvoisClientSecret,
        scope: "InvoicingAPI",
        // In ERP mode, submit on behalf of the supplier using their TIN
        ...(erpConfig.enabled && { onBehalfOf: company.tin }),
      },
      {
        documents: [
          {
            format: "JSON",
            document: documentBase64,
            documentHash,
            codeNumber: invoiceNumber,
          },
        ],
      },
      { tokenManager }
    );

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: result.error.code || "SUBMISSION_FAILED",
          message: result.error.message,
        },
      };
    }

    // Check for accepted documents
    const accepted = result.result.acceptedDocuments[0];
    if (accepted) {
      return {
        ok: true,
        trackingId: generateTrackingId(),
        submissionUid: result.result.submissionUid,
        uuid: accepted.uuid,
      };
    }

    // Check for rejected documents
    const rejected = result.result.rejectedDocuments[0];
    if (rejected) {
      // Build detailed error message including all validation details
      let detailedMessage = rejected.errorMessage || "Document rejected";

      if (rejected.errorDetails && rejected.errorDetails.length > 0) {
        const detailStrings = rejected.errorDetails
          .map(
            (detail: {
              code?: string;
              message?: string;
              target?: string;
              propertyName?: string;
              propertyPath?: string;
            }) => {
              const parts: string[] = [];
              if (detail.propertyName) parts.push(`Field: ${detail.propertyName}`);
              if (detail.propertyPath) parts.push(`Path: ${detail.propertyPath}`);
              if (detail.message) parts.push(`Error: ${detail.message}`);
              if (detail.code) parts.push(`Code: ${detail.code}`);
              if (detail.target) parts.push(`Target: ${detail.target}`);
              return parts.join(", ");
            }
          )
          .filter(Boolean);

        if (detailStrings.length > 0) {
          detailedMessage = `${detailedMessage}. Details: [${detailStrings.join("; ")}]`;
        }
      }

      return {
        ok: false,
        error: {
          code: rejected.errorCode || "DOCUMENT_REJECTED",
          message: detailedMessage,
          details: rejected.errorDetails,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "No accepted or rejected documents in response",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Submission failed";
    return {
      ok: false,
      error: {
        code: "SUBMISSION_ERROR",
        message,
      },
    };
  }
}

/**
 * P0-02: Retryable error codes for transient failures
 * These errors warrant retry with exponential backoff
 */
const RETRYABLE_ERROR_CODES = new Set([
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_ERROR",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "SUBMISSION_ERROR", // Generic submission error may be transient
]);

/**
 * P0-02: Check if error is retryable (transient failure)
 */
function isRetryableSubmissionError(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  return RETRYABLE_ERROR_CODES.has(errorCode);
}

/**
 * P0-02: Sleep helper for exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit document to MyInvois in background (async pattern)
 * This function runs the submission without blocking the HTTP response
 * P0-02: Now includes retry logic with exponential backoff for transient errors
 */
function submitToMyInvoisAsync(
  invoiceId: string,
  trackingId: string,
  ublDocument: unknown,
  company: {
    myinvoisClientId: string;
    myinvoisClientSecret: string;
    myinvoisEnv: string;
    tin: string;
  },
  companyId: string,
  invoiceNumber: string,
  logger?: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }
): void {
  // P0-02: Retry configuration
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000; // 1 second

  // Use setImmediate to defer execution to next event loop tick
  setImmediate(async () => {
    // P2-01: Use structured logger as fallback instead of console
    const log = logger || submissionLogger;
    log.info(`[AsyncSubmit] Starting background submission for ${invoiceNumber} (${trackingId})`);

    let lastError: { code?: string; message?: string; details?: unknown[] } | undefined;

    // P0-02: Retry loop with exponential backoff
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 1s, 4s, 16s
          const delayMs = BASE_DELAY_MS * Math.pow(4, attempt - 1);
          log.info(
            `[AsyncSubmit] Retry ${attempt}/${MAX_RETRIES} for ${invoiceNumber} after ${delayMs}ms delay`
          );
          await sleep(delayMs);
        }

        const result = await submitToMyInvois(ublDocument, company, invoiceNumber);

        if (!result.ok) {
          lastError = result.error;

          // P0-02: Check if error is retryable and we have retries left
          if (isRetryableSubmissionError(result.error?.code) && attempt < MAX_RETRIES) {
            log.info(
              `[AsyncSubmit] ${invoiceNumber} got retryable error (${result.error?.code}), will retry`
            );
            continue; // Try again
          }

          // Non-retryable error or max retries exhausted
          log.error(
            {
              invoiceNumber,
              trackingId,
              errorCode: result.error?.code,
              errorMessage: result.error?.message,
              errorDetails: result.error?.details,
              attempts: attempt + 1,
            },
            `[AsyncSubmit] ${invoiceNumber} REJECTED by MyInvois after ${attempt + 1} attempt(s)`
          );

          // Update status to INVALID with detailed error message
          const updateInput: UpdateInvoiceStatusInput = {
            status: "INVALID" as InvoiceStatus,
            trackingId,
            errorCode: result.error?.code,
            errorMessage: result.error?.message,
          };
          await updateInvoiceStatus(invoiceId, updateInput);
          return;
        }

        // Success! Update status to SUBMITTED with MyInvois UUID
        const updateInput: UpdateInvoiceStatusInput = {
          status: "SUBMITTED" as InvoiceStatus,
          trackingId,
          myinvoisUuid: result.uuid,
        };
        await updateInvoiceStatus(invoiceId, updateInput);
        log.info(`[AsyncSubmit] ${invoiceNumber} submitted successfully, UUID: ${result.uuid}`);

        // Enqueue polling job to check validation status
        if (result.uuid) {
          await enqueueInvoicePoll({
            invoiceId,
            myinvoisUuid: result.uuid,
            companyId,
            attempt: 0,
          });
          log.info(`[AsyncSubmit] Polling job enqueued for ${result.uuid}`);
        }
        return; // Success, exit the retry loop
      } catch (error) {
        // Handle unexpected errors (network errors, etc.)
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        lastError = { code: "ASYNC_SUBMISSION_ERROR", message: errorMessage };

        // P0-02: Network errors are retryable
        if (attempt < MAX_RETRIES) {
          log.info(
            `[AsyncSubmit] ${invoiceNumber} got unexpected error, will retry: ${errorMessage}`
          );
          continue; // Try again
        }

        // Max retries exhausted
        log.error(
          { error, invoiceNumber, trackingId, attempts: attempt + 1 },
          `[AsyncSubmit] Unexpected error after ${attempt + 1} attempt(s): ${errorMessage}`
        );

        const updateInput: UpdateInvoiceStatusInput = {
          status: "INVALID" as InvoiceStatus,
          trackingId,
          errorCode: "ASYNC_SUBMISSION_ERROR",
          errorMessage: `${errorMessage} (after ${attempt + 1} attempts)`,
        };
        await updateInvoiceStatus(invoiceId, updateInput);
        return;
      }
    }

    // Fallback: if somehow we exit the loop without returning, mark as INVALID
    log.error(
      { invoiceNumber, trackingId, lastError },
      `[AsyncSubmit] ${invoiceNumber} failed after all retries`
    );
    const updateInput: UpdateInvoiceStatusInput = {
      status: "INVALID" as InvoiceStatus,
      trackingId,
      errorCode: lastError?.code || "RETRY_EXHAUSTED",
      errorMessage: lastError?.message || "Max retries exhausted",
    };
    await updateInvoiceStatus(invoiceId, updateInput);
  });
}

/**
 * Helper to check if user has access to a specific company
 * Superadmin users (*) bypass company access checks
 */
async function checkCompanyAccess(
  request: FastifyRequest,
  _reply: FastifyReply,
  companyId: string
): Promise<void> {
  if (!request.user) {
    throw new AuthenticationError("Not authenticated");
  }

  // Superadmin bypasses all company access checks
  if (isSuperadmin(request.user)) {
    return;
  }

  // Get user with their company assignments
  const userWithCompanies = await findUserByIdWithCompanies(request.user.userId);

  if (!userWithCompanies) {
    throw new AuthenticationError("User not found");
  }

  // Check if user has access to the requested company
  const hasAccess = userWithCompanies.companies.some((uc) => uc.company.id === companyId);

  if (!hasAccess) {
    throw new AuthorizationError("Access denied to this company", "COMPANY_ACCESS_DENIED", 403);
  }
}

/**
 * Validate signing capability for document version
 * Throws error if v1.1 is requested but signing is not available
 */
function validateSigningCapability(documentVersion: DocumentVersion): void {
  const signingStatus = getSigningStatus(documentVersion);

  if (!signingStatus.canProceed) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(
      503,
      signingStatus.reason || "Signing is required for v1.1 but not configured",
      "SIGNING_UNAVAILABLE"
    );
  }
}

/**
 * Process document for submission - applies signing if v1.1
 *
 * @param ublDocument - The UBL document to process
 * @param documentVersion - Document version (1.0 or 1.1)
 * @param invoiceNumber - Invoice number for tracking
 * @param correlationId - Request correlation ID for logging
 * @returns Processed document (signed if v1.1)
 */
function processDocumentForSubmission(
  ublDocument: Record<string, unknown>,
  documentVersion: DocumentVersion,
  invoiceNumber: string,
  correlationId?: string
): Record<string, unknown> {
  // v1.0 documents don't need signing
  if (documentVersion === "1.0") {
    return ublDocument;
  }

  // v1.1 documents need signing
  const signableDoc: SignableDocument = {
    content: ublDocument,
    codeNumber: invoiceNumber,
    format: "JSON",
  };

  const signingOptions: SigningOptions = {
    documentVersion,
    correlationId,
  };

  const signedResult = signDocument(signableDoc, signingOptions);

  return signedResult.content;
}

/**
 * Register KLCubeLHDN routes
 */
export async function klcubelhdnRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply authentication to all routes
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", requirePermission("submit:invoice"));

  /**
   * POST /api/v1/klcubelhdn/submit-consolidate
   * Submit consolidated e-invoice (multiple invoices combined)
   */
  fastify.post<{ Body: SubmitConsolidateRequest }>(
    "/submit-consolidate",
    {
      schema: {
        body: {
          type: "object",
          required: ["companyId", "invoices"],
          properties: {
            companyId: { type: "string" },
            invoices: { type: "array", minItems: 1 },
            documentVersion: { type: "string", enum: ["1.0", "1.1"] },
          },
        },
      },
    },
    async (request, reply) => {
      // Validate request body
      const parseResult = SubmitConsolidateSchema.safeParse(request.body);
      if (!parseResult.success) {
        const error: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message || "Invalid request",
            details: parseResult.error.errors,
          },
        };
        return reply.status(400).send(error);
      }

      const { companyId, invoices, documentVersion = "1.1", buyerEmail } = parseResult.data;

      // Verify company access
      await checkCompanyAccess(request, reply, companyId);

      // Delegate to async handler (returns 202 immediately)
      return await handleConsolidate(request, reply, {
        companyId,
        documentVersion,
        invoices,
        buyerEmail,
      });
    }
  );

  /**
   * POST /api/v1/klcubelhdn/submit-justsave
   * Save invoice locally without submitting to LHDN
   */
  fastify.post<{ Body: SubmitJustSaveRequest }>(
    "/submit-justsave",
    {
      schema: {
        body: {
          type: "object",
          required: ["companyId", "invoice"],
          properties: {
            companyId: { type: "string" },
            invoice: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      // Validate request body
      const parseResult = SubmitJustSaveSchema.safeParse(request.body);
      if (!parseResult.success) {
        const error: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message || "Invalid request",
            details: parseResult.error.errors,
          },
        };
        return reply.status(400).send(error);
      }

      const { companyId, invoice } = parseResult.data;

      // Verify company access
      await checkCompanyAccess(request, reply, companyId);

      try {
        // Get company (no credentials needed for just-save)
        const company = await findCompanyById(companyId);
        if (!company) {
          const error: ErrorResponse = {
            error: {
              code: "COMPANY_NOT_FOUND",
              message: "Company not found",
            },
          };
          return reply.status(404).send(error);
        }

        // Generate tracking ID and POS invoice ID
        const trackingId = generateTrackingId();
        const posInvoiceId = await generateUniquePosInvoiceId(company.name);

        // Store invoice locally (no UBL transformation or MyInvois submission)
        await createInvoice({
          companyId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: new Date(invoice.invoiceDate),
          invoiceType: "JUSTSAVE" as InvoiceType,
          trackingId, // Save tracking ID for later retrieval
          posInvoiceId,
          rawPayload: JSON.stringify(request.body),
          amount: String(invoice.amount),
          discount: String(invoice.discount),
          rounding: String(invoice.rounding),
          taxAmount: String(invoice.taxAmount),
          total: String(invoice.total),
          buyerInfo: invoice.buyer ? JSON.stringify(invoice.buyer) : undefined,
          createdBy: request.user?.userId,
        });

        const response: SubmissionResponse = {
          trackingId,
          invoiceId: trackingId, // Use tracking ID as invoice ID for drafts
          invoiceNumber: invoice.invoiceNumber,
          posInvoiceId,
          status: "DRAFT",
          message: "Invoice saved locally (not submitted to LHDN)",
        };

        return reply.status(201).send(response);
      } catch (err) {
        if (typeof err === "object" && err !== null && "status" in err) {
          const typedErr = err as { status: number; code: string; message: string };
          const error: ErrorResponse = {
            error: {
              code: typedErr.code,
              message: typedErr.message,
            },
          };
          return reply.status(typedErr.status).send(error);
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/v1/klcubelhdn/submit-buyer
   * Submit B2B invoice with buyer TIN + BRN
   */
  fastify.post<{ Body: SubmitBuyerRequest }>(
    "/submit-buyer",
    {
      schema: {
        body: {
          type: "object",
          required: ["companyId", "invoice"],
          properties: {
            companyId: { type: "string" },
            invoice: { type: "object" },
            documentVersion: { type: "string", enum: ["1.0", "1.1"] },
          },
        },
      },
    },
    async (request, reply) => {
      // Validate request body
      const parseResult = SubmitBuyerSchema.safeParse(request.body);
      if (!parseResult.success) {
        const error: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message || "Invalid request",
            details: parseResult.error.errors,
          },
        };
        return reply.status(400).send(error);
      }

      const { companyId, invoice, documentVersion = "1.1" } = parseResult.data;

      // Verify company access
      await checkCompanyAccess(request, reply, companyId);

      // Delegate to async handler (returns 202 immediately)
      return await handleBuyer(request, reply, {
        companyId,
        documentVersion,
        invoice,
      });
    }
  );

  /**
   * POST /api/v1/klcubelhdn/submit-personal
   * Submit B2C invoice with buyer NRIC
   */
  fastify.post<{ Body: SubmitPersonalRequest }>(
    "/submit-personal",
    {
      schema: {
        body: {
          type: "object",
          required: ["companyId", "invoice"],
          properties: {
            companyId: { type: "string" },
            invoice: { type: "object" },
            documentVersion: { type: "string", enum: ["1.0", "1.1"] },
          },
        },
      },
    },
    async (request, reply) => {
      // Validate request body
      const parseResult = SubmitPersonalSchema.safeParse(request.body);
      if (!parseResult.success) {
        const error: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message || "Invalid request",
            details: parseResult.error.errors,
          },
        };
        return reply.status(400).send(error);
      }

      const { companyId, invoice, documentVersion = "1.1" } = parseResult.data;

      // Verify company access
      await checkCompanyAccess(request, reply, companyId);

      // Delegate to async handler (returns 202 immediately)
      return await handlePersonal(request, reply, {
        companyId,
        documentVersion,
        invoice,
      });
    }
  );

  /**
   * GET /api/v1/klcubelhdn/invoices/:trackingId
   * Get invoice by tracking ID
   */
  fastify.get<{ Params: { trackingId: string } }>(
    "/invoices/:trackingId",
    {
      schema: {
        params: {
          type: "object",
          required: ["trackingId"],
          properties: {
            trackingId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { trackingId } = request.params;

      const invoice = await findInvoiceByTrackingId(trackingId);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "INVOICE_NOT_FOUND",
            message: "Invoice not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Parse rawPayload to extract items
      let items: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxCode: string;
        taxRate: number;
        taxAmount: number;
        total: number;
      }> = [];

      if (invoice.rawPayload) {
        try {
          const payload = JSON.parse(invoice.rawPayload);
          // Handle all formats:
          // 1. { invoices: [...] } - from /documents/submit endpoint
          // 2. { invoice: {...} } - from /submit-justsave endpoint (singular)
          // 3. Direct format without wrapper
          const invoiceData = payload.invoices?.[0] || payload.invoice || payload;
          if (invoiceData.items && Array.isArray(invoiceData.items)) {
            items = invoiceData.items;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Parse buyerInfo
      let buyer: Record<string, unknown> | null = null;
      if (invoice.buyerInfo) {
        try {
          buyer = JSON.parse(invoice.buyerInfo);
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Build response with links for valid documents
      const response: Record<string, unknown> = {
        trackingId: invoice.trackingId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate.toISOString(),
        invoiceType: invoice.invoiceType,
        status: invoice.status,
        myinvoisUuid: invoice.myinvoisUuid,
        myinvoisLongId: invoice.myinvoisLongId,
        posInvoiceId: invoice.posInvoiceId, // POS short ID for QR code
        amount: invoice.amount,
        discount: invoice.discount,
        rounding: invoice.rounding,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        errorCode: invoice.errorCode,
        errorMessage: invoice.errorMessage,
        items,
        buyer,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };

      // Add links for valid documents with longId
      if (invoice.status === "VALID" && invoice.myinvoisUuid && invoice.myinvoisLongId) {
        const links = generateDocumentLinks(invoice.myinvoisUuid, invoice.myinvoisLongId);
        response.links = {
          share: links.shareLink,
          verify: links.verifyLink,
          qr: links.qrCodeUrl,
          view: links.viewLink,
        };
      }

      return reply.send(response);
    }
  );

  /**
   * GET /api/v1/klcubelhdn/invoices/share-link
   * Get share link for an invoice by any ID (flexible lookup)
   * Accepts: posInvoiceId, trackingId, or invoiceId (internal ID)
   * Returns: MyInvois share link for VALID/SUBMITTED documents with longId
   */
  fastify.get<{
    Querystring: { id?: string; posInvoiceId?: string; trackingId?: string; invoiceId?: string };
  }>(
    "/invoices/share-link",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Generic ID - auto-detects type (posInvoiceId, trackingId, or invoiceId)",
            },
            posInvoiceId: { type: "string", description: "POS unique invoice ID (short ID)" },
            trackingId: { type: "string", description: "Internal tracking ID (HASH-xxx)" },
            invoiceId: { type: "string", description: "Internal invoice ID (cuid)" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, posInvoiceId, trackingId, invoiceId } = request.query;

      // At least one ID must be provided
      if (!id && !posInvoiceId && !trackingId && !invoiceId) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_PARAMETER",
            message: "Parameter 'id' is required (accepts posInvoiceId, trackingId, or invoiceId)",
          },
        };
        return reply.status(400).send(error);
      }

      // Find invoice by the provided ID
      // If generic 'id' is provided, try all lookup methods
      let invoice = null;

      if (posInvoiceId) {
        invoice = await findInvoiceByPosInvoiceId(posInvoiceId);
      } else if (trackingId) {
        invoice = await findInvoiceByTrackingId(trackingId);
      } else if (invoiceId) {
        invoice = await findInvoiceById(invoiceId);
      } else if (id) {
        // Generic id - try all lookup methods
        invoice = await findInvoiceByPosInvoiceId(id);
        if (!invoice) {
          invoice = await findInvoiceByTrackingId(id);
        }
        if (!invoice) {
          invoice = await findInvoiceById(id);
        }
      }

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "INVOICE_NOT_FOUND",
            message: "Invoice not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Check if document has MyInvois UUID and longId
      if (!invoice.myinvoisUuid || !invoice.myinvoisLongId) {
        const error: ErrorResponse = {
          error: {
            code: "SHARE_LINK_NOT_AVAILABLE",
            message: `Share link not available. Invoice status: ${invoice.status}. Share links are only available for submitted documents that have been validated by MyInvois.`,
          },
        };
        return reply.status(400).send(error);
      }

      // Generate share link
      const shareLink = `${MYINVOIS_BASE_URL}/${invoice.myinvoisUuid}/share/${invoice.myinvoisLongId}`;

      return reply.send({
        success: true,
        invoiceNumber: invoice.invoiceNumber,
        posInvoiceId: invoice.posInvoiceId,
        trackingId: invoice.trackingId,
        status: invoice.status,
        myinvoisUuid: invoice.myinvoisUuid,
        shareLink,
      });
    }
  );

  /**
   * DELETE /api/v1/klcubelhdn/invoices/:trackingId
   * Delete invoice (only DRAFT invoices can be deleted)
   */
  fastify.delete<{ Params: { trackingId: string } }>(
    "/invoices/:trackingId",
    {
      preHandler: [authenticate, requirePermission("submit:invoice")],
      schema: {
        params: {
          type: "object",
          required: ["trackingId"],
          properties: {
            trackingId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { trackingId } = request.params;

      // Find invoice by tracking ID
      const invoice = await findInvoiceByTrackingId(trackingId);
      if (!invoice) {
        return reply.status(404).send({
          success: false,
          error: "Invoice not found",
          code: "INVOICE_NOT_FOUND",
        });
      }

      // Only DRAFT invoices can be deleted
      if (invoice.status !== "DRAFT") {
        return reply.status(400).send({
          success: false,
          error: `Cannot delete invoice with status ${invoice.status}. Only DRAFT invoices can be deleted.`,
          code: "INVOICE_NOT_DRAFT",
        });
      }

      // Delete the invoice
      await deleteInvoice(invoice.id);

      fastify.log.info({
        msg: "Invoice deleted",
        trackingId,
        invoiceNumber: invoice.invoiceNumber,
        userId: request.user?.userId,
      });

      return reply.send({
        success: true,
        message: `Invoice ${invoice.invoiceNumber} deleted successfully`,
      });
    }
  );

  /**
   * PUT /api/v1/klcubelhdn/invoices/:trackingId/purge
   * Permanently delete invoice (any status) - Admin cleanup only
   * Requires superadmin role
   */
  fastify.put<{ Params: { trackingId: string } }>(
    "/invoices/:trackingId/purge",
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: "object",
          required: ["trackingId"],
          properties: {
            trackingId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // Check superadmin permission
      if (!isSuperadmin(request.user)) {
        return reply.status(403).send({
          success: false,
          error: "Superadmin permission required for purge operation",
          code: "FORBIDDEN",
        });
      }

      const { trackingId } = request.params;

      // Find invoice by tracking ID
      const invoice = await findInvoiceByTrackingId(trackingId);
      if (!invoice) {
        return reply.status(404).send({
          success: false,
          error: "Invoice not found",
          code: "INVOICE_NOT_FOUND",
        });
      }

      // Delete the invoice permanently (any status)
      await deleteInvoice(invoice.id);

      fastify.log.warn({
        msg: "Invoice permanently purged",
        trackingId,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        userId: request.user?.userId,
      });

      return reply.send({
        success: true,
        message: `Invoice ${invoice.invoiceNumber} permanently deleted`,
      });
    }
  );

  /**
   * PUT /api/v1/klcubelhdn/invoices/purge-by-id/:id
   * Permanently delete invoice by database ID - for invoices without trackingId
   * Requires superadmin role
   */
  fastify.put<{ Params: { id: string } }>(
    "/invoices/purge-by-id/:id",
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // Check superadmin permission
      if (!isSuperadmin(request.user)) {
        return reply.status(403).send({
          success: false,
          error: "Superadmin permission required for purge operation",
          code: "FORBIDDEN",
        });
      }

      const { id } = request.params;

      // Find invoice by database ID
      const invoice = await findInvoiceById(id);
      if (!invoice) {
        return reply.status(404).send({
          success: false,
          error: "Invoice not found",
          code: "INVOICE_NOT_FOUND",
        });
      }

      // Delete the invoice permanently (any status)
      await deleteInvoice(invoice.id);

      fastify.log.warn({
        msg: "Invoice permanently purged by ID",
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        trackingId: invoice.trackingId || "N/A",
        status: invoice.status,
        userId: request.user?.userId,
      });

      return reply.send({
        success: true,
        message: `Invoice ${invoice.invoiceNumber} permanently deleted`,
      });
    }
  );
}

/**
 * Legacy Submit Routes - Accepts client's original Postman format
 * Single endpoint with flags for routing: ConsolidatedInvoice, SaveInvoice
 */
export async function legacySubmitRoutes(fastify: FastifyInstance): Promise<void> {
  // Note: Authentication and permissions are set per-route
  // - /submit and /cancel: submit:invoice permission
  // - /fetch and /list: read:documents permission

  /**
   * POST /api/v1/documents/submit
   * Unified submit endpoint - accepts client's original format with flags
   *
   * Request body format:
   * {
   *   "CompanyId": "...",           // PascalCase accepted
   *   "ConsolidatedInvoice": true,  // Flag for consolidation
   *   "SaveInvoice": true,          // Flag for just-save
   *   "documentVersion": "1.1",
   *   "invoices": [{                // Always array
   *     "invoiceNumber": "...",
   *     "customer": {               // "customer" accepted (not just "buyer")
   *       "Tin": "...",             // PascalCase accepted
   *       "Name": "...",
   *       ...
   *     },
   *     "items": [...]
   *   }]
   * }
   */
  fastify.post<{ Body: OriginalSubmitRequest }>(
    "/submit",
    {
      preHandler: [authenticate, requirePermission("submit:invoice")],
      schema: {
        body: {
          type: "object",
          required: ["invoices"],
          properties: {
            CompanyId: { type: "string" },
            companyId: { type: "string" },
            ConsolidatedInvoice: { type: "boolean" },
            consolidatedInvoice: { type: "boolean" },
            SaveInvoice: { type: "boolean" },
            saveInvoice: { type: "boolean" },
            documentVersion: { type: "string", enum: ["1.0", "1.1"] },
            invoices: { type: "array", minItems: 1 },
            buyerEmail: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // 1. Validate with flexible schema
      const parseResult = OriginalSubmitSchema.safeParse(request.body);
      if (!parseResult.success) {
        const error: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message || "Invalid request",
            details: parseResult.error.errors,
          },
        };
        return reply.status(400).send(error);
      }

      // 2. Normalize request from client's format to internal format
      const normalized = normalizeRequest(parseResult.data as OriginalRequest);

      // 3. Validate normalized request
      const validation = validateNormalizedRequest(normalized);
      if (!validation.valid) {
        const error: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: validation.errors[0] || "Invalid request after normalization",
            details: validation.errors,
          },
        };
        return reply.status(400).send(error);
      }

      const { type, companyId, documentVersion, invoices, buyerEmail } = normalized;

      // 4. Verify company access
      await checkCompanyAccess(request, reply, companyId);

      // 5. Route to appropriate handler based on detected type
      try {
        switch (type) {
          case "consolidate":
            return await handleConsolidate(request, reply, {
              companyId,
              documentVersion,
              invoices,
              buyerEmail,
            });

          case "justsave":
            return await handleJustSave(request, reply, {
              companyId,
              invoice: invoices[0],
            });

          case "buyer":
            return await handleBuyer(request, reply, {
              companyId,
              documentVersion,
              invoice: invoices[0],
            });

          case "personal":
            return await handlePersonal(request, reply, {
              companyId,
              documentVersion,
              invoice: invoices[0],
            });

          default: {
            // Should never happen
            const unknownError: ErrorResponse = {
              error: {
                code: "UNKNOWN_INVOICE_TYPE",
                message: `Unknown invoice type: ${type}`,
              },
            };
            return reply.status(400).send(unknownError);
          }
        }
      } catch (err) {
        if (typeof err === "object" && err !== null && "status" in err) {
          const typedErr = err as { status: number; code: string; message: string };
          const error: ErrorResponse = {
            error: {
              code: typedErr.code,
              message: typedErr.message,
            },
          };
          return reply.status(typedErr.status).send(error);
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/v1/documents/cancel
   * Legacy cancel endpoint - accepts client's original format with Uuid in body
   * Supports both InvoiceId (database ID) and Uuid (MyInvois UUID)
   * Uuid takes priority if both are provided
   */
  fastify.post<{
    Body: {
      CompanyId?: string;
      companyId?: string;
      InvoiceId?: string;
      invoiceId?: string;
      Uuid?: string;
      uuid?: string;
      Reason?: string;
      reason?: string;
    };
  }>(
    "/cancel",
    {
      preHandler: [authenticate, requirePermission("cancel:documents")],
      schema: {
        body: {
          type: "object",
          properties: {
            CompanyId: { type: "string" },
            companyId: { type: "string" },
            InvoiceId: { type: "string", minLength: 1 },
            invoiceId: { type: "string", minLength: 1 },
            Uuid: { type: "string", minLength: 1 },
            uuid: { type: "string", minLength: 1 },
            Reason: { type: "string", minLength: 1, maxLength: 300 },
            reason: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (request, reply) => {
      // Normalize field names - support both PascalCase and camelCase
      const invoiceId = request.body.InvoiceId || request.body.invoiceId;
      const uuid = request.body.Uuid || request.body.uuid;
      const reason = request.body.Reason || request.body.reason;

      // Validate at least one identifier and reason
      if (!uuid && !invoiceId) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_IDENTIFIER",
            message: "Either Uuid or InvoiceId must be provided",
          },
        };
        return reply.status(400).send(error);
      }

      if (!reason) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_REASON",
            message: "Reason is required",
          },
        };
        return reply.status(400).send(error);
      }

      // Find invoice - Uuid (MyInvois UUID) takes priority, fallback to InvoiceId (database ID)
      let invoice = null;
      let myinvoisUuid = uuid;

      if (uuid) {
        invoice = await findInvoiceByMyinvoisUuid(uuid);
      }

      if (!invoice && invoiceId) {
        invoice = await findInvoiceById(invoiceId);
        // Get the MyInvois UUID from the found invoice for cancellation
        if (invoice) {
          myinvoisUuid = invoice.myinvoisUuid || undefined;
        }
      }

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Ensure we have a MyInvois UUID for cancellation
      if (!myinvoisUuid) {
        const error: ErrorResponse = {
          error: {
            code: "NO_MYINVOIS_UUID",
            message:
              "Document does not have a MyInvois UUID. It may not have been submitted to LHDN yet.",
          },
        };
        return reply.status(400).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // For consolidated invoices, check if ALL invoices with this UUID are already cancelled
      // Don't block if only some are cancelled - we need to update the rest
      const prismaLegacy = getPrismaClient();
      const nonCancelledCountLegacy = await prismaLegacy.invoice.count({
        where: {
          myinvoisUuid: myinvoisUuid,
          status: { not: "CANCELLED" },
        },
      });

      if (nonCancelledCountLegacy === 0) {
        // ALL invoices with this UUID are already cancelled
        const error: ErrorResponse = {
          error: {
            code: "ALREADY_CANCELLED",
            message: "Document is already cancelled",
          },
        };
        return reply.status(400).send(error);
      }

      // Get company and session credentials (supports ERP on-behalf mode)
      const company = await findCompanyById(invoice.companyId);
      if (!company) {
        const error: ErrorResponse = {
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        };
        return reply.status(404).send(error);
      }

      try {
        // Get session credentials (ERP mode or standard mode)
        const sessionCreds = getSessionCredentials(company);
        const tokenManager = createTokenManager();

        const result = await changeDocumentState(
          {
            sessionId: generateSessionId(),
            env: sessionCreds.env,
            mode: sessionCreds.mode,
            clientId: sessionCreds.clientId,
            clientSecret: sessionCreds.clientSecret,
            scope: "InvoicingAPI",
            ...(sessionCreds.onBehalfOf && { onBehalfOf: sessionCreds.onBehalfOf }),
          },
          { uuid: myinvoisUuid, status: "cancelled", reason },
          { tokenManager }
        );

        // Check if LHDN says document is already cancelled - still update local DB
        // LHDN may return different error messages:
        // - Explicit: "Document is already cancelled" or "DocumentAlreadyCancelled"
        // - Implicit: "Invalid request" (400) when document was already cancelled
        // If we get a 400/VALIDATION_ERROR and we have local invoices that ARE already
        // cancelled with this UUID, treat it as "already cancelled at LHDN"
        const hasLocalCancelledInvoice = invoice.status === "CANCELLED";

        const isExplicitAlreadyCancelled =
          !result.ok &&
          (result.error?.code === "ALREADY_CANCELLED" ||
            result.error?.code === "DocumentAlreadyCancelled" ||
            result.error?.message?.toLowerCase().includes("already cancelled") ||
            result.error?.message?.toLowerCase().includes("already been cancelled"));

        // If LHDN returns 400/VALIDATION_ERROR and we have at least one locally
        // cancelled invoice, assume the document IS cancelled at LHDN
        const isImplicitAlreadyCancelled =
          !result.ok && result.error?.code === "VALIDATION_ERROR" && hasLocalCancelledInvoice;

        const isAlreadyCancelledAtLhdnLegacy =
          isExplicitAlreadyCancelled || isImplicitAlreadyCancelled;

        if (!result.ok && !isAlreadyCancelledAtLhdnLegacy) {
          // Real error - not just "already cancelled"
          fastify.log.warn({
            msg: "Cancel failed - not an 'already cancelled' case",
            code: result.error?.code,
            message: result.error?.message,
            hasLocalCancelledInvoice,
          });
          const error: ErrorResponse = {
            error: {
              code: result.error.code || "CANCEL_FAILED",
              message: result.error.message,
            },
          };
          return reply.status(400).send(error);
        }

        if (isAlreadyCancelledAtLhdnLegacy) {
          fastify.log.info({
            msg: "Document already cancelled at LHDN, updating all local invoices",
            myinvoisUuid,
            detection: isExplicitAlreadyCancelled
              ? "explicit"
              : "implicit (VALIDATION_ERROR + local cancelled invoice)",
          });
        }

        // Update ALL local invoices with this UUID (important for consolidated invoices)
        const updateInput: UpdateInvoiceStatusInput = {
          status: "CANCELLED" as InvoiceStatus,
        };
        const updatedCount = await updateAllInvoicesByMyinvoisUuid(myinvoisUuid, updateInput);

        fastify.log.info({
          msg: "Cancelled invoices updated (legacy endpoint)",
          myinvoisUuid,
          updatedCount,
        });

        return reply.send({
          myinvoisUuid: myinvoisUuid,
          invoiceId: invoice.id,
          status: "CANCELLED",
          message: isAlreadyCancelledAtLhdnLegacy
            ? "Document was already cancelled at LHDN, local records updated"
            : "Document cancelled successfully",
          invoicesUpdated: updatedCount,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Cancel failed";
        const errorResponse: ErrorResponse = {
          error: {
            code: "CANCEL_ERROR",
            message,
          },
        };
        return reply.status(500).send(errorResponse);
      }
    }
  );

  /**
   * POST /api/v1/documents/fetch
   * Legacy fetch endpoint - accepts client's original format
   * Accepts InvoiceId (flexible: invoiceNumber, database ID, trackingId, or UUID) and Uuid
   * When CompanyId is provided, also supports lookup by invoiceNumber
   * InvoiceId takes priority if both are provided
   * Note: Uses read:documents permission (overrides default submit:invoice)
   */
  fastify.post<{
    Body: {
      CompanyId?: string;
      companyId?: string;
      InvoiceId?: string;
      invoiceId?: string;
      Uuid?: string;
      uuid?: string;
    };
  }>(
    "/fetch",
    {
      preHandler: [authenticate, requirePermission("read:documents")],
      schema: {
        body: {
          type: "object",
          properties: {
            CompanyId: {
              type: "string",
              description: "Company ID (required for invoiceNumber lookup)",
            },
            companyId: {
              type: "string",
              description: "Company ID (required for invoiceNumber lookup)",
            },
            InvoiceId: {
              type: "string",
              minLength: 1,
              description: "Flexible: invoiceNumber, database ID, trackingId, or UUID",
            },
            invoiceId: {
              type: "string",
              minLength: 1,
              description: "Flexible: invoiceNumber, database ID, trackingId, or UUID",
            },
            Uuid: { type: "string", minLength: 1 },
            uuid: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      // Normalize field names - support both PascalCase and camelCase
      const companyId = request.body.CompanyId || request.body.companyId;
      const InvoiceId = request.body.InvoiceId || request.body.invoiceId;
      const Uuid = request.body.Uuid || request.body.uuid;

      // Validate at least one identifier is provided
      if (!InvoiceId && !Uuid) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_IDENTIFIER",
            message: "Either InvoiceId or Uuid must be provided",
          },
        };
        return reply.status(400).send(error);
      }

      // Find invoice - InvoiceId takes priority, try multiple lookup methods
      let invoice = null;
      if (InvoiceId) {
        // Try database ID first
        invoice = await findInvoiceById(InvoiceId);

        // Try tracking ID (format: HASH-XXXXX-XXXXX)
        if (!invoice) {
          invoice = await findInvoiceByTrackingId(InvoiceId);
        }

        // Try MyInvois UUID (InvoiceId might be the UUID)
        if (!invoice) {
          invoice = await findInvoiceByMyinvoisUuid(InvoiceId);
        }

        // Try POS invoice ID
        if (!invoice) {
          invoice = await findInvoiceByPosInvoiceId(InvoiceId);
        }

        // Try invoice number (requires companyId)
        if (!invoice && companyId) {
          invoice = await findInvoiceByNumber(companyId, InvoiceId);
        }
      } else if (Uuid) {
        invoice = await findInvoiceByMyinvoisUuid(Uuid);
      }

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Parse rawPayload to extract items
      let items: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxCode: string;
        taxRate: number;
        taxAmount: number;
        total: number;
      }> = [];

      if (invoice.rawPayload) {
        try {
          const payload = JSON.parse(invoice.rawPayload);
          // Handle all formats:
          // 1. { invoices: [...] } - from /documents/submit endpoint
          // 2. { invoice: {...} } - from /submit-justsave endpoint (singular)
          // 3. Direct format without wrapper
          const invoiceData = payload.invoices?.[0] || payload.invoice || payload;
          if (invoiceData.items && Array.isArray(invoiceData.items)) {
            items = invoiceData.items;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Parse buyerInfo
      let buyer: Record<string, unknown> | null = null;
      if (invoice.buyerInfo) {
        try {
          buyer = JSON.parse(invoice.buyerInfo);
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Build response with full invoice details
      const response: Record<string, unknown> = {
        id: invoice.id,
        trackingId: invoice.trackingId,
        posInvoiceId: invoice.posInvoiceId,
        myinvoisUuid: invoice.myinvoisUuid,
        myinvoisLongId: invoice.myinvoisLongId,
        status: invoice.status,
        invoiceNumber: invoice.invoiceNumber,
        invoiceType: invoice.invoiceType,
        invoiceDate: invoice.invoiceDate.toISOString(),
        amount: invoice.amount,
        discount: invoice.discount,
        rounding: invoice.rounding,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        items,
        buyer,
        errorCode: invoice.errorCode,
        errorMessage: invoice.errorMessage,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };

      // Add links for valid documents with longId
      if (invoice.status === "VALID" && invoice.myinvoisUuid && invoice.myinvoisLongId) {
        const links = generateDocumentLinks(invoice.myinvoisUuid, invoice.myinvoisLongId);
        response.links = {
          share: links.shareLink,
          verify: links.verifyLink,
          qr: links.qrCodeUrl,
          view: links.viewLink,
        };
      }

      return reply.send(response);
    }
  );

  /**
   * POST /api/v1/documents/list
   * Legacy list endpoint - accepts client's original format with body params
   * Note: Uses read:documents permission (overrides default submit:invoice)
   */
  fastify.post<{
    Body: {
      CompanyId?: string;
      companyId?: string;
      StartDate?: string;
      EndDate?: string;
      StartPage?: number;
      NumberOfRecords?: number;
      Submitted?: boolean;
    };
  }>(
    "/list",
    {
      preHandler: [authenticate, requirePermission("read:documents")],
      schema: {
        body: {
          type: "object",
          properties: {
            CompanyId: { type: "string" },
            companyId: { type: "string" },
            StartDate: { type: "string" },
            EndDate: { type: "string" },
            StartPage: { type: "number", minimum: 0 },
            NumberOfRecords: { type: "number", minimum: 1, maximum: 100 },
            Submitted: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const {
        CompanyId,
        companyId: companyIdLower,
        StartDate,
        EndDate,
        StartPage,
        NumberOfRecords,
        Submitted,
      } = request.body;

      // Normalize params - support both cases
      const companyId = companyIdLower || CompanyId;
      const fromDate = StartDate;
      const toDate = EndDate;
      const page = StartPage !== undefined ? StartPage + 1 : 1; // Convert 0-indexed to 1-indexed
      const limit = NumberOfRecords || 20;

      // Handle Submitted filter (false = DRAFT, true = non-DRAFT)
      let status: InvoiceStatus | undefined;
      if (Submitted === false) {
        status = "DRAFT";
      }

      // Get user info for company access check
      const userId = request.user?.userId;
      if (!userId) {
        const error: ErrorResponse = {
          error: {
            code: "UNAUTHORIZED",
            message: "User not authenticated",
          },
        };
        return reply.status(401).send(error);
      }

      // If companyId provided, verify access
      if (companyId) {
        await checkCompanyAccess(request, reply, companyId);
      }

      // Build filter options
      const options: Parameters<typeof listInvoices>[0] = {
        page,
        limit,
      };

      if (companyId) {
        options.companyId = companyId;
      }

      if (status) {
        options.status = status;
      }

      if (fromDate) {
        options.dateFrom = new Date(fromDate);
      }

      if (toDate) {
        options.dateTo = new Date(toDate);
      }

      // Get invoices
      const result = await listInvoices(options);

      return reply.send({
        data: result.data.map((invoice) => {
          // Build base response
          const response: Record<string, unknown> = {
            id: invoice.id,
            trackingId: invoice.trackingId,
            myinvoisUuid: invoice.myinvoisUuid,
            myinvoisLongId: invoice.myinvoisLongId,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate.toISOString(),
            invoiceType: invoice.invoiceType,
            status: invoice.status,
            amount: invoice.amount,
            discount: invoice.discount,
            rounding: invoice.rounding,
            taxAmount: invoice.taxAmount,
            total: invoice.total,
            errorCode: invoice.errorCode,
            errorMessage: invoice.errorMessage,
            createdAt: invoice.createdAt.toISOString(),
            updatedAt: invoice.updatedAt.toISOString(),
          };

          // Add links for valid documents with longId
          if (invoice.status === "VALID" && invoice.myinvoisUuid && invoice.myinvoisLongId) {
            const links = generateDocumentLinks(invoice.myinvoisUuid, invoice.myinvoisLongId);
            response.links = {
              share: links.shareLink,
              verify: links.verifyLink,
              qr: links.qrCodeUrl,
              view: links.viewLink,
            };
          }

          return response;
        }),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      });
    }
  );
}

/**
 * Handler for consolidated invoices (extracted for reuse)
 * Uses ASYNC pattern - returns immediately, submits in background
 */
async function handleConsolidate(
  request: FastifyRequest,
  reply: FastifyReply,
  data: {
    companyId: string;
    documentVersion: "1.0" | "1.1";
    invoices: import("./schemas.js").Invoice[];
    buyerEmail?: string;
  }
): Promise<void> {
  const { companyId, documentVersion, invoices, buyerEmail } = data;

  // Validate signing capability
  validateSigningCapability(documentVersion as DocumentVersion);

  // Get company with credentials
  const company = await getCompanyWithCredentials(companyId);

  // Build transform options
  const transformOptions: TransformOptions = {};
  if (buyerEmail) {
    transformOptions.buyerEmail = buyerEmail;
  }

  // Transform to UBL
  const ublDocument = transformToUBL(invoices, company, true, documentVersion);

  // Generate tracking ID, invoice number, and POS invoice ID
  const trackingId = generateTrackingId();
  const firstInvoice = invoices[0];
  const invoiceNumber = `CONS-${firstInvoice.invoiceNumber}`;
  const posInvoiceId = await generateUniquePosInvoiceId(company.name);

  // Process document for submission (applies signing for v1.1)
  const correlationId = (request as unknown as { correlationId?: string }).correlationId;
  const processedDocument = processDocumentForSubmission(
    ublDocument as unknown as Record<string, unknown>,
    documentVersion as DocumentVersion,
    invoiceNumber,
    correlationId
  );

  // Store invoice locally with SUBMITTING status (P0-01: single INSERT, no race condition)
  const createdInvoice = await createInvoice({
    companyId,
    invoiceNumber,
    trackingId,
    posInvoiceId,
    invoiceDate: new Date(firstInvoice.invoiceDate),
    invoiceType: "CONSOLIDATE" as InvoiceType,
    status: "SUBMITTING" as InvoiceStatus,
    rawPayload: JSON.stringify(request.body),
    ublPayload: JSON.stringify(processedDocument),
    amount: String(invoices.reduce((sum, inv) => sum + inv.amount, 0)),
    discount: String(invoices.reduce((sum, inv) => sum + inv.discount, 0)),
    rounding: String(invoices.reduce((sum, inv) => sum + inv.rounding, 0)),
    taxAmount: String(invoices.reduce((sum, inv) => sum + inv.taxAmount, 0)),
    total: String(invoices.reduce((sum, inv) => sum + inv.total, 0)),
    createdBy: request.user?.userId,
  });

  // Submit to MyInvois in background (non-blocking)
  submitToMyInvoisAsync(
    createdInvoice.id,
    trackingId,
    processedDocument,
    company,
    companyId,
    invoiceNumber,
    request.log
  );

  // Return immediately with SUBMITTING status
  const response: SubmissionResponse = {
    trackingId,
    invoiceId: trackingId, // Use trackingId until we get MyInvois UUID
    invoiceNumber,
    posInvoiceId,
    status: "SUBMITTING",
    message: "Consolidated invoice queued for submission. Poll status using trackingId.",
    submittedAt: new Date().toISOString(),
  };

  reply.status(202).send(response); // 202 Accepted for async processing
}

/**
 * Handler for just-save invoices (extracted for reuse)
 */
async function handleJustSave(
  request: FastifyRequest,
  reply: FastifyReply,
  data: {
    companyId: string;
    invoice: import("./schemas.js").Invoice;
  }
): Promise<void> {
  const { companyId, invoice } = data;

  // Get company (no credentials needed)
  const company = await findCompanyById(companyId);
  if (!company) {
    const error: ErrorResponse = {
      error: {
        code: "COMPANY_NOT_FOUND",
        message: "Company not found",
      },
    };
    reply.status(404).send(error);
    return;
  }

  // Generate tracking ID and POS invoice ID
  const trackingId = generateTrackingId();
  const posInvoiceId = await generateUniquePosInvoiceId(company.name);

  // Store invoice locally with trackingId for later submission
  await createInvoice({
    companyId,
    trackingId,
    posInvoiceId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: new Date(invoice.invoiceDate),
    invoiceType: "JUSTSAVE" as InvoiceType,
    rawPayload: JSON.stringify(request.body),
    amount: String(invoice.amount),
    discount: String(invoice.discount),
    rounding: String(invoice.rounding),
    taxAmount: String(invoice.taxAmount),
    total: String(invoice.total),
    buyerInfo: invoice.buyer ? JSON.stringify(invoice.buyer) : undefined,
    createdBy: request.user?.userId,
  });

  const response: SubmissionResponse = {
    trackingId,
    invoiceId: trackingId,
    invoiceNumber: invoice.invoiceNumber,
    posInvoiceId,
    status: "DRAFT",
    message: "Invoice saved locally (not submitted to LHDN)",
  };

  reply.status(201).send(response);
}

/**
 * Handler for buyer (B2B) invoices (extracted for reuse)
 * Uses ASYNC pattern - returns immediately, submits in background
 */
async function handleBuyer(
  request: FastifyRequest,
  reply: FastifyReply,
  data: {
    companyId: string;
    documentVersion: "1.0" | "1.1";
    invoice: import("./schemas.js").Invoice;
  }
): Promise<void> {
  const { companyId, documentVersion, invoice } = data;

  // Validate signing capability
  validateSigningCapability(documentVersion as DocumentVersion);

  // Get company with credentials
  const company = await getCompanyWithCredentials(companyId);

  // Transform to UBL
  const ublDocument = transformToUBL([invoice], company, false, documentVersion);

  // Generate tracking ID and POS invoice ID
  const trackingId = generateTrackingId();
  const posInvoiceId = await generateUniquePosInvoiceId(company.name);

  // Process document for submission
  const correlationId = (request as unknown as { correlationId?: string }).correlationId;
  const processedDocument = processDocumentForSubmission(
    ublDocument as unknown as Record<string, unknown>,
    documentVersion as DocumentVersion,
    invoice.invoiceNumber,
    correlationId
  );

  // Store invoice locally with SUBMITTING status (P0-01: single INSERT, no race condition)
  const createdInvoice = await createInvoice({
    companyId,
    invoiceNumber: invoice.invoiceNumber,
    trackingId,
    posInvoiceId,
    invoiceDate: new Date(invoice.invoiceDate),
    invoiceType: "BUYER" as InvoiceType,
    status: "SUBMITTING" as InvoiceStatus,
    rawPayload: JSON.stringify(request.body),
    ublPayload: JSON.stringify(processedDocument),
    amount: String(invoice.amount),
    discount: String(invoice.discount),
    rounding: String(invoice.rounding),
    taxAmount: String(invoice.taxAmount),
    total: String(invoice.total),
    buyerInfo: JSON.stringify(invoice.buyer),
    createdBy: request.user?.userId,
  });

  // Submit to MyInvois in background (non-blocking)
  submitToMyInvoisAsync(
    createdInvoice.id,
    trackingId,
    processedDocument,
    company,
    companyId,
    invoice.invoiceNumber,
    request.log
  );

  // Return immediately with SUBMITTING status
  const response: SubmissionResponse = {
    trackingId,
    invoiceId: trackingId,
    invoiceNumber: invoice.invoiceNumber,
    posInvoiceId,
    status: "SUBMITTING",
    message: "B2B invoice queued for submission. Poll status using trackingId.",
    submittedAt: new Date().toISOString(),
  };

  reply.status(202).send(response);
}

/**
 * Handler for personal (B2C) invoices (extracted for reuse)
 * Uses ASYNC pattern - returns immediately, submits in background
 */
async function handlePersonal(
  request: FastifyRequest,
  reply: FastifyReply,
  data: {
    companyId: string;
    documentVersion: "1.0" | "1.1";
    invoice: import("./schemas.js").Invoice;
  }
): Promise<void> {
  const { companyId, documentVersion, invoice } = data;

  // Validate signing capability
  validateSigningCapability(documentVersion as DocumentVersion);

  // Get company with credentials
  const company = await getCompanyWithCredentials(companyId);

  // Transform to UBL
  const ublDocument = transformToUBL([invoice], company, false, documentVersion);

  // Generate tracking ID and POS invoice ID
  const trackingId = generateTrackingId();
  const posInvoiceId = await generateUniquePosInvoiceId(company.name);

  // Process document for submission
  const correlationId = (request as unknown as { correlationId?: string }).correlationId;
  const processedDocument = processDocumentForSubmission(
    ublDocument as unknown as Record<string, unknown>,
    documentVersion as DocumentVersion,
    invoice.invoiceNumber,
    correlationId
  );

  // Store invoice locally with SUBMITTING status (P0-01: single INSERT, no race condition)
  const createdInvoice = await createInvoice({
    companyId,
    invoiceNumber: invoice.invoiceNumber,
    trackingId,
    posInvoiceId,
    invoiceDate: new Date(invoice.invoiceDate),
    invoiceType: "PERSONAL" as InvoiceType,
    status: "SUBMITTING" as InvoiceStatus,
    rawPayload: JSON.stringify(request.body),
    ublPayload: JSON.stringify(processedDocument),
    amount: String(invoice.amount),
    discount: String(invoice.discount),
    rounding: String(invoice.rounding),
    taxAmount: String(invoice.taxAmount),
    total: String(invoice.total),
    buyerInfo: JSON.stringify(invoice.buyer),
    createdBy: request.user?.userId,
  });

  // Submit to MyInvois in background (non-blocking)
  submitToMyInvoisAsync(
    createdInvoice.id,
    trackingId,
    processedDocument,
    company,
    companyId,
    invoice.invoiceNumber,
    request.log
  );

  // Return immediately with SUBMITTING status
  const response: SubmissionResponse = {
    trackingId,
    invoiceId: trackingId,
    invoiceNumber: invoice.invoiceNumber,
    posInvoiceId,
    status: "SUBMITTING",
    message: "Personal invoice queued for submission. Poll status using trackingId.",
    submittedAt: new Date().toISOString(),
  };

  reply.status(202).send(response);
}

/**
 * Document Operations Routes (per PRD section 4.6)
 */
export async function documentRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply authentication to all routes
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", requirePermission("read:documents"));

  /**
   * GET /api/v1/documents
   * List documents with filters
   * Supports both our params and client's original param names (aliases)
   */
  fastify.get<{
    Querystring: {
      // Our params
      companyId?: string;
      status?: string;
      statusNot?: string;
      invoiceType?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
      // Client's original params (aliases)
      CompanyId?: string;
      StartDate?: string;
      EndDate?: string;
      StartPage?: number;
      NumberOfRecords?: number;
      Submitted?: string;
    };
  }>(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            // Our params
            companyId: { type: "string" },
            status: { type: "string" },
            statusNot: { type: "string" },
            invoiceType: { type: "string" },
            fromDate: { type: "string" },
            toDate: { type: "string" },
            page: { type: "number", minimum: 1 },
            limit: { type: "number", minimum: 1, maximum: 100 },
            // Client's original params (aliases)
            CompanyId: { type: "string" },
            StartDate: { type: "string" },
            EndDate: { type: "string" },
            StartPage: { type: "number", minimum: 0 },
            NumberOfRecords: { type: "number", minimum: 1, maximum: 100 },
            Submitted: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // Normalize params - support both our format and client's format
      const companyId = request.query.companyId || request.query.CompanyId;
      const fromDate = request.query.fromDate || request.query.StartDate;
      const toDate = request.query.toDate || request.query.EndDate;
      const page =
        request.query.page ||
        (request.query.StartPage !== undefined ? Number(request.query.StartPage) + 1 : undefined);
      const limit = request.query.limit || request.query.NumberOfRecords;
      const invoiceType = request.query.invoiceType;
      const statusNot = request.query.statusNot;

      // Handle Submitted filter (client's format: false=DRAFT, true=submitted statuses)
      let status = request.query.status;
      if (request.query.Submitted !== undefined) {
        status = request.query.Submitted === "false" ? "DRAFT" : undefined;
      }

      // P2-17: Ensure company access is always checked
      let effectiveCompanyId = companyId;
      if (companyId) {
        // Verify access to specified company
        await checkCompanyAccess(request, reply, companyId);
      } else if (!isSuperadmin(request.user!)) {
        // Non-superadmin without companyId - get user's companies and require selection
        const userWithCompanies = await findUserByIdWithCompanies(request.user!.userId);
        if (!userWithCompanies || userWithCompanies.companies.length === 0) {
          return reply.send({
            data: [],
            pagination: { total: 0, page: 1, limit: limit || 20, totalPages: 0 },
          });
        }
        // If user has only one company, auto-select it
        if (userWithCompanies.companies.length === 1) {
          effectiveCompanyId = userWithCompanies.companies[0].company.id;
        } else {
          // User has multiple companies but didn't specify - return error
          return reply.status(400).send({
            error: "companyId is required when user has multiple companies",
            code: "COMPANY_ID_REQUIRED",
          });
        }
      }
      // Superadmin without companyId can list all invoices

      const result = await listInvoices({
        companyId: effectiveCompanyId,
        status: status as InvoiceStatus | undefined,
        statusNot: statusNot as InvoiceStatus | undefined,
        invoiceType: invoiceType as InvoiceType | undefined,
        dateFrom: fromDate ? new Date(fromDate) : undefined,
        dateTo: toDate ? new Date(toDate) : undefined,
        page: page || 1,
        limit: limit || 20,
      });

      return reply.send({
        data: result.data.map((invoice) => ({
          id: invoice.id,
          trackingId: invoice.trackingId,
          companyId: invoice.companyId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate.toISOString(),
          invoiceType: invoice.invoiceType,
          status: invoice.status,
          myinvoisUuid: invoice.myinvoisUuid,
          myinvoisLongId: invoice.myinvoisLongId,
          amount: invoice.amount,
          discount: invoice.discount,
          rounding: invoice.rounding,
          taxAmount: invoice.taxAmount,
          total: invoice.total,
          errorCode: invoice.errorCode,
          errorMessage: invoice.errorMessage,
          createdAt: invoice.createdAt.toISOString(),
          updatedAt: invoice.updatedAt.toISOString(),
        })),
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    }
  );

  /**
   * PUT /api/v1/documents/:trackingId
   * Update a draft or invalid invoice's data
   * Allowed for DRAFT and INVALID status invoices
   * INVALID invoices are reset to DRAFT when edited (for re-submission)
   */
  fastify.put<{
    Params: { trackingId: string };
    Body: {
      invoiceDate?: string;
      amount?: number;
      discount?: number;
      rounding?: number;
      taxAmount?: number;
      total?: number;
      items?: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
        taxCode: string;
        taxRate: number;
        taxAmount: number;
        total: number;
      }>;
      buyer?: {
        tin?: string;
        name?: string;
        idType?: string;
        idValue?: string;
        address?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        phone?: string;
        email?: string;
      };
    };
  }>(
    "/:trackingId",
    {
      preHandler: [requirePermission("submit:invoice")],
      schema: {
        params: {
          type: "object",
          required: ["trackingId"],
          properties: {
            trackingId: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            invoiceDate: { type: "string" },
            amount: { type: "number" },
            discount: { type: "number" },
            rounding: { type: "number" },
            taxAmount: { type: "number" },
            total: { type: "number" },
            items: { type: "array" },
            buyer: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const { trackingId } = request.params;

      // Find the invoice
      const invoice = await findInvoiceByTrackingId(trackingId);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "INVOICE_NOT_FOUND",
            message: "Invoice not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Only allow updating DRAFT or INVALID invoices
      const editableStatuses = ["DRAFT", "INVALID"];
      if (!editableStatuses.includes(invoice.status)) {
        const error: ErrorResponse = {
          error: {
            code: "INVALID_STATUS",
            message: `Cannot update invoice. Only DRAFT or INVALID invoices can be edited. Current status: ${invoice.status}`,
          },
        };
        return reply.status(400).send(error);
      }

      // If invoice is INVALID, reset it to DRAFT for re-submission
      // This clears MyInvois fields and error messages
      if (invoice.status === "INVALID") {
        await updateInvoiceStatus(invoice.id, {
          status: "DRAFT",
          myinvoisUuid: undefined,
          myinvoisLongId: undefined,
          errorCode: undefined,
          errorMessage: undefined,
        });
      }

      // Build the update input
      const updateInput: UpdateDraftInvoiceInput = {};

      if (request.body.invoiceDate) {
        updateInput.invoiceDate = new Date(request.body.invoiceDate);
      }
      if (request.body.amount !== undefined) {
        updateInput.amount = String(request.body.amount);
      }
      if (request.body.discount !== undefined) {
        updateInput.discount = String(request.body.discount);
      }
      if (request.body.rounding !== undefined) {
        updateInput.rounding = String(request.body.rounding);
      }
      if (request.body.taxAmount !== undefined) {
        updateInput.taxAmount = String(request.body.taxAmount);
      }
      if (request.body.total !== undefined) {
        updateInput.total = String(request.body.total);
      }
      if (request.body.buyer) {
        updateInput.buyerInfo = JSON.stringify(request.body.buyer);
      }

      // Rebuild rawPayload with updated data
      // Parse existing payload and merge with new data
      let existingPayload: Record<string, unknown> = {};
      try {
        existingPayload = JSON.parse(invoice.rawPayload || "{}");
      } catch {
        // Ignore parse errors
      }

      // Update the invoice data in the payload
      const invoiceData =
        (existingPayload.invoices as Array<Record<string, unknown>>)?.[0] ||
        (existingPayload.invoice as Record<string, unknown>) ||
        {};

      if (request.body.invoiceDate) {
        invoiceData.invoiceDate = request.body.invoiceDate;
      }
      if (request.body.amount !== undefined) {
        invoiceData.amount = request.body.amount;
      }
      if (request.body.discount !== undefined) {
        invoiceData.discount = request.body.discount;
      }
      if (request.body.rounding !== undefined) {
        invoiceData.rounding = request.body.rounding;
      }
      if (request.body.taxAmount !== undefined) {
        invoiceData.taxAmount = request.body.taxAmount;
      }
      if (request.body.total !== undefined) {
        invoiceData.total = request.body.total;
      }
      if (request.body.items) {
        invoiceData.items = request.body.items;
      }
      if (request.body.buyer) {
        invoiceData.buyer = request.body.buyer;
        invoiceData.customer = request.body.buyer; // Also set customer for compatibility
      }

      // Update the payload structure
      if (existingPayload.invoices) {
        (existingPayload.invoices as Array<Record<string, unknown>>)[0] = invoiceData;
      } else if (existingPayload.invoice) {
        existingPayload.invoice = invoiceData;
      } else {
        existingPayload.invoices = [invoiceData];
      }

      updateInput.rawPayload = JSON.stringify(existingPayload);

      // Update the invoice
      const updatedInvoice = await updateDraftInvoice(invoice.id, updateInput);

      // Parse items from rawPayload for response
      let items: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxCode: string;
        taxRate: number;
        taxAmount: number;
        total: number;
      }> = [];

      if (updatedInvoice.rawPayload) {
        try {
          const payload = JSON.parse(updatedInvoice.rawPayload);
          const invoiceDataResponse = payload.invoices?.[0] || payload.invoice || payload;
          if (invoiceDataResponse.items && Array.isArray(invoiceDataResponse.items)) {
            items = invoiceDataResponse.items;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      return reply.send({
        trackingId: updatedInvoice.trackingId,
        invoiceNumber: updatedInvoice.invoiceNumber,
        invoiceDate: updatedInvoice.invoiceDate.toISOString(),
        invoiceType: updatedInvoice.invoiceType,
        status: updatedInvoice.status,
        amount: updatedInvoice.amount,
        discount: updatedInvoice.discount,
        rounding: updatedInvoice.rounding,
        taxAmount: updatedInvoice.taxAmount,
        total: updatedInvoice.total,
        items,
        message: "Invoice updated successfully",
        updatedAt: updatedInvoice.updatedAt.toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/documents/:uuid/status
   * Get document status from MyInvois
   */
  fastify.get<{ Params: { uuid: string } }>(
    "/:uuid/status",
    {
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;

      // Find invoice by MyInvois UUID
      const invoice = await findInvoiceByMyinvoisUuid(uuid);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Build response
      const response: Record<string, unknown> = {
        id: invoice.id,
        trackingId: invoice.trackingId,
        myinvoisUuid: invoice.myinvoisUuid,
        myinvoisLongId: invoice.myinvoisLongId,
        status: invoice.status,
        invoiceNumber: invoice.invoiceNumber,
        invoiceType: invoice.invoiceType,
        invoiceDate: invoice.invoiceDate.toISOString(),
        amount: invoice.amount,
        discount: invoice.discount,
        rounding: invoice.rounding,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        errorCode: invoice.errorCode,
        errorMessage: invoice.errorMessage,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };

      // Add links for valid documents with longId
      if (invoice.status === "VALID" && invoice.myinvoisUuid && invoice.myinvoisLongId) {
        const links = generateDocumentLinks(invoice.myinvoisUuid, invoice.myinvoisLongId);
        response.links = {
          share: links.shareLink,
          verify: links.verifyLink,
          qr: links.qrCodeUrl,
          view: links.viewLink,
        };
      }

      return reply.send(response);
    }
  );

  /**
   * POST /api/v1/documents/:uuid/refresh
   * Refresh document status from MyInvois API
   * Directly calls MyInvois to get latest status and updates database
   */
  fastify.post<{ Params: { uuid: string } }>(
    "/:uuid/refresh",
    {
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;

      // Find invoice by MyInvois UUID
      const invoice = await findInvoiceByMyinvoisUuid(uuid);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Get company for ERP on-behalf mode
      const company = await findCompanyById(invoice.companyId);

      if (!company) {
        const error: ErrorResponse = {
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        };
        return reply.status(404).send(error);
      }

      try {
        // Use ERP on-behalf mode (same as submission)
        const sessionCreds = getSessionCredentials(company);
        const tokenManager = createTokenManager();

        // Get token with ERP credentials
        const tokenResult = await tokenManager.getToken({
          sessionId: generateSessionId(),
          env: sessionCreds.env,
          mode: sessionCreds.mode,
          clientId: sessionCreds.clientId,
          clientSecret: sessionCreds.clientSecret,
          scope: "InvoicingAPI",
          ...(sessionCreds.onBehalfOf && { onBehalfOf: sessionCreds.onBehalfOf }),
        });

        if (!tokenResult.ok) {
          throw new Error(`Token request failed: ${tokenResult.error?.message || "Unknown error"}`);
        }

        // Build headers with onbehalfof for ERP mode
        const headers: Record<string, string> = {
          Authorization: `Bearer ${tokenResult.token.accessToken}`,
        };
        if (sessionCreds.onBehalfOf) {
          headers.onbehalfof = sessionCreds.onBehalfOf;
        }

        // Fetch document details from MyInvois
        const baseUrl =
          sessionCreds.env === "PROD"
            ? "https://api.myinvois.hasil.gov.my"
            : "https://preprod-api.myinvois.hasil.gov.my";

        const docResponse = await fetch(`${baseUrl}/api/v1.0/documents/${uuid}/details`, {
          headers,
        });

        if (!docResponse.ok) {
          throw new Error(`Document fetch failed: ${docResponse.status}`);
        }

        const docDetails = (await docResponse.json()) as {
          uuid: string;
          longId: string;
          status: string;
          dateTimeValidated: string | null;
          validationResults?: {
            status: string;
            validationSteps: Array<{
              status: string;
              name: string;
              error?: { code: string; message: string };
            }>;
          };
        };

        // Map MyInvois status to our internal status
        const statusMap: Record<string, string> = {
          Valid: "VALID",
          Invalid: "INVALID",
          Submitted: "SUBMITTED",
          Cancelled: "CANCELLED",
          Rejected: "REJECTED",
        };
        const newStatus = statusMap[docDetails.status] || docDetails.status.toUpperCase();

        // Extract error if invalid
        let errorCode: string | null = null;
        let errorMessage: string | null = null;

        if (docDetails.validationResults?.status === "Invalid") {
          const failedStep = docDetails.validationResults.validationSteps.find(
            (s) => s.status === "Invalid"
          );
          if (failedStep?.error) {
            errorCode = failedStep.error.code;
            errorMessage = `${failedStep.name}: ${failedStep.error.message}`;
          }
        }

        // Update ALL invoices with this UUID (important for consolidated invoices)
        const updateInput: UpdateInvoiceStatusInput = {
          status: newStatus as InvoiceStatus,
          myinvoisLongId: docDetails.longId || undefined,
          errorCode: errorCode ?? undefined,
          errorMessage: errorMessage ?? undefined,
        };
        const updatedCount = await updateAllInvoicesByMyinvoisUuid(uuid, updateInput);

        fastify.log.info({
          msg: "Refreshed invoices updated",
          uuid,
          newStatus,
          updatedCount,
        });

        // Return updated status with all fields
        return reply.send({
          id: invoice.id,
          trackingId: invoice.trackingId,
          myinvoisUuid: invoice.myinvoisUuid,
          myinvoisLongId: docDetails.longId || null,
          status: newStatus,
          invoiceNumber: invoice.invoiceNumber,
          invoiceType: invoice.invoiceType,
          invoiceDate: invoice.invoiceDate.toISOString(),
          amount: invoice.amount,
          discount: invoice.discount,
          rounding: invoice.rounding,
          taxAmount: invoice.taxAmount,
          total: invoice.total,
          errorCode,
          errorMessage,
          validatedAt: docDetails.dateTimeValidated,
          refreshedAt: new Date().toISOString(),
          createdAt: invoice.createdAt.toISOString(),
          updatedAt: invoice.updatedAt.toISOString(),
        });
      } catch (err) {
        const error: ErrorResponse = {
          error: {
            code: "REFRESH_FAILED",
            message: err instanceof Error ? err.message : "Failed to refresh status",
          },
        };
        return reply.status(500).send(error);
      }
    }
  );

  /**
   * GET /api/v1/documents/:uuid/pdf
   * Download document PDF from MyInvois
   */
  fastify.get<{ Params: { uuid: string } }>(
    "/:uuid/pdf",
    {
      preHandler: [authenticate, requirePermission("read:documents")],
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;

      // Find invoice by MyInvois UUID
      const invoice = await findInvoiceByMyinvoisUuid(uuid);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Check if we have the longId required for document retrieval
      if (!invoice.myinvoisLongId) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_LONG_ID",
            message: "Document long ID not available for retrieval",
          },
        };
        return reply.status(400).send(error);
      }

      // Get company and session credentials (supports ERP on-behalf mode)
      const company = await findCompanyById(invoice.companyId);
      if (!company) {
        const error: ErrorResponse = {
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        };
        return reply.status(404).send(error);
      }

      try {
        // Get session credentials (ERP mode or standard mode)
        const sessionCreds = getSessionCredentials(company);
        const tokenManager = createTokenManager();

        const result = await getDocument(
          {
            sessionId: generateSessionId(),
            env: sessionCreds.env,
            mode: sessionCreds.mode,
            clientId: sessionCreds.clientId,
            clientSecret: sessionCreds.clientSecret,
            scope: "InvoicingAPI",
            ...(sessionCreds.onBehalfOf && { onBehalfOf: sessionCreds.onBehalfOf }),
          },
          { uuid, longId: invoice.myinvoisLongId },
          { tokenManager }
        );

        if (!result.ok) {
          // Check if it's a 404 from MyInvois - document exists locally but not on MyInvois
          const isNotFoundOnMyInvois =
            result.error.status === 404 ||
            result.error.code === "DOCUMENT_NOT_FOUND" ||
            result.error.message?.toLowerCase().includes("not found");

          if (isNotFoundOnMyInvois) {
            const error: ErrorResponse = {
              error: {
                code: "DOCUMENT_NOT_FOUND_ON_MYINVOIS",
                message:
                  "Document exists in local database but could not be retrieved from MyInvois. The document may have been removed or the sandbox data may have been cleared.",
                details: {
                  localStatus: invoice.status,
                  myinvoisUuid: uuid,
                  myinvoisError: result.error.message,
                },
              },
            };
            return reply.status(404).send(error);
          }

          const error: ErrorResponse = {
            error: {
              code: result.error.code || "DOCUMENT_FETCH_FAILED",
              message: result.error.message,
            },
          };
          return reply.status(400).send(error);
        }

        // Check if document is valid with longId - required for MyInvois PDF
        if (invoice.status !== "VALID" || !invoice.myinvoisLongId) {
          // Return UBL document for non-valid documents
          return reply.send({
            uuid,
            invoiceNumber: invoice.invoiceNumber,
            document: result.result.document,
            format: result.result.format,
            message:
              "Document not yet valid. Raw UBL document returned. PDF available after validation.",
          });
        }

        // For valid documents, return MyInvois portal link for PDF
        const links = generateDocumentLinks(uuid, invoice.myinvoisLongId);
        return reply.send({
          myinvoisUuid: uuid,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          myinvoisLongId: invoice.myinvoisLongId,
          links,
          message:
            "Visit the viewLink to access the official MyInvois document view with PDF print option.",
          document: result.result.document,
          format: result.result.format,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Document fetch failed";
        const errorResponse: ErrorResponse = {
          error: {
            code: "DOCUMENT_FETCH_ERROR",
            message,
          },
        };
        return reply.status(500).send(errorResponse);
      }
    }
  );

  /**
   * GET /api/v1/documents/:uuid/qr
   * Generate QR code image for the document share link
   * Only available for VALID documents with longId
   */
  fastify.get<{ Params: { uuid: string } }>(
    "/:uuid/qr",
    {
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;

      // Find invoice by MyInvois UUID
      const invoice = await findInvoiceByMyinvoisUuid(uuid);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Check if document is valid and has longId
      if (invoice.status !== "VALID") {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_VALID",
            message: "QR code only available for VALID documents",
          },
        };
        return reply.status(400).send(error);
      }

      if (!invoice.myinvoisLongId) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_LONG_ID",
            message: "Document longId not yet available. Try again later.",
          },
        };
        return reply.status(400).send(error);
      }

      try {
        // Generate share link
        const shareLink = `${MYINVOIS_BASE_URL}/${uuid}/share/${invoice.myinvoisLongId}`;

        // Generate QR code as PNG buffer
        const qrBuffer = await QRCode.toBuffer(shareLink, {
          type: "png",
          width: 300,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });

        // Return QR code as image
        reply.header("Content-Type", "image/png");
        reply.header("Content-Disposition", `inline; filename="qr-${invoice.invoiceNumber}.png"`);
        reply.header("Content-Length", qrBuffer.length);
        reply.header("Cache-Control", "public, max-age=3600"); // Cache for 1 hour

        return reply.send(qrBuffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : "QR code generation failed";
        const errorResponse: ErrorResponse = {
          error: {
            code: "QR_GENERATION_ERROR",
            message,
          },
        };
        return reply.status(500).send(errorResponse);
      }
    }
  );

  /**
   * GET /api/v1/documents/:uuid/links
   * Get all shareable links for a valid document
   * Only available for VALID documents with longId
   */
  fastify.get<{ Params: { uuid: string } }>(
    "/:uuid/links",
    {
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;

      // Find invoice by MyInvois UUID
      const invoice = await findInvoiceByMyinvoisUuid(uuid);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Check if document is valid
      if (invoice.status !== "VALID") {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_VALID",
            message: "Links only available for VALID documents",
          },
        };
        return reply.status(400).send(error);
      }

      if (!invoice.myinvoisLongId) {
        const error: ErrorResponse = {
          error: {
            code: "MISSING_LONG_ID",
            message: "Document longId not yet available. Try again later.",
          },
        };
        return reply.status(400).send(error);
      }

      // Generate all links
      const links = generateDocumentLinks(uuid, invoice.myinvoisLongId);

      return reply.send({
        myinvoisUuid: uuid,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        myinvoisLongId: invoice.myinvoisLongId,
        links: {
          share: links.shareLink,
          verify: links.verifyLink,
          qr: links.qrCodeUrl,
          view: links.viewLink,
        },
        message: "Document links generated successfully",
      });
    }
  );

  /**
   * GET /api/v1/documents/consolidated/:uuid
   * Get consolidated invoice preview
   * Returns all invoices that were consolidated into a single MyInvois submission
   * along with aggregated items
   */
  fastify.get<{ Params: { uuid: string } }>(
    "/consolidated/:uuid",
    {
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;

      // Find all invoices with this MyInvois UUID
      const invoicesResult = await listInvoices({
        limit: 10000,
      });

      // Filter to invoices with matching UUID
      const consolidatedInvoices = invoicesResult.data.filter((inv) => inv.myinvoisUuid === uuid);

      if (consolidatedInvoices.length === 0) {
        const error: ErrorResponse = {
          error: {
            code: "CONSOLIDATED_NOT_FOUND",
            message: "No consolidated invoices found for this UUID",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access (check first invoice's company)
      await checkCompanyAccess(request, reply, consolidatedInvoices[0].companyId);

      // Find the main consolidated invoice (CONSOLIDATE type)
      const mainInvoice = consolidatedInvoices.find((inv) => inv.invoiceType === "CONSOLIDATE");

      // Get source invoices (all others)
      const sourceInvoices = consolidatedInvoices.filter(
        (inv) => inv.invoiceType !== "CONSOLIDATE"
      );

      // Aggregate items from all source invoices
      const aggregatedItems: Record<
        string,
        {
          description: string;
          taxCode: string;
          taxRate: number;
          quantity: number;
          unitPrice: number;
          discount: number;
          taxAmount: number;
          total: number;
        }
      > = {};

      for (const inv of sourceInvoices) {
        try {
          const payload = JSON.parse(inv.rawPayload);
          const items = payload.items || [];
          for (const item of items) {
            const key = `${item.description}||${item.taxCode}`;
            const existing = aggregatedItems[key];
            if (existing) {
              existing.quantity += item.quantity || 0;
              existing.discount += item.discount || 0;
              existing.taxAmount += item.taxAmount || 0;
              existing.total += item.total || 0;
            } else {
              aggregatedItems[key] = {
                description: item.description,
                taxCode: item.taxCode || "02",
                taxRate: item.taxRate || 6,
                quantity: item.quantity || 0,
                unitPrice: item.unitPrice || 0,
                discount: item.discount || 0,
                taxAmount: item.taxAmount || 0,
                total: item.total || 0,
              };
            }
          }
        } catch {
          // Skip invalid payload
        }
      }

      const items = Object.values(aggregatedItems);

      // Calculate totals
      let totalAmount = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      let grandTotal = 0;

      for (const item of items) {
        totalAmount += item.quantity * item.unitPrice;
        totalDiscount += item.discount;
        totalTax += item.taxAmount;
        grandTotal += item.total;
      }

      return reply.send({
        isConsolidated: true,
        myinvoisUuid: uuid,
        consolidatedInvoice: mainInvoice
          ? {
              invoiceNumber: mainInvoice.invoiceNumber,
              invoiceDate: mainInvoice.invoiceDate,
              status: mainInvoice.status,
              myinvoisLongId: mainInvoice.myinvoisLongId,
            }
          : null,
        sourceInvoices: sourceInvoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          invoiceType: inv.invoiceType,
          status: inv.status,
          amount: inv.amount,
          taxAmount: inv.taxAmount,
          total: inv.total,
        })),
        sourceCount: sourceInvoices.length,
        items,
        totals: {
          amount: totalAmount,
          discount: totalDiscount,
          taxAmount: totalTax,
          total: grandTotal,
        },
        company: consolidatedInvoices[0].company,
      });
    }
  );

  /**
   * POST /api/v1/documents/:uuid/cancel
   * Cancel document in MyInvois
   */
  fastify.post<{ Params: { uuid: string }; Body: { reason: string } }>(
    "/:uuid/cancel",
    {
      preHandler: [requirePermission("cancel:documents")],
      schema: {
        params: {
          type: "object",
          required: ["uuid"],
          properties: {
            uuid: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["reason"],
          properties: {
            reason: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { uuid } = request.params;
      const { reason } = request.body;

      // Find invoice by MyInvois UUID
      const invoice = await findInvoiceByMyinvoisUuid(uuid);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // For consolidated invoices, check if ALL invoices with this UUID are already cancelled
      // Don't block if only some are cancelled - we need to update the rest
      const prismaNew = getPrismaClient();
      const nonCancelledCountNew = await prismaNew.invoice.count({
        where: {
          myinvoisUuid: uuid,
          status: { not: "CANCELLED" },
        },
      });

      if (nonCancelledCountNew === 0) {
        // ALL invoices with this UUID are already cancelled
        const error: ErrorResponse = {
          error: {
            code: "ALREADY_CANCELLED",
            message: "Document is already cancelled",
          },
        };
        return reply.status(400).send(error);
      }

      // Get company and session credentials (supports ERP on-behalf mode)
      const company = await findCompanyById(invoice.companyId);
      if (!company) {
        const error: ErrorResponse = {
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        };
        return reply.status(404).send(error);
      }

      try {
        // Get session credentials (ERP mode or standard mode)
        const sessionCreds = getSessionCredentials(company);
        const tokenManager = createTokenManager();

        // Debug logging for cancel request
        fastify.log.info({
          msg: "Cancel document request",
          uuid,
          companyTin: company.tin,
          erpTin: process.env.ERP_TIN,
          mode: sessionCreds.mode,
          onBehalfOf: sessionCreds.onBehalfOf,
          env: sessionCreds.env,
        });

        const result = await changeDocumentState(
          {
            sessionId: generateSessionId(),
            env: sessionCreds.env,
            mode: sessionCreds.mode,
            clientId: sessionCreds.clientId,
            clientSecret: sessionCreds.clientSecret,
            scope: "InvoicingAPI",
            ...(sessionCreds.onBehalfOf && { onBehalfOf: sessionCreds.onBehalfOf }),
          },
          { uuid, status: "cancelled", reason },
          { tokenManager }
        );

        // Check if LHDN says document is already cancelled - still update local DB
        // LHDN may return different error messages:
        // - Explicit: "Document is already cancelled" or "DocumentAlreadyCancelled"
        // - Implicit: "Invalid request" (400) when document was already cancelled
        // If we get a 400/VALIDATION_ERROR and we have local invoices that ARE already
        // cancelled with this UUID, treat it as "already cancelled at LHDN"
        const hasLocalCancelledInvoiceNew = invoice.status === "CANCELLED";

        const isExplicitAlreadyCancelledNew =
          !result.ok &&
          (result.error?.code === "ALREADY_CANCELLED" ||
            result.error?.code === "DocumentAlreadyCancelled" ||
            result.error?.message?.toLowerCase().includes("already cancelled") ||
            result.error?.message?.toLowerCase().includes("already been cancelled"));

        // If LHDN returns 400/VALIDATION_ERROR and we have at least one locally
        // cancelled invoice, assume the document IS cancelled at LHDN
        const isImplicitAlreadyCancelledNew =
          !result.ok && result.error?.code === "VALIDATION_ERROR" && hasLocalCancelledInvoiceNew;

        const isAlreadyCancelledAtLhdn =
          isExplicitAlreadyCancelledNew || isImplicitAlreadyCancelledNew;

        if (!result.ok && !isAlreadyCancelledAtLhdn) {
          // Real error - not just "already cancelled"
          fastify.log.error({
            msg: "Cancel document failed",
            uuid,
            error: result.error,
            hasLocalCancelledInvoice: hasLocalCancelledInvoiceNew,
          });
          const error: ErrorResponse = {
            error: {
              code: result.error.code || "CANCEL_FAILED",
              message: result.error.message,
            },
          };
          return reply.status(400).send(error);
        }

        if (isAlreadyCancelledAtLhdn) {
          fastify.log.info({
            msg: "Document already cancelled at LHDN, updating all local invoices",
            uuid,
            detection: isExplicitAlreadyCancelledNew
              ? "explicit"
              : "implicit (VALIDATION_ERROR + local cancelled invoice)",
          });
        }

        // Update ALL local invoices with this UUID (important for consolidated invoices)
        // Multiple invoices may share the same myinvoisUuid when consolidated
        const updateInput: UpdateInvoiceStatusInput = {
          status: "CANCELLED" as InvoiceStatus,
        };
        const updatedCount = await updateAllInvoicesByMyinvoisUuid(uuid, updateInput);

        fastify.log.info({
          msg: "Cancelled invoices updated",
          uuid,
          updatedCount,
        });

        return reply.send({
          uuid,
          status: "CANCELLED",
          message: isAlreadyCancelledAtLhdn
            ? "Document was already cancelled at LHDN, local records updated"
            : "Document cancelled successfully",
          invoicesUpdated: updatedCount,
        });
      } catch (error) {
        fastify.log.error({
          msg: "Cancel document exception",
          uuid,
          error: error instanceof Error ? error.message : error,
        });
        const message = error instanceof Error ? error.message : "Cancel failed";
        const errorResponse: ErrorResponse = {
          error: {
            code: "CANCEL_ERROR",
            message,
          },
        };
        return reply.status(500).send(errorResponse);
      }
    }
  );

  /**
   * POST /api/v1/documents/:trackingId/submit
   * Submit a saved draft document to MyInvois
   *
   * This endpoint allows users to submit a previously saved draft (JustSave)
   * document to LHDN MyInvois. The draft must be in DRAFT status.
   *
   * The system will:
   * 1. Retrieve the saved invoice by trackingId
   * 2. Verify it's in DRAFT status
   * 3. Parse the stored rawPayload to get invoice data
   * 4. Determine the submission type (consolidate, buyer, or personal)
   * 5. Transform to UBL format and submit to MyInvois
   * 6. Update the database with the new status and MyInvois UUID
   */
  fastify.post<{
    Params: { trackingId: string };
    Body: { documentVersion?: "1.0" | "1.1" };
  }>(
    "/:trackingId/submit",
    {
      preHandler: [requirePermission("submit:invoice")],
      schema: {
        params: {
          type: "object",
          required: ["trackingId"],
          properties: {
            trackingId: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            documentVersion: { type: "string", enum: ["1.0", "1.1"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { trackingId } = request.params;
      const { documentVersion = "1.1" } = request.body || {};

      // Find the draft invoice by tracking ID
      const invoice = await findInvoiceByTrackingId(trackingId);

      if (!invoice) {
        const error: ErrorResponse = {
          error: {
            code: "DRAFT_NOT_FOUND",
            message: "Draft invoice not found with the given tracking ID",
          },
        };
        return reply.status(404).send(error);
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Check if invoice is in DRAFT status
      if (invoice.status !== "DRAFT") {
        const error: ErrorResponse = {
          error: {
            code: "INVALID_STATUS",
            message: `Invoice is not in DRAFT status. Current status: ${invoice.status}`,
          },
        };
        return reply.status(400).send(error);
      }

      // Parse the stored raw payload
      let storedPayload: OriginalRequest;
      try {
        const parsed = JSON.parse(invoice.rawPayload || "{}");
        // Handle multiple formats:
        // 1. { invoices: [...] } - from /documents/submit endpoint
        // 2. { invoice: {...} } - from /submit-justsave endpoint (singular)
        // 3. { invoiceNumber, items, ... } - flat format from POS /api/v1/pos/invoice endpoint
        if (parsed.invoices) {
          // Format 1: Already has invoices array
          storedPayload = parsed;
        } else if (parsed.invoice && !parsed.invoices) {
          // Format 2: Convert singular invoice to invoices array
          storedPayload = {
            ...parsed,
            invoices: [parsed.invoice],
          };
        } else if (parsed.invoiceNumber && parsed.items) {
          // Format 3: Flat POS format - wrap in invoices array
          storedPayload = {
            companyId: invoice.companyId,
            invoices: [parsed],
          };
        } else {
          storedPayload = parsed;
        }
      } catch {
        const error: ErrorResponse = {
          error: {
            code: "INVALID_PAYLOAD",
            message: "Failed to parse stored invoice data",
          },
        };
        return reply.status(500).send(error);
      }

      // Validate signing capability
      validateSigningCapability(documentVersion as DocumentVersion);

      // Get company with credentials (required for submission)
      let company: Awaited<ReturnType<typeof getCompanyWithCredentials>>;
      try {
        company = await getCompanyWithCredentials(invoice.companyId);
      } catch (err) {
        if (typeof err === "object" && err !== null && "status" in err) {
          const typedErr = err as { status: number; code: string; message: string };
          const error: ErrorResponse = {
            error: {
              code: typedErr.code,
              message: typedErr.message,
            },
          };
          return reply.status(typedErr.status).send(error);
        }
        throw err;
      }

      // Normalize the stored payload to get the invoice data
      const normalized = normalizeRequest(storedPayload);
      const normalizedInvoice = normalized.invoices[0];

      if (!normalizedInvoice) {
        const error: ErrorResponse = {
          error: {
            code: "INVALID_INVOICE_DATA",
            message: "No invoice data found in stored payload",
          },
        };
        return reply.status(500).send(error);
      }

      // Determine submission type based on buyer info
      const buyer = normalizedInvoice.buyer;
      let isConsolidated = false;
      let submissionType: "consolidate" | "buyer" | "personal" = "consolidate";

      if (!buyer) {
        // No buyer = consolidated anonymous B2C
        isConsolidated = true;
        submissionType = "consolidate";
      } else {
        const idType = buyer.idType?.toUpperCase();
        if (idType === "BRN") {
          submissionType = "buyer";
        } else if (idType === "NRIC") {
          submissionType = "personal";
        } else {
          // Unknown buyer type, default to consolidated
          isConsolidated = true;
          submissionType = "consolidate";
        }
      }

      // Validate invoice date is not in the future
      // MyInvois rejects documents with future dates (CF321)
      const invoiceDate = normalizedInvoice.invoiceDate || new Date().toISOString();
      const invoiceDateObj = new Date(invoiceDate);
      const now = new Date();
      if (invoiceDateObj > now) {
        const error: ErrorResponse = {
          error: {
            code: "FUTURE_DATE",
            message: `Invoice date cannot be in the future. Invoice date: ${invoiceDate}, Current time: ${now.toISOString()}. Please update the invoice date from POS.`,
          },
        };
        return reply.status(400).send(error);
      }

      // Build the invoice for transformation
      const invoiceForTransform = {
        invoiceNumber: normalizedInvoice.invoiceNumber,
        invoiceDate: invoiceDate,
        amount: normalizedInvoice.amount,
        discount: normalizedInvoice.discount ?? 0,
        rounding: normalizedInvoice.rounding ?? 0,
        taxAmount: normalizedInvoice.taxAmount,
        total: normalizedInvoice.total,
        currency: "MYR",
        reference: normalizedInvoice.reference,
        buyer: buyer,
        items: normalizedInvoice.items,
      };

      // Transform to UBL
      const ublDocument = transformToUBL(
        [invoiceForTransform],
        company,
        isConsolidated,
        documentVersion
      );

      // Process document for submission (signing if v1.1)
      const correlationId = (request as unknown as { correlationId?: string }).correlationId;
      const processedDocument = processDocumentForSubmission(
        ublDocument as unknown as Record<string, unknown>,
        documentVersion as DocumentVersion,
        invoice.invoiceNumber,
        correlationId
      );

      // Update status to SUBMITTING before async submission
      await updateInvoiceStatus(invoice.id, {
        status: "SUBMITTING" as InvoiceStatus,
        trackingId: trackingId,
      });

      // Submit to MyInvois in background (non-blocking)
      // Uses existing helper function for async submission pattern
      submitToMyInvoisAsync(
        invoice.id,
        trackingId,
        processedDocument,
        company,
        invoice.companyId,
        invoice.invoiceNumber,
        request.log
      );

      // Return immediately with SUBMITTING status
      const response: SubmissionResponse = {
        trackingId: trackingId,
        invoiceId: trackingId,
        invoiceNumber: invoice.invoiceNumber,
        posInvoiceId: invoice.posInvoiceId || "",
        status: "SUBMITTING",
        message: `Draft ${submissionType} invoice queued for submission. Poll status using trackingId.`,
        submittedAt: new Date().toISOString(),
      };

      return reply.status(202).send(response);
    }
  );

  /**
   * POST /api/v1/documents/admin/trigger-poll
   * Manually trigger the AutoPoller to refresh SUBMITTED invoice statuses
   * Rate limited: 2 triggers per 30 minutes
   * Requires manage:companies permission (admin only)
   */
  const POLL_RATE_LIMIT = 2;
  const POLL_RATE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  const pollTriggerHistory: number[] = [];

  fastify.post(
    "/admin/trigger-poll",
    {
      preHandler: [requirePermission("manage:companies")],
    },
    async (request, reply) => {
      const now = Date.now();

      // Clean up old entries outside the rate window
      while (pollTriggerHistory.length > 0 && pollTriggerHistory[0] < now - POLL_RATE_WINDOW_MS) {
        pollTriggerHistory.shift();
      }

      // Check rate limit
      if (pollTriggerHistory.length >= POLL_RATE_LIMIT) {
        const oldestTrigger = pollTriggerHistory[0];
        const resetTime = new Date(oldestTrigger + POLL_RATE_WINDOW_MS);
        const remainingSeconds = Math.ceil((resetTime.getTime() - now) / 1000);

        return reply.status(429).send({
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Poll trigger rate limit exceeded. Maximum ${POLL_RATE_LIMIT} triggers per 30 minutes.`,
          },
          remainingTriggers: 0,
          resetAt: resetTime.toISOString(),
          retryAfterSeconds: remainingSeconds,
        });
      }

      // Record this trigger
      pollTriggerHistory.push(now);
      const remainingTriggers = POLL_RATE_LIMIT - pollTriggerHistory.length;

      request.log.info(`[Admin] Manual poll trigger requested (${remainingTriggers} remaining)`);

      // Trigger the poll asynchronously
      triggerPoll(
        request.log as unknown as {
          info: (msg: string) => void;
          warn: (msg: string) => void;
          error: (obj: unknown, msg: string) => void;
        }
      ).catch((err) => {
        request.log.error({ error: err }, "[Admin] Manual poll failed");
      });

      return reply.send({
        message: "Poll triggered. Check logs for results.",
        triggeredAt: new Date().toISOString(),
        remainingTriggers,
        rateLimitResetAt: new Date(now + POLL_RATE_WINDOW_MS).toISOString(),
      });
    }
  );

  /**
   * POST /api/v1/documents/admin/consolidate-now
   * Manually trigger monthly DRAFT invoice consolidation
   * Runs in-process (no BullMQ worker needed)
   * Requires manage:companies permission (admin only)
   */
  fastify.post(
    "/admin/consolidate-now",
    {
      preHandler: [requirePermission("manage:companies")],
    },
    async (request, reply) => {
      request.log.info("[Admin] Manual consolidation triggered");

      try {
        // Run consolidation in-process (this may take a while)
        const logger = {
          info: (msg: string) => request.log.info(msg),
          warn: (msg: string) => request.log.warn(msg),
          error: (obj: unknown, msg: string) => request.log.error(obj, msg),
        };

        const result = await triggerConsolidation(logger);

        // Check if feature is disabled
        if (!result.enabled) {
          return reply.status(503).send({
            error: {
              code: "FEATURE_DISABLED",
              message:
                "Monthly consolidation is disabled. Set ENABLE_MONTHLY_CONSOLIDATION=true in environment to enable.",
            },
          });
        }

        return reply.status(200).send({
          message: "Consolidation completed",
          processed: result.processed,
          submitted: result.submitted,
          failed: result.failed,
          errors: result.errors,
          triggeredAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to run consolidation";
        request.log.error({ error }, "[Admin] Failed to run consolidation");
        return reply.status(500).send({
          error: {
            code: "CONSOLIDATION_FAILED",
            message,
          },
        });
      }
    }
  );

  /**
   * GET /api/v1/documents/admin/consolidation-stats
   * Get monthly consolidation scheduler status
   * Requires manage:companies permission (admin only)
   */
  fastify.get(
    "/admin/consolidation-stats",
    {
      preHandler: [requirePermission("manage:companies")],
    },
    async (_request, reply) => {
      try {
        // P2-04: getConsolidatorStatus is now async (queries database)
        const status = await getConsolidatorStatus();
        return reply.send({
          scheduler: "monthly-consolidator",
          enabled: status.enabled,
          running: status.running,
          isConsolidating: status.isConsolidating,
          lastRun: status.lastRun,
          schedule: status.schedule,
          checkInterval: "hourly",
          featureFlag: "ENABLE_MONTHLY_CONSOLIDATION",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get status";
        return reply.status(500).send({
          error: {
            code: "STATUS_FETCH_FAILED",
            message,
          },
        });
      }
    }
  );

  /**
   * DELETE /api/v1/documents/:trackingId
   * Delete invoice by tracking ID (only DRAFT invoices can be deleted)
   */
  fastify.delete<{ Params: { trackingId: string } }>(
    "/:trackingId",
    {
      preHandler: [requirePermission("submit:invoice")],
      schema: {
        params: {
          type: "object",
          required: ["trackingId"],
          properties: {
            trackingId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { trackingId } = request.params;

      // Find invoice by tracking ID
      const invoice = await findInvoiceByTrackingId(trackingId);
      if (!invoice) {
        return reply.status(404).send({
          success: false,
          error: "Invoice not found",
          code: "INVOICE_NOT_FOUND",
        });
      }

      // Verify user has access to this company
      await checkCompanyAccess(request, reply, invoice.companyId);

      // Only DRAFT invoices can be deleted
      if (invoice.status !== "DRAFT") {
        return reply.status(400).send({
          success: false,
          error: `Cannot delete invoice with status ${invoice.status}. Only DRAFT invoices can be deleted.`,
          code: "INVOICE_NOT_DRAFT",
        });
      }

      // Delete the invoice
      await deleteInvoice(invoice.id);

      fastify.log.info({
        msg: "Invoice deleted",
        trackingId,
        invoiceNumber: invoice.invoiceNumber,
        userId: request.user?.userId,
      });

      return reply.send({
        success: true,
        message: `Invoice ${invoice.invoiceNumber} deleted successfully`,
      });
    }
  );
}
