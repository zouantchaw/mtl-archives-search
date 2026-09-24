export const EXPLORER_SCHEMA_VERSION = 1

export type Issue = {
  level: 'error' | 'warning'
  code: string
  message: string
}

export type ArtifactRef = {
  path: string
  sha256: string
  bytes: number
}

export type ExplorerManifest = {
  schemaVersion: number
  generatedAt: string | null
  legacy: boolean
  modelId: string | null
  indexId: string | null
  embeddingDimension: number | null
  count: number
  seed: number | null
  projection: {
    algorithm: 'umap' | 'legacy-published'
    /** Distance used to build the high-dimensional neighborhood graph. */
    metric?: 'euclidean' | 'cosine'
    nNeighbors: number | null
    minDist: number | null
    spread: number | null
    nComponents: 2
  }
  artifacts: {
    points: ArtifactRef
    ids: ArtifactRef
    embeddings: ArtifactRef | null
  }
}

export type SnapshotPoint = {
  id: string
  x: number
  y: number
  name: string | null
  date: string | null
  imageUrl: string | null
  caption: string | null
  /** Optional public metadata retained for the explorer details panel. */
  cote?: string | null
  credits?: string | null
  externalUrl?: string | null
  captionModel?: string | null
}

export type ValidationResult = {
  ok: boolean
  issues: Issue[]
}

export type EmbeddingHeader = {
  count: number
  dimensions: number
}

const SHA256_HEX = /^[a-f0-9]{64}$/

function issue(level: Issue['level'], code: string, message: string): Issue {
  return { level, code, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value == null) return null
  if (typeof value === 'string') return value
  return undefined
}

export function result(issues: Issue[]): ValidationResult {
  return { ok: issues.every((item) => item.level !== 'error'), issues }
}

export function parsePointRecords(input: unknown): { points: SnapshotPoint[]; issues: Issue[] } {
  if (!Array.isArray(input)) {
    return { points: [], issues: [issue('error', 'points-type', 'Point table must be an array.')] }
  }
  const points: SnapshotPoint[] = []
  const issues: Issue[] = []
  const seen = new Set<string>()
  input.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id.trim() === '') {
      issues.push(issue('error', 'point-id', `Point ${index} is missing a string id.`))
      return
    }
    const id = row.id.trim()
    if (seen.has(id)) {
      issues.push(issue('error', 'duplicate-id', `Duplicate point id ${id}.`))
      return
    }
    const x = row.x
    const y = row.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      issues.push(issue('error', 'non-finite-coordinate', `Point ${id} has a non-finite coordinate.`))
      return
    }
    const name = stringOrNull(row.name)
    const date = stringOrNull(row.date)
    const imageUrl = stringOrNull(row.imageUrl ?? row.image_url)
    const caption = stringOrNull(row.caption ?? row.vlm_caption)
    const cote = stringOrNull(row.cote)
    const credits = stringOrNull(row.credits)
    const externalUrl = stringOrNull(row.externalUrl ?? row.external_url)
    const captionModel = stringOrNull(row.captionModel ?? row.vlm_caption_model)
    if (name === undefined || date === undefined || imageUrl === undefined || caption === undefined || cote === undefined || credits === undefined || externalUrl === undefined || captionModel === undefined) {
      issues.push(issue('error', 'point-field', `Point ${id} has a field that is not a string or null.`))
      return
    }
    seen.add(id)
    points.push({ id, x, y, name, date, imageUrl, caption, cote, credits, externalUrl, captionModel })
  })
  return { points, issues }
}

export function parseIdList(input: unknown): { ids: string[]; issues: Issue[] } {
  if (!Array.isArray(input)) {
    return { ids: [], issues: [issue('error', 'ids-type', 'ID list must be an array.')] }
  }
  const ids: string[] = []
  const issues: Issue[] = []
  const seen = new Set<string>()
  input.forEach((value, index) => {
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push(issue('error', 'id-value', `ID ${index} is not a string.`))
      return
    }
    const id = value.trim()
    if (seen.has(id)) {
      issues.push(issue('error', 'duplicate-id', `Duplicate embedding id ${id}.`))
      return
    }
    seen.add(id)
    ids.push(id)
  })
  return { ids, issues }
}

