/**
 * MSW Negative Scenario Handlers
 *
 * Handlers for testing error conditions and edge cases.
 * These simulate various MyInvois API failure modes.
 */

import { http, HttpResponse, delay } from "msw";
import { mockState } from "./state.js";

// MyInvois base URLs
// Note: Both identity and system APIs use the same base URL in the actual implementation
const SANDBOX_BASE_URL = "https://preprod-api.myinvois.hasil.gov.my";

/**
 * Create correlation ID header
 */
function correlationHeaders(): Record<string, string> {
  return {
    "x-correlation-id": mockState.generateCorrelationId(),
    "x-rate-limit-limit": "100",
    "x-rate-limit-remaining": "0",
  };
}

// ============================================================================
// Business Validation Failure Handlers
// ============================================================================

/**
 * Simulate duplicate submission error
 * Step03-Duplicated Submission Validator
 */
export const duplicateSubmissionHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Document has already been submitted previously",
        code: "DuplicateSubmission",
        stepName: "Step03-Duplicated Submission Validator",
        errorCode: "ERR003",
      },
      { status: 422, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate invalid taxpayer / wrong TIN error
 * Step05-Taxpayer Profile Validator
 */
export const invalidTaxpayerHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "No Taxpayer found for the given buyer TIN",
        code: "TaxpayerNotFound",
        stepName: "Step05-Taxpayer Profile Validator",
        errorCode: "ERR045",
        propertyPath: "Customer.TIN",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate invalid taxpayer with Malay message
 */
export const invalidTaxpayerMalayHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Tiada pembayar cukai dijumpai untuk TIN pembeli yang diberikan",
        code: "TaxpayerNotFound",
        stepName: "Step05-Taxpayer Profile Validator",
        errorCode: "ERR045",
        propertyPath: "Customer.TIN",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate totals mismatch error
 * Step08-Amount/Totals Validator
 */
export const invalidTotalsHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Invoice total does not match sum of line items",
        code: "TotalsMismatch",
        stepName: "Step08-Amount/Totals Validator",
        errorCode: "ERR102",
        propertyPath: "LegalMonetaryTotal.PayableAmount",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate invalid document relation error (credit note without reference)
 * Document Relation Validator
 */
export const invalidDocumentRelationHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Credit note must reference a valid original invoice",
        code: "InvalidDocumentRelation",
        stepName: "Document Relation Validator",
        errorCode: "ERR200",
        propertyPath: "BillingReference.InvoiceDocumentReference",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate document structure validation error
 */
export const invalidDocumentStructureHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Required field missing: InvoiceTypeCode",
        code: "ValidationError",
        stepName: "Document Structure Validator",
        errorCode: "ERR050",
        propertyPath: "InvoiceTypeCode",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

// ============================================================================
// Infrastructure / Platform Failure Handlers
// ============================================================================

/**
 * Simulate upstream timeout
 * Uses MSW's network error to simulate a timeout
 * Note: Using HttpResponse.error() to trigger a network-level error
 */
export const upstreamTimeoutHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    // Short delay to simulate initial connection, then return network error
    await delay(100);
    // HttpResponse.error() simulates a network failure (like a timeout)
    return HttpResponse.error();
  }
);

/**
 * Simulate upstream 500 error
 */
export const upstream500Handler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Internal server error",
        code: "InternalError",
      },
      { status: 500, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate upstream 502 error
 */
export const upstream502Handler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Bad gateway",
        code: "BadGateway",
      },
      { status: 502, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate upstream 503 error
 */
export const upstream503Handler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Service temporarily unavailable",
        code: "ServiceUnavailable",
      },
      { status: 503, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate upstream 429 rate limit with Retry-After header
 */
export const upstream429Handler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Rate limit exceeded",
        code: "RateLimitExceeded",
      },
      {
        status: 429,
        headers: {
          ...correlationHeaders(),
          "retry-after": "60",
          "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 60),
        },
      }
    );
  }
);

/**
 * Simulate upstream 429 with custom Retry-After value
 */
