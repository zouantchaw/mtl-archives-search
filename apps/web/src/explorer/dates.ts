export type ParsedDate =
  | { status: 'missing'; year: null; source: null }
  | { status: 'unparsed'; year: null; source: string }
  | { status: 'year' | 'decade' | 'date' | 'range'; year: number; source: string }

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, january: 1, jan: 1,
  février: 2, fevrier: 2, févr: 2, fevr: 2, february: 2, feb: 2,
  mars: 3, march: 3, mar: 3,
  avril: 4, avr: 4, april: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, june: 6, jun: 6,
  juillet: 7, juil: 7, july: 7, jul: 7,
  août: 8, aout: 8, august: 8, aug: 8,
  septembre: 9, sept: 9, september: 9, sep: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  décembre: 12, decembre: 12, déc: 12, dec: 12, december: 12,
}

function clean(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

function fullYear(value: number): number | null {
  if (value >= 1800 && value <= 2035) return value
  if (value >= 0 && value <= 99) {
    const year = value <= 29 ? 2000 + value : 1900 + value
    return year >= 1800 && year <= 2035 ? year : null
  }
  return null
}

function monthIndex(token: string): number | null {
  const key = token.normalize('NFC').toLocaleLowerCase('fr').replace(/\./g, '')
  return MONTHS[key] ?? null
}

export function parseArchiveDate(value: string | null | undefined): ParsedDate {
  if (value == null) return { status: 'missing', year: null, source: null }
  const source = clean(value)
  if (!source) return { status: 'missing', year: null, source: null }
  if (source.length > 48 || source.includes('/')) return { status: 'unparsed', year: null, source }
  const text = source.toLocaleLowerCase('fr')

  const range = text.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/)
  if (range) {
    const start = fullYear(Number(range[1]))
    const end = fullYear(Number(range[2]))
    if (start != null && end != null && end >= start) return { status: 'range', year: start, source }
  }

  const decade = text.match(/^(?:décennie|decennie|decade|années|annees)\s+(\d{4})$/)
  if (decade) {
    const year = fullYear(Number(decade[1]))
    if (year != null) return { status: 'decade', year, source }
  }

  const decadeSuffix = text.match(/^(\d{4})s$/)
  if (decadeSuffix) {
    const year = fullYear(Number(decadeSuffix[1]))
    if (year != null) return { status: 'decade', year, source }
  }

  const season = text.match(/^(?:printemps|été|ete|automne|hiver|spring|summer|autumn|fall|winter)\s+(\d{4})$/)
  if (season) {
    const year = fullYear(Number(season[1]))
    if (year != null) return { status: 'year', year, source }
  }

  const circa = text.match(/^(?:vers|circa|c\.|ca\.?)\s+(\d{4})$/)
  if (circa) {
    const year = fullYear(Number(circa[1]))
    if (year != null) return { status: 'year', year, source }
  }

  const isoDay = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDay) {
    const year = fullYear(Number(isoDay[1]))
    const month = Number(isoDay[2])
    const day = Number(isoDay[3])
    if (year != null && month >= 1 && month <= 12 && day >= 1 && day <= 31) return { status: 'date', year, source }
  }

  const isoMonth = text.match(/^(\d{4})-(\d{2})$/)
  if (isoMonth) {
    const year = fullYear(Number(isoMonth[1]))
    const month = Number(isoMonth[2])
    if (year != null && month >= 1 && month <= 12) return { status: 'date', year, source }
  }

  const yearOnly = text.match(/^(\d{4})$/)
  if (yearOnly) {
    const year = fullYear(Number(yearOnly[1]))
    if (year != null) return { status: 'year', year, source }
  }

  const spoken = text.match(/^(\d{1,2})(?:er)?\s+([a-zàâäéèêëïîôöùûüç.]+)\s+(\d{4})$/)
  if (spoken && monthIndex(spoken[2]) && fullYear(Number(spoken[3])) != null) {
    return { status: 'date', year: fullYear(Number(spoken[3])) as number, source }
  }

  const numeric = text.match(/^(\d{1,2})-([a-zàâäéèêëïîôöùûüç.]+)-(\d{2,4})$/)
  if (numeric && monthIndex(numeric[2])) {
    const year = fullYear(Number(numeric[3]))
    if (year != null) return { status: 'date', year, source }
  }

  return { status: 'unparsed', year: null, source }
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function yearToZ(year: number | null, id: string): number {
  const unit = (hashString(id) % 1000) / 999
  const jitter = (unit - 0.5) * 36
  if (year == null) return -48 + jitter
  const normalized = Math.max(0, Math.min(1, (year - 1890) / 100))
  return normalized * 150 + jitter
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10
}
