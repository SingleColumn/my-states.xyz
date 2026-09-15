import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    sequence: { hooks: 'list' },
    // Modules that read the panel schema import tldraw, which is slow to load
    // under a full parallel run.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})