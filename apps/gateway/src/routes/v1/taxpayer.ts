/**
 * Taxpayer routes - TIN validation with privacy-safe caching
 */

import { createHash } from "crypto";
import type { FastifyPluginAsync } from "fastify";
import { AppError, createErrorEnvelope } from "../../lib/errors.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { getTokenManager, getRateLimiter } from "../../lib/myinvois.js";
import { isValidSessionId } from "../../lib/validation.js";
import { loadConfig } from "../../config.js";
import { validateTaxpayerTin, type IdType } from "@myinvois/myinvois-client";
import {
  getTinValidateCache,
  setTinValidateCache,
  type StorageEnvironment,
  type TinIdType,
  type TinValidationResult,
} from "@myinvois/storage";

const VALID_ID_TYPES: IdType[] = ["NRIC", "PASSPORT", "BRN", "ARMY"];

/**
 * Validate ID type
 */
function isValidIdType(idType: string): idType is IdType {
  return VALID_ID_TYPES.includes(idType as IdType);
}

/**
 * Hash ID value for privacy-safe storage
 */
function hashIdValue(idValue: string, salt: string): string {
  return createHash("sha256")
    .update(idValue + salt)
    .digest("hex");
}

/**
 * Calculate cache expiry date
 */
function calculateExpiryDate(ttlDays: number): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  return expiresAt;
}

/**
 * Calculate seconds until expiry
 */
function secondsUntilExpiry(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

export const taxpayerRoutes: FastifyPluginAsync = async (fastify) => {
  const config = loadConfig();

  /**
   * GET /v1/tin/validate - Validate taxpayer TIN
   */
  fastify.get<{
    Querystring: {
      sessionId: string;
      tin: string;
      idType: string;
      idValue: string;
      forceRefresh?: string;
    };
  }>("/v1/tin/validate", async (request, reply) => {
    const correlationId = request.correlationId || request.id;
    const { sessionId, tin, idType, idValue, forceRefresh } = request.query;

    // Validate sessionId format
    if (!sessionId || !isValidSessionId(sessionId)) {
      throw new AppError(400, "Invalid sessionId format", "INVALID_SESSION_ID", {
        propertyPath: "sessionId",
      });
    }

    // Get session
    const session = sessionStore.get(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    // Validate TIN
    if (!tin || tin.trim().length === 0) {
      throw new AppError(400, "TIN is required", "MISSING_TIN", {
        propertyPath: "tin",
      });
    }

    // Validate idType
    if (!idType || !isValidIdType(idType.toUpperCase())) {
      throw new AppError(
        400,
        "Invalid idType. Must be NRIC, PASSPORT, BRN, or ARMY",
        "INVALID_ID_TYPE",
        {
          propertyPath: "idType",
        }
      );
    }

    // Validate idValue
    if (!idValue || idValue.trim().length === 0) {
      throw new AppError(400, "idValue is required", "MISSING_ID_VALUE", {
        propertyPath: "idValue",
      });
    }

    // Normalize inputs
    const normalizedTin = tin.trim().toUpperCase();
    const normalizedIdType = idType.trim().toUpperCase() as IdType;
    const normalizedIdValue = idValue.trim();

    // Hash idValue for privacy-safe storage
    const idValueHash = hashIdValue(normalizedIdValue, config.cacheHashSalt);

    // Check cache unless forceRefresh is set
    const shouldBypassCache = forceRefresh === "1" || forceRefresh === "true";

    if (!shouldBypassCache) {
      const cached = await getTinValidateCache({
        env: session.env as StorageEnvironment,
        sessionId: session.sessionId,
        tin: normalizedTin,
        idType: normalizedIdType as TinIdType,
        idValueHash,
      });

      if (cached) {
        const ttlSeconds = secondsUntilExpiry(cached.expiresAt);
        const isValid = cached.result === "VALID";

        request.log.info(
          {
            correlationId,
            tin: normalizedTin,
            idType: normalizedIdType,
            cached: true,
            valid: isValid,
          },
          "TIN validation cache HIT"
        );

        reply.header("X-Correlation-Id", cached.correlationId || correlationId);
        reply.header("X-Cache", "HIT");
        reply.header("X-Cache-TTL", String(ttlSeconds));

        return reply.status(200).send({
          tin: normalizedTin,
          valid: isValid,
          name: cached.taxpayerName || undefined,
          cached: true,
        });
      }
    }

    // Call upstream MyInvois API
    const tokenManager = getTokenManager();
    const rateLimiter = getRateLimiter();

    const result = await validateTaxpayerTin(
      {
        sessionId: session.sessionId,
        env: session.env,
        mode: session.mode,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        scope: session.scope,
        onBehalfOf: session.onBehalfOf,
      },
      {
        tin: normalizedTin,
        idType: normalizedIdType,
        idValue: normalizedIdValue,
      },
      { tokenManager, rateLimiter }
    );

    if (!result.ok) {
      // Handle rate limit
      if (
        result.error.status === 429 ||
        result.error.code === "UPSTREAM_RATE_LIMIT" ||
        result.error.code === "RATE_LIMIT_EXCEEDED"
      ) {
        const retryAfter = result.error.meta?.rateLimitReset
          ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
          : 60;

        const envelope = createErrorEnvelope(429, result.error.message, {
          correlationId: result.error.meta?.correlationId || correlationId,
          errorCode: "UPSTREAM_RATE_LIMITED",
          retryAfterSeconds: retryAfter,
          retryable: true,
        });

        reply.header("X-Correlation-Id", result.error.meta?.correlationId || correlationId);
        reply.header("Retry-After", String(retryAfter));
        reply.header("X-Cache", "MISS");
        return reply.status(429).send(envelope);
      }

      // Handle validation error
      if (result.error.status === 400) {
        throw new AppError(400, result.error.message, result.error.code || "VALIDATION_ERROR");
      }

      // Generic upstream error
      throw new AppError(
        result.error.status || 500,
        result.error.message,
        result.error.code || "UPSTREAM_ERROR",
        {
          correlationId: result.error.meta?.correlationId,
        }
      );
    }

    // Store result in cache
    const ttlDays = result.result.valid
      ? config.tinValidCacheTtlDays
      : config.tinInvalidCacheTtlDays;
    const expiresAt = calculateExpiryDate(ttlDays);
    const cacheResult: TinValidationResult = result.result.valid ? "VALID" : "INVALID";

    await setTinValidateCache({
      env: session.env as StorageEnvironment,
      sessionId: session.sessionId,
      tin: normalizedTin,
      idType: normalizedIdType as TinIdType,
      idValueHash,
      result: cacheResult,
      taxpayerName: result.result.name,
      expiresAt,
      correlationId: result.result.meta.correlationId,
    });

    const ttlSeconds = secondsUntilExpiry(expiresAt);

    request.log.info(
      {
        correlationId: result.result.meta.correlationId || correlationId,
        tin: normalizedTin,
        idType: normalizedIdType,
        cached: false,
        valid: result.result.valid,
      },
      "TIN validation completed"
    );

    reply.header("X-Correlation-Id", result.result.meta.correlationId || correlationId);
    reply.header("X-Cache", "MISS");
    reply.header("X-Cache-TTL", String(ttlSeconds));

    return reply.status(200).send({
      tin: normalizedTin,
      valid: result.result.valid,
      name: result.result.name,
      cached: false,
    });
  });
};
