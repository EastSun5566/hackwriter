import { SlidingWindowRateLimiter } from './SlidingWindowRateLimiter.js';

/**
 * Rate limiter using sliding window algorithm
 * Prevents excessive API calls within a time window
 * 
 * @deprecated Use SlidingWindowRateLimiter directly for better performance
 */
export class RateLimiter {
  private limiter: SlidingWindowRateLimiter;

  /**
   * @param maxRequests - Maximum number of requests allowed
   * @param windowMs - Time window in milliseconds
   */
  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {
    this.limiter = new SlidingWindowRateLimiter(maxRequests, windowMs);
  }

  /**
   * Acquire permission to make a request
   * Will wait if rate limit is exceeded
   */
  async acquire(): Promise<void> {
    return this.limiter.acquire();
  }

  /**
   * Check if a request can be made without waiting
   */
  canAcquire(): boolean {
    return this.limiter.canAcquire();
  }

  /**
   * Get current usage statistics
   */
  getStats(): { current: number; max: number; windowMs: number } {
    return this.limiter.getStats();
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.limiter.reset();
  }
}
