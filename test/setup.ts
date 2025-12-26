/**
 * Test Setup for E2E Tests
 *
 * Configures MSW and test environment.
 */

import { beforeAll, afterAll, afterEach } from "vitest";
import { startMockServer, stopMockServer, resetMockServer } from "./msw/server.js";

/**
 * Setup MSW server for all tests in this file
 */
export function setupMSW(): void {
  beforeAll(() => {
    startMockServer();
  });

  afterAll(() => {
    stopMockServer();
  });

  afterEach(() => {
    resetMockServer();
  });
}

// Re-export utilities
export { mockState } from "./msw/server.js";
export * from "./fixtures/documents.js";
export * from "./fixtures/sessions.js";
