import type { Dictionary } from './locale'
import type { Lang } from './links'
import type { ViewMode } from './url-state'

export function Shell(props: {
  text: Dictionary
  lang: Lang
  theme: 'light' | 'dark'
  homeHref: string
  query: string
  view: ViewMode
  onQuery: (value: string) => void
  onView: (view: ViewMode) => void
  onLang: (lang: Lang) => void
  onTheme: () => void
  onReset: () => void
  onAbout: () => void
  onAdvanced: () => void
  advancedOpen: boolean
  onCollection: () => void
}) {
  const { text } = props
  return (
    <header className="explorer-header">
      <div className="explorer-brand">
        <a className="skip-link" href="#explorer-results">{text.skipResults}</a>
        <a className="brand-lockup" href={props.homeHref}>
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong>{text.product}</strong>
            <span>{text.explorer}</span>
          </span>
        </a>
        <a className="btn" href={props.homeHref}>{text.returnHome}</a>
      </div>
      <div className="explorer-toolbar">
        <label className="search-field">
          <span className="sr-only">{text.searchLabel}</span>
          <input
            value={props.query}
            placeholder={text.searchPlaceholder}
            aria-label={text.searchLabel}
            onChange={(event) => props.onQuery(event.target.value)}
          />
          {props.query ? (
            <button type="button" className="btn" onClick={() => props.onQuery('')}>{text.clearSearch}</button>
          ) : null}
        </label>
        <div className="segmented" role="group" aria-label={text.view}>
          <button type="button" className="btn" aria-pressed={props.view === '2d'} onClick={() => props.onView('2d')}>{text.view2d}</button>
          <button type="button" className="btn" aria-pressed={props.view === '3d'} onClick={() => props.onView('3d')}>{text.view3d}</button>
        </div>
        <button type="button" className="btn" onClick={props.onReset}>{text.resetView}</button>
        <button type="button" className="btn" aria-expanded={props.advancedOpen} onClick={props.onAdvanced}>{text.advanced}</button>
        <button type="button" className="btn" onClick={props.onAbout}>{text.about}</button>
        <button type="button" className="btn" onClick={props.onCollection}>{text.collection}</button>
        <div className="segmented" role="group" aria-label={text.language}>
          <button type="button" className="btn" aria-pressed={props.lang === 'fr'} onClick={() => props.onLang('fr')}>FR</button>
          <button type="button" className="btn" aria-pressed={props.lang === 'en'} onClick={() => props.onLang('en')}>EN</button>
        </div>
        <button type="button" className="btn icon-btn" aria-pressed={props.theme === 'dark'} aria-label={props.theme === 'dark' ? text.themeToLight : text.themeToDark} onClick={props.onTheme}>
          {props.theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}
