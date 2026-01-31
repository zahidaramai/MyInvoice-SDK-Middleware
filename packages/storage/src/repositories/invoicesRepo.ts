/**
 * Invoices repository - handles persistence of KLCubeLHDN invoices
 */

import { getPrismaClient } from "../prisma.js";
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  UpdateInvoiceStatusInput,
  UpdateDraftInvoiceInput,
  InvoiceWithCompany,
  ListInvoicesOptions,
  PaginatedResult,
} from "../types.js";
import type { Invoice } from "@prisma/client";

/**
 * Create a new invoice
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const prisma = getPrismaClient();

  return prisma.invoice.create({
    data: {
      companyId: input.companyId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      invoiceType: input.invoiceType,
      status: input.status ?? "DRAFT",
      rawPayload: input.rawPayload,
      ublPayload: input.ublPayload,
      trackingId: input.trackingId,
      posInvoiceId: input.posInvoiceId,
      amount: input.amount,
      discount: input.discount ?? "0",
      rounding: input.rounding ?? "0",
      taxAmount: input.taxAmount,
      total: input.total,
      buyerInfo: input.buyerInfo,
      createdBy: input.createdBy,
    },
  });
}

/**
 * Find invoice by ID
 */
export async function findInvoiceById(id: string): Promise<Invoice | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findUnique({
    where: { id },
  });
}

/**
 * Find invoice by ID with company
 */
export async function findInvoiceByIdWithCompany(id: string): Promise<InvoiceWithCompany | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findUnique({
    where: { id },
    include: {
      company: true,
    },
  });
}

/**
 * Find invoice by company and invoice number
 */
export async function findInvoiceByNumber(
  companyId: string,
  invoiceNumber: string
): Promise<Invoice | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findUnique({
    where: {
      companyId_invoiceNumber: {
        companyId,
        invoiceNumber,
      },
    },
  });
}

/**
 * Find invoice by tracking ID
 */
export async function findInvoiceByTrackingId(trackingId: string): Promise<Invoice | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findFirst({
    where: { trackingId },
  });
}

/**
 * Find invoice by MyInvois UUID
 */
export async function findInvoiceByMyinvoisUuid(myinvoisUuid: string): Promise<Invoice | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findFirst({
    where: { myinvoisUuid },
  });
}

/**
 * Find invoice by POS invoice ID (short ID for QR registration)
 */
export async function findInvoiceByPosInvoiceId(posInvoiceId: string): Promise<Invoice | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findUnique({
    where: { posInvoiceId },
  });
}

/**
 * Find invoice by POS invoice ID with company details
 */
export async function findInvoiceByPosInvoiceIdWithCompany(
  posInvoiceId: string
): Promise<InvoiceWithCompany | null> {
  const prisma = getPrismaClient();

  return prisma.invoice.findUnique({
    where: { posInvoiceId },
    include: {
      company: true,
    },
  });
}

/**
 * Update invoice
 */
export async function updateInvoice(id: string, input: UpdateInvoiceInput): Promise<Invoice> {
  const prisma = getPrismaClient();

  return prisma.invoice.update({
    where: { id },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.ublPayload !== undefined && { ublPayload: input.ublPayload }),
      ...(input.trackingId !== undefined && { trackingId: input.trackingId }),
      ...(input.myinvoisUuid !== undefined && { myinvoisUuid: input.myinvoisUuid }),
      ...(input.myinvoisLongId !== undefined && { myinvoisLongId: input.myinvoisLongId }),
      ...(input.errorCode !== undefined && { errorCode: input.errorCode }),
      ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
    },
  });
}

/**
 * Update invoice status after submission
 */
export async function updateInvoiceStatus(
  id: string,
  input: UpdateInvoiceStatusInput
): Promise<Invoice> {
  const prisma = getPrismaClient();

  return prisma.invoice.update({
    where: { id },
    data: {
      status: input.status,
      ...(input.trackingId !== undefined && { trackingId: input.trackingId }),
      ...(input.myinvoisUuid !== undefined && { myinvoisUuid: input.myinvoisUuid }),
      ...(input.myinvoisLongId !== undefined && { myinvoisLongId: input.myinvoisLongId }),
      ...(input.errorCode !== undefined && { errorCode: input.errorCode }),
      ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
    },
  });
}

