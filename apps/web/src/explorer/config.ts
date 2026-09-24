import type { ThemeName } from './url-state'
import { resolveSnapshotBase, SNAPSHOT_PROXY_TARGET, PUBLISHED_SNAPSHOT_PATH } from './snapshot-proxy'

export const WORKER_ORIGIN = 'https://mtl-archives-worker.wiel.workers.dev'
export const DEFAULT_SNAPSHOT_BASE = `${SNAPSHOT_PROXY_TARGET}${PUBLISHED_SNAPSHOT_PATH}`

export function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
  if (configured) return configured
  return import.meta.env.PROD ? WORKER_ORIGIN : ''
}

export function snapshotBase(): string {
  return resolveSnapshotBase({
    dev: import.meta.env.DEV,
    configured: import.meta.env.VITE_R2_EMBEDDINGS_BASE_URL,
  })
}

export function mapBackground(theme: ThemeName): number {
  return theme === 'dark' ? 0x0d0f14 : 0xebe4d6
}
