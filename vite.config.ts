import { defineConfig } from 'vitest/config';

// base: './' keeps every asset path relative, so dist/ can be opened from any
// static host (GitHub Pages, a USB stick) with no backend.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/golden/**/*.test.ts', 'tests/*.test.ts'],
    testTimeout: 20000,
  },
});
