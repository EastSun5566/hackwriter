import { Logger } from "./Logger.js";

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * RetryPolicy provides configurable retry logic with exponential backoff.
 * Useful for handling transient failures in network operations.
 */
export class RetryPolicy {
  private readonly options: RetryOptions;

  constructor(options: Partial<RetryOptions> = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      initialDelayMs: options.initialDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 10000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
    };
  }

  /**
   * Execute function with retry logic
   * @param fn - Function to execute
   * @returns Result of the function
   * @throws Last error if all retries fail
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt <= this.options.maxRetries) {
      try {
        if (attempt > 0) {
          Logger.debug("RetryPolicy", `Retry attempt ${attempt}/${this.options.maxRetries}`);
        }
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt > this.options.maxRetries) {
          Logger.error("RetryPolicy", `All ${this.options.maxRetries} retries failed`, {
            error: lastError.message,
          });
          throw lastError;
        }

        const delay = this.getDelay(attempt);
        Logger.debug("RetryPolicy", `Waiting ${delay}ms before retry`, {
          attempt,
          maxRetries: this.options.maxRetries,
          error: lastError.message,
        });

        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError ?? new Error("Retry failed with unknown error");
  }

  /**
   * Calculate delay for retry attempt with exponential backoff and jitter
   * @param attempt - Current attempt number (1-indexed)
   * @returns Delay in milliseconds
   */
  getDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
    const exponentialDelay =
      this.options.initialDelayMs * Math.pow(this.options.backoffMultiplier, attempt - 1);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.options.maxDelayMs);

    // Add jitter (±20%) to prevent thundering herd
    const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
    const delayWithJitter = Math.max(0, cappedDelay + jitter);

    // Ensure minimum delay of 1 second
    return Math.max(1000, delayWithJitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
