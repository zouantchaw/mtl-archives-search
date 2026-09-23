import {
  parseIdList,
  parseManifest,
  parsePointRecords,
  readEmbeddingHeader,
  sameIdOrder,
  validateLegacySet,
  expectedEmbeddingBytes,
  type Issue,
} from '../../../../packages/scripts/src/explorer/artifact-contract.ts'
import type { SnapshotPoint } from './projection'

export type LoadedSnapshot = {
  source: 'manifest' | 'legacy'
  points: SnapshotPoint[]
  embeddingIds: string[] | null
  vectorHeader: { count: number; dimensions: number } | null
  vectorBytes: number | null
  vectorUrl: string | null
  modelId: string | null
  indexId: string | null
  generatedAt: string | null
  legacyLayout: boolean
  issues: Issue[]
}

function artifactUrl(root: string, relativePath: string): string {
  const url = new URL(relativePath, `${root}/`)
  const base = new URL(`${root}/`)
  if (url.origin !== base.origin) throw new Error('artifact-origin')
  return url.toString()
}

function toPoint(point: {
  id: string
  x: number
  y: number
  name: string | null
  date: string | null
  imageUrl: string | null
  caption: string | null
}): SnapshotPoint {
  return point
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

async function loadManifest(root: string, payload: unknown, signal: AbortSignal, fetchImpl: typeof fetch): Promise<LoadedSnapshot> {
  const parsed = parseManifest(payload)
  if (!parsed.manifest) {
    return emptySnapshot('manifest', parsed.issues)
  }
  const manifest = parsed.manifest
  const pointsResponse = await fetchImpl(artifactUrl(root, manifest.artifacts.points.path), { signal })
  const idsResponse = await fetchImpl(artifactUrl(root, manifest.artifacts.ids.path), { signal })
  if (!pointsResponse.ok || !idsResponse.ok) {
    return emptySnapshot('manifest', [...parsed.issues, { level: 'error', code: 'artifact-fetch', message: 'Manifest artifacts could not be fetched.' }])
  }
  const points = parsePointRecords(await pointsResponse.json())
  const ids = parseIdList(await idsResponse.json())
  const issues = [...parsed.issues, ...points.issues, ...ids.issues, ...sameIdOrder(points.points, ids.ids)]
  if (manifest.count !== points.points.length) {
    issues.push({ level: 'error', code: 'count', message: `Manifest count ${manifest.count} does not match ${points.points.length} readable points.` })
  }
  const vectorUrl = manifest.artifacts.embeddings ? artifactUrl(root, manifest.artifacts.embeddings.path) : null
  const header = vectorUrl ? await readHeader(vectorUrl, signal, fetchImpl) : null
  if (header && manifest.embeddingDimension != null && header.dimensions !== manifest.embeddingDimension) {
    issues.push({ level: 'error', code: 'header-dimension', message: 'Embedding header dimension does not match the manifest.' })
  }
  if (header && header.count !== ids.ids.length) {
    issues.push({ level: 'error', code: 'header-count', message: 'Embedding header count does not match the ID list.' })
  }
  return {
    source: 'manifest',
    points: points.points.map(toPoint),
    embeddingIds: ids.ids,
    vectorHeader: header,
    vectorBytes: header ? expectedEmbeddingBytes(header.count, header.dimensions) : null,
    vectorUrl,
    modelId: manifest.modelId,
    indexId: manifest.indexId,
    generatedAt: manifest.generatedAt,
    legacyLayout: false,
    issues,
  }
}

function emptySnapshot(source: LoadedSnapshot['source'], issues: Issue[]): LoadedSnapshot {
  return {
    source,
    points: [],
    embeddingIds: null,
    vectorHeader: null,
    vectorBytes: null,
    vectorUrl: null,
    modelId: null,
    indexId: null,
    generatedAt: null,
    legacyLayout: source === 'legacy',
    issues,
  }
}

async function loadLegacy(root: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<LoadedSnapshot> {
  const pointsResponse = await fetchImpl(`${root}/embeddings_2d.json`, { signal })
  if (!pointsResponse.ok) throw new Error('snapshot-points')
  const idsResponse = await fetchImpl(`${root}/embeddings_ids.json`, { signal })
  const points = parsePointRecords(await pointsResponse.json())
  const issues = [...points.issues]
  let ids: string[] | null = null
  if (idsResponse.ok) {
    const parsedIds = parseIdList(await idsResponse.json())
    ids = parsedIds.ids
    issues.push(...parsedIds.issues, ...validateLegacySet({ points: points.points, ids: parsedIds.ids }).issues)
  } else {
    issues.push({ level: 'warning', code: 'ids-missing', message: 'Legacy embedding ID list was not available.' })
  }
  const vectorUrl = `${root}/embeddings_512d.bin`
  let header: { count: number; dimensions: number } | null = null
  try {
    header = await readHeader(vectorUrl, signal, fetchImpl)
  } catch (error) {
    if (signal.aborted) throw error
  }
  if (header && ids && header.count !== ids.length) {
    issues.push({ level: 'error', code: 'header-count', message: 'Legacy embedding header count does not match the ID list.' })
  }
  return {
    source: 'legacy',
    points: points.points.map(toPoint),
    embeddingIds: ids,
    vectorHeader: header,
    vectorBytes: header ? expectedEmbeddingBytes(header.count, header.dimensions) : null,
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
  const manifestIssues: Issue[] = []
  try {
    const response = await fetchImpl(`${root}/manifest.json`, { signal })
    if (response.ok) {
      const loaded = await loadManifest(root, await response.json(), signal, fetchImpl)
      const failed = loaded.issues.some((item) => item.level === 'error') || loaded.points.length === 0
      if (!failed) return loaded
      manifestIssues.push(...loaded.issues)
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  try {
    const legacy = await loadLegacy(root, signal, fetchImpl)
    return { ...legacy, issues: [...manifestIssues, ...legacy.issues] }
  } catch (error) {
    if (signal.aborted) throw error
    if (manifestIssues.length > 0) {
      const failed = emptySnapshot('manifest', manifestIssues)
      if (failed.points.length === 0) throw error
    }
    throw error
  }
}

export async function loadEmbeddingMatrix(url: string, idCount: number, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<{ matrix: Float32Array; dimensions: number }> {
  const response = await fetchImpl(url, { signal })
  if (!response.ok) throw new Error('embeddings')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const header = readEmbeddingHeader(bytes)
  if (!header || header.count !== idCount || bytes.byteLength !== expectedEmbeddingBytes(header.count, header.dimensions)) {
    throw new Error('embeddings-mismatch')
  }
  const matrix = new Float32Array(bytes.buffer, bytes.byteOffset + 8, header.count * header.dimensions)
  return { matrix, dimensions: header.dimensions }
}
