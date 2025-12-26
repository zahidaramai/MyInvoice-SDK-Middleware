import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("correlationId", "");

  fastify.addHook(
    "onRequest",
    (
      request: FastifyRequest,
      _reply: FastifyReply,
      done: (err?: Error) => void
    ) => {
      request.correlationId = request.id;
      done();
    }
  );

  fastify.addHook(
    "onSend",
    (
      request: FastifyRequest,
      reply: FastifyReply,
      payload: unknown,
      done: (err?: Error | null, payload?: unknown) => void
    ) => {
      reply.header("correlationid", request.correlationId);
      done(null, payload);
    }
  );
};

export const correlationIdPlugin = fp(plugin, {
  name: "correlationId",
});
