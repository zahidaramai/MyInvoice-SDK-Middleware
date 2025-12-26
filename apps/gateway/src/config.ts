export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  gitSha?: string;
  sessionTtlMs: number;
  tokenRenewSkewMs: number;
  validateUpstream: boolean;
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
  };
}