/**
 * Update status for ALL invoices with the same MyInvois UUID
 * Used for consolidated invoices where multiple invoices share the same UUID
 * Returns the count of updated invoices
 *
 * IMPORTANT: CANCELLED is a terminal state - once cancelled, invoices cannot be
 * downgraded to other statuses (VALID, SUBMITTED, etc.) unless the incoming
 * status is also CANCELLED. This prevents the refresh endpoint from overwriting
 * a local cancellation before MyInvois has processed it.
 */
export async function updateAllInvoicesByMyinvoisUuid(
  myinvoisUuid: string,
  input: UpdateInvoiceStatusInput
): Promise<number> {
  const prisma = getPrismaClient();

  // Build WHERE clause - prevent downgrading from CANCELLED unless incoming is also CANCELLED
  const whereClause: { myinvoisUuid: string; status?: { not: string } } = { myinvoisUuid };

  if (input.status !== "CANCELLED") {
    // Don't update invoices that are already CANCELLED (no downgrading)
    whereClause.status = { not: "CANCELLED" };
  }

  const result = await prisma.invoice.updateMany({
    where: whereClause,
    data: {
      status: input.status,
      ...(input.trackingId !== undefined && { trackingId: input.trackingId }),
      ...(input.myinvoisUuid !== undefined && { myinvoisUuid: input.myinvoisUuid }),
      ...(input.myinvoisLongId !== undefined && { myinvoisLongId: input.myinvoisLongId }),
      ...(input.errorCode !== undefined && { errorCode: input.errorCode }),
      ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
    },
  });

  return result.count;
}

/**
 * Update draft invoice data (full update for editing before submission)
 * Only updates data fields, not status or MyInvois-related fields
 */
export async function updateDraftInvoice(
  id: string,
  input: UpdateDraftInvoiceInput
): Promise<Invoice> {
  const prisma = getPrismaClient();

  return prisma.invoice.update({
    where: { id },
    data: {
      ...(input.invoiceDate !== undefined && { invoiceDate: input.invoiceDate }),
      ...(input.rawPayload !== undefined && { rawPayload: input.rawPayload }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.discount !== undefined && { discount: input.discount }),
      ...(input.rounding !== undefined && { rounding: input.rounding }),
      ...(input.taxAmount !== undefined && { taxAmount: input.taxAmount }),
      ...(input.total !== undefined && { total: input.total }),
      ...(input.buyerInfo !== undefined && { buyerInfo: input.buyerInfo }),
      ...(input.invoiceType !== undefined && { invoiceType: input.invoiceType }),
    },
  });
}

/**
 * Delete invoice (only allowed for DRAFT status)
 */
export async function deleteInvoice(id: string): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.invoice.delete({
    where: { id },
  });
}

/**
 * List invoices with pagination
 */
export async function listInvoices(
  options: ListInvoicesOptions = {}
): Promise<PaginatedResult<InvoiceWithCompany>> {
  const prisma = getPrismaClient();
  const {
    page = 1,
    limit = 20,
    companyId,
    status,
    statusNot,
    invoiceType,
    search,
    dateFrom,
    dateTo,
  } = options;
  const skip = (page - 1) * limit;

  const where = {
    ...(companyId && { companyId }),
    ...(status && { status }),
    ...(statusNot && { status: { not: statusNot } }),
    ...(invoiceType && { invoiceType }),
    ...(search && {
      OR: [
        { invoiceNumber: { contains: search, mode: "insensitive" as const } },
        { myinvoisUuid: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(dateFrom || dateTo
      ? {
          invoiceDate: {
            ...(dateFrom && { gte: dateFrom }),
            ...(dateTo && { lte: dateTo }),
          },
        }
      : {}),
  };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        company: true,
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    data: invoices,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Count invoices by status for a company
 */
export async function countInvoicesByStatus(companyId: string): Promise<Record<string, number>> {
  const prisma = getPrismaClient();

  const counts = await prisma.invoice.groupBy({
    by: ["status"],
    where: { companyId },
    _count: true,
  });

  return counts.reduce(
    (acc, item) => {
      acc[item.status] = item._count;
      return acc;
    },
    {} as Record<string, number>
  );
}

/**
 * Check if invoice exists
 */
export async function invoiceExists(id: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.invoice.count({
    where: { id },
  });

  return count > 0;
}

/**
 * Check if invoice number exists for company
 */
export async function invoiceNumberExists(
  companyId: string,
  invoiceNumber: string,
  excludeInvoiceId?: string
): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.invoice.count({
    where: {
      companyId,
      invoiceNumber,
      ...(excludeInvoiceId && { id: { not: excludeInvoiceId } }),
    },
  });

  return count > 0;
}