export function readEmbeddingHeader(bytes: Uint8Array): EmbeddingHeader | null {
  if (bytes.byteLength < 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)
  const dimensions = view.getUint32(4, true)
  if (!Number.isInteger(count) || !Number.isInteger(dimensions) || count < 0 || dimensions <= 0) return null
  return { count, dimensions }
}

export function expectedEmbeddingBytes(count: number, dimensions: number): number {
  return 8 + count * dimensions * 4
}

export function validateEmbeddingBuffer(bytes: Uint8Array, count: number, dimensions: number): Issue[] {
  const header = readEmbeddingHeader(bytes)
  const issues: Issue[] = []
  if (!header) {
    issues.push(issue('error', 'header', 'Embedding file is missing an 8-byte little-endian header.'))
    return issues
  }
  if (header.count !== count) {
    issues.push(issue('error', 'header-count', `Embedding header count is ${header.count}; ID list length is ${count}.`))
  }
  if (header.dimensions !== dimensions) {
    issues.push(issue('error', 'header-dimension', `Embedding header dimension is ${header.dimensions}; expected ${dimensions}.`))
  }
  const expected = expectedEmbeddingBytes(count, dimensions)
  if (bytes.byteLength !== expected) {
    issues.push(issue('error', 'byte-length', `Embedding file is ${bytes.byteLength} bytes; expected ${expected}.`))
  }
  return issues
}

function requireNullableString(value: unknown, code: string, label: string, issues: Issue[]): string | null | undefined {
  if (value == null) return null
  if (typeof value === 'string') return value
  issues.push(issue('error', code, `${label} must be a string or null.`))
  return undefined
}

