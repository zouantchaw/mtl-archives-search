import { UMAP } from 'umap-js'

/** The number of coordinates produced for each item in a layout. */
export type LayoutDimensions = 2 | 3

export type LayoutConfig = {
  dimensions: LayoutDimensions
  nNeighbors: number
  minDist: number
  seed: number
}

export type LayoutProgress = (progress: number, phase: string) => void

export type LayoutWorkerInput = {
  matrix: Float32Array
  /** Number of values in each input embedding row. */
  dimensions: number
  config: LayoutConfig
}

export type LayoutWorkerProgress = {
  type: 'progress'
  progress: number
  phase: string
}

export type LayoutWorkerComplete = {
  type: 'complete'
  coordinates: Float32Array
}

export type LayoutWorkerError = {
  type: 'error'
  message: string
  stack?: string
}

export type LayoutWorkerOutput = LayoutWorkerProgress | LayoutWorkerComplete | LayoutWorkerError

/**
 * The explorer corpus is currently 13,499 rows. This guard keeps an accidental
 * upload from allocating an unbounded UMAP graph in a browser worker while
 * leaving room for the published corpus to grow.
 */
export const MAX_LAYOUT_POINTS = 20_000
export const MAX_EMBEDDING_DIMENSIONS = 4_096
export const MAX_LAYOUT_NEIGHBORS = 256
export const LAYOUT_ENGINE_VERSION = 'umap-js-1.4.0-v1'

export const LAYOUT_PRESETS = {
  'published-3d': { dimensions: 3, nNeighbors: 15, minDist: 0.1, seed: 42 },
  'local-2d': { dimensions: 2, nNeighbors: 8, minDist: 0.05, seed: 42 },
  'local-3d': { dimensions: 3, nNeighbors: 8, minDist: 0.05, seed: 42 },
  'broad-2d': { dimensions: 2, nNeighbors: 40, minDist: 0.3, seed: 42 },
  'broad-3d': { dimensions: 3, nNeighbors: 40, minDist: 0.3, seed: 42 },
} as const satisfies Record<string, LayoutConfig>

export type LayoutPreset = keyof typeof LAYOUT_PRESETS

/** Alias retained for callers that prefer the more explicit name. */
export const LAYOUT_PRESET_CONFIGS = LAYOUT_PRESETS

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = { ...LAYOUT_PRESETS['published-3d'] }

/** A small deterministic PRNG, matching the ETL exporter's seeded UMAP. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function assertConfig(config: LayoutConfig): void {
  if (config.dimensions !== 2 && config.dimensions !== 3) {
    throw new Error('Layout dimensions must be 2 or 3.')
  }
  if (!Number.isInteger(config.nNeighbors) || config.nNeighbors < 2 || config.nNeighbors > MAX_LAYOUT_NEIGHBORS) {
    throw new Error(`Layout nNeighbors must be an integer from 2 to ${MAX_LAYOUT_NEIGHBORS}.`)
  }
  if (!Number.isFinite(config.minDist) || config.minDist < 0) {
    throw new Error('Layout minDist must be a finite non-negative number.')
  }
  if (!Number.isFinite(config.seed)) {
    throw new Error('Layout seed must be finite.')
  }
}

function validateMatrix(matrix: Float32Array, dimensions: number, requireEnoughPoints = true): number {
  if (!(matrix instanceof Float32Array)) throw new Error('Layout matrix must be a Float32Array.')
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding dimensions must be an integer from 1 to ${MAX_EMBEDDING_DIMENSIONS}.`)
  }
  if (matrix.length === 0 || matrix.length % dimensions !== 0) {
    throw new Error('Layout matrix length must contain complete embedding rows.')
  }
  const count = matrix.length / dimensions
  if (requireEnoughPoints && count < 3) throw new Error('Layout needs at least 3 vectors.')
  if (count > MAX_LAYOUT_POINTS) throw new Error(`Layout is limited to ${MAX_LAYOUT_POINTS} vectors.`)
  return count
}

function effectiveConfig(config: LayoutConfig, count: number): LayoutConfig {
  assertConfig(config)
  if (config.nNeighbors >= count) {
    throw new Error(`Layout nNeighbors must be less than the vector count (${count}).`)
  }
  return { ...config, seed: Math.trunc(config.seed) }
}

/**
 * Copy and L2-normalize row-major embeddings for cosine UMAP. The copy means
 * the verified artifact matrix remains usable for another layout request.
 */
export function normalizeEmbeddings(matrix: Float32Array, dimensions: number, onProgress?: LayoutProgress): number[][] {
  const count = validateMatrix(matrix, dimensions, false)
  const normalized: number[][] = new Array(count)
  for (let row = 0; row < count; row += 1) {
    const values = new Array<number>(dimensions)
    let squaredNorm = 0
    const offset = row * dimensions
    for (let column = 0; column < dimensions; column += 1) {
      const value = matrix[offset + column]
      if (!Number.isFinite(value)) throw new Error(`Embedding ${row} contains a non-finite value.`)
      values[column] = value
      squaredNorm += value * value
    }
    const norm = Math.sqrt(squaredNorm)
    if (!(norm > 0)) throw new Error(`Embedding ${row} has zero length.`)
    for (let column = 0; column < dimensions; column += 1) values[column] /= norm
    normalized[row] = values
    if (onProgress && (row === count - 1 || row % Math.max(1, Math.floor(count / 100)) === 0)) {
      onProgress((row + 1) / count * 0.1, 'normalizing')
    }
  }
  return normalized
}

