/**
 * UBL 2.1 JSON Type Definitions for MyInvois
 *
 * Based on OASIS UBL 2.1 specification adapted for MyInvois JSON format.
 * Reference: https://sdk.myinvois.hasil.gov.my/
 */

import type {
  InvoiceTypeCode,
  ClassificationCode,
  CountryCodeISO3166Alpha3,
  CurrencyCode,
  PaymentModeCode,
  MalaysianStateCode,
  TaxTypeCode,
  PartyIdScheme,
  UnitCode,
} from "../codes.js";

// =============================================================================
// Base UBL JSON Value Types
// =============================================================================

/**
 * Base UBL JSON value wrapper
 * All UBL values are wrapped in arrays with "_" property
 */
export interface UBLJsonValue<T> {
  _: T;
}

/**
 * Text type
 */
export type UBLJsonText = UBLJsonValue<string>[];

/**
 * Identifier type
 */
export type UBLJsonIdentifier = UBLJsonValue<string>[];

/**
 * Date type (YYYY-MM-DD)
 */
export type UBLJsonDate = UBLJsonValue<string>[];

/**
 * Time type (HH:mm:ssZ)
 */
export type UBLJsonTime = UBLJsonValue<string>[];

/**
 * Quantity type
 */
export interface UBLJsonQuantityValue {
  _: number;
  unitCode: UnitCode;
}
export type UBLJsonQuantity = UBLJsonQuantityValue[];

/**
 * Amount type with currency
 */
export interface UBLJsonAmountValue {
  _: number;
  currencyID: CurrencyCode;
}
export type UBLJsonAmount = UBLJsonAmountValue[];

/**
 * Numeric type
 */
export type UBLJsonNumeric = UBLJsonValue<number>[];

/**
 * Code type with optional scheme
 */
export interface UBLJsonCodeValue {
  _: string;
  listID?: string;
  listAgencyID?: string;
  listVersionID?: string;
  name?: string;
}
export type UBLJsonCode = UBLJsonCodeValue[];

/**
 * Indicator type (boolean)
 */
export type UBLJsonIndicator = UBLJsonValue<boolean>[];

// =============================================================================
// Party Identification
// =============================================================================

/**
 * Party identification item
 */
export interface UBLJsonPartyIdentificationItem {
  ID: Array<{
    _: string;
    schemeID: PartyIdScheme;
  }>;
}

// =============================================================================
// Address Types
// =============================================================================

/**
 * Address line
 */
export interface UBLJsonAddressLine {
  Line: UBLJsonText;
}

/**
 * Country
 */
export interface UBLJsonCountry {
  IdentificationCode: Array<{
    _: CountryCodeISO3166Alpha3;
    listID?: string;
    listAgencyID?: string;
  }>;
}

/**
 * Postal address
 */
export interface UBLJsonPostalAddress {
  CityName: UBLJsonText;
  PostalZone: UBLJsonText;
  CountrySubentityCode: Array<UBLJsonValue<MalaysianStateCode>>;
  AddressLine: UBLJsonAddressLine[];
  Country: UBLJsonCountry[];
}

// =============================================================================
// Contact Types
// =============================================================================

/**
 * Contact information
 */
export interface UBLJsonContact {
  Telephone: UBLJsonText;
  ElectronicMail: UBLJsonText;
}

// =============================================================================
// Party Types
// =============================================================================

/**
 * Party legal entity
 */
export interface UBLJsonPartyLegalEntity {
  RegistrationName: UBLJsonText;
}

/**
 * Industry classification code
 */
export interface UBLJsonIndustryClassificationCode {
  _: string;
  name: string;
}

/**
 * Party (generic)
 */
export interface UBLJsonParty {
  IndustryClassificationCode?: UBLJsonIndustryClassificationCode[];
  PartyIdentification: UBLJsonPartyIdentificationItem[];
  PostalAddress: UBLJsonPostalAddress[];
  PartyLegalEntity: UBLJsonPartyLegalEntity[];
  Contact: UBLJsonContact[];
}

/**
 * Supplier party with additional account ID
 */
