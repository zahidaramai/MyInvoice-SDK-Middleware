export interface GatewayError {
  correlationId?: string;
  httpStatus: number;
  errorCode?: string;
  propertyName?: string | null;
  propertyPath?: string | null;
  target?: string | null;
  messageEN: string;
  messageMS?: string;
  inner?: GatewayError[];
  retryAfterSeconds?: number;
  upstream?: { service: "MYINVOIS"; path: string };
}

export interface ErrorEnvelope {
  error: GatewayError;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: GatewayError;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: Partial<GatewayError>
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code || "INTERNAL_ERROR";
    this.details = details as GatewayError;
  }
}

export function createErrorEnvelope(
  httpStatus: number,
  messageEN: string,
  options: {
    correlationId?: string;
    errorCode?: string;
    propertyPath?: string;
    retryAfterSeconds?: number;
  } = {}
): ErrorEnvelope {
  return {
    error: {
      httpStatus,
      messageEN,
      correlationId: options.correlationId,
      errorCode: options.errorCode,
      propertyPath: options.propertyPath,
      retryAfterSeconds: options.retryAfterSeconds,
    },
  };
}

export function createNotFoundError(
  path: string,
  correlationId?: string
): ErrorEnvelope {
  return createErrorEnvelope(404, `Route ${path} not found`, {
    correlationId,
    errorCode: "NOT_FOUND",
  });
}

export function createNotImplementedError(
  correlationId?: string
): ErrorEnvelope {
  return createErrorEnvelope(
    500,
    "Phase 02 stub. Implemented in Phase 03+.",
    {
      correlationId,
      errorCode: "NOT_IMPLEMENTED",
    }
  );
}
