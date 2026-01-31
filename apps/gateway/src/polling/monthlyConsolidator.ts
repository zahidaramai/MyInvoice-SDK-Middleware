/**
 * Daily Invoice Consolidator
 *
 * Runs in-process (like AutoPoller) to consolidate DRAFT invoices
 * every day at 1:00 AM Malaysia time.
 *
 * This runs directly in the gateway process - no separate worker needed.
 *
 * Schedule: Daily @ 1:00 AM MYT (UTC+8)
 *
 * How it works:
 * 1. Checks every hour if it's the consolidation window
 * 2. Daily between 1:00-2:00 AM MYT, runs consolidation
 * 3. Consolidates all DRAFT invoices per company
 * 4. Submits single consolidated e-invoice to MyInvois
 * 5. Marks original DRAFTs as SUBMITTED with shared UUID
 */

import { getPrismaClient } from "@myinvois/storage";
import {
  createTokenManager,
  submitDocuments,
  type SessionCredentials,
} from "@myinvois/myinvois-client";
import type { Environment, Mode } from "@myinvois/core";
import crypto from "crypto";

interface Company {
  id: string;
  name: string;
  tin: string;
  idValue: string;
  idType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  industryCode: string | null;
  industryName: string | null;
  sstRegistration: string | null;
  ttxRegistration: string | null;
  myinvoisClientId: string | null;
  myinvoisClientSecret: string | null;
  myinvoisEnv: string | null;
}

interface Invoice {
  id: string;
  companyId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  rawPayload: string;
  amount: string;
  discount: string | null;
  rounding: string | null;
  taxAmount: string;
  total: string;
  company: Company;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}

interface ErpConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  env: string;
}

interface ConsolidatedItem {
  description: string;
  taxCode: string;
  taxRate: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxAmount: number;
  total: number;
}

/** Raw item structure from invoice payload */
interface RawInvoiceItem {
  description?: string;
  taxCode?: string;
  taxRate?: number;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  taxAmount?: number;
  total?: number;
}


let consolidatorInterval: NodeJS.Timeout | null = null;
let isConsolidating = false;
// P2-04: Removed in-memory lastConsolidationDate - now queries database instead

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

/**
 * Check if monthly consolidation feature is enabled
 * This is a feature flag to isolate consolidation from core submission flow
 */
function isConsolidationEnabled(): boolean {
  return process.env.ENABLE_MONTHLY_CONSOLIDATION === "true";
}
const CONSOLIDATION_HOUR_START = 1; // 1:00 AM MYT
const CONSOLIDATION_HOUR_END = 2; // Before 2:00 AM MYT

/**
 * Get ERP configuration from environment
 */
function getErpConfig(): ErpConfig {
  const enabled = process.env.ERP_MODE === "true";

  if (!enabled) {
    return { enabled: false, clientId: "", clientSecret: "", env: "SANDBOX" };
  }

  const clientId = process.env.ERP_MYINVOIS_CLIENT_ID || "";
  const clientSecret = process.env.ERP_MYINVOIS_CLIENT_SECRET || "";
  const env = process.env.ERP_MYINVOIS_ENV || "SANDBOX";

  return { enabled, clientId, clientSecret, env };
}

/**
 * P2-06: Robust timezone handling using Intl.DateTimeFormat
 * More reliable across Node.js versions than toLocaleString() parsing
 */
function getMalaysiaTimeComponents(): { year: number; month: number; day: number; hour: number; minute: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const partsMap: Record<string, string> = {};
  for (const part of parts) {
    partsMap[part.type] = part.value;
  }

  return {
    year: parseInt(partsMap.year, 10),
    month: parseInt(partsMap.month, 10),
    day: parseInt(partsMap.day, 10),
    hour: parseInt(partsMap.hour, 10),
    minute: parseInt(partsMap.minute, 10),
  };
}

/**
 * Check if current time is within the consolidation window
 * (Daily 1:00-2:00 AM Malaysia time)
 */
function isConsolidationWindow(): boolean {
  const { hour } = getMalaysiaTimeComponents();
  return hour >= CONSOLIDATION_HOUR_START && hour < CONSOLIDATION_HOUR_END;
}

/**
 * Get today's date string in MYT for tracking runs (YYYY-MM-DD format)
 */
