import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../../src/utils/RateLimiter.js';

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within limit', async () => {
    const limiter = new RateLimiter(3, 1000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    const stats = limiter.getStats();
    expect(stats.current).toBe(3);
    expect(stats.max).toBe(3);
  });

  it('should wait when limit is exceeded', async () => {
    const limiter = new RateLimiter(2, 500); // Shorter window for faster test

    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();

    // Third request should wait ~500ms
    await limiter.acquire();
    const elapsed = Date.now() - start;
    
    // Should have waited approximately 500ms
    expect(elapsed).toBeGreaterThanOrEqual(400); // Allow some margin
    
    const stats = limiter.getStats();
    expect(stats.current).toBe(1);
  });

  it('should check if request can be acquired', () => {
    const limiter = new RateLimiter(2, 1000);

    expect(limiter.canAcquire()).toBe(true);
    
    limiter.acquire();
    expect(limiter.canAcquire()).toBe(true);
    
    limiter.acquire();
    expect(limiter.canAcquire()).toBe(false);
  });

  it('should reset correctly', async () => {
    const limiter = new RateLimiter(2, 1000);

    await limiter.acquire();
    await limiter.acquire();

    limiter.reset();

    const stats = limiter.getStats();
    expect(stats.current).toBe(0);
    expect(limiter.canAcquire()).toBe(true);
  });

  it('should clean up old requests', async () => {
    const limiter = new RateLimiter(3, 100); // Short window

    await limiter.acquire();
    await limiter.acquire();

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    await limiter.acquire();

    const stats = limiter.getStats();
    expect(stats.current).toBe(1); // Old requests should be cleaned up
  });
});