export interface UBLJsonAccountingSupplierParty {
  AdditionalAccountID?: Array<{
    _: string;
    schemeAgencyName?: string;
  }>;
  Party: UBLJsonParty[];
}

/**
 * Customer party
 */
export interface UBLJsonAccountingCustomerParty {
  Party: UBLJsonParty[];
}

// =============================================================================
// Tax Types
// =============================================================================

/**
 * Tax scheme
 */
export interface UBLJsonTaxScheme {
  ID: Array<{
    _: TaxTypeCode | string;
    schemeID?: string;
    schemeAgencyID?: string;
  }>;
}

/**
 * Tax category
 */
export interface UBLJsonTaxCategory {
  ID: Array<UBLJsonValue<string>>;
  TaxExemptionReason?: UBLJsonText;
  TaxScheme: UBLJsonTaxScheme[];
}

/**
 * Tax subtotal
 */
export interface UBLJsonTaxSubtotal {
  TaxableAmount: UBLJsonAmount;
  TaxAmount: UBLJsonAmount;
  TaxCategory: UBLJsonTaxCategory[];
}

/**
 * Tax total
 */
export interface UBLJsonTaxTotal {
  TaxAmount: UBLJsonAmount;
  TaxSubtotal: UBLJsonTaxSubtotal[];
}

// =============================================================================
// Payment Types
// =============================================================================

/**
 * Payee financial account
 */
export interface UBLJsonPayeeFinancialAccount {
  ID: UBLJsonIdentifier;
}

/**
 * Payment means
 */
export interface UBLJsonPaymentMeans {
  PaymentMeansCode: Array<UBLJsonValue<PaymentModeCode>>;
  PayeeFinancialAccount?: UBLJsonPayeeFinancialAccount[];
}

/**
 * Payment terms
 */
export interface UBLJsonPaymentTerms {
  Note: UBLJsonText;
}

/**
 * Prepaid payment
 */
export interface UBLJsonPrepaidPayment {
  ID?: UBLJsonIdentifier;
  PaidAmount: UBLJsonAmount;
  PaidDate?: UBLJsonDate;
  PaidTime?: UBLJsonTime;
}

// =============================================================================
// Monetary Totals
// =============================================================================

/**
 * Legal monetary total
 */
export interface UBLJsonLegalMonetaryTotal {
  LineExtensionAmount: UBLJsonAmount;
  TaxExclusiveAmount: UBLJsonAmount;
  TaxInclusiveAmount: UBLJsonAmount;
  AllowanceTotalAmount?: UBLJsonAmount;
  ChargeTotalAmount?: UBLJsonAmount;
  PayableRoundingAmount?: UBLJsonAmount;
  PayableAmount: UBLJsonAmount;
  PrepaidAmount?: UBLJsonAmount;
}

// =============================================================================
// Document References
// =============================================================================

/**
 * Additional document reference
 */
export interface UBLJsonAdditionalDocumentReference {
  ID: UBLJsonIdentifier;
  DocumentType?: UBLJsonText;
}

/**
 * Billing reference
 */
export interface UBLJsonBillingReference {
  AdditionalDocumentReference: UBLJsonAdditionalDocumentReference[];
}

// =============================================================================
// Invoice Period
// =============================================================================

/**
 * Invoice period
 */
export interface UBLJsonInvoicePeriod {
  StartDate: UBLJsonDate;
  EndDate: UBLJsonDate;
  Description?: UBLJsonText;
}

// =============================================================================
// Allowance/Charge
// =============================================================================

/**
 * Allowance or charge at line level
 */
export interface UBLJsonAllowanceCharge {
  ChargeIndicator: UBLJsonIndicator;
  AllowanceChargeReason?: UBLJsonText;
  MultiplierFactorNumeric?: UBLJsonNumeric;
  Amount: UBLJsonAmount;
}

// =============================================================================
// Item Types
// =============================================================================

/**
 * Commodity classification
 */
export interface UBLJsonCommodityClassification {
  ItemClassificationCode: Array<{
    _: ClassificationCode | string;
    listID: string;
  }>;
}

/**
 * Item
 */
export interface UBLJsonItem {
  CommodityClassification: UBLJsonCommodityClassification[];
  Description: UBLJsonText;
  OriginCountry?: UBLJsonCountry[];
}

