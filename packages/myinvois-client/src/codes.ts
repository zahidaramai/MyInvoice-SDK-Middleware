/**
 * MyInvois Codes and Enums
 *
 * Comprehensive type definitions for all MyInvois code values.
 * Based on LHDN MyInvois SDK specification.
 */

/**
 * Invoice Type Codes
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/e-invoice-type-code/
 */
export type InvoiceTypeCode =
  | "01" // Invoice
  | "02" // Credit Note
  | "03" // Debit Note
  | "04" // Refund Note
  | "11" // Self-billed Invoice
  | "12" // Self-billed Credit Note
  | "13" // Self-billed Debit Note
  | "14"; // Self-billed Refund Note

export const InvoiceTypeCodes = {
  INVOICE: "01" as const,
  CREDIT_NOTE: "02" as const,
  DEBIT_NOTE: "03" as const,
  REFUND_NOTE: "04" as const,
  SELF_BILLED_INVOICE: "11" as const,
  SELF_BILLED_CREDIT_NOTE: "12" as const,
  SELF_BILLED_DEBIT_NOTE: "13" as const,
  SELF_BILLED_REFUND_NOTE: "14" as const,
} as const;

export const InvoiceTypeDescriptions: Record<InvoiceTypeCode, string> = {
  "01": "Invoice",
  "02": "Credit Note",
  "03": "Debit Note",
  "04": "Refund Note",
  "11": "Self-billed Invoice",
  "12": "Self-billed Credit Note",
  "13": "Self-billed Debit Note",
  "14": "Self-billed Refund Note",
};

/**
 * Classification Codes
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/classification-codes/
 */
export type ClassificationCode =
  | "001"
  | "002"
  | "003"
  | "004"
  | "005"
  | "006"
  | "007"
  | "008"
  | "009"
  | "010"
  | "011"
  | "012"
  | "013"
  | "014"
  | "015"
  | "016"
  | "017"
  | "018"
  | "019"
  | "020"
  | "021"
  | "022"
  | "023"
  | "024"
  | "025"
  | "026"
  | "027"
  | "028"
  | "029"
  | "030"
  | "031"
  | "032"
  | "033"
  | "034"
  | "035"
  | "036"
  | "037"
  | "038"
  | "039"
  | "040"
  | "041"
  | "042"
  | "043"
  | "044"
  | "045";

export const ClassificationCodes = {
  BREASTFEEDING_EQUIPMENT: "001" as const,
  CHILD_CARE_CENTRE_KINDERGARTEN: "002" as const,
  COMPUTER_SMARTPHONE_TABLET: "003" as const,
  CONSOLIDATED_E_INVOICE: "004" as const,
  CONSTRUCTION_MATERIALS: "005" as const,
  DISBURSEMENT: "006" as const,
  DONATION: "007" as const,
  EBOOK_BOOK_JOURNAL: "008" as const,
  EDUCATION_FEES: "009" as const,
  ELECTRIC_VEHICLE_CHARGING: "010" as const,
  GOODS_ON_CONSIGNMENT: "011" as const,
  GYM_MEMBERSHIP: "012" as const,
  INSURANCE_EPF_SOCSO: "013" as const,
  INTERNET_SUBSCRIPTION: "014" as const,
  LIFESTYLE: "015" as const,
  MEDICAL_EXAMINATION: "016" as const,
  MEDICAL_EXPENSES_SERIOUS_DISEASE: "017" as const,
  MEDICAL_EXPENSES_FERTILITY: "018" as const,
  MEDICAL_EXPENSES_VACCINATION: "019" as const,
  MEDICAL_EXPENSES_MENTAL: "020" as const,
  OTHERS: "021" as const,
  PARKING_FEE: "022" as const,
  PRIVATE_RETIREMENT_SCHEME: "023" as const,
  MOTOR_VEHICLE: "024" as const,
  REIMBURSEMENT: "025" as const,
  RENTAL_OF_MOTOR_VEHICLE: "026" as const,
  EV_CHARGING_FACILITIES_LEASE: "027" as const,
  SPORTS_EQUIPMENT_RENTAL: "028" as const,
  SUPPORTING_EQUIPMENT_DISABLED: "029" as const,
  TOUR_TRAVEL_AGENCY: "030" as const,
  VEHICLE_EXPENSES: "031" as const,
  DENTAL_EXAMINATION: "032" as const,
  TRAINING: "033" as const,
  SELF_BILLED_BETTING_GAMING: "034" as const,
  SELF_BILLED_IMPORTS: "035" as const,
  SELF_BILLED_LOTTERY_GAMING: "036" as const,
  SELF_BILLED_MONETARY_PAYMENT: "037" as const,
  SELF_BILLED_OTHERS: "038" as const,
  SELF_BILLED_PAYER_PAYEE_AGENT: "039" as const,
  PETROLEUM_OPERATIONS: "040" as const,
  NOT_APPLICABLE: "041" as const,
  FOREIGN_INCOME: "042" as const,
  CLAIM: "043" as const,
  E_COMMERCE: "044" as const,
  RETURN: "045" as const,
} as const;

