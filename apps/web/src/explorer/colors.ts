import { geometricAnomaly, projectionRegion } from './research'
import type { ThemeName } from './url-state'

export type ColorMode = 'neutral' | 'date' | 'region'

export const DATE_PALETTE = [
  [166, 92, 74],
  [190, 120, 68],
  [177, 145, 58],
  [132, 157, 67],
  [79, 148, 105],
  [48, 139, 139],
  [48, 113, 161],
  [65, 89, 160],
  [103, 76, 151],
  [137, 72, 133],
  [155, 73, 104],
] as const

export function dateColorForYear(year: number | null, theme: ThemeName): [number, number, number] {
  if (year == null) return theme === 'dark' ? [122, 116, 104] : [138, 129, 114]
  const decade = Math.floor(year / 10) * 10
  const index = Math.max(0, Math.min(DATE_PALETTE.length - 1, (decade - 1890) / 10))
  return [...DATE_PALETTE[index]] as [number, number, number]
}

function mix(left: [number, number, number], right: [number, number, number], amount: number): [number, number, number] {
  return left.map((value, index) => Math.round(value * (1 - amount) + right[index] * amount)) as [number, number, number]
}

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
  if (args.selected) return [15, 94, 168]
  if (args.anomalyMode) {
    const anomaly = geometricAnomaly(args.normalizedX, args.normalizedY, args.year, args.legacyLayout)
    if (anomaly) return [176, 74, 58]
    return args.theme === 'dark' ? [54, 56, 62] : [214, 208, 196]
  }
  if (args.dimmed) return args.theme === 'dark' ? [54, 56, 62] : [214, 208, 196]
  let color: [number, number, number]
  if (args.mode === 'date') {
    color = dateColorForYear(args.year, args.theme)
  } else if (args.mode === 'region') {
    const region = projectionRegion(args.normalizedX, args.normalizedY, args.legacyLayout)
    color = region ? [region.color[0], region.color[1], region.color[2]] : args.theme === 'dark' ? [232, 226, 214] : [36, 38, 44]
  } else {
    color = args.theme === 'dark' ? [232, 226, 214] : [36, 38, 44]
  }
  return args.highlight ? mix(color, [15, 94, 168], 0.35) : color
}
