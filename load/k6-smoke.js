/**
 * k6 Smoke Test
 *
 * Lightweight load test for validating basic gateway functionality.
 *
 * Usage:
 *   k6 run load/k6-smoke.js
 *
 * With custom base URL:
 *   k6 run -e BASE_URL=http://localhost:3000 load/k6-smoke.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");

// Configuration
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Smoke test options - minimal load
export const options = {
  vus: 1, // 1 virtual user
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% of requests under 500ms
    errors: ["rate<0.01"], // Less than 1% error rate
  },
};

// Session state (shared across iterations)
let sessionId = null;

/**
 * Setup - Create a session before tests
 */
export function setup() {
  const payload = JSON.stringify({
    env: "SANDBOX",
    mode: "TAXPAYER",
    clientId: "k6-test-client",
    clientSecret: "k6-test-secret",
  });

  const response = http.post(`${BASE_URL}/v1/sessions`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(response, {
    "session created": (r) => r.status === 201,
  });

  if (response.status !== 201) {
    console.error("Failed to create session:", response.body);
    return null;
  }

  const data = JSON.parse(response.body);
  console.log(`Created session: ${data.sessionId}`);
  return { sessionId: data.sessionId };
}

/**
 * Main test scenario
 */
export default function (data) {
  if (!data || !data.sessionId) {
    console.error("No session available");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Session-Id": data.sessionId,
  };

  // Test 1: Health check
  {
    const response = http.get(`${BASE_URL}/healthz`);
    const success = check(response, {
      "healthz status 200": (r) => r.status === 200,
      "healthz has status": (r) => JSON.parse(r.body).status === "ok",
    });
    errorRate.add(!success);
  }

  sleep(0.5);

  // Test 2: Get session
  {
    const response = http.get(`${BASE_URL}/v1/sessions/${data.sessionId}`);
    const success = check(response, {
      "get session status 200": (r) => r.status === 200,
      "get session has id": (r) => JSON.parse(r.body).sessionId === data.sessionId,
    });
    errorRate.add(!success);
  }

  sleep(0.5);

  // Test 3: Submit document
  {
    const docPayload = JSON.stringify({
      documents: [
        {
          codeNumber: `INV-K6-${Date.now()}`,
          document: Buffer.from(
            JSON.stringify({ test: "document", timestamp: Date.now() })
          ).toString("base64"),
        },
      ],
    });

    const response = http.post(`${BASE_URL}/v1/submissions`, docPayload, {
      headers,
    });

    const success = check(response, {
      "submit status 202": (r) => r.status === 202,
      "submit has trackingId": (r) => {
        const body = JSON.parse(r.body);
        return body.trackingId && body.trackingId.startsWith("trk_");
      },
    });
    errorRate.add(!success);

    // If successful, check submission status
    if (response.status === 202) {
      const submitData = JSON.parse(response.body);

      sleep(0.5);

      const statusResponse = http.get(`${BASE_URL}/v1/submissions/${submitData.trackingId}`, {
        headers,
      });

      check(statusResponse, {
        "get submission status 200": (r) => r.status === 200,
      });
    }
  }

  sleep(1);
}

/**
 * Teardown - Clean up session
 */
export function teardown(data) {
  if (data && data.sessionId) {
    const response = http.del(`${BASE_URL}/v1/sessions/${data.sessionId}`);
    check(response, {
      "session deleted": (r) => r.status === 204,
    });
    console.log(`Deleted session: ${data.sessionId}`);
  }
}
