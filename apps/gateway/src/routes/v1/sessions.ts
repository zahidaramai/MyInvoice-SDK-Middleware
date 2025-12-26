/**
 * Session management routes
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { isValidEnvironment, isValidMode } from "@myinvois/core";
import { sessionStore, type SessionResponse } from "../../lib/sessionStore.js";
import { getTokenManager } from "../../lib/myinvois.js";
import { AppError, createErrorEnvelope } from "../../lib/errors.js";

interface CreateSessionBody {
  env: string;
  mode: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  onBehalfOf?: string;
}

interface SessionParams {
  sessionId: string;
}

/**
 * Validate TIN or TIN:ROB format for onBehalfOf
 */
function isValidOnBehalfOf(value: string): boolean {
  // TIN: 10-14 alphanumeric characters
  // TIN:ROB format: TIN:ROB
  const tinPattern = /^[A-Z0-9]{10,14}$/;
  const tinRobPattern = /^[A-Z0-9]{10,14}:ROB$/;
  return tinPattern.test(value) || tinRobPattern.test(value);
}

/**
 * Validate session creation request
 */
function validateCreateRequest(body: CreateSessionBody): void {
  // Validate env
  if (!body.env || !isValidEnvironment(body.env)) {
    throw new AppError(400, "env must be PROD or SANDBOX", "VALIDATION_ERROR", {
      propertyPath: "env",
    });
  }

  // Validate mode
  if (!body.mode || !isValidMode(body.mode)) {
    throw new AppError(400, "mode must be TAXPAYER or INTERMEDIARY", "VALIDATION_ERROR", {
      propertyPath: "mode",
    });
  }

  // Validate clientId
  if (!body.clientId || typeof body.clientId !== "string" || body.clientId.trim() === "") {
    throw new AppError(400, "clientId is required", "VALIDATION_ERROR", {
      propertyPath: "clientId",
    });
  }

  // Validate clientSecret
  if (!body.clientSecret || typeof body.clientSecret !== "string" || body.clientSecret.trim() === "") {
    throw new AppError(400, "clientSecret is required", "VALIDATION_ERROR", {
      propertyPath: "clientSecret",
    });
  }

  // INTERMEDIARY mode requires onBehalfOf
  if (body.mode === "INTERMEDIARY") {
    if (!body.onBehalfOf || typeof body.onBehalfOf !== "string" || body.onBehalfOf.trim() === "") {
      throw new AppError(
        400,
        "onBehalfOf is required for INTERMEDIARY mode",
        "VALIDATION_ERROR",
        { propertyPath: "onBehalfOf" }
      );
    }

    if (!isValidOnBehalfOf(body.onBehalfOf)) {
      throw new AppError(
        400,
        "onBehalfOf must be a valid TIN (10-14 chars) or TIN:ROB format",
        "VALIDATION_ERROR",
        { propertyPath: "onBehalfOf" }
      );
    }
  }

  // TAXPAYER mode should not have onBehalfOf
  if (body.mode === "TAXPAYER" && body.onBehalfOf) {
    throw new AppError(
      400,
      "onBehalfOf is not allowed for TAXPAYER mode",
      "VALIDATION_ERROR",
      { propertyPath: "onBehalfOf" }
    );
  }
}

export const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/sessions - Create a session
   */
  fastify.post<{ Body: CreateSessionBody }>(
    "/v1/sessions",
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      const correlationId = request.correlationId || request.id;
      const body = request.body || {};

      // Validate request
      validateCreateRequest(body);

      // Create session in store
      const session = sessionStore.create({
        env: body.env as "PROD" | "SANDBOX",
        mode: body.mode as "TAXPAYER" | "INTERMEDIARY",
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        scope: body.scope,
        onBehalfOf: body.onBehalfOf,
      });

      // Optionally validate upstream login
      const validateUpstream = process.env.VALIDATE_UPSTREAM === "true";
      if (validateUpstream) {
        const tokenManager = getTokenManager();
        const loginResult = await tokenManager.getToken({
          sessionId: session.sessionId,
          env: session.env,
          mode: session.mode,
          clientId: session.clientId,
          clientSecret: session.clientSecret,
          scope: session.scope,
          onBehalfOf: session.onBehalfOf,
        });

        if (!loginResult.ok) {
          // Delete the session on login failure
          sessionStore.delete(session.sessionId);

          const statusCode = loginResult.error.status === 401 ? 401 :
                            loginResult.error.status === 429 ? 429 : 400;

          const envelope = createErrorEnvelope(
            statusCode,
            loginResult.error.message,
            {
              correlationId,
              errorCode: loginResult.error.code,
              retryAfterSeconds: loginResult.error.meta?.rateLimitReset
                ? loginResult.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
                : undefined,
            }
          );

          return reply.status(statusCode).send(envelope);
        }
      }

      const response: SessionResponse = sessionStore.toResponse(session);
      return reply.status(201).send(response);
    }
  );

  /**
   * GET /v1/sessions/:sessionId - Get session details
   */
  fastify.get<{ Params: SessionParams }>(
    "/v1/sessions/:sessionId",
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const correlationId = request.correlationId || request.id;
      const { sessionId } = request.params;

      const session = sessionStore.get(sessionId);
      if (!session) {
        const envelope = createErrorEnvelope(404, "Session not found", {
          correlationId,
          errorCode: "NOT_FOUND",
        });
        return reply.status(404).send(envelope);
      }

      const response: SessionResponse = sessionStore.toResponse(session);
      return reply.status(200).send(response);
    }
  );

  /**
   * DELETE /v1/sessions/:sessionId - Delete a session
   */
  fastify.delete<{ Params: SessionParams }>(
    "/v1/sessions/:sessionId",
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const correlationId = request.correlationId || request.id;
      const { sessionId } = request.params;

      const session = sessionStore.get(sessionId);
      if (!session) {
        const envelope = createErrorEnvelope(404, "Session not found", {
          correlationId,
          errorCode: "NOT_FOUND",
        });
        return reply.status(404).send(envelope);
      }

      // Invalidate token cache
      const tokenManager = getTokenManager();
      tokenManager.invalidate(sessionId);

      // Delete session
      sessionStore.delete(sessionId);

      return reply.status(204).send();
    }
  );
};
