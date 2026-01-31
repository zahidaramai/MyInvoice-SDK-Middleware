/**
 * Poll Invoice Worker
 *
 * Processes poll jobs for HashLHDN invoices, fetching status from MyInvois
 * and updating the local Invoice table.
 */

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";
import { createLogger, logger } from "../lib/logger.js";
import {
  POLL_INVOICE_QUEUE_NAME,
  type PollInvoiceJobData,
  enqueueInvoicePoll,
  calculateInvoicePollDelay,
} from "../queues/pollInvoice.queue.js";
import { findInvoiceById, findCompanyById, updateInvoice } from "@myinvois/storage";
import type { Environment } from "@myinvois/core";
import type { InvoiceStatus } from "@myinvois/storage";

/**
 * MyInvois document status response
 */
interface DocumentDetailsResponse {
  uuid: string;
  submissionUid: string;
  longId: string;
  status: string;
  dateTimeValidated: string | null;
  validationResults?: {
    status: string;
    validationSteps: Array<{
      status: string;
      name: string;
      error?: {
        code: string;
        message: string;
        target?: string;
        propertyPath?: string;
      };
    }>;
  };
}

/**
 * Fetch document details from MyInvois API
 */
async function fetchDocumentDetails(
  uuid: string,
  clientId: string,
  clientSecret: string,
  env: Environment
): Promise<
  { ok: true; data: DocumentDetailsResponse } | { ok: false; error: string; status?: number }
