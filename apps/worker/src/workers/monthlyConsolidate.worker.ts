/**
 * Monthly Consolidate Worker
 *
 * Processes monthly consolidation jobs for all companies.
 * On the 28th of each month at 2:00 AM MYT, this worker:
 * 1. Gets all active companies
 * 2. For each company, fetches all DRAFT invoices
 * 3. Consolidates items by description + taxCode
 * 4. Submits consolidated invoice to MyInvois
 * 5. Marks original drafts as SUBMITTED with shared UUID/longId
 */

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";
import {
  MONTHLY_CONSOLIDATE_QUEUE_NAME,
  type MonthlyConsolidateJobData,
} from "../queues/monthlyConsolidate.queue.js";
import {
  getPrismaClient,
  getAllCompanies,
  listInvoices,
  createInvoice,
  updateInvoice,
  type InvoiceStatus,
  type InvoiceWithCompany,
  type Company,
} from "@myinvois/storage";
import { submitDocuments, createTokenManager } from "@myinvois/myinvois-client";
import type { Environment, Mode } from "@myinvois/core";
import crypto from "crypto";

const logger = createLogger({ component: "monthlyConsolidate" });

/**
 * Result of processing a single company
 */
interface CompanyProcessResult {
  companyId: string;
  companyName: string;
  draftCount: number;
  submitted: boolean;
  myinvoisUuid?: string;
  myinvoisLongId?: string;
  error?: string;
}

/**
 * Result of the entire consolidation job
 */
interface ConsolidationResult {
  triggeredAt: string;
  completedAt: string;
  companiesProcessed: number;
  companiesSubmitted: number;
  companiesFailed: number;
  results: CompanyProcessResult[];
}

/**
 * Consolidated item (grouped by description + taxCode)
 */
export interface ConsolidatedItem {
  description: string;
  taxCode: string;
  taxRate: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxAmount: number;
  total: number;
  unitOfMeasure?: string;
  productCode?: string;
  classification?: string;
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
  unitOfMeasure?: string;
  productCode?: string;
  classification?: string;
}

/**
 * ERP Configuration for MyInvois submissions
 */
interface ErpConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  env: string;
}

/**
 * Get ERP configuration from environment
 */
function getErpConfig(): ErpConfig {
  const enabled = process.env.ERP_MODE === "true";

  if (!enabled) {
    return { enabled: false, clientId: "", clientSecret: "", env: "SANDBOX" };
  }

  const clientId = process.env.ERP_MYINVOIS_CLIENT_ID;
  const clientSecret = process.env.ERP_MYINVOIS_CLIENT_SECRET;
  const env = process.env.ERP_MYINVOIS_ENV || "SANDBOX";

  if (!clientId || !clientSecret) {
    throw new Error(
      "ERP mode is enabled but ERP_MYINVOIS_CLIENT_ID or ERP_MYINVOIS_CLIENT_SECRET is not configured"
    );
  }

  return { enabled: true, clientId, clientSecret, env };
}

/**
 * Generate a session ID for MyInvois API calls
 */