export function parseManifest(input: unknown): { manifest: ExplorerManifest | null; issues: Issue[] } {
  const issues: Issue[] = []
  if (!isRecord(input)) {
    return { manifest: null, issues: [issue('error', 'manifest-type', 'Manifest must be an object.')] }
  }
  if (input.schemaVersion !== EXPLORER_SCHEMA_VERSION) {
    issues.push(issue('error', 'schema-version', `Unsupported schema version ${String(input.schemaVersion)}.`))
  }
  if (typeof input.legacy !== 'boolean') {
    issues.push(issue('error', 'legacy-flag', 'Manifest legacy flag must be boolean.'))
  }
  const legacy = input.legacy === true
  const modelId = requireNullableString(input.modelId, 'model-type', 'modelId', issues)
  const indexId = requireNullableString(input.indexId, 'index-type', 'indexId', issues)
  if (!('modelId' in input)) issues.push(issue('error', 'model-missing', 'modelId is missing. Unknown models stay null; they are not inferred.'))
  if (!('indexId' in input)) issues.push(issue('error', 'index-missing', 'indexId is missing. Unknown indexes stay null; they are not inferred.'))
  let generatedAt: string | null | undefined
  if (!('generatedAt' in input)) {
    issues.push(issue('error', 'generated-at', 'generatedAt is missing.'))
  } else if (input.generatedAt == null) {
    generatedAt = null
    if (!legacy) issues.push(issue('error', 'generated-at', 'A non-legacy manifest needs an ISO generation time.'))
  } else if (typeof input.generatedAt === 'string' && !Number.isNaN(Date.parse(input.generatedAt))) {
    generatedAt = input.generatedAt
  } else {
    issues.push(issue('error', 'generated-at', 'generatedAt must be an ISO time or null.'))
  }
  if (typeof input.count !== 'number' || !Number.isInteger(input.count) || input.count < 0) {
    issues.push(issue('error', 'count', 'count must be a non-negative integer.'))
  }
  let embeddingDimension: number | null | undefined
  if (!('embeddingDimension' in input)) {
    issues.push(issue('error', 'dimension', 'embeddingDimension is missing.'))
  } else if (input.embeddingDimension == null) {
    embeddingDimension = null
  } else if (typeof input.embeddingDimension === 'number' && Number.isInteger(input.embeddingDimension) && input.embeddingDimension > 0) {
    embeddingDimension = input.embeddingDimension
  } else {
    issues.push(issue('error', 'dimension', 'embeddingDimension must be a positive integer or null.'))
  }
  let seed: number | null | undefined
  if (!('seed' in input)) {
    issues.push(issue('error', 'seed', 'seed is missing. Use null when the projection was not seeded.'))
  } else if (input.seed == null) {
    seed = null
  } else if (typeof input.seed === 'number' && Number.isFinite(input.seed)) {
    seed = input.seed
  } else {
    issues.push(issue('error', 'seed', 'seed must be a finite number or null.'))
  }
  const projection = isRecord(input.projection) ? input.projection : null
  if (!projection) {
    issues.push(issue('error', 'projection', 'projection settings are missing.'))
  } else if (projection.algorithm !== 'umap' && projection.algorithm !== 'legacy-published') {
    issues.push(issue('error', 'projection-algorithm', 'projection.algorithm is not a known value.'))
  } else if (projection.nComponents !== 2) {
    issues.push(issue('error', 'projection-components', 'projection.nComponents must be 2.'))
  } else if (projection.metric != null && projection.metric !== 'euclidean' && projection.metric !== 'cosine') {
    issues.push(issue('error', 'projection-metric', 'projection.metric must be euclidean or cosine.'))
  }
  const artifacts = isRecord(input.artifacts) ? input.artifacts : null
  const points = artifacts ? parseArtifactRef(artifacts.points, 'points', issues) : null
  const ids = artifacts ? parseArtifactRef(artifacts.ids, 'ids', issues) : null
  const embeddings = artifacts && artifacts.embeddings != null ? parseArtifactRef(artifacts.embeddings, 'embeddings', issues) : null
  if (!artifacts) issues.push(issue('error', 'artifacts', 'artifacts are missing.'))
  if (issues.some((item) => item.level === 'error') || !points || !ids || modelId === undefined || indexId === undefined || generatedAt === undefined || embeddingDimension === undefined || seed === undefined || !projection) {
    return { manifest: null, issues }
  }
  return {
    manifest: {
      schemaVersion: EXPLORER_SCHEMA_VERSION,
      generatedAt,
      legacy,
      modelId,
      indexId,
      embeddingDimension,
      count: input.count as number,
      seed,
      projection: {
        algorithm: projection.algorithm as 'umap' | 'legacy-published',
        metric: projection.metric === 'cosine' || projection.metric === 'euclidean' ? projection.metric : undefined,
        nNeighbors: typeof projection.nNeighbors === 'number' ? projection.nNeighbors : null,
        minDist: typeof projection.minDist === 'number' ? projection.minDist : null,
        spread: typeof projection.spread === 'number' ? projection.spread : null,
        nComponents: 2,
      },
      artifacts: { points, ids, embeddings },
    },
    issues,
  }
}

function parseArtifactRef(input: unknown, label: string, issues: Issue[]): ArtifactRef | null {
  if (!isRecord(input) || typeof input.path !== 'string' || typeof input.sha256 !== 'string' || typeof input.bytes !== 'number') {
    issues.push(issue('error', 'artifact-ref', `${label} artifact reference is incomplete.`))
    return null
  }
  if (!SHA256_HEX.test(input.sha256)) {
    issues.push(issue('error', 'checksum', `${label} sha256 must be 64 lowercase hex characters.`))
    return null
  }
  if (!Number.isInteger(input.bytes) || input.bytes < 0) {
    issues.push(issue('error', 'artifact-bytes', `${label} byte length must be a non-negative integer.`))
    return null
  }
  return { path: input.path, sha256: input.sha256, bytes: input.bytes }
}

export function sameIdOrder(points: SnapshotPoint[], ids: string[]): Issue[] {
  const issues: Issue[] = []
  if (points.length !== ids.length) {
    issues.push(issue('error', 'id-order', `Point count ${points.length} does not match ID count ${ids.length}.`))
    return issues
  }
  for (let index = 0; index < ids.length; index += 1) {
    if (points[index]?.id !== ids[index]) {
      issues.push(issue('error', 'id-order', `ID order differs at ${index}: point ${points[index]?.id ?? 'missing'} vs embedding ${ids[index]}.`))
      return issues
    }
  }
  return issues
}

