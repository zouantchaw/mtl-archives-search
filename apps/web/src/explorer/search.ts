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
  degradedBranches: Array<'visual' | 'semantic'>
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
  // The worker may include an empty items array with a diagnostic error on a
  // degraded response. Treat any explicit error as a failed contract instead
  // of turning it into a misleading empty-result state.
  if (typeof body.error === 'string') {
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
  const count = numberOrNull(body.count)
  const hasReturnedCount = body.countKind === 'returned' && count != null && count >= 0
  const degradedBranches: Array<'visual' | 'semantic'> = []
  const retrieval = body.retrieval && typeof body.retrieval === 'object' ? body.retrieval as Record<string, unknown> : null
  if (body.degraded === true && retrieval) {
    for (const branch of ['visual', 'semantic'] as const) {
      const diagnostics = retrieval[branch]
      if (diagnostics && typeof diagnostics === 'object' && (diagnostics as Record<string, unknown>).status !== 'ok') degradedBranches.push(branch)
    }
  }
  return {
    mode: typeof body.mode === 'string' ? body.mode : 'unknown',
    returnedCount: hasReturnedCount ? count : items.length,
    countKind: hasReturnedCount ? 'returned' : 'unknown',
    degraded: body.degraded === true,
    degradedBranches,
    items,
  }
}

export type SearchFailure = 'timeout' | 'unavailable' | 'failed'

export function classifySearchError(error: unknown): SearchFailure {
  if (error instanceof SearchRequestError) {
    if (error.timedOut || error.status === 408) return 'timeout'
    if (error.status === 501) return 'unavailable'
  }
  return 'failed'
}

export type ResultBoard<T> = {
  key: string
  requestId: number
  results: T[]
  returnedCount: number | null
  error: SearchFailure | null
  searching: boolean
  degraded: boolean
  degradedBranches: Array<'visual' | 'semantic'>
}

export function boardKey(query: string, mode: string): string {
  return `${mode}\n${query.trim()}`
}

export function emptyBoard<T>(key = ''): ResultBoard<T> {
  return { key, requestId: 0, results: [], returnedCount: null, error: null, searching: false, degraded: false, degradedBranches: [] }
}

export function beginSearch<T>(key: string, requestId: number, hasQuery: boolean): ResultBoard<T> {
  return {
    key,
    requestId,
    results: [],
    returnedCount: null,
    error: null,
    searching: hasQuery,
    degraded: false,
    degradedBranches: [],
  }
}

export function commitSearchSuccess<T>(
  board: ResultBoard<T>,
  requestId: number,
  key: string,
  payload: { items: T[]; returnedCount: number; degraded: boolean; degradedBranches?: Array<'visual' | 'semantic'> },
): ResultBoard<T> {
  if (board.requestId !== requestId || board.key !== key) return board
  return {
    key,
    requestId,
    results: payload.items,
    returnedCount: payload.returnedCount,
    error: null,
    searching: false,
    degraded: payload.degraded,
    degradedBranches: payload.degradedBranches ?? [],
  }
}

export function commitSearchFailure<T>(
  board: ResultBoard<T>,
  requestId: number,
  key: string,
  error: SearchFailure,
): ResultBoard<T> {
  if (board.requestId !== requestId || board.key !== key) return board
  return { key, requestId, results: [], returnedCount: null, error, searching: false, degraded: false, degradedBranches: [] }
}

export function visibleBoard<T>(board: ResultBoard<T>, query: string, mode: string): ResultBoard<T> {
  const key = boardKey(query, mode)
  if (board.key !== key) return { ...emptyBoard<T>(key), searching: false }
  return board
}

export function shouldRetry(status: number | null, attempt: number): boolean {
  if (attempt >= 1) return false
  return status == null || status === 408 || status === 429 || status >= 500
}

function withTimeout(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]), cleanup: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onParentAbort = () => {
    clearTimeout(timer)
    controller.abort()
  }
  parent.addEventListener('abort', onParentAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParentAbort)
    },
  }
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
    const timeout = withTimeout(args.signal, timeoutMs)
    try {
      const response = await fetchImpl(`${origin}/api/search?${params.toString()}`, { signal: timeout.signal, headers: { accept: 'application/json' } })
      if (!response.ok) {
        if (shouldRetry(response.status, attempt)) {
          attempt += 1
          continue
        }
        let message = `Search returned ${response.status}.`
        try {
          const body = await response.json() as unknown
          if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string') {
            message = (body as Record<string, string>).error
          }
        } catch {
          // Keep the status message when the error body is unavailable.
        }
        throw new SearchRequestError(message, response.status)
      }
      return normalizeSearchResponse(await response.json())
    } catch (error) {
      if (args.signal.aborted) throw error
      const timedOut = timeout.signal.aborted && !args.signal.aborted
      if (timedOut) throw new SearchRequestError('Search timed out.', 408, true)
      const status = error instanceof SearchRequestError ? error.status : null
      if (error instanceof SearchRequestError && !shouldRetry(status, attempt)) throw error
      if (shouldRetry(status, attempt)) {
        attempt += 1
        continue
      }
      if (error instanceof SearchRequestError) throw error
      throw new SearchRequestError('Search request failed.', null)
    } finally {
      timeout.cleanup()
    }
  }
}
