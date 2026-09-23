import { describe, expect, it } from 'vitest'
import { SnapshotIntegrityError, artifactUrl, loadExplorerSnapshot, sha256Hex } from './artifacts'

async function fixture() {
  const points = JSON.stringify([
    { id: 'a', x: 0.2, y: 0.4, name: 'Rue', date: '1932', imageUrl: null, caption: null },
    { id: 'b', x: 0.6, y: 0.1, name: null, date: null, imageUrl: null, caption: null },
  ])
  const ids = JSON.stringify(['a', 'b'])
  const pointsBytes = new TextEncoder().encode(points)
  const idsBytes = new TextEncoder().encode(ids)
  const manifest = {
    schemaVersion: 1,
    generatedAt: '2026-09-23T12:00:00.000Z',
    legacy: false,
    modelId: 'fixture-model',
    indexId: 'fixture-index',
    embeddingDimension: 4,
    count: 2,
    seed: 42,
    projection: { algorithm: 'umap', nNeighbors: 2, minDist: 0.1, spread: 1, nComponents: 2 },
    artifacts: {
      points: { path: 'points.json', sha256: await sha256Hex(pointsBytes), bytes: pointsBytes.byteLength },
      ids: { path: 'ids.json', sha256: await sha256Hex(idsBytes), bytes: idsBytes.byteLength },
      embeddings: null,
    },
  }
  return { points, ids, manifest }
}

function mockFetch(routes: Record<string, { status?: number; body: string }>) {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    const route = routes[url]
    if (!route) return new Response('missing', { status: 404 })
    return new Response(route.body, { status: route.status ?? 200 })
  }
  return { fetchImpl, calls }
}

const root = 'https://example.test/embeddings'

describe('snapshot loader', () => {
  it('accepts a manifest only after the artifact hashes match', async () => {
    const { points, ids, manifest } = await fixture()
    const { fetchImpl, calls } = mockFetch({
      [artifactUrl(root, 'manifest.json')]: { body: JSON.stringify(manifest) },
      [artifactUrl(root, 'points.json')]: { body: points },
      [artifactUrl(root, 'ids.json')]: { body: ids },
    })
    const loaded = await loadExplorerSnapshot(root, new AbortController().signal, fetchImpl)
    expect(loaded.source).toBe('manifest')
    expect(loaded.points.map((point) => point.id)).toEqual(['a', 'b'])
    expect(calls.some((url) => url.endsWith('embeddings_2d.json'))).toBe(false)
  })

  it('fails closed on a checksum mismatch, a byte mismatch, reordered ids, and a bad manifest', async () => {
    const { points, ids, manifest } = await fixture()
    const checksum = structuredClone(manifest)
    checksum.artifacts.points.sha256 = 'a'.repeat(64)
    await expect(loadExplorerSnapshot(root, new AbortController().signal, mockFetch({
      [artifactUrl(root, 'manifest.json')]: { body: JSON.stringify(checksum) },
      [artifactUrl(root, 'points.json')]: { body: points },
      [artifactUrl(root, 'ids.json')]: { body: ids },
    }).fetchImpl)).rejects.toBeInstanceOf(SnapshotIntegrityError)

    const wrongSize = structuredClone(manifest)
    wrongSize.artifacts.points.bytes = 1
    await expect(loadExplorerSnapshot(root, new AbortController().signal, mockFetch({
      [artifactUrl(root, 'manifest.json')]: { body: JSON.stringify(wrongSize) },
      [artifactUrl(root, 'points.json')]: { body: points },
      [artifactUrl(root, 'ids.json')]: { body: ids },
    }).fetchImpl)).rejects.toBeInstanceOf(SnapshotIntegrityError)

    const swappedIds = JSON.stringify(['b', 'a'])
    const swappedManifest = structuredClone(manifest)
    const swappedBytes = new TextEncoder().encode(swappedIds)
    swappedManifest.artifacts.ids = { path: 'ids.json', sha256: await sha256Hex(swappedBytes), bytes: swappedBytes.byteLength }
    const swapped = mockFetch({
      [artifactUrl(root, 'manifest.json')]: { body: JSON.stringify(swappedManifest) },
      [artifactUrl(root, 'points.json')]: { body: points },
      [artifactUrl(root, 'ids.json')]: { body: swappedIds },
      [artifactUrl(root, 'embeddings_2d.json')]: { body: '[]' },
    })
    await expect(loadExplorerSnapshot(root, new AbortController().signal, swapped.fetchImpl)).rejects.toBeInstanceOf(SnapshotIntegrityError)
    expect(swapped.calls.some((url) => url.endsWith('embeddings_2d.json'))).toBe(false)

    await expect(loadExplorerSnapshot(root, new AbortController().signal, mockFetch({
      [artifactUrl(root, 'manifest.json')]: { body: JSON.stringify({ schemaVersion: 2 }) },
      [artifactUrl(root, 'embeddings_2d.json')]: { body: points },
    }).fetchImpl)).rejects.toBeInstanceOf(SnapshotIntegrityError)
  })

  it('uses the legacy files only when the manifest is absent', async () => {
    const { fetchImpl, calls } = mockFetch({
      [artifactUrl(root, 'manifest.json')]: { status: 404, body: 'missing' },
      [artifactUrl(root, 'embeddings_2d.json')]: { body: JSON.stringify([{ id: 'legacy', x: 0.3, y: 0.3, name: null, date: null, imageUrl: null, caption: null }]) },
      [artifactUrl(root, 'embeddings_ids.json')]: { body: JSON.stringify(['legacy']) },
    })
    const loaded = await loadExplorerSnapshot(root, new AbortController().signal, fetchImpl)
    expect(loaded.source).toBe('legacy')
    expect(loaded.points.map((point) => point.id)).toEqual(['legacy'])
    expect(calls.some((url) => url.includes('embeddings_512d.bin'))).toBe(true)
  })
})
