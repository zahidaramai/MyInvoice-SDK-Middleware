/**
 * MSW Mock State
 *
 * In-memory state store for stateful mock responses.
 * Allows tests to configure expected behaviors and track state transitions.
 */

import { randomUUID } from "crypto";

/**
 * Document state in mock system
 */
export interface MockDocument {
  uuid: string;
  codeNumber: string;
  status: "pending" | "valid" | "invalid" | "cancelled" | "rejected";
  submissionUid: string;
  longId?: string;
  issuerTin: string;
  issuerName: string;
  receiverId: string;
  receiverName: string;
  totalPayableAmount: number;
  dateTimeValidated?: string;
  dateTimeIssued?: string;
  dateTimeReceived?: string;
  cancelDateTime?: string;
  rejectDateTime?: string;
  statusReason?: string;
}

/**
 * Submission state in mock system
 */
export interface MockSubmission {
  submissionUid: string;
  overallStatus: "in progress" | "valid" | "invalid" | "partially valid";
  documentCount: number;
  dateTimeReceived: string;
  documents: MockDocument[];
}

/**
 * Token in mock system
 */
export interface MockToken {
  accessToken: string;
  expiresIn: number;
  issuedAt: number;
}

/**
 * TIN validation entry
 */
export interface MockTinEntry {
  tin: string;
  idType: string;
  idValue: string;
  valid: boolean;
  name?: string;
}

/**
 * Mock state store
 */
class MockState {
  private submissions: Map<string, MockSubmission> = new Map();
  private documents: Map<string, MockDocument> = new Map();
  private tokens: Map<string, MockToken> = new Map();
  private validTins: Map<string, MockTinEntry> = new Map();
  private rateLimited: Set<string> = new Set();
  private correlationIdCounter = 0;

  /**
   * Reset all state between tests
   */
  reset(): void {
    this.submissions.clear();
    this.documents.clear();
    this.tokens.clear();
    this.validTins.clear();
    this.rateLimited.clear();
    this.correlationIdCounter = 0;
  }

  /**
   * Generate a correlation ID
   */
  generateCorrelationId(): string {
    this.correlationIdCounter++;
    return `mock-corr-${Date.now()}-${this.correlationIdCounter}`;
  }

  // === Token Management ===

  /**
   * Create a token for a client
   */
  createToken(clientId: string, expiresIn: number = 3600): MockToken {
    const token: MockToken = {
      accessToken: `mock-token-${randomUUID()}`,
      expiresIn,
      issuedAt: Date.now(),
    };
    this.tokens.set(clientId, token);
    return token;
  }

  /**
   * Get token for a client
   */
  getToken(clientId: string): MockToken | undefined {
    return this.tokens.get(clientId);
  }

  /**
   * Validate an access token
   */
  isTokenValid(accessToken: string): boolean {
    for (const token of this.tokens.values()) {
      if (token.accessToken === accessToken) {
        const now = Date.now();
        const expiresAt = token.issuedAt + token.expiresIn * 1000;
        return now < expiresAt;
      }
    }
    return false;
  }

  /**
   * Invalidate a token (for testing 401 scenarios)
   */
  invalidateToken(clientId: string): void {
    this.tokens.delete(clientId);
  }

  // === Submission Management ===

