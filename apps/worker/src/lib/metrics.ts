/**
 * Prometheus metrics for worker
 * Collects default Node.js metrics + custom poll job metrics
 */

import {
  createRegistry,
  initDefaultMetrics,
  defineCustomMetrics,
  recordPollJob,
  type CustomMetrics,
  type PollJobResult,
} from "@myinvois/core";
import { Registry } from "prom-client";
import { createServer, type Server } from "http";
import { logger } from "./logger.js";

let registry: Registry | null = null;
let metrics: CustomMetrics | null = null;
let metricsServer: Server | null = null;

/**
 * Initialize metrics registry
 */
export function initMetrics(prefix = ""): CustomMetrics {
  registry = createRegistry();
  initDefaultMetrics(registry, prefix);
  metrics = defineCustomMetrics(registry, prefix);
  return metrics;
}

/**
 * Get the metrics registry
 */
export function getMetricsRegistry(): Registry | null {
  return registry;
}

/**
 * Get custom metrics
 */
export function getMetrics(): CustomMetrics | null {
  return metrics;
}

/**
 * Record poll job result
 */
export function recordPollJobResult(result: PollJobResult): void {
  if (metrics) {
    recordPollJob(metrics, result);
  }
}

/**
 * Update submissions in progress gauge
 */
export function setSubmissionsInProgress(count: number): void {
  if (metrics) {
    metrics.submissionsInProgress.set(count);
  }
}

/**
 * Increment submissions in progress gauge
 */
export function incSubmissionsInProgress(): void {
  if (metrics) {
    metrics.submissionsInProgress.inc();
  }
}

/**
 * Decrement submissions in progress gauge
 */
export function decSubmissionsInProgress(): void {
  if (metrics) {
    metrics.submissionsInProgress.dec();
  }
}

/**
 * Start a tiny HTTP server for metrics endpoint
 */
export async function startMetricsServer(port: number = 9091): Promise<Server> {
  if (!registry) {
    throw new Error("Metrics not initialized. Call initMetrics() first.");
  }

  return new Promise((resolve, reject) => {
    metricsServer = createServer(async (req, res) => {
      if (req.url === "/metrics" && req.method === "GET") {
        try {
          const metricsOutput = await registry!.metrics();
          res.setHeader("Content-Type", registry!.contentType);
          res.statusCode = 200;
          res.end(metricsOutput);
        } catch (error) {
          res.statusCode = 500;
          res.end("Error collecting metrics");
          logger.error({ error }, "Error collecting metrics");
        }
      } else if (req.url === "/health" && req.method === "GET") {
        res.setHeader("Content-Type", "application/json");
        res.statusCode = 200;
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.statusCode = 404;
        res.end("Not Found");
      }
    });

    metricsServer.on("error", (error) => {
      logger.error({ error, port }, "Metrics server error");
      reject(error);
    });

    metricsServer.listen(port, () => {
      logger.info({ port }, "Metrics server started");
      resolve(metricsServer!);
    });
  });
}

/**
 * Stop the metrics server
 */
export async function stopMetricsServer(): Promise<void> {
  if (metricsServer) {
    return new Promise((resolve) => {
      metricsServer!.close(() => {
        logger.info("Metrics server stopped");
        metricsServer = null;
        resolve();
      });
    });
  }
}

/**
 * Check if metrics server is running
 */
export function isMetricsServerRunning(): boolean {
  return metricsServer !== null && metricsServer.listening;
}
