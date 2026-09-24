import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildVersion, writeVersion, type VectorFile, type VectorRecord } from '../explorer/export-projection.js'

/** The current read-only visual index from apps/api/wrangler.toml. */
export const CANONICAL_VISUAL_INDEX = 'mtl-archives-clip-canonical-20260912'
export const DEFAULT_PROJECTION_SEED = 42

export function vectorizeGetByIdsUrl(accountId: string, indexId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexId}/get_by_ids`
}

type VectorRow = { id?: string; values?: number[] }

export type VectorFetchSummary = {
  requestedIds: string[]
  missingIds: string[]
  unexpectedIds: string[]
  duplicateIds: string[]
}

export type FetchedVectorFile = VectorFile & VectorFetchSummary

export async function fetchVectorBatch(args: {
  ids: string[]
  accountId: string
  token: string
  indexId: string
  fetchImpl?: typeof fetch
}): Promise<Array<{ id: string; values: number[] }>> {
  const fetchImpl = args.fetchImpl ?? fetch
  const response = await fetchImpl(vectorizeGetByIdsUrl(args.accountId, args.indexId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: args.ids }),
  })
  if (!response.ok) throw new Error(`Vectorize fetch failed: ${response.status}`)
  const json = await response.json() as { result?: VectorRow[] }
  if (!Array.isArray(json.result)) throw new Error('Vectorize response did not contain a result array.')
  return json.result.flatMap((row) => {
    if (typeof row.id !== 'string' || !Array.isArray(row.values) || row.values.length === 0) return []
    if (!row.values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`Vectorize returned a non-finite vector for ${row.id}.`)
    }
    return [{ id: row.id, values: row.values }]
  })
}

export async function fetchVectorsByIds(args: {
  ids: string[]
  accountId: string
  token: string
  indexId?: string
  fetchImpl?: typeof fetch
  batchSize?: number
  records?: Record<string, VectorRecord>
}): Promise<FetchedVectorFile> {
  const indexId = args.indexId ?? CANONICAL_VISUAL_INDEX
  const batchSize = args.batchSize ?? 20
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw new Error('Vector fetch batchSize must be an integer from 1 to 20.')
  const requestedIds = args.ids.map((id) => id.trim())
  if (requestedIds.some((id) => !id)) throw new Error('Vector fetch IDs must be non-empty strings.')
  const uniqueRequested = new Set(requestedIds)
  if (uniqueRequested.size !== requestedIds.length) throw new Error('Vector fetch IDs must be unique.')
  const byId = new Map<string, number[]>()
  const unexpectedIds: string[] = []
  const duplicateIds: string[] = []
  for (let offset = 0; offset < args.ids.length; offset += batchSize) {
    const batch = await fetchVectorBatch({
      ids: requestedIds.slice(offset, offset + batchSize),
      accountId: args.accountId,
      token: args.token,
      indexId,
      fetchImpl: args.fetchImpl,
    })
    for (const row of batch) {
      if (!uniqueRequested.has(row.id)) {
        unexpectedIds.push(row.id)
      } else if (byId.has(row.id)) {
        duplicateIds.push(row.id)
      } else {
        byId.set(row.id, row.values)
      }
    }
  }
  const ids = requestedIds.filter((id) => byId.has(id))
  const vectors = ids.map((id) => byId.get(id) as number[])
  const missingIds = requestedIds.filter((id) => !byId.has(id))
  const records = args.records
    ? Object.fromEntries(ids.flatMap((id) => args.records?.[id] ? [[id, args.records[id]]] : []))
    : undefined
  return { ids, vectors, ...(records ? { records } : {}), requestedIds, missingIds, unexpectedIds, duplicateIds }
}

/** Convert D1 `/api/photos` rows or a metadata map into snapshot records. */
export function normalizeMetadataRecords(input: unknown): Record<string, VectorRecord> {
  const rows = Array.isArray(input)
    ? input
    : (input && typeof input === 'object' && Array.isArray((input as { items?: unknown }).items)
      ? (input as { items: unknown[] }).items
      : (input && typeof input === 'object' ? Object.entries(input as Record<string, unknown>).map(([id, row]) => ({ ...(row as object), id })) : []))
  const records: Record<string, VectorRecord> = {}
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const value = row as Record<string, unknown>
    const idValue = value.id ?? value.metadataFilename ?? value.metadata_filename
    if (typeof idValue !== 'string' || !idValue.trim()) continue
    const id = idValue.trim()
    const record: VectorRecord = {
      name: stringOrNull(value.name ?? value.portal_title ?? value.portalTitle),
      date: stringOrNull(value.date ?? value.dateValue ?? value.date_value ?? value.portal_date),
      imageUrl: stringOrNull(value.imageUrl ?? value.image_url),
      caption: stringOrNull(value.caption ?? value.vlmCaption ?? value.vlm_caption),
      cote: stringOrNull(value.cote ?? value.portal_cote),
      credits: stringOrNull(value.credits),
      externalUrl: stringOrNull(value.externalUrl ?? value.external_url),
      captionModel: stringOrNull(value.captionModel ?? value.vlm_caption_model),
    }
    records[id] = record
    if (id.endsWith('.json')) records[id.slice(0, -5)] = record
    else records[`${id}.json`] = record
  }
  return records
}

function stringOrNull(value: unknown): string | null {
  return value == null ? null : typeof value === 'string' ? value : null
}

export type VectorExportRequest = {
  dryRun?: boolean
  fetchVectors?: boolean
  write?: boolean
  input?: VectorFile | null
  ids?: string[]
  modelId?: string | null
  indexId?: string
  seed?: number
  outDir?: string
  accountId?: string
  token?: string
  fetchImpl?: typeof fetch
  generatedAt?: string
  records?: Record<string, VectorRecord>
  allowMissing?: boolean
}

export async function runVectorizeExport(request: VectorExportRequest): Promise<{
  fetched: boolean
  wrote: string | null
  manifest: ReturnType<typeof buildVersion>['manifest'] | null
  indexId: string
  modelId: string | null
  missingIds: string[]
  requestedCount: number
  fetchedCount: number
  note: string
}> {
  const dryRun = request.dryRun !== false
  const indexId = request.indexId ?? CANONICAL_VISUAL_INDEX
  const modelId = request.modelId ?? null
  const seed = request.seed ?? DEFAULT_PROJECTION_SEED
  const generatedAt = request.generatedAt ?? new Date().toISOString()
  const requestedRecords = request.records
  let input = request.input ?? null
  let fetched = false
  if (!input && request.fetchVectors) {
    if (dryRun) {
      return {
        fetched: false,
        wrote: null,
        manifest: null,
        indexId,
        modelId,
        missingIds: [],
        requestedCount: request.ids?.length ?? 0,
        fetchedCount: 0,
        note: `Dry run: would read Vectorize index ${indexId} with get_by_ids and project locally with seed ${seed}. No request is sent.`,
      }
    }
    if (!request.accountId || !request.token) throw new Error('Missing Cloudflare credentials.')
    if (!request.ids?.length) throw new Error('No record ids were provided for Vectorize extraction.')
    input = await fetchVectorsByIds({
      ids: request.ids,
      accountId: request.accountId,
      token: request.token,
      indexId,
      fetchImpl: request.fetchImpl,
      records: requestedRecords,
    })
    fetched = true
    const fetchedResult = input as FetchedVectorFile
    const missingIds = fetchedResult.missingIds
    if (missingIds.length > 0 && request.allowMissing !== true) {
      throw new Error(`Vectorize omitted ${missingIds.length} of ${fetchedResult.requestedIds.length} requested vectors. Pass --allow-missing to project the ${fetchedResult.ids.length} received vectors; first missing IDs: ${missingIds.slice(0, 5).join(', ')}`)
    }
  }
  if (!input) {
    return {
      fetched: false,
      wrote: null,
      manifest: null,
      indexId,
      modelId,
      missingIds: [],
      requestedCount: 0,
      fetchedCount: 0,
      note: `No local vector file was provided. Pass --input vectors.json, or --fetch --write with Cloudflare credentials to read index ${indexId}. This command never uploads to R2.`,
    }
  }
  if (requestedRecords && !fetched) {
    input = {
      ...input,
      records: { ...requestedRecords, ...(input.records ?? {}) },
    }
  }
  const effectiveModelId = request.modelId ?? input.modelId ?? null
  const effectiveIndexId = request.indexId ?? input.indexId ?? indexId
  const fetchedInput = input as FetchedVectorFile
  const missingIds = Array.isArray(fetchedInput.missingIds) ? fetchedInput.missingIds : []
  const built = buildVersion({
    input,
    seed,
    modelId: effectiveModelId,
    indexId: effectiveIndexId,
    nNeighbors: 15,
    minDist: 0.1,
    spread: 1,
    generatedAt,
  })
  if (dryRun || request.write !== true) {
    return {
      fetched,
      wrote: null,
      manifest: built.manifest,
      indexId: effectiveIndexId,
      modelId: effectiveModelId,
      missingIds,
      requestedCount: Array.isArray(fetchedInput.requestedIds) ? fetchedInput.requestedIds.length : input.ids.length,
      fetchedCount: input.ids.length,
      note: missingIds.length ? `Dry run: ${missingIds.length} requested vectors were missing; manifest covers ${input.ids.length} received vectors.` : 'Dry run: manifest was built in memory and no version folder was written.',
    }
  }
  const folder = writeVersion(request.outDir ?? 'tmp/explorer-artifacts', generatedAt, built)
  return { fetched, wrote: folder, manifest: built.manifest, indexId: effectiveIndexId, modelId: effectiveModelId, missingIds, requestedCount: Array.isArray(fetchedInput.requestedIds) ? fetchedInput.requestedIds.length : input.ids.length, fetchedCount: input.ids.length, note: missingIds.length ? `Wrote ${folder}. ${missingIds.length} requested vectors were missing; manifest covers ${input.ids.length} received vectors. Nothing was uploaded.` : `Wrote ${folder}. Nothing was uploaded.` }
}

function argValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : null
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const fetchVectors = argv.includes('--fetch')
  const write = argv.includes('--write')
  const dryRun = !write
  const inputPath = argValue(argv, '--input')
  const input = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) as VectorFile : null
  const idsPath = argValue(argv, '--ids')
  const ids = idsPath
    ? readFileSync(idsPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
    : undefined
  const metadataPath = argValue(argv, '--metadata')
  const records = metadataPath ? normalizeMetadataRecords(JSON.parse(readFileSync(metadataPath, 'utf8'))) : undefined
  const result = await runVectorizeExport({
    dryRun,
    fetchVectors,
    write,
    input,
    ids,
    modelId: argValue(argv, '--model-id'),
    indexId: argValue(argv, '--index-id') ?? CANONICAL_VISUAL_INDEX,
    seed: Number(argValue(argv, '--seed') ?? DEFAULT_PROJECTION_SEED),
    outDir: argValue(argv, '--out') ?? 'tmp/explorer-artifacts',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN || process.env.CF_AI_TOKEN,
    generatedAt: new Date().toISOString(),
    records,
    allowMissing: argv.includes('--allow-missing'),
  })
  console.log(JSON.stringify({ dryRun, fetched: result.fetched, wrote: result.wrote, modelId: result.modelId, indexId: result.indexId, requestedCount: result.requestedCount, fetchedCount: result.fetchedCount, missingCount: result.missingIds.length, missingIds: result.missingIds, note: result.note, manifest: result.manifest }, null, 2))
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
