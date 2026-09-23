import type { Lang } from './links'

export type ThemeName = 'light' | 'dark'
export type ViewMode = '2d' | '3d'
export type ExplorerSearchMode = 'smart' | 'visual'

export type ExplorerUrlState = {
  q: string
  view: ViewMode
  lang: Lang | null
  theme: ThemeName | null
  selected: string | null
  search: ExplorerSearchMode
}

export const DEFAULT_URL_STATE: ExplorerUrlState = {
  q: '',
  view: '2d',
  lang: null,
  theme: null,
  selected: null,
  search: 'smart',
}

function readEnum<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (value == null) return null
  return allowed.includes(value as T) ? value as T : null
}

export function parseExplorerSearch(search: string | URLSearchParams): ExplorerUrlState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const legacyView = readEnum(params.get('mode'), ['2d', '3d'] as const)
  return {
    q: params.get('q') ?? '',
    view: readEnum(params.get('view'), ['2d', '3d'] as const) ?? legacyView ?? '2d',
    lang: readEnum(params.get('lang'), ['en', 'fr'] as const),
    theme: readEnum(params.get('theme'), ['light', 'dark'] as const),
    selected: params.get('selected'),
    search: readEnum(params.get('search'), ['smart', 'visual'] as const) ?? 'smart',
  }
}

export function serializeExplorerSearch(state: ExplorerUrlState): string {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.view !== '2d') params.set('view', state.view)
  if (state.lang) params.set('lang', state.lang)
  if (state.theme) params.set('theme', state.theme)
  if (state.selected) params.set('selected', state.selected)
  if (state.search !== 'smart') params.set('search', state.search)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function withLocale(state: ExplorerUrlState, lang: Lang): ExplorerUrlState {
  return { ...state, lang }
}

export function withTheme(state: ExplorerUrlState, theme: ThemeName): ExplorerUrlState {
  return { ...state, theme }
}
