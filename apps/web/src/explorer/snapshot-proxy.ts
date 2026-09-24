export const PUBLISHED_SNAPSHOT_PATH = '/embeddings/v1/20260924T101335Z'
export const SNAPSHOT_PROXY_PREFIX = '/snapshot'
export const SNAPSHOT_PROXY_TARGET = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev'

export function rewriteSnapshotPath(requestPath: string): string {
  if (requestPath !== SNAPSHOT_PROXY_PREFIX && !requestPath.startsWith(`${SNAPSHOT_PROXY_PREFIX}/`)) {
    throw new Error('snapshot-proxy-path')
  }
  return requestPath.replace(/^\/snapshot/, PUBLISHED_SNAPSHOT_PATH)
}

export function resolveSnapshotBase(env: { dev: boolean; configured?: string | null }): string {
  const configured = env.configured?.trim()
  if (configured) return configured.replace(/\/$/, '')
  if (env.dev) return SNAPSHOT_PROXY_PREFIX
  return `${SNAPSHOT_PROXY_TARGET}${PUBLISHED_SNAPSHOT_PATH}`
}