function generateSessionId(): string {
  return `sess_cons_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Consolidate items by description + taxCode
 * Items with the same description and tax code are merged, quantities summed
 * @exported for testing
 */
export function consolidateItems(invoices: InvoiceWithCompany[]): ConsolidatedItem[] {
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
      // Skip invalid payload
      continue;
    }

    for (const item of items) {
      const key = `${item.description}||${item.taxCode}`;
      const existing = itemMap.get(key);

      if (existing) {
        // Merge: sum quantities and amounts
        existing.quantity += item.quantity || 0;
        existing.discount += item.discount || 0;
        existing.taxAmount += item.taxAmount || 0;
        existing.total += item.total || 0;
      } else {
        // New item
        itemMap.set(key, {
          description: item.description || "",
          taxCode: item.taxCode || "02",
          taxRate: item.taxRate || 6,
          quantity: item.quantity || 0,
          unitPrice: item.unitPrice || 0,
          discount: item.discount || 0,
          taxAmount: item.taxAmount || 0,
          total: item.total || 0,
          unitOfMeasure: item.unitOfMeasure,
          productCode: item.productCode,
          classification: item.classification,
        });
      }
    }
  }

  return Array.from(itemMap.values());
}

/**
 * Calculate totals from consolidated items
 * @exported for testing
 */
export function calculateTotals(items: ConsolidatedItem[]): {
  amount: number;
  discount: number;
  taxAmount: number;
  total: number;
} {
  let amount = 0;
  let discount = 0;
  let taxAmount = 0;

  for (const item of items) {
    amount += item.quantity * item.unitPrice;
    discount += item.discount;
    taxAmount += item.taxAmount;
  }

  const total = amount - discount + taxAmount;

  return { amount, discount, taxAmount, total };
}

/**
 * Build UBL invoice structure for consolidated invoice
 * Simplified version for consolidated invoices with generic buyer
 */
function buildConsolidatedUBL(
  invoiceNumber: string,
  invoiceDate: string,
  company: Company,
  items: ConsolidatedItem[],
  totals: { amount: number; discount: number; taxAmount: number; total: number }
): Record<string, unknown> {
  const currencyCode = "MYR";
  const formatDate = (d: string) => new Date(d).toISOString().split("T")[0];
  const formatTime = (d: string) => {
    const date = new Date(d);
    return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}Z`;
  };

  // Build invoice lines
  const invoiceLines = items.map((item, index) => ({
    ID: [{ _: (index + 1).toString() }],
    InvoicedQuantity: [{ _: item.quantity, unitCode: item.unitOfMeasure || "EA" }],
    LineExtensionAmount: [
      { _: item.quantity * item.unitPrice - item.discount, currencyID: currencyCode },
    ],
    AllowanceCharge: [
      {
        ChargeIndicator: [{ _: false }],
        AllowanceChargeReason: [{ _: "Item discount" }],
        Amount: [{ _: item.discount, currencyID: currencyCode }],
      },
    ],
    TaxTotal: [
      {
        TaxAmount: [{ _: item.taxAmount, currencyID: currencyCode }],
        TaxSubtotal: [
          {
            TaxableAmount: [
              { _: item.quantity * item.unitPrice - item.discount, currencyID: currencyCode },
            ],
            TaxAmount: [{ _: item.taxAmount, currencyID: currencyCode }],
            TaxCategory: [
              {
                ID: [{ _: item.taxCode }],
                Percent: [{ _: item.taxRate }],
                TaxScheme: [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }],
              },
            ],
          },
        ],
      },
    ],
    Item: [
      {
        Description: [{ _: item.description }],
        CommodityClassification: [
          {
            ItemClassificationCode: [
              { _: item.classification || "022", listID: "CLASS" },
            ],
          },
        ],
      },
    ],
    Price: [
      {
        PriceAmount: [{ _: item.unitPrice, currencyID: currencyCode }],
      },
    ],
  }));

  // Build tax total with subtotals grouped by tax code
  const taxSubtotalMap = new Map<string, { taxableAmount: number; taxAmount: number; rate: number }>();
  for (const item of items) {
    const key = item.taxCode;
    const existing = taxSubtotalMap.get(key);
    const taxableAmount = item.quantity * item.unitPrice - item.discount;
    if (existing) {
      existing.taxableAmount += taxableAmount;
      existing.taxAmount += item.taxAmount;
    } else {
      taxSubtotalMap.set(key, {
        taxableAmount,
        taxAmount: item.taxAmount,
        rate: item.taxRate,
      });
    }
  }

  const taxSubtotals = Array.from(taxSubtotalMap.entries()).map(([code, data]) => ({
    TaxableAmount: [{ _: data.taxableAmount, currencyID: currencyCode }],
    TaxAmount: [{ _: data.taxAmount, currencyID: currencyCode }],
    TaxCategory: [
      {
        ID: [{ _: code }],
        Percent: [{ _: data.rate }],
        TaxScheme: [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }],
      },
    ],
  }));

  const lineExtensionAmount = totals.amount - totals.discount;
  const taxExclusiveAmount = lineExtensionAmount;
  const taxInclusiveAmount = taxExclusiveAmount + totals.taxAmount;
  const payableAmount = taxInclusiveAmount;

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: invoiceNumber }],
        IssueDate: [{ _: formatDate(invoiceDate) }],
        IssueTime: [{ _: formatTime(invoiceDate) }],
        InvoiceTypeCode: [{ _: "01", listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: currencyCode }],
        InvoicePeriod: [
          {
            StartDate: [{ _: formatDate(invoiceDate) }],
            EndDate: [{ _: formatDate(invoiceDate) }],
            Description: [{ _: "Monthly consolidated invoice" }],
          },
        ],
        AccountingSupplierParty: [
          {
            Party: [
              {
                PartyIdentification: [
                  { ID: [{ _: company.tin, schemeID: "TIN" }] },
                  { ID: [{ _: company.idValue, schemeID: company.idType || "BRN" }] },
                  { ID: [{ _: company.sstRegistration || "NA", schemeID: "SST" }] },
                  { ID: [{ _: company.ttxRegistration || "NA", schemeID: "TTX" }] },
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: company.city || "NA" }],
                    PostalZone: [{ _: company.postalCode || "00000" }],
                    CountrySubentityCode: [{ _: company.state || "17" }],
                    AddressLine: [{ Line: [{ _: company.address || "NA" }] }],
                    Country: [
                      {
                        IdentificationCode: [
                          { _: company.country || "MYS", listID: "ISO3166-1", listAgencyID: "6" },
                        ],
                      },
                    ],
                  },
                ],
                PartyLegalEntity: [{ RegistrationName: [{ _: company.name }] }],
                Contact: [
                  {
                    Telephone: [{ _: company.phone || "+60000000000" }],
                    ElectronicMail: [{ _: company.email || "na@example.com" }],
                  },
                ],
                IndustryClassificationCode: [
                  {
                    _: company.industryCode || "46510",
                    name: company.industryName || "Wholesale",
                  },
                ],
              },
            ],
          },
        ],
        AccountingCustomerParty: [
          {
            Party: [
              {
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
                    Country: [
                      {
                        IdentificationCode: [
                          { _: "MYS", listID: "ISO3166-1", listAgencyID: "6" },
                        ],
                      },
                    ],
                  },
                ],
                PartyLegalEntity: [{ RegistrationName: [{ _: "General Public" }] }],
                Contact: [
                  {
                    Telephone: [{ _: "+60000000000" }],
                    ElectronicMail: [{ _: "na@example.com" }],
                  },
                ],
              },
            ],
          },
        ],
        PaymentMeans: [{ PaymentMeansCode: [{ _: "08" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: totals.taxAmount, currencyID: currencyCode }],
            TaxSubtotal: taxSubtotals,
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: lineExtensionAmount, currencyID: currencyCode }],
            TaxExclusiveAmount: [{ _: taxExclusiveAmount, currencyID: currencyCode }],
            TaxInclusiveAmount: [{ _: taxInclusiveAmount, currencyID: currencyCode }],
            AllowanceTotalAmount: [{ _: totals.discount, currencyID: currencyCode }],
            ChargeTotalAmount: [{ _: 0, currencyID: currencyCode }],
            PayableRoundingAmount: [{ _: 0, currencyID: currencyCode }],
            PayableAmount: [{ _: payableAmount, currencyID: currencyCode }],
          },
        ],
        InvoiceLine: invoiceLines,
      },
    ],
  };
}

