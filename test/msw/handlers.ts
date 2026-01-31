/**
 * MSW Request Handlers
 *
 * Intercepts requests to MyInvois API endpoints.
 * All handlers are stateful via mockState.
 */

import { http, HttpResponse } from "msw";
import { mockState } from "./state.js";

// MyInvois base URLs
// Note: Both identity and system APIs use the same base URL in the actual implementation
const SANDBOX_BASE_URL = "https://preprod-api.myinvois.hasil.gov.my";
const PROD_BASE_URL = "https://api.myinvois.hasil.gov.my";

/**
 * Create correlation ID header
 */
function correlationHeaders(): Record<string, string> {
  return {
    "x-correlation-id": mockState.generateCorrelationId(),
    "x-rate-limit-limit": "100",
    "x-rate-limit-remaining": "99",
  };
}

/**
 * Validate Bearer token from Authorization header
 */
function validateToken(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  return mockState.isTokenValid(token);
}

/**
 * Create 401 Unauthorized response
 */
function unauthorizedResponse(): HttpResponse {
  return HttpResponse.json(
    { error: "invalid_token", error_description: "Token is invalid or expired" },
    { status: 401, headers: correlationHeaders() }
  );
}

/**
 * Create 429 Rate Limited response
 */
function rateLimitedResponse(): HttpResponse {
  return HttpResponse.json(
    { message: "Rate limit exceeded", code: "RateLimitExceeded" },
    {
      status: 429,
      headers: {
        ...correlationHeaders(),
        "retry-after": "60",
      },
    }
  );
}

// === Token Handlers ===

const tokenHandler = http.post(
  `${SANDBOX_BASE_URL}/connect/token`,
  async ({ request }) => {
    if (mockState.isRateLimited("token")) {
      return rateLimitedResponse();
    }

    const formData = await request.text();
    const params = new URLSearchParams(formData);
    const clientId = params.get("client_id");
    const clientSecret = params.get("client_secret");

    if (!clientId || !clientSecret) {
      return HttpResponse.json(
        { error: "invalid_request", error_description: "Missing credentials" },
        { status: 400, headers: correlationHeaders() }
      );
    }

    // Simple validation: client_secret must not be empty
    if (clientSecret === "invalid") {
      return HttpResponse.json(
        { error: "invalid_client", error_description: "Invalid credentials" },
        { status: 401, headers: correlationHeaders() }
      );
    }

    const token = mockState.createToken(clientId);
    return HttpResponse.json(
      {
        access_token: token.accessToken,
        token_type: "Bearer",
        expires_in: token.expiresIn,
      },
      { status: 200, headers: correlationHeaders() }
    );
  }
);

const prodTokenHandler = http.post(
  `${PROD_BASE_URL}/connect/token`,
  async ({ request }) => {
    // Same logic as sandbox
    if (mockState.isRateLimited("token")) {
      return rateLimitedResponse();
    }

    const formData = await request.text();
    const params = new URLSearchParams(formData);
    const clientId = params.get("client_id");
    const clientSecret = params.get("client_secret");

    if (!clientId || !clientSecret) {
      return HttpResponse.json(
        { error: "invalid_request", error_description: "Missing credentials" },
        { status: 400, headers: correlationHeaders() }
      );
    }

    if (clientSecret === "invalid") {
      return HttpResponse.json(
        { error: "invalid_client", error_description: "Invalid credentials" },
        { status: 401, headers: correlationHeaders() }
      );
    }

    const token = mockState.createToken(clientId);
    return HttpResponse.json(
      {
        access_token: token.accessToken,
        token_type: "Bearer",
        expires_in: token.expiresIn,
      },
      { status: 200, headers: correlationHeaders() }
    );
  }
);

// === Submit Documents Handler ===

const submitDocumentsHandler = http.post(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`,
  async ({ request }) => {
    if (mockState.isRateLimited("submit")) {
      return rateLimitedResponse();
    }

    if (!validateToken(request)) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as {
      documents: Array<{ codeNumber: string; document: string }>;
    };

    if (!body.documents || !Array.isArray(body.documents)) {
      return HttpResponse.json(
        { message: "Invalid request body", code: "InvalidRequest" },
        { status: 400, headers: correlationHeaders() }
      );
    }

    // Create submission with all documents accepted
    const docSpecs = body.documents.map((d) => ({
      codeNumber: d.codeNumber,
      accepted: true, // Default: accept all
    }));

    const submission = mockState.createSubmission(docSpecs);

    const acceptedDocuments = submission.documents.map((doc) => ({
      uuid: doc.uuid,
      invoiceCodeNumber: doc.codeNumber,
    }));

    return HttpResponse.json(
      {
        submissionUid: submission.submissionUid,
        acceptedDocuments,
        rejectedDocuments: [],
      },
      { status: 202, headers: correlationHeaders() }
    );
  }
);

// === Get Submission Handler ===

const getSubmissionHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/:submissionUid`,
  async ({ params, request }) => {
    if (mockState.isRateLimited("getSubmission")) {
      return rateLimitedResponse();
    }

    if (!validateToken(request)) {
      return unauthorizedResponse();
    }

    const { submissionUid } = params;
    const submission = mockState.getSubmission(submissionUid as string);

    if (!submission) {
      return HttpResponse.json(
        { message: "Submission not found", code: "NotFound" },
        { status: 404, headers: correlationHeaders() }
      );
    }

    const documentSummary = submission.documents.map((doc) => ({
      uuid: doc.uuid,
      internalId: doc.codeNumber,
      status: doc.status,
      longId: doc.longId,
      dateTimeValidated: doc.dateTimeValidated,
      issuerTin: doc.issuerTin,
      issuerName: doc.issuerName,
      receiverId: doc.receiverId,
      receiverName: doc.receiverName,
      totalPayableAmount: doc.totalPayableAmount,
    }));

    return HttpResponse.json(
      {
        submissionUid: submission.submissionUid,
        overallStatus: submission.overallStatus,
        documentCount: submission.documentCount,
        dateTimeReceived: submission.dateTimeReceived,
        documentSummary,
      },
      { status: 200, headers: correlationHeaders() }
    );
  }
);

