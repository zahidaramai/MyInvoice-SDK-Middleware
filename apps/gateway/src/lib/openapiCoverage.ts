import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ExpectedRoute {
  method: string;
  path: string;
}

interface OpenAPISpec {
  paths: Record<string, Record<string, unknown>>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

export function convertOpenAPIPathToFastify(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

export function loadOpenAPIRoutes(specPath?: string): ExpectedRoute[] {
  const defaultPath = join(__dirname, "../../../../openapi/openapi.yaml");
  const filePath = specPath || defaultPath;

  const content = readFileSync(filePath, "utf-8");
  const spec = parseYaml(content) as OpenAPISpec;

  const routes: ExpectedRoute[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    const fastifyPath = convertOpenAPIPathToFastify(path);

    for (const method of Object.keys(methods)) {
      if (HTTP_METHODS.includes(method.toLowerCase())) {
        routes.push({
          method: method.toUpperCase(),
          path: fastifyPath,
        });
      }
    }
  }

  return routes;
}

export function getRegisteredRoutes(fastify: { printRoutes: () => string }): ExpectedRoute[] {
  const routeTree = fastify.printRoutes();
  const routes: ExpectedRoute[] = [];
  const lines = routeTree.split("\n");

  for (const line of lines) {
    const match = line.match(/^([A-Z]+)\s+(.+)$/);
    if (match) {
      routes.push({
        method: match[1],
        path: match[2].trim(),
      });
    }
  }

  return routes;
}

export function findMissingRoutes(
  expected: ExpectedRoute[],
  registered: ExpectedRoute[]
): ExpectedRoute[] {
  const registeredSet = new Set(registered.map((r) => `${r.method}:${r.path}`));

  return expected.filter((e) => !registeredSet.has(`${e.method}:${e.path}`));
}
