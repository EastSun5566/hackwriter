import { Logger } from './Logger.js';

/**
 * Rate limiter using sliding window algorithm
 * Prevents excessive API calls within a time window
 */
export class RateLimiter {
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
    
    // Remove requests outside the current window
    this.requests = this.requests.filter(t => now - t < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      
      Logger.debug(
        'RateLimiter',
        `Rate limit reached, waiting ${waitTime}ms`,
        { maxRequests: this.maxRequests, windowMs: this.windowMs }
      );

      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire(); // Retry after waiting
    }

    this.requests.push(now);
  }

  /**
   * Check if a request can be made without waiting
   */
  canAcquire(): boolean {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    return this.requests.length < this.maxRequests;
  }

  /**
   * Get current usage statistics
   */
  getStats(): { current: number; max: number; windowMs: number } {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    
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
