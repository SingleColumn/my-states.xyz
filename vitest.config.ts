import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // Keep the suite in one worker. Several tests import tldraw and the
    // Spotify search modules; parallel fork startup can time out on Windows
    // when the repository lives in a synced OneDrive workspace.
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
    sequence: { hooks: 'list' },
    // Modules that read the panel schema import tldraw, which is slow to load
    // under a full parallel run.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
