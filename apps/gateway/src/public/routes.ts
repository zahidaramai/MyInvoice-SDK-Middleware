/**
 * Public API Routes
 * Endpoints for customer e-invoice registration (no authentication required)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PublicInvoiceSubmitSchema, RawPayloadSchema, type PublicBuyerSubmit } from "./schemas.js";
import {
  findInvoiceByPosInvoiceIdWithCompany,
  updateInvoiceStatus,
  updateDraftInvoice,
  type InvoiceStatus,
} from "@myinvois/storage";
import { transformToUBL, type CompanyInfo } from "../adapters/klcubelhdn/transformer.js";
import type {
  Invoice,
  InvoiceItem,
  Buyer,
  TaxCode,
  StateCode,
  IdType,
} from "../adapters/klcubelhdn/schemas.js";
import { submitDocuments, createTokenManager } from "@myinvois/myinvois-client";
import type { Environment, Mode } from "@myinvois/core";
import crypto from "crypto";
import {
  getSigningStatus,
  type SignableDocument,
  type SigningOptions,
} from "../middleware/signing.js";
import { signDocument as signDocumentMiddleware } from "../middleware/signing.js";
import type { DocumentVersion } from "@myinvois/signing";
import { publicApiLogger } from "../lib/appLogger.js";
import { AppError } from "../lib/AppError.js";

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
 * Check if ERP on-behalf mode is enabled
 */
function getErpConfig(): { enabled: boolean; clientId: string; clientSecret: string; env: string } {
  const enabled = process.env.ERP_MODE === "true";

  if (!enabled) {
    return { enabled: false, clientId: "", clientSecret: "", env: "SANDBOX" };
  }

  const clientId = process.env.ERP_MYINVOIS_CLIENT_ID;
  const clientSecret = process.env.ERP_MYINVOIS_CLIENT_SECRET;
  const env = process.env.ERP_MYINVOIS_ENV || "SANDBOX";

  if (!clientId || !clientSecret) {
    // P2-02: Use AppError instead of plain object
    throw new AppError(
      500,
      "ERP mode is enabled but credentials not configured",
      "ERP_CONFIG_ERROR"
    );
  }

  return { enabled: true, clientId, clientSecret, env };
}

/**
 * Check if invoice has expired (24 hours since creation)
 */
function isInvoiceExpired(createdAt: Date): boolean {
  const now = new Date();
  const diff = now.getTime() - createdAt.getTime();
  const hours = diff / (1000 * 60 * 60);
  return hours > 24;
}

/**
 * Parse raw payload from invoice
 * P2-09: Now validates JSON.parse results with Zod schema
 */
