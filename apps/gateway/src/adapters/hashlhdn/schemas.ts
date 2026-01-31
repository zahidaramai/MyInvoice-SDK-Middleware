/**
 * HashLHDN Request/Response Schemas (Zod validation)
 * Based on PRD-HASH-001 field mappings
 */

import { z } from "zod";

/**
 * Tax codes as per LHDN specification
 */
export const TaxCodeSchema = z.enum([
  "01", // Sales Tax (SST)
  "02", // Service Tax
  "03", // Tourism Tax
  "04", // High-Value Goods Tax
  "05", // Sales Tax on Low Value Goods
  "06", // Not Applicable
  "E",  // Tax Exemption
]);

/**
 * Malaysian state codes
 */
export const StateCodeSchema = z.enum([
  "01", // Johor
  "02", // Kedah
  "03", // Kelantan
  "04", // Melaka
  "05", // Negeri Sembilan
  "06", // Pahang
  "07", // Pulau Pinang
  "08", // Perak
  "09", // Perlis
  "10", // Selangor
  "11", // Terengganu
  "12", // Sabah
  "13", // Sarawak
  "14", // Wilayah Persekutuan KL
  "15", // Wilayah Persekutuan Labuan
  "16", // Wilayah Persekutuan Putrajaya
  "17", // Not Applicable
]);

/**
 * ID types for buyer identification
 */
export const IdTypeSchema = z.enum([
  "BRN",      // Business Registration Number
  "NRIC",     // National Registration Identity Card
  "PASSPORT", // Passport
  "ARMY",     // Army ID
]);

/**
 * P2-07: Malaysian ID format validation patterns
 * TIN: Letter prefix (C/IG/OG) + digits, 11-14 chars total
 * BRN: Company registration number, typically 12 digits or formatted (e.g., 201701041319)
 * NRIC: 12 digits (e.g., 801025145127)
 */
// TIN pattern: starts with C, IG, or OG followed by digits
export const TinFormatSchema = z.string().regex(
  /^(C|IG|OG)[0-9]{10,13}$/,
  "Invalid TIN format. Must start with C, IG, or OG followed by 10-13 digits"
).or(z.string().regex(/^EI[0-9]{11}$/, "Invalid TIN")); // General public TIN

// BRN pattern: 12 digits or alphanumeric (some old formats)
export const BrnFormatSchema = z.string().regex(
  /^[0-9A-Z]{10,20}$/,
  "Invalid BRN format. Must be 10-20 alphanumeric characters"
);

// NRIC pattern: exactly 12 digits
export const NricFormatSchema = z.string().regex(
  /^[0-9]{12}$/,
  "Invalid NRIC format. Must be exactly 12 digits"
);

// Passport: alphanumeric, 6-20 chars
export const PassportFormatSchema = z.string().regex(
  /^[A-Z0-9]{6,20}$/i,
  "Invalid passport format. Must be 6-20 alphanumeric characters"
);

/**
 * Invoice line item
 * P1-13: Added max length limits to prevent OOM attacks
 * P1-14: Added .finite() to reject Infinity/NaN values
 */
export const InvoiceItemSchema = z.object({
  description: z.string().min(1, "Item description is required").max(500, "Description too long"),
  quantity: z.number().positive("Quantity must be positive").finite("Invalid quantity"),
  unitPrice: z.number().min(0, "Unit price cannot be negative").finite("Invalid unit price"),
  discount: z.number().min(0).finite("Invalid discount").default(0),
  taxCode: TaxCodeSchema,
  taxRate: z.number().min(0).max(100).finite("Invalid tax rate"),
  taxAmount: z.number().min(0).finite("Invalid tax amount"),
  total: z.number().min(0).finite("Invalid total"),
  // Optional fields with length limits
  unitOfMeasure: z.string().max(50).optional(),
  productCode: z.string().max(100).optional(),
  classification: z.string().max(100).optional(),
});

/**
 * Base Buyer schema (for extending)
 * P1-13: Added max length limits to prevent OOM attacks
 */
export const BuyerBaseSchema = z.object({
  name: z.string().min(1, "Buyer name is required").max(300, "Name too long"),
  tin: z.string().max(20).optional(), // TIN for B2B
  idType: IdTypeSchema.optional(),
  idValue: z.string().max(50).optional(), // BRN, NRIC, Passport number
  // Address fields
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: StateCodeSchema.optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(10).default("MYS"),
  // Contact fields
  phone: z.string().max(30).optional(),
  email: z.string().email().max(254).optional(), // RFC 5321 max email length
});

