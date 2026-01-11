'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import Image from 'next/image';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';

const API_BASE = '';

// Conservative limits for mobile
const MOBILE_PAGE_SIZE = 9;
const MOBILE_MAX_IMAGES = 27;
const DESKTOP_PAGE_SIZE = 20;

// ============================================================
// Translations
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
// Main Component
// ============================================================
export function ArchiveStore() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ArchiveStoreInner />
    </Suspense>
  );
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
      <div className="h-6 w-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
    </div>
  );
}

function ArchiveStoreInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Detect mobile ONCE on mount
  const [isMobile, setIsMobile] = useState(true); // Default to mobile-safe
  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    setIsMobile(mobile);
  }, []);

  // State from URL
  const initialQuery = searchParams.get('q') || '';
  const initialMode = (searchParams.get('mode') as SearchMode) || 'semantic';
  const initialLang = (searchParams.get('lang') as Lang) || 'fr';

  const [lang, setLang] = useState<Lang>(initialLang);
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  // URL helper
  const updateUrl = useCallback((q: string, mode: SearchMode, currentLang: Lang) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'semantic') params.set('mode', mode);
    if (currentLang !== 'fr') params.set('lang', currentLang);
    router.replace(params.toString() ? `/?${params}` : '/', { scroll: false });
  }, [router]);

  // Placeholder animation
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const placeholders = lang === 'fr'
    ? ['Rue Sainte-Catherine...', 'tramway...', 'Vieux-Port...', '14 822 photos...']
    : ['Sainte-Catherine Street...', 'tramway...', 'Old Port...', '14,822 photos...'];

  useEffect(() => {
    if (searchQuery) return;
    const interval = setInterval(() => setPlaceholderIndex(i => (i + 1) % placeholders.length), 3000);
    return () => clearInterval(interval);
  }, [searchQuery, placeholders.length]);

  // Load initial photos
  useEffect(() => {
    const pageSize = isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
    fetch(`${API_BASE}/api/photos?limit=${pageSize}`)
      .then(res => res.json())
      .then(data => {
        setPhotos(data.items || []);
        setNextCursor(data.nextCursor || null);
      })
      .catch(err => console.error('Failed to fetch:', err))
      .finally(() => setInitialLoading(false));
  }, [isMobile]);

  // Load more
  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;

    // On mobile, enforce max limit
    if (isMobile && photos.length >= MOBILE_MAX_IMAGES) return;

    setIsLoadingMore(true);
    try {
      const pageSize = isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
      const res = await fetch(`${API_BASE}/api/photos?limit=${pageSize}&cursor=${encodeURIComponent(nextCursor)}`);
      const data = await res.json();
      const newItems: PhotoRecord[] = data.items || [];

      setPhotos(prev => {
        const existing = new Set(prev.map(p => p.metadataFilename));
        const unique = newItems.filter(p => !existing.has(p.metadataFilename));
        const combined = [...prev, ...unique];
        // Enforce mobile limit
        if (isMobile && combined.length > MOBILE_MAX_IMAGES) {
          return combined.slice(0, MOBILE_MAX_IMAGES);
        }
        return combined;
      });
      setNextCursor(data.nextCursor || null);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore, isMobile, photos.length]);

  // Search (semantic only on mobile - no CLIP)
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
        // On mobile, force semantic mode (no CLIP)
        const mode = isMobile ? 'semantic' : searchMode;
        const params = new URLSearchParams({ q: searchQuery, mode, limit: isMobile ? '20' : '50' });
        const res = await fetch(`${API_BASE}/api/search?${params}`);
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
  }, [searchQuery, searchMode, updateUrl, lang, initialQuery, isMobile]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    updateUrl('', searchMode, lang);
    searchInputRef.current?.focus();
  }, [updateUrl, searchMode, lang]);

  // Dedupe
  const displayPhotos = useMemo(() => {
    const source = hasSearched ? searchResults : photos;
    const seen = new Set<string>();
    return source.filter(p => {
      if (seen.has(p.metadataFilename)) return false;
      seen.add(p.metadataFilename);
      return true;
    });
  }, [hasSearched, searchResults, photos]);

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
    // On mobile, ignore visual mode
    if (isMobile && newMode === 'visual') return;
    setSearchMode(newMode);
    if (searchQuery) updateUrl(searchQuery, newMode, lang);
  }, [searchQuery, lang, updateUrl, isMobile]);

  const canLoadMore = nextCursor && !hasSearched && (!isMobile || photos.length < MOBILE_MAX_IMAGES);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm border-b border-neutral-100">
        {/* Mobile */}
        <div className="flex flex-col sm:hidden">
          <div className="flex items-center justify-between h-11 px-3">
            <a href="/" className="text-[11px] font-medium tracking-[0.1em] uppercase">MTL Archives</a>
            <div className="flex items-center gap-2">
              <button onClick={handleLangChange} className="p-1">
                {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              </button>
              <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="text-[10px] text-neutral-400">@mtlarchives</a>
            </div>
          </div>
          <div className="px-3 pb-2.5">
            <div className="flex items-center bg-white border border-neutral-200 h-10 rounded-sm">
              <Search className="ml-3 h-4 w-4 text-neutral-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={placeholders[placeholderIndex]}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="flex-1 px-2 text-[15px] bg-transparent outline-none placeholder:text-neutral-300"
              />
              {isSearching && <div className="mr-3 h-4 w-4 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />}
              {searchQuery && !isSearching && (
                <button onClick={clearSearch} className="mr-2 p-1">
                  <X className="h-4 w-4 text-neutral-400" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden sm:flex items-center h-14 px-4 lg:px-6 gap-4">
          <a href="/" className="text-xs font-medium tracking-[0.12em] uppercase">MTL Archives</a>
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-lg">
              <div className="flex items-center bg-white border border-neutral-200 h-9">
                <Search className="ml-3 h-3.5 w-3.5 text-neutral-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={placeholders[placeholderIndex]}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="flex-1 px-2.5 text-sm bg-transparent outline-none placeholder:text-neutral-300"
                />
                {isSearching && <div className="mr-3 h-3.5 w-3.5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />}
                {searchQuery && !isSearching && (
                  <button onClick={clearSearch} className="mr-2 p-0.5">
                    <X className="h-3.5 w-3.5 text-neutral-400" />
                  </button>
                )}
                <div className="flex border-l border-neutral-200 h-full">
                  <button onClick={() => handleModeChange('semantic')} className={`px-3 text-[10px] uppercase ${searchMode === 'semantic' ? 'bg-neutral-900 text-white' : 'text-neutral-400'}`}>{t.textSearch}</button>
                  <button onClick={() => handleModeChange('visual')} className={`px-3 text-[10px] uppercase ${searchMode === 'visual' ? 'bg-neutral-900 text-white' : 'text-neutral-400'}`}>{t.visualSearch}</button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleLangChange} className="flex items-center gap-1.5 px-2 py-1">
              {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              <span className="text-[10px] text-neutral-500 uppercase">{lang === 'fr' ? 'EN' : 'FR'}</span>
            </button>
            <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="text-[10px] text-neutral-400">@mtlarchives</a>
          </div>
        </div>
      </header>

      {/* Results header */}
      <div className="flex items-center justify-between py-2 px-2 sm:px-3">
        {hasSearched ? (
          <>
            <span className="text-xs text-neutral-400 uppercase">{searchResults.length} {searchResults.length === 1 ? t.result : t.results}</span>
            <button onClick={clearSearch} className="text-xs text-neutral-400 uppercase">{t.clear}</button>
          </>
        ) : (
          <span className="text-xs text-neutral-400 uppercase">{t.featured}</span>
        )}
      </div>

      {/* Empty state */}
      {hasSearched && searchResults.length === 0 && !isSearching && (
        <div className="text-center py-16 px-4">
          <p className="text-neutral-500 text-sm mb-3">{t.noResults} &ldquo;{searchQuery}&rdquo;</p>
          <button onClick={clearSearch} className="text-xs text-neutral-400 underline uppercase">{t.clearSearch}</button>
        </div>
      )}

      {/* Loading */}
      {initialLoading && (
        <div className="text-center py-16">
          <div className="inline-block h-5 w-5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
        </div>
      )}

      {/* Simple Grid - Using Next.js Image for automatic optimization */}
      {!initialLoading && displayPhotos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5 px-0.5">
          {displayPhotos.map(photo => (
            <button
              key={photo.metadataFilename}
              onClick={() => handlePhotoClick(photo)}
              className="relative aspect-square bg-neutral-100 overflow-hidden"
            >
              {photo.imageUrl && (
                <Image
                  src={photo.imageUrl}
                  alt={photo.name || ''}
                  fill
                  sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 14vw"
                  className="object-cover"
                  loading="lazy"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {canLoadMore && (
        <div className="flex justify-center py-8">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className="px-6 py-2.5 bg-neutral-900 text-white text-xs uppercase tracking-wide disabled:opacity-50"
          >
            {isLoadingMore ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              t.loadMore
            )}
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 px-4 text-center">
        <p className="text-xs text-neutral-300 uppercase">© {new Date().getFullYear()} MTL Archives</p>
      </footer>
    </div>
  );
}
