import type { FastifyPluginAsync } from "fastify";

export const v1StubRoutes: FastifyPluginAsync = async (_fastify) => {
  // All V1 routes are now implemented:
  // - Sessions - routes/v1/sessions.ts
  // - Submissions - routes/v1/submissions.ts
  // - Documents - routes/v1/documents.ts
  // - Taxpayer (TIN validate) - routes/v1/taxpayer.ts
};
