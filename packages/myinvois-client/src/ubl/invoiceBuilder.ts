/**
 * UBL Invoice Builder
 *
 * Fluent builder for creating valid UBL 2.1 JSON invoices for MyInvois.
 */

import type {
  UBLJsonInvoiceV1_0,
  UBLJsonInvoiceV1_1,
  UBLJsonInvoiceContentV1_0,
  UBLJsonInvoiceContentV1_1,
  UBLJsonInvoiceLine,
  UBLJsonTaxTotal,
  UBLJsonParty,
  UBLJsonPostalAddress,
  UBLJsonContact,
  UBLJsonTaxSubtotal,
  UBLJsonTaxCategory,
} from "./types.js";
import type {
  InvoiceTypeCode,
  CurrencyCode,
  MalaysianStateCode,
  CountryCodeISO3166Alpha3,
  PaymentModeCode,
  ClassificationCode,
  TaxTypeCode,
  UnitCode,
  PartyIdScheme,
} from "../codes.js";

// =============================================================================
// Input Types for Builder
// =============================================================================

export interface PartyIdentificationInput {
  schemeID: PartyIdScheme;
  value: string;
}

export interface AddressInput {
  addressLines: string[];
  cityName: string;
  postalZone: string;
  stateCode: MalaysianStateCode;
  countryCode?: CountryCodeISO3166Alpha3;
}

export interface ContactInput {
  telephone: string;
  email: string;
}

export interface SupplierPartyInput {
  tin: string;
  idType: PartyIdScheme;
  idValue: string;
  registrationName: string;
  address: AddressInput;
  contact: ContactInput;
  industryCode?: string;
  industryName?: string;
  sstRegistration?: string;
  ttxRegistration?: string;
  additionalAccountId?: string;
}

export interface CustomerPartyInput {
  tin: string;
  idType: PartyIdScheme;
  idValue: string;
  registrationName: string;
  address: AddressInput;
  contact: ContactInput;
}

export interface TaxInput {
  taxType: TaxTypeCode;
  taxableAmount: number;
  taxAmount: number;
  exemptionReason?: string;
}

export interface InvoiceLineInput {
  id: string;
  description: string;
  quantity: number;
  unitCode?: UnitCode;
  unitPrice: number;
  lineTotal: number;
  classificationCode: ClassificationCode | string;
  tax: TaxInput;
  discount?: number;
  discountReason?: string;
}

