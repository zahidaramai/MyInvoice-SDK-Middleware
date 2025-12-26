/**
 * MSW Server Setup
 *
 * Configures MSW for Node.js environment.
 * Used by E2E tests to intercept upstream MyInvois API calls.
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";
import { mockState } from "./state.js";

/**
 * MSW server instance for Node.js
 */
export const server = setupServer(...handlers);

/**
 * Start the MSW server
 * Should be called in test setup
 */
export function startMockServer(): void {
  server.listen({
    onUnhandledRequest: "warn",
  });
}

/**
 * Stop the MSW server
 * Should be called in test teardown
 */
export function stopMockServer(): void {
  server.close();
}

/**
 * Reset handlers and state between tests
 * Should be called after each test
 */
export function resetMockServer(): void {
  server.resetHandlers();
  mockState.reset();
}

/**
 * Add additional handlers for a specific test
 */
export function useMockHandlers(...additionalHandlers: Parameters<typeof server.use>): void {
  server.use(...additionalHandlers);
}

// Re-export state and handlers for convenience
export { mockState } from "./state.js";
export { handlers } from "./handlers.js";
