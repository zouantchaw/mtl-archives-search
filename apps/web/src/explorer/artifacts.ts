import {
  expectedEmbeddingBytes,
  parseIdList,
  parseManifest,
  parsePointRecords,
  readEmbeddingHeader,
  sameIdOrder,
  validateLegacySet,
  verifyChecksum,
  type ArtifactRef,
  type Issue,
} from '../../../../packages/scripts/src/explorer/artifact-contract.ts'
import type { SnapshotPoint } from './projection'

export class SnapshotIntegrityError extends Error {
  readonly issues: Issue[]

  constructor(issues: Issue[]) {
    super('snapshot-integrity')
    this.name = 'SnapshotIntegrityError'
    this.issues = issues
  }
}

export class SnapshotUnavailableError extends Error {
  constructor() {
    super('snapshot-unavailable')
    this.name = 'SnapshotUnavailableError'
  }
}

export type LoadedSnapshot = {
  source: 'manifest' | 'legacy'
  points: SnapshotPoint[]
  embeddingIds: string[] | null
  vectorHeader: { count: number; dimensions: number } | null
  vectorBytes: number | null
  vectorSha256: string | null
  vectorUrl: string | null
  modelId: string | null
  indexId: string | null
  generatedAt: string | null
  legacyLayout: boolean
  issues: Issue[]
}

const verifiedMatrices = new Map<string, { matrix: Float32Array; dimensions: number }>()

