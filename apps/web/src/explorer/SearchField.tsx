import { Image, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Dictionary } from './locale'
import type { Lang } from './links'
import { SEARCH_EXAMPLES, type SearchExample } from './search-examples'
import './SearchField.css'

type SearchFieldProps = {
  text: Dictionary
  lang: Lang
  query: string
  searchMode: SearchExample['mode']
  onQuery: (value: string) => void
  onSearchMode: (mode: SearchExample['mode']) => void
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  return reducedMotion
}

export function SearchField(props: SearchFieldProps) {
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [exampleIndex, setExampleIndex] = useState(0)
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const empty = props.query.trim().length === 0

  useEffect(() => {
    if (reducedMotion || focused || !empty) return
    const timer = window.setInterval(() => {
      setExampleIndex((current) => (current + 1) % SEARCH_EXAMPLES.length)
    }, 4200)
    return () => window.clearInterval(timer)
  }, [empty, focused, reducedMotion])

  useEffect(() => {
    if (!empty) setOpen(false)
  }, [empty])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const rotatingExample = SEARCH_EXAMPLES[exampleIndex % SEARCH_EXAMPLES.length]
  const placeholder = empty && !focused && !reducedMotion
    ? rotatingExample[props.lang].description
    : props.text.searchPlaceholder

  function chooseExample(example: SearchExample) {
    const query = props.lang === 'fr' ? (example.frQuery ?? example.query) : example.query
    props.onSearchMode(example.mode)
    props.onQuery(query)
    setOpen(false)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div ref={rootRef} className="search-field search-field-enhanced">
      <div className="search-field-control">
        <Search aria-hidden="true" />
        <Input
          ref={inputRef}
          className="search-field-input"
          value={props.query}
          placeholder={placeholder}
          aria-label={props.text.searchLabel}
          aria-describedby={open ? 'search-example-list-description' : undefined}
          onFocus={() => { setFocused(true); if (empty) setOpen(true) }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const value = event.target.value
            props.onQuery(value)
            if (value.trim()) setOpen(false)
            else if (focused) setOpen(true)
          }}
        />
        {props.query ? (
          <button type="button" className="search-clear" aria-label={props.text.clearSearch} onClick={() => { props.onQuery(''); if (focused) setOpen(true) }}>
            <X aria-hidden="true" />
          </button>
        ) : null}
        <Select value={props.searchMode} onValueChange={(value) => props.onSearchMode(value as SearchExample['mode'])} onOpenChange={(nextOpen) => { if (nextOpen) setOpen(false) }}>
          <SelectTrigger className="search-mode-select" size="sm" aria-label={props.text.searchMode}>
            <SelectValue>
              <span className="search-mode-trigger-label">
                <span className="search-mode-label search-mode-label-full">{props.searchMode === 'visual' ? props.text.searchModeVisual : props.text.searchModeCombined}</span>
                <span className="search-mode-label search-mode-label-compact">{props.searchMode === 'visual' ? props.text.searchModeVisualShort : props.text.searchModeCombinedShort}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="search-mode-content" position="popper" align="end">
            <SelectGroup>
              <SelectItem value="smart" textValue={props.text.searchModeCombined}>
                <span className="search-mode-option">
                  <span className="search-mode-label search-mode-label-full">{props.text.searchModeCombined}</span>
                  <span className="search-mode-label search-mode-label-compact">{props.text.searchModeCombinedShort}</span>
                  <span className="search-mode-description">{props.text.searchModeCombinedDescription}</span>
                </span>
              </SelectItem>
              <SelectItem value="visual" textValue={props.text.searchModeVisual}>
                <span className="search-mode-option">
                  <span className="search-mode-label search-mode-label-full">{props.text.searchModeVisual}</span>
                  <span className="search-mode-label search-mode-label-compact">{props.text.searchModeVisualShort}</span>
                  <span className="search-mode-description">{props.text.searchModeVisualDescription}</span>
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {open && empty ? (
        <div className="search-field-popover" role="region" aria-label={props.text.searchExamples}>
          <div className="search-field-popover-header">
            <strong>{props.text.searchExamples}</strong>
            <span id="search-example-list-description">{props.text.searchExamplesHint}</span>
          </div>
          <div className="search-field-example-list">
            {SEARCH_EXAMPLES.map((example) => {
              const copy = example[props.lang]
              const visual = example.mode === 'visual'
              return (
                <button
                  key={example.id}
                  type="button"
                  className="search-field-example"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseExample(example)}
                >
                  <span className="search-field-example-icon" aria-hidden="true">
                    {visual ? <Image /> : <Sparkles />}
                  </span>
                  <span className="search-field-example-copy">
                    <span className="search-field-example-meta">
                      <strong>{copy.label}</strong>
                      <span>{visual ? props.text.searchExampleVisual : props.text.searchExampleSmart}</span>
                    </span>
                    <span className="search-field-example-description">{copy.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
