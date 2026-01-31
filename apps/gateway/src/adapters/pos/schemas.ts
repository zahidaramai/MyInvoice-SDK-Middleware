/**
 * POS Adapter Schemas
 * Zod schemas for POS invoice API
 * Accepts client's existing JSON format (same as consolidated invoice)
 */

import { z } from "zod";

/**
 * POS item schema (client format)
 */
export const PosItemSchema = z.object({
  description: z.string().min(1, "Item description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().min(0, "Unit price cannot be negative"),
  discount: z.number().min(0).optional().default(0),
  taxCode: z.string().min(1, "Tax code is required"),
  taxRate: z.number().min(0, "Tax rate cannot be negative"),
  taxAmount: z.number().min(0, "Tax amount cannot be negative"),
  total: z.number().min(0, "Item total cannot be negative"),
});

/**
 * Single invoice in the invoices array
 */
export const PosInvoiceItemSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().optional(),
  amount: z.number().min(0, "Amount cannot be negative"),
  discount: z.number().min(0).optional().default(0),
  rounding: z.number().optional().default(0),
  taxAmount: z.number().min(0, "Tax amount cannot be negative"),
  total: z.number().min(0, "Total cannot be negative"),
  reference: z.string().optional(),
  paymentType: z.string().optional(), // e.g., "MYDEBIT", "CASH", "CREDIT"
  items: z.array(PosItemSchema).min(1, "At least one item is required"),
});

/**
 * POS invoice creation request (client's format)
 * Uses PascalCase CompanyId and invoices array
 */
export const CreatePosInvoiceSchema = z
  .object({
    // Accept both CompanyId (client) and companyId (normalized)
    CompanyId: z.string().uuid("Invalid company ID").optional(),
    companyId: z.string().uuid("Invalid company ID").optional(),
    // Client's flags
    ConsolidatedInvoice: z.boolean().optional(),
    SaveInvoice: z.boolean().optional(),
    // Invoices array
    invoices: z.array(PosInvoiceItemSchema).min(1, "At least one invoice is required"),
  })
  .refine((data) => data.CompanyId || data.companyId, {
    message: "Company ID is required (CompanyId or companyId)",
  });

/**
 * POS invoice response
 */
export const PosInvoiceResponseSchema = z.object({
  success: z.literal(true),
  invoiceId: z.string(),
  qrUrl: z.string(),
  expiresAt: z.string().datetime(),
});

/**
 * TypeScript types
 */
export type PosItem = z.infer<typeof PosItemSchema>;
export type PosInvoiceItem = z.infer<typeof PosInvoiceItemSchema>;
export type CreatePosInvoiceRequest = z.infer<typeof CreatePosInvoiceSchema>;
export type PosInvoiceResponse = z.infer<typeof PosInvoiceResponseSchema>;