function parseRawPayload(rawPayload: string): {
  items: InvoiceItem[];
  paymentType?: string;
  invoiceDate?: string;
} {
  try {
    const rawParsed = JSON.parse(rawPayload);
    // P2-09: Validate parsed JSON with Zod schema
    const parseResult = RawPayloadSchema.safeParse(rawParsed);

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      publicApiLogger.warn(
        `Raw payload validation failed: ${firstIssue?.message || "unknown error"} - using empty items`
      );
      return { items: [] };
    }

    const parsed = parseResult.data;

    // Handle different payload formats
    // Format 1: Direct items array
    if (parsed.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return {
        items: parsed.items.map((item) => ({
          description: item.description || "Item",
          quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
          unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
          discount: Number.isFinite(item.discount) ? item.discount : 0,
          taxCode: (item.taxCode as TaxCode) || "02",
          taxRate: Number.isFinite(item.taxRate) ? item.taxRate : 0,
          taxAmount: Number.isFinite(item.taxAmount) ? item.taxAmount : 0,
          total: Number.isFinite(item.total) ? item.total : 0,
        })),
        paymentType: parsed.paymentType,
        invoiceDate: parsed.invoiceDate,
      };
    }

    // Format 2: Nested in invoices array (legacy format)
    if (parsed.invoices && Array.isArray(parsed.invoices) && parsed.invoices[0]) {
      const invoice = parsed.invoices[0];
      const invoiceItems = invoice.items || [];
      return {
        items: invoiceItems.map((item) => ({
          description: item.description || "Item",
          quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
          unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
          discount: Number.isFinite(item.discount) ? item.discount : 0,
          taxCode: (item.taxCode as TaxCode) || "02",
          taxRate: Number.isFinite(item.taxRate) ? item.taxRate : 0,
          taxAmount: Number.isFinite(item.taxAmount) ? item.taxAmount : 0,
          total: Number.isFinite(item.total) ? item.total : 0,
        })),
        paymentType: invoice.paymentType || parsed.paymentType,
        invoiceDate: invoice.invoiceDate,
      };
    }

    // Format 3: Nested in singular invoice object (POS draft format)
    if (
      parsed.invoice &&
      parsed.invoice.items &&
      Array.isArray(parsed.invoice.items) &&
      parsed.invoice.items.length > 0
    ) {
      const invoice = parsed.invoice;
      const invoiceItems = invoice.items!; // Already checked above
      return {
        items: invoiceItems.map((item) => ({
          description: item.description || "Item",
          quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
          unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
          discount: Number.isFinite(item.discount) ? item.discount : 0,
          taxCode: (item.taxCode as TaxCode) || "02",
          taxRate: Number.isFinite(item.taxRate) ? item.taxRate : 0,
          taxAmount: Number.isFinite(item.taxAmount) ? item.taxAmount : 0,
          total: Number.isFinite(item.total) ? item.total : 0,
        })),
        paymentType: invoice.paymentType || parsed.paymentType,
        invoiceDate: invoice.invoiceDate || parsed.invoiceDate,
      };
    }

    return { items: [] };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown";
    publicApiLogger.warn(`Failed to parse raw payload JSON: ${errMsg}`);
    return { items: [] };
  }
}

/**
 * Submit document to MyInvois
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
  error?: { code: string; message: string };
}> {
  try {
    const env: Environment = company.myinvoisEnv === "PROD" ? "PROD" : "SANDBOX";
    const erpConfig = getErpConfig();
    const tokenManager = createTokenManager();

    // Encode document to base64
    const documentJson = JSON.stringify(ublDocument);
    const documentBase64 = Buffer.from(documentJson).toString("base64");

    // Create document hash
    const documentHash = crypto.createHash("sha256").update(documentJson).digest("hex");

    // Submit to MyInvois
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

    const accepted = result.result.acceptedDocuments[0];
    if (accepted) {
      return {
        ok: true,
        trackingId: generateTrackingId(),
        submissionUid: result.result.submissionUid,
        uuid: accepted.uuid,
      };
    }

    const rejected = result.result.rejectedDocuments[0];
    if (rejected) {
      // P2-01: Use structured logger instead of console.error
      publicApiLogger.error(
        {
          codeNumber: rejected.codeNumber,
          errorCode: rejected.errorCode,
          errorMessage: rejected.errorMessage,
          errorDetails: rejected.errorDetails,
        },
        "Document rejected by MyInvois"
      );

      // Build detailed error message from errorDetails if available
      let detailedMessage = rejected.errorMessage || "Document rejected";
      if (rejected.errorDetails && rejected.errorDetails.length > 0) {
        const details = rejected.errorDetails
          .map((d) => {
            const parts = [];
            if (d.propertyName) parts.push(`Field: ${d.propertyName}`);
            if (d.propertyPath) parts.push(`Path: ${d.propertyPath}`);
            if (d.message) parts.push(`Error: ${d.message}`);
            if (d.code) parts.push(`Code: ${d.code}`);
            return parts.join(", ");
          })
          .filter(Boolean)
          .join("; ");
        if (details) {
          detailedMessage = `${detailedMessage}. Details: ${details}`;
        }
      }

      return {
        ok: false,
        error: {
          code: rejected.errorCode || "DOCUMENT_REJECTED",
          message: detailedMessage,
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
 * Public routes - no authentication required
 */
