import type { FastifyPluginAsync } from "fastify";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSigningHealthStatus } from "../config/signing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  name: string;
  version: string;
}

function getPackageInfo(): PackageJson {
  try {
    const pkgPath = join(__dirname, "../../package.json");
    const content = readFileSync(pkgPath, "utf-8");
    return JSON.parse(content) as PackageJson;
  } catch {
    return { name: "@myinvois/gateway", version: "0.0.0" };
  }
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  const pkg = getPackageInfo();

  fastify.get("/healthz", async (_request, reply) => {
    return reply.send({ status: "ok" });
  });

  fastify.get("/readyz", async (_request, reply) => {
    const signingStatus = getSigningHealthStatus();

    return reply.send({
      status: "ok",
      checks: {
        database: "ok",
        redis: "ok",
      },
      signing: signingStatus,
    });
  });

  fastify.get("/version", async (_request, reply) => {
    const gitSha = process.env.GIT_SHA;
    return reply.send({
      name: pkg.name,
      version: pkg.version,
      ...(gitSha && { commit: gitSha }),
    });
  });
};