function cosineDistance(left: number[], right: number[]): number {
  let dot = 0
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index]
  return Math.max(0, Math.min(2, 1 - dot))
}

function createUmap(config: LayoutConfig, normalized: number[][], nEpochs?: number): UMAP {
  return new UMAP({
    nComponents: config.dimensions,
    nNeighbors: config.nNeighbors,
    minDist: config.minDist,
    spread: 1,
    nEpochs,
    distanceFn: cosineDistance,
    random: mulberry32(config.seed),
  })
}

export function layoutEpochs(count: number): number {
  // These are umap-js's default epoch bands, made explicit so a worker and a
  // precomputed artifact cannot silently drift when the library changes.
  if (count <= 2_500) return 500
  if (count <= 5_000) return 400
  if (count <= 7_500) return 300
  return 200
}

function flattenCoordinates(points: number[][], dimensions: LayoutDimensions): Float32Array {
  const coordinates = new Float32Array(points.length * dimensions)
  for (let row = 0; row < points.length; row += 1) {
    const point = points[row]
    if (!point || point.length !== dimensions) throw new Error('UMAP returned coordinates with the wrong dimension.')
    for (let column = 0; column < dimensions; column += 1) {
      if (!Number.isFinite(point[column])) throw new Error('UMAP returned a non-finite coordinate.')
      coordinates[row * dimensions + column] = point[column]
    }
  }
  return coordinates
}

/** Pure synchronous layout helper for Node precomputation and deterministic tests. */
export function computeLayout(matrix: Float32Array, dimensions: number, config: LayoutConfig, onProgress?: LayoutProgress): Float32Array {
  const count = validateMatrix(matrix, dimensions)
  const normalized = normalizeEmbeddings(matrix, dimensions, onProgress)
  const checked = effectiveConfig(config, count)
  onProgress?.(0.12, 'building-neighborhoods')
  const umap = createUmap(checked, normalized, layoutEpochs(count))
  const points = umap.fit(normalized)
  onProgress?.(1, 'complete')
  return flattenCoordinates(points, checked.dimensions)
}

/** Async variant used by the worker. Returning false from the callback cancels UMAP. */
export async function computeLayoutAsync(
  matrix: Float32Array,
  dimensions: number,
  config: LayoutConfig,
  onProgress?: LayoutProgress,
  shouldCancel?: () => boolean,
): Promise<Float32Array | null> {
  const count = validateMatrix(matrix, dimensions)
  const normalized = normalizeEmbeddings(matrix, dimensions, onProgress)
  const checked = effectiveConfig(config, count)
  onProgress?.(0.12, 'building-neighborhoods')
  const umap = createUmap(checked, normalized, layoutEpochs(count))
  const points = await umap.fitAsync(normalized, (epoch) => {
    const canceled = shouldCancel?.() ?? false
    onProgress?.(0.12 + 0.87 * Math.min(1, epoch / layoutEpochs(count)), 'optimizing')
    return !canceled
  })
  if (shouldCancel?.()) return null
  onProgress?.(1, 'complete')
  return flattenCoordinates(points, checked.dimensions)
}

export type LayoutWorkerTask = {
  promise: Promise<Float32Array>
  cancel: () => void
}

/**
 * Run a layout off the main thread. The input matrix is copied before transfer
 * so callers can keep using their verified embedding artifact for later jobs.
 */
export function runLayoutInWorker(
  matrix: Float32Array,
  dimensions: number,
  config: LayoutConfig,
  onProgress?: LayoutProgress,
  workerFactory: () => Worker = () => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' }),
): LayoutWorkerTask {
  const worker = workerFactory()
  let settled = false
  let rejectPromise: (reason?: unknown) => void = () => undefined
  const promise = new Promise<Float32Array>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (event: MessageEvent<LayoutWorkerOutput>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress?.(message.progress, message.phase)
      } else if (message.type === 'complete') {
        settled = true
        resolve(message.coordinates)
        worker.terminate()
      } else {
        settled = true
        reject(new Error(message.message))
        worker.terminate()
      }
    }
    worker.onerror = (event) => {
      settled = true
      reject(new Error(event.message || 'Layout worker failed.'))
      worker.terminate()
    }
  })
  const cancel = () => {
    if (settled) return
    settled = true
    worker.terminate()
    rejectPromise(new Error('Layout canceled.'))
  }
  // Copying also handles a subarray whose byte offset is not zero.
  const transferable = matrix.slice()
  worker.postMessage({ matrix: transferable, dimensions, config } satisfies LayoutWorkerInput, [transferable.buffer])
  return { promise, cancel }
}
