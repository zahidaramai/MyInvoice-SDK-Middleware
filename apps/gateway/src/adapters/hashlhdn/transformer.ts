/**
 * HashLHDN to UBL 2.1 Transformer
 * Converts simplified HashLHDN JSON format to MyInvois UBL 2.1 JSON
 */

import type {
  UBLJsonInvoiceV1_0,
  UBLJsonInvoiceV1_1,
  UBLJsonInvoiceContentV1_0,
  UBLJsonInvoiceLine,
  UBLJsonTaxTotal,
  UBLJsonTaxSubtotal,
  UBLJsonParty,
  UBLJsonPostalAddress,
  UBLJsonAccountingSupplierParty,
  UBLJsonAccountingCustomerParty,
} from "@myinvois/myinvois-client";
import type {
  CurrencyCode,
  MalaysianStateCode,
  TaxTypeCode,
  PartyIdScheme,
} from "@myinvois/myinvois-client";
import type { Invoice, InvoiceItem, Buyer, TaxCode, StateCode, IdType } from "./schemas.js";

/**
 * Company information from database
 */
export interface CompanyInfo {
  tin: string;
  idValue: string;
  idType: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  sstRegistration?: string;
  ttxRegistration?: string;
  industryCode?: string;
  industryName?: string;
}

/**
 * Map HashLHDN tax codes to MyInvois tax type codes
 */
function mapTaxCode(taxCode: TaxCode): TaxTypeCode {
  const taxCodeMap: Record<TaxCode, TaxTypeCode> = {
    "01": "01", // Sales Tax
    "02": "02", // Service Tax
    "03": "03", // Tourism Tax
    "04": "04", // High-Value Goods Tax
    "05": "05", // Sales Tax on Low Value Goods
    "06": "06", // Not Applicable
    E: "E", // Tax Exemption
  };
  return taxCodeMap[taxCode];
}

/**
 * Map HashLHDN state codes to Malaysian state codes
 */
function mapStateCode(stateCode: StateCode | undefined): MalaysianStateCode {
  if (!stateCode) return "17"; // Not Applicable
  return stateCode as MalaysianStateCode;
}

/**
 * Normalize phone number to MyInvois format
 * MyInvois requires phone numbers in format: +60XXXXXXXXX (no dashes, spaces, or special chars)
 *
 * Handles various input formats:
 * - 03-9999-8888 → +60399998888
 * - 012-345 6789 → +60123456789
 * - +60123456789 → +60123456789 (already valid)
 * - 60123456789 → +60123456789
 * - Empty/invalid → +60000000000 (placeholder)
 */
function normalizePhoneNumber(phone: string | undefined | null): string {
  const PLACEHOLDER = "+60000000000";

  if (!phone || phone.trim() === "" || phone.toLowerCase() === "na") {
    return PLACEHOLDER;
  }

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // If starts with +, keep it; otherwise remove any + in the middle
  if (cleaned.startsWith("+")) {
    cleaned = "+" + cleaned.slice(1).replace(/\+/g, "");
  } else {
    cleaned = cleaned.replace(/\+/g, "");
  }

  // Handle different formats
  if (cleaned.startsWith("+60")) {
    // Already has +60 prefix
    return cleaned;
  } else if (cleaned.startsWith("60")) {
    // Has 60 but missing +
    return "+" + cleaned;
  } else if (cleaned.startsWith("0")) {
    // Malaysian format starting with 0 (e.g., 03, 012)
    return "+60" + cleaned.slice(1);
  } else if (cleaned.length >= 8) {
    // Assume it's a local number without prefix
    return "+60" + cleaned;
  }

  // If result is too short or invalid, use placeholder
  if (cleaned.replace(/\D/g, "").length < 8) {
    return PLACEHOLDER;
  }

  return cleaned;
}

/**
 * Map HashLHDN ID types to PartyIdScheme
 */
function mapIdType(idType: IdType | undefined): PartyIdScheme {
  if (!idType) return "BRN";
  const idTypeMap: Record<IdType, PartyIdScheme> = {
    BRN: "BRN",
    NRIC: "NRIC",
    PASSPORT: "PASSPORT",
    ARMY: "ARMY",
  };
  return idTypeMap[idType];
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString().split("T")[0];
}

