import { shouldRetryHttpError, withRetry } from "../../utils/retry.ts";

export function withReadRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<T> {
  return withRetry(operation, {
    maxRetries,
    shouldRetry: shouldRetryHttpError,
    signal,
  });
}