/**
 * Country Code ISO 3166-1 Alpha-3
 * Common codes for Malaysian e-invoicing
 */
export type CountryCodeISO3166Alpha3 =
  | "MYS" // Malaysia
  | "SGP" // Singapore
  | "IDN" // Indonesia
  | "THA" // Thailand
  | "PHL" // Philippines
  | "VNM" // Vietnam
  | "BRN" // Brunei
  | "MMR" // Myanmar
  | "KHM" // Cambodia
  | "LAO" // Laos
  | "CHN" // China
  | "HKG" // Hong Kong
  | "TWN" // Taiwan
  | "JPN" // Japan
  | "KOR" // South Korea
  | "IND" // India
  | "AUS" // Australia
  | "NZL" // New Zealand
  | "USA" // United States
  | "GBR" // United Kingdom
  | "DEU" // Germany
  | "FRA" // France
  | "NLD" // Netherlands
  | "ARE" // United Arab Emirates
  | "SAU" // Saudi Arabia
  | string; // Allow other valid ISO codes

export const CountryCodes = {
  MALAYSIA: "MYS" as const,
  SINGAPORE: "SGP" as const,
  INDONESIA: "IDN" as const,
  THAILAND: "THA" as const,
  PHILIPPINES: "PHL" as const,
  VIETNAM: "VNM" as const,
  BRUNEI: "BRN" as const,
  MYANMAR: "MMR" as const,
  CAMBODIA: "KHM" as const,
  LAOS: "LAO" as const,
  CHINA: "CHN" as const,
  HONG_KONG: "HKG" as const,
  TAIWAN: "TWN" as const,
  JAPAN: "JPN" as const,
  SOUTH_KOREA: "KOR" as const,
  INDIA: "IND" as const,
  AUSTRALIA: "AUS" as const,
  NEW_ZEALAND: "NZL" as const,
  UNITED_STATES: "USA" as const,
  UNITED_KINGDOM: "GBR" as const,
  GERMANY: "DEU" as const,
  FRANCE: "FRA" as const,
  NETHERLANDS: "NLD" as const,
  UAE: "ARE" as const,
  SAUDI_ARABIA: "SAU" as const,
} as const;

/**
 * Currency Code ISO 4217
 * Common currencies for Malaysian e-invoicing
 */
export type CurrencyCode =
  | "MYR" // Malaysian Ringgit
  | "USD" // US Dollar
  | "SGD" // Singapore Dollar
  | "EUR" // Euro
  | "GBP" // British Pound
  | "JPY" // Japanese Yen
  | "CNY" // Chinese Yuan
  | "AUD" // Australian Dollar
  | "THB" // Thai Baht
  | "IDR" // Indonesian Rupiah
  | "PHP" // Philippine Peso
  | "INR" // Indian Rupee
  | "AED" // UAE Dirham
  | "SAR" // Saudi Riyal
  | string; // Allow other valid ISO codes

export const CurrencyCodes = {
  MYR: "MYR" as const,
  USD: "USD" as const,
  SGD: "SGD" as const,
  EUR: "EUR" as const,
  GBP: "GBP" as const,
  JPY: "JPY" as const,
  CNY: "CNY" as const,
  AUD: "AUD" as const,
  THB: "THB" as const,
  IDR: "IDR" as const,
  PHP: "PHP" as const,
  INR: "INR" as const,
  AED: "AED" as const,
  SAR: "SAR" as const,
} as const;

/**
 * Payment Mode Codes
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/payment-mode/
 */
export type PaymentModeCode =
  | "01" // Cash
  | "02" // Cheque
  | "03" // Bank Transfer
  | "04" // Credit Card
  | "05" // Debit Card
  | "06" // e-Wallet / Digital Wallet
  | "07" // Digital Bank
  | "08"; // Others

export const PaymentModeCodes = {
  CASH: "01" as const,
  CHEQUE: "02" as const,
  BANK_TRANSFER: "03" as const,
  CREDIT_CARD: "04" as const,
  DEBIT_CARD: "05" as const,
  E_WALLET: "06" as const,
  DIGITAL_BANK: "07" as const,
  OTHERS: "08" as const,
} as const;

