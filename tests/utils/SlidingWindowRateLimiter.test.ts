import { describe, it, expect, afterEach, vi } from 'vitest';

import { SlidingWindowRateLimiter } from '../../src/utils/SlidingWindowRateLimiter.js';

describe('SlidingWindowRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within limit', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    const stats = limiter.getStats();
    expect(stats.current).toBe(3);
    expect(stats.max).toBe(3);
  });

  it('should wait when limit is exceeded', async () => {
    const limiter = new SlidingWindowRateLimiter(2, 500);

    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();

    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(400);

    const stats = limiter.getStats();
    expect(stats.current).toBe(1);
  });

  it('should check if request can be acquired', async () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);

    expect(limiter.canAcquire()).toBe(true);

    await limiter.acquire();
    expect(limiter.canAcquire()).toBe(true);

    await limiter.acquire();
    expect(limiter.canAcquire()).toBe(false);
  });

  it('should reset correctly', async () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);

    await limiter.acquire();
    await limiter.acquire();

    limiter.reset();

    const stats = limiter.getStats();
    expect(stats.current).toBe(0);
    expect(limiter.canAcquire()).toBe(true);
  });

  it('should clean up old requests', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 100);

    await limiter.acquire();
    await limiter.acquire();

    await new Promise((resolve) => setTimeout(resolve, 150));

    await limiter.acquire();

    const stats = limiter.getStats();
    expect(stats.current).toBe(1);
  });
});