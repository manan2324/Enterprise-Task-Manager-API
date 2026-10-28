import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/**', 'src/utils/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