export const PaymentModeDescriptions: Record<PaymentModeCode, string> = {
  "01": "Cash",
  "02": "Cheque",
  "03": "Bank Transfer",
  "04": "Credit Card",
  "05": "Debit Card",
  "06": "e-Wallet / Digital Wallet",
  "07": "Digital Bank",
  "08": "Others",
};

/**
 * Malaysian State Codes
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/state-codes/
 */
export type MalaysianStateCode =
  | "01" // Johor
  | "02" // Kedah
  | "03" // Kelantan
  | "04" // Melaka
  | "05" // Negeri Sembilan
  | "06" // Pahang
  | "07" // Pulau Pinang
  | "08" // Perak
  | "09" // Perlis
  | "10" // Selangor
  | "11" // Terengganu
  | "12" // Sabah
  | "13" // Sarawak
  | "14" // Wilayah Persekutuan Kuala Lumpur
  | "15" // Wilayah Persekutuan Labuan
  | "16" // Wilayah Persekutuan Putrajaya
  | "17"; // Not Applicable

export const MalaysianStateCodes = {
  JOHOR: "01" as const,
  KEDAH: "02" as const,
  KELANTAN: "03" as const,
  MELAKA: "04" as const,
  NEGERI_SEMBILAN: "05" as const,
  PAHANG: "06" as const,
  PULAU_PINANG: "07" as const,
  PERAK: "08" as const,
  PERLIS: "09" as const,
  SELANGOR: "10" as const,
  TERENGGANU: "11" as const,
  SABAH: "12" as const,
  SARAWAK: "13" as const,
  WP_KUALA_LUMPUR: "14" as const,
  WP_LABUAN: "15" as const,
  WP_PUTRAJAYA: "16" as const,
  NOT_APPLICABLE: "17" as const,
} as const;

export const MalaysianStateNames: Record<MalaysianStateCode, string> = {
  "01": "Johor",
  "02": "Kedah",
  "03": "Kelantan",
  "04": "Melaka",
  "05": "Negeri Sembilan",
  "06": "Pahang",
  "07": "Pulau Pinang",
  "08": "Perak",
  "09": "Perlis",
  "10": "Selangor",
  "11": "Terengganu",
  "12": "Sabah",
  "13": "Sarawak",
  "14": "Wilayah Persekutuan Kuala Lumpur",
  "15": "Wilayah Persekutuan Labuan",
  "16": "Wilayah Persekutuan Putrajaya",
  "17": "Not Applicable",
};

/**
 * Tax Type Codes
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/tax-type/
 */
export type TaxTypeCode =
  | "01" // Sales Tax
  | "02" // Service Tax
  | "03" // Tourism Tax
  | "04" // High-Value Goods Tax
  | "05" // Sales Tax on Low Value Goods
  | "06" // Not Applicable
  | "E"; // Tax Exemption

export const TaxTypeCodes = {
  SALES_TAX: "01" as const,
  SERVICE_TAX: "02" as const,
  TOURISM_TAX: "03" as const,
  HIGH_VALUE_GOODS_TAX: "04" as const,
  SALES_TAX_LOW_VALUE: "05" as const,
  NOT_APPLICABLE: "06" as const,
  TAX_EXEMPTION: "E" as const,
} as const;

export const TaxTypeDescriptions: Record<TaxTypeCode, string> = {
  "01": "Sales Tax",
  "02": "Service Tax",
  "03": "Tourism Tax",
  "04": "High-Value Goods Tax",
  "05": "Sales Tax on Low Value Goods",
  "06": "Not Applicable",
  E: "Tax Exemption",
};

/**
 * Tax Exemption Reason Codes
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/tax-exemption/
 */
export type TaxExemptionCode =
  | "TBEX01" // Tax Exemption - Buyer exemption under Sales Tax Act 2018 Section 35
  | "TBEX02" // Tax Exemption - Supplier Exemption
  | "TBEX03" // Tax Exemption - Sales to Designated Area / Special Area
  | "TBEX04" // Tax Exemption - Others
  | "OSEX01" // Out of Scope - Supplier not registered for SST
  | "OSEX02" // Out of Scope - Services not subject to SST
  | "OSEX03" // Out of Scope - Goods not subject to SST
  | "OSEX04" // Out of Scope - Transaction out of scope
  | "OSEX05" // Out of Scope - Others
  | "SREX01" // Special Rate - Senior Citizen
  | "SREX02" // Special Rate - Disabled Person
  | "SREX03"; // Special Rate - Others

