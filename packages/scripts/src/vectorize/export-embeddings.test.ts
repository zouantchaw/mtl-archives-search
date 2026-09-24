import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CANONICAL_VISUAL_INDEX, fetchVectorsByIds, normalizeMetadataRecords, runVectorizeExport, vectorizeGetByIdsUrl } from './export-embeddings.js'

const input = {
  ids: ['a', 'b', 'c', 'd'],
  vectors: [[0, 0, 0, 1], [0, 1, 0, 0], [1, 0, 0, 0], [0.2, 0.3, 0.4, 0.5]],
  records: { a: { name: 'Rue Saint-Antoine', date: '1932' } },
}

test('default export plans the Vectorize read and does not call the network or write', async () => {
  let called = false
  const result = await runVectorizeExport({
    fetchImpl: async () => {
      called = true
      throw new Error('network')
    },
  })
  assert.equal(called, false)
  assert.equal(result.fetched, false)
  assert.equal(result.wrote, null)
  assert.equal(result.manifest, null)
  assert.equal(result.indexId, CANONICAL_VISUAL_INDEX)
  assert.match(result.note, /get_by_ids|vector file/i)
})

test('fetch uses the canonical index and a dry run does not send it', async () => {
  const dry = await runVectorizeExport({ fetchVectors: true, ids: ['a'], accountId: 'acct', token: 'tok' })
  assert.equal(dry.fetched, false)
  assert.match(dry.note, /mtl-archives-clip/)

  const calls: string[] = []
  const file = await fetchVectorsByIds({
    ids: ['a', 'b'],
    accountId: 'acct',
    token: 'tok',
    fetchImpl: async (url) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ result: [{ id: 'a', values: [0.1, 0.2] }, { id: 'b', values: [0.3, 0.4] }] }))
    },
  })
  assert.deepEqual(file.ids, ['a', 'b'])
  assert.equal(calls[0], vectorizeGetByIdsUrl('acct', CANONICAL_VISUAL_INDEX))
})

test('fetch reports missing rows, preserves requested order, and joins metadata', async () => {
  const file = await fetchVectorsByIds({
    ids: ['b', 'a', 'missing'],
    accountId: 'acct',
    token: 'tok',
    records: { a: { name: 'A' }, b: { name: 'B' } },
    fetchImpl: async () => new Response(JSON.stringify({ result: [
      { id: 'a', values: [1, 0] },
      { id: 'b', values: [0, 1] },
    ] })),
  })
  assert.deepEqual(file.ids, ['b', 'a'])
  assert.deepEqual(file.vectors, [[0, 1], [1, 0]])
  assert.deepEqual(file.missingIds, ['missing'])
  assert.deepEqual(file.requestedIds, ['b', 'a', 'missing'])
  assert.deepEqual(file.records, { a: { name: 'A' }, b: { name: 'B' } })
})

test('metadata normalizer accepts D1 API rows and bare/json IDs', () => {
  const records = normalizeMetadataRecords({ items: [{
    metadataFilename: 'photo_a.json',
    name: 'Rue A',
    dateValue: '1932',
    imageUrl: 'https://images.example/a.jpg',
    vlmCaption: 'A street',
    vlm_caption_model: 'model-x',
    externalUrl: 'https://archives.example/a',
    credits: 'Archives',
  }] })
  assert.equal(records.photo_a?.name, 'Rue A')
  assert.equal(records.photo_a?.date, '1932')
  assert.equal(records['photo_a.json']?.captionModel, 'model-x')
  assert.equal(records.photo_a?.externalUrl, 'https://archives.example/a')
})

test('strict fetch refuses an incomplete requested set', async () => {
  await assert.rejects(
    () => runVectorizeExport({
      fetchVectors: true,
      write: true,
      dryRun: false,
      ids: ['a', 'missing'],
      accountId: 'acct',
      token: 'tok',
      fetchImpl: async () => new Response(JSON.stringify({ result: [{ id: 'a', values: [1, 0, 0, 0] }] })),
    }),
    /omitted 1 of 2/,
  )
})

test('local vectors project with the supplied model and seed without writing unless asked', async () => {
  const preview = await runVectorizeExport({ input, modelId: 'fixture-model', seed: 7, dryRun: true, write: true })
  assert.equal(preview.wrote, null)
  assert.equal(preview.manifest?.modelId, 'fixture-model')
  assert.equal(preview.manifest?.seed, 7)
  assert.equal(preview.manifest?.indexId, CANONICAL_VISUAL_INDEX)

  const dir = mkdtempSync(path.join(tmpdir(), 'explorer-export-'))
  try {
    const written = await runVectorizeExport({
      input,
      modelId: null,
      seed: 7,
      dryRun: false,
      write: true,
      outDir: dir,
      generatedAt: '2026-09-23T12:00:00.000Z',
    })
    assert.equal(written.fetched, false)
    assert.ok(written.wrote?.endsWith('manifest.json') === false)
    assert.match(written.wrote ?? '', /v1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
