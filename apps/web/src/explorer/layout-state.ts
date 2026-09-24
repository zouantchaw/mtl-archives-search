import type { MapLayoutSettings } from './MapSettings'
import type { ProjectionIndex } from './projection'

export const PUBLISHED_LAYOUT: MapLayoutSettings = { preset: 'published', mode: '2d', nNeighbors: 15, minDist: 0.1, seed: 42 }
export const LAYOUT_VERSION = 'umap-js-1.4.0-v1'
export function layoutConfig(settings: MapLayoutSettings) {
  return { dimensions: settings.mode === '3d' ? 3 as const : 2 as const, nNeighbors: settings.nNeighbors, minDist: settings.minDist, seed: settings.seed }
}
export function validLayout(value: MapLayoutSettings): boolean {
  return ['published','local','broad','custom'].includes(value.preset) && ['2d','3d','time'].includes(value.mode) && Number.isInteger(value.nNeighbors) && value.nNeighbors >= 5 && value.nNeighbors <= 60 && Number.isFinite(value.minDist) && value.minDist >= 0 && value.minDist <= .8 && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 2147483647
}
export function canonicalLayout(settings: MapLayoutSettings): MapLayoutSettings {
  if (!validLayout(settings)) throw new Error('Invalid layout settings')
  const fixed = settings.preset === 'published' ? [15,.1] : settings.preset === 'local' ? [8,.05] : settings.preset === 'broad' ? [40,.3] : null
  return fixed ? { ...settings, nNeighbors: fixed[0]!, minDist: fixed[1]!, seed: 42 } : settings
}
export function readLayout(search: string): { settings: MapLayoutSettings; snapshot: string | null; version: string | null } {
  const params = new URLSearchParams(search)
  const mode = params.get('layoutMode') ?? (params.get('view') === '3d' ? 'time' : '2d')
  const candidate = { preset: params.get('layout') ?? 'published', mode, nNeighbors: Number(params.get('neighbors') ?? 15), minDist: Number(params.get('distance') ?? .1), seed: Number(params.get('seed') ?? 42) } as MapLayoutSettings
  return { settings: validLayout(candidate) ? canonicalLayout(candidate) : { ...PUBLISHED_LAYOUT }, snapshot: params.get('snapshot'), version: params.get('layoutVersion') }
}
export function writeLayout(search: string, settings: MapLayoutSettings, snapshot: string | null): string {
  const params = new URLSearchParams(search)
  params.set('layout', settings.preset)
  params.set('layoutMode', settings.mode)
  params.set('neighbors', String(settings.nNeighbors))
  params.set('distance', String(settings.minDist))
  params.set('seed', String(settings.seed))
  params.set('layoutVersion', LAYOUT_VERSION)
  if (snapshot) params.set('snapshot', snapshot)
  return `?${params.toString()}`
}
/** Uniform scaling preserves the aspect ratio and relative distances of the projection. */
export function projectLayout(base: ProjectionIndex, ids: string[], coordinates: Float32Array, settings: MapLayoutSettings): ProjectionIndex {
  const dimensions = layoutConfig(settings).dimensions
  if (coordinates.length !== ids.length * dimensions || new Set(ids).size !== ids.length || ids.length !== base.count || ids.some(id => !base.byId.has(id))) throw new Error('Layout records do not match the snapshot')
  const low = Array(dimensions).fill(Infinity) as number[], high = Array(dimensions).fill(-Infinity) as number[]
  for (let i = 0; i < coordinates.length; i++) {
    const value = coordinates[i]!
    if (!Number.isFinite(value)) throw new Error('Invalid layout coordinates')
    const d = i % dimensions
    low[d] = Math.min(low[d]!, value); high[d] = Math.max(high[d]!, value)
  }
  const span = Math.max(...high.map((v,i) => v-low[i]!), 1e-9)
  const byId = new Map(base.byId)
  ids.forEach((id,i) => {
    const point = base.byId.get(id)!
    const x = (coordinates[i*dimensions]! - (low[0]!+high[0]!)/2)/span*1000+500
    const y = (coordinates[i*dimensions+1]! - (low[1]!+high[1]!)/2)/span*1000+500
    const z = dimensions === 3 ? (coordinates[i*dimensions+2]! - (low[2]!+high[2]!)/2)/span*1000 : point.z
    byId.set(id,{ ...point,x,y,z,normalizedX:x/1000,normalizedY:y/1000 })
  })
  return { ...base,byId }
}
