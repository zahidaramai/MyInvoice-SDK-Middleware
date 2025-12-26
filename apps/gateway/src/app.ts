import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { correlationIdPlugin } from "./plugins/correlationId.js";
import { errorHandlerPlugin } from "./plugins/errorHandler.js";
import { healthRoutes } from "./routes/health.js";
import { sessionsRoutes } from "./routes/v1/sessions.js";
import { v1StubRoutes } from "./routes/v1.stub.js";

export interface BuildAppOptions {
  logger?: boolean | FastifyServerOptions["logger"];
}

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const { logger = false } = options;

  const fastify = Fastify({
    logger,
    genReqId: (req) => {
      const incomingId = req.headers["x-correlation-id"];
      if (typeof incomingId === "string" && incomingId.length > 0) {
        return incomingId;
      }
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    },
    requestIdHeader: "x-correlation-id",
  });

  // Register plugins
  await fastify.register(correlationIdPlugin);
  await fastify.register(errorHandlerPlugin);

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(sessionsRoutes);
  await fastify.register(v1StubRoutes);

  return fastify;
}
