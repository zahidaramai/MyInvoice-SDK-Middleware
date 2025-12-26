/**
 * Environment configuration and URL resolution for MyInvois API
 */

export type Environment = "PROD" | "SANDBOX";
export type Mode = "TAXPAYER" | "INTERMEDIARY";

const PROD_BASE_URL = "https://api.myinvois.hasil.gov.my";
const SANDBOX_BASE_URL = "https://preprod-api.myinvois.hasil.gov.my";

/**
 * Resolve the Identity Service base URL for a given environment
 */
export function resolveIdentityBaseUrl(env: Environment): string {
  return env === "PROD" ? PROD_BASE_URL : SANDBOX_BASE_URL;
}

/**
 * Resolve the System API base URL for a given environment
 */
export function resolveSystemBaseUrl(env: Environment): string {
  return env === "PROD" ? PROD_BASE_URL : SANDBOX_BASE_URL;
}

/**
 * Validate that a string is a valid Environment
 */
export function isValidEnvironment(value: unknown): value is Environment {
  return value === "PROD" || value === "SANDBOX";
}

/**
 * Validate that a string is a valid Mode
 */
export function isValidMode(value: unknown): value is Mode {
  return value === "TAXPAYER" || value === "INTERMEDIARY";
}
