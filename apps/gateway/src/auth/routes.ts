/**
 * Authentication routes - login, logout, refresh, me
 * P1-01: Added rate limiting to prevent brute force attacks
 */

import type { FastifyInstance } from "fastify";
import {
  findUserByEmailWithCompanies,
  findUserByIdWithCompanies,
  findUserById,
  updateUser,
  createRefreshToken as storeRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "@myinvois/storage";
import {
  createTokenPair,
  verifyRefreshToken,
  hashRefreshToken,
  createAccessToken,
  createPosToken,
} from "./jwt.js";
import { verifyPassword, hashPassword } from "./password.js";
import { authenticate, requirePermission, AuthenticationError } from "./middleware.js";
import { parsePermissions } from "@myinvois/storage";
import { InMemoryRateLimiter } from "@myinvois/core";

// P1-01: Rate limiters for auth endpoints
const authRateLimiter = new InMemoryRateLimiter();
const AUTH_RATE_LIMITS = {
  LOGIN: 5, // 5 login attempts per minute per IP
  REFRESH: 10, // 10 refresh attempts per minute per IP
  POS_TOKEN: 250, // 250 POS token generations per minute per user
};

/**
 * Login request body
 */
interface LoginBody {
  email: string;
  password: string;
  companyId?: string;
}

/**
 * Refresh request body
 */
interface RefreshBody {
  refreshToken: string;
}

/**
 * Register auth routes
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/auth/login
   * Authenticate user and return tokens
   */
  fastify.post<{ Body: LoginBody }>(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
            companyId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // P1-01: Rate limit by IP address
      const rateLimitKey = `login:${request.ip}`;
      const rateLimitResult = authRateLimiter.consume(rateLimitKey, AUTH_RATE_LIMITS.LOGIN);
      if (!rateLimitResult.allowed) {
        reply.header("Retry-After", rateLimitResult.retryAfterSeconds);
        return reply.status(429).send({
          error: {
            code: "TOO_MANY_REQUESTS",
            message: `Too many login attempts. Please try again in ${rateLimitResult.retryAfterSeconds} seconds.`,
          },
        });
      }

      const { email, password, companyId } = request.body;

      // Find user with companies
      const user = await findUserByEmailWithCompanies(email);

      if (!user) {
        throw new AuthenticationError("Invalid email or password");
      }

      if (!user.isActive) {
        throw new AuthenticationError("Account is disabled");
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.passwordHash);

      if (!isValidPassword) {
        throw new AuthenticationError("Invalid email or password");
      }

      // Validate company access if companyId provided
      let selectedCompanyId = companyId;

      if (companyId) {
        const hasAccess = user.companies.some((uc) => uc.company.id === companyId);

        if (!hasAccess) {
          throw new AuthenticationError("Access denied to this company");
        }
      } else if (user.companies.length === 1) {
        // Auto-select if user has only one company
        selectedCompanyId = user.companies[0].company.id;
      }

      // Parse role permissions
      const permissions = parsePermissions(user.role);

      // Create token pair
      const tokens = createTokenPair({
        userId: user.id,
        email: user.email,
        companyId: selectedCompanyId,
        permissions,
      });

      // Store refresh token hash
      await storeRefreshToken({
        userId: user.id,
        tokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt: tokens.refreshTokenExpiresAt,
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      return reply.send({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.accessTokenExpiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role.name,
          permissions,
          companyId: selectedCompanyId,
          companies: user.companies.map((uc) => ({
            id: uc.company.id,
            name: uc.company.name,
            tin: uc.company.tin,
          })),
        },
      });
    }
  );

  /**
   * POST /api/v1/auth/logout
   * Invalidate refresh token
   */
  fastify.post<{ Body: RefreshBody | undefined }>(
    "/logout",
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: ["object", "null"],
          properties: {
            refreshToken: { type: "string" },
          },
          additionalProperties: true,
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body || {};

      if (refreshToken) {
        // Revoke specific token
        const tokenHash = hashRefreshToken(refreshToken);
        await revokeRefreshToken(tokenHash);
      } else if (request.user) {
        // Revoke all tokens for user
        await revokeAllUserTokens(request.user.userId);
      }

      return reply.send({
        message: "Logged out successfully",
      });
    }
  );

  /**
   * POST /api/v1/auth/refresh
   * Get new access token using refresh token
   */
  fastify.post<{ Body: RefreshBody }>(
    "/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // P1-01: Rate limit by IP address
      const rateLimitKey = `refresh:${request.ip}`;
      const rateLimitResult = authRateLimiter.consume(rateLimitKey, AUTH_RATE_LIMITS.REFRESH);
      if (!rateLimitResult.allowed) {
        reply.header("Retry-After", rateLimitResult.retryAfterSeconds);
        return reply.status(429).send({
          error: {
            code: "TOO_MANY_REQUESTS",
            message: `Too many refresh attempts. Please try again in ${rateLimitResult.retryAfterSeconds} seconds.`,
          },
        });
      }

      const { refreshToken } = request.body;

      // Verify refresh token
      let payload;
      try {
        payload = verifyRefreshToken(refreshToken);
      } catch {
        throw new AuthenticationError("Invalid or expired refresh token");
      }

      // Check if token is stored and not revoked
      const tokenHash = hashRefreshToken(refreshToken);
      const storedToken = await findValidRefreshToken(tokenHash);

      if (!storedToken) {
        throw new AuthenticationError("Refresh token not found or revoked");
      }

      // Get user with current permissions
      const user = await findUserByIdWithCompanies(payload.userId);

      if (!user) {
        throw new AuthenticationError("User not found");
      }

      if (!user.isActive) {
        throw new AuthenticationError("Account is disabled");
      }

      // Parse role permissions
      const permissions = parsePermissions(user.role);

      // Determine company (use first company if user has one)
      const companyId = user.companies.length > 0 ? user.companies[0].company.id : undefined;

      // Create new access token
      const access = createAccessToken({
        userId: user.id,
        email: user.email,
        companyId,
        permissions,
      });

      return reply.send({
        accessToken: access.token,
        expiresAt: access.expiresAt.toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/auth/me
   * Get current authenticated user
   */
  fastify.get(
    "/me",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = await findUserByIdWithCompanies(request.user!.userId);

      if (!user) {
        throw new AuthenticationError("User not found");
      }

      const permissions = parsePermissions(user.role);

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        role: {
          id: user.role.id,
          name: user.role.name,
          permissions,
        },
        companyId: request.user!.companyId,
        companies: user.companies.map((uc) => ({
          id: uc.company.id,
          name: uc.company.name,
          tin: uc.company.tin,
          idValue: uc.company.idValue,
        })),
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      });
    }
  );

  /**
   * PUT /api/v1/auth/profile
   * Update the current user's name and/or email
   */
  fastify.put<{ Body: { name?: string; email?: string } }>(
    "/profile",
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            email: { type: "string", format: "email" },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { name, email } = request.body;

      if (!name && !email) {
        return reply.status(400).send({
          error: { code: "NO_CHANGES", message: "No fields to update" },
        });
      }

      // Check email uniqueness if changing email
      if (email) {
        const existing = await findUserByEmailWithCompanies(email);
        if (existing && existing.id !== userId) {
          return reply.status(400).send({
            error: { code: "EMAIL_EXISTS", message: "Email already in use" },
          });
        }
      }

      const updateData: { name?: string; email?: string } = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;

      const updated = await updateUser(userId, updateData);

      return reply.send({
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: {
          id: updated.role.id,
          name: updated.role.name,
        },
      });
    }
  );

  /**
   * POST /api/v1/auth/change-password
   * Change the current user's password
   */
  fastify.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/change-password",
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1 },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const userId = request.user!.userId;

      const user = await findUserById(userId);
      if (!user) {
        throw new AuthenticationError("User not found");
      }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return reply.status(400).send({
          error: {
            code: "INVALID_PASSWORD",
            message: "Current password is incorrect",
          },
        });
      }

      const passwordHash = await hashPassword(newPassword);
      await updateUser(userId, { passwordHash });

      return reply.send({ message: "Password changed successfully" });
    }
  );

  /**
   * POST /api/v1/auth/switch-company
   * Switch to a different company (get new access token)
   */
  fastify.post<{ Body: { companyId: string } }>(
    "/switch-company",
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: "object",
          required: ["companyId"],
          properties: {
            companyId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { companyId } = request.body;

      const user = await findUserByIdWithCompanies(request.user!.userId);

      if (!user) {
        throw new AuthenticationError("User not found");
      }

      // Check if user has access to this company
      const hasAccess = user.companies.some((uc) => uc.company.id === companyId);

      if (!hasAccess) {
        throw new AuthenticationError("Access denied to this company");
      }

      const permissions = parsePermissions(user.role);

      // Create new access token with new company
      const access = createAccessToken({
        userId: user.id,
        email: user.email,
        companyId,
        permissions,
      });

      return reply.send({
        accessToken: access.token,
        expiresAt: access.expiresAt.toISOString(),
        companyId,
      });
    }
  );

  /**
   * POST /api/v1/auth/pos-token
   * Generate a long-lived POS token (10-year expiry)
   * Requires manage:companies permission
   */
  fastify.post<{ Body: { userId?: string; permissions?: string[] } }>(
    "/pos-token",
    {
      preHandler: [authenticate, requirePermission("manage:companies")],
      schema: {
        body: {
          type: ["object", "null"],
          properties: {
            userId: {
              type: "string",
              description: "User ID for the POS system (default: pos-terminal)",
            },
            permissions: {
              type: "array",
              items: { type: "string" },
              description: 'Permissions array (default: ["submit:invoice"])',
            },
          },
        },
      },
    },
    async (request, reply) => {
      // P1-01: Rate limit by authenticated user
      const rateLimitKey = `pos-token:${request.user?.userId || request.ip}`;
      const rateLimitResult = authRateLimiter.consume(rateLimitKey, AUTH_RATE_LIMITS.POS_TOKEN);
      if (!rateLimitResult.allowed) {
        reply.header("Retry-After", rateLimitResult.retryAfterSeconds);
        return reply.status(429).send({
          error: {
            code: "TOO_MANY_REQUESTS",
            message: `Too many POS token generation requests. Please try again in ${rateLimitResult.retryAfterSeconds} seconds.`,
          },
        });
      }

      const { userId = "pos-terminal", permissions = ["submit:invoice"] } = request.body || {};

      const { token, expiresAt } = createPosToken(userId, permissions);

      return reply.send({
        token,
        expiresAt: expiresAt.toISOString(),
        userId,
        permissions,
        type: "pos",
        note: "This is a long-lived token (10-year expiry). Keep it secure.",
      });
    }
  );
}