> {
  try {
    // Get access token
    const baseUrl =
      env === "PROD"
        ? "https://api.myinvois.hasil.gov.my"
        : "https://preprod-api.myinvois.hasil.gov.my";

    const identityUrl =
      env === "PROD"
        ? "https://identity.myinvois.hasil.gov.my"
        : "https://preprod-identity.myinvois.hasil.gov.my";

    // Get token
    const tokenResponse = await fetch(`${identityUrl}/connect/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "InvoicingAPI",
      }),
    });

    if (!tokenResponse.ok) {
      return { ok: false, error: "Failed to get access token", status: tokenResponse.status };
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // Fetch document details
    const docResponse = await fetch(`${baseUrl}/api/v1.0/documents/${uuid}/details`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!docResponse.ok) {
      return {
        ok: false,
        error: `Document fetch failed: ${docResponse.status}`,
        status: docResponse.status,
      };
    }

    const data = (await docResponse.json()) as DocumentDetailsResponse;
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Map MyInvois status to our internal status
 */
function mapMyInvoisStatus(myinvoisStatus: string): string {
  const statusMap: Record<string, string> = {
    Valid: "VALID",
    Invalid: "INVALID",
    Submitted: "SUBMITTED",
    Cancelled: "CANCELLED",
    Rejected: "REJECTED",
  };
  return statusMap[myinvoisStatus] || myinvoisStatus.toUpperCase();
}

/**
 * Check if status is terminal (no more polling needed)
 */
function isTerminalStatus(status: string): boolean {
  return ["Valid", "Invalid", "Cancelled", "Rejected"].includes(status);
}

/**
 * Process a poll invoice job
 */
async function processPollInvoiceJob(job: Job<PollInvoiceJobData>): Promise<void> {
  const { invoiceId, myinvoisUuid, companyId, attempt = 0 } = job.data;
  const log = createLogger({ invoiceId, myinvoisUuid, jobId: job.id });

  log.info({ invoiceId, myinvoisUuid, attempt }, "Processing invoice poll job");

  try {
    // Load invoice from database
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      log.warn({ invoiceId }, "Invoice not found, skipping");
      return;
    }

    // Check if already in terminal state
    if (["VALID", "INVALID", "CANCELLED", "REJECTED"].includes(invoice.status)) {
      log.info({ status: invoice.status }, "Invoice already in terminal state");
      return;
    }

    // Load company to get credentials
    const company = await findCompanyById(companyId);
    if (!company) {
      log.error({ companyId }, "Company not found");
      return;
    }

    if (!company.myinvoisClientId || !company.myinvoisClientSecret) {
      log.error({ companyId }, "Company MyInvois credentials not configured");
      return;
    }

    const env: Environment = company.myinvoisEnv === "PROD" ? "PROD" : "SANDBOX";

    log.info({ myinvoisUuid, env }, "Fetching document details from MyInvois");

    // Fetch document details from MyInvois
    const result = await fetchDocumentDetails(
      myinvoisUuid,
      company.myinvoisClientId,
      company.myinvoisClientSecret,
      env
    );

    if (!result.ok) {
      log.warn({ error: result.error, status: result.status }, "Failed to fetch document details");

      // Handle rate limiting
      if (result.status === 429) {
        log.info("Rate limited, rescheduling with longer delay");
        await enqueueInvoicePoll(
          { invoiceId, myinvoisUuid, companyId, attempt: attempt + 1 },
          60000 // 60 second delay for rate limiting
        );
        return;
      }

      // Handle 404 - document not found
      if (result.status === 404) {
        log.error("Document not found in MyInvois, stopping polling");
        await updateInvoice(invoiceId, {
          errorCode: "NOT_FOUND",
          errorMessage: "Document not found in MyInvois",
        });
        return;
      }

      // For other errors, retry with exponential backoff
      if (attempt < 20) {
        await enqueueInvoicePoll(
          { invoiceId, myinvoisUuid, companyId, attempt: attempt + 1 },
          calculateInvoicePollDelay(attempt + 1)
        );
      }
      return;
    }

    const docDetails = result.data;
    const newStatus = mapMyInvoisStatus(docDetails.status);

    log.info(
      {
        myinvoisUuid,
        myinvoisStatus: docDetails.status,
        mappedStatus: newStatus,
        longId: docDetails.longId,
        validationStatus: docDetails.validationResults?.status,
      },
      "Document details fetched"
    );

    // Check for validation errors
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (docDetails.validationResults?.status === "Invalid") {
      const failedStep = docDetails.validationResults.validationSteps.find(
        (step) => step.status === "Invalid" && step.error
      );
      if (failedStep?.error) {
        errorCode = failedStep.error.code;
        errorMessage = `${failedStep.name}: ${failedStep.error.message}`;
        if (failedStep.error.propertyPath) {
          errorMessage += ` (${failedStep.error.propertyPath})`;
        }
      }
    }

    // Update invoice in database
    await updateInvoice(invoiceId, {
      status: newStatus as InvoiceStatus,
      myinvoisLongId: docDetails.longId || undefined,
      errorCode,
      errorMessage,
    });

    log.info({ invoiceId, newStatus, longId: docDetails.longId }, "Invoice updated");

    // If not terminal, schedule next poll
    if (!isTerminalStatus(docDetails.status)) {
      const nextAttempt = attempt + 1;
      const delay = calculateInvoicePollDelay(nextAttempt);

      log.info({ nextAttempt, delay }, "Scheduling next poll");

      await enqueueInvoicePoll({ invoiceId, myinvoisUuid, companyId, attempt: nextAttempt }, delay);
    } else {
      log.info({ status: docDetails.status }, "Document reached terminal state, polling complete");
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Error processing poll job"
    );
    throw error;
  }
}

let pollInvoiceWorker: Worker<PollInvoiceJobData> | null = null;

/**
 * Start the poll invoice worker
 */
export function startPollInvoiceWorker(): Worker<PollInvoiceJobData> {
  if (pollInvoiceWorker) {
    return pollInvoiceWorker;
  }

  pollInvoiceWorker = new Worker<PollInvoiceJobData>(
    POLL_INVOICE_QUEUE_NAME,
    processPollInvoiceJob,
    {
      connection: getRedisConnection(),
      concurrency: 5, // Process up to 5 jobs concurrently
    }
  );

  pollInvoiceWorker.on("completed", (job) => {
    createLogger({ invoiceId: job.data.invoiceId, jobId: job.id }).debug(
      "Invoice poll job completed"
    );
  });

  pollInvoiceWorker.on("failed", (job, err) => {
    if (job) {
      createLogger({ invoiceId: job.data.invoiceId, jobId: job.id }).error(
        { error: err.message },
        "Invoice poll job failed"
      );
    }
  });

  pollInvoiceWorker.on("error", (err) => {
    logger.error({ error: err.message }, "Invoice poll worker error");
  });

  return pollInvoiceWorker;
}

/**
 * Stop the poll invoice worker
 */
export async function stopPollInvoiceWorker(): Promise<void> {
  if (pollInvoiceWorker) {
    await pollInvoiceWorker.close();
    pollInvoiceWorker = null;
  }
}

/**
 * Get current worker instance
 */
export function getPollInvoiceWorker(): Worker<PollInvoiceJobData> | null {
  return pollInvoiceWorker;
}
