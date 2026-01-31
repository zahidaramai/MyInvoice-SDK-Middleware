/**
 * POS Adapter Routes
 * Endpoints for POS system integration
 * Accepts client's existing JSON format (same as consolidated invoice)
 */

import type { FastifyInstance } from "fastify";
import { CreatePosInvoiceSchema, type CreatePosInvoiceRequest } from "./schemas.js";
import { findCompanyById, createInvoice, findInvoiceByNumber } from "@myinvois/storage";
import { authenticate, requirePermission } from "../../auth/middleware.js";

/**
 * Generate POS invoice ID from company name
 * Format: {prefix}-{8-char-random}
 * Example: HM-12ys8Uy4
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
 * Get QR URL for a POS invoice ID
 */
function getQrUrl(posInvoiceId: string): string {
  const baseUrl = process.env.PUBLIC_URL || "https://www.duitlhdn.com";
  return `${baseUrl}/e/${posInvoiceId}`;
}

/**
 * Calculate expiry date (24 hours from now)
 */
function getExpiresAt(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 24);
  return date;
}

/**
 * Generate tracking ID for invoice
 * Format: HASH-{timestamp}-{random}
 */
function generateTrackingId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `HASH-${timestamp}-${random}`;
}

/**
 * POS routes - for POS system integration
 */