  /**
   * Create a submission
   */
  createSubmission(
    documents: Array<{ codeNumber: string; accepted: boolean }>,
    issuerTin: string = "C12345678901"
  ): MockSubmission {
    const submissionUid = randomUUID();
    const now = new Date().toISOString();

    const mockDocs: MockDocument[] = documents.map((doc) => ({
      uuid: randomUUID(),
      codeNumber: doc.codeNumber,
      status: doc.accepted ? "pending" : "invalid",
      submissionUid,
      issuerTin,
      issuerName: "Test Company Sdn Bhd",
      receiverId: "C98765432109",
      receiverName: "Customer Company Sdn Bhd",
      totalPayableAmount: 1000.0,
      dateTimeIssued: now,
      dateTimeReceived: now,
    }));

    const acceptedCount = documents.filter((d) => d.accepted).length;
    let overallStatus: MockSubmission["overallStatus"] = "in progress";
    if (acceptedCount === 0) {
      overallStatus = "invalid";
    }

    const submission: MockSubmission = {
      submissionUid,
      overallStatus,
      documentCount: documents.length,
      dateTimeReceived: now,
      documents: mockDocs,
    };

    this.submissions.set(submissionUid, submission);
    for (const doc of mockDocs) {
      this.documents.set(doc.uuid, doc);
    }

    return submission;
  }

  /**
   * Get a submission by UID
   */
  getSubmission(submissionUid: string): MockSubmission | undefined {
    return this.submissions.get(submissionUid);
  }

  /**
   * Update submission status (simulate polling progress)
   */
  setSubmissionStatus(
    submissionUid: string,
    status: MockSubmission["overallStatus"]
  ): void {
    const submission = this.submissions.get(submissionUid);
    if (submission) {
      submission.overallStatus = status;
      if (status === "valid") {
        const now = new Date().toISOString();
        for (const doc of submission.documents) {
          if (doc.status === "pending") {
            doc.status = "valid";
            doc.dateTimeValidated = now;
            doc.longId = `LONG-${doc.uuid.slice(0, 8).toUpperCase()}`;
          }
        }
      } else if (status === "invalid") {
        for (const doc of submission.documents) {
          if (doc.status === "pending") {
            doc.status = "invalid";
          }
        }
      }
    }
  }

  // === Document Management ===

  /**
   * Get a document by UUID
   */
  getDocument(uuid: string): MockDocument | undefined {
    return this.documents.get(uuid);
  }

  /**
   * Cancel a document
   */
  cancelDocument(uuid: string, reason: string): boolean {
    const doc = this.documents.get(uuid);
    if (!doc) return false;
    if (doc.status !== "valid") return false;

    doc.status = "cancelled";
    doc.cancelDateTime = new Date().toISOString();
    doc.statusReason = reason;
    return true;
  }

  /**
   * Reject a document
   */
  rejectDocument(uuid: string, reason: string): boolean {
    const doc = this.documents.get(uuid);
    if (!doc) return false;
    if (doc.status !== "valid") return false;

    doc.status = "rejected";
    doc.rejectDateTime = new Date().toISOString();
    doc.statusReason = reason;
    return true;
  }

  // === TIN Validation ===

  /**
   * Add a valid TIN entry
   */
  addValidTin(entry: MockTinEntry): void {
    const key = `${entry.tin}:${entry.idType}:${entry.idValue}`;
    this.validTins.set(key, entry);
  }

  /**
   * Check TIN validity
   */
  validateTin(
    tin: string,
    idType: string,
    idValue: string
  ): { valid: boolean; name?: string } {
    const key = `${tin}:${idType}:${idValue}`;
    const entry = this.validTins.get(key);
    if (entry) {
      return { valid: entry.valid, name: entry.name };
    }
    // Default: TIN not found = invalid
    return { valid: false };
  }

  // === Rate Limiting ===

  /**
   * Set an endpoint as rate limited
   */
  setRateLimited(endpoint: string): void {
    this.rateLimited.add(endpoint);
  }

  /**
   * Clear rate limiting for an endpoint
   */
  clearRateLimited(endpoint: string): void {
    this.rateLimited.delete(endpoint);
  }

  /**
   * Check if endpoint is rate limited
   */
  isRateLimited(endpoint: string): boolean {
    return this.rateLimited.has(endpoint);
  }

  /**
   * Clear all rate limits
   */
  clearAllRateLimits(): void {
    this.rateLimited.clear();
  }
}

// Singleton instance
export const mockState = new MockState();

// Export type for documentation
export type { MockState };
