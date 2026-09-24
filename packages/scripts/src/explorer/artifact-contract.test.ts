import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  modelCompatibility,
  parseIdList,
  parseManifest,
  parsePointRecords,
  readEmbeddingHeader,
  validateEmbeddingBuffer,
  validateLegacySet,
  validatePublishedSet,
  expectedEmbeddingBytes,
} from './artifact-contract.js'
import { buildVersion, commitVersion, encodeEmbeddings, normalizeVectors, projectVectors, writeVersion } from './export-projection.js'
import { mulberry32 } from './seed.js'

function sampleManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-23T12:00:00.000Z',
    legacy: false,
    modelId: 'fixture-model',
    indexId: 'fixture-index',
    embeddingDimension: 4,
    count: 1,
    seed: 42,
    projection: { algorithm: 'umap', nNeighbors: 2, minDist: 0.1, spread: 1, nComponents: 2 },
    artifacts: {
      points: { path: 'points.json', sha256: 'a'.repeat(64), bytes: 1 },
      ids: { path: 'ids.json', sha256: 'b'.repeat(64), bytes: 1 },
      embeddings: { path: 'embeddings.bin', sha256: 'c'.repeat(64), bytes: 1 },
    },
    ...overrides,
  }
}

test('manifest rejects an unknown schema and does not invent a missing model', () => {
  const unsupported = parseManifest(sampleManifest({ schemaVersion: 2 }))
  assert.equal(unsupported.manifest, null)
  assert.equal(unsupported.issues.some((item) => item.code === 'schema-version'), true)

  const raw = sampleManifest()
  delete (raw as { modelId?: string }).modelId
  const parsed = parseManifest(raw)
  assert.equal(parsed.manifest, null)
  assert.equal(parsed.issues.some((item) => item.code === 'model-missing'), true)
})

test('malformed points and ids are rejected without replacement coordinates', () => {
  const points = parsePointRecords([
    { id: 'a', x: 0.2, y: 0.4, name: 'Rue', date: '1932', image_url: 'https://example.test/a.jpg' },
    { id: 'a', x: 0.3, y: 0.3 },
    { id: 'b', x: Number.NaN, y: 0.2 },
    { id: 'c', x: 0.1, y: Number.POSITIVE_INFINITY },
    { x: 0.5, y: 0.5 },
  ])
  assert.deepEqual(points.points.map((point) => point.id), ['a'])
  assert.equal(points.issues.some((item) => item.code === 'duplicate-id'), true)
  assert.equal(points.issues.some((item) => item.code === 'non-finite-coordinate'), true)
  assert.equal(JSON.stringify(points.points).includes('NaN'), false)

  const ids = parseIdList(['a', 'a', 12])
  assert.deepEqual(ids.ids, ['a'])
  assert.equal(ids.issues.length, 2)
})

test('embedding byte length and header must match the id list', () => {
  const bytes = encodeEmbeddings([[0.1, 0.2, 0.3, 0.4], [0.2, 0.1, 0.4, 0.3]])
  const header = readEmbeddingHeader(bytes)
  assert.deepEqual(header, { count: 2, dimensions: 4 })
  assert.deepEqual(validateEmbeddingBuffer(bytes, 2, 4), [])
  assert.equal(validateEmbeddingBuffer(bytes, 3, 4).some((item) => item.code === 'header-count'), true)
  assert.equal(bytes.byteLength, expectedEmbeddingBytes(2, 4))
  const truncated = bytes.slice(0, bytes.byteLength - 4)
  assert.equal(validateEmbeddingBuffer(truncated, 2, 4).some((item) => item.code === 'byte-length'), true)
})

test('published sets require identical id order and an explicit model', () => {
  const points = parsePointRecords([
    { id: 'a', x: 0, y: 1 },
    { id: 'b', x: 1, y: 0 },
  ]).points
  const embeddings = encodeEmbeddings([[1, 0, 0, 0], [0, 1, 0, 0]])
  const manifest = parseManifest(sampleManifest({
    count: 2,
    embeddingDimension: 4,
    artifacts: {
      points: { path: 'points.json', sha256: 'a'.repeat(64), bytes: 2 },
      ids: { path: 'ids.json', sha256: 'b'.repeat(64), bytes: 2 },
      embeddings: { path: 'embeddings.bin', sha256: 'c'.repeat(64), bytes: embeddings.byteLength },
    },
  })).manifest
  assert.ok(manifest)
  assert.equal(validatePublishedSet({ manifest, points, ids: ['b', 'a'], embeddings }).ok, false)
  assert.equal(validatePublishedSet({ manifest, points, ids: ['a', 'b'], embeddings }).ok, true)
  assert.equal(modelCompatibility(null, 'other-model')[0]?.code, 'model-unknown')
  assert.equal(modelCompatibility('fixture-model', 'other-model')[0]?.code, 'model-mismatch')
  assert.deepEqual(modelCompatibility('fixture-model', 'fixture-model'), [])
  assert.deepEqual(modelCompatibility(null, null), [])
})