function getTodayMYT(): string {
  const { year, month, day } = getMalaysiaTimeComponents();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * P2-04: Check if consolidation has already run today by querying the database
 * This replaces the in-memory lastConsolidationDate tracking
 */
async function hasConsolidatedToday(): Promise<boolean> {
  const prisma = getPrismaClient();
  const todayMYT = getTodayMYT();

  // Check for any CONSOLIDATE type invoice created today (within the last 24 hours)
  // Using UTC date range that corresponds to today in MYT
  const { year, month, day } = getMalaysiaTimeComponents();
  const startOfDayMYT = new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0)); // 00:00 MYT = 16:00 UTC previous day
  const endOfDayMYT = new Date(Date.UTC(year, month - 1, day, 15, 59, 59, 999)); // 23:59 MYT = 15:59 UTC same day

  const consolidatedToday = await prisma.invoice.findFirst({
    where: {
      invoiceType: "CONSOLIDATE",
      status: { in: ["SUBMITTED", "VALID"] },
      createdAt: {
        gte: startOfDayMYT,
        lte: endOfDayMYT,
      },
      // Only count invoices created by the scheduled consolidator (have CONS- prefix)
      invoiceNumber: { startsWith: `CONS-${todayMYT.replace(/-/g, "")}` },
    },
    select: { id: true },
  });

  return consolidatedToday !== null;
}

/**
 * Consolidate items by description + taxCode
 */
function consolidateItems(invoices: Invoice[]): ConsolidatedItem[] {
  const itemMap = new Map<string, ConsolidatedItem>();

  for (const invoice of invoices) {
    let items: RawInvoiceItem[] = [];
    try {
      const payload = JSON.parse(invoice.rawPayload) as {
        items?: RawInvoiceItem[];
        invoices?: Array<{ items?: RawInvoiceItem[] }>;
      };
      // Handle both rawPayload formats:
      // 1. POS format: { items: [...] } - items at root level
      // 2. hashlhdn/documents/submit format: { invoices: [{ items: [...] }] } - nested under invoices[0]
      items = payload.items || payload.invoices?.[0]?.items || [];
    } catch {
      continue; // Skip invalid JSON
    }

    for (const item of items) {
      const key = `${item.description}||${item.taxCode}`;
      const existing = itemMap.get(key);

      if (existing) {
        existing.quantity += item.quantity || 0;
        existing.discount += item.discount || 0;
        existing.taxAmount += item.taxAmount || 0;
        existing.total += item.total || 0;
      } else {
        itemMap.set(key, {
          description: item.description || "Item",
          taxCode: item.taxCode || "06",
          taxRate: item.taxRate || 0,
          quantity: item.quantity || 0,
          unitPrice: item.unitPrice || 0,
          discount: item.discount || 0,
          taxAmount: item.taxAmount || 0,
          total: item.total || 0,
        });
      }
    }
  }

  return Array.from(itemMap.values());
}

/**
 * Calculate totals from consolidated items
 */
function calculateTotals(items: ConsolidatedItem[]): {
  amount: number;
  discount: number;
  taxAmount: number;
  total: number;
  rounding: number;
} {
  let amount = 0;
  let discount = 0;
  let taxAmount = 0;
  let total = 0;

  for (const item of items) {
    amount += item.quantity * item.unitPrice;
    discount += item.discount;
    taxAmount += item.taxAmount;
    total += item.total;
  }

  // Rounding is typically 0 for consolidated invoices
  return { amount, discount, taxAmount, total, rounding: 0 };
}

/**
 * Round to 2 decimal places, returning a NUMBER (not string)
 * This matches the working transformer.ts pattern
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build UBL 2.1 consolidated invoice document
 */
