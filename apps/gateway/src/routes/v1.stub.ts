import type { FastifyPluginAsync } from "fastify";
import { createNotImplementedError } from "../lib/errors.js";

export const v1StubRoutes: FastifyPluginAsync = async (fastify) => {
  const stubHandler = async (
    request: { correlationId?: string; id: string },
    reply: { status: (code: number) => { send: (body: unknown) => void } }
  ) => {
    const correlationId = request.correlationId || request.id;
    const envelope = createNotImplementedError(correlationId);
    return reply.status(500).send(envelope);
  };

  // Sessions - Implemented in routes/v1/sessions.ts

  // Submissions
  fastify.post("/v1/submissions", stubHandler);
  fastify.get("/v1/submissions/:trackingId", stubHandler);
  fastify.post("/v1/submissions/:trackingId/poll", stubHandler);

  // Documents
  fastify.post("/v1/documents/:uuid/cancel", stubHandler);
  fastify.post("/v1/documents/:uuid/reject", stubHandler);
  fastify.get("/v1/documents/:uuid/details", stubHandler);

  // Taxpayer
  fastify.get("/v1/tin/validate", stubHandler);
};
