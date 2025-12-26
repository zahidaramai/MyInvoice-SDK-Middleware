-- CreateTable
CREATE TABLE "TinValidateCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "env" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "idValueHash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "taxpayerName" TEXT,
    "validatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "correlationId" TEXT
);

-- CreateIndex
CREATE INDEX "TinValidateCache_env_sessionId_tin_idType_idValueHash_idx" ON "TinValidateCache"("env", "sessionId", "tin", "idType", "idValueHash");

-- CreateIndex
CREATE INDEX "TinValidateCache_expiresAt_idx" ON "TinValidateCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TinValidateCache_env_sessionId_tin_idType_idValueHash_key" ON "TinValidateCache"("env", "sessionId", "tin", "idType", "idValueHash");