function buildConsolidatedUBL(
  company: Company,
  invoiceNumber: string,
  invoiceDate: Date,
  items: ConsolidatedItem[],
  totals: { amount: number; discount: number; taxAmount: number; total: number; rounding: number }
): Record<string, unknown> {
  const dateStr = invoiceDate.toISOString().slice(0, 10);
  const timeStr = invoiceDate.toISOString().slice(11, 19) + "Z";

  // Group items by tax code for tax subtotals
  const taxSubtotals: Array<Record<string, unknown>> = [];
  const taxGroups = new Map<string, { taxableAmount: number; taxAmount: number; taxRate: number }>();

  for (const item of items) {
    const key = item.taxCode;
    const existing = taxGroups.get(key);
    const lineAmount = item.quantity * item.unitPrice - item.discount;

    if (existing) {
      existing.taxableAmount += lineAmount;
      existing.taxAmount += item.taxAmount;
    } else {
      taxGroups.set(key, {
        taxableAmount: lineAmount,
        taxAmount: item.taxAmount,
        taxRate: item.taxRate,
      });
    }
  }

  for (const [taxCode, group] of taxGroups) {
    taxSubtotals.push({
      TaxableAmount: [{ _: round2(group.taxableAmount), currencyID: "MYR" }],
      TaxAmount: [{ _: round2(group.taxAmount), currencyID: "MYR" }],
      TaxCategory: [
        {
          ID: [{ _: taxCode }],
          Percent: [{ _: round2(group.taxRate) }],
          TaxScheme: [{ ID: [{ _: "OTH" }] }],
        },
      ],
    });
  }

  // Build invoice lines - use round2() for numbers, matching transformer.ts pattern
  const invoiceLines = items.map((item, index) => {
    const lineAmount = round2(item.quantity * item.unitPrice - item.discount);

    // Build base invoice line without AllowanceCharge
    const invoiceLine: Record<string, unknown> = {
      ID: [{ _: String(index + 1) }],
      InvoicedQuantity: [{ _: round2(item.quantity), unitCode: "C62" }],
      LineExtensionAmount: [{ _: lineAmount, currencyID: "MYR" }],
    };

    // Only add AllowanceCharge if discount > 0 (matching transformer.ts pattern)
    // Empty array causes "TooFewItems" validation error
    if (item.discount > 0) {
      invoiceLine.AllowanceCharge = [
        {
          ChargeIndicator: [{ _: false }],
          AllowanceChargeReason: [{ _: "Discount" }],
          Amount: [{ _: round2(item.discount), currencyID: "MYR" }],
        },
      ];
    }

    // Add remaining fields
    invoiceLine.TaxTotal = [
      {
        TaxAmount: [{ _: round2(item.taxAmount), currencyID: "MYR" }],
        TaxSubtotal: [
          {
            TaxableAmount: [{ _: lineAmount, currencyID: "MYR" }],
            TaxAmount: [{ _: round2(item.taxAmount), currencyID: "MYR" }],
            TaxCategory: [
              {
                ID: [{ _: item.taxCode }],
                Percent: [{ _: round2(item.taxRate) }],
                TaxScheme: [{ ID: [{ _: "OTH" }] }],
              },
            ],
          },
        ],
      },
    ];

    invoiceLine.Item = [
      {
        Description: [{ _: item.description }],
        CommodityClassification: [
          {
            // Classification code 004 is REQUIRED for consolidated invoices per MyInvois spec
            // (ERR236: General TIN only valid with Classification Code 004)
            ItemClassificationCode: [{ _: "004", listID: "CLASS" }],
          },
        ],
      },
    ];

    invoiceLine.Price = [
      {
        PriceAmount: [{ _: round2(item.unitPrice), currencyID: "MYR" }],
      },
    ];

    invoiceLine.ItemPriceExtension = [
      {
        Amount: [{ _: round2(item.quantity * item.unitPrice), currencyID: "MYR" }],
      },
    ];

    return invoiceLine;
  });

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: invoiceNumber }],
        IssueDate: [{ _: dateStr }],
        IssueTime: [{ _: timeStr }],
        InvoiceTypeCode: [{ _: "01", listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: dateStr }],
            EndDate: [{ _: dateStr }],
            Description: [{ _: "Daily Consolidated Invoice" }],
          },
        ],
        BillingReference: [
          {
            AdditionalDocumentReference: [
              {
                ID: [{ _: invoiceNumber }],
              },
            ],
          },
        ],
        AccountingSupplierParty: [
          {
            Party: [
              {
                IndustryClassificationCode: [
                  { _: company.industryCode || "46900", name: company.industryName || "Wholesale" },
                ],
                PartyIdentification: [
                  { ID: [{ _: company.tin, schemeID: "TIN" }] },
                  { ID: [{ _: company.idValue, schemeID: company.idType || "BRN" }] },
                  ...(company.sstRegistration
                    ? [{ ID: [{ _: company.sstRegistration, schemeID: "SST" }] }]
                    : []),
                  ...(company.ttxRegistration
                    ? [{ ID: [{ _: company.ttxRegistration, schemeID: "TTX" }] }]
                    : []),
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: company.city || "" }],
                    PostalZone: [{ _: company.postalCode || "" }],
                    CountrySubentityCode: [{ _: company.state || "14" }],
                    AddressLine: [{ Line: [{ _: company.address || "" }] }],
                    Country: [{ IdentificationCode: [{ _: company.country || "MYS" }] }],
                  },
                ],
                PartyLegalEntity: [
                  {
                    RegistrationName: [{ _: company.name }],
                  },
                ],
                Contact: [
                  {
                    Telephone: [{ _: company.phone || "" }],
                    ElectronicMail: [{ _: company.email || "" }],
                  },
                ],
              },
            ],
          },
        ],
        // AccountingCustomerParty - EXACTLY matching transformer.ts buildConsolidatedCustomerParty()
        AccountingCustomerParty: [
          {
            Party: [
              {
                // All 4 PartyIdentification entries required per MyInvois
                PartyIdentification: [
                  { ID: [{ _: "EI00000000010", schemeID: "TIN" }] },
                  { ID: [{ _: "NA", schemeID: "BRN" }] },
                  { ID: [{ _: "NA", schemeID: "SST" }] },
                  { ID: [{ _: "NA", schemeID: "TTX" }] },
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: "NA" }],
                    PostalZone: [{ _: "00000" }],
                    CountrySubentityCode: [{ _: "17" }],
                    AddressLine: [{ Line: [{ _: "NA" }] }],
                    Country: [{ IdentificationCode: [{ _: "MYS" }] }],
                  },
                ],
                PartyLegalEntity: [
                  {
                    RegistrationName: [{ _: "General Public" }],
                  },
                ],
                Contact: [
                  {
                    // MyInvois requires valid phone format (no "NA")
                    Telephone: [{ _: "+60000000000" }],
                    ElectronicMail: [{ _: "na@na.com" }],
                  },
                ],
              },
            ],
          },
        ],
        TaxTotal: [
          {
            TaxAmount: [{ _: round2(totals.taxAmount), currencyID: "MYR" }],
            TaxSubtotal: taxSubtotals,
          },
        ],
        // LegalMonetaryTotal - EXACTLY matching transformer.ts pattern
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: round2(totals.amount), currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: round2(totals.amount - totals.discount), currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: round2(totals.total), currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: round2(totals.discount), currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: round2(totals.rounding), currencyID: "MYR" }],
            PayableAmount: [{ _: round2(totals.total), currencyID: "MYR" }],
          },
        ],
        // PaymentMeans - matching transformer.ts pattern
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "08" }], // Others
          },
        ],
        InvoiceLine: invoiceLines,
      },
    ],
  };
}