export function validatePublishedSet(args: {
  manifest: ExplorerManifest
  points: SnapshotPoint[]
  ids: string[]
  embeddings?: Uint8Array | null
}): ValidationResult {
  const issues: Issue[] = []
  if (args.manifest.legacy) issues.push(issue('error', 'legacy-manifest', 'A published version folder cannot use the legacy adapter flag.'))
  if (args.manifest.count !== args.points.length || args.manifest.count !== args.ids.length) {
    issues.push(issue('error', 'count', `Manifest count ${args.manifest.count} does not match ${args.points.length} points and ${args.ids.length} ids.`))
  }
  issues.push(...sameIdOrder(args.points, args.ids))
  if (args.manifest.embeddingDimension == null) {
    issues.push(issue('error', 'dimension', 'A published embedding manifest needs an embedding dimension.'))
  }
  if (args.embeddings && args.manifest.embeddingDimension != null) {
    issues.push(...validateEmbeddingBuffer(args.embeddings, args.ids.length, args.manifest.embeddingDimension))
  }
  if (!args.embeddings) issues.push(issue('error', 'embeddings-missing', 'Published manifest is missing the embedding bytes.'))
  return result(issues)
}

export function validateLegacySet(args: {
  points: SnapshotPoint[]
  ids: string[]
  embeddings?: Uint8Array | null
}): ValidationResult {
  const issues: Issue[] = []
  const pointIds = new Set(args.points.map((point) => point.id))
  const embeddingIds = new Set(args.ids)
  if (args.points.length !== args.ids.length) {
    issues.push(issue('warning', 'count-mismatch', `Legacy point count ${args.points.length} differs from embedding ID count ${args.ids.length}.`))
  }
  let pointsWithoutEmbedding = 0
  let embeddingsWithoutPoint = 0
  for (const id of pointIds) if (!embeddingIds.has(id)) pointsWithoutEmbedding += 1
  for (const id of embeddingIds) if (!pointIds.has(id)) embeddingsWithoutPoint += 1
  if (pointsWithoutEmbedding) {
    issues.push(issue('warning', 'point-without-embedding', `${pointsWithoutEmbedding} points have no embedding row.`))
  }
  if (embeddingsWithoutPoint) {
    issues.push(issue('warning', 'embedding-without-point', `${embeddingsWithoutPoint} embedding ids have no map position and must stay unprojected.`))
  }
  if (args.embeddings) {
    const header = readEmbeddingHeader(args.embeddings)
    if (!header) {
      issues.push(issue('error', 'header', 'Legacy embedding header could not be read.'))
    } else if (header.count !== args.ids.length) {
      issues.push(issue('error', 'header-count', `Legacy embedding header count is ${header.count}; ID list length is ${args.ids.length}.`))
    } else if (args.embeddings.byteLength !== expectedEmbeddingBytes(header.count, header.dimensions)) {
      issues.push(issue('error', 'byte-length', 'Legacy embedding byte length does not match its header.'))
    }
  }
  return result(issues)
}

export function modelCompatibility(manifestModel: string | null, expectedModel: string | null): Issue[] {
  if (!expectedModel) return []
  if (manifestModel == null) {
    return [issue('error', 'model-unknown', 'Manifest model is unknown. Matching dimensions are not a model identity.')]
  }
  if (manifestModel !== expectedModel) {
    return [issue('error', 'model-mismatch', `Manifest model ${manifestModel} is not ${expectedModel}.`)]
  }
  return []
}

export function verifyChecksum(ref: ArtifactRef, actualHex: string, actualBytes: number): Issue[] {
  const issues: Issue[] = []
  if (ref.sha256 !== actualHex) issues.push(issue('error', 'checksum', `Checksum mismatch for ${ref.path}.`))
  if (ref.bytes !== actualBytes) issues.push(issue('error', 'artifact-bytes', `Byte length mismatch for ${ref.path}.`))
  return issues
}

export function emptySha256(): string {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
}
