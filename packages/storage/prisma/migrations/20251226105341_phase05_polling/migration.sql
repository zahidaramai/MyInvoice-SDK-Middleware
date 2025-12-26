-- AlterTable
ALTER TABLE "SubmissionDocument" ADD COLUMN "dateTimeValidated" DATETIME;
ALTER TABLE "SubmissionDocument" ADD COLUMN "issuerName" TEXT;
ALTER TABLE "SubmissionDocument" ADD COLUMN "issuerTin" TEXT;
ALTER TABLE "SubmissionDocument" ADD COLUMN "longId" TEXT;
ALTER TABLE "SubmissionDocument" ADD COLUMN "receiverId" TEXT;
ALTER TABLE "SubmissionDocument" ADD COLUMN "receiverName" TEXT;
ALTER TABLE "SubmissionDocument" ADD COLUMN "totalPayableAmount" TEXT;
ALTER TABLE "SubmissionDocument" ADD COLUMN "upstreamStatus" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
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
    "lastPolledAt" DATETIME,
    "nextPollAt" DATETIME,
    "pollAttempts" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" DATETIME,
    "lastUpstreamCorrelationId" TEXT,
    "lastPollErrorCode" TEXT,
    "lastPollErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Submission" ("correlationId", "createdAt", "env", "errorCode", "errorMessage", "payloadHash", "retryAfterSeconds", "sessionId", "status", "trackingId", "updatedAt", "upstreamOverallStatus", "upstreamSubmissionUid") SELECT "correlationId", "createdAt", "env", "errorCode", "errorMessage", "payloadHash", "retryAfterSeconds", "sessionId", "status", "trackingId", "updatedAt", "upstreamOverallStatus", "upstreamSubmissionUid" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_sessionId_idx" ON "Submission"("sessionId");
CREATE INDEX "Submission_sessionId_payloadHash_idx" ON "Submission"("sessionId", "payloadHash");
CREATE INDEX "Submission_upstreamSubmissionUid_idx" ON "Submission"("upstreamSubmissionUid");
CREATE INDEX "Submission_nextPollAt_idx" ON "Submission"("nextPollAt");
CREATE INDEX "Submission_status_idx" ON "Submission"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
