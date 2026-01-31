/**
 * Automatic Status Poller
 *
 * Runs every 5 minutes to refresh status of SUBMITTED invoices
 * from MyInvois API and update the database with LongID.
 *
 * Supports both modes:
 * - ERP Mode (INTERMEDIARY): Single ERP credentials for all companies with onBehalfOf
 * - Standard Mode (TAXPAYER): Each company uses its own MyInvois credentials
 *
 * This runs directly in the gateway process - no separate worker needed.
 */

import { getPrismaClient } from "@myinvois/storage";
import {
  createTokenManager,
  getDocumentDetails,
  type SessionCredentials,
} from "@myinvois/myinvois-client";
import type { Environment, Mode } from "@myinvois/core";

// Inline types for Prisma models (since they're not exported from storage)
interface Company {
  id: string;
  name: string;
  tin: string;
  myinvoisClientId: string | null;
  myinvoisClientSecret: string | null;
  myinvoisEnv: string | null;
}

interface Invoice {
  id: string;
  companyId: string;
  invoiceNumber: string;
  myinvoisUuid: string | null;
  version: number; // P1-07: Added for optimistic locking
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

let pollerInterval: NodeJS.Timeout | null = null;

// P1-08: Replace boolean flag with promise-based mutex for thread-safe concurrency guard
let pollingLock: Promise<void> | null = null;

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
 * Map MyInvois status to internal status
 */
function mapStatus(myinvoisStatus: string): string {
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
 * Poll and update all SUBMITTED invoices
 * P1-08: Uses promise-based mutex to prevent concurrent execution
 */
async function pollSubmittedInvoices(logger: Logger): Promise<void> {
  // P1-08: Thread-safe concurrency check using promise lock
  if (pollingLock !== null) {
    logger.info("[AutoPoller] Already polling, skipping this cycle");
    return;
  }

  // P1-08: Acquire lock by creating a promise that resolves when polling is done
  let releaseLock: () => void;
  pollingLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  const startTime = Date.now();

  try {
    const prisma = getPrismaClient();
    const erpConfig = getErpConfig();

    // P2-05: Add pagination to prevent memory exhaustion on large datasets
    // Process max 500 invoices per poll cycle, oldest first
    const MAX_INVOICES_PER_CYCLE = 500;

    const invoices = await prisma.invoice.findMany({
      where: {
        status: "SUBMITTED",
        myinvoisUuid: { not: null },
      },
      include: {
        company: true,
      },
      take: MAX_INVOICES_PER_CYCLE,
      orderBy: { updatedAt: "asc" }, // Oldest first to avoid starvation
    });

    if (invoices.length === 0) {
      logger.info("[AutoPoller] No SUBMITTED invoices to poll");
      return;
    }

    logger.info(`[AutoPoller] Found ${invoices.length} SUBMITTED invoices to poll`);
    logger.info(`[AutoPoller] Mode: ${erpConfig.enabled ? "ERP (INTERMEDIARY)" : "Standard (TAXPAYER)"}`);

    // Group by company for efficient token usage
    const invoicesByCompany = new Map<string, (Invoice & { company: Company })[]>();
    for (const invoice of invoices) {
      const key = invoice.companyId;
      if (!invoicesByCompany.has(key)) {
        invoicesByCompany.set(key, []);
      }
      invoicesByCompany.get(key)!.push(invoice);
    }

    let updated = 0;
    let errors = 0;

    // ERP MODE: Use ERP credentials with INTERMEDIARY mode and onBehalfOf
    if (erpConfig.enabled) {
      if (!erpConfig.clientId || !erpConfig.clientSecret) {
        logger.error({}, "[AutoPoller] ERP mode enabled but credentials not configured");
        return;
      }

      const isProd = erpConfig.env === "PROD" || erpConfig.env === "prod";
      const env: Environment = isProd ? "PROD" : "SANDBOX";

      // Poll all invoices - each company needs its own session with onBehalfOf
      for (const [_companyId, companyInvoices] of invoicesByCompany) {
        const company = companyInvoices[0].company;

        // Create session with INTERMEDIARY mode and onBehalfOf = supplier's TIN
        const session: SessionCredentials = {
          sessionId: `erp-poll-${company.id}`,
          clientId: erpConfig.clientId,
          clientSecret: erpConfig.clientSecret,
          env,
          mode: "INTERMEDIARY" as Mode,
          onBehalfOf: company.tin,
        };

        // Create token manager for this session
        const tokenManager = createTokenManager();

        logger.info(`[AutoPoller] Polling ${companyInvoices.length} invoices for ${company.name} (TIN: ${company.tin})`);

        for (const invoice of companyInvoices) {
          const uuid = invoice.myinvoisUuid!;

          try {
            // Use myinvois-client getDocumentDetails with proper INTERMEDIARY session
            const result = await getDocumentDetails(session, { uuid }, { tokenManager });

            if (!result.ok) {
              logger.error(
                { error: result.error?.message || "Unknown", code: result.error?.code },
                `[AutoPoller] ✗ Failed to poll ${invoice.invoiceNumber}`
              );
              errors++;
              continue;
            }

            const details = result.result;
            const newStatus = mapStatus(details.status);

            // P1-07: Update database with optimistic locking
            // Only update if version hasn't changed since we read it
            const updateResult = await prisma.invoice.updateMany({
              where: {
                id: invoice.id,
                version: invoice.version, // Optimistic lock check
              },
              data: {
                status: newStatus,
                myinvoisLongId: details.longId || null,
                updatedAt: new Date(),
                version: { increment: 1 }, // Increment version on update
              },
            });

            if (updateResult.count === 0) {
              // Another process updated the invoice - skip to avoid overwriting
              logger.warn(`[AutoPoller] ⚠ ${invoice.invoiceNumber}: Skipped (concurrent update detected)`);
              continue;
            }

            if (details.longId) {
              logger.info(`[AutoPoller] ✓ ${invoice.invoiceNumber}: ${newStatus} - LongID: ${details.longId.substring(0, 20)}...`);
            } else {
              logger.info(`[AutoPoller] ✓ ${invoice.invoiceNumber}: ${newStatus}`);
            }

            updated++;

            // Small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (err) {
            logger.error(
              { error: err instanceof Error ? err.message : "Unknown" },
              `[AutoPoller] ✗ Failed to poll ${invoice.invoiceNumber}`
            );
            errors++;
          }
        }
      }
    } else {
      // STANDARD MODE: Each company uses its own credentials
      for (const [_companyId, companyInvoices] of invoicesByCompany) {
        const company = companyInvoices[0].company;

        if (!company.myinvoisClientId || !company.myinvoisClientSecret) {
          logger.warn(`[AutoPoller] Company ${company.name} has no MyInvois credentials, skipping`);
          continue;
        }

        const isProd = company.myinvoisEnv === "PROD";
        const env: Environment = isProd ? "PROD" : "SANDBOX";

        // Create session with TAXPAYER mode (company's own credentials)
        const session: SessionCredentials = {
          sessionId: `taxpayer-poll-${company.id}`,
          clientId: company.myinvoisClientId,
          clientSecret: company.myinvoisClientSecret,
          env,
          mode: "TAXPAYER" as Mode,
        };

        // Create token manager for this session
        const tokenManager = createTokenManager();

        // Poll each invoice
        for (const invoice of companyInvoices) {
          const uuid = invoice.myinvoisUuid!;

          try {
            const result = await getDocumentDetails(session, { uuid }, { tokenManager });

            if (!result.ok) {
              logger.error(
                { error: result.error?.message || "Unknown", code: result.error?.code },
                `[AutoPoller] ✗ Failed to poll ${invoice.invoiceNumber}`
              );
              errors++;
              continue;
            }

            const details = result.result;
            const newStatus = mapStatus(details.status);

            // P1-07: Update database with optimistic locking
            // Only update if version hasn't changed since we read it
            const updateResult = await prisma.invoice.updateMany({
              where: {
                id: invoice.id,
                version: invoice.version, // Optimistic lock check
              },
              data: {
                status: newStatus,
                myinvoisLongId: details.longId || null,
                updatedAt: new Date(),
                version: { increment: 1 }, // Increment version on update
              },
            });

            if (updateResult.count === 0) {
              // Another process updated the invoice - skip to avoid overwriting
              logger.warn(`[AutoPoller] ⚠ ${invoice.invoiceNumber}: Skipped (concurrent update detected)`);
              continue;
            }

            if (details.longId) {
              logger.info(`[AutoPoller] ✓ ${invoice.invoiceNumber}: ${newStatus} - LongID: ${details.longId.substring(0, 20)}...`);
            } else {
              logger.info(`[AutoPoller] ✓ ${invoice.invoiceNumber}: ${newStatus}`);
            }

            updated++;

            // Small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (err) {
            logger.error(
              { error: err instanceof Error ? err.message : "Unknown" },
              `[AutoPoller] ✗ Failed to poll ${invoice.invoiceNumber}`
            );
            errors++;
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[AutoPoller] Completed: ${updated} updated, ${errors} errors in ${duration}s`);
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : "Unknown" },
      "[AutoPoller] Fatal error during polling"
    );
  } finally {
    // P1-08: Release the lock
    pollingLock = null;
    releaseLock!();
  }
}

/**
 * Start the automatic poller
 */
export function startAutoPoller(logger: Logger): void {
  if (pollerInterval) {
    logger.warn("[AutoPoller] Already running");
    return;
  }

  logger.info(`[AutoPoller] Starting automatic status poller (every ${POLL_INTERVAL_MS / 60000} minutes)`);

  // Run immediately on startup
  pollSubmittedInvoices(logger).catch((err) => {
    logger.error({ error: err }, "[AutoPoller] Initial poll failed");
  });

  // Then run every 5 minutes
  pollerInterval = setInterval(() => {
    pollSubmittedInvoices(logger).catch((err) => {
      logger.error({ error: err }, "[AutoPoller] Scheduled poll failed");
    });
  }, POLL_INTERVAL_MS);

  logger.info("[AutoPoller] Automatic poller started");
}

/**
 * Stop the automatic poller
 */
export function stopAutoPoller(logger: Logger): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    logger.info("[AutoPoller] Automatic poller stopped");
  }
}

/**
 * Manually trigger a poll (for testing or admin endpoint)
 */
export async function triggerPoll(logger: Logger): Promise<void> {
  await pollSubmittedInvoices(logger);
}
