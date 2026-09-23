import { describe, expect, it } from 'vitest'
import { parseArchiveDate, yearToZ } from './dates'
import { resultsToCsv } from './export-results'
import { mainSiteHome, mainSiteRecord, officialSourceUrl } from './links'
import { buildProjection, focusableIds, locateRecord } from './projection'
import { displayTitle } from './titles'
import { imageIsBroken, imageKey } from './images'
import { beginSearch, boardKey, commitSearchFailure, commitSearchSuccess, emptyBoard, visibleBoard, SearchSession, normalizeSearchResponse } from './search'
import { resolveSnapshotBase, rewriteSnapshotPath } from './snapshot-proxy'
import { parseExplorerSearch, serializeExplorerSearch, withLocale } from './url-state'

describe('archive dates', () => {
  it('parses snapshot dates and refuses titles', () => {
    expect(parseArchiveDate('1932')).toMatchObject({ status: 'year', year: 1932 })
    expect(parseArchiveDate('1947-1949')).toMatchObject({ status: 'range', year: 1947 })
    expect(parseArchiveDate('Décennie 1920')).toMatchObject({ status: 'decade', year: 1920 })
    expect(parseArchiveDate('Années 1930')).toMatchObject({ status: 'decade', year: 1930 })
    expect(parseArchiveDate('1930s')).toMatchObject({ status: 'decade', year: 1930 })
    expect(parseArchiveDate('24 juin 1925')).toMatchObject({ status: 'date', year: 1925 })
    expect(parseArchiveDate('08-avr.-36')).toMatchObject({ status: 'date', year: 1936 })
    expect(parseArchiveDate('Printemps 1929')).toMatchObject({ status: 'year', year: 1929 })
    expect(parseArchiveDate('')).toMatchObject({ status: 'missing', year: null })
    expect(parseArchiveDate(null)).toMatchObject({ status: 'missing', year: null })
    expect(parseArchiveDate('Rue Saint-Antoine').year).toBeNull()
    expect(parseArchiveDate('1201').year).toBeNull()
    const titled = 'Pont Papineau-Leblanc / Rhéal Benny . - 28 septembre 1972'
    expect(parseArchiveDate(titled)).toMatchObject({ status: 'unparsed', year: null, source: titled })
    expect(parseArchiveDate('Eglise Saint-Pierre (1201, rue de la Visitation)').year).toBeNull()
  })

  it('places missing dates apart from dated photographs without random coordinates', () => {
    expect(yearToZ(null, 'mtl_archives_metadata_1.json')).toBeLessThan(0)
    expect(yearToZ(1947, 'same')).toBeGreaterThan(yearToZ(1920, 'same'))
    expect(yearToZ(1932, 'same-id')).toBe(yearToZ(1932, 'same-id'))
  })
})

describe('projection', () => {
  it('keeps unprojected records out of the map', () => {
    const index = buildProjection([
      { id: 'on-map', x: 0.25, y: 0.5, name: 'Rue', date: '1932', imageUrl: null, caption: null },
      { id: 'bad', x: Number.NaN, y: 0.2, name: null, date: null, imageUrl: null, caption: null },
    ])
    const missing = locateRecord({ id: 'worker-only', sourceTitle: 'Escalier' }, index)
    expect(missing.projected).toBe(false)
    expect(missing).not.toHaveProperty('x')
    expect(missing).not.toHaveProperty('y')
    expect(missing).not.toHaveProperty('z')
    expect(focusableIds(index, ['worker-only', 'on-map', 'bad'])).toEqual(['on-map'])
    expect(index.byId.has('bad')).toBe(false)
    expect(displayTitle(null, 'Untitled photograph')).toBe('Untitled photograph')
  })
})

describe('search normalization', () => {
  it('keeps returned counts and does not treat scores as confidence', () => {
    const normalized = normalizeSearchResponse({
      mode: 'smart',
      count: 1,
      countKind: 'returned',
      degraded: false,
      items: [{
        metadataFilename: 'mtl_archives_metadata_7.json',
        name: null,
        portalTitle: null,
        dateValue: '1930s',
        imageUrl: 'https://example.test/7.jpg',
        score: 0.41,
        rankingScore: 0.016,
        branchScores: { semantic: 0.41 },
        source: 'semantic',
      }],
    })
    expect(normalized.returnedCount).toBe(1)
    expect(normalized.countKind).toBe('returned')
    expect(normalized.items[0]?.year).toBe(1930)
    expect(normalized.items[0]?.sourceTitle).toBeNull()
    expect(normalized.items[0]?.vectorScore).toBe(0.41)
    expect('confidence' in (normalized.items[0] ?? {})).toBe(false)
  })

  it('drops a stale response when a newer search starts', async () => {
    const session = new SearchSession()
    const first = session.start()
    const order: string[] = []
    const firstTask = new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(session.isCurrent(first.id) ? 'first' : null), 20)
    })
    const second = session.start()
    expect(first.signal.aborted).toBe(true)
    expect(session.isCurrent(first.id)).toBe(false)
    expect(session.isCurrent(second.id)).toBe(true)
    order.push(await firstTask ?? 'stale')
    order.push(session.isCurrent(second.id) ? 'second' : 'lost')
    expect(order).toEqual(['stale', 'second'])
  })
})