/**
 * Run daily consolidation for all companies
 */
async function runDailyConsolidation(logger: Logger, manual: boolean = false): Promise<{
  processed: number;
  submitted: number;
  failed: number;
  errors: string[];
}> {
  const results = { processed: 0, submitted: 0, failed: 0, errors: [] as string[] };

  if (isConsolidating) {
    logger.info("[Consolidator] Already running, skipping");
    return results;
  }

  isConsolidating = true;
  const startTime = Date.now();

  try {
    const prisma = getPrismaClient();
    const erpConfig = getErpConfig();

    logger.info(`[Consolidator] Starting daily consolidation (${manual ? "manual trigger" : "scheduled"})`);
    logger.info(`[Consolidator] Mode: ${erpConfig.enabled ? "ERP (INTERMEDIARY)" : "Standard (TAXPAYER)"}`);

    // Get all companies
    const companies = await prisma.company.findMany({
      where: { isActive: true },
    });

    logger.info(`[Consolidator] Found ${companies.length} active companies`);

    for (const company of companies) {
      try {
        // Get DRAFT invoices for this company
        const drafts = await prisma.invoice.findMany({
          where: {
            companyId: company.id,
            status: "DRAFT",
          },
          include: { company: true },
        });

        if (drafts.length === 0) {
          logger.info(`[Consolidator] ${company.name}: No DRAFT invoices, skipping`);
          continue;
        }

        results.processed++;
        logger.info(`[Consolidator] ${company.name}: Processing ${drafts.length} DRAFT invoices`);

        // Consolidate items
        const items = consolidateItems(drafts);
        const totals = calculateTotals(items);

        if (items.length === 0) {
          logger.warn(`[Consolidator] ${company.name}: No items to consolidate`);
          continue;
        }

        // Generate invoice number with timestamp to ensure uniqueness for same-day runs
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
        const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");
        const invoiceNumber = `CONS-${dateStr}-${timeStr}-${company.id.slice(0, 8)}`;

        // Build UBL document
        const ublDocument = buildConsolidatedUBL(company, invoiceNumber, now, items, totals);

        logger.info(`[Consolidator] ${company.name}: Built ${invoiceNumber} with ${items.length} items, total: RM${totals.total.toFixed(2)}`);

        // Submit to MyInvois
        if (!erpConfig.enabled) {
          logger.warn(`[Consolidator] ${company.name}: ERP mode not enabled, skipping submission`);
          continue;
        }

        const isProd = erpConfig.env === "PROD" || erpConfig.env === "prod";
        const env: Environment = isProd ? "PROD" : "SANDBOX";

        const session: SessionCredentials = {
          sessionId: `consolidate-${company.id}-${Date.now()}`,
          clientId: erpConfig.clientId,
          clientSecret: erpConfig.clientSecret,
          env,
          mode: "INTERMEDIARY" as Mode,
          onBehalfOf: company.tin,
        };

        const tokenManager = createTokenManager();

        // Encode document to base64 and compute hash (MyInvois requirement)
        const documentJson = JSON.stringify(ublDocument);
        const documentBase64 = Buffer.from(documentJson).toString("base64");
        const documentHash = crypto
          .createHash("sha256")
          .update(documentJson)
          .digest("hex");

        const submitResult = await submitDocuments(
          session,
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

        if (!submitResult.ok) {
          const errMsg = submitResult.error?.message || "Unknown submission error";
          logger.error({
            error: errMsg,
            errorCode: submitResult.error?.code,
            fullError: JSON.stringify(submitResult.error)
          }, `[Consolidator] ${company.name}: Submission failed`);
          results.failed++;
          results.errors.push(`${company.name}: ${errMsg}`);
          continue;
        }

        const submissionResult = submitResult.result;
        const acceptedDoc = submissionResult.acceptedDocuments?.[0];

        if (!acceptedDoc) {
          const rejectedDoc = submissionResult.rejectedDocuments?.[0];
          // Extract error message from various possible fields
          const errMsg = rejectedDoc?.errorMessage || rejectedDoc?.errorCode || "Document rejected";
          logger.error({
            error: errMsg,
            rejectedDoc: JSON.stringify(rejectedDoc),
            submissionResult: JSON.stringify(submissionResult)
          }, `[Consolidator] ${company.name}: Document rejected`);
          results.failed++;
          results.errors.push(`${company.name}: ${errMsg}`);
          continue;
        }

        const myinvoisUuid = acceptedDoc.uuid;
        logger.info(`[Consolidator] ${company.name}: Submitted successfully, UUID: ${myinvoisUuid}`);

        // P0-05: Wrap create + updateMany in transaction to prevent partial consolidation
        await prisma.$transaction(async (tx) => {
          // Create the consolidated invoice record
          await tx.invoice.create({
            data: {
              companyId: company.id,
              invoiceNumber,
              invoiceDate: now,
              invoiceType: "CONSOLIDATE",
              status: "SUBMITTED",
              rawPayload: JSON.stringify({ items, totals, consolidatedFrom: drafts.map((d) => d.invoiceNumber) }),
              ublPayload: JSON.stringify(ublDocument),
              amount: totals.amount.toFixed(2),
              discount: totals.discount.toFixed(2),
              rounding: "0",
              taxAmount: totals.taxAmount.toFixed(2),
              total: totals.total.toFixed(2),
              myinvoisUuid,
              trackingId: `cons-${Date.now()}`,
            },
          });

          // Update all original DRAFT invoices to SUBMITTED with shared UUID
          await tx.invoice.updateMany({
            where: {
              id: { in: drafts.map((d) => d.id) },
              status: "DRAFT",
            },
            data: {
              status: "SUBMITTED",
              myinvoisUuid,
              errorMessage: `Consolidated into ${invoiceNumber}`,
              updatedAt: new Date(),
            },
          });
        });

        logger.info(`[Consolidator] ${company.name}: Updated ${drafts.length} drafts → SUBMITTED`);
        results.submitted++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ error: errMsg }, `[Consolidator] ${company.name}: Failed`);
        results.failed++;
        results.errors.push(`${company.name}: ${errMsg}`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(
      `[Consolidator] Completed: ${results.submitted} submitted, ${results.failed} failed, ${results.processed} companies processed in ${duration}s`
    );

    // P1-09: Log status (P2-04: state now tracked via database, not memory)
    if (!manual) {
      if (results.failed === 0) {
        logger.info("[Consolidator] All companies processed successfully");
      } else {
        logger.warn(`[Consolidator] ${results.failed} companies failed - will retry on next run`);
      }
    }

    return results;
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : "Unknown" }, "[Consolidator] Fatal error");
    throw err;
  } finally {
    isConsolidating = false;
  }
}

