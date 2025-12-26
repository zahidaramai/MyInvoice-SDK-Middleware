/**
 * Prometheus metrics plugin for Fastify
 * Exposes /metrics endpoint and tracks HTTP request metrics
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import {
  createRegistry,
  initDefaultMetrics,
  defineCustomMetrics,
  normalizeRoute,
  type CustomMetrics,
} from "@myinvois/core";
import { Registry } from "prom-client";

declare module "fastify" {
  interface FastifyInstance {
    metricsRegistry: Registry;
    metrics: CustomMetrics;
  }
  interface FastifyRequest {
    metricsStartTime: number;
  }
}

export interface MetricsPluginOptions {
  enabled?: boolean;
  route?: string;
  prefix?: string;
}

const plugin: FastifyPluginAsync<MetricsPluginOptions> = async (fastify, options) => {
  const { enabled = false, route = "/metrics", prefix = "" } = options;

  // Create and configure registry
  const registry = createRegistry();
  initDefaultMetrics(registry, prefix);
  const metrics = defineCustomMetrics(registry, prefix);

  // Decorate fastify instance with registry and metrics
  fastify.decorate("metricsRegistry", registry);
  fastify.decorate("metrics", metrics);
  fastify.decorateRequest("metricsStartTime", 0);

  if (!enabled) {
    fastify.log.info("Metrics collection initialized (endpoint disabled)");
    return;
  }

  // Register /metrics route
  fastify.get(route, async (_request, reply) => {
    const metricsOutput = await registry.metrics();
    reply.header("Content-Type", registry.contentType);
    return reply.send(metricsOutput);
  });

  // Track request start time
  fastify.addHook("onRequest", (request: FastifyRequest, _reply: FastifyReply, done) => {
    request.metricsStartTime = performance.now();
    done();
  });

  // Record metrics on response
  fastify.addHook(
    "onResponse",
    (request: FastifyRequest, reply: FastifyReply, done) => {
      // Skip metrics endpoint itself to avoid recursion
      if (request.url === route) {
        done();
        return;
      }

      const durationMs = performance.now() - request.metricsStartTime;
      const durationSeconds = durationMs / 1000;

      // Get route pattern (normalized to avoid high cardinality)
      const routePattern = request.routeOptions?.url || normalizeRoute(request.url);

      const labels = {
        method: request.method,
        route: routePattern,
        status: String(reply.statusCode),
      };

      metrics.httpRequestsTotal.inc(labels);
      metrics.httpRequestDuration.observe(labels, durationSeconds);

      done();
    }
  );

  fastify.log.info({ route }, "Metrics endpoint registered");
};

export const metricsPlugin = fp(plugin, {
  name: "metrics",
  fastify: "5.x",
});

/**
 * Get metrics registry from Fastify instance
 * For use in routes that need to record custom metrics
 */
export function getMetrics(fastify: { metrics: CustomMetrics }): CustomMetrics {
  return fastify.metrics;
}