/**
 * Price
 */
export interface UBLJsonPrice {
  PriceAmount: UBLJsonAmount;
}

/**
 * Item price extension
 */
export interface UBLJsonItemPriceExtension {
  Amount: UBLJsonAmount;
}

// =============================================================================
// Invoice Line
// =============================================================================

/**
 * Invoice line
 */
export interface UBLJsonInvoiceLine {
  ID: UBLJsonIdentifier;
  InvoicedQuantity: UBLJsonQuantity;
  LineExtensionAmount: UBLJsonAmount;
  AllowanceCharge?: UBLJsonAllowanceCharge[];
  TaxTotal: UBLJsonTaxTotal[];
  Item: UBLJsonItem[];
  Price: UBLJsonPrice[];
  ItemPriceExtension?: UBLJsonItemPriceExtension[];
}

// =============================================================================
// Delivery Types
// =============================================================================

/**
 * Delivery party
 */
export interface UBLJsonDeliveryParty {
  PartyLegalEntity: UBLJsonPartyLegalEntity[];
  PostalAddress?: UBLJsonPostalAddress[];
  PartyIdentification?: UBLJsonPartyIdentificationItem[];
}

/**
 * Shipment
 */
export interface UBLJsonShipment {
  ID: UBLJsonIdentifier;
  FreightAllowanceCharge?: UBLJsonAllowanceCharge[];
}

/**
 * Delivery
 */
export interface UBLJsonDelivery {
  DeliveryParty?: UBLJsonDeliveryParty[];
  Shipment?: UBLJsonShipment[];
}

// =============================================================================
// Digital Signature (UBL 2.1 v1.1)
// =============================================================================

/**
 * Signature information
 */
export interface UBLJsonSignature {
  ID: UBLJsonIdentifier;
  SignatureMethod?: UBLJsonText;
}

/**
 * UBL Extensions for digital signature
 */
export interface UBLJsonUBLExtension {
  ExtensionURI?: UBLJsonText;
  ExtensionContent?: unknown;
}

export interface UBLJsonUBLExtensions {
  UBLExtension: UBLJsonUBLExtension[];
}

// =============================================================================
// Invoice Document Types
// =============================================================================

/**
 * Invoice content (v1.0 - without signature)
 */
export interface UBLJsonInvoiceContentV1_0 {
  ID: UBLJsonIdentifier;
  IssueDate: UBLJsonDate;
  IssueTime: UBLJsonTime;
  InvoiceTypeCode: Array<{
    _: InvoiceTypeCode;
    listVersionID: string;
  }>;
  DocumentCurrencyCode: Array<UBLJsonValue<CurrencyCode>>;
  TaxCurrencyCode?: Array<UBLJsonValue<CurrencyCode>>;
  InvoicePeriod?: UBLJsonInvoicePeriod[];
  BillingReference?: UBLJsonBillingReference[];
  AdditionalDocumentReference?: UBLJsonAdditionalDocumentReference[];
  AccountingSupplierParty: UBLJsonAccountingSupplierParty[];
  AccountingCustomerParty: UBLJsonAccountingCustomerParty[];
  Delivery?: UBLJsonDelivery[];
  PaymentMeans?: UBLJsonPaymentMeans[];
  PaymentTerms?: UBLJsonPaymentTerms[];
  PrepaidPayment?: UBLJsonPrepaidPayment[];
  AllowanceCharge?: UBLJsonAllowanceCharge[];
  TaxTotal: UBLJsonTaxTotal[];
  LegalMonetaryTotal: UBLJsonLegalMonetaryTotal[];
  InvoiceLine: UBLJsonInvoiceLine[];
}

/**
 * Invoice content (v1.1 - with signature support)
 */
export interface UBLJsonInvoiceContentV1_1 extends UBLJsonInvoiceContentV1_0 {
  UBLExtensions?: UBLJsonUBLExtensions[];
  Signature?: UBLJsonSignature[];
}

/**
 * UBL JSON Invoice Document (v1.0)
 */
export interface UBLJsonInvoiceV1_0 {
  _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
  _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
  Invoice: UBLJsonInvoiceContentV1_0[];
}