/**
 * P2-07: Buyer validation refinement function
 */
function validateBuyer(data: z.infer<typeof BuyerBaseSchema>, ctx: z.RefinementCtx): void {
  // Validate idValue format based on idType
  if (data.idType && data.idValue) {
    switch (data.idType) {
      case "BRN":
        if (!BrnFormatSchema.safeParse(data.idValue).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid BRN format. Must be 10-20 alphanumeric characters",
            path: ["idValue"],
          });
        }
        break;
      case "NRIC":
        if (!NricFormatSchema.safeParse(data.idValue).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid NRIC format. Must be exactly 12 digits",
            path: ["idValue"],
          });
        }
        break;
      case "PASSPORT":
        if (!PassportFormatSchema.safeParse(data.idValue).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid passport format. Must be 6-20 alphanumeric characters",
            path: ["idValue"],
          });
        }
        break;
      // ARMY - no specific format validation
    }
  }

  // Validate TIN format if provided
  if (data.tin && data.tin.length > 0) {
    const tinResult = TinFormatSchema.safeParse(data.tin);
    if (!tinResult.success && !/^[A-Z0-9]{10,14}$/.test(data.tin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid TIN format",
        path: ["tin"],
      });
    }
  }
}

/**
 * Buyer information with validation (for B2B and B2C invoices)
 */
export const BuyerSchema = BuyerBaseSchema.superRefine(validateBuyer);

/**
 * Base Invoice schema (for extending)
 * P1-13: Added max length limits
 * P1-14: Added .finite() to reject Infinity/NaN
 * P1-15: Added max array bounds to prevent OOM
 */
export const InvoiceBaseSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice number is required").max(100, "Invoice number too long"),
  invoiceDate: z.string().datetime({ message: "Invalid date format, use ISO 8601" }),
  // Amounts (stored as numbers, converted to string for precision)
  amount: z.number().min(0, "Amount cannot be negative").finite("Invalid amount"),
  discount: z.number().min(0).finite("Invalid discount").default(0),
  rounding: z.number().finite("Invalid rounding").default(0),
  taxAmount: z.number().min(0).finite("Invalid tax amount"),
  total: z.number().min(0).finite("Invalid total"),
  // Optional reference
  reference: z.string().max(200).optional(),
  // Buyer info (optional for consolidated, required for buyer/personal)
  buyer: BuyerBaseSchema.optional(),
  // Line items (P1-15: max 100 items per invoice)
  items: z.array(InvoiceItemSchema).min(1, "At least one item is required").max(100, "Maximum 100 items per invoice"),
  // Currency (default MYR)
  currency: z.string().max(10).default("MYR"),
  // Payment type (optional)
  paymentType: z.string().max(50).optional(),
});

/**
 * P2-08: Invoice validation refinement function
 */
