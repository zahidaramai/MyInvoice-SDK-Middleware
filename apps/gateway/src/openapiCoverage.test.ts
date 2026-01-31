import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadOpenAPIRoutes, convertOpenAPIPathToFastify } from "./lib/openapiCoverage.js";

describe("OpenAPI Coverage", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Path conversion", () => {
    it("converts OpenAPI path params to Fastify format", () => {
      expect(convertOpenAPIPathToFastify("/v1/sessions/{sessionId}")).toBe(
        "/v1/sessions/:sessionId"
      );
      expect(convertOpenAPIPathToFastify("/v1/documents/{uuid}/cancel")).toBe(
        "/v1/documents/:uuid/cancel"
      );
      expect(convertOpenAPIPathToFastify("/v1/submissions/{trackingId}/poll")).toBe(
        "/v1/submissions/:trackingId/poll"
      );
    });

    it("handles paths without params", () => {
      expect(convertOpenAPIPathToFastify("/healthz")).toBe("/healthz");
      expect(convertOpenAPIPathToFastify("/v1/submissions")).toBe("/v1/submissions");
    });
  });

  describe("Route coverage", () => {
    it("loads routes from OpenAPI spec", () => {
      const routes = loadOpenAPIRoutes();
      expect(routes.length).toBeGreaterThan(0);

      const healthRoute = routes.find((r) => r.method === "GET" && r.path === "/healthz");
      expect(healthRoute).toBeDefined();
    });

    it("all OpenAPI routes are registered in Fastify", async () => {
      const expectedRoutes = loadOpenAPIRoutes();
      const missingRoutes: Array<{ method: string; path: string }> = [];

      for (const route of expectedRoutes) {
        const testUrl = route.path
          .replace(":sessionId", "sess_test123")
          .replace(":trackingId", "trk_test123")
          .replace(":uuid", "00000000-0000-0000-0000-000000000000")
          .replace(":id", "test_id_123")
          .replace(":userId", "test_user_123");

        const response = await app.inject({
          method: route.method as "GET" | "POST" | "PUT" | "DELETE",
          url: testUrl,
          ...(route.method === "POST" && { payload: {} }),
        });

        if (response.statusCode === 404) {
          const body = response.json();
          // Only count as missing if it's a route-level 404 (from notFoundHandler)
          // not a resource-level 404 (e.g., "Session not found")
          if (body.error?.errorCode === "NOT_FOUND" && body.error?.messageEN?.includes("Route")) {
            missingRoutes.push(route);
          }
        }
      }

      expect(missingRoutes).toEqual([]);
    });

    it("spec defines expected number of endpoints", () => {
      const routes = loadOpenAPIRoutes();
      expect(routes.length).toBe(40);
    });
  });
});