export async function posRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/pos/invoice
   * Create a draft invoice from POS sale
   *
   * Accepts client's format:
   * {
   *   "CompanyId": "uuid",
   *   "ConsolidatedInvoice": true,
   *   "invoices": [{
   *     "invoiceNumber": "CONSO-001",
   *     "amount": 33.00,
   *     "discount": 0.0,
   *     "rounding": 0.0,
   *     "taxAmount": 2.64,
   *     "total": 35.64,
   *     "reference": "optional-ref",
   *     "invoiceDate": "2026-01-26T12:47:15+08:00",
   *     "items": [...]
   *   }]
   * }
   *
   * Returns:
   * {
   *   "success": true,
   *   "invoiceId": "HM-12ys8Uy4",
   *   "qrUrl": "https://www.duitlhdn.com/e/HM-12ys8Uy4",
   *   "expiresAt": "2026-01-27T12:47:15.000Z"
   * }
   */
  fastify.post<{ Body: CreatePosInvoiceRequest }>(
    "/invoice",
    {
      preHandler: [authenticate, requirePermission("submit:invoice")],
    },
    async (request, reply) => {
      // Validate request body
      const parseResult = CreatePosInvoiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid request body",
          code: "VALIDATION_ERROR",
        });
      }

      const body = parseResult.data;

      // Normalize company ID (accept both CompanyId and companyId)
      const companyId = body.CompanyId || body.companyId;
      if (!companyId) {
        return reply.status(400).send({
          success: false,
          error: "Company ID is required",
          code: "VALIDATION_ERROR",
        });
      }

      // Get first invoice from array (POS typically sends one at a time)
      const invoiceData = body.invoices[0];
      if (!invoiceData) {
        return reply.status(400).send({
          success: false,
          error: "At least one invoice is required",
          code: "VALIDATION_ERROR",
        });
      }

      // Find company
      const company = await findCompanyById(companyId);
      if (!company) {
        return reply.status(404).send({
          success: false,
          error: "Company not found",
          code: "COMPANY_NOT_FOUND",
        });
      }

      if (!company.isActive) {
        return reply.status(403).send({
          success: false,
          error: "Company is not active",
          code: "COMPANY_INACTIVE",
        });
      }

      // Check for duplicate invoice number
      const existingInvoice = await findInvoiceByNumber(companyId, invoiceData.invoiceNumber);
      if (existingInvoice) {
        return reply.status(409).send({
          success: false,
          error: `Invoice number ${invoiceData.invoiceNumber} already exists`,
          code: "DUPLICATE_INVOICE_NUMBER",
        });
      }

      // P1-05: Generate POS invoice ID with atomic retry on unique constraint violation
      // Previous check-then-insert pattern had race condition
      let posInvoiceId = generatePosInvoiceId(company.name);

      // Parse invoice date
      // If POS sends date without timezone, assume Malaysia time (UTC+8)
      // This prevents the "future date" error when server runs in UTC
      let invoiceDate: Date;
      if (invoiceData.invoiceDate) {
        const dateStr = invoiceData.invoiceDate;
        // Check if timezone is specified (contains + or Z at the end)
        if (dateStr.includes("+") || dateStr.includes("-", 10) || dateStr.endsWith("Z")) {
          invoiceDate = new Date(dateStr);
        } else {
          // No timezone - assume Malaysia time (append +08:00)
          invoiceDate = new Date(dateStr + "+08:00");
        }
      } else {
        invoiceDate = new Date();
      }

      // Build raw payload for storage (store full invoice data)
      const rawPayload = JSON.stringify({
        invoiceNumber: invoiceData.invoiceNumber,
        invoiceDate: invoiceDate.toISOString(),
        items: invoiceData.items,
        amount: invoiceData.amount,
        discount: invoiceData.discount ?? 0,
        rounding: invoiceData.rounding ?? 0,
        taxAmount: invoiceData.taxAmount,
        total: invoiceData.total,
        reference: invoiceData.reference,
        paymentType: invoiceData.paymentType,
        // Store original flags for reference
        consolidatedInvoice: body.ConsolidatedInvoice ?? true,
      });

      // Generate tracking ID for UI compatibility
      const trackingId = generateTrackingId();

      // P1-05: Create invoice with atomic retry on unique constraint violation
      // Previous check-then-insert pattern had race condition
      const MAX_POS_ID_RETRIES = 5;
      let invoice;
      for (let attempt = 0; attempt < MAX_POS_ID_RETRIES; attempt++) {
        try {
          // Create invoice as DRAFT with CONSOLIDATE type (default)
          // Customer can later register via QR URL to change to PERSONAL (NRIC) or BUYER (BRN)
          // If not registered, company user can manually submit as CONSOLIDATE (General Public TIN)
          invoice = await createInvoice({
            companyId,
            invoiceNumber: invoiceData.invoiceNumber,
            invoiceDate,
            invoiceType: "CONSOLIDATE", // Default - will be updated if customer registers via QR
            status: "DRAFT",
            rawPayload,
            posInvoiceId,
            trackingId, // Required for UI to view/edit invoice
            amount: invoiceData.amount.toString(),
            discount: (invoiceData.discount ?? 0).toString(),
            rounding: (invoiceData.rounding ?? 0).toString(),
            taxAmount: invoiceData.taxAmount.toString(),
            total: invoiceData.total.toString(),
            createdBy: request.user?.userId,
          });
          break; // Success, exit retry loop
        } catch (err) {
          // P1-05: Check for unique constraint violation on posInvoiceId
          const isPosIdCollision =
            err instanceof Error &&
            err.message.includes("Unique constraint") &&
            err.message.includes("posInvoiceId");

          if (isPosIdCollision && attempt < MAX_POS_ID_RETRIES - 1) {
            // Regenerate POS ID and retry
            posInvoiceId = generatePosInvoiceId(company.name);
            continue;
          }
          throw err; // Re-throw non-collision errors or if max retries exceeded
        }
      }

      if (!invoice) {
        return reply.status(500).send({
          success: false,
          error: "Failed to generate unique invoice ID",
          code: "ID_GENERATION_ERROR",
        });
      }

      const expiresAt = getExpiresAt();
      const qrUrl = getQrUrl(posInvoiceId);

      fastify.log.info({
        msg: "POS invoice created",
        invoiceId: invoice.id,
        posInvoiceId,
        trackingId,
        companyId,
        invoiceNumber: invoiceData.invoiceNumber,
        reference: invoiceData.reference,
      });

      return reply.status(201).send({
        success: true,
        invoiceId: posInvoiceId,
        qrUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }
  );
}
