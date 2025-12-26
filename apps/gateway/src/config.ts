export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  gitSha?: string;
  sessionTtlMs: number;
  tokenRenewSkewMs: number;
  validateUpstream: boolean;
  // TIN validation cache settings
  cacheHashSalt: string;
  tinValidCacheTtlDays: number;
  tinInvalidCacheTtlDays: number;
  // Observability settings
  metricsEnabled: boolean;
  metricsRoute: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || "3000", 10),
    host: process.env.HOST || "0.0.0.0",
    nodeEnv: process.env.NODE_ENV || "development",
    logLevel: process.env.LOG_LEVEL || "info",
    gitSha: process.env.GIT_SHA,
    sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || "86400000", 10),
    tokenRenewSkewMs: parseInt(process.env.TOKEN_RENEW_SKEW_MS || "30000", 10),
    validateUpstream: process.env.VALIDATE_UPSTREAM === "true",
    // TIN validation cache - use CACHE_HASH_SALT from env, fallback to random for dev
    cacheHashSalt: process.env.CACHE_HASH_SALT || "dev-salt-do-not-use-in-prod",
    tinValidCacheTtlDays: parseInt(process.env.TIN_VALIDATE_CACHE_TTL_DAYS_VALID || "180", 10),
    tinInvalidCacheTtlDays: parseInt(process.env.TIN_VALIDATE_CACHE_TTL_DAYS_INVALID || "7", 10),
    // Observability - metrics disabled by default
    metricsEnabled: process.env.METRICS_ENABLED === "true",
    metricsRoute: process.env.METRICS_ROUTE || "/metrics",
  };
}
