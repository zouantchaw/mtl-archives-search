import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { UMAP } from 'umap-js'
import {
  EXPLORER_SCHEMA_VERSION,
  modelCompatibility,
  parseIdList,
  parsePointRecords,
  type ExplorerManifest,
  type SnapshotPoint,
  validatePublishedSet,
  expectedEmbeddingBytes,
} from './artifact-contract.js'
import { mulberry32 } from './seed.js'

export type VectorRecord = {
  name?: string | null
  date?: string | null
  date_value?: string | null
  dateValue?: string | null
  image_url?: string | null
  imageUrl?: string | null
  metadata_filename?: string | null
  metadataFilename?: string | null
  image_filename?: string | null
  resolved_image_filename?: string | null
  vlm_caption?: string | null
  vlmCaption?: string | null
  vlm_caption_model?: string | null
  captionModel?: string | null
  caption?: string | null
  cote?: string | null
  credits?: string | null
  external_url?: string | null
  externalUrl?: string | null
  portal_title?: string | null
}

export type VectorFile = {
  ids: string[]
  vectors: number[][]
  modelId?: string | null
  indexId?: string | null
  records?: Record<string, VectorRecord>
}

export type ExportRequest = {
  input: VectorFile
  seed: number
  modelId: string | null
  indexId: string | null
  nNeighbors: number
  minDist: number
  spread: number
  generatedAt: string
}

export type BuiltVersion = {
  manifest: ExplorerManifest
  files: {
    'points.json': Uint8Array
    'ids.json': Uint8Array
    'embeddings.bin': Uint8Array
  }
}

export const FILE_WRITE_ORDER = ['points.json', 'ids.json', 'embeddings.bin', 'manifest.json'] as const

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function encodeEmbeddings(vectors: number[][]): Uint8Array {
  const dimensions = vectors[0]?.length ?? 0
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error('Embeddings need a positive dimension.')
  const bytes = new Uint8Array(expectedEmbeddingBytes(vectors.length, dimensions))
  const view = new DataView(bytes.buffer)
  view.setUint32(0, vectors.length, true)
  view.setUint32(4, dimensions, true)
  let offset = 8
  for (const vector of vectors) {
    if (vector.length !== dimensions) throw new Error('Embedding dimensions are mixed. Refusing to project them together.')
    for (const value of vector) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Embedding value is not finite.')
      view.setFloat32(offset, value, true)
      offset += 4
    }
  }
  return bytes
}

/** Normalize CLIP rows before cosine UMAP and snapshot similarity use. */
export function normalizeVectors(vectors: number[][]): number[][] {
  return vectors.map((vector, index) => {
    let squaredNorm = 0
    for (const value of vector) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Embedding ${index} contains a non-finite value.`)
      }
      squaredNorm += value * value
    }
    const norm = Math.sqrt(squaredNorm)
    if (!(norm > 0)) throw new Error(`Embedding ${index} has zero length.`)
    return vector.map((value) => value / norm)
  })
}

function cosineDistance(left: number[], right: number[]): number {
  let dot = 0
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index]
  // UMAP expects a distance. Clamp rounding noise so the graph is valid.
  return Math.max(0, Math.min(2, 1 - dot))
}

export function normalizePlane(coords: number[][]): Array<[number, number]> {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of coords) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error('Projection returned a non-finite coordinate.')
    }
    minX = Math.min(minX, point[0])
    maxX = Math.max(maxX, point[0])
    minY = Math.min(minY, point[1])
    maxY = Math.max(maxY, point[1])
  }
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  return coords.map((point) => [(point[0] - minX) / spanX, (point[1] - minY) / spanY])
}

export function projectVectors(
  vectors: number[][],
  options: { seed: number; nNeighbors: number; minDist: number; spread: number },
): Array<[number, number]> {
  if (vectors.length < 3) throw new Error('Projection needs at least 3 vectors.')
  const normalizedVectors = normalizeVectors(vectors)
  const neighbors = Math.max(2, Math.min(options.nNeighbors, vectors.length - 1))
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: neighbors,
    minDist: options.minDist,
    spread: options.spread,
    distanceFn: cosineDistance,
    random: mulberry32(options.seed),
  })
  return normalizePlane(umap.fit(normalizedVectors))
}

export function buildVersion(request: ExportRequest): BuiltVersion {
  const ids = request.input.ids
  const vectors = request.input.vectors
  if (!Array.isArray(ids) || !Array.isArray(vectors) || ids.length !== vectors.length) {
    throw new Error('ID list and vector list must be arrays of equal length.')
  }
  const parsedIds = parseIdList(ids)
  if (parsedIds.issues.some((item) => item.level === 'error')) {
    throw new Error(parsedIds.issues.find((item) => item.level === 'error')?.message ?? 'Invalid ids')
  }
  // Validate all cheap invariants before invoking the O(n log n) projection.
  // This keeps malformed D1/vector responses from spending minutes in UMAP.
  if (vectors.length < 3) throw new Error('Projection needs at least 3 vectors.')
  const dimension = vectors[0]?.length ?? 0
  if (!Number.isInteger(dimension) || dimension <= 0) throw new Error('Embeddings need a positive dimension.')
  for (const [index, vector] of vectors.entries()) {
    if (!Array.isArray(vector) || vector.length !== dimension) {
      throw new Error(`Embedding dimensions are mixed at row ${index}. Refusing to project them together.`)
    }
    for (const value of vector) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Embedding ${index} contains a non-finite value.`)
    }
  }
  const normalizedVectors = normalizeVectors(vectors)
  const plane = projectVectors(normalizedVectors, request)
  const points: SnapshotPoint[] = ids.map((id, index) => {
    const record = request.input.records?.[id]
      ?? request.input.records?.[id.endsWith('.json') ? id.slice(0, -5) : `${id}.json`]
      ?? {}
    return {
      id,
      x: plane[index][0],
      y: plane[index][1],
      name: record.name ?? record.portal_title ?? null,
      date: record.date ?? record.dateValue ?? record.date_value ?? null,
      imageUrl: record.imageUrl ?? record.image_url ?? null,
      caption: record.caption ?? record.vlmCaption ?? record.vlm_caption ?? null,
      cote: record.cote ?? null,
      credits: record.credits ?? null,
      externalUrl: record.externalUrl ?? record.external_url ?? null,
      captionModel: record.captionModel ?? record.vlm_caption_model ?? null,
    }
  })
  const pointsBytes = new TextEncoder().encode(JSON.stringify(points))
  const idsBytes = new TextEncoder().encode(JSON.stringify(ids))
  const embeddings = encodeEmbeddings(normalizedVectors)
  const neighbors = Math.max(2, Math.min(request.nNeighbors, vectors.length - 1))
  const manifest: ExplorerManifest = {
    schemaVersion: EXPLORER_SCHEMA_VERSION,
    generatedAt: request.generatedAt,
    legacy: false,
    modelId: request.modelId,
    indexId: request.indexId,
    embeddingDimension: dimension,
    count: ids.length,
    seed: request.seed,
    projection: {
      algorithm: 'umap',
      metric: 'cosine',
      nNeighbors: neighbors,
      minDist: request.minDist,
      spread: request.spread,
      nComponents: 2,
    },
    artifacts: {
      points: { path: 'points.json', sha256: sha256(pointsBytes), bytes: pointsBytes.byteLength },
      ids: { path: 'ids.json', sha256: sha256(idsBytes), bytes: idsBytes.byteLength },
      embeddings: { path: 'embeddings.bin', sha256: sha256(embeddings), bytes: embeddings.byteLength },
    },
  }
  const parsedPoints = parsePointRecords(JSON.parse(new TextDecoder().decode(pointsBytes)))
  const validation = validatePublishedSet({
    manifest,
    points: parsedPoints.points,
    ids,
    embeddings,
  })
  if (!validation.ok || parsedPoints.issues.some((item) => item.level === 'error')) {
    throw new Error(validation.issues.map((item) => item.message).join('; ') || 'Projection failed validation.')
  }
  const identity = modelCompatibility(manifest.modelId, request.modelId)
  if (identity.some((item) => item.level === 'error')) throw new Error(identity[0]?.message ?? 'Model identity check failed.')
  return {
    manifest,
    files: {
      'points.json': pointsBytes,
      'ids.json': idsBytes,
      'embeddings.bin': embeddings,
    },
  }
}