/**
 * Submit consolidated invoice to MyInvois
 */
async function submitConsolidatedToMyInvois(
  ublDocument: Record<string, unknown>,
  company: Company,
  invoiceNumber: string
): Promise<{
  ok: boolean;
  uuid?: string;
  longId?: string;
  error?: { code: string; message: string };
}> {
  try {
    const erpConfig = getErpConfig();

    if (!erpConfig.enabled) {
      // Check company credentials
      if (!company.myinvoisClientId || !company.myinvoisClientSecret) {
        return {
          ok: false,
          error: { code: "NO_CREDENTIALS", message: "Company MyInvois credentials not configured" },
        };
      }
    }

    const env: Environment = erpConfig.enabled
      ? erpConfig.env === "PROD" || erpConfig.env === "prod"
        ? "PROD"
        : "SANDBOX"
      : company.myinvoisEnv === "PROD"
        ? "PROD"
        : "SANDBOX";

    const clientId = erpConfig.enabled ? erpConfig.clientId : company.myinvoisClientId!;
    const clientSecret = erpConfig.enabled ? erpConfig.clientSecret : company.myinvoisClientSecret!;
    const mode: Mode = erpConfig.enabled ? "INTERMEDIARY" : "TAXPAYER";

    const tokenManager = createTokenManager();

    // Encode document to base64
    const documentJson = JSON.stringify(ublDocument);
    const documentBase64 = Buffer.from(documentJson).toString("base64");

    // Create document hash
    const documentHash = crypto.createHash("sha256").update(documentJson).digest("hex");

    // Submit to MyInvois
    const result = await submitDocuments(
      {
        sessionId: generateSessionId(),
        env,
        mode,
        clientId,
        clientSecret,
        scope: "InvoicingAPI",
        ...(erpConfig.enabled && { onBehalfOf: company.tin }),
      },
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

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: result.error.code || "SUBMISSION_FAILED",
          message: result.error.message,
        },
      };
    }

    // Check for accepted documents
    const accepted = result.result.acceptedDocuments[0];
    if (accepted) {
      return {
        ok: true,
        uuid: accepted.uuid,
        // longId will be populated by polling later
      };
    }

    // Check for rejected documents
    const rejected = result.result.rejectedDocuments[0];
    if (rejected) {
      return {
        ok: false,
        error: {
          code: rejected.errorCode || "DOCUMENT_REJECTED",
          message: rejected.errorMessage || "Document rejected",
        },
      };
    }

    return {
      ok: false,
      error: { code: "UNKNOWN_ERROR", message: "No accepted or rejected documents in response" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Submission failed";
    return {
      ok: false,
      error: { code: "SUBMISSION_ERROR", message },
    };
  }
}

