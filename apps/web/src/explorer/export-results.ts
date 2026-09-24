export type ExportRow = {
  id: string
  title: string
  dateSource: string | null
  dateStatus: string
  year: number | null
  cote: string | null
  projected: boolean
  placement: 'pending' | 'projected' | 'unprojected'
  recordUrl: string
  sourceUrl: string | null
  rankingScore: number | null
  visualIndexScore: number | null
  semanticIndexScore: number | null
}

function csvCell(value: string | number | boolean | null): string {
  const raw = value == null ? '' : String(value)
  // Prefix spreadsheet formula-looking archive text so opening an export cannot execute it.
  const text = typeof value === 'string' && /^[=+\-@\t]/.test(raw) ? `'${raw}` : raw
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function resultsToCsv(rows: ExportRow[], context?: { snapshot: string | null; layout: unknown; viewUrl: string }): string {
  const header = [
    'id',
    'title',
    'date_source',
    'date_status',
    'year',
    'cote',
    'projected',
    'placement',
    'record_url',
    'source_url',
    'ranking_score',
    'visual_index_score',
    'semantic_index_score',
  ]
  if (context) header.push('snapshot_sha256', 'layout_json', 'view_url')
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      row.id,
      row.title,
      row.dateSource,
      row.dateStatus,
      row.year,
      row.cote,
      row.projected,
      row.placement,
      row.recordUrl,
      row.sourceUrl,
      row.rankingScore,
      row.visualIndexScore,
      row.semanticIndexScore,
      ...(context ? [context.snapshot, JSON.stringify(context.layout), context.viewUrl] : []),
    ].map(csvCell).join(','))
  }
  return `\uFEFF${lines.join('\n')}`
}

export function resultsToJson(payload: {
  layout?: unknown
  snapshot?: unknown
  viewUrl?: string
  exportedAt: string
  query: string
  searchMode: string
  returnedCount: number
  snapshotCount: number
  rows: ExportRow[]
}): string {
  return JSON.stringify(payload, null, 2)
}

export function downloadLocalFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
