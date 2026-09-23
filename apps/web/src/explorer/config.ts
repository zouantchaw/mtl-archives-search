import type { ThemeName } from './url-state'

export const WORKER_ORIGIN = 'https://mtl-archives-worker.wiel.workers.dev'
export const DEFAULT_SNAPSHOT_BASE = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings'

export function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
  if (configured) return configured
  return import.meta.env.PROD ? WORKER_ORIGIN : ''
}

export function snapshotBase(): string {
  return (import.meta.env.VITE_R2_EMBEDDINGS_BASE_URL ?? DEFAULT_SNAPSHOT_BASE).replace(/\/$/, '')
}

export function mapBackground(theme: ThemeName): number {
  return theme === 'dark' ? 0x0d0f14 : 0xebe4d6
}
