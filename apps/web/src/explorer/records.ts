import type { SearchRecord } from './search'
import type { ProjectedPoint } from './projection'

export type ExplorerItem = {
  id: string
  sourceTitle: string | null
  dateRaw: string | null
  year: number | null
  imageUrl: string | null
  caption: string | null
  captionModel: string | null
  description: string | null
  cote: string | null
  externalUrl: string | null
  credits: string | null
  rankingScore: number | null
  visualScore: number | null
  semanticScore: number | null
  cosine: number | null
  placement: 'pending' | 'projected' | 'unprojected'
  projected: boolean
  x?: number
  y?: number
  z?: number
  normalizedX?: number
  normalizedY?: number
}

export function itemFromSearch(
  record: SearchRecord,
  point: ProjectedPoint | undefined,
  placement: ExplorerItem['placement'],
  cosine: number | null = null,
): ExplorerItem {
  return {
    id: record.id,
    sourceTitle: record.sourceTitle ?? point?.name ?? null,
    dateRaw: record.dateRaw ?? point?.date ?? null,
    year: record.year ?? point?.year ?? null,
    imageUrl: record.imageUrl ?? point?.imageUrl ?? null,
    caption: record.caption ?? point?.caption ?? null,
    captionModel: record.captionProvenance?.model ?? null,
    description: record.description,
    cote: record.cote,
    externalUrl: record.externalUrl,
    credits: record.credits,
    rankingScore: record.rankingScore,
    visualScore: record.branchScores?.visual ?? (record.source === 'visual' || (record.rankingScore == null && record.source == null) ? record.vectorScore : null),
    semanticScore: record.branchScores?.semantic ?? (record.source === 'semantic' ? record.vectorScore : null),
    cosine,
    placement,
    projected: placement === 'projected',
    x: point?.x,
    y: point?.y,
    z: point?.z,
    normalizedX: point?.normalizedX,
    normalizedY: point?.normalizedY,
  }
}

export function itemFromPoint(point: ProjectedPoint): ExplorerItem {
  return {
    id: point.id,
    sourceTitle: point.name,
    dateRaw: point.date,
    year: point.year,
    imageUrl: point.imageUrl,
    caption: point.caption,
    captionModel: point.captionModel ?? null,
    description: null,
    cote: point.cote ?? null,
    externalUrl: point.externalUrl ?? null,
    credits: point.credits ?? null,
    rankingScore: null,
    visualScore: null,
    semanticScore: null,
    cosine: null,
    placement: 'projected',
    projected: true,
    x: point.x,
    y: point.y,
    z: point.z,
    normalizedX: point.normalizedX,
    normalizedY: point.normalizedY,
  }
}

export function itemFromId(id: string, point: ProjectedPoint | undefined, placement: ExplorerItem['placement'] = point ? 'projected' : 'pending'): ExplorerItem {
  if (point && placement === 'projected') return itemFromPoint(point)
  return {
    id,
    sourceTitle: null,
    dateRaw: null,
    year: null,
    imageUrl: null,
    caption: null,
    captionModel: null,
    description: null,
    cote: null,
    externalUrl: null,
    credits: null,
    rankingScore: null,
    visualScore: null,
    semanticScore: null,
    cosine: null,
    placement,
    projected: placement === 'projected',
  }
}
