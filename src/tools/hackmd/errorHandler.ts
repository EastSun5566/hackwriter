import { ErrorFactory, AppError } from "../../utils/ErrorTypes.js";

interface ErrorWithResponse {
  response?: {
    status?: number;
    data?: {
      message?: string;
    };
    headers?: {
      "retry-after"?: string;
    };
    config?: {
      url?: string;
    };
  };
  message?: string;
}

/**
 * Map HTTP status code to appropriate error type
 */
function mapStatusToError(
  status: number | undefined,
  message: string,
  response: ErrorWithResponse["response"] | undefined,
  context?: string,
): AppError {
  switch (status) {
    case 401: {
      return ErrorFactory.auth("Invalid or expired HackMD API token", "HackMD");
    }

    case 403: {
      return ErrorFactory.permission(
        context ?? "access this resource",
        "HackMD note",
      );
    }

    case 404: {
      return ErrorFactory.notFound(
        "Note",
        context ? `(${context})` : undefined,
      );
    }

    case 429: {
      const retryAfter = response?.headers?.["retry-after"];
      return ErrorFactory.rateLimit(
        retryAfter ? parseInt(retryAfter) : undefined,
      );
    }

    case 500:
    case 502:
    case 503: {
      return ErrorFactory.network(
        `HackMD service error: ${message}`,
        response?.config?.url,
      );
    }

    default: {
      return ErrorFactory.internal(
        context ? `${context}: ${message}` : message,
      );
    }
  }
}

/**
 * Helper to handle HackMD API errors with proper HTTP status code mapping
 */
export function handleHackMDError(error: unknown, context?: string): AppError {
  // Check if it's already an AppError
  if (error instanceof AppError) {
    return error;
  }

  // Handle axios/fetch errors with response
  if (error && typeof error === "object" && "response" in error) {
    const err = error as ErrorWithResponse;
    const response = err.response;
    const status = response?.status;
    const message = response?.data?.message ?? err.message ?? "Unknown error";

    return mapStatusToError(status, message, response, context);
  }

  // Handle standard errors with status codes in message
  if (error instanceof Error) {
    // Try to extract status code from message like "Request failed with status code 404"
    const statusMatch = /status code (\d+)/i.exec(error.message);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]);
      return mapStatusToError(status, error.message, undefined, context);
    }

    return ErrorFactory.internal(
      context ? `${context}: ${error.message}` : error.message,
      error,
    );
  }

  // Handle unknown errors
  return ErrorFactory.internal(
    context ? `${context}: ${String(error)}` : String(error),
  );
}
