/**
 * In-memory session store with TTL
 */

import type { Environment, Mode } from "@myinvois/core";
import { sessionFingerprint, nowMs } from "@myinvois/core";

export interface StoredSession {
  sessionId: string;
  env: Environment;
  mode: Mode;
  clientId: string;
  clientSecret: string;
  scope?: string;
  onBehalfOf?: string;
  createdAt: number;
  lastUsedAt: number;
  fingerprint: string;
}

export interface SessionResponse {
  id: string;
  env: Environment;
  mode: Mode;
  onBehalfOf?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface SessionStoreOptions {
  /** Session TTL in milliseconds (default: 24 hours) */
  ttlMs?: number;
  /** Purge interval in milliseconds (default: 5 minutes) */
  purgeIntervalMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_PURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 11);
  return `sess_${timestamp}${random}`;
}

/**
 * In-memory session store
 */
export class SessionStore {
  private sessions: Map<string, StoredSession> = new Map();
  private ttlMs: number;
  private purgeIntervalId?: ReturnType<typeof setInterval>;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const purgeIntervalMs = options.purgeIntervalMs ?? DEFAULT_PURGE_INTERVAL_MS;

    // Start purge interval
    this.purgeIntervalId = setInterval(() => {
      this.purgeExpired();
    }, purgeIntervalMs);
  }

  /**
   * Create a new session
   */
  create(params: {
    env: Environment;
    mode: Mode;
    clientId: string;
    clientSecret: string;
    scope?: string;
    onBehalfOf?: string;
  }): StoredSession {
    const now = nowMs();
    const sessionId = generateSessionId();
    const fingerprint = sessionFingerprint(
      params.env,
      params.mode,
      params.clientId,
      params.onBehalfOf
    );

    const session: StoredSession = {
      sessionId,
      env: params.env,
      mode: params.mode,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      scope: params.scope,
      onBehalfOf: params.onBehalfOf,
      createdAt: now,
      lastUsedAt: now,
      fingerprint,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): StoredSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check if expired
    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    // Update last used
    session.lastUsedAt = nowMs();
    return session;
  }

  /**
   * Delete a session
   */
  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Check if a session exists
   */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /**
   * Convert stored session to API response format (sanitized)
   */
  toResponse(session: StoredSession): SessionResponse {
    const response: SessionResponse = {
      id: session.sessionId,
      env: session.env,
      mode: session.mode,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.createdAt + this.ttlMs).toISOString(),
    };

    if (session.mode === "INTERMEDIARY" && session.onBehalfOf) {
      response.onBehalfOf = session.onBehalfOf;
    }

    return response;
  }

  /**
   * Check if a session is expired
   */
  private isExpired(session: StoredSession): boolean {
    return nowMs() > session.createdAt + this.ttlMs;
  }

  /**
   * Purge expired sessions
   */
  private purgeExpired(): void {
    for (const [sessionId, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Get session count (for monitoring)
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Stop the purge interval (for cleanup)
   */
  stop(): void {
    if (this.purgeIntervalId) {
      clearInterval(this.purgeIntervalId);
      this.purgeIntervalId = undefined;
    }
  }
}

/**
 * Shared session store instance
 */
export const sessionStore = new SessionStore();
