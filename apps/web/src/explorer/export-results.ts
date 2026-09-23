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
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function resultsToCsv(rows: ExportRow[]): string {
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
    ].map(csvCell).join(','))
  }
  return `\uFEFF${lines.join('\n')}`
}

export function resultsToJson(payload: {
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