/**
 * UBL JSON Invoice Document (v1.1)
 */
export interface UBLJsonInvoiceV1_1 {
  _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
  _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
  Invoice: UBLJsonInvoiceContentV1_1[];
}

/**
 * UBL JSON Invoice (union type)
 */
export type UBLJsonInvoice = UBLJsonInvoiceV1_0 | UBLJsonInvoiceV1_1;

// =============================================================================
// Credit Note Types
// =============================================================================

/**
 * Credit note line
 */
export interface UBLJsonCreditNoteLine {
  ID: UBLJsonIdentifier;
  CreditedQuantity: UBLJsonQuantity;
  LineExtensionAmount: UBLJsonAmount;
  AllowanceCharge?: UBLJsonAllowanceCharge[];
  TaxTotal: UBLJsonTaxTotal[];
  Item: UBLJsonItem[];
  Price: UBLJsonPrice[];
  ItemPriceExtension?: UBLJsonItemPriceExtension[];
}

/**
 * Credit note content
 */
export interface UBLJsonCreditNoteContent {
  ID: UBLJsonIdentifier;
  IssueDate: UBLJsonDate;
  IssueTime: UBLJsonTime;
  CreditNoteTypeCode?: Array<{
    _: InvoiceTypeCode;
    listVersionID: string;
  }>;
  DocumentCurrencyCode: Array<UBLJsonValue<CurrencyCode>>;
  InvoicePeriod?: UBLJsonInvoicePeriod[];
  BillingReference?: UBLJsonBillingReference[];
  AccountingSupplierParty: UBLJsonAccountingSupplierParty[];
  AccountingCustomerParty: UBLJsonAccountingCustomerParty[];
  PaymentMeans?: UBLJsonPaymentMeans[];
  TaxTotal: UBLJsonTaxTotal[];
  LegalMonetaryTotal: UBLJsonLegalMonetaryTotal[];
  CreditNoteLine: UBLJsonCreditNoteLine[];
}

/**
 * UBL JSON Credit Note Document
 */
export interface UBLJsonCreditNote {
  _D: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
  _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
  _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
  CreditNote: UBLJsonCreditNoteContent[];
}

// =============================================================================
// Debit Note Types
// =============================================================================

/**
 * Debit note line
 */
export interface UBLJsonDebitNoteLine {
  ID: UBLJsonIdentifier;
  DebitedQuantity: UBLJsonQuantity;
  LineExtensionAmount: UBLJsonAmount;
  AllowanceCharge?: UBLJsonAllowanceCharge[];
  TaxTotal: UBLJsonTaxTotal[];
  Item: UBLJsonItem[];
  Price: UBLJsonPrice[];
  ItemPriceExtension?: UBLJsonItemPriceExtension[];
}

/**
 * Debit note content
 */
export interface UBLJsonDebitNoteContent {
  ID: UBLJsonIdentifier;
  IssueDate: UBLJsonDate;
  IssueTime: UBLJsonTime;
  DebitNoteTypeCode?: Array<{
    _: InvoiceTypeCode;
    listVersionID: string;
  }>;
  DocumentCurrencyCode: Array<UBLJsonValue<CurrencyCode>>;
  InvoicePeriod?: UBLJsonInvoicePeriod[];
  BillingReference?: UBLJsonBillingReference[];
  AccountingSupplierParty: UBLJsonAccountingSupplierParty[];
  AccountingCustomerParty: UBLJsonAccountingCustomerParty[];
  PaymentMeans?: UBLJsonPaymentMeans[];
  TaxTotal: UBLJsonTaxTotal[];
  LegalMonetaryTotal: UBLJsonLegalMonetaryTotal[];
  DebitNoteLine: UBLJsonDebitNoteLine[];
}

/**
 * UBL JSON Debit Note Document
 */
export interface UBLJsonDebitNote {
  _D: "urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2";
  _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
  _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
  DebitNote: UBLJsonDebitNoteContent[];
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * Any UBL JSON document type
 */
export type UBLJsonDocument = UBLJsonInvoice | UBLJsonCreditNote | UBLJsonDebitNote;