// === Change Document State Handler ===

const changeDocumentStateHandler = http.put(
  `${SANDBOX_BASE_URL}/api/v1.0/documents/state/:uuid/state`,
  async ({ params, request }) => {
    if (mockState.isRateLimited("changeState")) {
      return rateLimitedResponse();
    }

    if (!validateToken(request)) {
      return unauthorizedResponse();
    }

    const { uuid } = params;
    const body = (await request.json()) as { status: string; reason: string };

    const doc = mockState.getDocument(uuid as string);
    if (!doc) {
      return HttpResponse.json(
        { message: "Document not found", code: "DocumentNotFound" },
        { status: 404, headers: correlationHeaders() }
      );
    }

    if (body.status === "cancelled") {
      const success = mockState.cancelDocument(uuid as string, body.reason);
      if (!success) {
        return HttpResponse.json(
          { message: "Document cannot be cancelled", code: "InvalidState" },
          { status: 400, headers: correlationHeaders() }
        );
      }
    } else if (body.status === "rejected") {
      const success = mockState.rejectDocument(uuid as string, body.reason);
      if (!success) {
        return HttpResponse.json(
          { message: "Document cannot be rejected", code: "InvalidState" },
          { status: 400, headers: correlationHeaders() }
        );
      }
    } else {
      return HttpResponse.json(
        { message: "Invalid status", code: "InvalidStatus" },
        { status: 400, headers: correlationHeaders() }
      );
    }

    const updatedDoc = mockState.getDocument(uuid as string)!;
    return HttpResponse.json(
      { uuid: updatedDoc.uuid, status: updatedDoc.status },
      { status: 200, headers: correlationHeaders() }
    );
  }
);

// === Get Document Details Handler ===

// Helper function for document details response
function createDocumentDetailsResponse(params: { uuid: string }, request: Request) {
  if (mockState.isRateLimited("getDetails")) {
    return rateLimitedResponse();
  }

  if (!validateToken(request)) {
    return unauthorizedResponse();
  }

  const { uuid } = params;
  const doc = mockState.getDocument(uuid as string);

  if (!doc) {
    return HttpResponse.json(
      { message: "Document not found", code: "DocumentNotFound" },
      { status: 404, headers: correlationHeaders() }
    );
  }

  return HttpResponse.json(
    {
      uuid: doc.uuid,
      submissionUid: doc.submissionUid,
      longId: doc.longId,
      internalId: doc.codeNumber,
      typeName: "01", // Invoice
      issuerTin: doc.issuerTin,
      issuerName: doc.issuerName,
      receiverId: doc.receiverId,
      receiverName: doc.receiverName,
      dateTimeIssued: doc.dateTimeIssued,
      dateTimeReceived: doc.dateTimeReceived,
      dateTimeValidated: doc.dateTimeValidated,
      totalPayableAmount: doc.totalPayableAmount,
      status: doc.status,
      cancelDateTime: doc.cancelDateTime,
      rejectDateTime: doc.rejectDateTime,
      documentStatusReason: doc.statusReason,
    },
    { status: 200, headers: correlationHeaders() }
  );
}

const getDocumentDetailsHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/documents/:uuid/details`,
  async ({ params, request }) => createDocumentDetailsResponse(params as { uuid: string }, request)
);

const prodGetDocumentDetailsHandler = http.get(
  `${PROD_BASE_URL}/api/v1.0/documents/:uuid/details`,
  async ({ params, request }) => createDocumentDetailsResponse(params as { uuid: string }, request)
);

// === Validate TIN Handler ===

const validateTinHandler = http.get(
  `${SANDBOX_BASE_URL}/api/v1.0/taxpayer/validate/:tin`,
  async ({ params, request }) => {
    if (mockState.isRateLimited("validateTin")) {
      return rateLimitedResponse();
    }

    if (!validateToken(request)) {
      return unauthorizedResponse();
    }

    const { tin } = params;
    const url = new URL(request.url);
    const idType = url.searchParams.get("idType");
    const idValue = url.searchParams.get("idValue");

    if (!idType || !idValue) {
      return HttpResponse.json(
        { message: "Missing idType or idValue", code: "InvalidRequest" },
        { status: 400, headers: correlationHeaders() }
      );
    }

    const result = mockState.validateTin(tin as string, idType, idValue);

    if (result.valid) {
      return HttpResponse.json(
        { name: result.name || "Valid Taxpayer" },
        { status: 200, headers: correlationHeaders() }
      );
    }

    return HttpResponse.json(
      { message: "Taxpayer not found", code: "TaxpayerNotFound" },
      { status: 404, headers: correlationHeaders() }
    );
  }
);

// === Export All Handlers ===

export const handlers = [
  // Token endpoints
  tokenHandler,
  prodTokenHandler,

  // Document submission
  submitDocumentsHandler,
  getSubmissionHandler,

  // Document actions
  changeDocumentStateHandler,
  getDocumentDetailsHandler,
  prodGetDocumentDetailsHandler,

  // Taxpayer validation
  validateTinHandler,
];

// Export individual handlers for testing specific scenarios
export {
  tokenHandler,
  submitDocumentsHandler,
  getSubmissionHandler,
  changeDocumentStateHandler,
  getDocumentDetailsHandler,
  prodGetDocumentDetailsHandler,
  validateTinHandler,
};