test('legacy adapter flags embeddings that have no map position', () => {
  const points = parsePointRecords([{ id: 'on-map', x: 0.25, y: 0.75, name: null, date: null }]).points
  const embeddings = encodeEmbeddings([[0.5, 0.25, 0.25, 0]])
  const legacy = validateLegacySet({ points, ids: ['only-vector'], embeddings })
  assert.equal(legacy.ok, true)
  assert.equal(legacy.issues.some((item) => item.code === 'embedding-without-point'), true)
  assert.equal(legacy.issues.some((item) => item.code === 'point-without-embedding'), true)
})

test('seeded projection is repeatable', () => {
  const vectors = Array.from({ length: 8 }, (_, index) => [index, Math.sin(index), Math.cos(index), index % 2, 0.1 * index])
  const first = projectVectors(vectors, { seed: 7, nNeighbors: 3, minDist: 0.1, spread: 1 })
  const second = projectVectors(vectors, { seed: 7, nNeighbors: 3, minDist: 0.1, spread: 1 })
  assert.deepEqual(first, second)
  const other = projectVectors(vectors, { seed: 8, nNeighbors: 3, minDist: 0.1, spread: 1 })
  assert.notDeepEqual(first, other)
  const sequence = mulberry32(7)
  assert.equal(sequence(), mulberry32(7)())
})

test('CLIP vectors are normalized for cosine projection and stored normalized', () => {
  const normalized = normalizeVectors([[3, 4], [0, -2]])
  assert.deepEqual(normalized[0], [0.6, 0.8])
  assert.deepEqual(normalized[1], [0, -1])
  assert.throws(() => normalizeVectors([[0, 0]]), /zero length/)
  const built = buildVersion({
    input: { ids: ['a', 'b', 'c'], vectors: [[3, 0], [0, 4], [3, 4]] },
    seed: 42,
    modelId: null,
    indexId: 'mtl-archives-clip-canonical-20260912',
    nNeighbors: 2,
    minDist: 0.1,
    spread: 1,
    generatedAt: '2026-09-23T12:00:00.000Z',
  })
  assert.equal(built.manifest.projection.metric, 'cosine')
  const view = new DataView(built.files['embeddings.bin'].buffer)
  assert.ok(Math.abs(view.getFloat32(8, true) - 1) < 1e-6)
})

test('version folder writes the manifest last', () => {
  const input = {
    ids: ['a', 'b', 'c', 'd'],
    vectors: [
      [0, 0, 0, 1],
      [0, 1, 0, 0],
      [1, 0, 0, 0],
      [0.2, 0.4, 0.6, 0.8],
    ],
    records: { a: { name: 'Rue Saint-Antoine', date: 'Décennie 1920' } },
  }
  const built = buildVersion({
    input,
    seed: 42,
    modelId: null,
    indexId: null,
    nNeighbors: 2,
    minDist: 0.1,
    spread: 1,
    generatedAt: '2026-09-23T12:00:00.000Z',
  })
  assert.equal(built.manifest.modelId, null)
  assert.equal(built.manifest.indexId, null)
  assert.equal(built.manifest.legacy, false)
  const names: string[] = []
  commitVersion(built, (name) => names.push(name))
  assert.deepEqual(names, ['points.json', 'ids.json', 'embeddings.bin', 'manifest.json'])
  const dir = mkdtempSync(path.join(tmpdir(), 'explorer-artifacts-'))
  try {
    const folder = writeVersion(dir, '2026-09-23T12:00:00.000Z', built)
    const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'))
    assert.equal(manifest.count, 4)
    assert.equal(manifest.embeddingDimension, 4)
    assert.equal(manifest.seed, 42)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('version folders are immutable and cannot be overwritten', () => {
  const built = buildVersion({
    input: {
      ids: ['a', 'b', 'c'],
      vectors: [[1, 0], [0, 1], [1, 1]],
    },
    seed: 42,
    modelId: null,
    indexId: null,
    nNeighbors: 2,
    minDist: 0.1,
    spread: 1,
    generatedAt: '2026-09-23T12:00:00.000Z',
  })
  const dir = mkdtempSync(path.join(tmpdir(), 'explorer-immutable-'))
  try {
    writeVersion(dir, '2026-09-23T12:00:00.000Z', built)
    assert.throws(() => writeVersion(dir, '2026-09-23T12:00:00.000Z', built), /EEXIST|ENOTEMPTY|exists|file already exists/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('dry-run prints a manifest and does not create the output folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'explorer-dry-run-'))
  try {
    const input = path.join(dir, 'vectors.json')
    const out = path.join(dir, 'out')
    writeFileSync(input, JSON.stringify({
      ids: ['a', 'b', 'c', 'd'],
      vectors: [[0, 0, 0, 1], [0, 1, 0, 0], [1, 0, 0, 0], [0.2, 0.3, 0.4, 0.5]],
    }))
    const result = spawnSync(process.execPath, [
      '--import', 'tsx',
      'src/explorer/export-projection.ts',
      '--input', input,
      '--out', out,
      '--dry-run',
      '--seed', '3',
    ], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /"dryRun": true/)
    assert.equal(existsSync(out), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
