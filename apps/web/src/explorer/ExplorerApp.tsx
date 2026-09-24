import { Network, Bookmark, X, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { buildSearchGraph, buildNeighborGraph, type GraphEdge } from './graph'
import { useEffect, useMemo, useRef, useState } from 'react'
import { events } from '../lib/analytics'
import { AboutPanel } from './AboutPanel'
import { SnapshotIntegrityError, SnapshotUnavailableError, loadEmbeddingMatrix, loadExplorerSnapshot, type LoadedSnapshot } from './artifacts'
import { dateColorForYear, pointColor, type ColorMode } from './colors'
import { addToCollection, browserStorage, readCollection, removeFromCollection, writeCollection, type CollectionItem } from './collection'
import { apiOrigin, mapBackground, snapshotBase } from './config'
import { DetailsPanel } from './DetailsPanel'
import { downloadLocalFile, resultsToCsv, resultsToJson, type ExportRow } from './export-results'
import { mainSiteHome, mainSiteRecord, officialSourceUrl, type Lang } from './links'
import { dictionaryFor, formatMessage, LOCALE_KEY, THEME_KEY, type Dictionary } from './locale'
import { buildProjection, type ProjectionIndex } from './projection'
import { itemFromId, itemFromPoint, itemFromSearch, type ExplorerItem } from './records'
import { PointCloudRenderer, type CloudPoint } from './renderer'
import { ResearchControls } from './ResearchControls'
import { decadeChoices } from './research'
import { ResultsPanel } from './ResultsPanel'
import { classifySearchError, SearchSession, beginSearch, boardKey, commitSearchFailure, commitSearchSuccess, emptyBoard, runSearch, visibleBoard, type ResultBoard, type SearchRecord } from './search'
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
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [graphAnchor, setGraphAnchor] = useState<ExplorerItem | null>(null)
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([])
  const [graphStatus, setGraphStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [graphRetry, setGraphRetry] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(Boolean(boot.query || boot.selected))
  const [colorMode, setColorMode] = useState<ColorMode>('date')
  const [lines, setLines] = useState(true)
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
  const resultsOverlayRef = useRef<HTMLElement>(null)
  const rendererRef = useRef<PointCloudRenderer | null>(null)
  const sessionRef = useRef(new SearchSession())
  const matrixRef = useRef<{ snapshot: LoadedSnapshot; matrix: Float32Array; dimensions: number } | null>(null)
  const vectorRequestRef = useRef<{ snapshot: LoadedSnapshot; promise: Promise<{ matrix: Float32Array; dimensions: number }>; controller: AbortController } | null>(null)
  const snapshotRef = useRef<LoadedSnapshot | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const queryRef = useRef(query)
  const searchModeRef = useRef(searchMode)
  const selectRef = useRef<(id: string) => void>(() => {})
  const hoverRef = useRef<(id: string | null) => void>(() => {})
  const overlayRestoreRef = useRef<HTMLElement | null>(null)
  const queryModeRef = useRef<string | null>(null)

  snapshotRef.current = snapshot
  selectedIdRef.current = selectedId
  queryRef.current = query
  searchModeRef.current = searchMode

  selectRef.current = (id: string) => {
    setSelectedId(id)
    setSheetOpen(true)
    events.photoClicked(id)
  }
  hoverRef.current = setHoverId

  function rememberOverlayFocus() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    overlayRestoreRef.current = active?.isConnected ? active : null
  }

  function restoreOverlayFocus(event: Event) {
    event.preventDefault()
    overlayRestoreRef.current?.focus()
  }

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
    matrixRef.current = null
    snapshotRef.current = null
    setSnapshot(null)
    setProjection(null)
    setLoadingSnapshot(true)
    setSnapshotStatus('loading')
    loadExplorerSnapshot(snapshotBase(), controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSnapshot(loaded)
        snapshotRef.current = loaded
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
            degradedBranches: result.degradedBranches,
          }))
          events.searchPerformed(query.trim(), searchMode === 'visual' ? 'visual' : 'smart', result.returnedCount)
        })
        .catch((error: unknown) => {
          if (!session.isCurrent(id) || signal.aborted) return
          setBoard((current) => commitSearchFailure(current, id, key, classifySearchError(error)))
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      session.abort()
    }
  }, [query, searchMode, retryToken])

  const shownBoard = useMemo(() => visibleBoard(board, query, searchMode), [board, query, searchMode])
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

  const activeMode = neighbors !== null ? 'similarity' : 'search'
  const listItems = activeMode === 'similarity' ? neighborItems : searchItems
  const activeReturnedCount = activeMode === 'similarity'
    ? neighborItems.length
    : shownBoard.returnedCount
  const highlighted = useMemo(() => new Set([...listItems.filter((item) => item.projected).map((item) => item.id), ...(neighbors && graphAnchor ? [graphAnchor.id] : [])]), [listItems, neighbors, graphAnchor])

  const cloudPoints = useMemo<CloudPoint[]>(() => {
    if (!projection) return []
    return [...projection.byId.values()].map((point) => {
      const decadeNumber = point.year == null ? null : Math.floor(point.year / 10) * 10
      const dimmed = (decade !== 'all' && (decade === 'undated' ? point.year != null : decadeNumber !== Number(decade))) || (lines && graphEdges.length > 0 && !highlighted.has(point.id))
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
  }, [projection, decade, colorMode, snapshot?.legacyLayout, highlighted, selectedId, anomalies, theme, lines, graphEdges])

  useEffect(() => { rendererRef.current?.setPoints(cloudPoints) }, [cloudPoints, rendererReady])
  useEffect(() => { rendererRef.current?.setSelected(selectedId ?? (neighbors ? graphAnchor?.id ?? null : null)) }, [selectedId, rendererReady, neighbors, graphAnchor])
  useEffect(() => { rendererRef.current?.setSelectionLabel(lang === 'fr' ? 'Sélection' : 'Selected') }, [lang, rendererReady])
  useEffect(() => {
    rendererRef.current?.setConnectionGraph(graphEdges, lines, theme)
  }, [graphEdges, lines, theme, rendererReady])
  useEffect(() => {
    let current = true
    setGraphEdges([])
    if (!lines || !snapshot || listItems.filter((item) => item.projected).length < 2) {
      setGraphStatus('idle')
      return
    }
    if (neighbors && graphAnchor) {
      setGraphEdges(buildNeighborGraph(graphAnchor.id, neighbors.map((neighbor) => ({ id: neighbor.id, score: neighbor.cosine }))))
      setGraphStatus('ready')
      return
    }
    setGraphStatus('loading')
    void loadVectors(snapshot).then((loaded) => {
      if (!current) return
      setGraphEdges(buildSearchGraph(listItems.filter((item) => item.projected).map((item) => item.id), loaded.matrix, snapshot.embeddingIds ?? [], loaded.dimensions))
      setGraphStatus('ready')
    }).catch(() => { if (current) setGraphStatus('error') })
    return () => { current = false }
  }, [snapshot, listItems, neighbors, graphAnchor, lines, graphRetry])
  useEffect(() => () => { vectorRequestRef.current?.controller.abort() }, [])
  const resultSignature = searchItems.map((item) => item.id).join('|')
  const neighborSignature = neighborItems.map((item) => item.id).join('|')
  useEffect(() => {
    const source = neighbors !== null ? neighborItems : searchItems
    if (selectedId || source.length === 0) return
    rendererRef.current?.focus([...source.filter((item) => item.projected).map((item) => item.id), ...(neighbors && graphAnchor ? [graphAnchor.id] : [])])
  }, [resultSignature, neighborSignature, neighbors, rendererReady, neighborItems, searchItems, selectedId, graphAnchor])
  useEffect(() => {
    if (!selectedId) return
    rendererRef.current?.focus([selectedId])
  }, [selectedId, rendererReady, projection])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented || aboutOpen || advancedOpen || collectionOpen) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLElement && target.isContentEditable) return
      if (selectedId) setSelectedId(null)
      else setSheetOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aboutOpen, advancedOpen, collectionOpen, selectedId])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (webglError) setSheetOpen(true)
  }, [webglError])

  const mappedEdgeCount = graphEdges.filter((edge) => projection?.byId.has(edge.source) && projection?.byId.has(edge.target)).length

  const selected = useMemo(() => {
    if (!selectedId) return null
    return listItems.find((item) => item.id === selectedId)
      ?? searchItems.find((item) => item.id === selectedId)
      ?? collectionItems.find((item) => item.id === selectedId)
      ?? (graphAnchor?.id === selectedId ? graphAnchor : null)
      ?? itemFromId(selectedId, projection?.byId.get(selectedId))
  }, [selectedId, listItems, searchItems, collectionItems, projection, graphAnchor])

  const decades = useMemo(() => decadeChoices([...(projection?.byId.values() ?? [])].map((point) => point.year)), [projection])
  const hoverTitle = hoverId ? displayTitle(sourceTitle(projection?.byId.get(hoverId)?.name), text.untitled) : null

  async function loadVectors(source: LoadedSnapshot) {
    if (!source.vectorUrl || !source.embeddingIds) throw new Error('Snapshot vectors unavailable')
    if (matrixRef.current?.snapshot === source) return matrixRef.current
    if (vectorRequestRef.current?.snapshot === source) return vectorRequestRef.current.promise
    vectorRequestRef.current?.controller.abort()
    const controller = new AbortController()
    const promise = loadEmbeddingMatrix({url: source.vectorUrl, idCount: source.embeddingIds.length, sha256: source.vectorSha256, byteLength: source.vectorBytes, signal: controller.signal})
      .then((loaded) => { if (snapshotRef.current === source) matrixRef.current = { snapshot: source, ...loaded }; return loaded })
      .finally(() => { if (vectorRequestRef.current?.snapshot === source) vectorRequestRef.current = null })
    vectorRequestRef.current = { snapshot: source, promise, controller }
    return promise
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
    const embeddingIds = snapshot?.embeddingIds
    const vectorUrl = snapshot?.vectorUrl
    if (!selected || !vectorUrl || !embeddingIds?.includes(selected.id)) return
    const sourceId = selected.id
    const sourceSnapshot = snapshot
    const sourceQuery = query
    const sourceSearchMode = searchMode
    setSimilarWorking(true)
    try {
      const loadedMatrix = await loadVectors(sourceSnapshot)
      if (snapshotRef.current !== sourceSnapshot || selectedIdRef.current !== sourceId || queryRef.current !== sourceQuery || searchModeRef.current !== sourceSearchMode) return
      const found = nearestInSnapshot({
        matrix: loadedMatrix.matrix,
        dimensions: loadedMatrix.dimensions,
        ids: embeddingIds,
        sourceId,
        limit: 20,
      })
      setNeighbors(found)
      setGraphAnchor(selected)
      setLines(true)
      setSelectedId(null)
      setSheetOpen(true)
    } catch {
      if (snapshotRef.current === sourceSnapshot && selectedIdRef.current === sourceId && queryRef.current === sourceQuery && searchModeRef.current === sourceSearchMode) setToast(text.searchError)
    } finally {
      setSimilarWorking(false)
    }
  }
  function exportRows(items = listItems): ExportRow[] {
    return items.map((item) => {
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
  function exportCsv(items = listItems) {
    downloadLocalFile('mtl-explorer-results.csv', resultsToCsv(exportRows(items)), 'text/csv;charset=utf-8')
  }
  function exportJson(items = listItems) {
    downloadLocalFile('mtl-explorer-results.json', resultsToJson({
      exportedAt: new Date().toISOString(),
      query: activeMode === 'search' ? query : '',
      searchMode: activeMode === 'similarity' ? 'snapshot' : searchMode,
      returnedCount: items.length,
      snapshotCount: projection?.count ?? 0,
      rows: exportRows(items),
    }), 'application/json')
  }

  function copyCitation() {
    if (!selected) return
    const title = displayTitle(sourceTitle(selected.sourceTitle), text.untitled)
    const recordUrl = mainSiteRecord(selected.id, lang)
    const sourceUrl = officialSourceUrl(selected.externalUrl)
    const fields = [
      `“${title}”`,
      selected.dateRaw,
      selected.cote ? `${text.reference}: ${selected.cote}` : null,
      selected.credits ? `${text.credits}: ${selected.credits}` : null,
      `MTL Archives: ${recordUrl}`,
      sourceUrl ? `${text.sourceLink}: ${sourceUrl}` : null,
    ].filter((value): value is string => Boolean(value && value.trim()))
    void copyText(fields.join('. '))
  }

  const emptyMessage = query.trim() ? text.noResults : text.emptyPrompt
  const showDetails = Boolean(selected)
  const searchError = activeMode === 'search'
    ? shownBoard.error === 'timeout' ? text.searchTimeout : shownBoard.error === 'unavailable' ? text.searchUnavailable : shownBoard.error === 'failed' ? text.searchError : null
    : null
  const hasResultContext = Boolean(query.trim() || neighbors || selected || webglError || snapshotStatus === 'integrity' || snapshotStatus === 'unavailable')
  useEffect(() => { setSheetOpen(Boolean(query.trim() || selectedId || neighbors || webglError || snapshotStatus === 'integrity' || snapshotStatus === 'unavailable')) }, [query, searchMode, selectedId, neighbors, webglError, snapshotStatus])
  useEffect(() => {
    const panel = resultsOverlayRef.current
    const update = () => {
      const bounds = panel?.getBoundingClientRect()
      rendererRef.current?.setOcclusion(bounds ? (mobile ? 0 : bounds.width + 24) : 0, bounds ? (mobile ? bounds.height + 12 : 0) : 0)
    }
    update()
    if (!panel) return
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [sheetOpen, hasResultContext, mobile, rendererReady])
  const side = (
    <div id="explorer-results" tabIndex={-1}>
      <div className="count-row" hidden={showDetails}>
        {activeMode === 'similarity' ? (
          <>
            <h2 className="count-heading">{text.snapshotSimilar}</h2>
            {graphAnchor ? <button className="similarity-anchor" onClick={() => selectRef.current(graphAnchor.id)}>{displayTitle(sourceTitle(graphAnchor.sourceTitle), text.untitled)}</button> : null}
            <p>{formatMessage(text.similarCount, { count: neighborItems.length })}</p>
            <button type="button" className="btn panel-back" onClick={() => { setNeighbors(null); setGraphAnchor(null); setSelectedId(null) }}>{text.back}</button>
          </>
        ) : (
          <>

            {activeReturnedCount != null ? <p>{formatMessage(text.returnedCount, { count: activeReturnedCount })}</p> : null}
            {projection?.dropped ? <p className="help-copy">{formatMessage(text.warningDropped, { count: projection.dropped })}</p> : null}
            {shownBoard.degraded ? (
              <p className="help-copy">
                {shownBoard.degradedBranches.includes('visual') ? text.degradedVisual
                  : shownBoard.degradedBranches.includes('semantic') ? text.degradedSemantic
                    : text.degraded}
              </p>
            ) : null}
          </>
        )}
      </div>
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
          onCopyCitation={copyCitation}
          onToggleSave={toggleSave}
          onSimilar={() => { void findSimilar() }}
        />
      ) : (
        <ResultsPanel
          text={text}
          items={listItems}
          selectedId={selectedId}
          searching={shownBoard.searching && activeMode === 'search'}
          query={query}
          error={searchError}
          empty={emptyMessage}
          origin={apiOrigin()}
          onSelect={(id) => selectRef.current(id)}
          onRetry={searchError ? () => setRetryToken((value) => value + 1) : undefined}
        />
      )}
    </div>
  )

  return (
    <div className="explorer-app">
      <div className="explorer-content">
      <Shell
        text={text}
        lang={lang}
        theme={theme}
        homeHref={mainSiteHome(lang)}
        query={query}
        searchMode={searchMode}
        view={view}
        colorMode={colorMode}
        legacyLayout={snapshot?.legacyLayout ?? false}
        exportCount={(selected ? [selected] : listItems).length}
        exportContext={selected ? text.selectedPhoto : neighbors ? text.snapshotSimilar : text.results}
        onExportCsv={() => exportCsv(selected ? [selected] : listItems)}
        onExportJson={() => exportJson(selected ? [selected] : listItems)}
        onColor={setColorMode}
        advancedOpen={advancedOpen}
        onQuery={(value) => { setNeighbors(null); setSelectedId(null); setQuery(value); if (!value.trim()) rendererRef.current?.reset() }}
        onSearchMode={(mode) => { setNeighbors(null); setSelectedId(null); setSearchMode(mode) }}
        onView={(next) => { setView(next); events.viewModeChanged(next) }}
        onLang={setLang}
        onTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        onReset={() => rendererRef.current?.reset()}
        onAbout={() => { rememberOverlayFocus(); setAboutOpen(true); setAdvancedOpen(false) }}
        onAdvanced={() => { rememberOverlayFocus(); setAdvancedOpen((open) => !open); setAboutOpen(false) }}
        onCollection={() => { rememberOverlayFocus(); setCollectionOpen(true) }}
        collectionActive={collectionOpen}
        onSkip={() => {
          setSheetOpen(true)
          window.setTimeout(() => document.getElementById('explorer-results')?.focus(), 0)
        }}
      />
      <p className="map-sentence"><span className="map-sentence-copy">{text.mapSentence}</span><span className="interaction-hint">{view === '3d' ? text.interaction3d : text.interaction2d}</span></p>
      <div className={`explorer-body${hasResultContext && sheetOpen ? ' results-visible' : ''}`}>
        <div className="map-stage">
          <div ref={containerRef} className="explorer-canvas" role="group" aria-label={text.mapLabel} />
          {webglError ? (
            <div className="webgl-fallback" role="status">
              <h2>{text.webglTitle}</h2>
              <p>{text.webglBody}</p>
            </div>
          ) : null}
          {loadingSnapshot && !webglError ? <p className="map-status" role="status">{text.loadingSnapshot}</p> : null}
          <div className="map-controls" aria-label={text.view}>
            {mobile ? <button type="button" className="btn icon-btn" title={text.resetView} aria-label={text.resetView} onClick={() => rendererRef.current?.reset()}>↺</button> : null}
            <button type="button" className="btn icon-btn" title={text.zoomOut} aria-label={text.zoomOut} onClick={() => rendererRef.current?.zoomOut()}>−</button>
            <button type="button" className="btn icon-btn" title={text.zoomIn} aria-label={text.zoomIn} onClick={() => rendererRef.current?.zoomIn()}>+</button>
            <label className="map-decade-control">
              <span className="sr-only">{text.decade}</span>
              <select value={decade} aria-label={text.decade} onChange={(event) => setDecade(event.target.value)}>
                <option value="all">{text.decadeAll}</option>
                <option value="undated">{text.decadeUndated}</option>
                {decades.map((value) => <option key={value} value={String(value)}>{value}s</option>)}
              </select>
            </label>
          </div>
          {(query.trim() || neighbors) ? <div className="graph-toolbar">
            <Button variant="outline" size="sm" aria-pressed={lines} title={text.webHelp} onClick={() => setLines((value) => !value)}><Network aria-hidden="true" />{text.similarityWeb}</Button>
            {lines ? <span role="status">{(loadingSnapshot || shownBoard.searching || graphStatus === 'loading') ? text.webLoading : graphStatus === 'error' ? text.webError : mappedEdgeCount ? formatMessage(text.webConnections, { count: mappedEdgeCount }) : text.webEmpty}</span> : null}
            {lines && graphStatus === 'error' ? <Button variant="ghost" size="sm" onClick={() => setGraphRetry((value) => value + 1)}>{text.retry}</Button> : null}
          </div> : null}
          {colorMode === 'date' ? (
            <div className={`map-legend${sheetOpen ? ' sheet-open' : ''}`} aria-label={text.legendDate}>
              <strong>{text.legendDate}</strong>
              <div className="legend-items">
                {decades.map((year) => {
                  const color = dateColorForYear(year, theme)
                  return <span key={year}><i style={{ backgroundColor: `rgb(${color.join(',')})` }} />{year}s</span>
                })}
              </div>
              <span className="legend-undated"><i />{text.legendUndated}</span>
            </div>
          ) : null}
          {hoverTitle && !mobile ? <p className="hover-label">{hoverTitle}</p> : null}
        </div>
        {hasResultContext ? (
          sheetOpen ? <aside ref={resultsOverlayRef} className="results-overlay" aria-label={selected ? text.selectedPhoto : text.results}>
            <div className="results-overlay-heading">
              <span>{selected ? text.selectedPhoto : neighbors ? text.snapshotSimilar : query}</span>
              <Button variant="ghost" size="icon-sm" aria-label={text.hideResults} onClick={() => { setSheetOpen(false); window.requestAnimationFrame(() => document.getElementById('show-explorer-results')?.focus()) }}><X aria-hidden="true" /></Button>
            </div>
            {side}
          </aside> : <Button id="show-explorer-results" className="results-reopen" variant="outline" size="sm" aria-controls="explorer-results" aria-expanded={false} onClick={() => { setSheetOpen(true); window.requestAnimationFrame(() => document.getElementById('explorer-results')?.focus()) }}><PanelRightOpen aria-hidden="true" />{selected ? text.selectedPhoto : text.openResults}{!selected && activeReturnedCount != null ? ` · ${activeReturnedCount}` : ''}</Button>
        ) : null}
        </div>
      </div>
      <Sheet open={collectionOpen} onOpenChange={setCollectionOpen}>
        <SheetContent className="collection-sheet" closeLabel={text.closeCollection} onCloseAutoFocus={restoreOverlayFocus}>
          <SheetHeader><SheetTitle><Bookmark aria-hidden="true" />{text.collection} <span>{collection.length}</span></SheetTitle><SheetDescription>{text.collectionLocal}</SheetDescription></SheetHeader>
          <div className="collection-export"><Button variant="outline" size="sm" disabled={!collectionItems.length} onClick={() => downloadLocalFile('mtl-explorer-collection.csv', resultsToCsv(exportRows(collectionItems)), 'text/csv;charset=utf-8')}>{text.exportCsv}</Button><Button variant="outline" size="sm" disabled={!collectionItems.length} onClick={() => downloadLocalFile('mtl-explorer-collection.json', resultsToJson({exportedAt: new Date().toISOString(), query: '', searchMode: 'collection', returnedCount: collectionItems.length, snapshotCount: projection?.count ?? 0, rows: exportRows(collectionItems)}), 'application/json')}>{text.exportJson}</Button></div>
          <ResultsPanel text={text} items={collectionItems} selectedId={selectedId} searching={false} query="" error={null} empty={text.collectionEmpty} origin={apiOrigin()} onSelect={(id) => { setCollectionOpen(false); selectRef.current(id) }} />
        </SheetContent>
      </Sheet>
      <ResearchControls
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
          onClose={() => setAdvancedOpen(false)}
          onCloseAutoFocus={restoreOverlayFocus}
          onSearchMode={(mode) => { setNeighbors(null); setSelectedId(null); setSearchMode(mode) }}
          onColor={setColorMode}
          onLines={setLines}
          onAnomalies={setAnomalies}
          onRotate={setRotate}
          onDecade={setDecade}
        />
        <AboutPanel
          text={text}
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          onCloseAutoFocus={restoreOverlayFocus}
          sourceLabel={snapshot == null ? text.snapshotUnavailable : snapshot.source === 'manifest' ? text.aboutManifest : text.aboutLegacy}
          snapshotCount={projection?.count ?? 0}
          modelId={snapshot?.modelId ?? null}
          indexId={snapshot?.indexId ?? null}
          generatedAt={snapshot?.generatedAt ?? null}
          vectorLabel={snapshot?.vectorHeader ? `${snapshot.vectorHeader.count} × ${snapshot.vectorHeader.dimensions}` : text.vectorUnread}
          returnedCount={activeReturnedCount}
          dropped={projection?.dropped ?? 0}
        />
      {toast ? <p className="toast" role="status">{toast}</p> : null}
    </div>
  )
}