/**
 * Process a single company's DRAFT invoices
 */
async function processCompany(company: Company): Promise<CompanyProcessResult> {
  const log = createLogger({ companyId: company.id, companyName: company.name });

  try {
    // Get all DRAFT invoices for this company
    const draftsResult = await listInvoices({
      companyId: company.id,
      status: "DRAFT",
      limit: 10000, // Get all drafts
    });

    const drafts = draftsResult.data;

    if (drafts.length === 0) {
      log.debug("No DRAFT invoices found, skipping");
      return {
        companyId: company.id,
        companyName: company.name,
        draftCount: 0,
        submitted: false,
      };
    }

    log.info({ draftCount: drafts.length }, "Found DRAFT invoices to consolidate");

    // Consolidate items from all drafts
    const consolidatedItems = consolidateItems(drafts);

    if (consolidatedItems.length === 0) {
      log.warn("No items found in DRAFT invoices");
      return {
        companyId: company.id,
        companyName: company.name,
        draftCount: drafts.length,
        submitted: false,
        error: "No items found in DRAFT invoices",
      };
    }

    // Calculate totals
    const totals = calculateTotals(consolidatedItems);

    // Generate invoice number: CONS-YYYYMMDD-companyId
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const invoiceNumber = `CONS-${dateStr}-${company.id.slice(0, 8).toUpperCase()}`;
    const invoiceDate = now.toISOString();

    log.info(
      { invoiceNumber, itemCount: consolidatedItems.length, total: totals.total },
      "Built consolidated invoice"
    );

    // Build UBL document
    const ublDocument = buildConsolidatedUBL(
      invoiceNumber,
      invoiceDate,
      company,
      consolidatedItems,
      totals
    );

    // Submit to MyInvois
    const submitResult = await submitConsolidatedToMyInvois(ublDocument, company, invoiceNumber);

    if (!submitResult.ok) {
      log.error({ error: submitResult.error }, "Failed to submit consolidated invoice");
      return {
        companyId: company.id,
        companyName: company.name,
        draftCount: drafts.length,
        submitted: false,
        error: submitResult.error?.message || "Submission failed",
      };
    }

    log.info({ uuid: submitResult.uuid }, "Consolidated invoice submitted successfully");

    // Create a consolidated invoice record in database
    const rawPayload = JSON.stringify({
      type: "MONTHLY_CONSOLIDATED",
      sourceInvoices: drafts.map((d) => d.invoiceNumber),
      items: consolidatedItems,
      ...totals,
    });

    const createdInvoice = await createInvoice({
      companyId: company.id,
      invoiceNumber,
      invoiceDate: now,
      invoiceType: "CONSOLIDATE",
      status: "SUBMITTED" as InvoiceStatus,
      rawPayload,
      ublPayload: JSON.stringify(ublDocument),
      amount: totals.amount.toString(),
      discount: totals.discount.toString(),
      taxAmount: totals.taxAmount.toString(),
      total: totals.total.toString(),
    });

    // Update the created invoice with MyInvois UUID
    if (submitResult.uuid) {
      await updateInvoice(createdInvoice.id, {
        myinvoisUuid: submitResult.uuid,
      });
    }

    // Update all original DRAFT invoices to SUBMITTED with shared UUID
    // This links them to the consolidated submission
    const prisma = getPrismaClient();
    await prisma.invoice.updateMany({
      where: {
        id: { in: drafts.map((d) => d.id) },
        status: "DRAFT",
      },
      data: {
        status: "SUBMITTED",
        myinvoisUuid: submitResult.uuid,
        errorMessage: `Consolidated into ${invoiceNumber}`,
      },
    });

    log.info(
      { uuid: submitResult.uuid, consolidatedFrom: drafts.length },
      "Updated original DRAFT invoices to SUBMITTED"
    );

    return {
      companyId: company.id,
      companyName: company.name,
      draftCount: drafts.length,
      submitted: true,
      myinvoisUuid: submitResult.uuid,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error({ error: message }, "Failed to process company");
    return {
      companyId: company.id,
      companyName: company.name,
      draftCount: 0,
      submitted: false,
      error: message,
    };
  }
}

/**
 * Process monthly consolidation for all companies
 */
async function processMonthlyConsolidation(
  job: Job<MonthlyConsolidateJobData>
): Promise<ConsolidationResult> {
  const { triggeredAt, manual, companyId } = job.data;
  const log = createLogger({ jobId: job.id, manual, triggeredAt });

  log.info("Starting monthly consolidation job");

  const results: CompanyProcessResult[] = [];
  let companiesSubmitted = 0;
  let companiesFailed = 0;

  try {
    // Get companies to process
    let companies: Company[];

    if (companyId) {
      // Process specific company only
      const prisma = getPrismaClient();
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      companies = company ? [company] : [];
      log.info({ companyId }, "Processing specific company");
    } else {
      // Process all active companies
      companies = await getAllCompanies(true);
      log.info({ companyCount: companies.length }, "Processing all active companies");
    }

    // Process each company
    for (const company of companies) {
      const result = await processCompany(company);
      results.push(result);

      if (result.submitted) {
        companiesSubmitted++;
      } else if (result.draftCount > 0) {
        companiesFailed++;
      }
    }

    const completedAt = new Date().toISOString();

    log.info(
      {
        companiesProcessed: companies.length,
        companiesSubmitted,
        companiesFailed,
      },
      "Monthly consolidation job completed"
    );

    return {
      triggeredAt,
      completedAt,
      companiesProcessed: companies.length,
      companiesSubmitted,
      companiesFailed,
      results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error({ error: message }, "Monthly consolidation job failed");
    throw error;
  }
}

let monthlyConsolidateWorker: Worker<MonthlyConsolidateJobData> | null = null;

/**
 * Start the monthly consolidation worker
 */
export function startMonthlyConsolidateWorker(): Worker<MonthlyConsolidateJobData> {
  if (monthlyConsolidateWorker) {
    return monthlyConsolidateWorker;
  }

  monthlyConsolidateWorker = new Worker<MonthlyConsolidateJobData>(
    MONTHLY_CONSOLIDATE_QUEUE_NAME,
    processMonthlyConsolidation,
    {
      connection: getRedisConnection(),
      concurrency: 1, // Process one consolidation job at a time
    }
  );

  monthlyConsolidateWorker.on("completed", (job, result) => {
    logger.info(
      {
        jobId: job.id,
        companiesProcessed: result.companiesProcessed,
        companiesSubmitted: result.companiesSubmitted,
        companiesFailed: result.companiesFailed,
      },
      "Monthly consolidation job completed"
    );
  });

  monthlyConsolidateWorker.on("failed", (job, error) => {
    if (job) {
      logger.error(
        { jobId: job.id, error: error.message },
        "Monthly consolidation job failed"
      );
    }
  });

  monthlyConsolidateWorker.on("error", (error) => {
    logger.error({ error: error.message }, "Monthly consolidation worker error");
  });

  return monthlyConsolidateWorker;
}

/**
 * Stop the monthly consolidation worker
 */
export async function stopMonthlyConsolidateWorker(): Promise<void> {
  if (monthlyConsolidateWorker) {
    await monthlyConsolidateWorker.close();
    monthlyConsolidateWorker = null;
  }
}

/**
 * Get current worker instance
 */
export function getMonthlyConsolidateWorker(): Worker<MonthlyConsolidateJobData> | null {
  return monthlyConsolidateWorker;
}
