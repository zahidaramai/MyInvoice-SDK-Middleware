import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
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
import { initializeSigning } from "./config/signing.js";
// HashLHDN imports
import { authRoutes } from "./auth/routes.js";
import { usersRoutes, rolesRoutes, companiesRoutes } from "./management/index.js";
import {
  hashlhdnRoutes,
  documentRoutes as hashlhdnDocumentRoutes,
  legacySubmitRoutes,
} from "./adapters/hashlhdn/index.js";
import { posRoutes } from "./adapters/pos/index.js";
import { publicRoutes } from "./public/index.js";
// Note: Auth error handling is now integrated into errorHandlerPlugin
import { startAutoPoller } from "./polling/autoPoller.js";
import { startMonthlyConsolidator } from "./polling/monthlyConsolidator.js";

export interface BuildAppOptions {
  logger?: boolean | FastifyServerOptions["logger"];
  metricsEnabled?: boolean;
  metricsRoute?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
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

  // Add custom content type parser to handle empty body with Content-Type: application/json
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    // Handle empty body
    if (body === "" || body === undefined) {
      done(null, null);
      return;
    }

    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Register CORS - allow all origins for now
  await fastify.register(cors, {
    origin: true, // Allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // Register core plugins (order matters)
  await fastify.register(correlationIdPlugin);
  await fastify.register(errorHandlerPlugin);

  // Register metrics plugin (always registers for metric collection, route conditional)
  await fastify.register(metricsPlugin, {
    enabled: options.metricsEnabled ?? config.metricsEnabled,
    route: options.metricsRoute ?? config.metricsRoute,
  });

  // Initialize signing service (supports S3 paths)
  const signingState = await initializeSigning(
    fastify.log as unknown as {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (obj: unknown, msg: string) => void;
    }
  );
  if (signingState.enabled) {
    fastify.log.info(`Signing enabled - default version: ${signingState.defaultVersion}`);
  } else {
    fastify.log.info(`Signing disabled${signingState.error ? `: ${signingState.error}` : ""}`);
  }

  // Auth error handling is integrated into errorHandlerPlugin

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(sessionsRoutes);
  await fastify.register(submissionsRoutes);
  await fastify.register(documentsRoutes);
  await fastify.register(taxpayerRoutes);
  await fastify.register(v1StubRoutes);

  // HashLHDN Authentication routes
  await fastify.register(authRoutes, { prefix: "/api/v1/auth" });

  // HashLHDN Management routes
  await fastify.register(usersRoutes, { prefix: "/api/v1/users" });
  await fastify.register(rolesRoutes, { prefix: "/api/v1/roles" });
  await fastify.register(companiesRoutes, { prefix: "/api/v1/companies" });

  // HashLHDN Submission routes
  await fastify.register(hashlhdnRoutes, { prefix: "/api/v1/hashlhdn" });

  // HashLHDN Document routes
  await fastify.register(hashlhdnDocumentRoutes, { prefix: "/api/v1/documents" });

  // Legacy Submit routes (client's original Postman format)
  // POST /api/v1/documents/submit - unified endpoint with flags
  await fastify.register(legacySubmitRoutes, { prefix: "/api/v1/documents" });

  // POS Integration routes
  await fastify.register(posRoutes, { prefix: "/api/v1/pos" });

  // Public routes (no authentication required)
  // These endpoints are for customer e-invoice registration via QR code
  await fastify.register(publicRoutes, { prefix: "/public" });

  // Start automatic status poller (every 30 minutes)
  // This polls MyInvois for SUBMITTED invoices and updates DB with LongID
  startAutoPoller(
    fastify.log as unknown as {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (obj: unknown, msg: string) => void;
    }
  );

  // Start monthly consolidator (checks hourly, runs on 28th @ 2:00 AM MYT)
  // This consolidates all DRAFT invoices per company into a single e-invoice
  startMonthlyConsolidator(
    fastify.log as unknown as {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (obj: unknown, msg: string) => void;
    }
  );

  return fastify;
}