export const TaxExemptionCodes = {
  BUYER_EXEMPTION: "TBEX01" as const,
  SUPPLIER_EXEMPTION: "TBEX02" as const,
  DESIGNATED_AREA: "TBEX03" as const,
  OTHER_EXEMPTION: "TBEX04" as const,
  NOT_REGISTERED_SST: "OSEX01" as const,
  SERVICES_NOT_SUBJECT: "OSEX02" as const,
  GOODS_NOT_SUBJECT: "OSEX03" as const,
  OUT_OF_SCOPE: "OSEX04" as const,
  OTHER_OUT_OF_SCOPE: "OSEX05" as const,
  SENIOR_CITIZEN: "SREX01" as const,
  DISABLED_PERSON: "SREX02" as const,
  OTHER_SPECIAL_RATE: "SREX03" as const,
} as const;

/**
 * Taxpayer ID Type
 * Reference: https://sdk.myinvois.hasil.gov.my/codes/taxpayer-id-type/
 */
export type TaxpayerIdType = "NRIC" | "PASSPORT" | "BRN" | "ARMY";

export const TaxpayerIdTypes = {
  NRIC: "NRIC" as const,
  PASSPORT: "PASSPORT" as const,
  BRN: "BRN" as const,
  ARMY: "ARMY" as const,
} as const;

export const TaxpayerIdTypeDescriptions: Record<TaxpayerIdType, string> = {
  NRIC: "National Registration Identity Card Number",
  PASSPORT: "Passport Number",
  BRN: "Business Registration Number",
  ARMY: "Army Number",
};

/**
 * Party Identification Scheme IDs
 */
export type PartyIdScheme =
  | "TIN" // Tax Identification Number
  | "NRIC" // National Registration Identity Card
  | "PASSPORT" // Passport Number
  | "BRN" // Business Registration Number
  | "ARMY" // Army Number
  | "SST" // Sales and Service Tax Registration Number
  | "TTX"; // Tourism Tax Registration Number

export const PartyIdSchemes = {
  TIN: "TIN" as const,
  NRIC: "NRIC" as const,
  PASSPORT: "PASSPORT" as const,
  BRN: "BRN" as const,
  ARMY: "ARMY" as const,
  SST: "SST" as const,
  TTX: "TTX" as const,
} as const;

/**
 * Unit Codes (UN/ECE Recommendation 20)
 * Common units for Malaysian e-invoicing
 */
export type UnitCode =
  | "C62" // One (unit)
  | "KGM" // Kilogram
  | "MTR" // Metre
  | "LTR" // Litre
  | "PCE" // Piece
  | "SET" // Set
  | "BX" // Box
  | "PK" // Pack
  | "H87" // Piece (alternate)
  | "DAY" // Day
  | "MON" // Month
  | "HUR" // Hour
  | "MTK" // Square metre
  | "MTQ" // Cubic metre
  | string; // Allow other valid UN/ECE codes

export const UnitCodes = {
  UNIT: "C62" as const,
  KILOGRAM: "KGM" as const,
  METRE: "MTR" as const,
  LITRE: "LTR" as const,
  PIECE: "PCE" as const,
  SET: "SET" as const,
  BOX: "BX" as const,
  PACK: "PK" as const,
  PIECE_ALT: "H87" as const,
  DAY: "DAY" as const,
  MONTH: "MON" as const,
  HOUR: "HUR" as const,
  SQUARE_METRE: "MTK" as const,
  CUBIC_METRE: "MTQ" as const,
} as const;

/**
 * MyInvois Document Status (Title Case - as returned by some APIs)
 * Note: Some APIs return lowercase status (valid, invalid, etc.)
 * See einvoice/types.ts DocumentStatus for lowercase version
 */
export type MyInvoisDocumentStatus = "Valid" | "Invalid" | "Cancelled" | "Rejected" | "Pending";

export const MyInvoisDocumentStatuses = {
  VALID: "Valid" as const,
  INVALID: "Invalid" as const,
  CANCELLED: "Cancelled" as const,
  REJECTED: "Rejected" as const,
  PENDING: "Pending" as const,
} as const;

/**
 * MSIC Codes (Malaysia Standard Industrial Classification)
 * Common codes - full list available from LHDN
 */
export type MSICCode = string; // 5-digit code

export const CommonMSICCodes = {
  WHOLESALE_COMPUTERS: "46510" as const,
  RETAIL_COMPUTERS: "47411" as const,
  SOFTWARE_DEVELOPMENT: "62010" as const,
  IT_CONSULTANCY: "62020" as const,
  GENERAL_RETAIL: "47190" as const,
  RESTAURANT: "56101" as const,
  CONSTRUCTION: "41001" as const,
  MANUFACTURING: "10101" as const,
  PROFESSIONAL_SERVICES: "69100" as const,
  ACCOUNTING: "69201" as const,
} as const;
