/**
 * Application-level logger for non-request contexts
 * P2-01: Replace console.log/error with structured logging
 *
 * Use this logger in:
 * - Background jobs (poll queue, consolidator)
 * - Utility functions without Fastify request context
 * - Module-level initialization
 *
 * For request-scoped logging, use request.log from Fastify
 */

import pino from "pino";
import { PINO_REDACT_CONFIG } from "@myinvois/core";

/**
 * Get log level from environment
 */
function getLogLevel(): string {
  return process.env.LOG_LEVEL?.toLowerCase() || "info";
}

/**
 * Root application logger with redaction
 */
export const appLogger = pino({
  level: getLogLevel(),
  redact: PINO_REDACT_CONFIG,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: true,
  // Add component name to distinguish from request logs
  base: { component: "gateway" },
});

/**
 * Logger interface for dependency injection
 */
export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (obj: unknown, msg: string) => void;
  debug?: (msg: string) => void;
}

/**
 * Create a child logger for a specific component
 */
export function createComponentLogger(component: string): Logger {
  const child = appLogger.child({ component });
  return {
    info: (msg: string) => child.info(msg),
    warn: (msg: string) => child.warn(msg),
    error: (obj: unknown, msg: string) => child.error(obj, msg),
    debug: (msg: string) => child.debug(msg),
  };
}

/**
 * Pre-configured loggers for common components
 */
export const pollQueueLogger = createComponentLogger("poll-queue");
export const submissionLogger = createComponentLogger("submission");
export const publicApiLogger = createComponentLogger("public-api");
