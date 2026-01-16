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
        'src/cli.ts', // CLI entry point
        'src/commands/**', // Interactive commands
      ],
    },
    mockReset: true,
    restoreMocks: true,
    testTimeout: 10000,
  },
});
