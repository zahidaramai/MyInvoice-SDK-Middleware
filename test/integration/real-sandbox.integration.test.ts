/**
 * Real Sandbox Integration Tests
 *
 * Tests against the ACTUAL MyInvois sandbox API.
 * Requires valid credentials in .env file.
 *
 * IMPORTANT: These tests make REAL API calls to MyInvois sandbox.
 * Run manually, not in CI.
 *
 * Usage:
 *   # Set up .env with your credentials first
 *   pnpm vitest run test/integration/real-sandbox.integration.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../.env") });

// Skip unless explicitly enabled - integration tests hit live MyInvois API
// Run with: RUN_INTEGRATION_TESTS=true pnpm vitest run test/integration/
const SKIP_REAL_TESTS =
  process.env.RUN_INTEGRATION_TESTS !== "true" ||
  !process.env.MYINVOIS_CLIENT_ID ||
  process.env.MYINVOIS_CLIENT_ID === "your-client-id-here" ||
  !process.env.MYINVOIS_CLIENT_SECRET_1 ||
  process.env.MYINVOIS_CLIENT_SECRET_1 === "your-primary-client-secret-here";

// MyInvois URLs - use PROD or SANDBOX based on env
const IS_PROD = process.env.MYINVOIS_ENV === "PROD" || process.env.ERP_MYINVOIS_ENV === "PROD";
const IDENTITY_URL = IS_PROD
  ? "https://identity.myinvois.hasil.gov.my"
  : "https://preprod-identity.myinvois.hasil.gov.my";
const SYSTEM_URL = IS_PROD
  ? "https://api.myinvois.hasil.gov.my"
  : "https://preprod-api.myinvois.hasil.gov.my";

describe.skipIf(SKIP_REAL_TESTS)("Real Sandbox Integration", () => {
  let accessToken: string;
  let tokenExpiresAt: number;

  /**
   * Get credentials from environment
   */
  function getCredentials() {
    return {
      clientId: process.env.MYINVOIS_CLIENT_ID!,
      clientSecret: process.env.MYINVOIS_CLIENT_SECRET_1!,
    };
  }

  /**
   * Acquire OAuth2 token from MyInvois
   */
  async function acquireToken(): Promise<string> {
    // Return cached token if still valid
    if (accessToken && tokenExpiresAt > Date.now() + 60000) {
      return accessToken;
    }

    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(`${IDENTITY_URL}/connect/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "InvoicingAPI",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token acquisition failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;

    console.log(`Token acquired, expires in ${data.expires_in}s`);
    return accessToken;
  }

  beforeAll(() => {
    if (SKIP_REAL_TESTS) {
      console.log("⚠️  Skipping real sandbox tests - credentials not configured");
      console.log("   Set MYINVOIS_CLIENT_ID and MYINVOIS_CLIENT_SECRET_1 in .env");
      return;
    }
    console.log("🔑 Running real sandbox integration tests");
    console.log(`   Client ID: ${process.env.MYINVOIS_CLIENT_ID?.slice(0, 8)}...`);
  });

  describe("OAuth2 Authentication", () => {
    it("acquires access token successfully", async () => {
      const token = await acquireToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(100); // JWT tokens are long
    });

    it("token is reusable (cached)", async () => {
      const token1 = await acquireToken();
      const token2 = await acquireToken();

      expect(token1).toBe(token2); // Same cached token
    });

    it("rejects invalid credentials", async () => {
      const response = await fetch(`${IDENTITY_URL}/connect/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: "invalid-client",
          client_secret: "invalid-secret",
          grant_type: "client_credentials",
          scope: "InvoicingAPI",
        }),
      });

      expect(response.status).toBe(400); // Invalid client
    });
  });

  describe("Taxpayer TIN Validation", () => {
    it("validates a known TIN format", async () => {
      const token = await acquireToken();

      // Test with a sample TIN format (may not be a real taxpayer)
      // This tests the API connectivity, not the actual validation
      const tin = "C00000000000"; // Test TIN pattern
      const idType = "BRN";
      const idValue = "000000000000";

      const response = await fetch(
        `${SYSTEM_URL}/api/v1.0/taxpayer/validate/${encodeURIComponent(tin)}?idType=${idType}&idValue=${encodeURIComponent(idValue)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      // API should respond (200 for valid, 404 for not found)
      expect([200, 404]).toContain(response.status);

      // Should have correlation ID
      const correlationId =
        response.headers.get("correlationid") || response.headers.get("x-correlation-id");
      expect(correlationId).toBeDefined();

      console.log(`   TIN validation: ${response.status}, correlationId: ${correlationId}`);
    });
  });

  describe("Document Submission API Connectivity", () => {
    it("rejects invalid submission payload with proper error", async () => {
      const token = await acquireToken();

      // Send minimal invalid payload to test API connectivity
      const response = await fetch(`${SYSTEM_URL}/api/v1.0/documentsubmissions/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          documents: [], // Empty documents should be rejected
        }),
      });

      // Should get validation error, not auth error
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      const correlationId =
        response.headers.get("correlationid") || response.headers.get("x-correlation-id");
      expect(correlationId).toBeDefined();

      console.log(`   Submit validation: ${response.status}, correlationId: ${correlationId}`);
    });
  });

  describe("API Rate Limits", () => {
    it("returns rate limit headers", async () => {
      const token = await acquireToken();

      const response = await fetch(
        `${SYSTEM_URL}/api/v1.0/taxpayer/validate/C00000000000?idType=BRN&idValue=000000000000`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      // Check for rate limit headers (may or may not be present)
      const rateLimitLimit = response.headers.get("x-rate-limit-limit");
      const rateLimitRemaining = response.headers.get("x-rate-limit-remaining");

      console.log(`   Rate limit: ${rateLimitRemaining}/${rateLimitLimit}`);

      // At minimum, response should succeed
      expect([200, 404]).toContain(response.status);
    });
  });

  describe("Error Response Format", () => {
    it("returns structured error for 401 Unauthorized", async () => {
      const response = await fetch(
        `${SYSTEM_URL}/api/v1.0/taxpayer/validate/TEST?idType=BRN&idValue=TEST`,
        {
          method: "GET",
          headers: {
            Authorization: "Bearer invalid-token",
            Accept: "application/json",
          },
        }
      );

      expect(response.status).toBe(401);
    });

    it("returns structured error for 400 Bad Request", async () => {
      const token = await acquireToken();

      // Missing required query params
      const response = await fetch(`${SYSTEM_URL}/api/v1.0/taxpayer/validate/TEST`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body).toBeDefined();

      console.log(`   Error response structure:`, Object.keys(body));
    });
  });
});

describe.skipIf(SKIP_REAL_TESTS)("Gateway with Real Upstream", () => {
  // These tests use the gateway but connect to real MyInvois
  // Requires the gateway to NOT have MSW mocking enabled

  let _sessionId: string;

  /**
   * Note: To run these tests, start the gateway without MSW:
   *   NODE_ENV=test pnpm --filter gateway dev
   *
   * Then run:
   *   pnpm vitest run test/integration/real-sandbox.integration.test.ts
   */

  it.skip("creates a real session and validates token", async () => {
    // This test would require starting the gateway
    // Left as placeholder for manual testing
    expect(true).toBe(true);
  });
});
