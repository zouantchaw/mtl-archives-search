'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { useClipEmbedding } from '@/lib/use-clip';
import { useVirtualizer } from '@tanstack/react-virtual';

const API_BASE = '';

// Grid configuration
const IMAGES_PER_PAGE = 30;

// Detect mobile
const getIsMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
};

// ============================================================
// Flag Icons
// ============================================================
function FlagQC() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" className="rounded-[2px] shadow-sm">
      <rect width="20" height="14" fill="#003DA5" />
      <path d="M10 0v14M0 7h20" stroke="white" strokeWidth="2" />
      <circle cx="5" cy="3.5" r="1.2" fill="white" />
      <circle cx="15" cy="3.5" r="1.2" fill="white" />
      <circle cx="5" cy="10.5" r="1.2" fill="white" />
      <circle cx="15" cy="10.5" r="1.2" fill="white" />
    </svg>
  );
}

function FlagEN() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" className="rounded-[2px] shadow-sm">
      <rect width="20" height="14" fill="white" />
      <path d="M10 0v14M0 7h20" stroke="#C8102E" strokeWidth="2.5" />
    </svg>
  );
}

// ============================================================
// i18n
// ============================================================
type Lang = 'fr' | 'en';

const translations = {
  fr: {
    textSearch: 'Texte',
    visualSearch: 'Visuel',
    featured: 'A la une',
    results: 'resultats',
    result: 'resultat',
    clear: 'Effacer',
    noResults: 'Aucune photo trouvee pour',
    clearSearch: 'Effacer la recherche',
    loadMore: 'Voir plus',
  },
  en: {
    textSearch: 'Text',
    visualSearch: 'Visual',
    featured: 'Featured',
    results: 'results',
    result: 'result',
    clear: 'Clear',
    noResults: 'No photos found for',
    clearSearch: 'Clear search',
    loadMore: 'Load more',
  },
} as const;

// ============================================================
// Thumbnail URL builder
// ============================================================
function getThumbnailUrl(src: string, size: number): string {
  if (!src) return '';
  const params = new URLSearchParams({
    src,
    w: String(size),
    h: String(size),
    fit: 'cover',
    format: 'webp',
    q: '75'
  });
  return `${API_BASE}/api/thumb?${params}`;
}

// ============================================================
// Main Component
// ============================================================
export function ArchiveStore() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fafafa] flex items-center justify-center"><div className="h-6 w-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" /></div>}>
      <ArchiveStoreInner />
    </Suspense>
  );
}

function ArchiveStoreInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL
  const initialQuery = searchParams.get('q') || '';
  const initialMode = (searchParams.get('mode') as SearchMode) || 'semantic';
  const initialLang = (searchParams.get('lang') as Lang) || 'fr';

  // State
  const [lang, setLang] = useState<Lang>(initialLang);
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode);
  const [searchResults, setSearchResults] = useState<PhotoRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(!!initialQuery);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const t = translations[lang];

  // CLIP
  const { generateEmbedding, preloadModel, isModelReady } = useClipEmbedding();
  const [clipModelLoading, setClipModelLoading] = useState(false);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);
  const parentRef = useRef<HTMLDivElement>(null);

  // Detect mobile
  useEffect(() => {
    setIsMobile(getIsMobile());
    const handleResize = () => setIsMobile(getIsMobile());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate columns based on screen width
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width < 640) setColumns(3);
      else if (width < 768) setColumns(4);
      else if (width < 1024) setColumns(5);
      else if (width < 1280) setColumns(6);
      else if (width < 1536) setColumns(7);
      else setColumns(8);
    };
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  // URL update helper
  const updateUrl = useCallback((q: string, mode: SearchMode, currentLang: Lang) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'semantic') params.set('mode', mode);
    if (currentLang !== 'fr') params.set('lang', currentLang);
    const newUrl = params.toString() ? `/?${params}` : '/';
    router.replace(newUrl, { scroll: false });
  }, [router]);

  // Placeholder animation
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const placeholders = lang === 'fr' ? [
    'Rue Sainte-Catherine...',
    'eglise en hiver...',
    'tramway annees 50...',
    'Vieux-Port de Montreal...',
    '14 822 photos...',
  ] : [
    'Sainte-Catherine Street...',
    'church in winter...',
    '1950s tramway...',
    'Old Port of Montreal...',
    '14,822 photos...',
  ];

  useEffect(() => {
    if (searchQuery) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [searchQuery, placeholders.length]);

  // Load initial photos
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/photos?limit=${IMAGES_PER_PAGE}`);
        if (res.ok) {
          const data = await res.json();
          setPhotos(data.items || []);
          setNextCursor(data.nextCursor || null);
        }
      } catch (err) {
        console.error('Failed to fetch photos:', err);
      } finally {
        setInitialLoading(false);
      }
    };
    fetchInitial();
  }, []);

  // Load more
  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`${API_BASE}/api/photos?limit=${IMAGES_PER_PAGE}&cursor=${encodeURIComponent(nextCursor)}`);
      if (res.ok) {
        const data = await res.json();
        const newItems: PhotoRecord[] = data.items || [];
        setPhotos(prev => {
          const existingKeys = new Set(prev.map(p => p.metadataFilename));
          const unique = newItems.filter(p => !existingKeys.has(p.metadataFilename));
          return [...prev, ...unique];
        });
        setNextCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore]);

  // Preload CLIP on desktop
  useEffect(() => {
    if (searchMode === 'visual' && !isMobile && !isModelReady) {
      setClipModelLoading(true);
      preloadModel().finally(() => setClipModelLoading(false));
    }
  }, [searchMode, preloadModel, isMobile, isModelReady]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      if (!isInitialMount.current) updateUrl('', searchMode, lang);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setHasSearched(true);
      if (!isInitialMount.current || !initialQuery) updateUrl(searchQuery, searchMode, lang);
      isInitialMount.current = false;

      try {
        const params = new URLSearchParams({ q: searchQuery, mode: searchMode, limit: '50' });
        let res: Response;

        if (searchMode === 'visual') {
          const embedding = await generateEmbedding(searchQuery);
          if (!embedding) { setSearchResults([]); return; }
          res = await fetch(`${API_BASE}/api/search?${params}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embedding }),
          });
        } else {
          res = await fetch(`${API_BASE}/api/search?${params}`);
        }

        if (res.ok) {
          const data: SearchResponse = await res.json();
          setSearchResults(data.items);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery, searchMode, generateEmbedding, updateUrl, lang, initialQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    updateUrl('', searchMode, lang);
    searchInputRef.current?.focus();
  }, [updateUrl, searchMode, lang]);

  // Deduplicate
  const uniquePhotos = useMemo(() => {
    const seen = new Set<string>();
    return photos.filter(p => {
      if (seen.has(p.metadataFilename)) return false;
      seen.add(p.metadataFilename);
      return true;
    });
  }, [photos]);

  const uniqueSearchResults = useMemo(() => {
    const seen = new Set<string>();
    return searchResults.filter(p => {
      if (seen.has(p.metadataFilename)) return false;
      seen.add(p.metadataFilename);
      return true;
    });
  }, [searchResults]);

  const displayPhotos = hasSearched ? uniqueSearchResults : uniquePhotos;

  // Group into rows
  const rows = useMemo(() => {
    const result: PhotoRecord[][] = [];
    for (let i = 0; i < displayPhotos.length; i += columns) {
      result.push(displayPhotos.slice(i, i + columns));
    }
    return result;
  }, [displayPhotos, columns]);

  // Virtualizer - only render visible rows
  const rowVirtualizer = useVirtualizer({
    count: rows.length + (nextCursor && !hasSearched ? 1 : 0), // +1 for load more
    getScrollElement: () => parentRef.current,
    estimateSize: () => {
      // Estimate row height based on column width
      if (typeof window === 'undefined') return 120;
      const gap = 2;
      const containerWidth = parentRef.current?.clientWidth || window.innerWidth;
      const itemWidth = (containerWidth - gap * (columns - 1)) / columns;
      return itemWidth + gap;
    },
    overscan: 2,
  });

  // Navigate to photo
  const handlePhotoClick = useCallback((photo: PhotoRecord) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchMode !== 'semantic') params.set('mode', searchMode);
    if (lang !== 'fr') params.set('lang', lang);
    router.push(`/photo/${encodeURIComponent(photo.metadataFilename)}${params.toString() ? `?${params}` : ''}`);
  }, [router, searchQuery, searchMode, lang]);

  const handleLangChange = useCallback(() => {
    const newLang = lang === 'fr' ? 'en' : 'fr';
    setLang(newLang);
    if (searchQuery) updateUrl(searchQuery, searchMode, newLang);
  }, [lang, searchQuery, searchMode, updateUrl]);

  const handleModeChange = useCallback((newMode: SearchMode) => {
    setSearchMode(newMode);
    if (searchQuery) updateUrl(searchQuery, newMode, lang);
  }, [searchQuery, lang, updateUrl]);

  const thumbSize = isMobile ? 200 : 400;

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm border-b border-neutral-100 shrink-0">
        {/* Mobile */}
        <div className="flex flex-col sm:hidden">
          <div className="flex items-center justify-between h-11 px-3">
            <a href="/" className="text-[11px] font-medium tracking-[0.1em] uppercase">MTL Archives</a>
            <div className="flex items-center gap-2">
              <button onClick={handleLangChange} className="flex items-center gap-1 px-1.5 py-1 hover:bg-neutral-100 rounded transition-colors">
                {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              </button>
              <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="text-[10px] tracking-wide text-neutral-400">@mtlarchives</a>
            </div>
          </div>
          <div className="px-3 pb-2.5">
            <div className="flex items-center bg-white border border-neutral-200 focus-within:border-neutral-400 transition-colors h-10 rounded-sm">
              <Search className="ml-3 h-4 w-4 text-neutral-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={placeholders[placeholderIndex]}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-2 text-[15px] bg-transparent outline-none placeholder:text-neutral-300"
              />
              {isSearching && <div className="mr-3 h-4 w-4 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin shrink-0" />}
              {searchQuery && !isSearching && (
                <button onClick={clearSearch} className="mr-2 p-1 hover:bg-neutral-100 rounded">
                  <X className="h-4 w-4 text-neutral-400" />
                </button>
              )}
              <div className="flex border-l border-neutral-200 h-full">
                <button onClick={() => handleModeChange('semantic')} className={`px-3 text-[10px] uppercase tracking-wide transition-colors ${searchMode === 'semantic' ? 'bg-neutral-900 text-white' : 'text-neutral-400'}`}>{t.textSearch}</button>
                <button onClick={() => handleModeChange('visual')} className={`px-3 text-[10px] uppercase tracking-wide transition-colors flex items-center gap-1 ${searchMode === 'visual' ? 'bg-neutral-900 text-white' : 'text-neutral-400'}`}>
                  {clipModelLoading && searchMode === 'visual' && <div className="h-2.5 w-2.5 border border-current border-t-transparent rounded-full animate-spin" />}
                  {t.visualSearch}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden sm:flex items-center h-14 px-4 lg:px-6 gap-4 lg:gap-6">
          <a href="/" className="text-xs font-medium tracking-[0.12em] uppercase shrink-0">MTL Archives</a>
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl">
              <div className="flex items-center bg-white border border-neutral-200 focus-within:border-neutral-400 transition-colors h-9">
                <Search className="ml-3 h-3.5 w-3.5 text-neutral-400 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={placeholders[placeholderIndex]}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 px-2.5 text-sm bg-transparent outline-none placeholder:text-neutral-300"
                />
                {isSearching && <div className="mr-3 h-3.5 w-3.5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin shrink-0" />}
                {searchQuery && !isSearching && (
                  <button onClick={clearSearch} className="mr-2 p-0.5 hover:bg-neutral-100 rounded">
                    <X className="h-3.5 w-3.5 text-neutral-400" />
                  </button>
                )}
                <div className="flex border-l border-neutral-200 h-full">
                  <button onClick={() => handleModeChange('semantic')} className={`px-3 text-[10px] uppercase tracking-wide transition-colors ${searchMode === 'semantic' ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50'}`}>{t.textSearch}</button>
                  <button onClick={() => handleModeChange('visual')} className={`px-3 text-[10px] uppercase tracking-wide transition-colors flex items-center gap-1.5 ${searchMode === 'visual' ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50'}`}>
                    {clipModelLoading && searchMode === 'visual' && <div className="h-2.5 w-2.5 border border-current border-t-transparent rounded-full animate-spin" />}
                    {t.visualSearch}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={handleLangChange} className="flex items-center gap-1.5 px-2 py-1 hover:bg-neutral-100 rounded transition-colors">
              {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              <span className="text-[10px] text-neutral-500 uppercase">{lang === 'fr' ? 'EN' : 'FR'}</span>
            </button>
            <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="text-[10px] tracking-wide text-neutral-400 hover:text-neutral-900">@mtlarchives</a>
          </div>
        </div>
      </header>

      {/* Results header */}
      <div className="flex items-center justify-between py-2 px-2 sm:px-3 shrink-0">
        {hasSearched ? (
          <>
            <span className="text-xs text-neutral-400 uppercase tracking-wide">{searchResults.length} {searchResults.length === 1 ? t.result : t.results}</span>
            <button onClick={clearSearch} className="text-xs text-neutral-400 hover:text-neutral-900 uppercase tracking-wide">{t.clear}</button>
          </>
        ) : (
          <span className="text-xs text-neutral-400 uppercase tracking-wide">{t.featured}</span>
        )}
      </div>

      {/* Empty state */}
      {hasSearched && searchResults.length === 0 && !isSearching && (
        <div className="text-center py-16 px-4">
          <p className="text-neutral-500 text-sm mb-3">{t.noResults} &ldquo;{searchQuery}&rdquo;</p>
          <button onClick={clearSearch} className="text-xs text-neutral-400 hover:text-neutral-900 underline underline-offset-4 uppercase tracking-wide">{t.clearSearch}</button>
        </div>
      )}

      {/* Initial loading */}
      {initialLoading && (
        <div className="text-center py-16">
          <div className="inline-block h-5 w-5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      )}

      {/* Virtualized Grid */}
      {!initialLoading && displayPhotos.length > 0 && (
        <div ref={parentRef} className="flex-1 overflow-auto" style={{ contain: 'strict' }}>
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= rows.length;

              if (isLoaderRow) {
                return (
                  <div
                    key="loader"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex justify-center items-center"
                  >
                    <button
                      onClick={loadMore}
                      disabled={isLoadingMore}
                      className="px-6 py-2.5 bg-neutral-900 text-white text-xs uppercase tracking-wide hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                    >
                      {isLoadingMore ? (
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        t.loadMore
                      )}
                    </button>
                  </div>
                );
              }

              const row = rows[virtualRow.index];
              return (
                <div
                  key={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: '2px',
                  }}
                >
                  {row.map((photo) => (
                    <button
                      key={photo.metadataFilename}
                      onClick={() => handlePhotoClick(photo)}
                      className="relative aspect-square bg-neutral-100 overflow-hidden focus:outline-none"
                      aria-label={photo.name || 'Archive photo'}
                    >
                      {photo.imageUrl && (
                        <img
                          src={getThumbnailUrl(photo.imageUrl, thumbSize)}
                          alt={photo.name || ''}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 px-4 text-center shrink-0">
        <p className="text-xs text-neutral-300 uppercase tracking-wide">© {new Date().getFullYear()} MTL Archives</p>
      </footer>
    </div>
  );
}
