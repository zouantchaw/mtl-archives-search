const DECADE_CENTROIDS: Record<number, { x: number; y: number }> = {
  1920: { x: 0.376, y: 0.492 },
  1930: { x: 0.353, y: 0.429 },
  1940: { x: 0.637, y: 0.702 },
  1950: { x: 0.741, y: 0.221 },
  1960: { x: 0.8, y: 0.139 },
  1970: { x: 0.812, y: 0.087 },
}

const REGIONS = [
  { id: 0, x: 0.6764, y: 0.8544, color: [166, 92, 74] },
  { id: 1, x: 0.3579, y: 0.1077, color: [47, 107, 163] },
  { id: 2, x: 0.5067, y: 0.7283, color: [138, 122, 74] },
  { id: 3, x: 0.2901, y: 0.4721, color: [74, 122, 112] },
  { id: 4, x: 0.8663, y: 0.0635, color: [92, 96, 122] },
  { id: 5, x: 0.6728, y: 0.5422, color: [122, 78, 98] },
  { id: 6, x: 0.7862, y: 0.2036, color: [90, 90, 84] },
  { id: 7, x: 0.8995, y: 0.4931, color: [62, 98, 128] },
] as const

export type Anomaly = {
  statedDecade: number
  nearerDecade: number
  delta: number
}

export function projectionRegion(x: number, y: number, legacyLayout: boolean): { id: number; color: readonly [number, number, number] } | null {
  if (!legacyLayout) return null
  let best: (typeof REGIONS)[number] | null = null
  let bestDistance = Infinity
  for (const region of REGIONS) {
    const distance = Math.hypot(x - region.x, y - region.y)
    if (distance < bestDistance) {
      best = region
      bestDistance = distance
    }
  }
  return best ? { id: best.id, color: best.color } : null
}

export function geometricAnomaly(x: number, y: number, year: number | null, legacyLayout: boolean): Anomaly | null {
  if (!legacyLayout || year == null) return null
  const statedDecade = Math.floor(year / 10) * 10
  const own = DECADE_CENTROIDS[statedDecade]
  if (!own) return null
  let nearerDecade = statedDecade
  let nearerDistance = Infinity
  for (const [decade, centroid] of Object.entries(DECADE_CENTROIDS)) {
    const decadeNumber = Number(decade)
    if (decadeNumber === statedDecade) continue
    const distance = Math.hypot(x - centroid.x, y - centroid.y)
    if (distance < nearerDistance) {
      nearerDistance = distance
      nearerDecade = decadeNumber
    }
  }
  const ownDistance = Math.hypot(x - own.x, y - own.y)
  const delta = ownDistance - nearerDistance
  if (delta <= 0.05) return null
  return { statedDecade, nearerDecade, delta }
}

export function decadeChoices(years: Array<number | null>): number[] {
  const decades = new Set<number>()
  for (const year of years) {
    if (year == null) continue
    decades.add(Math.floor(year / 10) * 10)
  }
  return [...decades].sort((left, right) => left - right)
}
