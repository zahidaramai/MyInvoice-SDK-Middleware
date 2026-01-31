/**
 * Test Fixtures - Sessions
 *
 * Session configuration fixtures for testing.
 */

/**
 * Create a TAXPAYER mode session payload
 */
export function createTaxpayerSession(
  overrides: Partial<TaxpayerSessionPayload> = {}
): TaxpayerSessionPayload {
  return {
    env: "SANDBOX",
    mode: "TAXPAYER",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    ...overrides,
  };
}

/**
 * Create an INTERMEDIARY mode session payload
 */
export function createIntermediarySession(
  overrides: Partial<IntermediarySessionPayload> = {}
): IntermediarySessionPayload {
  return {
    env: "SANDBOX",
    mode: "INTERMEDIARY",
    clientId: "test-intermediary-id",
    clientSecret: "test-intermediary-secret",
    onBehalfOf: "C98765432109",
    ...overrides,
  };
}

/**
 * Session payload types
 */
export interface TaxpayerSessionPayload {
  env: "SANDBOX" | "PROD";
  mode: "TAXPAYER";
  clientId: string;
  clientSecret: string;
}

export interface IntermediarySessionPayload {
  env: "SANDBOX" | "PROD";
  mode: "INTERMEDIARY";
  clientId: string;
  clientSecret: string;
  onBehalfOf: string;
}

export type SessionPayload = TaxpayerSessionPayload | IntermediarySessionPayload;
