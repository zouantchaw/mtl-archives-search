import { useEffect, useId, useRef, useState } from 'react'
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
  onCollection: () => void
  onSkip: () => void
  advancedOpen: boolean
}) {
  const { text } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuTitle = useId()

  useEffect(() => {
    if (!menuOpen) return
    const node = menuRef.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node?.querySelector<HTMLElement>('button, a')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = [...node.querySelectorAll<HTMLElement>('button, a')].filter((item) => !item.hasAttribute('disabled'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      ;(previous ?? menuButtonRef.current)?.focus()
    }
  }, [menuOpen])

  function runMenuAction(action: () => void) {
    setMenuOpen(false)
    action()
  }

  return (
    <header className="explorer-header">
      <a className="skip-link" href="#explorer-results" onClick={(event) => { event.preventDefault(); props.onSkip() }}>{text.skipResults}</a>
      <div className="brand-row">
        <a className="brand-lockup" href={props.homeHref}>
          <span className="brand-mark" aria-hidden="true" />
          <strong>{text.product}</strong>
        </a>
        <a className="btn icon-btn" href={props.homeHref} aria-label={text.returnHome}>↩</a>
        <div className="segmented" role="group" aria-label={text.language}>
          <button type="button" className="btn icon-btn" aria-pressed={props.lang === 'fr'} onClick={() => props.onLang('fr')}>FR</button>
          <button type="button" className="btn icon-btn" aria-pressed={props.lang === 'en'} onClick={() => props.onLang('en')}>EN</button>
        </div>
        <button type="button" className="btn icon-btn" aria-pressed={props.theme === 'dark'} aria-label={props.theme === 'dark' ? text.themeToLight : text.themeToDark} onClick={props.onTheme}>
          {props.theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
      <label className="search-field">
        <span className="sr-only">{text.searchLabel}</span>
        <input
          value={props.query}
          placeholder={text.searchPlaceholder}
          aria-label={text.searchLabel}
          onChange={(event) => props.onQuery(event.target.value)}
        />
        {props.query ? (
          <button type="button" className="search-clear" aria-label={text.clearSearch} onClick={() => props.onQuery('')}>×</button>
        ) : null}
      </label>
      <div className="action-row">
        <div className="segmented" role="group" aria-label={text.view}>
          <button type="button" className="btn" aria-pressed={props.view === '2d'} onClick={() => props.onView('2d')}>{text.view2d}</button>
          <button type="button" className="btn" aria-pressed={props.view === '3d'} onClick={() => props.onView('3d')}>{text.view3d}</button>
        </div>
        <div className="desktop-actions">
          <button type="button" className="btn" onClick={props.onReset}>{text.resetView}</button>
          <button type="button" className="btn" aria-expanded={props.advancedOpen} onClick={props.onAdvanced}>{text.advanced}</button>
          <button type="button" className="btn" onClick={props.onAbout}>{text.about}</button>
          <button type="button" className="btn" onClick={props.onCollection}>{text.collection}</button>
        </div>
        <button ref={menuButtonRef} type="button" className="btn menu-button" aria-expanded={menuOpen} aria-controls={menuTitle} onClick={() => setMenuOpen((open) => !open)}>{text.menu}</button>
      </div>
      {menuOpen ? (
        <div ref={menuRef} id={menuTitle} className="header-menu" role="dialog" aria-modal="true" aria-label={text.menu}>
          <button type="button" className="btn" onClick={() => runMenuAction(props.onReset)}>{text.resetView}</button>
          <button type="button" className="btn" onClick={() => runMenuAction(props.onAdvanced)}>{text.advanced}</button>
          <button type="button" className="btn" onClick={() => runMenuAction(props.onAbout)}>{text.about}</button>
          <button type="button" className="btn" onClick={() => runMenuAction(props.onCollection)}>{text.collection}</button>
          <button type="button" className="btn" onClick={() => setMenuOpen(false)}>{text.closeMenu}</button>
        </div>
      ) : null}
    </header>
  )
}
