import { Logger } from './Logger.js';

export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 3)
   */
  maxRetries?: number;

  /**
   * Initial delay in milliseconds (default: 1000)
   */
  delayMs?: number;

  /**
   * Whether to use exponential backoff (default: true)
   */
  backoff?: boolean;

  /**
   * Maximum delay in milliseconds for exponential backoff (default: 30000)
   */
  maxDelayMs?: number;

  /**
   * Function to determine if error is retryable (default: all errors are retryable)
   */
  shouldRetry?: (error: unknown) => boolean;

  /**
   * Callback called before each retry
   */
  onRetry?: (error: unknown, attempt: number) => void;
}

/**
 * Execute a function with automatic retry on failure
 * 
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the function result
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, backoff: true }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    backoff = true,
    maxDelayMs = 30000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        Logger.debug('Retry', 'Error is not retryable, throwing immediately');
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        Logger.debug('Retry', `Max retries (${maxRetries}) reached, throwing error`);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = backoff
        ? Math.min(delayMs * Math.pow(2, attempt), maxDelayMs)
        : delayMs;

      Logger.debug(
        'Retry',
        `Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`,
        { error: error instanceof Error ? error.message : String(error) }
      );

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(error, attempt + 1);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Check if an error is a network error that should be retried
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout')
    );
  }
  return false;
}

/**
 * Check if an HTTP status code is retryable
 */
export function isRetryableStatusCode(status: number): boolean {
  // Retry on:
  // - 408 Request Timeout
  // - 429 Too Many Requests
  // - 500 Internal Server Error
  // - 502 Bad Gateway
  // - 503 Service Unavailable
  // - 504 Gateway Timeout
  return [408, 429, 500, 502, 503, 504].includes(status);
}

/**
 * Create a retry predicate for HTTP errors
 */
export function shouldRetryHttpError(error: unknown): boolean {
  // Check for network errors
  if (isNetworkError(error)) {
    return true;
  }

  // Check for HTTP status codes
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response;
    if (response?.status) {
      return isRetryableStatusCode(response.status);
    }
  }

  // Don't retry by default for unknown errors
  return false;
}
