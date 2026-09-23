import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { SNAPSHOT_PROXY_PREFIX, SNAPSHOT_PROXY_TARGET, rewriteSnapshotPath } from './src/explorer/snapshot-proxy'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://mtl-archives-worker.wiel.workers.dev',
        changeOrigin: true,
      },
      [SNAPSHOT_PROXY_PREFIX]: {
        target: SNAPSHOT_PROXY_TARGET,
        changeOrigin: true,
        rewrite: rewriteSnapshotPath,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