export async function publicRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /public/invoice/:invoiceId
   * Get invoice details for public registration page
   */
  fastify.get(
    "/invoice/:invoiceId",
    {
      schema: {
        description: "Get invoice details for registration",
        tags: ["Public"],
        params: {
          type: "object",
          properties: {
            invoiceId: { type: "string" },
          },
          required: ["invoiceId"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  invoiceId: { type: "string" },
                  company: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      tin: { type: "string" },
                    },
                  },
                  invoiceNumber: { type: "string" },
                  invoiceDate: { type: "string" },
                  items: { type: "array" },
                  amount: { type: "number" },
                  discount: { type: "number" },
                  rounding: { type: "number" },
                  taxAmount: { type: "number" },
                  total: { type: "number" },
                  paymentType: { type: "string" },
                  status: { type: "string" },
                  isExpired: { type: "boolean" },
                },
              },
            },
          },
          404: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              code: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) => {
      const { invoiceId } = request.params;

      // Find invoice by POS invoice ID
      const invoice = await findInvoiceByPosInvoiceIdWithCompany(invoiceId);

      if (!invoice) {
        return reply.status(404).send({
          success: false,
          error: "Invoice not found",
          code: "INVOICE_NOT_FOUND",
        });
      }

      // Parse raw payload for items
      const { items, paymentType } = parseRawPayload(invoice.rawPayload);

      // Check if expired
      const isExpired = isInvoiceExpired(invoice.createdAt);

      return reply.status(200).send({
        success: true,
        data: {
          invoiceId,
          company: {
            name: invoice.company.name,
            tin: invoice.company.tin,
          },
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate.toISOString(),
          items,
          amount: parseFloat(invoice.amount),
          discount: parseFloat(invoice.discount),
          rounding: parseFloat(invoice.rounding),
          taxAmount: parseFloat(invoice.taxAmount),
          total: parseFloat(invoice.total),
          paymentType: paymentType || "",
          status: invoice.status,
          isExpired,
        },
      });
    }
  );

  /**
   * POST /public/invoice/:invoiceId/submit
   * Submit buyer info and trigger MyInvois submission
   */
  fastify.post(
    "/invoice/:invoiceId/submit",
    {
      schema: {
        description: "Submit buyer info for e-invoice registration",
        tags: ["Public"],
        params: {
          type: "object",
          properties: {
            invoiceId: { type: "string" },
          },
          required: ["invoiceId"],
        },
        body: {
          type: "object",
          properties: {
            buyer: {
              type: "object",
              properties: {
                nationality: { type: "string" },
                idType: { type: "string" },
                idValue: { type: "string" },
                tin: { type: "string" },
                name: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                address1: { type: "string" },
                address2: { type: "string" },
                address3: { type: "string" },
                postalCode: { type: "string" },
                city: { type: "string" },
                state: { type: "string" },
                country: { type: "string" },
                sstRegNo: { type: "string" },
              },
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              status: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              code: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { invoiceId: string };
        Body: { buyer: PublicBuyerSubmit };
      }>,
      reply: FastifyReply
    ) => {
      const { invoiceId } = request.params;

      // Validate request body
      const parseResult = PublicInvoiceSubmitSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid request body",
          code: "VALIDATION_ERROR",
        });
      }

      const { buyer } = parseResult.data;

      // Find invoice by POS invoice ID
      const invoice = await findInvoiceByPosInvoiceIdWithCompany(invoiceId);

      if (!invoice) {
        return reply.status(404).send({
          success: false,
          error: "Invoice not found",
          code: "INVOICE_NOT_FOUND",
        });
      }

      // Check if invoice is DRAFT
      if (invoice.status !== "DRAFT") {
        return reply.status(400).send({
          success: false,
          error: `Invoice has already been ${invoice.status.toLowerCase()}`,
          code: "INVOICE_NOT_DRAFT",
        });
      }

      // Check if expired
      if (isInvoiceExpired(invoice.createdAt)) {
        return reply.status(400).send({
          success: false,
          error: "Invoice has expired. Please request a new invoice.",
          code: "INVOICE_EXPIRED",
        });
      }

      // Parse raw payload for items
      const { items, invoiceDate } = parseRawPayload(invoice.rawPayload);

      // Note: Invoice type (B2B vs B2C) is determined by buyer.idType
      // BRN with TIN = B2B, NRIC/PASSPORT/ARMY = B2C

      // Build company info for transformer
      const companyInfo: CompanyInfo = {
        tin: invoice.company.tin,
        idValue: invoice.company.idValue,
        idType: invoice.company.idType,
        name: invoice.company.name,
        address: invoice.company.address ?? undefined,
        city: invoice.company.city ?? undefined,
        state: invoice.company.state ?? undefined,
        postalCode: invoice.company.postalCode ?? undefined,
        country: invoice.company.country ?? undefined,
        phone: invoice.company.phone ?? undefined,
        email: invoice.company.email ?? undefined,
        sstRegistration: invoice.company.sstRegistration ?? undefined,
        ttxRegistration: invoice.company.ttxRegistration ?? undefined,
        industryCode: invoice.company.industryCode ?? undefined,
        industryName: invoice.company.industryName ?? undefined,
      };

      // Build buyer info for transformer
      const buyerInfo: Buyer = {
        name: buyer.name,
        tin: buyer.tin || undefined,
        idType: buyer.idType as IdType,
        idValue: buyer.idValue,
        address:
          [buyer.address1, buyer.address2, buyer.address3].filter(Boolean).join(", ") ||
          buyer.address1,
        city: buyer.city,
        state: buyer.state as StateCode,
        postalCode: buyer.postalCode,
        country: buyer.country,
        phone: buyer.phone,
        email: buyer.email || undefined,
      };

      // Build invoice data for transformer
      // Use the original POS invoice time (when the sale happened)
      // This is always in the past since customer scans QR after receiving receipt
      const invoiceData: Invoice = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoiceDate || invoice.invoiceDate.toISOString(),
        amount: parseFloat(invoice.amount),
        discount: parseFloat(invoice.discount),
        rounding: parseFloat(invoice.rounding),
        taxAmount: parseFloat(invoice.taxAmount),
        total: parseFloat(invoice.total),
        currency: "MYR",
        items: items.map((item) => ({
          ...item,
          taxCode: (item.taxCode || "02") as TaxCode,
        })),
        buyer: buyerInfo,
      };

      // Get document version from signing config
      const signingStatus = getSigningStatus("1.1");
      const documentVersion: DocumentVersion = signingStatus.canProceed ? "1.1" : "1.0";

      // Debug log company and buyer info
      fastify.log.info({
        msg: "Public submission - preparing UBL",
        invoiceId,
        documentVersion,
        companyInfo: {
          tin: companyInfo.tin,
          idValue: companyInfo.idValue,
          idType: companyInfo.idType,
          name: companyInfo.name,
          address: companyInfo.address,
          city: companyInfo.city,
          state: companyInfo.state,
          postalCode: companyInfo.postalCode,
          industryCode: companyInfo.industryCode,
          industryName: companyInfo.industryName,
        },
        buyerInfo: {
          name: buyerInfo.name,
          tin: buyerInfo.tin,
          idType: buyerInfo.idType,
          idValue: buyerInfo.idValue,
          address: buyerInfo.address,
          city: buyerInfo.city,
          state: buyerInfo.state,
          postalCode: buyerInfo.postalCode,
          country: buyerInfo.country,
        },
        invoiceData: {
          invoiceNumber: invoiceData.invoiceNumber,
          amount: invoiceData.amount,
          taxAmount: invoiceData.taxAmount,
          total: invoiceData.total,
          itemCount: invoiceData.items.length,
        },
      });

      // Transform to UBL
      const ublDocument = transformToUBL(
        [invoiceData],
        companyInfo,
        false, // Not consolidated
        documentVersion
      );

      // Debug log UBL document structure (key fields only)
      const ublContent = (
        ublDocument as {
          Invoice?: Array<{
            ID?: unknown;
            AccountingSupplierParty?: unknown;
            AccountingCustomerParty?: unknown;
          }>;
        }
      ).Invoice?.[0];
      fastify.log.info({
        msg: "Public submission - UBL generated",
        invoiceId,
        hasInvoice: !!ublContent,
        invoiceId_ubl: ublContent?.ID,
        hasSupplier: !!ublContent?.AccountingSupplierParty,
        hasCustomer: !!ublContent?.AccountingCustomerParty,
      });

      // Sign document if v1.1
      let finalDocument: unknown = ublDocument;
      if (documentVersion === "1.1" && signingStatus.canProceed) {
        const signableDoc: SignableDocument = {
          content: ublDocument as unknown as Record<string, unknown>,
          codeNumber: invoice.invoiceNumber,
          format: "JSON",
        };
        const signingOptions: SigningOptions = {
          documentVersion: "1.1",
        };
        const signedResult = signDocumentMiddleware(signableDoc, signingOptions);
        finalDocument = signedResult.content;
      }

      // Determine invoice type based on buyer ID type
      // BRN = B2B (BUYER), NRIC/PASSPORT/ARMY = B2C (PERSONAL)
      const newInvoiceType = buyer.idType === "BRN" ? "BUYER" : "PERSONAL";

      // Update invoice with buyer info and invoice type before submission
      const buyerInfoJson = JSON.stringify(buyerInfo);
      await updateDraftInvoice(invoice.id, {
        buyerInfo: buyerInfoJson,
        invoiceType: newInvoiceType,
      });

      // Update invoice type
      const trackingId = generateTrackingId();

      // Update status to PENDING before submission
      await updateInvoiceStatus(invoice.id, {
        status: "PENDING" as InvoiceStatus,
        trackingId,
      });

      // Get ERP config for submission
      const erpConfig = getErpConfig();

      // Submit to MyInvois
      const result = await submitToMyInvois(
        finalDocument,
        {
          myinvoisClientId: erpConfig.enabled
            ? erpConfig.clientId
            : invoice.company.myinvoisClientId || "",
          myinvoisClientSecret: erpConfig.enabled
            ? erpConfig.clientSecret
            : invoice.company.myinvoisClientSecret || "",
          myinvoisEnv: erpConfig.enabled ? erpConfig.env : invoice.company.myinvoisEnv,
          tin: invoice.company.tin,
        },
        invoice.invoiceNumber
      );

      if (!result.ok) {
        // Update status to INVALID
        await updateInvoiceStatus(invoice.id, {
          status: "INVALID" as InvoiceStatus,
          trackingId,
          errorCode: result.error?.code,
          errorMessage: result.error?.message,
        });

        fastify.log.error({
          msg: "Public invoice submission failed",
          invoiceId,
          error: result.error,
        });

        return reply.status(400).send({
          success: false,
          error: result.error?.message || "Submission failed",
          code: result.error?.code || "SUBMISSION_FAILED",
        });
      }

      // Update status to SUBMITTED
      await updateInvoiceStatus(invoice.id, {
        status: "SUBMITTED" as InvoiceStatus,
        trackingId,
        myinvoisUuid: result.uuid,
      });

      fastify.log.info({
        msg: "Public invoice submitted successfully",
        invoiceId,
        uuid: result.uuid,
        trackingId,
      });

      return reply.status(200).send({
        success: true,
        message: "Invoice submitted successfully",
        status: "SUBMITTED",
      });
    }
  );
}
