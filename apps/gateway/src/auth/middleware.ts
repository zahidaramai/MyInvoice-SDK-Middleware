/**
 * Authentication middleware for Fastify
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { verifyAccessToken, verifyPosToken } from "./jwt.js";

/**
 * Authenticated user attached to request
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  companyId?: string;
  permissions: string[];
  isPosToken?: boolean; // POS tokens are treated like SuperAdmin
}

/**
 * Extend FastifyRequest with user
 */
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code = "UNAUTHORIZED", statusCode = 401) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code = "FORBIDDEN", statusCode = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Authentication hook - verifies JWT and attaches user to request
 * Supports both regular access tokens and POS tokens
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);

  if (!token) {
    throw new AuthenticationError("Missing authorization token");
  }

  // Try access token first
  let accessTokenError: string | null = null;
  try {
    const payload = verifyAccessToken(token);

    request.user = {
      userId: payload.userId,
      email: payload.email,
      companyId: payload.companyId,
      permissions: payload.permissions,
    };
    return;
  } catch (error) {
    // Store access token error for better error message
    accessTokenError = error instanceof Error ? error.message : "Invalid access token";
  }

  // Try POS token
  try {
    const payload = verifyPosToken(token);

    request.user = {
      userId: payload.userId,
      email: "pos@system", // POS tokens don't have email
      companyId: undefined, // POS tokens work across all companies
      permissions: payload.permissions,
      isPosToken: true, // POS tokens treated like SuperAdmin
    };
    return;
  } catch {
    // Both token types failed - return generic error or access token error
    // (most users use access tokens, so show that error)
    throw new AuthenticationError(accessTokenError || "Invalid token");
  }
}

/**
 * Superadmin permission constant - bypasses all permission and company checks
 */
export const SUPERADMIN_PERMISSION = "*";

/**
 * Check if user has superadmin permission
 * POS tokens are treated as superadmin (bypass all permission and company checks)
 */
export function isSuperadmin(user: AuthenticatedUser | undefined): boolean {
  if (!user) return false;
  return user.permissions.includes(SUPERADMIN_PERMISSION) || user.isPosToken === true;
}

/**
 * Permission check middleware factory
 */
export function requirePermission(permission: string) {
  return async function checkPermission(
    request: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    if (!request.user) {
      throw new AuthenticationError("Not authenticated");
    }

    // Superadmin bypasses all permission checks
    if (isSuperadmin(request.user)) {
      return;
    }

    if (!request.user.permissions.includes(permission)) {
      throw new AuthorizationError(
        `Missing required permission: ${permission}`
      );
    }
  };
}

/**
 * Check if user has any of the specified permissions
 */
export function requireAnyPermission(...permissions: string[]) {
  return async function checkPermission(
    request: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    if (!request.user) {
      throw new AuthenticationError("Not authenticated");
    }

    // Superadmin bypasses all permission checks
    if (isSuperadmin(request.user)) {
      return;
    }

    const hasPermission = permissions.some((p) =>
      request.user!.permissions.includes(p)
    );

    if (!hasPermission) {
      throw new AuthorizationError(
        `Missing required permissions: ${permissions.join(" or ")}`
      );
    }
  };
}

/**
 * Company access check middleware
 */
export async function requireCompanyAccess(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    throw new AuthenticationError("Not authenticated");
  }

  if (!request.user.companyId) {
    throw new AuthorizationError("No company selected");
  }
}

/**
 * Authentication error handler plugin
 */
async function authErrorHandler(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthenticationError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AuthorizationError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Re-throw other errors for default handling
    throw error;
  });
}

/**
 * Register auth error handler as a Fastify plugin
 */
export const authErrorHandlerPlugin = fp(authErrorHandler, {
  name: "auth-error-handler",
});