export function createRateLimitHandler(retryAfterSeconds: number) {
  return http.post(
    `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
    async () => {
      return HttpResponse.json(
        {
          message: "Rate limit exceeded",
          code: "RateLimitExceeded",
        },
        {
          status: 429,
          headers: {
            ...correlationHeaders(),
            "retry-after": String(retryAfterSeconds),
            "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + retryAfterSeconds),
          },
        }
      );
    }
  );
}

// ============================================================================
// Auth / Session Failure Handlers
// ============================================================================

/**
 * Simulate invalid client credentials (invalid_client)
 */
export const invalidClientHandler = http.post(
  `${SANDBOX_BASE_URL}/connect/token`,
  async () => {
    return HttpResponse.json(
      {
        error: "invalid_client",
        error_description: "Invalid client credentials",
      },
      { status: 401, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate invalid credentials (400 response)
 */
export const invalidCredentials400Handler = http.post(
  `${SANDBOX_BASE_URL}/connect/token`,
  async () => {
    return HttpResponse.json(
      {
        error: "invalid_client",
        error_description: "Client authentication failed",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate expired token on API call
 */
export const expiredTokenHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        error: "invalid_token",
        error_description: "Token has expired",
      },
      { status: 401, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate token endpoint unavailable (503)
 */
export const tokenUnavailableHandler = http.post(
  `${SANDBOX_BASE_URL}/connect/token`,
  async () => {
    return HttpResponse.json(
      {
        error: "service_unavailable",
        error_description: "Authentication service is temporarily unavailable",
      },
      { status: 503, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate token endpoint timeout
 */
export const tokenTimeoutHandler = http.post(
  `${SANDBOX_BASE_URL}/connect/token`,
  async () => {
    await delay(30000);
    return HttpResponse.json(
      { message: "This should never be received" },
      { status: 200 }
    );
  }
);

// ============================================================================
// Submission Status Handlers (for polling tests)
// ============================================================================

/**
 * Simulate submission not found on polling
 */
export const submissionNotFoundHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/:submissionUid`,
  async () => {
    return HttpResponse.json(
      {
        message: "Submission not found",
        code: "NotFound",
      },
      { status: 404, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate submission with invalid document status
 */
export const submissionInvalidHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/:submissionUid`,
  async () => {
    return HttpResponse.json(
      {
        submissionUid: "test-submission-uid",
        overallStatus: "invalid",
        documentCount: 1,
        dateTimeReceived: new Date().toISOString(),
        documentSummary: [
          {
            uuid: "doc-uuid-001",
            internalId: "INV-001",
            status: "invalid",
            dateTimeValidated: new Date().toISOString(),
            validationResults: {
              status: "invalid",
              validationSteps: [
                {
                  name: "Step05-Taxpayer Profile Validator",
                  status: "invalid",
                  error: {
                    code: "ERR045",
                    message: "Invalid buyer TIN",
                  },
                },
              ],
            },
          },
        ],
      },
      { status: 200, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate submission with duplicate status
 */
export const submissionDuplicateHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/:submissionUid`,
  async () => {
    return HttpResponse.json(
      {
        submissionUid: "test-submission-uid",
        overallStatus: "invalid",
        documentCount: 1,
        dateTimeReceived: new Date().toISOString(),
        documentSummary: [
          {
            uuid: "doc-uuid-001",
            internalId: "INV-001",
            status: "invalid",
            dateTimeValidated: new Date().toISOString(),
            validationResults: {
              status: "invalid",
              validationSteps: [
                {
                  name: "Step03-Duplicated Submission Validator",
                  status: "invalid",
                  error: {
                    code: "ERR003",
                    message: "Document already submitted",
                  },
                },
              ],
            },
          },
        ],
      },
      { status: 200, headers: correlationHeaders() }
    );
  }
);

// ============================================================================
// Signature Validation Handlers (v1.1)
// ============================================================================

/**
 * Simulate missing signature error for v1.1 document
 * Signature Validation Step
 */
export const signingRequiredHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Document version 1.1 requires digital signature",
        code: "SignatureRequired",
        stepName: "Signature Validation Step",
        errorCode: "ERR301",
        propertyPath: "UBLExtensions.Signature",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate digest mismatch error (document tampered after signing)
 * Signature Validation Step
 */
export const digestMismatchHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Document digest does not match signed digest value",
        code: "DigestMismatch",
        stepName: "Signature Validation Step",
        errorCode: "ERR302",
        propertyPath: "UBLExtensions.Signature.SignedInfo.DigestValue",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate invalid signature error (cryptographic verification failed)
 * Signature Validation Step
 */
export const signatureInvalidHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Digital signature verification failed",
        code: "SignatureInvalid",
        stepName: "Signature Validation Step",
        errorCode: "ERR303",
        propertyPath: "UBLExtensions.Signature.SignatureValue",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate certificate rejected error (cert not trusted, expired, or invalid)
 * Signature Validation Step
 */
export const certificateRejectedHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Signing certificate is not valid or not trusted by LHDN",
        code: "CertificateRejected",
        stepName: "Signature Validation Step",
        errorCode: "ERR304",
        propertyPath: "UBLExtensions.Signature.KeyInfo.X509Certificate",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate certificate expired error from upstream
 * Signature Validation Step
 */
export const certificateExpiredUpstreamHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "Signing certificate has expired",
        code: "CertificateExpired",
        stepName: "Signature Validation Step",
        errorCode: "ERR305",
        propertyPath: "UBLExtensions.Signature.KeyInfo.X509Certificate",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate TIN mismatch between auth and document
 * When intermediary submits for wrong TIN
 */
export const tinMismatchHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async () => {
    return HttpResponse.json(
      {
        message: "The authenticated TIN and documents TIN is not matching",
        code: "TinMismatch",
        stepName: "Authorization Validator",
        errorCode: "ERR401",
      },
      { status: 400, headers: correlationHeaders() }
    );
  }
);

// ============================================================================
// TIN Validation Handlers
// ============================================================================

/**
 * Simulate TIN not found
 */
export const tinNotFoundHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/taxpayer/validate/:tin`,
  async () => {
    return HttpResponse.json(
      {
        message: "Taxpayer not found",
        code: "TaxpayerNotFound",
      },
      { status: 404, headers: correlationHeaders() }
    );
  }
);

/**
 * Simulate TIN validation rate limit
 */
export const tinRateLimitHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/taxpayer/validate/:tin`,
  async () => {
    return HttpResponse.json(
      {
        message: "Rate limit exceeded",
        code: "RateLimitExceeded",
      },
      {
        status: 429,
        headers: {
          ...correlationHeaders(),
          "retry-after": "30",
        },
      }
    );
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a custom error handler for testing specific scenarios
 */
export function createCustomErrorHandler(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  status: number,
  body: unknown,
  headers?: Record<string, string>
) {
  const baseUrl = path.startsWith("/connect")
    ? SANDBOX_BASE_URL
    : SANDBOX_BASE_URL;

  const httpMethod = {
    GET: http.get,
    POST: http.post,
    PUT: http.put,
    DELETE: http.delete,
  }[method];

  return httpMethod(`${baseUrl}${path}`, async () => {
    return HttpResponse.json(body, {
      status,
      headers: { ...correlationHeaders(), ...headers },
    });
  });
}

/**
 * Create a handler that times out after specified delay
 */
export function createTimeoutHandler(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  delayMs: number
) {
  const baseUrl = path.startsWith("/connect")
    ? SANDBOX_BASE_URL
    : SANDBOX_BASE_URL;

  const httpMethod = {
    GET: http.get,
    POST: http.post,
    PUT: http.put,
    DELETE: http.delete,
  }[method];

  return httpMethod(`${baseUrl}${path}`, async () => {
    await delay(delayMs);
    // Return something after delay (should be aborted by client timeout)
    return HttpResponse.json({ message: "Delayed response" }, { status: 200 });
  });
}

// ============================================================================
// Export All Handlers
// ============================================================================

export const negativeHandlers = {
  // Business validation
  duplicateSubmission: duplicateSubmissionHandler,
  invalidTaxpayer: invalidTaxpayerHandler,
  invalidTaxpayerMalay: invalidTaxpayerMalayHandler,
  invalidTotals: invalidTotalsHandler,
  invalidDocumentRelation: invalidDocumentRelationHandler,
  invalidDocumentStructure: invalidDocumentStructureHandler,

  // Infrastructure
  upstreamTimeout: upstreamTimeoutHandler,
  upstream500: upstream500Handler,
  upstream502: upstream502Handler,
  upstream503: upstream503Handler,
  upstream429: upstream429Handler,

  // Auth
  invalidClient: invalidClientHandler,
  invalidCredentials400: invalidCredentials400Handler,
  expiredToken: expiredTokenHandler,
  tokenUnavailable: tokenUnavailableHandler,
  tokenTimeout: tokenTimeoutHandler,

  // Polling
  submissionNotFound: submissionNotFoundHandler,
  submissionInvalid: submissionInvalidHandler,
  submissionDuplicate: submissionDuplicateHandler,

  // TIN
  tinNotFound: tinNotFoundHandler,
  tinRateLimit: tinRateLimitHandler,

  // Signature validation (v1.1)
  signingRequired: signingRequiredHandler,
  digestMismatch: digestMismatchHandler,
  signatureInvalid: signatureInvalidHandler,
  certificateRejected: certificateRejectedHandler,
  certificateExpiredUpstream: certificateExpiredUpstreamHandler,
  tinMismatch: tinMismatchHandler,
};

export type NegativeHandlerName = keyof typeof negativeHandlers;