/**
 * Check and run consolidation if in the window
 */
async function checkAndRunConsolidation(logger: Logger): Promise<void> {
  // Check if in consolidation window
  if (!isConsolidationWindow()) {
    return;
  }

  // P2-04: Check database instead of in-memory flag
  try {
    const alreadyConsolidated = await hasConsolidatedToday();
    if (alreadyConsolidated) {
      return;
    }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : "Unknown" }, "[Consolidator] Failed to check consolidation status");
    return;
  }

  logger.info("[Consolidator] Consolidation window detected, starting...");

  try {
    await runDailyConsolidation(logger, false);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : "Unknown" }, "[Consolidator] Scheduled run failed");
  }
}

/**
 * Start the monthly consolidator scheduler
 */
export function startMonthlyConsolidator(logger: Logger): void {
  // Feature flag check - don't start if disabled
  if (!isConsolidationEnabled()) {
    logger.info("[Consolidator] Daily consolidation is DISABLED (set ENABLE_MONTHLY_CONSOLIDATION=true to enable)");
    return;
  }

  if (consolidatorInterval) {
    logger.warn("[Consolidator] Already running");
    return;
  }

  logger.info(`[Consolidator] Starting daily consolidator (checks every ${CHECK_INTERVAL_MS / 60000} minutes)`);
  logger.info(`[Consolidator] Schedule: Daily @ 1:00-2:00 AM MYT`);

  // Check immediately on startup
  checkAndRunConsolidation(logger).catch((err) => {
    logger.error({ error: err }, "[Consolidator] Initial check failed");
  });

  // Then check every hour
  consolidatorInterval = setInterval(() => {
    checkAndRunConsolidation(logger).catch((err) => {
      logger.error({ error: err }, "[Consolidator] Scheduled check failed");
    });
  }, CHECK_INTERVAL_MS);

  logger.info("[Consolidator] Daily consolidator started");
}