function validateInvoice(data: z.infer<typeof InvoiceBaseSchema>, ctx: z.RefinementCtx): void {
  // Cross-field validation - verify total calculation
  // Formula: total = amount - discount + taxAmount + rounding
  const expectedTotal = data.amount - data.discount + data.taxAmount + data.rounding;
  // Allow 0.01 tolerance for floating point precision
  const tolerance = 0.01;
  if (Math.abs(data.total - expectedTotal) > tolerance) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total mismatch: expected ${expectedTotal.toFixed(2)} (amount ${data.amount} - discount ${data.discount} + tax ${data.taxAmount} + rounding ${data.rounding}), got ${data.total}`,
      path: ["total"],
    });
  }

  // Also validate buyer if present
  if (data.buyer) {
    validateBuyer(data.buyer, ctx);
  }
}

/**
 * Single invoice in a submission with validation
 */
export const InvoiceSchema = InvoiceBaseSchema.superRefine(validateInvoice);

/**
 * Submit Consolidate request - multiple invoices combined into one e-invoice
 * P1-15: Added max invoices bound to prevent OOM
 */
export const SubmitConsolidateSchema = z.object({
  companyId: z.string().min(1, "Company ID is required").max(100),
  invoices: z.array(InvoiceSchema).min(1, "At least one invoice is required").max(100, "Maximum 100 invoices per submission"),
  // Document version (1.0 or 1.1) - default to 1.0 (unsigned)
  documentVersion: z.enum(["1.0", "1.1"]).default("1.0"),
  // Optional buyer email for consolidated invoices (for notification purposes)
  buyerEmail: z.string().email().max(254).optional(),
});

/**
 * Submit JustSave request - save without LHDN submission
 */
export const SubmitJustSaveSchema = z.object({
  companyId: z.string().min(1, "Company ID is required"),
  invoice: InvoiceSchema,
});

/**
 * Submit Buyer request - B2B invoice with TIN + BRN
 * Uses base schemas for extension, then applies validation
 */
export const SubmitBuyerSchema = z.object({
  companyId: z.string().min(1, "Company ID is required"),
  invoice: InvoiceBaseSchema.extend({
    buyer: BuyerBaseSchema.extend({
      tin: z.string().min(1, "Buyer TIN is required for B2B invoice"),
      idType: z.literal("BRN"),
      idValue: z.string().min(1, "Buyer BRN is required for B2B invoice"),
    }),
  }).superRefine(validateInvoice),
  // Document version (1.0 or 1.1) - default to 1.0 (unsigned)
  documentVersion: z.enum(["1.0", "1.1"]).default("1.0"),
});

/**
 * Submit Personal request - B2C invoice with NRIC
 * Uses base schemas for extension, then applies validation
 */
export const SubmitPersonalSchema = z.object({
  companyId: z.string().min(1, "Company ID is required"),
  invoice: InvoiceBaseSchema.extend({
    buyer: BuyerBaseSchema.extend({
      idType: z.literal("NRIC"),
      idValue: z.string().min(1, "Buyer NRIC is required for personal invoice"),
    }),
  }).superRefine(validateInvoice),
  // Document version (1.0 or 1.1) - default to 1.0 (unsigned)
  documentVersion: z.enum(["1.0", "1.1"]).default("1.0"),
});

// Export inferred types
export type TaxCode = z.infer<typeof TaxCodeSchema>;
export type StateCode = z.infer<typeof StateCodeSchema>;
export type IdType = z.infer<typeof IdTypeSchema>;
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;
export type Buyer = z.infer<typeof BuyerSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type SubmitConsolidateRequest = z.infer<typeof SubmitConsolidateSchema>;
export type SubmitJustSaveRequest = z.infer<typeof SubmitJustSaveSchema>;
export type SubmitBuyerRequest = z.infer<typeof SubmitBuyerSchema>;
export type SubmitPersonalRequest = z.infer<typeof SubmitPersonalSchema>;

// ============================================================================
// LEGACY/ORIGINAL FORMAT SCHEMAS
// Accepts both PascalCase (client's original) and camelCase (internal) fields
// ============================================================================

/**
 * Flexible customer/buyer schema that accepts both PascalCase and camelCase
 * Client's original format uses `customer` with PascalCase fields
 * P1-13: Added max length limits to prevent OOM attacks
 * Note: .passthrough() kept for backwards compatibility with client's original format
 */
export const FlexibleCustomerSchema = z.object({
  // PascalCase (client's original format)
  Tin: z.string().max(20).optional(),
  Name: z.string().max(300).optional(),
  Address1: z.string().max(500).optional(),
  PostalCode: z.string().max(20).optional(),
  City: z.string().max(100).optional(),
  StateCode: z.string().max(10).optional(),
  Telephone: z.string().max(30).optional(),
  Email: z.string().email().max(254).optional(),
  IdType: z.string().max(20).optional(),
  IdValue: z.string().max(50).optional(),
  // camelCase (our internal format - also accepted)
  tin: z.string().max(20).optional(),
  name: z.string().max(300).optional(),
  address1: z.string().max(500).optional(),
  address: z.string().max(500).optional(),
  postalCode: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  stateCode: z.string().max(10).optional(),
  state: z.string().max(10).optional(),
  telephone: z.string().max(30).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(254).optional(),
  idType: z.string().max(20).optional(),
  idValue: z.string().max(50).optional(),
  // Client's special fields for personal invoices
  customerIcNo: z.string().max(20).optional(),
}).passthrough(); // Allow unknown fields for backwards compatibility

/**
 * Flexible invoice item schema
 * P1-13: Added max length limits
 * P1-14: Added .finite() to reject Infinity/NaN
 * P2-16: Aligned validation constraints with InvoiceItemSchema
 */
export const FlexibleItemSchema = z.object({
  // P2-16: description has min requirement matching InvoiceItemSchema
  description: z.string().min(1, "Item description is required").max(500, "Description too long"),
  // P2-16: Added positive constraint for quantity, min(0) for prices
  quantity: z.number().positive("Quantity must be positive").finite("Invalid quantity").default(1),
  unitPrice: z.number().min(0, "Unit price cannot be negative").finite("Invalid unit price").default(0),
  discount: z.number().min(0).finite("Invalid discount").default(0),
  taxCode: z.string().max(10).default("06"),
  taxRate: z.number().min(0).max(100).finite("Invalid tax rate").default(0),
  taxAmount: z.number().min(0).finite("Invalid tax amount").default(0),
  total: z.number().min(0).finite("Invalid total").default(0),
  unitOfMeasure: z.string().max(50).optional(),
  productCode: z.string().max(100).optional(),
  classification: z.string().max(100).optional(),
}).passthrough(); // Allow unknown fields for backwards compatibility

/**
 * Flexible invoice schema that accepts both customer and buyer
 * P1-13: Added max length limits
 * P1-14: Added .finite() to reject Infinity/NaN
 * P1-15: Added max array bounds
 */
/**
 * P2-10: Custom date validation that accepts multiple formats but validates strictly
 * Accepts: ISO 8601 with/without timezone, YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss
 */
const flexibleDateSchema = z.string().max(50).refine(
  (val) => {
    if (!val) return true; // Optional, let the outer schema handle required
    const date = new Date(val);
    // Must be a valid date and not in the far future (prevent typos like 2099)
    return !isNaN(date.getTime()) && date.getFullYear() <= new Date().getFullYear() + 1;
  },
  { message: "Invalid date format. Use ISO 8601 format (e.g., 2026-01-28T12:00:00+08:00)" }
);

export const FlexibleInvoiceSchema = z.object({
  invoiceNumber: z.string().max(100),
  // P2-10: Added strict date validation with refine
  invoiceDate: flexibleDateSchema,
  amount: z.number().finite(),
  discount: z.number().finite().optional(),
  rounding: z.number().finite().optional(),
  taxAmount: z.number().finite(),
  total: z.number().finite(),
  reference: z.string().max(200).optional(),
  currency: z.string().max(10).optional(),
  // Accept both customer (client's original) and buyer (internal)
  customer: FlexibleCustomerSchema.optional(),
  buyer: FlexibleCustomerSchema.optional(),
  items: z.array(FlexibleItemSchema).max(100, "Maximum 100 items per invoice"),
}).passthrough(); // Allow unknown fields for backwards compatibility

/**
 * Original submit schema - unified endpoint that accepts flags
 * This is the client's original format with:
 * - CompanyId (PascalCase)
 * - ConsolidatedInvoice / SaveInvoice flags
 * - invoices array (always)
 * - customer object (not buyer)
 * P1-13/P1-15: Added length limits and array bounds
 */
export const OriginalSubmitSchema = z.object({
  // Company ID (accept both cases)
  CompanyId: z.string().max(100).optional(),
  companyId: z.string().max(100).optional(),
  // Flags for routing
  ConsolidatedInvoice: z.boolean().optional(),
  consolidatedInvoice: z.boolean().optional(),
  SaveInvoice: z.boolean().optional(),
  saveInvoice: z.boolean().optional(),
  // Document version
  documentVersion: z.enum(["1.0", "1.1"]).optional(),
  // Invoices array (P1-15: max 100 invoices)
  invoices: z.array(FlexibleInvoiceSchema).min(1, "At least one invoice is required").max(100, "Maximum 100 invoices per submission"),
  // Optional buyer email for consolidated
  buyerEmail: z.string().email().max(254).optional(),
}).refine(
  (data) => data.CompanyId || data.companyId,
  { message: "Company ID is required (CompanyId or companyId)" }
);

export type OriginalSubmitRequest = z.infer<typeof OriginalSubmitSchema>;

/**
 * Submission response
 */
export interface SubmissionResponse {
  trackingId: string;
  invoiceId: string;
  invoiceNumber: string;
  posInvoiceId: string;
  status: string;
  message: string;
  submittedAt?: string;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
