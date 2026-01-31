/**
 * MyInvois Identity Service - OAuth2 login
 */

import {
  resolveIdentityBaseUrl,
  expiresAtFromExpiresIn,
  type RateLimiter,
} from "@myinvois/core";
import type {
  SessionCredentials,
  TokenResponse,
  CachedToken,
  LoginResult,
} from "./types.js";
import { RATE_LIMITS } from "./rateLimits.js";
import { extractUpstreamMeta } from "./utils/extractUpstreamMeta.js";

const LOGIN_PATH = "/connect/token";
const DEFAULT_SCOPE = "InvoicingAPI";

/**
 * Build form-urlencoded body for login
 */
function buildLoginBody(session: SessionCredentials): string {
  const params = new URLSearchParams();
  params.set("client_id", session.clientId);
  params.set("client_secret", session.clientSecret);
  params.set("grant_type", "client_credentials");
  params.set("scope", session.scope || DEFAULT_SCOPE);
  return params.toString();
}

/**
 * Build headers for login request
 */
function buildLoginHeaders(session: SessionCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (session.mode === "INTERMEDIARY" && session.onBehalfOf) {
    headers["onbehalfof"] = session.onBehalfOf;
  }

  return headers;
}

export interface LoginOptions {
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
  /** Token renew skew in ms (default 30000) */
  renewSkewMs?: number;
}

/**
 * Perform login to MyInvois identity service
 */
export async function login(
  session: SessionCredentials,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const { rateLimiter, renewSkewMs = 30_000 } = options;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.LOGIN);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "Login rate limit exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          meta: {
            rateLimitLimit: result.limit,
            rateLimitRemaining: result.remaining,
          },
        },
      };
    }
  }

  const baseUrl = resolveIdentityBaseUrl(session.env);
  const url = `${baseUrl}${LOGIN_PATH}`;
  const body = buildLoginBody(session);
  const headers = buildLoginHeaders(session);

  // P1-10: Add 10-second timeout to prevent hung identity service blocking gateway
  const IDENTITY_TIMEOUT_MS = 10_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    const meta = extractUpstreamMeta(response.headers);

    if (!response.ok) {
      let errorMessage = "Login failed";
      let errorCode = "LOGIN_FAILED";

      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody.error_description === "string") {
          errorMessage = errorBody.error_description;
        } else if (typeof errorBody.error === "string") {
          errorMessage = errorBody.error;
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 401) {
        errorCode = "INVALID_CREDENTIALS";
      } else if (response.status === 429) {
        errorCode = "UPSTREAM_RATE_LIMIT";
      }

      return {
        ok: false,
        error: {
          status: response.status,
          message: errorMessage,
          code: errorCode,
          meta,
        },
      };
    }

    const tokenResponse = (await response.json()) as TokenResponse;

    const token: CachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAtMs: expiresAtFromExpiresIn(tokenResponse.expires_in, renewSkewMs),
    };

    return { ok: true, token, meta };
  } catch (error) {
    // P1-10: Handle timeout abort specifically
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: {
          status: 0,
          message: `Identity service timeout after ${IDENTITY_TIMEOUT_MS}ms`,
          code: "IDENTITY_TIMEOUT",
        },
      };
    }

    const message = error instanceof Error ? error.message : "Network error";
    return {
      ok: false,
      error: {
        status: 0,
        message,
        code: "NETWORK_ERROR",
      },
    };
  } finally {
    // P1-10: Always clear the timeout
    clearTimeout(timeoutId);
  }
}
