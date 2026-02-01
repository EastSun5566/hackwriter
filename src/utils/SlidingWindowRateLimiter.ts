import { Logger } from './Logger.js';

/**
 * Optimized rate limiter using sliding window algorithm
 * More efficient than filtering entire array on every request
 */
export class SlidingWindowRateLimiter {
  private requests: number[] = [];

  /**
   * @param maxRequests - Maximum number of requests allowed
   * @param windowMs - Time window in milliseconds
   */
  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  /**
   * Acquire permission to make a request
   * Will wait if rate limit is exceeded
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove expired entries from the front (O(1) amortized)
    while (this.requests.length > 0 && this.requests[0] < windowStart) {
      this.requests.shift();
    }

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      
      Logger.debug(
        'SlidingWindowRateLimiter',
        `Rate limit reached, waiting ${waitTime}ms`,
        { maxRequests: this.maxRequests, windowMs: this.windowMs }
      );

      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire(); // Retry after waiting
    }

    // Add new request timestamp (maintains chronological order)
    this.requests.push(now);
  }

  /**
   * Check if a request can be made without waiting
   */
  canAcquire(): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove expired entries
    while (this.requests.length > 0 && this.requests[0] < windowStart) {
      this.requests.shift();
    }
    
    return this.requests.length < this.maxRequests;
  }

  /**
   * Get current usage statistics
   */
  getStats(): { current: number; max: number; windowMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove expired entries
    while (this.requests.length > 0 && this.requests[0] < windowStart) {
      this.requests.shift();
    }
    
    return {
      current: this.requests.length,
      max: this.maxRequests,
      windowMs: this.windowMs,
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = [];
  }
}
