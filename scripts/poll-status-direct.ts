/**
 * Direct MyInvois Status Polling Script
 *
 * Connects to production database, fetches SUBMITTED invoices,
 * and polls MyInvois API directly for status updates.
 *
 * Usage: DATABASE_URL="..." npx tsx scripts/poll-status-direct.ts
 */

import { getPrismaClient } from "@myinvois/storage";

const prisma = getPrismaClient();

interface DocumentDetailsResponse {
  uuid: string;
  submissionUid: string;
  longId: string;
  internalId: string;
  status: string;
  dateTimeValidated: string | null;
  totalPayableAmount: number;
  validationResults?: {
    status: string;
    validationSteps: Array<{
      status: string;
      name: string;
      error?: {
        code: string;
        message: string;
      };
    }>;
  };
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  isProd: boolean
): Promise<string> {
  const identityUrl = isProd
    ? "https://identity.myinvois.hasil.gov.my"
    : "https://preprod-identity.myinvois.hasil.gov.my";

  const response = await fetch(`${identityUrl}/connect/token`, {
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token request failed: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function getDocumentDetails(
  uuid: string,
  accessToken: string,
  isProd: boolean
): Promise<DocumentDetailsResponse> {
  const baseUrl = isProd
    ? "https://api.myinvois.hasil.gov.my"
    : "https://preprod-api.myinvois.hasil.gov.my";

  const response = await fetch(`${baseUrl}/api/v1.0/documents/${uuid}/details`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Document fetch failed: ${response.status} - ${text}`);
  }

  return response.json() as Promise<DocumentDetailsResponse>;
}

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

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("MyInvois Direct Status Polling");
  console.log("=".repeat(80) + "\n");

  try {
    // Fetch SUBMITTED invoices from database
    console.log("Fetching SUBMITTED invoices from database...\n");

    const invoices = await prisma.invoice.findMany({
      where: {
        status: "SUBMITTED",
        myinvoisUuid: { not: null },
      },
      include: {
        company: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(`Found ${invoices.length} invoices with SUBMITTED status\n`);

    if (invoices.length === 0) {
      console.log("No invoices to poll.");
      return;
    }

    // Group invoices by company for efficient token usage
    const invoicesByCompany = new Map<string, typeof invoices>();
    for (const invoice of invoices) {
      const key = invoice.companyId;
      if (!invoicesByCompany.has(key)) {
        invoicesByCompany.set(key, []);
      }
      invoicesByCompany.get(key)!.push(invoice);
    }

    // Process each company's invoices
    for (const [_companyId, companyInvoices] of invoicesByCompany) {
      const company = companyInvoices[0].company;

      console.log("-".repeat(80));
      console.log(`Company: ${company.name} (${company.tin})`);
      console.log("-".repeat(80));

      if (!company.myinvoisClientId || !company.myinvoisClientSecret) {
        console.log("  ⚠️  No MyInvois credentials configured, skipping\n");
        continue;
      }

      const isProd = company.myinvoisEnv === "PROD";
      console.log(`  Environment: ${isProd ? "PRODUCTION" : "SANDBOX"}`);

      try {
        // Get access token for this company
        console.log("  Getting access token...");
        const accessToken = await getAccessToken(
          company.myinvoisClientId,
          company.myinvoisClientSecret,
          isProd
        );
        console.log("  ✓ Token obtained\n");

        // Poll each invoice
        for (const invoice of companyInvoices) {
          const uuid = invoice.myinvoisUuid!;

          console.log(`  Invoice: ${invoice.invoiceNumber}`);
          console.log(`  UUID: ${uuid}`);

          try {
            const details = await getDocumentDetails(uuid, accessToken, isProd);
            const newStatus = mapStatus(details.status);

            console.log(`  MyInvois Status: ${details.status} → ${newStatus}`);
            console.log(`  LongID: ${details.longId || "(not assigned)"}`);
            console.log(`  Validated: ${details.dateTimeValidated || "(pending)"}`);

            // Extract error if invalid
            let errorCode: string | null = null;
            let errorMessage: string | null = null;

            if (details.validationResults?.status === "Invalid") {
              const failedStep = details.validationResults.validationSteps.find(
                (s) => s.status === "Invalid"
              );
              if (failedStep?.error) {
                errorCode = failedStep.error.code;
                errorMessage = `${failedStep.name}: ${failedStep.error.message}`;
                console.log(`  Error: ${errorMessage}`);
              }
            }

            // Update database
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: {
                status: newStatus as any,
                myinvoisLongId: details.longId || null,
                errorCode,
                errorMessage,
                updatedAt: new Date(),
              },
            });

            console.log(`  ✓ Database updated`);

            if (details.longId) {
              console.log(`  🎉 VALID with LongID!`);
            }
          } catch (err) {
            console.log(`  ✗ Error: ${err instanceof Error ? err.message : "Unknown"}`);
          }
          console.log("");
        }
      } catch (err) {
        console.log(`  ✗ Token error: ${err instanceof Error ? err.message : "Unknown"}\n`);
      }
    }

    // Show final summary
    console.log("\n" + "=".repeat(80));
    console.log("SUMMARY - After Polling");
    console.log("=".repeat(80) + "\n");

    const updatedInvoices = await prisma.invoice.findMany({
      where: {
        myinvoisUuid: { not: null },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    });

    console.log("Invoice Number".padEnd(40) + "Status".padEnd(12) + "LongID");
    console.log("-".repeat(80));

    for (const inv of updatedInvoices) {
      const longIdDisplay = inv.myinvoisLongId
        ? inv.myinvoisLongId.substring(0, 25) + "..."
        : "(none)";
      console.log(
        inv.invoiceNumber.padEnd(40) +
        inv.status.padEnd(12) +
        longIdDisplay
      );
    }
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
