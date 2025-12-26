/**
 * OpenAPI Response Validator
 *
 * Validates gateway responses against the canonical OpenAPI spec.
 * Uses openapi-response-validator for schema validation.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import OpenAPIResponseValidator from "openapi-response-validator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Canonical OpenAPI spec path
const OPENAPI_SPEC_PATH = resolve(__dirname, "../../openapi/openapi.yaml");

/**
 * Parsed OpenAPI specification
 */
let spec: OpenAPISpec | null = null;

/**
 * OpenAPI spec types (simplified)
 */
interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
  };
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
}

interface Operation {
  operationId?: string;
  responses: Record<string, ResponseObject>;
}

interface ResponseObject {
  description: string;
  content?: Record<string, { schema: unknown }>;
  headers?: Record<string, unknown>;
}

/**
 * Load and parse the OpenAPI spec
 */
export function loadSpec(): OpenAPISpec {
  if (spec) return spec;

  const content = readFileSync(OPENAPI_SPEC_PATH, "utf-8");
  spec = yaml.load(content) as OpenAPISpec;
  return spec;
}

/**
 * Get the canonical OpenAPI spec path
 */
export function getSpecPath(): string {
  return OPENAPI_SPEC_PATH;
}

/**
 * Resolve $ref in schema
 */
function resolveRef(ref: string, spec: OpenAPISpec): unknown {
  // Handle component references like "#/components/schemas/SessionResponse"
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported $ref format: ${ref}`);
  }

  const path = ref.slice(2).split("/");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = spec;

  for (const segment of path) {
    if (current && typeof current === "object" && segment in current) {
      current = current[segment];
    } else {
      throw new Error(`Cannot resolve $ref: ${ref}`);
    }
  }

  return current;
}

/**
 * Recursively resolve all $refs in a schema
 */
function resolveAllRefs(schema: unknown, spec: OpenAPISpec): unknown {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveAllRefs(item, spec));
  }

  const obj = schema as Record<string, unknown>;

  // Handle $ref
  if ("$ref" in obj && typeof obj.$ref === "string") {
    const resolved = resolveRef(obj.$ref, spec);
    return resolveAllRefs(resolved, spec);
  }

  // Recursively resolve in object properties
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveAllRefs(value, spec);
  }

  return result;
}

/**
 * Get response schema for a given path, method, and status
 */
function getResponseSchema(
  specData: OpenAPISpec,
  path: string,
  method: string,
  status: number
): unknown | null {
  const pathItem = specData.paths[path];
  if (!pathItem) {
    throw new Error(`Path not found in spec: ${path}`);
  }

  const operation = pathItem[method.toLowerCase() as keyof PathItem];
  if (!operation) {
    throw new Error(`Method ${method} not found for path: ${path}`);
  }

  // Try exact status code first, then status category (2XX, 4XX, etc.)
  const statusStr = status.toString();
  const statusCategory = `${statusStr[0]}XX`;

  const response = operation.responses[statusStr] || operation.responses[statusCategory];
  if (!response) {
    // Check for default response
    if (operation.responses.default) {
      const defaultResponse = operation.responses.default;
      if (!defaultResponse.content?.["application/json"]) {
        return null;
      }
      return resolveAllRefs(defaultResponse.content["application/json"].schema, specData);
    }
    throw new Error(
      `Response ${status} not found for ${method} ${path}. Available: ${Object.keys(operation.responses).join(", ")}`
    );
  }

  // Handle response reference
  let resolvedResponse = response;
  if ("$ref" in response) {
    resolvedResponse = resolveRef((response as { $ref: string }).$ref, specData) as ResponseObject;
  }

  if (!resolvedResponse.content?.["application/json"]) {
    return null; // No JSON body expected (e.g., 204 No Content)
  }

  return resolveAllRefs(resolvedResponse.content["application/json"].schema, specData);
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    errorCode?: string;
  }>;
}

/**
 * Assert that a response conforms to the OpenAPI spec
 *
 * @param options Validation options
 * @returns Validation result
 */
export function assertConforms(options: {
  method: string;
  path: string;
  status: number;
  body: unknown;
}): ValidationResult {
  const { method, path, status, body } = options;
  const specData = loadSpec();

  const schema = getResponseSchema(specData, path, method, status);

  if (schema === null) {
    // No schema defined - valid if no body expected
    if (body === undefined || body === null || body === "") {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: [
        {
          path: "/",
          message: `No response schema defined for ${method} ${path} ${status}, but body was provided`,
        },
      ],
    };
  }

  // Create validator
  const validator = new OpenAPIResponseValidator({
    responses: {
      [status.toString()]: {
        description: "Response",
        content: {
          "application/json": {
            schema: schema as Parameters<typeof OpenAPIResponseValidator>[0]["responses"][string],
          },
        },
      },
    },
    components: specData.components || {},
  });

  // Validate
  const result = validator.validateResponse(status.toString(), body);

  if (result === undefined) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: result.errors.map((err) => ({
      path: err.path || "/",
      message: err.message,
      errorCode: err.errorCode,
    })),
  };
}

/**
 * Validate response and throw if invalid
 */
export function validateResponse(options: {
  method: string;
  path: string;
  status: number;
  body: unknown;
}): void {
  const result = assertConforms(options);
  if (!result.valid) {
    const errorMessages = result.errors
      .map((e) => `  ${e.path}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Response does not conform to OpenAPI spec for ${options.method} ${options.path} ${options.status}:\n${errorMessages}`
    );
  }
}

/**
 * Get all paths defined in the spec
 */
export function getAllPaths(): string[] {
  const specData = loadSpec();
  return Object.keys(specData.paths);
}

/**
 * Get all operations for a path
 */
export function getOperations(path: string): string[] {
  const specData = loadSpec();
  const pathItem = specData.paths[path];
  if (!pathItem) return [];

  return Object.keys(pathItem).filter((key) =>
    ["get", "post", "put", "delete", "patch"].includes(key)
  );
}