describe('url and locale', () => {
  it('reloads view, language, and selection without dropping the query', () => {
    const parsed = parseExplorerSearch('?q=tramway&mode=3d&selected=mtl_archives_metadata_7.json&lang=en')
    expect(parsed.view).toBe('3d')
    expect(parsed.q).toBe('tramway')
    expect(withLocale(parsed, 'fr')).toMatchObject({ q: 'tramway', selected: 'mtl_archives_metadata_7.json', lang: 'fr' })
    const serialized = serializeExplorerSearch({ ...parsed, lang: 'fr', theme: 'dark', search: 'visual' })
    expect(parseExplorerSearch(serialized)).toMatchObject({ q: 'tramway', view: '3d', lang: 'fr', theme: 'dark', search: 'visual' })
    expect(mainSiteHome('fr')).toBe('https://www.mtlarchives.com/')
    expect(mainSiteRecord('mtl_archives_metadata_7.json', 'en')).toBe('https://www.mtlarchives.com/photo/mtl_archives_metadata_7?lang=en')
    expect(officialSourceUrl('javascript:alert(1)')).toBeNull()
    expect(officialSourceUrl('http://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z9-1.jpg')).toContain('depot.ville.montreal.qc.ca')
  })
})

describe('search result board', () => {
  const item = (id: string) => ({ id })

  it('drops the previous list when the next query starts or fails, and ignores a stale success', () => {
    const keyA = boardKey('tramway', 'smart')
    const loaded = commitSearchSuccess(beginSearch(keyA, 1, true), 1, keyA, { items: [item('a')], returnedCount: 1, degraded: false })
    const keyB = boardKey('église', 'smart')
    const started = beginSearch<typeof loaded.results[number]>(keyB, 2, true)
    expect(visibleBoard(loaded, 'église', 'smart').results).toEqual([])
    expect(started.results).toEqual([])
    expect(started.searching).toBe(true)
    const failed = commitSearchFailure(started, 2, keyB, 'failed')
    expect(failed.results).toEqual([])
    expect(failed.error).toBe('failed')
    const stale = commitSearchSuccess(started, 1, keyA, { items: [item('a')], returnedCount: 1, degraded: false })
    expect(stale.results).toEqual([])
    expect(stale.requestId).toBe(2)
    const cleared = beginSearch(boardKey('', 'smart'), 3, false)
    expect(visibleBoard(loaded, '', 'smart').results).toEqual([])
    expect(cleared.searching).toBe(false)
    expect(emptyBoard().results).toEqual([])
  })
})

describe('image failure', () => {
  it('does not keep a broken image after the selection changes', () => {
    const broken = imageKey('bad', 'https://example.test/bad.jpg')
    expect(imageIsBroken(broken, 'bad', 'https://example.test/bad.jpg')).toBe(true)
    expect(imageIsBroken(broken, 'good', 'https://example.test/good.jpg')).toBe(false)
    expect(imageIsBroken(broken, 'bad', 'https://example.test/replaced.jpg')).toBe(false)
  })
})

describe('snapshot dev proxy', () => {
  it('uses the fixed dev prefix unless a snapshot URL is configured', () => {
    expect(resolveSnapshotBase({ dev: true })).toBe('/snapshot')
    expect(resolveSnapshotBase({ dev: false })).toBe('https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings')
    expect(resolveSnapshotBase({ dev: true, configured: 'https://example.test/custom/' })).toBe('https://example.test/custom')
    expect(rewriteSnapshotPath('/snapshot/embeddings_2d.json')).toBe('/embeddings/embeddings_2d.json')
    expect(() => rewriteSnapshotPath('/api/search')).toThrow(/snapshot-proxy-path/)
  })
})

describe('export', () => {
  it('labels scores and keeps unprojected rows', () => {
    const csv = resultsToCsv([{
      id: 'missing',
      title: 'Untitled photograph',
      dateSource: null,
      dateStatus: 'missing',
      year: null,
      cote: null,
      projected: false,
      placement: 'unprojected',
      recordUrl: 'https://www.mtlarchives.com/photo/missing',
      sourceUrl: null,
      rankingScore: 0.2,
      visualIndexScore: null,
      semanticIndexScore: null,
    }])
    expect(csv).toContain('projected')
    expect(csv).toContain('ranking_score')
    expect(csv.toLowerCase()).not.toContain('confidence')
    expect(csv).toContain('false')
  })
})
