import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  isNetworkError,
  isRetryableStatusCode,
  shouldRetryHttpError,
} from '../../src/utils/retry.js';

describe('retry utilities', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const result = await withRetry(fn, { maxRetries: 2, delayMs: 10 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(
        withRetry(fn, { maxRetries: 2, delayMs: 10 })
      ).rejects.toThrow('fail');

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should use exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const start = Date.now();
      await withRetry(fn, {
        maxRetries: 3,
        delayMs: 100,
        backoff: true,
      });
      const duration = Date.now() - start;

      // Should wait 100ms + 200ms = 300ms minimum
      expect(duration).toBeGreaterThanOrEqual(300);
    });

    it('should respect shouldRetry predicate', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          shouldRetry: () => false,
        })
      ).rejects.toThrow('non-retryable');

      expect(fn).toHaveBeenCalledTimes(1); // Should not retry
    });

    it('should call onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const onRetry = vi.fn();

      await withRetry(fn, {
        maxRetries: 2,
        delayMs: 10,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    });
  });

  describe('isNetworkError', () => {
    it('should detect network errors', () => {
      expect(isNetworkError(new Error('Network error'))).toBe(true);
      expect(isNetworkError(new Error('Connection timeout'))).toBe(true);
      expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isNetworkError(new Error('ETIMEDOUT'))).toBe(true);
    });

    it('should not detect non-network errors', () => {
      expect(isNetworkError(new Error('Invalid input'))).toBe(false);
      expect(isNetworkError('string error')).toBe(false);
    });
  });

  describe('isRetryableStatusCode', () => {
    it('should identify retryable status codes', () => {
      expect(isRetryableStatusCode(408)).toBe(true);
      expect(isRetryableStatusCode(429)).toBe(true);
      expect(isRetryableStatusCode(500)).toBe(true);
      expect(isRetryableStatusCode(502)).toBe(true);
      expect(isRetryableStatusCode(503)).toBe(true);
      expect(isRetryableStatusCode(504)).toBe(true);
    });

    it('should not retry client errors', () => {
      expect(isRetryableStatusCode(400)).toBe(false);
      expect(isRetryableStatusCode(401)).toBe(false);
      expect(isRetryableStatusCode(404)).toBe(false);
    });

    it('should not retry success codes', () => {
      expect(isRetryableStatusCode(200)).toBe(false);
      expect(isRetryableStatusCode(201)).toBe(false);
    });
  });

  describe('shouldRetryHttpError', () => {
    it('should retry network errors', () => {
      expect(shouldRetryHttpError(new Error('Network error'))).toBe(true);
    });

    it('should retry retryable HTTP status codes', () => {
      const error = {
        response: { status: 503 },
      };
      expect(shouldRetryHttpError(error)).toBe(true);
    });

    it('should not retry non-retryable errors', () => {
      const error = {
        response: { status: 404 },
      };
      expect(shouldRetryHttpError(error)).toBe(false);
    });

    it('should not retry unknown errors', () => {
      expect(shouldRetryHttpError(new Error('Unknown error'))).toBe(false);
    });
  });
});
