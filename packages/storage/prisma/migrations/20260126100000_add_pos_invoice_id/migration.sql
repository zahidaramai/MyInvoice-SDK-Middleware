-- AlterTable: Add posInvoiceId for POS QR e-invoice registration
ALTER TABLE "Invoice" ADD COLUMN "posInvoiceId" TEXT;

-- CreateIndex: Unique constraint on posInvoiceId
CREATE UNIQUE INDEX "Invoice_posInvoiceId_key" ON "Invoice"("posInvoiceId");

-- CreateIndex: Index for fast lookups
CREATE INDEX "Invoice_posInvoiceId_idx" ON "Invoice"("posInvoiceId");
