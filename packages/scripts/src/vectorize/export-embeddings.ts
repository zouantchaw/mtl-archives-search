import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildVersion, writeVersion, type VectorFile } from '../explorer/export-projection.js'

export const CANONICAL_VISUAL_INDEX = 'mtl-archives-clip'
export const DEFAULT_PROJECTION_SEED = 42

export function vectorizeGetByIdsUrl(accountId: string, indexId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexId}/get_by_ids`
}

type VectorRow = { id?: string; values?: number[] }

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
  return (json.result ?? []).flatMap((row) => (
    row.id && Array.isArray(row.values) && row.values.length > 0 ? [{ id: row.id, values: row.values }] : []
  ))
}

export async function fetchVectorsByIds(args: {
  ids: string[]
  accountId: string
  token: string
  indexId?: string
  fetchImpl?: typeof fetch
  batchSize?: number
}): Promise<VectorFile> {
  const indexId = args.indexId ?? CANONICAL_VISUAL_INDEX
  const batchSize = args.batchSize ?? 20
  const ids: string[] = []
  const vectors: number[][] = []
  for (let offset = 0; offset < args.ids.length; offset += batchSize) {
    const batch = await fetchVectorBatch({
      ids: args.ids.slice(offset, offset + batchSize),
      accountId: args.accountId,
      token: args.token,
      indexId,
      fetchImpl: args.fetchImpl,
    })
    for (const row of batch) {
      ids.push(row.id)
      vectors.push(row.values)
    }
  }
  return { ids, vectors }
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
}

export async function runVectorizeExport(request: VectorExportRequest): Promise<{
  fetched: boolean
  wrote: string | null
  manifest: ReturnType<typeof buildVersion>['manifest'] | null
  indexId: string
  modelId: string | null
  note: string
}> {
  const dryRun = request.dryRun !== false
  const indexId = request.indexId ?? CANONICAL_VISUAL_INDEX
  const modelId = request.modelId ?? null
  const seed = request.seed ?? DEFAULT_PROJECTION_SEED
  const generatedAt = request.generatedAt ?? '2026-09-23T00:00:00.000Z'
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
    })
    fetched = true
  }
  if (!input) {
    return {
      fetched: false,
      wrote: null,
      manifest: null,
      indexId,
      modelId,
      note: `No local vector file was provided. Pass --input vectors.json, or --fetch --write with Cloudflare credentials to read index ${indexId}. This command never uploads to R2.`,
    }
  }
  const built = buildVersion({
    input,
    seed,
    modelId,
    indexId,
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
      indexId,
      modelId,
      note: 'Dry run: manifest was built in memory and no version folder was written.',
    }
  }
  const folder = writeVersion(request.outDir ?? 'tmp/explorer-artifacts', generatedAt, built)
  return { fetched, wrote: folder, manifest: built.manifest, indexId, modelId, note: `Wrote ${folder}. Nothing was uploaded.` }
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
  })
  console.log(JSON.stringify({ dryRun, fetched: result.fetched, wrote: result.wrote, modelId: result.modelId, indexId: result.indexId, note: result.note, manifest: result.manifest }, null, 2))
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