export function commitVersion(built: BuiltVersion, emit: (name: string, bytes: Uint8Array) => void): void {
  emit('points.json', built.files['points.json'])
  emit('ids.json', built.files['ids.json'])
  emit('embeddings.bin', built.files['embeddings.bin'])
  emit('manifest.json', new TextEncoder().encode(JSON.stringify(built.manifest)))
}

export function versionFolderName(generatedAt: string): string {
  const parsed = new Date(generatedAt)
  if (Number.isNaN(parsed.valueOf())) throw new Error(`generatedAt is not a valid ISO time: ${generatedAt}`)
  const stamp = parsed.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return path.join(`v${EXPLORER_SCHEMA_VERSION}`, stamp)
}

export function writeVersion(outRoot: string, generatedAt: string, built: BuiltVersion): string {
  const folder = path.join(outRoot, versionFolderName(generatedAt))
  mkdirSync(path.dirname(folder), { recursive: true })
  // Build in a sibling temp directory and publish with one rename. A version
  // folder is immutable: rerunning the same generatedAt must fail rather than
  // silently replacing a snapshot that may already be referenced by R2.
  const temporary = mkdtempSync(`${folder}.tmp-`)
  try {
    commitVersion(built, (name, bytes) => writeFileSync(path.join(temporary, name), bytes, { flag: 'wx' }))
    renameSync(temporary, folder)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
  return folder
}

export function readVectorFile(filePath: string): VectorFile {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as VectorFile
  return parsed
}

type CliArgs = Record<string, string | boolean>

function parseCli(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next == null || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function numberArg(args: CliArgs, key: string, fallback: number): number {
  const value = args[key]
  if (typeof value !== 'string') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number.`)
  return parsed
}

function main(): void {
  const args = parseCli(process.argv.slice(2))
  if (typeof args.input !== 'string' || typeof args.out !== 'string') {
    console.error('Usage: export-projection --input vectors.json --out directory [--dry-run] [--seed 42] [--model-id ID] [--index-id ID]')
    process.exit(1)
  }
  const generatedAt = new Date().toISOString()
  const modelId = typeof args['model-id'] === 'string' ? args['model-id'] : null
  const indexId = typeof args['index-id'] === 'string' ? args['index-id'] : null
  const built = buildVersion({
    input: readVectorFile(args.input),
    seed: numberArg(args, 'seed', 42),
    modelId,
    indexId,
    nNeighbors: numberArg(args, 'n-neighbors', 15),
    minDist: numberArg(args, 'min-dist', 0.1),
    spread: numberArg(args, 'spread', 1),
    generatedAt,
  })
  if (modelId == null) console.error('modelId is unknown. The manifest keeps null rather than inventing an identity.')
  if (indexId == null) console.error('indexId is unknown. The manifest keeps null rather than inventing an index.')
  const folder = path.join(args.out, versionFolderName(generatedAt))
  if (args['dry-run'] === true) {
    console.log(JSON.stringify({ dryRun: true, folder, manifest: built.manifest }, null, 2))
    return
  }
  const written = writeVersion(args.out, generatedAt, built)
  console.log(written)
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) main()
