import { useEffect, useMemo, useRef, useState } from 'react'
import { events } from '../lib/analytics'
import { AboutPanel } from './AboutPanel'
import { SnapshotIntegrityError, SnapshotUnavailableError, loadEmbeddingMatrix, loadExplorerSnapshot, type LoadedSnapshot } from './artifacts'
import { pointColor, type ColorMode } from './colors'
import { addToCollection, browserStorage, readCollection, removeFromCollection, writeCollection, type CollectionItem } from './collection'
import { apiOrigin, mapBackground, snapshotBase } from './config'
import { DetailsPanel } from './DetailsPanel'
import { downloadLocalFile, resultsToCsv, resultsToJson, type ExportRow } from './export-results'
import { mainSiteHome, mainSiteRecord, type Lang } from './links'
import { dictionaryFor, formatMessage, LOCALE_KEY, SUGGESTIONS, THEME_KEY, type Dictionary } from './locale'
import { buildProjection, type ProjectionIndex } from './projection'
import { itemFromId, itemFromPoint, itemFromSearch, type ExplorerItem } from './records'
import { PointCloudRenderer, type CloudPoint } from './renderer'
import { ResearchControls } from './ResearchControls'
import { decadeChoices } from './research'
import { ResultsPanel } from './ResultsPanel'
import { SearchRequestError, SearchSession, beginSearch, boardKey, commitSearchFailure, commitSearchSuccess, emptyBoard, runSearch, visibleBoard, type ResultBoard, type SearchRecord } from './search'
import { Shell } from './Shell'
import { nearestInSnapshot, type Neighbor } from './similarity'
import { parseArchiveDate } from './dates'
import { displayTitle, sourceTitle } from './titles'
import { parseExplorerSearch, serializeExplorerSearch, type ExplorerSearchMode, type ThemeName, type ViewMode } from './url-state'

type Boot = {
  query: string
  view: ViewMode
  lang: Lang
  theme: ThemeName
  selected: string | null
  search: ExplorerSearchMode
}

