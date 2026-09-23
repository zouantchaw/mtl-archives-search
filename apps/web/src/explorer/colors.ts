import { geometricAnomaly, projectionRegion } from './research'
import type { ThemeName } from './url-state'

export type ColorMode = 'neutral' | 'date' | 'region'

export function pointColor(args: {
  mode: ColorMode
  year: number | null
  normalizedX: number
  normalizedY: number
  legacyLayout: boolean
  highlight: boolean
  selected: boolean
  dimmed: boolean
  anomalyMode: boolean
  theme: ThemeName
}): [number, number, number] {
  if (args.selected || args.highlight) return [15, 94, 168]
  if (args.anomalyMode) {
    const anomaly = geometricAnomaly(args.normalizedX, args.normalizedY, args.year, args.legacyLayout)
    if (anomaly) return [176, 74, 58]
    return args.theme === 'dark' ? [54, 56, 62] : [214, 208, 196]
  }
  if (args.dimmed) return args.theme === 'dark' ? [54, 56, 62] : [214, 208, 196]
  if (args.mode === 'date') {
    if (args.year == null) return args.theme === 'dark' ? [122, 116, 104] : [138, 129, 114]
    const t = Math.max(0, Math.min(1, (args.year - 1890) / 100))
    return [
      Math.round(166 + (15 - 166) * t),
      Math.round(92 + (94 - 92) * t),
      Math.round(74 + (168 - 74) * t),
    ]
  }
  if (args.mode === 'region') {
    const region = projectionRegion(args.normalizedX, args.normalizedY, args.legacyLayout)
    if (region) return [region.color[0], region.color[1], region.color[2]]
  }
  return args.theme === 'dark' ? [232, 226, 214] : [36, 38, 44]
}
