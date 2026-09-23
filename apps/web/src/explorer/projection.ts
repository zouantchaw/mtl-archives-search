import { parseArchiveDate, yearToZ } from './dates'

export type SnapshotPoint = {
  id: string
  x: number
  y: number
  name: string | null
  date: string | null
  imageUrl: string | null
  caption: string | null
}

export const MAP_SCALE = 1000

export type ProjectedPoint = {
  id: string
  x: number
  y: number
  z: number
  normalizedX: number
  normalizedY: number
  name: string | null
  date: string | null
  imageUrl: string | null
  caption: string | null
  year: number | null
}

export type ProjectionIndex = {
  byId: Map<string, ProjectedPoint>
  count: number
  dropped: number
}

export type LocatedFields = {
  id: string
  projected: boolean
  x?: number
  y?: number
  z?: number
  normalizedX?: number
  normalizedY?: number
  year?: number | null
}

export function isNormalizedPlane(points: Array<{ x: number; y: number }>): boolean {
  return points.every((point) => point.x >= -0.05 && point.x <= 1.05 && point.y >= -0.05 && point.y <= 1.05)
}

export function buildProjection(points: SnapshotPoint[]): ProjectionIndex {
  const normalized = points.length === 0 || isNormalizedPlane(points)
  const byId = new Map<string, ProjectedPoint>()
  let dropped = 0
  for (const point of points) {
    if (byId.has(point.id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      dropped += 1
      continue
    }
    const parsed = parseArchiveDate(point.date)
    const year = parsed.year
    const normalizedX = normalized ? point.x : point.x / MAP_SCALE
    const normalizedY = normalized ? point.y : point.y / MAP_SCALE
    byId.set(point.id, {
      id: point.id,
      x: normalized ? point.x * MAP_SCALE : point.x,
      y: normalized ? point.y * MAP_SCALE : point.y,
      z: yearToZ(year, point.id),
      normalizedX,
      normalizedY,
      name: point.name,
      date: point.date,
      imageUrl: point.imageUrl,
      caption: point.caption,
      year,
    })
  }
  return { byId, count: byId.size, dropped }
}

export function locateRecord<T extends { id: string }>(record: T, index: ProjectionIndex): T & LocatedFields {
  const point = index.byId.get(record.id)
  if (!point) return { ...record, projected: false }
  return {
    ...record,
    projected: true,
    x: point.x,
    y: point.y,
    z: point.z,
    normalizedX: point.normalizedX,
    normalizedY: point.normalizedY,
    year: point.year,
  }
}

export function focusableIds(index: ProjectionIndex, ids: string[]): string[] {
  return ids.filter((id) => index.byId.has(id))
}
