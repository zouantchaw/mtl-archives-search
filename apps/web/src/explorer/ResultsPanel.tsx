import { useEffect, useRef } from 'react'
import { parseArchiveDate } from './dates'
import { thumbnailUrl } from './links'
import { displayTitle, sourceTitle } from './titles'
import type { Dictionary } from './locale'
import type { ExplorerItem } from './records'

export function ResultsPanel(props: {
  text: Dictionary
  items: ExplorerItem[]
  selectedId: string | null
  searching: boolean
  query: string
  error: string | null
  empty: string
  origin: string
  onSelect: (id: string) => void
  onRetry?: () => void
}) {
  const { text } = props
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (!node.contains(target as Node) && document.activeElement !== node) return
      event.preventDefault()
      const buttons = [...node.querySelectorAll<HTMLButtonElement>('[data-result]')]
      if (buttons.length === 0) return
      const current = buttons.findIndex((button) => button === document.activeElement)
      const next = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, current + 1) : Math.max(0, current - 1)
      buttons[next]?.focus()
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [props.items])

  return (
    <div id="explorer-results" className="results-panel" ref={listRef} tabIndex={0} aria-label={text.results}>
      {props.searching ? <p className="status-line" role="status">{text.searching}</p> : null}
      {props.error ? (
        <div className="status-block" role="alert">
          <p>{props.error}</p>
          {props.onRetry ? <button type="button" className="btn btn-primary" onClick={props.onRetry}>{text.retry}</button> : null}
        </div>
      ) : null}
      {props.items.length === 0 && !props.searching && !props.error ? <p className="status-line">{props.empty}</p> : null}
      <ul className="result-list">
        {props.items.map((item) => {
          const parsed = parseArchiveDate(item.dateRaw)
          const dateLine = parsed.status === 'missing' ? text.dateMissing : parsed.source
          const title = displayTitle(sourceTitle(item.sourceTitle), text.untitled)
          return (
            <li key={item.id}>
              <button
                type="button"
                data-result="true"
                className="result-card"
                aria-pressed={props.selectedId === item.id}
                onClick={() => props.onSelect(item.id)}
              >
                {item.imageUrl ? (
                  <img src={thumbnailUrl(props.origin, item.imageUrl, 320, 200)} alt="" />
                ) : (
                  <span className="photo-fallback">{text.imageUnavailable}</span>
                )}
                <span>
                  <strong>{title}</strong>
                  <span>{dateLine}</span>
                  {parsed.status === 'unparsed' ? <span>{text.dateUnparsed}</span> : null}
                  <span>{item.projected ? text.onMap : text.notOnMap}</span>
                  {item.cote ? <span>{item.cote}</span> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
