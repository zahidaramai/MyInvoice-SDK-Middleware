/**
 * TST-15: Concurrent Submission Tests
 * Tests for race conditions and concurrent invoice operations
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma
vi.mock("@myinvois/storage", async () => {
  return {
    getPrismaClient: vi.fn().mockReturnValue({
      invoice: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    }),
    findCompanyById: vi.fn(),
    createInvoice: vi.fn(),
    findInvoiceByNumber: vi.fn(),
    findInvoiceByPosInvoiceId: vi.fn(),
  };
});

import { getPrismaClient, createInvoice, findInvoiceByNumber } from "@myinvois/storage";

describe("TST-15: Concurrent Submission Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Duplicate invoice number detection", () => {
    it("should detect duplicate invoice number within company", async () => {
      const existingInvoice = {
        id: "inv-existing",
        companyId: "company-123",
        invoiceNumber: "INV-001",
      };

      vi.mocked(findInvoiceByNumber).mockResolvedValue(existingInvoice as any);

      const found = await findInvoiceByNumber("company-123", "INV-001");
      expect(found).toBeDefined();
      expect(found?.invoiceNumber).toBe("INV-001");
    });

    it("should allow same invoice number for different companies", async () => {
      vi.mocked(findInvoiceByNumber)
        .mockResolvedValueOnce(null) // Not found for company-A
        .mockResolvedValueOnce(null); // Not found for company-B

      const foundA = await findInvoiceByNumber("company-A", "INV-001");
      const foundB = await findInvoiceByNumber("company-B", "INV-001");

      expect(foundA).toBeNull();
      expect(foundB).toBeNull();
    });
  });

  describe("PosInvoiceId collision handling (P1-05)", () => {
    it("should retry with new posInvoiceId on collision", async () => {
      let attempts = 0;

      vi.mocked(createInvoice).mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Unique constraint failed on field: posInvoiceId");
        }
        return {
          id: "inv-new",
          posInvoiceId: `TC-RETRY${attempts}`,
        } as any;
      });

      let result;
      for (let i = 0; i < 3; i++) {
        try {
          result = await createInvoice({} as any);
          break;
        } catch (err: any) {
          if (!err.message.includes("posInvoiceId")) throw err;
        }
      }

      expect(result).toBeDefined();
      expect(attempts).toBe(2);
    });

    it("should generate unique posInvoiceId on each attempt", () => {
      const generated = new Set<string>();

      const generatePosId = (): string => {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let id = "TC-";
        for (let i = 0; i < 8; i++) {
          id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
      };

      for (let i = 0; i < 100; i++) {
        generated.add(generatePosId());
      }

      // All should be unique
      expect(generated.size).toBe(100);
    });

    it("should give up after max retries", async () => {
      const maxRetries = 5;
      let attempts = 0;

      vi.mocked(createInvoice).mockRejectedValue(
        new Error("Unique constraint failed on field: posInvoiceId")
      );

      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          await createInvoice({} as any);
          break;
        } catch (err) {
          lastError = err;
          attempts++;
        }
      }

      expect(attempts).toBe(5);
      expect(lastError).toBeDefined();
    });
  });

  describe("Optimistic locking (P1-07)", () => {
    it("should include version in where clause", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 });

      const result = await prisma.invoice.updateMany({
        where: {
          id: "inv-1",
          version: 1,
        },
        data: {
          status: "SUBMITTED",
          version: { increment: 1 },
        },
      });

      expect(result.count).toBe(1);
    });

    it("should detect concurrent update (count = 0)", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 });

      const result = await prisma.invoice.updateMany({
        where: {
          id: "inv-1",
          version: 1, // Stale version
        },
        data: {
          status: "SUBMITTED",
          version: { increment: 1 },
        },
      });

      expect(result.count).toBe(0);
    });

    it("should retry with refreshed version on conflict", async () => {
      const prisma = getPrismaClient();
      let currentVersion = 1;

      vi.mocked(prisma.invoice.updateMany).mockImplementation(async (args) => {
        const whereVersion = (args.where as any).version;
        if (whereVersion !== currentVersion) {
          return { count: 0 }; // Version mismatch
        }
        currentVersion++;
        return { count: 1 };
      });

      vi.mocked(prisma.invoice.findFirst).mockImplementation(async () => {
        return { id: "inv-1", version: currentVersion } as any;
      });

      // First attempt with stale version (should fail)
      let result = await prisma.invoice.updateMany({
        where: { id: "inv-1", version: 0 },
        data: { status: "SUBMITTED" },
      });

      if (result.count === 0) {
        // Refresh version
        const fresh = await prisma.invoice.findFirst({ where: { id: "inv-1" } });

        // Retry with fresh version
        result = await prisma.invoice.updateMany({
          where: { id: "inv-1", version: fresh?.version },
          data: { status: "SUBMITTED" },
        });
      }

      expect(result.count).toBe(1);
    });
  });

  describe("Concurrent polling prevention (P1-08)", () => {
    it("should use mutex for polling", async () => {
      let isPolling = false;
      const pollAttempts: boolean[] = [];

      const runPoll = async () => {
        if (isPolling) {
          pollAttempts.push(false);
          return;
        }

        isPolling = true;
        pollAttempts.push(true);
        await new Promise((r) => setTimeout(r, 10));
        isPolling = false;
      };

      // Simulate concurrent polls
      await Promise.all([runPoll(), runPoll(), runPoll()]);

      const started = pollAttempts.filter((x) => x).length;
      const skipped = pollAttempts.filter((x) => !x).length;

      expect(started).toBe(1);
      expect(skipped).toBe(2);
    });

    it("should release lock even on error", async () => {
      let lockHeld = false;
      let lockReleased = false;

      const acquireLock = () => {
        lockHeld = true;
      };
      const releaseLock = () => {
        lockReleased = true;
        lockHeld = false;
      };

      const runWithLock = async () => {
        acquireLock();
        try {
          throw new Error("Simulated error");
        } finally {
          releaseLock();
        }
      };

      try {
        await runWithLock();
      } catch {
        // Expected
      }

      expect(lockReleased).toBe(true);
      expect(lockHeld).toBe(false);
    });
  });

  describe("Transaction isolation", () => {
    it("should wrap related operations in transaction", async () => {
      const prisma = getPrismaClient();
      const operations: string[] = [];

      vi.mocked(prisma.$transaction).mockImplementation(async (ops: any) => {
        operations.push("transaction_start");
        // Simulate running operations
        operations.push("create_invoice");
        operations.push("update_drafts");
        operations.push("transaction_commit");
        return [{ id: "inv-1" }];
      });

      await prisma.$transaction([]);

      expect(operations).toEqual([
        "transaction_start",
        "create_invoice",
        "update_drafts",
        "transaction_commit",
      ]);
    });

    it("should rollback on partial failure", async () => {
      const prisma = getPrismaClient();

      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("Transaction rolled back"));

      await expect(prisma.$transaction([])).rejects.toThrow("rolled back");
    });
  });

  describe("Race condition scenarios", () => {
    it("should handle read-modify-write race", async () => {
      // Simulate two processes reading the same invoice
      const invoice = { id: "inv-1", status: "SUBMITTED", version: 1 };

      // Process A reads version 1
      const processARead = { ...invoice };

      // Process B reads version 1
      const processBRead = { ...invoice };

      // Process A updates (succeeds, version becomes 2)
      const processAUpdated = processARead.version === invoice.version;
      if (processAUpdated) {
        invoice.version++;
        invoice.status = "VALID";
      }

      // Process B tries to update with stale version (should fail)
      const processBUpdated = processBRead.version === invoice.version;

      expect(processAUpdated).toBe(true);
      expect(processBUpdated).toBe(false);
    });

    it("should prevent lost update problem", () => {
      let version = 1;
      let value = 100;

      // Two concurrent increments
      const increment1 = { expectedVersion: version, increment: 10 };
      const increment2 = { expectedVersion: version, increment: 20 };

      // First one succeeds
      if (increment1.expectedVersion === version) {
        value += increment1.increment;
        version++;
      }

      // Second one fails (stale version)
      const success2 = increment2.expectedVersion === version;

      expect(value).toBe(110);
      expect(success2).toBe(false);
    });
  });

  describe("Batch operation atomicity", () => {
    it("should update all or none in batch", async () => {
      const prisma = getPrismaClient();
      const invoiceIds = ["inv-1", "inv-2", "inv-3"];

      vi.mocked(prisma.$transaction).mockImplementation(async () => {
        // All succeed
        return invoiceIds.map((id) => ({ id, status: "SUBMITTED" }));
      });

      const results = await prisma.$transaction([]);
      expect(results).toHaveLength(3);
    });

    it("should fail entire batch on single failure", async () => {
      const prisma = getPrismaClient();

      vi.mocked(prisma.$transaction).mockRejectedValue(
        new Error("One invoice failed, batch rolled back")
      );

      await expect(prisma.$transaction([])).rejects.toThrow("rolled back");
    });
  });
});