function bootState(): Boot {
  const params = parseExplorerSearch(window.location.search)
  let storedLang: Lang | null = null
  let storedTheme: ThemeName | null = null
  try {
    const storage = browserStorage()
    const lang = storage?.getItem(LOCALE_KEY) ?? null
    const theme = storage?.getItem(THEME_KEY) ?? null
    if (lang === 'en' || lang === 'fr') storedLang = lang
    if (theme === 'light' || theme === 'dark') storedTheme = theme
  } catch {
    storedLang = null
  }
  const theme = params.theme ?? storedTheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  return {
    query: params.q,
    view: params.view,
    lang: params.lang ?? storedLang ?? 'fr',
    theme,
    selected: params.selected,
    search: params.search,
  }
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function EmbeddingExplorer() {
  const boot = useState(bootState)[0]
  const [lang, setLang] = useState<Lang>(boot.lang)
  const [theme, setTheme] = useState<ThemeName>(boot.theme)
  const [query, setQuery] = useState(boot.query)
  const [view, setView] = useState<ViewMode>(boot.view)
  const [searchMode, setSearchMode] = useState<ExplorerSearchMode>(boot.search)
  const [selectedId, setSelectedId] = useState<string | null>(boot.selected)
  const [snapshot, setSnapshot] = useState<LoadedSnapshot | null>(null)
  const [projection, setProjection] = useState<ProjectionIndex | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(true)
  const [snapshotStatus, setSnapshotStatus] = useState<'loading' | 'ready' | 'empty' | 'integrity' | 'unavailable'>('loading')
  const [snapshotToken, setSnapshotToken] = useState(0)
  const [board, setBoard] = useState<ResultBoard<SearchRecord>>(() => emptyBoard())
  const [retryToken, setRetryToken] = useState(0)
  const [neighbors, setNeighbors] = useState<Neighbor[] | null>(null)
  const [similarWorking, setSimilarWorking] = useState(false)
  const [collection, setCollection] = useState<CollectionItem[]>(() => readCollection(browserStorage()))
  const [panel, setPanel] = useState<'results' | 'collection'>('results')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [colorMode, setColorMode] = useState<ColorMode>('neutral')
  const [lines, setLines] = useState(false)
  const [anomalies, setAnomalies] = useState(false)
  const [rotate, setRotate] = useState(false)
  const [decade, setDecade] = useState('all')
  const [webglError, setWebglError] = useState(false)
  const [rendererReady, setRendererReady] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const text = dictionaryFor(lang)
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const mobile = useMedia('(max-width: 767px)')
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PointCloudRenderer | null>(null)
  const sessionRef = useRef(new SearchSession())
  const matrixRef = useRef<{ matrix: Float32Array; dimensions: number } | null>(null)
  const selectRef = useRef<(id: string) => void>(() => {})
  const hoverRef = useRef<(id: string | null) => void>(() => {})
  const restoreRef = useRef<HTMLElement | null>(null)
  const aboutRef = useRef<HTMLDivElement>(null)
  const researchRef = useRef<HTMLDivElement>(null)
  const queryModeRef = useRef<string | null>(null)

  selectRef.current = (id: string) => {
    setSelectedId(id)
    setSheetOpen(true)
    events.photoClicked(id)
  }
  hoverRef.current = setHoverId

  useEffect(() => {
    const node = aboutOpen ? aboutRef.current : advancedOpen ? researchRef.current : null
    if (!node) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const selector = 'button, a[href], input, select, textarea'
    node.querySelector<HTMLElement>(selector)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = [...node.querySelectorAll<HTMLElement>(selector)].filter((item) => !item.hasAttribute('disabled'))
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
      previous?.focus()
    }
  }, [aboutOpen, advancedOpen])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dataset.theme = theme
    const storage = browserStorage()
    try {
      storage?.setItem(LOCALE_KEY, lang)
      storage?.setItem(THEME_KEY, theme)
    } catch {
      /* storage can be unavailable */
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111318' : '#F5F2EA')
  }, [lang, theme])

  useEffect(() => {
    const next = serializeExplorerSearch({ q: query, view, lang, theme, selected: selectedId, search: searchMode })
    const path = `${window.location.pathname}${next}`
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.replaceState({}, '', path)
  }, [query, view, lang, theme, selectedId, searchMode])

  useEffect(() => {
    const controller = new AbortController()
    setLoadingSnapshot(true)
    setSnapshotStatus('loading')
    loadExplorerSnapshot(snapshotBase(), controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSnapshot(loaded)
        setProjection(buildProjection(loaded.points))
        setSnapshotStatus(loaded.points.length === 0 ? 'empty' : 'ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSnapshot(null)
        setProjection(null)
        setSnapshotStatus(error instanceof SnapshotIntegrityError ? 'integrity' : error instanceof SnapshotUnavailableError ? 'unavailable' : 'unavailable')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSnapshot(false)
      })
    return () => controller.abort()
  }, [snapshotToken])

  useEffect(() => {
    if (webglError) return
    const container = containerRef.current
    if (!container) return
    try {
      const renderer = new PointCloudRenderer(container, {
        background: mapBackground(theme),
        reducedMotion,
        onSelect: (id) => selectRef.current(id),
        onHover: (id) => hoverRef.current(id),
        onContextLost: () => setWebglError(true),
      })
      rendererRef.current = renderer
      setRendererReady(true)
      return () => {
        renderer.dispose()
        rendererRef.current = null
        setRendererReady(false)
      }
    } catch {
      setWebglError(true)
    }
  }, [webglError])

  useEffect(() => { rendererRef.current?.setBackground(mapBackground(theme)) }, [theme, rendererReady])
  useEffect(() => {
    rendererRef.current?.setReducedMotion(reducedMotion)
    if (reducedMotion) setRotate(false)
  }, [reducedMotion, rendererReady])
  useEffect(() => { rendererRef.current?.setView(view) }, [view, rendererReady])
  useEffect(() => { rendererRef.current?.setAutoRotate(rotate && view === '3d') }, [rotate, view, reducedMotion, rendererReady])

  useEffect(() => {
    const key = boardKey(query, searchMode)
    if (queryModeRef.current === null) queryModeRef.current = key
    else if (queryModeRef.current !== key) {
      queryModeRef.current = key
      setSelectedId((current) => (current && projection?.byId.has(current) ? current : null))
      setNeighbors(null)
    }
    const session = sessionRef.current
    const { id, signal } = session.start()
    const hasQuery = query.trim().length > 0
    setBoard(beginSearch(key, id, hasQuery))
    if (!hasQuery) return
    const timer = window.setTimeout(() => {
      runSearch({ query: query.trim(), mode: searchMode, origin: apiOrigin(), signal })
        .then((result) => {
          if (!session.isCurrent(id)) return
          setBoard((current) => commitSearchSuccess(current, id, key, {
            items: result.items,
            returnedCount: result.returnedCount,
            degraded: result.degraded,
          }))
          events.searchPerformed(query.trim(), searchMode === 'visual' ? 'visual' : 'smart', result.returnedCount)
        })
        .catch((error: unknown) => {
          if (!session.isCurrent(id) || signal.aborted) return
          setBoard((current) => commitSearchFailure(current, id, key, error instanceof SearchRequestError && error.timedOut ? 'timeout' : 'failed'))
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      session.abort()
    }
  }, [query, searchMode, retryToken])

  const shownBoard = visibleBoard(board, query, searchMode)
  const place = (id: string): ExplorerItem['placement'] => {
    if (snapshotStatus !== 'ready' && snapshotStatus !== 'empty') return 'pending'
    return projection?.byId.has(id) ? 'projected' : 'unprojected'
  }
  const searchItems = useMemo(() => shownBoard.results.map((record) => {
    const point = projection?.byId.get(record.id)
    return itemFromSearch(record, point, place(record.id))
  }), [shownBoard.results, projection, snapshotStatus])

  const neighborItems = useMemo(() => {
    if (!neighbors || !projection || !snapshot) return []
    return neighbors.map((neighbor) => {
      const point = projection.byId.get(neighbor.id)
      const item = point ? itemFromPoint(point) : itemFromId(neighbor.id, undefined, 'unprojected')
      return { ...item, cosine: neighbor.cosine }
    })
  }, [neighbors, projection, snapshot])

  const collectionItems = useMemo(() => collection.map((item) => {
    const point = projection?.byId.get(item.id)
    const base = itemFromId(item.id, point, place(item.id))
    return {
      ...base,
      sourceTitle: item.title ?? base.sourceTitle,
      dateRaw: item.date ?? base.dateRaw,
      imageUrl: item.imageUrl ?? base.imageUrl,
      cote: item.cote ?? base.cote,
      externalUrl: item.externalUrl ?? base.externalUrl,
    }
  }), [collection, projection, snapshotStatus])

  const listItems = neighbors ? neighborItems : panel === 'collection' ? collectionItems : searchItems
  const highlighted = useMemo(() => new Set(listItems.filter((item) => item.projected).map((item) => item.id)), [listItems])

  const cloudPoints = useMemo<CloudPoint[]>(() => {
    if (!projection) return []
    return [...projection.byId.values()].map((point) => {
      const decadeNumber = point.year == null ? null : Math.floor(point.year / 10) * 10
      const dimmed = decade !== 'all' && (decade === 'undated' ? point.year != null : decadeNumber !== Number(decade))
      return {
        id: point.id,
        x: point.x,
        y: point.y,
        z: point.z,
        color: pointColor({
          mode: colorMode,
          year: point.year,
          normalizedX: point.normalizedX,
          normalizedY: point.normalizedY,
          legacyLayout: snapshot?.legacyLayout ?? true,
          highlight: highlighted.has(point.id),
          selected: point.id === selectedId,
          dimmed,
          anomalyMode: anomalies,
          theme,
        }),
      }
    })
  }, [projection, decade, colorMode, snapshot?.legacyLayout, highlighted, selectedId, anomalies, theme])

  useEffect(() => { rendererRef.current?.setPoints(cloudPoints) }, [cloudPoints, rendererReady])
  useEffect(() => {
    const ids = listItems.filter((item) => item.projected).slice(0, 12).map((item) => item.id)
    rendererRef.current?.setLines(ids, lines)
  }, [listItems, lines, rendererReady, view])
  const resultSignature = searchItems.map((item) => item.id).join('|')
  const neighborSignature = neighborItems.map((item) => item.id).join('|')
  useEffect(() => {
    const source = neighborSignature ? neighborItems : searchItems
    if (source.length === 0) return
    rendererRef.current?.focus(source.filter((item) => item.projected).map((item) => item.id))
  }, [resultSignature, neighborSignature, rendererReady, neighborItems, searchItems])
  useEffect(() => {
    if (!selectedId) return
    rendererRef.current?.focus([selectedId])
  }, [selectedId, rendererReady])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLElement && target.isContentEditable) return
      if (aboutOpen) { setAboutOpen(false); return }
      if (advancedOpen) { setAdvancedOpen(false); return }
      if (selectedId) setSelectedId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aboutOpen, advancedOpen, selectedId])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (webglError) setSheetOpen(true)
  }, [webglError])

  const selected = useMemo(() => {
    if (!selectedId) return null
    return listItems.find((item) => item.id === selectedId)
      ?? searchItems.find((item) => item.id === selectedId)
      ?? collectionItems.find((item) => item.id === selectedId)
      ?? itemFromId(selectedId, projection?.byId.get(selectedId))
  }, [selectedId, listItems, searchItems, collectionItems, projection])

  const decades = useMemo(() => decadeChoices([...(projection?.byId.values() ?? [])].map((point) => point.year)), [projection])
  const hoverTitle = hoverId ? displayTitle(sourceTitle(projection?.byId.get(hoverId)?.name), text.untitled) : null

  function rememberFocus() {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  function restoreFocus() {
    restoreRef.current?.focus()
  }
  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setToast(text.copied)
    } catch {
      setToast(text.copyFailed)
    }
  }
  function toggleSave() {
    if (!selected) return
    if (collection.some((item) => item.id === selected.id)) {
      const next = removeFromCollection(collection, selected.id)
      setCollection(next)
      writeCollection(browserStorage(), next)
      setToast(text.collectionRemoved)
      return
    }
    const next = addToCollection(collection, {
      id: selected.id,
      title: selected.sourceTitle,
      date: selected.dateRaw,
      imageUrl: selected.imageUrl,
      cote: selected.cote,
      externalUrl: selected.externalUrl,
    })
    setCollection(next.items)
    writeCollection(browserStorage(), next.items)
    setToast(next.added ? text.collectionSaved : text.collectionAlready)
  }
  async function findSimilar() {
    if (!selected || !snapshot?.vectorUrl || !snapshot.embeddingIds?.includes(selected.id)) return
    setSimilarWorking(true)
    try {
      matrixRef.current ??= await loadEmbeddingMatrix({
        url: snapshot.vectorUrl,
        idCount: snapshot.embeddingIds.length,
        sha256: snapshot.vectorSha256,
        byteLength: snapshot.vectorBytes,
        signal: new AbortController().signal,
      })
      const found = nearestInSnapshot({
        matrix: matrixRef.current.matrix,
        dimensions: matrixRef.current.dimensions,
        ids: snapshot.embeddingIds,
        sourceId: selected.id,
        limit: 20,
      })
      setNeighbors(found)
      setPanel('results')
      setSheetOpen(true)
    } catch {
      setToast(text.searchError)
    } finally {
      setSimilarWorking(false)
    }
  }
  function exportRows(): ExportRow[] {
    return listItems.map((item) => {
      const parsed = parseArchiveDate(item.dateRaw)
      return {
        id: item.id,
        title: displayTitle(sourceTitle(item.sourceTitle), text.untitled),
        dateSource: item.dateRaw,
        dateStatus: parsed.status,
        year: parsed.year,
        cote: item.cote,
        projected: item.placement === 'projected',
        placement: item.placement,
        recordUrl: mainSiteRecord(item.id, lang),
        sourceUrl: item.externalUrl,
        rankingScore: item.rankingScore,
        visualIndexScore: item.visualScore,
        semanticIndexScore: item.semanticScore,
      }
    })
  }
  function exportCsv() {
    downloadLocalFile('mtl-explorer-results.csv', resultsToCsv(exportRows()), 'text/csv;charset=utf-8')
  }
  function exportJson() {
    downloadLocalFile('mtl-explorer-results.json', resultsToJson({
      exportedAt: new Date().toISOString(),
      query,
      searchMode: neighbors ? 'snapshot' : searchMode,
      returnedCount: shownBoard.returnedCount ?? listItems.length,
      snapshotCount: projection?.count ?? 0,
      rows: exportRows(),
    }), 'application/json')
  }

  const emptyMessage = query.trim() ? text.noResults : text.emptyPrompt
  const showDetails = Boolean(selected)
  const searchError = shownBoard.error === 'timeout' ? text.searchTimeout : shownBoard.error === 'failed' ? text.searchError : null
  const side = (
    <div id="explorer-results" tabIndex={-1}>
      <div className="count-row">
        <p>{loadingSnapshot ? text.loadingSnapshot : snapshotStatus === 'empty' ? text.snapshotEmpty : formatMessage(text.snapshotCount, { count: projection?.count ?? 0 })}</p>
        {shownBoard.returnedCount != null ? <p>{formatMessage(text.returnedCount, { count: shownBoard.returnedCount })}{neighbors ? ` · ${text.snapshotSimilar}` : ''}</p> : null}
        {shownBoard.degraded ? <p className="help-copy">{text.degraded}</p> : null}
      </div>
      {!query.trim() && !neighbors && panel === 'results' ? (
        <div className="suggestion-row" aria-label={text.suggestions}>
          {SUGGESTIONS.map((item) => (
            <button key={item.query} type="button" className="btn" onClick={() => { setPanel('results'); setQuery(item.query) }}>{item.label[lang]}</button>
          ))}
        </div>
      ) : null}
      {snapshotStatus === 'integrity' || snapshotStatus === 'unavailable' ? (
        <div className="status-block" role="alert">
          <p>{snapshotStatus === 'integrity' ? text.snapshotIntegrity : text.snapshotError}</p>
          <button type="button" className="btn btn-primary" onClick={() => setSnapshotToken((value) => value + 1)}>{text.retry}</button>
        </div>
      ) : null}
      {showDetails && selected ? (
        <DetailsPanel
          text={text}
          item={selected}
          lang={lang}
          origin={apiOrigin()}
          legacyLayout={snapshot?.legacyLayout ?? false}
          saved={collection.some((item) => item.id === selected.id)}
          similarDisabled={!snapshot?.embeddingIds?.includes(selected.id)}
          similarWorking={similarWorking}
          onClose={() => setSelectedId(null)}
          onCopy={(value) => { void copyText(value) }}
          onToggleSave={toggleSave}
          onSimilar={() => { void findSimilar() }}
        />
      ) : (
        <ResultsPanel
          text={text}
          items={listItems}
          selectedId={selectedId}
          searching={shownBoard.searching && !neighbors}
          query={query}
          error={searchError}
          empty={panel === 'collection' ? text.collectionEmpty : emptyMessage}
          origin={apiOrigin()}
          onSelect={(id) => selectRef.current(id)}
          onRetry={searchError ? () => setRetryToken((value) => value + 1) : undefined}
        />
      )}
    </div>
  )

  const dialogOpen = aboutOpen || advancedOpen
  return (
    <div className="explorer-app">
      <div inert={dialogOpen ? true : undefined}>
      <Shell
        text={text}
        lang={lang}
        theme={theme}
        homeHref={mainSiteHome(lang)}
        query={query}
        view={view}
        advancedOpen={advancedOpen}
        onQuery={(value) => { setPanel('results'); setQuery(value) }}
        onView={(next) => { setView(next); events.viewModeChanged(next) }}
        onLang={setLang}
        onTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        onReset={() => rendererRef.current?.reset()}
        onAbout={() => { rememberFocus(); setAboutOpen(true); setAdvancedOpen(false) }}
        onAdvanced={() => { rememberFocus(); setAdvancedOpen((open) => !open); setAboutOpen(false) }}
        onCollection={() => { setPanel('collection'); setSelectedId(null); setSheetOpen(true) }}
        onSkip={() => {
          setSheetOpen(true)
          window.setTimeout(() => document.getElementById('explorer-results')?.focus(), 0)
        }}
      />
      <p className="map-sentence">{text.mapSentence}</p>
      <div className="explorer-body">
        <div className="map-stage">
          <div ref={containerRef} className="explorer-canvas" role="img" aria-label={text.mapLabel} />
          {webglError ? (
            <div className="webgl-fallback" role="status">
              <h2>{text.webglTitle}</h2>
              <p>{text.webglBody}</p>
            </div>
          ) : null}
          {loadingSnapshot && !webglError ? <p className="map-status" role="status">{text.loadingSnapshot}</p> : null}
          {hoverTitle && !mobile ? <p className="hover-label">{hoverTitle}</p> : null}
        </div>
        {mobile ? (
          <div className={`mobile-sheet${sheetOpen ? ' open' : ''}`}>
            <button type="button" className="btn sheet-toggle" aria-expanded={sheetOpen} onClick={() => setSheetOpen((open) => !open)}>
              {sheetOpen ? text.hideResults : text.openResults}
              {shownBoard.returnedCount != null ? ` · ${shownBoard.returnedCount}` : ''}
            </button>
            {sheetOpen ? <div className="sheet-body">{side}</div> : null}
          </div>
        ) : (
          <aside className="side-panel">{side}</aside>
        )}
        </div>
      </div>
      {advancedOpen ? <div ref={researchRef} className="overlay-anchor"><ResearchControls
          text={text}
          open={advancedOpen}
          searchMode={searchMode}
          colorMode={colorMode}
          lines={lines}
          anomalies={anomalies}
          rotate={rotate}
          reducedMotion={reducedMotion || view !== '3d'}
          legacyLayout={snapshot?.legacyLayout ?? false}
          decade={decade}
          decades={decades}
          onClose={() => { setAdvancedOpen(false); restoreFocus() }}
          onSearchMode={setSearchMode}
          onColor={setColorMode}
          onLines={setLines}
          onAnomalies={setAnomalies}
          onRotate={setRotate}
          onDecade={setDecade}
          onExportCsv={exportCsv}
          onExportJson={exportJson}
        /></div> : null}
        {aboutOpen ? <div ref={aboutRef} className="overlay-anchor"><AboutPanel
          text={text}
          open={aboutOpen}
          onClose={() => { setAboutOpen(false); restoreFocus() }}
          sourceLabel={snapshot == null ? text.unknownTime : snapshot.source === 'manifest' ? text.aboutManifest : text.aboutLegacy}
          snapshotCount={projection?.count ?? 0}
          modelId={snapshot?.modelId ?? null}
          indexId={snapshot?.indexId ?? null}
          generatedAt={snapshot?.generatedAt ?? null}
          vectorLabel={snapshot?.vectorHeader ? `${snapshot.vectorHeader.count} × ${snapshot.vectorHeader.dimensions}` : text.vectorUnread}
          returnedCount={shownBoard.returnedCount}
          dropped={projection?.dropped ?? 0}
        /></div> : null}
      {toast ? <p className="toast" role="status">{toast}</p> : null}
    </div>
  )
}
