-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SubmissionDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionTrackingId" TEXT NOT NULL,
    "codeNumber" TEXT NOT NULL,
    "upstreamUuid" TEXT,
    "initialResult" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "upstreamStatus" TEXT,
    "longId" TEXT,
    "dateTimeValidated" DATETIME,
    "issuerTin" TEXT,
    "issuerName" TEXT,
    "receiverId" TEXT,
    "receiverName" TEXT,
    "totalPayableAmount" TEXT,
    "lastActionType" TEXT,
    "lastActionReason" TEXT,
    "lastActionAt" DATETIME,
    "lastActionStatus" TEXT,
    "lastActionCorrelationId" TEXT,
    "lastActionErrorCode" TEXT,
    "lastActionErrorMessage" TEXT,
    "dateTimeIssued" DATETIME,
    "dateTimeReceived" DATETIME,
    "cancelDateTime" DATETIME,
    "rejectDateTime" DATETIME,
    "statusReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionDocument_submissionTrackingId_fkey" FOREIGN KEY ("submissionTrackingId") REFERENCES "Submission" ("trackingId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SubmissionDocument" ("codeNumber", "createdAt", "dateTimeValidated", "errorCode", "errorMessage", "id", "initialResult", "issuerName", "issuerTin", "longId", "receiverId", "receiverName", "submissionTrackingId", "totalPayableAmount", "upstreamStatus", "upstreamUuid") SELECT "codeNumber", "createdAt", "dateTimeValidated", "errorCode", "errorMessage", "id", "initialResult", "issuerName", "issuerTin", "longId", "receiverId", "receiverName", "submissionTrackingId", "totalPayableAmount", "upstreamStatus", "upstreamUuid" FROM "SubmissionDocument";
DROP TABLE "SubmissionDocument";
ALTER TABLE "new_SubmissionDocument" RENAME TO "SubmissionDocument";
CREATE INDEX "SubmissionDocument_submissionTrackingId_idx" ON "SubmissionDocument"("submissionTrackingId");
CREATE INDEX "SubmissionDocument_upstreamUuid_idx" ON "SubmissionDocument"("upstreamUuid");
CREATE INDEX "SubmissionDocument_codeNumber_idx" ON "SubmissionDocument"("codeNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
