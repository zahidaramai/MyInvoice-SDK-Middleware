import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  AppError,
  createErrorEnvelope,
  createNotFoundError,
} from "../lib/errors.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    const correlationId = request.correlationId || request.id;

    let statusCode = 500;
    let messageEN = "Internal server error";
    let errorCode = "INTERNAL_ERROR";
    let propertyPath: string | undefined;

    if (error instanceof AppError) {
      statusCode = error.statusCode;
      messageEN = error.message;
      errorCode = error.code;
      propertyPath = error.details?.propertyPath ?? undefined;
    } else if (error instanceof Error) {
      messageEN = error.message;

      const errorWithStatus = error as Error & { statusCode?: number };
      if (typeof errorWithStatus.statusCode === "number") {
        statusCode = errorWithStatus.statusCode;

        if (statusCode === 400) {
          errorCode = "BAD_REQUEST";
        } else if (statusCode === 401) {
          errorCode = "UNAUTHORIZED";
        } else if (statusCode === 403) {
          errorCode = "FORBIDDEN";
        }
      }
    }

    if (statusCode >= 500) {
      request.log.error({ err: error, correlationId }, "Server error");
    } else {
      request.log.warn({ err: error, correlationId }, "Client error");
    }

    const envelope = createErrorEnvelope(statusCode, messageEN, {
      correlationId,
      errorCode,
      propertyPath,
    });

    reply.status(statusCode).send(envelope);
  });

  fastify.setNotFoundHandler((request, reply) => {
    const correlationId = request.correlationId || request.id;
    const envelope = createNotFoundError(
      `${request.method} ${request.url}`,
      correlationId
    );

    reply.status(404).send(envelope);
  });
};

export const errorHandlerPlugin = fp(plugin, {
  name: "errorHandler",
  dependencies: ["correlationId"],
});
