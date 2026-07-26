import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'tests/**',
        '**/*.test.ts',
        '**/types/**',
        'dist/**',
      ],
      thresholds: {
        statements: 63,
        branches: 53,
        functions: 68,
        lines: 64,
      },
    },
    mockReset: true,
    restoreMocks: true,
    testTimeout: 10000,
  },
});
