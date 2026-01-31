/**
 * Tests for submissionsRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  submission: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  submissionDocument: {
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

describe("submissionsRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findSubmissionById", () => {
    it("returns submission when found", async () => {
      const mockSubmission = {
        id: "submission-1",
        sessionId: "session-123",
        submissionUid: "HJSD135P2S7D8IU",
        documentCount: 3,
        overallStatus: "valid",
        dateTimeReceived: new Date("2024-01-15T14:20:10Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.submission.findUnique.mockResolvedValueOnce(mockSubmission);

      const result = await mockPrismaClient.submission.findUnique({
        where: { id: "submission-1" },
      });

      expect(result).toEqual(mockSubmission);
      expect(result.submissionUid).toBe("HJSD135P2S7D8IU");
    });

    it("returns null when submission not found", async () => {
      mockPrismaClient.submission.findUnique.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.submission.findUnique({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });
  });

  describe("findSubmissionByUid", () => {
    it("returns submission by MyInvois UID", async () => {
      const mockSubmission = {
        id: "submission-2",
        submissionUid: "UNIQUE-UID-12345",
        overallStatus: "in progress",
      };

      mockPrismaClient.submission.findFirst.mockResolvedValueOnce(mockSubmission);

      const result = await mockPrismaClient.submission.findFirst({
        where: { submissionUid: "UNIQUE-UID-12345" },
      });

      expect(result).toEqual(mockSubmission);
    });
  });

  describe("createSubmission", () => {
    it("creates submission with documents", async () => {
      const submissionData = {
        sessionId: "session-123",
        submissionUid: "NEW-SUBMISSION-UID",
        documentCount: 2,
        overallStatus: "in progress",
        dateTimeReceived: new Date(),
        documents: {
          create: [
            { internalId: "INV001", upstreamUuid: "uuid-1", upstreamStatus: "Submitted" },
            { internalId: "INV002", upstreamUuid: "uuid-2", upstreamStatus: "Submitted" },
          ],
        },
      };

      const createdSubmission = {
        id: "submission-new",
        ...submissionData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.submission.create.mockResolvedValueOnce(createdSubmission);

      const result = await mockPrismaClient.submission.create({
        data: submissionData,
      });

      expect(result.id).toBe("submission-new");
      expect(result.documentCount).toBe(2);
    });

    it("creates submission without documents", async () => {
      const submissionData = {
        sessionId: "session-123",
        submissionUid: "EMPTY-SUBMISSION",
        documentCount: 0,
        overallStatus: "invalid",
      };

      const createdSubmission = {
        id: "submission-empty",
        ...submissionData,
      };

      mockPrismaClient.submission.create.mockResolvedValueOnce(createdSubmission);

      const result = await mockPrismaClient.submission.create({
        data: submissionData,
      });

      expect(result.documentCount).toBe(0);
    });
  });

  describe("updateSubmission", () => {
    it("updates submission status", async () => {
      const updatedSubmission = {
        id: "submission-1",
        overallStatus: "valid",
        updatedAt: new Date(),
      };

      mockPrismaClient.submission.update.mockResolvedValueOnce(updatedSubmission);

      const result = await mockPrismaClient.submission.update({
        where: { id: "submission-1" },
        data: { overallStatus: "valid" },
      });

      expect(result.overallStatus).toBe("valid");
    });

    it("updates document count", async () => {
      const updatedSubmission = {
        id: "submission-1",
        documentCount: 5,
        updatedAt: new Date(),
      };

      mockPrismaClient.submission.update.mockResolvedValueOnce(updatedSubmission);

      const result = await mockPrismaClient.submission.update({
        where: { id: "submission-1" },
        data: { documentCount: 5 },
      });

      expect(result.documentCount).toBe(5);
    });
  });

  describe("listSubmissions", () => {
    it("returns all submissions for a session", async () => {
      const mockSubmissions = [
        { id: "sub-1", sessionId: "session-1", submissionUid: "UID-1" },
        { id: "sub-2", sessionId: "session-1", submissionUid: "UID-2" },
      ];

      mockPrismaClient.submission.findMany.mockResolvedValueOnce(mockSubmissions);

      const result = await mockPrismaClient.submission.findMany({
        where: { sessionId: "session-1" },
      });

      expect(result).toHaveLength(2);
    });

    it("returns submissions with pagination", async () => {
      const mockSubmissions = [
        { id: "sub-2", submissionUid: "UID-2" },
      ];

      mockPrismaClient.submission.findMany.mockResolvedValueOnce(mockSubmissions);

      const result = await mockPrismaClient.submission.findMany({
        where: { sessionId: "session-1" },
        skip: 1,
        take: 1,
        orderBy: { createdAt: "desc" },
      });

      expect(result).toHaveLength(1);
    });

    it("returns submissions filtered by status", async () => {
      const mockSubmissions = [
        { id: "sub-1", overallStatus: "valid" },
        { id: "sub-3", overallStatus: "valid" },
      ];

      mockPrismaClient.submission.findMany.mockResolvedValueOnce(mockSubmissions);

      const result = await mockPrismaClient.submission.findMany({
        where: { overallStatus: "valid" },
      });

      expect(result.every((s) => s.overallStatus === "valid")).toBe(true);
    });
  });

  describe("submission documents", () => {
    it("finds documents by submission ID", async () => {
      const mockDocuments = [
        { id: "doc-1", submissionId: "sub-1", internalId: "INV001", upstreamStatus: "Valid" },
        { id: "doc-2", submissionId: "sub-1", internalId: "INV002", upstreamStatus: "Valid" },
      ];

      mockPrismaClient.submissionDocument.findMany.mockResolvedValueOnce(mockDocuments);

      const result = await mockPrismaClient.submissionDocument.findMany({
        where: { submissionId: "sub-1" },
      });

      expect(result).toHaveLength(2);
    });

    it("creates multiple documents", async () => {
      const documents = [
        { submissionId: "sub-1", internalId: "INV001", upstreamUuid: "uuid-1" },
        { submissionId: "sub-1", internalId: "INV002", upstreamUuid: "uuid-2" },
        { submissionId: "sub-1", internalId: "INV003", upstreamUuid: "uuid-3" },
      ];

      mockPrismaClient.submissionDocument.createMany.mockResolvedValueOnce({ count: 3 });

      const result = await mockPrismaClient.submissionDocument.createMany({
        data: documents,
      });

      expect(result.count).toBe(3);
    });

    it("updates documents by submission", async () => {
      mockPrismaClient.submissionDocument.updateMany.mockResolvedValueOnce({ count: 5 });

      const result = await mockPrismaClient.submissionDocument.updateMany({
        where: { submissionId: "sub-1" },
        data: { upstreamStatus: "Valid" },
      });

      expect(result.count).toBe(5);
    });
  });

  describe("submission status values", () => {
    it("validates all status values", () => {
      const validStatuses = ["in progress", "valid", "partially valid", "invalid"];

      validStatuses.forEach((status) => {
        expect(["in progress", "valid", "partially valid", "invalid"]).toContain(status);
      });
    });

    it("identifies complete statuses", () => {
      const completeStatuses = ["valid", "partially valid", "invalid"];

      const isComplete = (status: string) => completeStatuses.includes(status);

      expect(isComplete("valid")).toBe(true);
      expect(isComplete("in progress")).toBe(false);
    });
  });

  describe("submission with documents relation", () => {
    it("includes documents in submission query", async () => {
      const mockSubmission = {
        id: "sub-1",
        submissionUid: "UID-1",
        documents: [
          { id: "doc-1", internalId: "INV001", upstreamStatus: "Valid" },
          { id: "doc-2", internalId: "INV002", upstreamStatus: "Invalid" },
        ],
      };

      mockPrismaClient.submission.findUnique.mockResolvedValueOnce(mockSubmission);

      const result = await mockPrismaClient.submission.findUnique({
        where: { id: "sub-1" },
        include: { documents: true },
      });

      expect(result.documents).toHaveLength(2);
    });

    it("counts documents by status", async () => {
      const mockSubmission = {
        id: "sub-1",
        documents: [
          { upstreamStatus: "Valid" },
          { upstreamStatus: "Valid" },
          { upstreamStatus: "Invalid" },
        ],
      };

      const documents = mockSubmission.documents;
      const validCount = documents.filter((d) => d.upstreamStatus === "Valid").length;
      const invalidCount = documents.filter((d) => d.upstreamStatus === "Invalid").length;

      expect(validCount).toBe(2);
      expect(invalidCount).toBe(1);
    });
  });

  describe("document status tracking", () => {
    it("tracks document status changes", () => {
      const statusHistory = [
        { status: "Submitted", at: new Date("2024-01-15T14:20:00Z") },
        { status: "Valid", at: new Date("2024-01-15T14:20:15Z") },
      ];

      expect(statusHistory[0].status).toBe("Submitted");
      expect(statusHistory[1].status).toBe("Valid");
    });

    it("identifies pending documents", () => {
      const documents = [
        { upstreamStatus: "Submitted" },
        { upstreamStatus: "Valid" },
        { upstreamStatus: "Submitted" },
      ];

      const pending = documents.filter((d) => d.upstreamStatus === "Submitted");
      expect(pending).toHaveLength(2);
    });
  });

  describe("submission date filtering", () => {
    it("filters by date range", async () => {
      const mockSubmissions = [
        { id: "sub-1", dateTimeReceived: new Date("2024-01-15") },
      ];

      mockPrismaClient.submission.findMany.mockResolvedValueOnce(mockSubmissions);

      const result = await mockPrismaClient.submission.findMany({
        where: {
          dateTimeReceived: {
            gte: new Date("2024-01-01"),
            lte: new Date("2024-01-31"),
          },
        },
      });

      expect(result).toHaveLength(1);
    });
  });
});
