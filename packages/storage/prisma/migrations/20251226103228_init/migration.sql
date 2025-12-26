-- CreateTable
CREATE TABLE "Submission" (
    "trackingId" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "upstreamSubmissionUid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "upstreamOverallStatus" TEXT,
    "correlationId" TEXT,
    "retryAfterSeconds" INTEGER,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubmissionDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionTrackingId" TEXT NOT NULL,
    "codeNumber" TEXT NOT NULL,
    "upstreamUuid" TEXT,
    "initialResult" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionDocument_submissionTrackingId_fkey" FOREIGN KEY ("submissionTrackingId") REFERENCES "Submission" ("trackingId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdempotencyWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "submissionTrackingId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "IdempotencyWindow_submissionTrackingId_fkey" FOREIGN KEY ("submissionTrackingId") REFERENCES "Submission" ("trackingId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Submission_sessionId_idx" ON "Submission"("sessionId");

-- CreateIndex
CREATE INDEX "Submission_sessionId_payloadHash_idx" ON "Submission"("sessionId", "payloadHash");

-- CreateIndex
CREATE INDEX "Submission_upstreamSubmissionUid_idx" ON "Submission"("upstreamSubmissionUid");

-- CreateIndex
CREATE INDEX "SubmissionDocument_submissionTrackingId_idx" ON "SubmissionDocument"("submissionTrackingId");

-- CreateIndex
CREATE INDEX "SubmissionDocument_upstreamUuid_idx" ON "SubmissionDocument"("upstreamUuid");

-- CreateIndex
CREATE INDEX "SubmissionDocument_codeNumber_idx" ON "SubmissionDocument"("codeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyWindow_submissionTrackingId_key" ON "IdempotencyWindow"("submissionTrackingId");

-- CreateIndex
CREATE INDEX "IdempotencyWindow_sessionId_payloadHash_idx" ON "IdempotencyWindow"("sessionId", "payloadHash");

-- CreateIndex
CREATE INDEX "IdempotencyWindow_expiresAt_idx" ON "IdempotencyWindow"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyWindow_sessionId_payloadHash_key" ON "IdempotencyWindow"("sessionId", "payloadHash");
