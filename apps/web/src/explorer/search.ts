import { parseArchiveDate } from './dates'
import type { ExplorerSearchMode } from './url-state'

export const SEARCH_LIMIT = 50
export const SEARCH_TIMEOUT_MS = 20_000

export type BranchScores = {
  visual?: number
  semantic?: number
}

export type SearchRecord = {
  id: string
  sourceTitle: string | null
  dateRaw: string | null
  year: number | null
  imageUrl: string | null
  caption: string | null
  captionProvenance: { source: string | null; model: string | null; status: string | null } | null
  description: string | null
  cote: string | null
  externalUrl: string | null
  credits: string | null
  rankingScore: number | null
  branchScores: BranchScores | null
  vectorScore: number | null
  source: string | null
}

export type NormalizedSearch = {
  mode: string
  returnedCount: number
  countKind: 'returned' | 'unknown'
  degraded: boolean
  items: SearchRecord[]
}

export class SearchSession {
  latest = 0
  private controller: AbortController | null = null

  start(): { id: number; signal: AbortSignal } {
    this.latest += 1
    this.controller?.abort()
    this.controller = new AbortController()
    return { id: this.latest, signal: this.controller.signal }
  }

  isCurrent(id: number): boolean {
    return id === this.latest
  }

  abort(): void {
    this.controller?.abort()
  }
}

export class SearchRequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly timedOut = false) {
    super(message)
    this.name = 'SearchRequestError'
  }
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function branchScores(value: unknown): BranchScores | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const visual = numberOrNull(row.visual)
  const semantic = numberOrNull(row.semantic)
  if (visual == null && semantic == null) return null
  return { ...(visual != null ? { visual } : {}), ...(semantic != null ? { semantic } : {}) }
}

export function normalizeSearchResponse(payload: unknown): NormalizedSearch {
  if (!payload || typeof payload !== 'object') throw new SearchRequestError('Search response was not an object.', null)
  const body = payload as Record<string, unknown>
  if (typeof body.error === 'string' && !Array.isArray(body.items)) {
    throw new SearchRequestError(body.error, null)
  }
  if (!Array.isArray(body.items)) throw new SearchRequestError('Search response did not include items.', null)
  const items: SearchRecord[] = []
  const seen = new Set<string>()
  for (const entry of body.items) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = textOrNull(row.metadataFilename)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const provenance = row.captionProvenance
    const provenanceRecord = provenance && typeof provenance === 'object' ? provenance as Record<string, unknown> : null
    const dateRaw = textOrNull(row.dateValue)
    items.push({
      id,
      sourceTitle: textOrNull(row.name) ?? textOrNull(row.portalTitle),
      dateRaw,
      year: parseArchiveDate(dateRaw).year,
      imageUrl: textOrNull(row.imageUrl),
      caption: textOrNull(row.vlmCaption),
      captionProvenance: provenanceRecord ? {
        source: textOrNull(provenanceRecord.source),
        model: textOrNull(provenanceRecord.model),
        status: textOrNull(provenanceRecord.status),
      } : null,
      description: textOrNull(row.description),
      cote: textOrNull(row.cote) ?? textOrNull(row.portalCote),
      externalUrl: textOrNull(row.externalUrl),
      credits: textOrNull(row.credits),
      rankingScore: numberOrNull(row.rankingScore),
      branchScores: branchScores(row.branchScores),
      vectorScore: numberOrNull(row.score),
      source: textOrNull(row.source),
    })
  }
  const returnedCount = typeof body.count === 'number' && Number.isFinite(body.count) ? body.count : items.length
  return {
    mode: typeof body.mode === 'string' ? body.mode : 'unknown',
    returnedCount,
    countKind: body.countKind === 'returned' ? 'returned' : 'unknown',
    degraded: body.degraded === true,
    items,
  }
}

export function shouldRetry(status: number | null, attempt: number): boolean {
  if (attempt >= 1) return false
  return status == null || status === 408 || status === 429 || status >= 500
}

function withTimeout(parent: AbortSignal, timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)])
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  parent.addEventListener('abort', () => {
    clearTimeout(timer)
    controller.abort()
  }, { once: true })
  return controller.signal
}

export async function runSearch(args: {
  query: string
  mode: ExplorerSearchMode
  origin: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
  timeoutMs?: number
  limit?: number
}): Promise<NormalizedSearch> {
  const fetchImpl = args.fetchImpl ?? fetch
  const limit = args.limit ?? SEARCH_LIMIT
  const timeoutMs = args.timeoutMs ?? SEARCH_TIMEOUT_MS
  const origin = args.origin.replace(/\/$/, '')
  const params = new URLSearchParams({
    q: args.query,
    mode: args.mode,
    limit: String(limit),
  })
  let attempt = 0
  while (true) {
    const signal = withTimeout(args.signal, timeoutMs)
    try {
      const response = await fetchImpl(`${origin}/api/search?${params.toString()}`, { signal, headers: { accept: 'application/json' } })
      if (!response.ok) {
        if (shouldRetry(response.status, attempt)) {
          attempt += 1
          continue
        }
        throw new SearchRequestError(`Search returned ${response.status}.`, response.status)
      }
      return normalizeSearchResponse(await response.json())
    } catch (error) {
      if (args.signal.aborted) throw error
      const timedOut = signal.aborted && !args.signal.aborted
      if (timedOut) throw new SearchRequestError('Search timed out.', 408, true)
      const status = error instanceof SearchRequestError ? error.status : null
      if (error instanceof SearchRequestError && !shouldRetry(status, attempt)) throw error
      if (shouldRetry(status, attempt)) {
        attempt += 1
        continue
      }
      throw error
    }
  }
}
