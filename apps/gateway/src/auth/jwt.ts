/**
 * JWT token management utilities
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";

/**
 * JWT payload for access tokens
 */
export interface AccessTokenPayload {
  userId: string;
  email: string;
  companyId?: string;
  permissions: string[];
  type: "access";
}

/**
 * JWT payload for refresh tokens
 */
export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  type: "refresh";
}

/**
 * Token pair returned after login
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

/**
 * Get JWT configuration from environment
 */
function getConfig() {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  const accessExpiry = process.env.JWT_ACCESS_EXPIRY || "15m";
  const refreshExpiry = process.env.JWT_REFRESH_EXPIRY || "7d";

  if (!accessSecret) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  if (!refreshSecret) {
    throw new Error("JWT_REFRESH_SECRET environment variable is required");
  }

  return {
    accessSecret,
    refreshSecret,
    accessExpiry,
    refreshExpiry,
  };
}

/**
 * Parse duration string (e.g., "15m", "7d") to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Create an access token
 */
export function createAccessToken(payload: Omit<AccessTokenPayload, "type">): {
  token: string;
  expiresAt: Date;
} {
  const config = getConfig();
  const expiresAt = new Date(Date.now() + parseDuration(config.accessExpiry));

  const token = jwt.sign(
    { ...payload, type: "access" } as AccessTokenPayload,
    config.accessSecret,
    { expiresIn: parseDuration(config.accessExpiry) / 1000 }
  );

  return { token, expiresAt };
}

/**
 * Create a refresh token
 */
export function createRefreshToken(userId: string): {
  token: string;
  tokenId: string;
  expiresAt: Date;
} {
  const config = getConfig();
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseDuration(config.refreshExpiry));

  const token = jwt.sign(
    { userId, tokenId, type: "refresh" } as RefreshTokenPayload,
    config.refreshSecret,
    { expiresIn: parseDuration(config.refreshExpiry) / 1000 }
  );

  return { token, tokenId, expiresAt };
}

/**
 * Create both access and refresh tokens
 */
export function createTokenPair(
  payload: Omit<AccessTokenPayload, "type">
): TokenPair & { refreshTokenId: string } {
  const access = createAccessToken(payload);
  const refresh = createRefreshToken(payload.userId);

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshTokenExpiresAt: refresh.expiresAt,
    refreshTokenId: refresh.tokenId,
  };
}

/**
 * Verify and decode an access token
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const config = getConfig();

  try {
    const decoded = jwt.verify(token, config.accessSecret) as AccessTokenPayload;

    if (decoded.type !== "access") {
      throw new Error("Invalid token type");
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Access token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid access token");
    }
    throw error;
  }
}

/**
 * Verify and decode a refresh token
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const config = getConfig();

  try {
    const decoded = jwt.verify(token, config.refreshSecret) as RefreshTokenPayload;

    if (decoded.type !== "refresh") {
      throw new Error("Invalid token type");
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Refresh token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid refresh token");
    }
    throw error;
  }
}

/**
 * Hash a refresh token for storage
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * JWT payload for POS tokens (long-lived)
 */
export interface PosTokenPayload {
  userId: string;
  permissions: string[];
  type: "pos";
}

/**
 * Create a long-lived POS token
 * These tokens are used by POS systems and have a 10-year expiry
 *
 * @param userId - The user ID associated with the POS system
 * @param permissions - Array of permissions (default: ["submit:invoice"])
 * @returns The token string and expiry date
 */
export function createPosToken(
  userId: string,
  permissions: string[] = ["submit:invoice"]
): {
  token: string;
  expiresAt: Date;
} {
  const config = getConfig();

  // 10 years in seconds
  const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + TEN_YEARS_SECONDS * 1000);

  const token = jwt.sign(
    {
      userId,
      permissions,
      type: "pos",
    } as PosTokenPayload,
    config.accessSecret,
    { expiresIn: TEN_YEARS_SECONDS }
  );

  return { token, expiresAt };
}

/**
 * Verify and decode a POS token
 */
export function verifyPosToken(token: string): PosTokenPayload {
  const config = getConfig();

  try {
    const decoded = jwt.verify(token, config.accessSecret) as PosTokenPayload;

    if (decoded.type !== "pos") {
      throw new Error("Invalid token type");
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("POS token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid POS token");
    }
    throw error;
  }
}
