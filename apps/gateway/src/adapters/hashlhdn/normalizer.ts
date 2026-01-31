/**
 * Request Normalizer for Client's Original Postman Format
 *
 * Converts the client's original format (PascalCase, customer object, flags)
 * to the internal HashLHDN format (camelCase, buyer object, typed endpoints)
 */

import type { Buyer, Invoice, InvoiceItem, IdType, TaxCode, StateCode } from "./schemas.js";
import { IdTypeSchema, TaxCodeSchema, StateCodeSchema } from "./schemas.js";

/**
 * P2-18: Safe enum parsing with fallback
 * Returns undefined if value doesn't match enum, instead of throwing
 */
function safeParseIdType(value: string | undefined): IdType | undefined {
  if (!value) return undefined;
  const result = IdTypeSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function safeParseStateCode(value: string | undefined): StateCode | undefined {
  if (!value) return undefined;
  const result = StateCodeSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function safeParseTaxCode(value: string | undefined, defaultValue: TaxCode = "06"): TaxCode {
  if (!value) return defaultValue;
  const result = TaxCodeSchema.safeParse(value);
  return result.success ? result.data : defaultValue;
}

/**
 * Invoice type detection result
 */
export type InvoiceType = "consolidate" | "justsave" | "buyer" | "personal";

/**
 * Original customer object format (client's format)
 */
export interface OriginalCustomer {
  // PascalCase fields
  Tin?: string;
  Name?: string;
  Address1?: string;
  PostalCode?: string;
  City?: string;
  StateCode?: string;
  Telephone?: string;
  Email?: string;
  IdType?: string;
  IdValue?: string;
  // camelCase fields (also accepted)
  tin?: string;
  name?: string;
  address1?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  stateCode?: string;
  state?: string;
  telephone?: string;
  phone?: string;
  email?: string;
  idType?: string;
  idValue?: string;
  // Client's special fields
  customerIcNo?: string; // Duplicate IC field for personal invoices
}

/**
 * Original invoice item format
 */
export interface OriginalItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  taxCode?: string;
  taxRate?: number;
  taxAmount?: number;
  total?: number;
  unitOfMeasure?: string;
  productCode?: string;
  classification?: string;
}

/**
 * Original invoice format (client's format)
 */
export interface OriginalInvoice {
  invoiceNumber: string;
  invoiceDate?: string;
  amount: number;
  discount?: number;
  rounding?: number;
  taxAmount: number;
  total: number;
  reference?: string;
  currency?: string;
  // Customer (client's original field name)
  customer?: OriginalCustomer;
  // Buyer (our internal field name - also accepted)
  buyer?: OriginalCustomer;
  items: OriginalItem[];
}

/**
 * Original request format (client's format)
 */
export interface OriginalRequest {
  // Company ID (accept both cases)
  CompanyId?: string;
  companyId?: string;
  // Flags for routing
  ConsolidatedInvoice?: boolean;
  consolidatedInvoice?: boolean;
  SaveInvoice?: boolean;
  saveInvoice?: boolean;
  // Document version
  documentVersion?: "1.0" | "1.1";
  // Invoices array
  invoices: OriginalInvoice[];
  // Optional buyer email for consolidated
  buyerEmail?: string;
}

/**
 * Normalized request result
 */
export interface NormalizedRequest {
  type: InvoiceType;
  companyId: string;
  documentVersion: "1.0" | "1.1";
  invoices: Invoice[];
  buyerEmail?: string;
}

/**
 * Normalize customer object to buyer object
 * Handles PascalCase to camelCase conversion and field mapping
 */
export function normalizeCustomerToBuyer(customer: OriginalCustomer): Buyer {
  // Get idValue with priority: idValue → customerIcNo → tin (for NRIC cases)
  const idType = customer.IdType || customer.idType;
  let idValue = customer.IdValue || customer.idValue;

  // For NRIC, fallback to customerIcNo if idValue is missing
  if (idType === "NRIC" && !idValue) {
    idValue = customer.customerIcNo;
  }

  // P2-18: Use safe enum parsing instead of type assertions
  return {
    name: customer.Name || customer.name || "",
    tin: customer.Tin || customer.tin,
    idType: safeParseIdType(customer.IdType || customer.idType),
    idValue,
    address: customer.Address1 || customer.address1 || customer.address,
    city: customer.City || customer.city,
    state: safeParseStateCode(customer.StateCode || customer.stateCode || customer.state),
    postalCode: customer.PostalCode || customer.postalCode,
    country: "MYS",
    phone: customer.Telephone || customer.telephone || customer.phone,
    email: customer.Email || customer.email,
  };
}

/**
 * Normalize invoice item
 * P2-18: Use safe enum parsing for taxCode
 */
export function normalizeItem(item: OriginalItem): InvoiceItem {
  return {
    description: item.description || "",
    quantity: item.quantity || 1,
    unitPrice: item.unitPrice || 0,
    discount: item.discount ?? 0,
    taxCode: safeParseTaxCode(item.taxCode, "06"),
    taxRate: item.taxRate ?? 0,
    taxAmount: item.taxAmount ?? 0,
    total: item.total ?? 0,
    unitOfMeasure: item.unitOfMeasure,
    productCode: item.productCode,
    classification: item.classification,
  };
}

/**
 * P2-10: Validate and normalize date string
 * Rejects invalid dates instead of falling back to server time
 */
function validateAndNormalizeDate(dateStr: string | undefined, fieldName: string): string {
  if (!dateStr) {
    throw new Error(`${fieldName} is required`);
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} format. Use ISO 8601 format (e.g., 2026-01-28T12:00:00+08:00)`);
  }

  // Prevent dates too far in the future (typos like 2099)
  const maxYear = new Date().getFullYear() + 1;
  if (date.getFullYear() > maxYear) {
    throw new Error(`${fieldName} cannot be more than 1 year in the future`);
  }

  return date.toISOString();
}

/**
 * Normalize invoice object
 * P2-10: Now validates dates strictly instead of falling back to server time
 */
export function normalizeInvoice(original: OriginalInvoice): Invoice {
  const customer = original.customer || original.buyer;

  return {
    invoiceNumber: original.invoiceNumber,
    invoiceDate: validateAndNormalizeDate(original.invoiceDate, "invoiceDate"),
    amount: original.amount,
    discount: original.discount ?? 0,
    rounding: original.rounding ?? 0,
    taxAmount: original.taxAmount,
    total: original.total,
    reference: original.reference,
    currency: original.currency || "MYR",
    buyer: customer ? normalizeCustomerToBuyer(customer) : undefined,
    items: (original.items || []).map(normalizeItem),
  };
}

/**
 * Detect invoice type from request flags and customer data
 *
 * Priority:
 * 1. ConsolidatedInvoice flag → consolidate
 * 2. SaveInvoice flag → justsave
 * 3. No customer → consolidate (anonymous B2C daily sales)
 * 4. IdType = NRIC → personal
 * 5. IdType = BRN → buyer
 * 6. Unknown → consolidate (safe default)
 */
export function detectInvoiceType(request: OriginalRequest): InvoiceType {
  // Check for explicit consolidation flag
  if (request.ConsolidatedInvoice || request.consolidatedInvoice) {
    return "consolidate";
  }

  // Check for just-save flag
  if (request.SaveInvoice || request.saveInvoice) {
    return "justsave";
  }

  // Get customer from first invoice
  const invoice = request.invoices?.[0];
  const customer = invoice?.customer || invoice?.buyer;

  // No customer at all = consolidated anonymous B2C daily sales
  if (!customer) {
    return "consolidate";
  }

  // Get ID type (accept both cases)
  const idType = customer.IdType || customer.idType;

  // Check for NRIC (personal/B2C)
  if (idType === "NRIC") {
    return "personal";
  }

  // Check for BRN (buyer/B2B)
  if (idType === "BRN") {
    return "buyer";
  }

  // Default to consolidate for anonymous/unknown buyer types
  return "consolidate";
}

/**
 * Normalize the entire request from client's format to internal format
 */
export function normalizeRequest(original: OriginalRequest): NormalizedRequest {
  const type = detectInvoiceType(original);
  const companyId = original.CompanyId || original.companyId || "";
  const documentVersion = original.documentVersion || "1.1";
  const invoices = (original.invoices || []).map(normalizeInvoice);

  return {
    type,
    companyId,
    documentVersion,
    invoices,
    buyerEmail: original.buyerEmail,
  };
}

/**
 * Validate that required fields are present after normalization
 */
export function validateNormalizedRequest(normalized: NormalizedRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Company ID is required
  if (!normalized.companyId) {
    errors.push("Company ID is required (CompanyId or companyId)");
  }

  // At least one invoice is required
  if (!normalized.invoices || normalized.invoices.length === 0) {
    errors.push("At least one invoice is required");
  }

  // Validate each invoice
  normalized.invoices.forEach((invoice, index) => {
    if (!invoice.invoiceNumber) {
      errors.push(`Invoice ${index + 1}: invoiceNumber is required`);
    }
    if (!invoice.items || invoice.items.length === 0) {
      errors.push(`Invoice ${index + 1}: at least one item is required`);
    }

    // For buyer type, validate buyer fields
    if (normalized.type === "buyer" && invoice.buyer) {
      if (!invoice.buyer.tin) {
        errors.push(`Invoice ${index + 1}: buyer.tin is required for B2B invoice`);
      }
      if (invoice.buyer.idType !== "BRN") {
        errors.push(`Invoice ${index + 1}: buyer.idType must be BRN for B2B invoice`);
      }
      if (!invoice.buyer.idValue) {
        errors.push(`Invoice ${index + 1}: buyer.idValue (BRN) is required for B2B invoice`);
      }
    }

    // For personal type, validate buyer fields
    if (normalized.type === "personal" && invoice.buyer) {
      if (invoice.buyer.idType !== "NRIC") {
        errors.push(`Invoice ${index + 1}: buyer.idType must be NRIC for personal invoice`);
      }
      if (!invoice.buyer.idValue) {
        errors.push(`Invoice ${index + 1}: buyer.idValue (NRIC) is required for personal invoice`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