/**
 * Format time to HH:mm:ssZ
 */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}Z`;
}

/**
 * Build postal address from buyer or company info
 */
function buildPostalAddress(
  address?: string,
  city?: string,
  state?: StateCode | string,
  postalCode?: string,
  country?: string
): UBLJsonPostalAddress {
  // Split address into lines, truncate each to 150 chars (LHDN max per line), max 3 lines
  const rawLines = address ? address.split("\n").filter((l) => l.trim()) : ["NA"];
  const addressLines = rawLines.slice(0, 3).map((line) => line.substring(0, 150));

  return {
    CityName: [{ _: city || "NA" }],
    PostalZone: [{ _: postalCode || "00000" }],
    CountrySubentityCode: [{ _: mapStateCode(state as StateCode | undefined) }],
    AddressLine: addressLines.map((line) => ({
      Line: [{ _: line }],
    })),
    Country: [
      {
        IdentificationCode: [
          {
            _: (country || "MYS") as "MYS",
            listID: "ISO3166-1",
            listAgencyID: "6",
          },
        ],
      },
    ],
  };
}

/**
 * Build supplier party from company info
 * Following MyInvois reference implementation - always include all 4 PartyIdentification entries
 */
function buildSupplierParty(company: CompanyInfo): UBLJsonAccountingSupplierParty {
  // Always include all 4 identification entries per MyInvois requirements
  // BRN/idValue is OPTIONAL for suppliers - use "NA" if not provided
  const identifications = [
    { ID: [{ _: company.tin, schemeID: "TIN" as PartyIdScheme }] },
    { ID: [{ _: company.idValue || "NA", schemeID: mapIdType(company.idType as IdType) }] },
    { ID: [{ _: company.sstRegistration || "NA", schemeID: "SST" as PartyIdScheme }] },
    { ID: [{ _: company.ttxRegistration || "NA", schemeID: "TTX" as PartyIdScheme }] },
  ];

  const party: UBLJsonParty = {
    PartyIdentification: identifications,
    PostalAddress: [
      buildPostalAddress(
        company.address,
        company.city,
        company.state,
        company.postalCode,
        company.country
      ),
    ],
    PartyLegalEntity: [{ RegistrationName: [{ _: company.name }] }],
    Contact: [
      {
        // MyInvois requires valid phone format - normalize to +60XXXXXXXXX
        Telephone: [{ _: normalizePhoneNumber(company.phone) }],
        ElectronicMail: [{ _: company.email || "na@example.com" }],
      },
    ],
  };

  // Industry Classification Code is required by MyInvois
  // Use provided values or defaults for general business
  party.IndustryClassificationCode = [
    {
      _: company.industryCode || "46510",
      name:
        company.industryName ||
        "Wholesale of computers, computer peripheral equipment and software",
    },
  ];

  return { Party: [party] };
}

/**
 * Build customer party for consolidated invoice (generic buyer)
 * Following MyInvois reference implementation - always include all 4 PartyIdentification entries
 * For consolidated invoices: Use General TIN (EI00000000010) with "General Public" as buyer
 * @param email - Optional email for testing/notification purposes
 */
function buildConsolidatedCustomerParty(email?: string): UBLJsonAccountingCustomerParty {
  // Per official LHDN SDK sample (1.1-Invoice-Consolidated-Sample.json):
  // BRN must be "NA" for consolidated invoices, not EI00000000010
  const party: UBLJsonParty = {
    PartyIdentification: [
      { ID: [{ _: "EI00000000010", schemeID: "TIN" as PartyIdScheme }] },
      { ID: [{ _: "NA", schemeID: "BRN" as PartyIdScheme }] },
      { ID: [{ _: "NA", schemeID: "SST" as PartyIdScheme }] },
      { ID: [{ _: "NA", schemeID: "TTX" as PartyIdScheme }] },
    ],
    PostalAddress: [buildPostalAddress("NA", "NA", "17", "00000", "MYS")],
    PartyLegalEntity: [{ RegistrationName: [{ _: "General Public" }] }],
    Contact: [
      {
        // MyInvois requires valid phone format (no "NA")
        Telephone: [{ _: "+60000000000" }],
        ElectronicMail: [{ _: email || "na@example.com" }],
      },
    ],
  };

  return { Party: [party] };
}

/**
 * Build customer party from buyer info
 * Following MyInvois reference implementation - always include all 4 PartyIdentification entries
 */
function buildCustomerParty(buyer: Buyer): UBLJsonAccountingCustomerParty {
  // Always include all 4 identification entries per MyInvois requirements
  const identifications = [
    {
      ID: [{ _: buyer.tin || "EI00000000010", schemeID: "TIN" as PartyIdScheme }],
    },
    {
      ID: [
        {
          // Use valid placeholder for ID value if not provided
          _: buyer.idValue || "000000000000",
          schemeID: mapIdType(buyer.idType),
        },
      ],
    },
    {
      ID: [{ _: "NA", schemeID: "SST" as PartyIdScheme }],
    },
    {
      ID: [{ _: "NA", schemeID: "TTX" as PartyIdScheme }],
    },
  ];

  const party: UBLJsonParty = {
    PartyIdentification: identifications,
    PostalAddress: [
      buildPostalAddress(buyer.address, buyer.city, buyer.state, buyer.postalCode, buyer.country),
    ],
    PartyLegalEntity: [{ RegistrationName: [{ _: buyer.name }] }],
    Contact: [
      {
        // MyInvois requires valid phone format - normalize to +60XXXXXXXXX
        Telephone: [{ _: normalizePhoneNumber(buyer.phone) }],
        ElectronicMail: [{ _: buyer.email || "na@example.com" }],
      },
    ],
  };

  return { Party: [party] };
}

/**
 * Build tax subtotal
 */
function buildTaxSubtotal(
  taxableAmount: number,
  taxAmount: number,
  taxCode: TaxCode,
  currencyCode: CurrencyCode,
  taxExemptionReason?: string
): UBLJsonTaxSubtotal {
  const taxCategory: {
    ID: Array<{ _: string }>;
    TaxExemptionReason?: Array<{ _: string }>;
    TaxScheme: Array<{ ID: Array<{ _: string; schemeID: string; schemeAgencyID: string }> }>;
  } = {
    ID: [{ _: mapTaxCode(taxCode) }],
    TaxScheme: [
      {
        ID: [
          {
            _: "OTH",
            schemeID: "UN/ECE 5153",
            schemeAgencyID: "6",
          },
        ],
      },
    ],
  };

  // Add TaxExemptionReason when tax code is "E" (per LHDN 6 Apr 2024)
  if (taxCode === "E" && taxExemptionReason) {
    taxCategory.TaxExemptionReason = [{ _: taxExemptionReason }];
  }

  return {
    TaxableAmount: [{ _: taxableAmount, currencyID: currencyCode }],
    TaxAmount: [{ _: taxAmount, currencyID: currencyCode }],
    TaxCategory: [taxCategory],
  };
}

/**
 * Build tax total from items
 */
function buildTaxTotal(items: InvoiceItem[], currencyCode: CurrencyCode): UBLJsonTaxTotal {
  // Aggregate tax by tax code
  const taxMap = new Map<
    TaxCode,
    { taxableAmount: number; taxAmount: number; taxExemptionReason?: string }
  >();

  for (const item of items) {
    const existing = taxMap.get(item.taxCode);
    const taxableAmount = item.quantity * item.unitPrice - item.discount;
    if (existing) {
      existing.taxableAmount += taxableAmount;
      existing.taxAmount += item.taxAmount;
      // Keep first exemption reason found for this tax code
      if (!existing.taxExemptionReason && item.taxExemptionReason) {
        existing.taxExemptionReason = item.taxExemptionReason;
      }
    } else {
      taxMap.set(item.taxCode, {
        taxableAmount,
        taxAmount: item.taxAmount,
        taxExemptionReason: item.taxExemptionReason,
      });
    }
  }

  const totalTaxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);

  return {
    TaxAmount: [{ _: totalTaxAmount, currencyID: currencyCode }],
    TaxSubtotal: Array.from(taxMap.entries()).map(([taxCode, amounts]) =>
      buildTaxSubtotal(
        amounts.taxableAmount,
        amounts.taxAmount,
        taxCode,
        currencyCode,
        amounts.taxExemptionReason
      )
    ),
  };
}

/**
 * Build invoice line
 * @param isConsolidated - Whether this is a consolidated invoice (affects default classification)
 */
function buildInvoiceLine(
  item: InvoiceItem,
  index: number,
  currencyCode: CurrencyCode,
  isConsolidated: boolean
): UBLJsonInvoiceLine {
  const lineExtension = item.quantity * item.unitPrice - item.discount;

  // Classification codes:
  // - 004: Consolidated e-Invoice (only for consolidated invoices)
  // - 022: Services (default for non-consolidated)
  // Use item.classification if provided, otherwise default based on invoice type
  const defaultClassification = isConsolidated ? "004" : "022";

  const invoiceLine: UBLJsonInvoiceLine = {
    ID: [{ _: String(index + 1) }],
    InvoicedQuantity: [{ _: item.quantity, unitCode: (item.unitOfMeasure || "C62") as "C62" }],
    LineExtensionAmount: [{ _: lineExtension, currencyID: currencyCode }],
    TaxTotal: [
      {
        TaxAmount: [{ _: item.taxAmount, currencyID: currencyCode }],
        TaxSubtotal: [
          buildTaxSubtotal(
            lineExtension,
            item.taxAmount,
            item.taxCode,
            currencyCode,
            item.taxExemptionReason
          ),
        ],
      },
    ],
    Item: [
      {
        CommodityClassification: [
          {
            ItemClassificationCode: [
              {
                _: item.classification || defaultClassification,
                listID: "CLASS",
              },
            ],
          },
        ],
        Description: [{ _: item.description }],
      },
    ],
    Price: [
      {
        PriceAmount: [{ _: item.unitPrice, currencyID: currencyCode }],
      },
    ],
    ItemPriceExtension: [
      {
        // Use lineExtension (qty * price - discount) NOT item.total (which includes tax)
        // MyInvois validates that ItemPriceExtension matches LineExtensionAmount
        Amount: [{ _: lineExtension, currencyID: currencyCode }],
      },
    ],
  };

  // Add discount if present
  if (item.discount > 0) {
    invoiceLine.AllowanceCharge = [
      {
        ChargeIndicator: [{ _: false }],
        AllowanceChargeReason: [{ _: "Discount" }],
        Amount: [{ _: item.discount, currencyID: currencyCode }],
      },
    ];
  }

  return invoiceLine;
}

/**
 * Transform options for UBL transformation
 */
export interface TransformOptions {
  /** Optional buyer email for consolidated invoices (for notification purposes) */
  buyerEmail?: string;
}

/**
 * Transform a single invoice to UBL 2.1 format
 */
function transformInvoiceToUBL(
  invoice: Invoice,
  company: CompanyInfo,
  isConsolidated: boolean,
  documentVersion: "1.0" | "1.1",
  options?: TransformOptions
): UBLJsonInvoiceContentV1_0 {
  const currencyCode = (invoice.currency || "MYR") as CurrencyCode;
  const items = invoice.items;

  // Calculate totals
  const lineExtensionAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice - item.discount,
    0
  );
  const totalDiscount = invoice.discount;
  const totalTaxAmount = invoice.taxAmount;
  const taxExclusiveAmount = lineExtensionAmount - totalDiscount;
  const taxInclusiveAmount = taxExclusiveAmount + totalTaxAmount;
  const payableAmount = taxInclusiveAmount + invoice.rounding;

  // Build customer party based on invoice type
  const customerParty = isConsolidated
    ? buildConsolidatedCustomerParty(options?.buyerEmail)
    : invoice.buyer
      ? buildCustomerParty(invoice.buyer)
      : buildConsolidatedCustomerParty(options?.buyerEmail);

  const content: UBLJsonInvoiceContentV1_0 = {
    ID: [{ _: invoice.invoiceNumber }],
    IssueDate: [{ _: formatDate(invoice.invoiceDate) }],
    IssueTime: [{ _: formatTime(invoice.invoiceDate) }],
    InvoiceTypeCode: [
      {
        _: "01", // Invoice type 01
        listVersionID: documentVersion,
      },
    ],
    DocumentCurrencyCode: [{ _: currencyCode }],
    AccountingSupplierParty: [buildSupplierParty(company)],
    AccountingCustomerParty: [customerParty],
    TaxTotal: [buildTaxTotal(items, currencyCode)],
    LegalMonetaryTotal: [
      {
        LineExtensionAmount: [{ _: lineExtensionAmount, currencyID: currencyCode }],
        TaxExclusiveAmount: [{ _: taxExclusiveAmount, currencyID: currencyCode }],
        TaxInclusiveAmount: [{ _: taxInclusiveAmount, currencyID: currencyCode }],
        AllowanceTotalAmount: [{ _: totalDiscount, currencyID: currencyCode }],
        ChargeTotalAmount: [{ _: 0, currencyID: currencyCode }],
        PayableRoundingAmount: [{ _: invoice.rounding, currencyID: currencyCode }],
        PayableAmount: [{ _: payableAmount, currencyID: currencyCode }],
      },
    ],
    InvoiceLine: items.map((item, index) =>
      buildInvoiceLine(item, index, currencyCode, isConsolidated)
    ),
  };

  // Add TaxExchangeRate when currency is not MYR (per LHDN 9 Aug 2025, enforced 1 Sep 2025)
  if (currencyCode !== "MYR" && invoice.exchangeRate) {
    content.TaxExchangeRate = [
      {
        SourceCurrencyCode: [{ _: currencyCode }],
        TargetCurrencyCode: [{ _: "MYR" as CurrencyCode }],
        CalculationRate: [{ _: invoice.exchangeRate }],
      },
    ];
  }

  // Add payment means (default: Others)
  content.PaymentMeans = [
    {
      PaymentMeansCode: [{ _: "08" }], // Others
    },
  ];

  // Add InvoicePeriod for consolidated invoices (required by MyInvois)
  if (isConsolidated) {
    // For daily consolidated invoices, the period is typically the same day
    content.InvoicePeriod = [
      {
        StartDate: [{ _: formatDate(invoice.invoiceDate) }],
        EndDate: [{ _: formatDate(invoice.invoiceDate) }],
        Description: [{ _: "Consolidated invoice" }],
      },
    ];
  }

  return content;
}

/**
 * Transform HashLHDN invoice(s) to UBL 2.1 v1.0 format
 */
export function transformToUBLv1_0(
  invoices: Invoice[],
  company: CompanyInfo,
  isConsolidated: boolean,
  options?: TransformOptions
): UBLJsonInvoiceV1_0 {
  // For consolidated invoices, we combine all invoices into a single document
  // For other types, we take the first invoice
  const invoice = invoices[0];

  // For consolidated, merge all items from all invoices
  if (isConsolidated && invoices.length > 1) {
    const mergedItems: InvoiceItem[] = [];
    let totalAmount = 0;
    let totalDiscount = 0;
    let totalTaxAmount = 0;
    let totalRounding = 0;
    let totalSum = 0;

    for (const inv of invoices) {
      mergedItems.push(...inv.items);
      totalAmount += inv.amount;
      totalDiscount += inv.discount;
      totalTaxAmount += inv.taxAmount;
      totalRounding += inv.rounding;
      totalSum += inv.total;
    }

    // Create merged invoice
    const mergedInvoice: Invoice = {
      invoiceNumber: `CONS-${invoice.invoiceNumber}`,
      invoiceDate: invoice.invoiceDate,
      amount: totalAmount,
      discount: totalDiscount,
      rounding: totalRounding,
      taxAmount: totalTaxAmount,
      total: totalSum,
      items: mergedItems,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
    };

    const content = transformInvoiceToUBL(mergedInvoice, company, true, "1.0", options);
    return {
      _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      Invoice: [content],
    };
  }

  const content = transformInvoiceToUBL(invoice, company, isConsolidated, "1.0", options);
  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [content],
  };
}

/**
 * Transform HashLHDN invoice(s) to UBL 2.1 v1.1 format (with signature support)
 */
export function transformToUBLv1_1(
  invoices: Invoice[],
  company: CompanyInfo,
  isConsolidated: boolean,
  options?: TransformOptions
): UBLJsonInvoiceV1_1 {
  const invoice = invoices[0];

  if (isConsolidated && invoices.length > 1) {
    const mergedItems: InvoiceItem[] = [];
    let totalAmount = 0;
    let totalDiscount = 0;
    let totalTaxAmount = 0;
    let totalRounding = 0;
    let totalSum = 0;

    for (const inv of invoices) {
      mergedItems.push(...inv.items);
      totalAmount += inv.amount;
      totalDiscount += inv.discount;
      totalTaxAmount += inv.taxAmount;
      totalRounding += inv.rounding;
      totalSum += inv.total;
    }

    const mergedInvoice: Invoice = {
      invoiceNumber: `CONS-${invoice.invoiceNumber}`,
      invoiceDate: invoice.invoiceDate,
      amount: totalAmount,
      discount: totalDiscount,
      rounding: totalRounding,
      taxAmount: totalTaxAmount,
      total: totalSum,
      items: mergedItems,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
    };

    const content = transformInvoiceToUBL(mergedInvoice, company, true, "1.1", options);
    return {
      _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      Invoice: [content],
    };
  }

  const content = transformInvoiceToUBL(invoice, company, isConsolidated, "1.1", options);
  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [content],
  };
}

/**
 * Transform to UBL based on document version
 * Default to v1.0 (unsigned) unless explicitly specified
 */
export function transformToUBL(
  invoices: Invoice[],
  company: CompanyInfo,
  isConsolidated: boolean,
  documentVersion: "1.0" | "1.1" = "1.0",
  options?: TransformOptions
): UBLJsonInvoiceV1_0 | UBLJsonInvoiceV1_1 {
  if (documentVersion === "1.0") {
    return transformToUBLv1_0(invoices, company, isConsolidated, options);
  }
  return transformToUBLv1_1(invoices, company, isConsolidated, options);
}