export function artifactUrl(root: string, relativePath: string): string {
  const absoluteRoot = /^https?:\/\//i.test(root)
  const base = absoluteRoot
    ? new URL(`${root.replace(/\/$/, '')}/`)
    : new URL(`${root.startsWith('/') ? root : `/${root}`}`.replace(/\/?$/, '/'), 'http://explorer.local')
  const url = new URL(relativePath, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new SnapshotIntegrityError([{ level: 'error', code: 'artifact-origin', message: 'Artifact URL leaves the snapshot prefix.' }])
  }
  if (!absoluteRoot) return `${url.pathname}${url.search}`
  return url.toString()
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readVerifiedBytes(url: string, ref: ArtifactRef, signal: AbortSignal, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const response = await fetchImpl(url, { signal })
  if (!response.ok) {
    throw new SnapshotIntegrityError([{ level: 'error', code: 'artifact-fetch', message: `Could not fetch ${ref.path}.` }])
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const issues = verifyChecksum(ref, await sha256Hex(bytes), bytes.byteLength)
  if (issues.length > 0) throw new SnapshotIntegrityError(issues)
  return bytes
}

function toPoint(point: SnapshotPoint): SnapshotPoint {
  return point
}

async function loadVerifiedManifest(root: string, payload: unknown, signal: AbortSignal, fetchImpl: typeof fetch): Promise<LoadedSnapshot> {
  const parsed = parseManifest(payload)
  if (!parsed.manifest || parsed.issues.some((item) => item.level === 'error')) {
    throw new SnapshotIntegrityError(parsed.issues.length > 0 ? parsed.issues : [{ level: 'error', code: 'manifest-type', message: 'Manifest could not be read.' }])
  }
  const manifest = parsed.manifest
  const pointsBytes = await readVerifiedBytes(artifactUrl(root, manifest.artifacts.points.path), manifest.artifacts.points, signal, fetchImpl)
  const idsBytes = await readVerifiedBytes(artifactUrl(root, manifest.artifacts.ids.path), manifest.artifacts.ids, signal, fetchImpl)
  let pointsJson: unknown
  let idsJson: unknown
  try {
    pointsJson = JSON.parse(new TextDecoder().decode(pointsBytes))
    idsJson = JSON.parse(new TextDecoder().decode(idsBytes))
  } catch {
    throw new SnapshotIntegrityError([{ level: 'error', code: 'artifact-json', message: 'A checksum-matched artifact was not valid JSON.' }])
  }
  const points = parsePointRecords(pointsJson)
  const ids = parseIdList(idsJson)
  const issues = [...points.issues, ...ids.issues, ...sameIdOrder(points.points, ids.ids)]
  if (manifest.count !== points.points.length) {
    issues.push({ level: 'error', code: 'count', message: `Manifest count ${manifest.count} does not match ${points.points.length} readable points.` })
  }
  if (issues.some((item) => item.level === 'error')) throw new SnapshotIntegrityError(issues)
  const embeddings = manifest.artifacts.embeddings
  return {
    source: 'manifest',
    points: points.points.map(toPoint),
    embeddingIds: ids.ids,
    vectorHeader: null,
    vectorBytes: embeddings?.bytes ?? null,
    vectorSha256: embeddings?.sha256 ?? null,
    vectorUrl: embeddings ? artifactUrl(root, embeddings.path) : null,
    modelId: manifest.modelId,
    indexId: manifest.indexId,
    generatedAt: manifest.generatedAt,
    legacyLayout: false,
    issues,
  }
}

async function readHeader(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<{ count: number; dimensions: number } | null> {
  const response = await fetchImpl(url, { signal, headers: { Range: 'bytes=0-7' } })
  if (!response.ok && response.status !== 206) return null
  const length = Number(response.headers.get('content-length') ?? '0')
  if (response.status === 200 && length > 32) {
    await response.body?.cancel()
    return null
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 32) return null
  return readEmbeddingHeader(bytes)
}

async function loadLegacy(root: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<LoadedSnapshot> {
  const pointsResponse = await fetchImpl(artifactUrl(root, 'embeddings_2d.json'), { signal })
  if (!pointsResponse.ok) throw new SnapshotUnavailableError()
  const idsResponse = await fetchImpl(artifactUrl(root, 'embeddings_ids.json'), { signal })
  const points = parsePointRecords(await pointsResponse.json())
  const issues = [...points.issues]
  if (points.issues.some((item) => item.level === 'error') && points.points.length === 0) {
    throw new SnapshotUnavailableError()
  }
  let ids: string[] | null = null
  if (idsResponse.ok) {
    const parsedIds = parseIdList(await idsResponse.json())
    ids = parsedIds.ids
    issues.push(...parsedIds.issues, ...validateLegacySet({ points: points.points, ids: parsedIds.ids }).issues)
  } else {
    issues.push({ level: 'warning', code: 'ids-missing', message: 'Legacy embedding ID list was not available.' })
  }
  const vectorUrl = artifactUrl(root, 'embeddings_512d.bin')
  let header: { count: number; dimensions: number } | null = null
  try {
    header = await readHeader(vectorUrl, signal, fetchImpl)
  } catch (error) {
    if (signal.aborted) throw error
  }
  if (header && ids && header.count !== ids.length) {
    issues.push({ level: 'warning', code: 'header-count', message: 'Legacy embedding header count does not match the ID list.' })
  }
  return {
    source: 'legacy',
    points: points.points.map(toPoint),
    embeddingIds: ids,
    vectorHeader: header,
    vectorBytes: header ? expectedEmbeddingBytes(header.count, header.dimensions) : null,
    vectorSha256: null,
    vectorUrl,
    modelId: null,
    indexId: null,
    generatedAt: null,
    legacyLayout: true,
    issues,
  }
}

export async function loadExplorerSnapshot(base: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<LoadedSnapshot> {
  const root = base.replace(/\/$/, '')
  let response: Response
  try {
    response = await fetchImpl(artifactUrl(root, 'manifest.json'), { signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new SnapshotUnavailableError()
  }
  if (response.status === 404) return loadLegacy(root, signal, fetchImpl)
  if (!response.ok) {
    throw new SnapshotIntegrityError([{ level: 'error', code: 'manifest-http', message: `Manifest request returned ${response.status}.` }])
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SnapshotIntegrityError([{ level: 'error', code: 'manifest-json', message: 'Manifest was not valid JSON.' }])
  }
  return loadVerifiedManifest(root, payload, signal, fetchImpl)
}

export async function loadEmbeddingMatrix(args: {
  url: string
  idCount: number
  sha256?: string | null
  byteLength?: number | null
  signal: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<{ matrix: Float32Array; dimensions: number }> {
  const fetchImpl = args.fetchImpl ?? fetch
  const cacheKey = `${args.url}\n${args.sha256 ?? 'legacy'}`
  const cached = verifiedMatrices.get(cacheKey)
  if (cached) return cached
  const response = await fetchImpl(args.url, { signal: args.signal })
  if (!response.ok) throw new SnapshotIntegrityError([{ level: 'error', code: 'artifact-fetch', message: 'Could not fetch embeddings.' }])
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (args.sha256) {
    const issues = verifyChecksum(
      { path: args.url, sha256: args.sha256, bytes: args.byteLength ?? bytes.byteLength },
      await sha256Hex(bytes),
      bytes.byteLength,
    )
    if (args.byteLength != null && args.byteLength !== bytes.byteLength) {
      issues.push({ level: 'error', code: 'artifact-bytes', message: 'Embedding byte length does not match the manifest.' })
    }
    if (issues.length > 0) throw new SnapshotIntegrityError(issues)
  }
  const header = readEmbeddingHeader(bytes)
  if (!header || header.count !== args.idCount || bytes.byteLength !== expectedEmbeddingBytes(header.count, header.dimensions)) {
    throw new SnapshotIntegrityError([{ level: 'error', code: 'embeddings-mismatch', message: 'Embedding file does not match the ID list.' }])
  }
  const matrix = new Float32Array(bytes.buffer, bytes.byteOffset + 8, header.count * header.dimensions)
  const verified = { matrix, dimensions: header.dimensions }
  verifiedMatrices.set(cacheKey, verified)
  return verified
}
