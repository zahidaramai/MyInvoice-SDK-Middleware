/**
 * Public API Schemas
 * Zod schemas for public e-invoice registration endpoints
 */

import { z } from "zod";

/**
 * State codes for Malaysia
 */
export const StateCodeSchema = z.enum([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17",
]);

/**
 * ID types for buyer identification
 */
export const IdTypeSchema = z.enum(["NRIC", "PASSPORT", "BRN", "ARMY"]);

/**
 * Nationality enum
 */
export const NationalitySchema = z.enum(["MALAYSIAN", "FOREIGNER"]);

/**
 * Public buyer submission schema
 * Used when customer fills out the registration form
 */
export const PublicBuyerSubmitSchema = z.object({
  nationality: NationalitySchema,
  idType: IdTypeSchema,
  idValue: z.string().min(1, "Identification number is required"),
  tin: z.string().optional().default(""), // Optional TIN for tax purposes
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address1: z.string().min(1, "Address is required"),
  address2: z.string().optional().default(""),
  address3: z.string().optional().default(""),
  postalCode: z.string().min(1, "Postal code is required"),
  city: z.string().min(1, "City is required"),
  state: StateCodeSchema,
  country: z.string().default("MYS"),
  sstRegNo: z.string().optional().default(""),
});

/**
 * Public invoice submit request
 */
export const PublicInvoiceSubmitSchema = z.object({
  buyer: PublicBuyerSubmitSchema,
});

/**
 * Public invoice item (for display)
 */
export const PublicInvoiceItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  taxCode: z.string(),
  taxRate: z.number(),
  taxAmount: z.number(),
  total: z.number(),
});

/**
 * P2-09: Schema for validating parsed raw payload from database
 * Used to safely parse JSON.parse results
 */
export const RawPayloadItemSchema = z.object({
  description: z.string().optional().default("Item"),
  quantity: z.number().optional().default(1),
  unitPrice: z.number().optional().default(0),
  discount: z.number().optional().default(0),
  taxCode: z.string().optional().default("02"),
  taxRate: z.number().optional().default(0),
  taxAmount: z.number().optional().default(0),
  total: z.number().optional().default(0),
}).passthrough();

export const RawPayloadInvoiceSchema = z.object({
  items: z.array(RawPayloadItemSchema).optional(),
  paymentType: z.string().optional(),
  invoiceDate: z.string().optional(),
}).passthrough();

export const RawPayloadSchema = z.object({
  items: z.array(RawPayloadItemSchema).optional(),
  invoices: z.array(RawPayloadInvoiceSchema).optional(),
  invoice: RawPayloadInvoiceSchema.optional(), // Format 3: singular invoice object
  paymentType: z.string().optional(),
  invoiceDate: z.string().optional(),
}).passthrough();

/**
 * TypeScript types
 */
export type StateCode = z.infer<typeof StateCodeSchema>;
export type IdType = z.infer<typeof IdTypeSchema>;
export type Nationality = z.infer<typeof NationalitySchema>;
export type PublicBuyerSubmit = z.infer<typeof PublicBuyerSubmitSchema>;
export type PublicInvoiceSubmit = z.infer<typeof PublicInvoiceSubmitSchema>;
export type PublicInvoiceItem = z.infer<typeof PublicInvoiceItemSchema>;
export type RawPayloadItem = z.infer<typeof RawPayloadItemSchema>;
export type RawPayloadInvoice = z.infer<typeof RawPayloadInvoiceSchema>;
export type RawPayload = z.infer<typeof RawPayloadSchema>;
