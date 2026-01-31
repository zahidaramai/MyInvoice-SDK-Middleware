/**
 * Test ERP On-Behalf Submission via Gateway API
 *
 * Tests all 3 submission types (consolidate, buyer, personal)
 * using ERP credentials on behalf of B POINT STATION (TIN: C24558460090)
 *
 * Usage: npx tsx scripts/test-erp-onbehalf.ts
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

// Gateway API base URL
const GATEWAY_URL = process.env.TEST_GATEWAY_URL || "http://localhost:3001";

// B POINT STATION company ID (from database)
const BPOINT_COMPANY_ID = "f6518902-1fc7-44e0-a947-57ceb9de863c";
const BPOINT_TIN = "C24558460090";

// Test credentials (use a test user or API key)
let authToken: string = "";

interface SubmissionResult {
  type: string;
  invoiceNumber: string;
  success: boolean;
  uuid?: string;
  longId?: string;
  status?: string;
  error?: string;
}

async function login(): Promise<void> {
  console.log("\n=== Authenticating ===");

  const response = await fetch(`${GATEWAY_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@hashlhdn.com",
      password: "admin123",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as { accessToken: string };
  authToken = data.accessToken;
  console.log("✓ Authenticated successfully");
}

function generateInvoiceNumber(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

async function submitConsolidate(): Promise<SubmissionResult> {
  const invoiceNumber = generateInvoiceNumber("CONS-ONBEHALF");
  console.log(`\n=== Testing Consolidate Submission ===`);
  console.log(`Invoice Number: ${invoiceNumber}`);
  console.log(`Company: B POINT STATION (${BPOINT_TIN})`);

  const payload = {
    CompanyId: BPOINT_COMPANY_ID,
    ConsolidatedInvoice: true,
    invoices: [
      {
        invoiceNumber,
        invoiceDate: new Date().toISOString(),
        amount: 100.0,
        taxAmount: 0.0,
        total: 100.0,
        items: [
          {
            description: "Daily consolidated sales - ERP onbehalf test",
            quantity: 1,
            unitPrice: 100.0,
            taxCode: "E",
            taxAmount: 0.0,
            total: 100.0,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/documents/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`Response status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));

    if (response.ok && data.results?.[0]) {
      const result = data.results[0];
      return {
        type: "consolidate",
        invoiceNumber,
        success: true,
        uuid: result.uuid,
        longId: result.longId,
        status: result.status,
      };
    }

    return {
      type: "consolidate",
      invoiceNumber,
      success: false,
      error: JSON.stringify(data),
    };
  } catch (error) {
    return {
      type: "consolidate",
      invoiceNumber,
      success: false,
      error: String(error),
    };
  }
}

async function submitBuyer(): Promise<SubmissionResult> {
  const invoiceNumber = generateInvoiceNumber("B2B-ONBEHALF");
  console.log(`\n=== Testing B2B (Buyer) Submission ===`);
  console.log(`Invoice Number: ${invoiceNumber}`);
  console.log(`Company: B POINT STATION (${BPOINT_TIN})`);

  const payload = {
    CompanyId: BPOINT_COMPANY_ID,
    invoices: [
      {
        invoiceNumber,
        invoiceDate: new Date().toISOString(),
        amount: 200.0,
        taxAmount: 0.0,
        total: 200.0,
        customer: {
          Tin: "C25235029040",
          Name: "Test Buyer Company Sdn Bhd",
          Address1: "123 Jalan Test",
          PostalCode: "50000",
          City: "Kuala Lumpur",
          StateCode: "14",
          Telephone: "0312345678",
          IdType: "BRN",
          IdValue: "202001234567",
        },
        items: [
          {
            description: "B2B Product - ERP onbehalf test",
            quantity: 2,
            unitPrice: 100.0,
            taxCode: "E",
            taxAmount: 0.0,
            total: 200.0,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/documents/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`Response status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));

    if (response.ok && data.results?.[0]) {
      const result = data.results[0];
      return {
        type: "buyer",
        invoiceNumber,
        success: true,
        uuid: result.uuid,
        longId: result.longId,
        status: result.status,
      };
    }

    return {
      type: "buyer",
      invoiceNumber,
      success: false,
      error: JSON.stringify(data),
    };
  } catch (error) {
    return {
      type: "buyer",
      invoiceNumber,
      success: false,
      error: String(error),
    };
  }
}

async function submitPersonal(): Promise<SubmissionResult> {
  const invoiceNumber = generateInvoiceNumber("B2C-ONBEHALF");
  console.log(`\n=== Testing B2C (Personal) Submission ===`);
  console.log(`Invoice Number: ${invoiceNumber}`);
  console.log(`Company: B POINT STATION (${BPOINT_TIN})`);

  const payload = {
    CompanyId: BPOINT_COMPANY_ID,
    invoices: [
      {
        invoiceNumber,
        invoiceDate: new Date().toISOString(),
        amount: 50.0,
        taxAmount: 0.0,
        total: 50.0,
        customer: {
          tin: "EI00000000010",
          name: "Test Customer",
          address1: "456 Jalan Personal",
          postalCode: "40000",
          city: "Shah Alam",
          stateCode: "10",
          telephone: "0123456789",
          idType: "NRIC",
          idValue: "801025145127",
        },
        items: [
          {
            description: "B2C Product - ERP onbehalf test",
            quantity: 1,
            unitPrice: 50.0,
            taxCode: "E",
            taxAmount: 0.0,
            total: 50.0,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/documents/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`Response status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));

    if (response.ok && data.results?.[0]) {
      const result = data.results[0];
      return {
        type: "personal",
        invoiceNumber,
        success: true,
        uuid: result.uuid,
        longId: result.longId,
        status: result.status,
      };
    }

    return {
      type: "personal",
      invoiceNumber,
      success: false,
      error: JSON.stringify(data),
    };
  } catch (error) {
    return {
      type: "personal",
      invoiceNumber,
      success: false,
      error: String(error),
    };
  }
}

async function pollForStatus(
  uuid: string,
  maxAttempts = 10
): Promise<{ status: string; longId?: string }> {
  console.log(`\nPolling status for UUID: ${uuid}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 3000)); // Wait 3 seconds between polls

    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/documents/${uuid}/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (response.ok) {
        const data = (await response.json()) as { status: string; longId?: string };
        console.log(
          `  Attempt ${attempt}: status = ${data.status}, longId = ${data.longId || "pending"}`
        );

        if (data.status === "VALID" && data.longId) {
          return data;
        }

        if (data.status === "INVALID" || data.status === "CANCELLED") {
          return data;
        }
      }
    } catch (error) {
      console.log(`  Attempt ${attempt}: Error - ${error}`);
    }
  }

  return { status: "TIMEOUT" };
}

async function main() {
  console.log("=".repeat(60));
  console.log("ERP On-Behalf Submission Test");
  console.log("=".repeat(60));
  console.log(`Gateway URL: ${GATEWAY_URL}`);
  console.log(`On-behalf Company: B POINT STATION (${BPOINT_TIN})`);
  console.log(`ERP Mode: ${process.env.ERP_MODE}`);
  console.log(`ERP Client ID: ${process.env.ERP_MYINVOIS_CLIENT_ID?.substring(0, 8)}...`);

  const results: SubmissionResult[] = [];

  try {
    // Authenticate
    await login();

    // Test all 3 submission types
    const consolidateResult = await submitConsolidate();
    results.push(consolidateResult);

    const buyerResult = await submitBuyer();
    results.push(buyerResult);

    const personalResult = await submitPersonal();
    results.push(personalResult);

    // Poll for status on successful submissions
    console.log("\n=== Polling for Final Status ===");
    for (const result of results) {
      if (result.success && result.uuid) {
        const finalStatus = await pollForStatus(result.uuid);
        result.status = finalStatus.status;
        result.longId = finalStatus.longId;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));

    for (const result of results) {
      const statusIcon = result.longId ? "✓" : result.success ? "~" : "✗";
      console.log(`\n${statusIcon} ${result.type.toUpperCase()}`);
      console.log(`  Invoice: ${result.invoiceNumber}`);
      console.log(`  Success: ${result.success}`);
      if (result.uuid) console.log(`  UUID: ${result.uuid}`);
      if (result.longId) console.log(`  LongID: ${result.longId}`);
      console.log(`  Status: ${result.status || "N/A"}`);
      if (result.error) console.log(`  Error: ${result.error}`);
    }

    const withLongId = results.filter((r) => r.longId).length;
    const successful = results.filter((r) => r.success).length;

    console.log("\n" + "-".repeat(60));
    console.log(`Total: ${results.length}`);
    console.log(`Submitted: ${successful}`);
    console.log(`With LongID (Valid): ${withLongId}`);
    console.log("-".repeat(60));

    if (withLongId === results.length) {
      console.log("\n✓ ALL SUBMISSIONS VALIDATED - ERP On-Behalf mode working!");
    } else if (successful === results.length) {
      console.log("\n~ All submitted, some pending validation");
    } else {
      console.log("\n✗ SOME SUBMISSIONS FAILED - Check errors above");
    }
  } catch (error) {
    console.error("\nFatal error:", error);
    process.exit(1);
  }
}

main();