/**
 * Stop the monthly consolidator
 */
export function stopMonthlyConsolidator(logger: Logger): void {
  if (consolidatorInterval) {
    clearInterval(consolidatorInterval);
    consolidatorInterval = null;
    logger.info("[Consolidator] Daily consolidator stopped");
  }
}

/**
 * Manually trigger consolidation (for testing or admin endpoint)
 */
export async function triggerConsolidation(logger: Logger): Promise<{
  processed: number;
  submitted: number;
  failed: number;
  errors: string[];
  enabled: boolean;
}> {
  // Feature flag check
  if (!isConsolidationEnabled()) {
    logger.warn("[Consolidator] Manual trigger rejected - feature is DISABLED");
    return {
      processed: 0,
      submitted: 0,
      failed: 0,
      errors: ["Daily consolidation is disabled. Set ENABLE_MONTHLY_CONSOLIDATION=true to enable."],
      enabled: false,
    };
  }

  logger.info("[Consolidator] Manual trigger requested");
  const result = await runDailyConsolidation(logger, true);
  return { ...result, enabled: true };
}

/**
 * P2-04: Get last consolidation date from database
 */
async function getLastConsolidationDate(): Promise<string | null> {
  try {
    const prisma = getPrismaClient();
    const lastConsolidation = await prisma.invoice.findFirst({
      where: {
        invoiceType: "CONSOLIDATE",
        status: { in: ["SUBMITTED", "VALID"] },
        invoiceNumber: { startsWith: "CONS-" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (lastConsolidation) {
      // Format the date in MYT
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return formatter.format(lastConsolidation.createdAt);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get consolidator status
 * P2-04: Now queries database for last run date instead of using memory
 */
export async function getConsolidatorStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  isConsolidating: boolean;
  lastRun: string | null;
  schedule: string;
}> {
  const lastRun = await getLastConsolidationDate();
  return {
    enabled: isConsolidationEnabled(),
    running: consolidatorInterval !== null,
    isConsolidating,
    lastRun,
    schedule: "Daily @ 1:00 AM MYT",
  };
}
