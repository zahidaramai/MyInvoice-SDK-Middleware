/**
 * AppError - Application-level error class with HTTP status and error codes
 * P2-02: Provides proper stack traces and type-safe error handling
 */

export class AppError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Application error code */
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Convert to JSON-serializable object for API responses
   */
  toJSON(): { status: number; code: string; message: string } {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
    };
  }

  /**
   * Check if an error is an AppError
   */
  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}

/**
 * Common pre-defined errors for convenience
 */
export const AppErrors = {
  notFound: (resource: string) =>
    new AppError(404, `${resource} not found`, "NOT_FOUND"),

  badRequest: (message: string, code = "BAD_REQUEST") =>
    new AppError(400, message, code),

  unauthorized: (message = "Unauthorized") =>
    new AppError(401, message, "UNAUTHORIZED"),

  forbidden: (message = "Access denied") =>
    new AppError(403, message, "FORBIDDEN"),

  conflict: (message: string, code = "CONFLICT") =>
    new AppError(409, message, code),

  internalError: (message = "Internal server error") =>
    new AppError(500, message, "INTERNAL_ERROR"),

  configError: (message: string) =>
    new AppError(500, message, "CONFIG_ERROR"),

  validationError: (message: string) =>
    new AppError(400, message, "VALIDATION_ERROR"),
};
