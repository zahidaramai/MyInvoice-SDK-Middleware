import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { correlationIdPlugin } from "./plugins/correlationId.js";
import { errorHandlerPlugin } from "./plugins/errorHandler.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { createLoggerOptions } from "./plugins/logger.js";
import { healthRoutes } from "./routes/health.js";
import { sessionsRoutes } from "./routes/v1/sessions.js";
import { submissionsRoutes } from "./routes/v1/submissions.js";
import { documentsRoutes } from "./routes/v1/documents.js";
import { taxpayerRoutes } from "./routes/v1/taxpayer.js";
import { v1StubRoutes } from "./routes/v1.stub.js";
import { loadConfig } from "./config.js";

export interface BuildAppOptions {
  logger?: boolean | FastifyServerOptions["logger"];
  metricsEnabled?: boolean;
  metricsRoute?: string;
}

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const config = loadConfig();

  // Determine logger configuration
  let loggerConfig: FastifyServerOptions["logger"];
  if (options.logger === false) {
    loggerConfig = false;
  } else if (options.logger === true) {
    loggerConfig = createLoggerOptions(config.logLevel);
  } else if (options.logger) {
    loggerConfig = options.logger;
  } else {
    loggerConfig = false;
  }

  const fastify = Fastify({
    logger: loggerConfig,
    genReqId: (req) => {
      const incomingId = req.headers["x-correlation-id"];
      if (typeof incomingId === "string" && incomingId.length > 0) {
        return incomingId;
      }
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    },
    requestIdHeader: "x-correlation-id",
  });

  // Register core plugins (order matters)
  await fastify.register(correlationIdPlugin);
  await fastify.register(errorHandlerPlugin);

  // Register metrics plugin (always registers for metric collection, route conditional)
  await fastify.register(metricsPlugin, {
    enabled: options.metricsEnabled ?? config.metricsEnabled,
    route: options.metricsRoute ?? config.metricsRoute,
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(sessionsRoutes);
  await fastify.register(submissionsRoutes);
  await fastify.register(documentsRoutes);
  await fastify.register(taxpayerRoutes);
  await fastify.register(v1StubRoutes);

  return fastify;
}
