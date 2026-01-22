import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '../../src/utils/RateLimiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    const limiter = new RateLimiter(2, 1000);

    await limiter.acquire();
    await limiter.acquire();

    // Third request should wait
    const promise = limiter.acquire();
    
    // Fast-forward time
    vi.advanceTimersByTime(1000);
    
    await promise;
    
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
    const limiter = new RateLimiter(3, 1000);

    await limiter.acquire();
    await limiter.acquire();

    // Fast-forward past window
    vi.advanceTimersByTime(1100);

    await limiter.acquire();

    const stats = limiter.getStats();
    expect(stats.current).toBe(1); // Old requests should be cleaned up
  });
});
