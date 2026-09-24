import type { LayoutConfig } from './layout-engine'
import { LAYOUT_VERSION } from './layout-state'

export type CachedLayout = {
  ids: string[]
  coordinates: Float32Array
}

type StoredLayout = {
  key: string
  ids: string[]
  coordinates: number[]
  lastUsed: number
}

export const LAYOUT_CACHE_DB_NAME = 'mtl-explorer-layouts'
export const LAYOUT_CACHE_STORE_NAME = 'coordinates'
export const MAX_LAYOUT_CACHE_ENTRIES = 8

/** The property order is deliberate: it makes the cache key stable across callers. */
export function layoutCacheKey(vectorSha256: string, config: LayoutConfig): string {
  const canonicalConfig = {
    dimensions: config.dimensions,
    nNeighbors: config.nNeighbors,
    minDist: config.minDist,
    seed: config.seed,
  }
  return `${vectorSha256}:${LAYOUT_VERSION}:${JSON.stringify(canonicalConfig)}`
}

/**
 * Validate data before it reaches projectLayout. IndexedDB is application data,
 * not a trust boundary: old entries and manually altered browser data are both
 * expected to be possible.
 */
export function validateCachedLayout(
  value: unknown,
  expectedIds: readonly string[] | null | undefined,
  dimensions: 2 | 3,
): CachedLayout | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { ids?: unknown; coordinates?: unknown }
  const coordinateValues = Array.isArray(candidate.coordinates)
    ? candidate.coordinates
    : ArrayBuffer.isView(candidate.coordinates) && !(candidate.coordinates instanceof DataView)
      ? Array.from(candidate.coordinates as unknown as ArrayLike<number>)
      : null
  if (!Array.isArray(candidate.ids) || !coordinateValues) return null
  if (candidate.ids.length === 0 || candidate.ids.some((id) => typeof id !== 'string' || id.length === 0)) return null
  if (new Set(candidate.ids).size !== candidate.ids.length) return null
  if (expectedIds && (candidate.ids.length !== expectedIds.length || candidate.ids.some((id, index) => id !== expectedIds[index]))) return null
  if (coordinateValues.length !== candidate.ids.length * dimensions) return null
  if (coordinateValues.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) return null
  const coordinates = new Float32Array(coordinateValues)
  if ([...coordinates].some((coordinate) => !Number.isFinite(coordinate))) return null
  return { ids: [...candidate.ids], coordinates }
}

function indexedDb(): IDBFactory | null {
  try {
    return typeof globalThis.indexedDB === 'undefined' ? null : globalThis.indexedDB
  } catch {
    return null
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = indexedDb()
  if (!factory) return Promise.resolve(null)
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(LAYOUT_CACHE_DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    let settled = false
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        if (database) database.close()
        return
      }
      settled = true
      resolve(database)
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(LAYOUT_CACHE_STORE_NAME)) {
        database.createObjectStore(LAYOUT_CACHE_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => finish(request.result)
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
}

function closeAfter<T>(database: IDBDatabase, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const result = new Promise<T | null>((resolve) => {
    let request: IDBRequest<T>
    try {
      const transaction = database.transaction(LAYOUT_CACHE_STORE_NAME, 'readwrite')
      request = operation(transaction.objectStore(LAYOUT_CACHE_STORE_NAME))
      transaction.oncomplete = () => resolve(request.result)
      request.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
      transaction.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return result.finally(() => {
    // Closing after the transaction has settled is safe and avoids retaining an
    // IndexedDB connection in browsers that keep inactive databases alive.
    try { database.close() } catch { /* storage is optional */ }
  })
}

export async function readLayoutCache(
  vectorSha256: string | null,
  config: LayoutConfig,
  expectedIds: readonly string[] | null | undefined,
): Promise<CachedLayout | null> {
  if (!vectorSha256) return null
  const database = await openDatabase()
  if (!database) return null
  const key = layoutCacheKey(vectorSha256, config)
  const stored = await closeAfter<StoredLayout>(database, (store) => store.get(key))
  const result = validateCachedLayout(stored, expectedIds, config.dimensions)
  if (!result && stored) {
    // Remove malformed entries opportunistically. A failed delete is harmless.
    const cleanup = await openDatabase()
    if (cleanup) await closeAfter(cleanup, (store) => store.delete(key))
    return null
  }
  if (result) {
    const touch = await openDatabase()
    if (touch) await closeAfter(touch, (store) => store.put({ ...stored, lastUsed: Date.now() }))
  }
  return result
}

export async function writeLayoutCache(
  vectorSha256: string | null,
  config: LayoutConfig,
  value: CachedLayout,
): Promise<void> {
  if (!vectorSha256) return
  const validated = validateCachedLayout(value, value.ids, config.dimensions)
  if (!validated) return
  const database = await openDatabase()
  if (!database) return
  const key = layoutCacheKey(vectorSha256, config)
  const entry: StoredLayout = {
    key,
    ids: [...value.ids],
    coordinates: Array.from(validated.coordinates),
    lastUsed: Date.now(),
  }
  const existing = await closeAfter<StoredLayout[]>(database, (store) => store.getAll())
  const writeDatabase = await openDatabase()
  if (!writeDatabase) return
  await closeAfter(writeDatabase, (store) => store.put(entry))
  const all = [...(existing ?? []).filter((item) => item.key !== key), entry].sort((left, right) => right.lastUsed - left.lastUsed)
  if (all.length <= MAX_LAYOUT_CACHE_ENTRIES) return
  const cleanup = await openDatabase()
  if (!cleanup) return
  await new Promise<void>((resolve) => {
    try {
      const transaction = cleanup.transaction(LAYOUT_CACHE_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(LAYOUT_CACHE_STORE_NAME)
      all.slice(MAX_LAYOUT_CACHE_ENTRIES).forEach((item) => store.delete(item.key))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  try { cleanup.close() } catch { /* storage is optional */ }
}