export interface InvoiceInput {
  id: string;
  issueDate: Date;
  invoiceTypeCode?: InvoiceTypeCode;
  currencyCode?: CurrencyCode;
  supplier: SupplierPartyInput;
  customer: CustomerPartyInput;
  lines: InvoiceLineInput[];
  paymentMode?: PaymentModeCode;
  paymentTerms?: string;
  billingReferenceId?: string;
  periodStart?: Date;
  periodEnd?: Date;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatTime(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}Z`;
}

function buildAddress(input: AddressInput): UBLJsonPostalAddress {
  return {
    CityName: [{ _: input.cityName }],
    PostalZone: [{ _: input.postalZone }],
    CountrySubentityCode: [{ _: input.stateCode }],
    AddressLine: input.addressLines.map((line) => ({
      Line: [{ _: line }],
    })),
    Country: [
      {
        IdentificationCode: [
          {
            _: input.countryCode || "MYS",
            listID: "ISO3166-1",
            listAgencyID: "6",
          },
        ],
      },
    ],
  };
}

function buildContact(input: ContactInput): UBLJsonContact {
  return {
    Telephone: [{ _: input.telephone }],
    ElectronicMail: [{ _: input.email }],
  };
}

function buildParty(
  tin: string,
  idType: PartyIdScheme,
  idValue: string,
  registrationName: string,
  address: AddressInput,
  contact: ContactInput,
  industryCode?: string,
  industryName?: string,
  sstRegistration?: string,
  ttxRegistration?: string
): UBLJsonParty {
  const identifications = [
    { ID: [{ _: tin, schemeID: "TIN" as PartyIdScheme }] },
    { ID: [{ _: idValue, schemeID: idType }] },
  ];

  if (sstRegistration) {
    identifications.push({
      ID: [{ _: sstRegistration, schemeID: "SST" as PartyIdScheme }],
    });
  }

  if (ttxRegistration) {
    identifications.push({
      ID: [{ _: ttxRegistration, schemeID: "TTX" as PartyIdScheme }],
    });
  }

  const party: UBLJsonParty = {
    PartyIdentification: identifications,
    PostalAddress: [buildAddress(address)],
    PartyLegalEntity: [{ RegistrationName: [{ _: registrationName }] }],
    Contact: [buildContact(contact)],
  };

  if (industryCode && industryName) {
    party.IndustryClassificationCode = [{ _: industryCode, name: industryName }];
  }

  return party;
}

function buildTaxCategory(tax: TaxInput): UBLJsonTaxCategory {
  const category: UBLJsonTaxCategory = {
    ID: [{ _: tax.taxType === "E" ? "E" : tax.taxType }],
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

  if (tax.exemptionReason) {
    category.TaxExemptionReason = [{ _: tax.exemptionReason }];
  }

  return category;
}

function buildTaxSubtotal(tax: TaxInput, currencyCode: CurrencyCode): UBLJsonTaxSubtotal {
  return {
    TaxableAmount: [{ _: tax.taxableAmount, currencyID: currencyCode }],
    TaxAmount: [{ _: tax.taxAmount, currencyID: currencyCode }],
    TaxCategory: [buildTaxCategory(tax)],
  };
}

function buildTaxTotal(taxes: TaxInput[], currencyCode: CurrencyCode): UBLJsonTaxTotal {
  const totalTaxAmount = taxes.reduce((sum, t) => sum + t.taxAmount, 0);

  return {
    TaxAmount: [{ _: totalTaxAmount, currencyID: currencyCode }],
    TaxSubtotal: taxes.map((tax) => buildTaxSubtotal(tax, currencyCode)),
  };
}

function buildInvoiceLine(line: InvoiceLineInput, currencyCode: CurrencyCode): UBLJsonInvoiceLine {
  const invoiceLine: UBLJsonInvoiceLine = {
    ID: [{ _: line.id }],
    InvoicedQuantity: [{ _: line.quantity, unitCode: line.unitCode || "C62" }],
    LineExtensionAmount: [{ _: line.lineTotal, currencyID: currencyCode }],
    TaxTotal: [buildTaxTotal([line.tax], currencyCode)],
    Item: [
      {
        CommodityClassification: [
          {
            ItemClassificationCode: [{ _: line.classificationCode, listID: "CLASS" }],
          },
        ],
        Description: [{ _: line.description }],
      },
    ],
    Price: [
      {
        PriceAmount: [{ _: line.unitPrice, currencyID: currencyCode }],
      },
    ],
    ItemPriceExtension: [
      {
        Amount: [{ _: line.lineTotal, currencyID: currencyCode }],
      },
    ],
  };

  if (line.discount !== undefined && line.discount > 0) {
    invoiceLine.AllowanceCharge = [
      {
        ChargeIndicator: [{ _: false }],
        AllowanceChargeReason: [{ _: line.discountReason || "Discount" }],
        Amount: [{ _: line.discount, currencyID: currencyCode }],
      },
    ];
  }

  return invoiceLine;
}

// =============================================================================
// Invoice Builder Class
// =============================================================================

/**
 * Fluent builder for UBL JSON invoices
 */
export class InvoiceBuilder {
  private input: Partial<InvoiceInput> = {};

  /**
   * Set invoice ID
   */
  setId(id: string): this {
    this.input.id = id;
    return this;
  }

  /**
   * Set issue date
   */
  setIssueDate(date: Date): this {
    this.input.issueDate = date;
    return this;
  }

  /**
   * Set invoice type code (default: 01 - Invoice)
   */
  setInvoiceTypeCode(code: InvoiceTypeCode): this {
    this.input.invoiceTypeCode = code;
    return this;
  }

  /**
   * Set currency code (default: MYR)
   */
  setCurrencyCode(code: CurrencyCode): this {
    this.input.currencyCode = code;
    return this;
  }

  /**
   * Set supplier party
   */
  setSupplier(supplier: SupplierPartyInput): this {
    this.input.supplier = supplier;
    return this;
  }

  /**
   * Set customer party
   */
  setCustomer(customer: CustomerPartyInput): this {
    this.input.customer = customer;
    return this;
  }

  /**
   * Add invoice lines
   */
  setLines(lines: InvoiceLineInput[]): this {
    this.input.lines = lines;
    return this;
  }

  /**
   * Add a single invoice line
   */
  addLine(line: InvoiceLineInput): this {
    if (!this.input.lines) {
      this.input.lines = [];
    }
    this.input.lines.push(line);
    return this;
  }

  /**
   * Set payment mode
   */
  setPaymentMode(mode: PaymentModeCode): this {
    this.input.paymentMode = mode;
    return this;
  }

  /**
   * Set payment terms
   */
  setPaymentTerms(terms: string): this {
    this.input.paymentTerms = terms;
    return this;
  }

  /**
   * Set billing reference ID
   */
  setBillingReferenceId(id: string): this {
    this.input.billingReferenceId = id;
    return this;
  }

  /**
   * Set invoice period
   */
  setPeriod(start: Date, end: Date): this {
    this.input.periodStart = start;
    this.input.periodEnd = end;
    return this;
  }

  /**
   * Build the UBL JSON invoice (v1.0)
   */
  buildV1_0(): UBLJsonInvoiceV1_0 {
    this.validate();

    const currencyCode = this.input.currencyCode || "MYR";
    const invoiceTypeCode = this.input.invoiceTypeCode || "01";
    const issueDate = this.input.issueDate!;
    const lines = this.input.lines!;
    const supplier = this.input.supplier!;
    const customer = this.input.customer!;

    // Calculate totals
    const lineExtensionAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const totalDiscount = lines.reduce((sum, l) => sum + (l.discount || 0), 0);
    const totalTaxAmount = lines.reduce((sum, l) => sum + l.tax.taxAmount, 0);
    const taxExclusiveAmount = lineExtensionAmount - totalDiscount;
    const taxInclusiveAmount = taxExclusiveAmount + totalTaxAmount;

    // Build invoice content
    const content: UBLJsonInvoiceContentV1_0 = {
      ID: [{ _: this.input.id! }],
      IssueDate: [{ _: formatDate(issueDate) }],
      IssueTime: [{ _: formatTime(issueDate) }],
      InvoiceTypeCode: [{ _: invoiceTypeCode, listVersionID: "1.0" }],
      DocumentCurrencyCode: [{ _: currencyCode }],
      AccountingSupplierParty: [
        {
          AdditionalAccountID: supplier.additionalAccountId
            ? [{ _: supplier.additionalAccountId, schemeAgencyName: "CertEX" }]
            : undefined,
          Party: [
            buildParty(
              supplier.tin,
              supplier.idType,
              supplier.idValue,
              supplier.registrationName,
              supplier.address,
              supplier.contact,
              supplier.industryCode,
              supplier.industryName,
              supplier.sstRegistration,
              supplier.ttxRegistration
            ),
          ],
        },
      ],
      AccountingCustomerParty: [
        {
          Party: [
            buildParty(
              customer.tin,
              customer.idType,
              customer.idValue,
              customer.registrationName,
              customer.address,
              customer.contact
            ),
          ],
        },
      ],
      TaxTotal: [
        {
          TaxAmount: [{ _: totalTaxAmount, currencyID: currencyCode }],
          TaxSubtotal: this.aggregateTaxSubtotals(lines, currencyCode),
        },
      ],
      LegalMonetaryTotal: [
        {
          LineExtensionAmount: [{ _: lineExtensionAmount, currencyID: currencyCode }],
          TaxExclusiveAmount: [{ _: taxExclusiveAmount, currencyID: currencyCode }],
          TaxInclusiveAmount: [{ _: taxInclusiveAmount, currencyID: currencyCode }],
          AllowanceTotalAmount: [{ _: totalDiscount, currencyID: currencyCode }],
          ChargeTotalAmount: [{ _: 0, currencyID: currencyCode }],
          PayableRoundingAmount: [{ _: 0, currencyID: currencyCode }],
          PayableAmount: [{ _: taxInclusiveAmount, currencyID: currencyCode }],
        },
      ],
      InvoiceLine: lines.map((line) => buildInvoiceLine(line, currencyCode)),
    };

    // Add optional fields
    if (this.input.periodStart && this.input.periodEnd) {
      content.InvoicePeriod = [
        {
          StartDate: [{ _: formatDate(this.input.periodStart) }],
          EndDate: [{ _: formatDate(this.input.periodEnd) }],
        },
      ];
    }

    if (this.input.billingReferenceId) {
      content.BillingReference = [
        {
          AdditionalDocumentReference: [{ ID: [{ _: this.input.billingReferenceId }] }],
        },
      ];
    }

    if (this.input.paymentMode) {
      content.PaymentMeans = [
        {
          PaymentMeansCode: [{ _: this.input.paymentMode }],
        },
      ];
    }

    if (this.input.paymentTerms) {
      content.PaymentTerms = [
        {
          Note: [{ _: this.input.paymentTerms }],
        },
      ];
    }

    return {
      _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      Invoice: [content],
    };
  }

  /**
   * Build the UBL JSON invoice (v1.1 - with signature support)
   */
  buildV1_1(): UBLJsonInvoiceV1_1 {
    const v1_0 = this.buildV1_0();
    return {
      ...v1_0,
      Invoice: v1_0.Invoice as UBLJsonInvoiceContentV1_1[],
    };
  }

  /**
   * Validate required fields
   */
  private validate(): void {
    if (!this.input.id) throw new Error("Invoice ID is required");
    if (!this.input.issueDate) throw new Error("Issue date is required");
    if (!this.input.supplier) throw new Error("Supplier is required");
    if (!this.input.customer) throw new Error("Customer is required");
    if (!this.input.lines || this.input.lines.length === 0) {
      throw new Error("At least one invoice line is required");
    }
  }

  /**
   * Aggregate tax subtotals by tax type
   */
  private aggregateTaxSubtotals(
    lines: InvoiceLineInput[],
    currencyCode: CurrencyCode
  ): UBLJsonTaxSubtotal[] {
    const taxMap = new Map<string, { taxableAmount: number; taxAmount: number; tax: TaxInput }>();

    for (const line of lines) {
      const key = line.tax.taxType;
      const existing = taxMap.get(key);
      if (existing) {
        existing.taxableAmount += line.tax.taxableAmount;
        existing.taxAmount += line.tax.taxAmount;
      } else {
        taxMap.set(key, {
          taxableAmount: line.tax.taxableAmount,
          taxAmount: line.tax.taxAmount,
          tax: line.tax,
        });
      }
    }

    return Array.from(taxMap.values()).map((v) =>
      buildTaxSubtotal(
        { ...v.tax, taxableAmount: v.taxableAmount, taxAmount: v.taxAmount },
        currencyCode
      )
    );
  }
}

/**
 * Create a new invoice builder
 */
export function createInvoiceBuilder(): InvoiceBuilder {
  return new InvoiceBuilder();
}

/**
 * Build invoice from input object
 */
export function buildInvoice(input: InvoiceInput): UBLJsonInvoiceV1_0 {
  return new InvoiceBuilder()
    .setId(input.id)
    .setIssueDate(input.issueDate)
    .setInvoiceTypeCode(input.invoiceTypeCode || "01")
    .setCurrencyCode(input.currencyCode || "MYR")
    .setSupplier(input.supplier)
    .setCustomer(input.customer)
    .setLines(input.lines)
    .setPaymentMode(input.paymentMode || "01")
    .setPaymentTerms(input.paymentTerms || "")
    .setBillingReferenceId(input.billingReferenceId || "")
    .buildV1_0();
}
