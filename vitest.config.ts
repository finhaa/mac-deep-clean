import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // The default 5 s trips on a busy machine, where scanner modules load lazily and real find runs are slow.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
