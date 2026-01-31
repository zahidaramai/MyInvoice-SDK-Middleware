-- CreateTable
CREATE TABLE "Submission" (
    "trackingId" TEXT NOT NULL,
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
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "pollAttempts" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "lastUpstreamCorrelationId" TEXT,
    "lastPollErrorCode" TEXT,
    "lastPollErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("trackingId")
);

-- CreateTable
CREATE TABLE "SubmissionDocument" (
    "id" TEXT NOT NULL,
    "submissionTrackingId" TEXT NOT NULL,
    "codeNumber" TEXT NOT NULL,
    "upstreamUuid" TEXT,
    "initialResult" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "upstreamStatus" TEXT,
    "longId" TEXT,
    "dateTimeValidated" TIMESTAMP(3),
    "issuerTin" TEXT,
    "issuerName" TEXT,
    "receiverId" TEXT,
    "receiverName" TEXT,
    "totalPayableAmount" TEXT,
    "lastActionType" TEXT,
    "lastActionReason" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "lastActionStatus" TEXT,
    "lastActionCorrelationId" TEXT,
    "lastActionErrorCode" TEXT,
    "lastActionErrorMessage" TEXT,
    "dateTimeIssued" TIMESTAMP(3),
    "dateTimeReceived" TIMESTAMP(3),
    "cancelDateTime" TIMESTAMP(3),
    "rejectDateTime" TIMESTAMP(3),
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyWindow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "submissionTrackingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TinValidateCache" (
    "id" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "idValueHash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "taxpayerName" TEXT,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "correlationId" TEXT,

    CONSTRAINT "TinValidateCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "brn" TEXT NOT NULL,
    "idType" TEXT NOT NULL DEFAULT 'BRN',
    "myinvoisClientId" TEXT,
    "myinvoisClientSecret" TEXT,
    "myinvoisEnv" TEXT NOT NULL DEFAULT 'SANDBOX',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCompany" (
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCompany_pkey" PRIMARY KEY ("userId","companyId")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rawPayload" TEXT NOT NULL,
    "ublPayload" TEXT,
    "trackingId" TEXT,
    "myinvoisUuid" TEXT,
    "myinvoisLongId" TEXT,
    "amount" TEXT NOT NULL,
    "discount" TEXT NOT NULL DEFAULT '0',
    "rounding" TEXT NOT NULL DEFAULT '0',
    "taxAmount" TEXT NOT NULL,
    "total" TEXT NOT NULL,
    "buyerInfo" TEXT,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_sessionId_idx" ON "Submission"("sessionId");

-- CreateIndex
CREATE INDEX "Submission_sessionId_payloadHash_idx" ON "Submission"("sessionId", "payloadHash");

-- CreateIndex
CREATE INDEX "Submission_upstreamSubmissionUid_idx" ON "Submission"("upstreamSubmissionUid");

-- CreateIndex
CREATE INDEX "Submission_nextPollAt_idx" ON "Submission"("nextPollAt");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

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

-- CreateIndex
CREATE INDEX "TinValidateCache_env_sessionId_tin_idType_idValueHash_idx" ON "TinValidateCache"("env", "sessionId", "tin", "idType", "idValueHash");

-- CreateIndex
CREATE INDEX "TinValidateCache_expiresAt_idx" ON "TinValidateCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TinValidateCache_env_sessionId_tin_idType_idValueHash_key" ON "TinValidateCache"("env", "sessionId", "tin", "idType", "idValueHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Role_name_idx" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Company_tin_idx" ON "Company"("tin");

-- CreateIndex
CREATE INDEX "Company_brn_idx" ON "Company"("brn");

-- CreateIndex
CREATE UNIQUE INDEX "Company_tin_brn_key" ON "Company"("tin", "brn");

-- CreateIndex
CREATE INDEX "UserCompany_userId_idx" ON "UserCompany"("userId");

-- CreateIndex
CREATE INDEX "UserCompany_companyId_idx" ON "UserCompany"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Invoice_companyId_idx" ON "Invoice"("companyId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_trackingId_idx" ON "Invoice"("trackingId");

-- CreateIndex
CREATE INDEX "Invoice_myinvoisUuid_idx" ON "Invoice"("myinvoisUuid");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_invoiceNumber_key" ON "Invoice"("companyId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "SubmissionDocument" ADD CONSTRAINT "SubmissionDocument_submissionTrackingId_fkey" FOREIGN KEY ("submissionTrackingId") REFERENCES "Submission"("trackingId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyWindow" ADD CONSTRAINT "IdempotencyWindow_submissionTrackingId_fkey" FOREIGN KEY ("submissionTrackingId") REFERENCES "Submission"("trackingId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
