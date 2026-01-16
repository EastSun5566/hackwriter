import { beforeEach, afterEach, vi } from 'vitest';

// Global mock setup
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Restore all mocks after each test
  vi.restoreAllMocks();
});
