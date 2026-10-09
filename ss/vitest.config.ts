import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: [resolve(import.meta.dirname, 'tests/helpers/setup-integration.ts')],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/core/**/*.ts', 'src/shared/**/*.ts', 'src/infra/settings.ts'],
      thresholds: {
        // Scoped to the pure logic layers, where a number actually means
        // something. UI wiring is covered by the e2e suite instead, and
        // inflating this with it would make the figure meaningless.
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
