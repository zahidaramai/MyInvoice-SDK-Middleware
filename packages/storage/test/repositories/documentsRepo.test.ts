/**
 * Tests for documentsRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  RecordDocumentActionInput,
  RecordDocumentActionErrorInput,
  RecordDocumentDetailsInput,
} from "../../src/types.js";

// Mock Prisma client
const mockPrismaClient = {
  submissionDocument: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

// Import after mocking
import {
  getDocumentByUuid,
  recordDocumentAction,
  recordDocumentActionError,
  recordDocumentDetails,
  getDocumentWithActions,
  documentExistsByUuid,
} from "../../src/repositories/documentsRepo.js";

describe("documentsRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDocumentByUuid", () => {
    it("returns document when found", async () => {
      const mockDoc = {
        id: "doc-1",
        upstreamUuid: "uuid-123",
        upstreamStatus: "VALID",
        longId: "long-id-456",
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(mockDoc);

      const result = await getDocumentByUuid("uuid-123");

      expect(mockPrismaClient.submissionDocument.findFirst).toHaveBeenCalledWith({
        where: { upstreamUuid: "uuid-123" },
      });
      expect(result).toEqual(mockDoc);
    });

    it("returns null when document not found", async () => {
      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(null);

      const result = await getDocumentByUuid("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("recordDocumentAction", () => {
    it("records CANCEL action successfully", async () => {
      const existingDoc = {
        id: "doc-1",
        upstreamUuid: "uuid-123",
      };

      const updatedDoc = {
        ...existingDoc,
        lastActionType: "CANCEL",
        lastActionReason: "Customer request",
        lastActionStatus: "Cancelled",
        upstreamStatus: "Cancelled",
        cancelDateTime: expect.any(Date),
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce(updatedDoc);

      const input: RecordDocumentActionInput = {
        uuid: "uuid-123",
        actionType: "CANCEL",
        reason: "Customer request",
        upstreamStatus: "Cancelled",
        correlationId: "corr-1",
      };

      const result = await recordDocumentAction(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalledWith({
        where: { id: "doc-1" },
        data: expect.objectContaining({
          lastActionType: "CANCEL",
          lastActionReason: "Customer request",
          lastActionStatus: "Cancelled",
          upstreamStatus: "Cancelled",
          lastActionErrorCode: null,
          lastActionErrorMessage: null,
        }),
      });
      expect(result).toBeDefined();
    });

    it("records REJECT action successfully", async () => {
      const existingDoc = {
        id: "doc-2",
        upstreamUuid: "uuid-456",
      };

      const updatedDoc = {
        ...existingDoc,
        lastActionType: "REJECT",
        lastActionReason: "Incorrect data",
        upstreamStatus: "Rejected",
        rejectDateTime: expect.any(Date),
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce(updatedDoc);

      const input: RecordDocumentActionInput = {
        uuid: "uuid-456",
        actionType: "REJECT",
        reason: "Incorrect data",
        upstreamStatus: "Rejected",
        correlationId: "corr-2",
      };

      const result = await recordDocumentAction(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("returns null when document not found", async () => {
      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(null);

      const input: RecordDocumentActionInput = {
        uuid: "non-existent",
        actionType: "CANCEL",
        reason: "Test",
        upstreamStatus: "Cancelled",
      };

      const result = await recordDocumentAction(input);

      expect(mockPrismaClient.submissionDocument.update).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("recordDocumentActionError", () => {
    it("records action error successfully", async () => {
      const existingDoc = {
        id: "doc-3",
        upstreamUuid: "uuid-789",
      };

      const updatedDoc = {
        ...existingDoc,
        lastActionType: "CANCEL",
        lastActionErrorCode: "TIMEOUT",
        lastActionErrorMessage: "Request timed out",
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce(updatedDoc);

      const input: RecordDocumentActionErrorInput = {
        uuid: "uuid-789",
        actionType: "CANCEL",
        reason: "Customer request",
        errorCode: "TIMEOUT",
        errorMessage: "Request timed out",
      };

      const result = await recordDocumentActionError(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalledWith({
        where: { id: "doc-3" },
        data: expect.objectContaining({
          lastActionType: "CANCEL",
          lastActionReason: "Customer request",
          lastActionErrorCode: "TIMEOUT",
          lastActionErrorMessage: "Request timed out",
        }),
      });
      expect(result).toBeDefined();
    });

    it("returns null when document not found", async () => {
      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(null);

      const input: RecordDocumentActionErrorInput = {
        uuid: "non-existent",
        actionType: "CANCEL",
        reason: "Test",
        errorCode: "ERROR",
        errorMessage: "Error message",
      };

      const result = await recordDocumentActionError(input);

      expect(result).toBeNull();
    });
  });

  describe("recordDocumentDetails", () => {
    it("records full document details", async () => {
      const existingDoc = {
        id: "doc-4",
        upstreamUuid: "uuid-full",
      };

      const updatedDoc = {
        ...existingDoc,
        upstreamStatus: "Valid",
        longId: "long-id-new",
        issuerTin: "C12345678901",
        issuerName: "Test Company",
        receiverId: "C98765432100",
        receiverName: "Buyer Company",
        totalPayableAmount: 106.00,
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce(updatedDoc);

      const input: RecordDocumentDetailsInput = {
        uuid: "uuid-full",
        status: "Valid",
        longId: "long-id-new",
        dateTimeValidated: new Date("2024-01-15T10:06:00Z"),
        dateTimeIssued: new Date("2024-01-15T10:00:00Z"),
        dateTimeReceived: new Date("2024-01-15T10:05:00Z"),
        issuerTin: "C12345678901",
        issuerName: "Test Company",
        receiverId: "C98765432100",
        receiverName: "Buyer Company",
        totalPayableAmount: 106.00,
        correlationId: "corr-full",
      };

      const result = await recordDocumentDetails(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalledWith({
        where: { id: "doc-4" },
        data: expect.objectContaining({
          upstreamStatus: "Valid",
          longId: "long-id-new",
        }),
      });
      expect(result).toBeDefined();
    });

    it("records minimal document details", async () => {
      const existingDoc = {
        id: "doc-5",
        upstreamUuid: "uuid-minimal",
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce({
        ...existingDoc,
        upstreamStatus: "Submitted",
      });

      const input: RecordDocumentDetailsInput = {
        uuid: "uuid-minimal",
        status: "Submitted",
      };

      const result = await recordDocumentDetails(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalledWith({
        where: { id: "doc-5" },
        data: {
          upstreamStatus: "Submitted",
        },
      });
      expect(result).toBeDefined();
    });

    it("records cancel and reject datetimes", async () => {
      const existingDoc = {
        id: "doc-6",
        upstreamUuid: "uuid-dates",
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce({
        ...existingDoc,
        upstreamStatus: "Cancelled",
        cancelDateTime: new Date("2024-01-16T12:00:00Z"),
      });

      const input: RecordDocumentDetailsInput = {
        uuid: "uuid-dates",
        status: "Cancelled",
        cancelDateTime: new Date("2024-01-16T12:00:00Z"),
      };

      const result = await recordDocumentDetails(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalledWith({
        where: { id: "doc-6" },
        data: expect.objectContaining({
          upstreamStatus: "Cancelled",
          cancelDateTime: expect.any(Date),
        }),
      });
      expect(result).toBeDefined();
    });

    it("records status reason", async () => {
      const existingDoc = {
        id: "doc-7",
        upstreamUuid: "uuid-reason",
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(existingDoc);
      mockPrismaClient.submissionDocument.update.mockResolvedValueOnce({
        ...existingDoc,
        upstreamStatus: "Invalid",
        statusReason: "TIN not registered",
      });

      const input: RecordDocumentDetailsInput = {
        uuid: "uuid-reason",
        status: "Invalid",
        statusReason: "TIN not registered",
      };

      const result = await recordDocumentDetails(input);

      expect(mockPrismaClient.submissionDocument.update).toHaveBeenCalledWith({
        where: { id: "doc-7" },
        data: expect.objectContaining({
          statusReason: "TIN not registered",
        }),
      });
      expect(result).toBeDefined();
    });

    it("returns null when document not found", async () => {
      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(null);

      const input: RecordDocumentDetailsInput = {
        uuid: "non-existent",
        status: "Valid",
      };

      const result = await recordDocumentDetails(input);

      expect(result).toBeNull();
    });
  });

  describe("getDocumentWithActions", () => {
    it("returns document with action fields", async () => {
      const mockDoc = {
        id: "doc-8",
        upstreamUuid: "uuid-actions",
        upstreamStatus: "Cancelled",
        lastActionType: "CANCEL",
        lastActionReason: "Customer request",
        lastActionAt: new Date(),
        lastActionStatus: "Cancelled",
        lastActionCorrelationId: "corr-cancel",
        lastActionErrorCode: null,
        lastActionErrorMessage: null,
      };

      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(mockDoc);

      const result = await getDocumentWithActions("uuid-actions");

      expect(mockPrismaClient.submissionDocument.findFirst).toHaveBeenCalledWith({
        where: { upstreamUuid: "uuid-actions" },
      });
      expect(result).toEqual(mockDoc);
    });

    it("returns null for non-existent document", async () => {
      mockPrismaClient.submissionDocument.findFirst.mockResolvedValueOnce(null);

      const result = await getDocumentWithActions("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("documentExistsByUuid", () => {
    it("returns true when document exists", async () => {
      mockPrismaClient.submissionDocument.count.mockResolvedValueOnce(1);

      const result = await documentExistsByUuid("uuid-exists");

      expect(mockPrismaClient.submissionDocument.count).toHaveBeenCalledWith({
        where: { upstreamUuid: "uuid-exists" },
      });
      expect(result).toBe(true);
    });

    it("returns false when document does not exist", async () => {
      mockPrismaClient.submissionDocument.count.mockResolvedValueOnce(0);

      const result = await documentExistsByUuid("uuid-not-exists");

      expect(result).toBe(false);
    });

    it("returns true for multiple matching documents", async () => {
      mockPrismaClient.submissionDocument.count.mockResolvedValueOnce(3);

      const result = await documentExistsByUuid("uuid-multiple");

      expect(result).toBe(true);
    });
  });
});
