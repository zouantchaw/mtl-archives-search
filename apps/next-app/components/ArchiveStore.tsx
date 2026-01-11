'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { useClipEmbedding } from '@/lib/use-clip';
import Image from 'next/image';

const API_BASE = '';

// Memory management: aggressive limits for mobile stability
const MAX_IMAGES_DESKTOP = 100;
const MAX_IMAGES_MOBILE = 36; // Very conservative for Safari
const IMAGES_PER_PAGE = 24;
const IMAGES_PER_PAGE_MOBILE = 12;

// Detect if we're on a low-memory device (mobile/tablet)
const getIsLowMemoryDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isSmallScreen = window.innerWidth < 768;
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
  const isLowMemory = deviceMemory !== undefined && deviceMemory < 4;
  return isMobile || isSmallScreen || isLowMemory;
};

// ============================================================
// Flag Icons
// ============================================================
function FlagQC() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" className="rounded-[2px] shadow-sm">
      <rect width="20" height="14" fill="#003DA5" />
      <path d="M10 0v14M0 7h20" stroke="white" strokeWidth="2" />
      {/* Fleur-de-lis simplified */}
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
// Photo Card - Lightweight for mobile, richer for desktop
// ============================================================
function PhotoCard({
  photo,
  getThumbnailUrl,
  priority,
  onClick,
  isLowMemory,
}: {
  photo: PhotoRecord;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
  priority: boolean;
  onClick: () => void;
  isLowMemory: boolean;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !photo.imageUrl) {
    return null;
  }

  // Smaller thumbnails on mobile
  const thumbSize = isLowMemory ? 200 : 400;
  const thumbnailUrl = getThumbnailUrl(photo.imageUrl, thumbSize, thumbSize);

  // Mobile: Use native img with loading="lazy" - much lighter than Next.js Image
  if (isLowMemory) {
    return (
      <button
        onClick={onClick}
        className="relative aspect-square bg-neutral-100 overflow-hidden focus:outline-none"
        aria-label={photo.name || 'Archive photo'}
      >
        <img
          src={thumbnailUrl}
          alt={photo.name || ''}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setHasError(true)}
          className="w-full h-full object-cover"
        />
      </button>
    );
  }

  // Desktop: Use Next.js Image for optimization
  return (
    <button
      onClick={onClick}
      className="group relative aspect-square bg-neutral-100 overflow-hidden focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-inset"
      aria-label={photo.name || 'Archive photo'}
    >
      <Image
        src={thumbnailUrl}
        alt={photo.name || ''}
        fill
        sizes="(max-width: 640px) 33vw, 200px"
        className="object-cover"
        unoptimized
        loading={priority ? 'eager' : 'lazy'}
        onError={() => setHasError(true)}
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
    </button>
  );
}

// ============================================================
// i18n - French primary, English secondary
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
// Main Component (wrapped with Suspense for useSearchParams)
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

  // Initialize state from URL params
  const initialQuery = searchParams.get('q') || '';
  const initialMode = (searchParams.get('mode') as SearchMode) || 'semantic';
  const initialLang = (searchParams.get('lang') as Lang) || 'fr';

  // Language state
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = translations[lang];

  // Memory state - detect low-memory devices
  const [isLowMemory, setIsLowMemory] = useState(false);

  useEffect(() => {
    setIsLowMemory(getIsLowMemoryDevice());
  }, []);

  // Search state - initialized from URL
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode);
  const [searchResults, setSearchResults] = useState<PhotoRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(!!initialQuery);

  // Infinite scroll state with memory limit
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // CLIP embedding - only load when actually needed
  const { generateEmbedding, preloadModel, isModelReady } = useClipEmbedding();
  const [clipModelLoading, setClipModelLoading] = useState(false);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  // Update URL when search params change (but not on initial mount)
  const updateUrl = useCallback((q: string, mode: SearchMode, currentLang: Lang) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'semantic') params.set('mode', mode);
    if (currentLang !== 'fr') params.set('lang', currentLang);

    const newUrl = params.toString() ? `/?${params}` : '/';
    router.replace(newUrl, { scroll: false });
  }, [router]);

  // Animated placeholder
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const placeholders = lang === 'fr' ? [
    'Rue Sainte-Catherine...',
    'eglise en hiver...',
    'tramway annees 50...',
    'Vieux-Port de Montreal...',
    'construction du metro...',
    '14 822 photos a explorer...',
  ] : [
    'Sainte-Catherine Street...',
    'church in winter...',
    '1950s tramway...',
    'Old Port of Montreal...',
    'metro construction...',
    '14,822 photos to explore...',
  ];

  useEffect(() => {
    if (searchQuery) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [searchQuery, placeholders.length]);

  // Load initial photos - fewer on low-memory devices
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const initialLimit = isLowMemory ? IMAGES_PER_PAGE_MOBILE : IMAGES_PER_PAGE;
        const res = await fetch(`${API_BASE}/api/photos?limit=${initialLimit}`);
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
  }, [isLowMemory]);

  // Infinite scroll - ONLY on desktop (auto-load when sentinel visible)
  // On mobile, use manual "Load More" button to prevent memory issues
  useEffect(() => {
    // Skip on mobile - use button instead
    if (isLowMemory || !loadMoreRef.current || hasSearched) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !isLoadingMore) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [nextCursor, isLoadingMore, hasSearched, isLowMemory]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const pageSize = isLowMemory ? IMAGES_PER_PAGE_MOBILE : IMAGES_PER_PAGE;
      const res = await fetch(`${API_BASE}/api/photos?limit=${pageSize}&cursor=${encodeURIComponent(nextCursor)}`);
      if (res.ok) {
        const data = await res.json();
        const newItems: PhotoRecord[] = data.items || [];

        setPhotos(prev => {
          const existingKeys = new Set(prev.map(p => p.metadataFilename));
          const uniqueNewItems = newItems.filter(p => !existingKeys.has(p.metadataFilename));
          const combined = [...prev, ...uniqueNewItems];

          // Strict memory limits
          const maxImages = isLowMemory ? MAX_IMAGES_MOBILE : MAX_IMAGES_DESKTOP;
          if (combined.length > maxImages) {
            return combined.slice(-maxImages);
          }
          return combined;
        });
        setNextCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Preload CLIP only on desktop when visual mode selected
  useEffect(() => {
    if (searchMode === 'visual' && !isLowMemory && !isModelReady) {
      setClipModelLoading(true);
      preloadModel().finally(() => setClipModelLoading(false));
    }
  }, [searchMode, preloadModel, isLowMemory, isModelReady]);

  // Debounced search with URL sync
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      // Update URL when clearing search (skip on initial mount)
      if (!isInitialMount.current) {
        updateUrl('', searchMode, lang);
      }
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setHasSearched(true);

      // Update URL with search params (skip on initial mount if already has query)
      if (!isInitialMount.current || !initialQuery) {
        updateUrl(searchQuery, searchMode, lang);
      }
      isInitialMount.current = false;

      try {
        const searchLimit = isLowMemory ? 30 : 50;
        const params = new URLSearchParams({
          q: searchQuery,
          mode: searchMode,
          limit: String(searchLimit),
        });

        let res: Response;

        if (searchMode === 'visual') {
          const embedding = await generateEmbedding(searchQuery);
          if (!embedding) {
            setSearchResults([]);
            return;
          }
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

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchMode, generateEmbedding, isLowMemory, updateUrl, lang, initialQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    updateUrl('', searchMode, lang);
    searchInputRef.current?.focus();
  }, [updateUrl, searchMode, lang]);

  // Cloudflare-optimized thumbnail URL
  const getThumbnailUrl = useCallback((src: string, w = 400, h = 400) => {
    if (!src) return '';
    const params = new URLSearchParams({
      src,
      w: String(w),
      h: String(h),
      fit: 'cover',
      format: 'webp',
      q: '80'
    });
    return `${API_BASE}/api/thumb?${params}`;
  }, []);

  // Deduplicate photos (no shuffle - preserves cursor order for stable pagination)
  const uniquePhotos = useMemo(() => {
    const seen = new Set<string>();
    return photos.filter(p => {
      if (seen.has(p.metadataFilename)) return false;
      seen.add(p.metadataFilename);
      return true;
    });
  }, [photos]);

  // Deduplicate search results
  const uniqueSearchResults = useMemo(() => {
    const seen = new Set<string>();
    return searchResults.filter(p => {
      if (seen.has(p.metadataFilename)) return false;
      seen.add(p.metadataFilename);
      return true;
    });
  }, [searchResults]);

  const displayPhotos = hasSearched ? uniqueSearchResults : uniquePhotos;

  // Navigate to photo detail page
  const handlePhotoClick = useCallback((photo: PhotoRecord) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchMode !== 'semantic') params.set('mode', searchMode);
    if (lang !== 'fr') params.set('lang', lang);

    const photoUrl = `/photo/${encodeURIComponent(photo.metadataFilename)}${params.toString() ? `?${params}` : ''}`;
    router.push(photoUrl);
  }, [router, searchQuery, searchMode, lang]);

  // Handle language change
  const handleLangChange = useCallback(() => {
    const newLang = lang === 'fr' ? 'en' : 'fr';
    setLang(newLang);
    if (searchQuery) {
      updateUrl(searchQuery, searchMode, newLang);
    }
  }, [lang, searchQuery, searchMode, updateUrl]);

  // Handle mode change
  const handleModeChange = useCallback((newMode: SearchMode) => {
    setSearchMode(newMode);
    if (searchQuery) {
      updateUrl(searchQuery, newMode, lang);
    }
  }, [searchQuery, lang, updateUrl]);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header with Search */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm border-b border-neutral-100">
        {/* Mobile: stacked layout */}
        <div className="flex flex-col sm:hidden">
          {/* Top row: logo + lang + IG */}
          <div className="flex items-center justify-between h-11 px-3">
            <a href="/" className="text-[11px] font-medium tracking-[0.1em] uppercase">
              MTL Archives
            </a>
            <div className="flex items-center gap-2">
              <button
                onClick={handleLangChange}
                className="flex items-center gap-1 px-1.5 py-1 hover:bg-neutral-100 rounded transition-colors"
                title={lang === 'fr' ? 'Switch to English' : 'Passer au francais'}
              >
                {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              </button>
              <a
                href="https://instagram.com/mtlarchives"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] tracking-wide text-neutral-400 hover:text-neutral-900 transition-colors"
              >
                @mtlarchives
              </a>
            </div>
          </div>
          {/* Bottom row: full-width search */}
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
              {isSearching && (
                <div className="mr-3 h-4 w-4 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin shrink-0" />
              )}
              {searchQuery && !isSearching && (
                <button onClick={clearSearch} className="mr-2 p-1 hover:bg-neutral-100 rounded">
                  <X className="h-4 w-4 text-neutral-400" />
                </button>
              )}
              {/* Mode Toggle */}
              <div className="flex border-l border-neutral-200 h-full">
                <button
                  onClick={() => handleModeChange('semantic')}
                  className={`px-3 text-[10px] uppercase tracking-wide transition-colors ${
                    searchMode === 'semantic'
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-400 active:bg-neutral-100'
                  }`}
                >
                  {t.textSearch}
                </button>
                <button
                  onClick={() => handleModeChange('visual')}
                  className={`px-3 text-[10px] uppercase tracking-wide transition-colors flex items-center justify-center gap-1 ${
                    searchMode === 'visual'
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-400 active:bg-neutral-100'
                  }`}
                  title={isLowMemory ? (lang === 'fr' ? 'Utilise plus de memoire' : 'Uses more memory') : ''}
                >
                  {clipModelLoading && searchMode === 'visual' && (
                    <div className="h-2.5 w-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                  )}
                  {t.visualSearch}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tablet/Desktop: single row */}
        <div className="hidden sm:flex items-center h-14 px-4 lg:px-6 gap-4 lg:gap-6">
          {/* Logo */}
          <a href="/" className="text-xs font-medium tracking-[0.12em] uppercase shrink-0">
            MTL Archives
          </a>

          {/* Search Bar - centered with max-width */}
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
                  className="flex-1 px-2.5 text-sm bg-transparent outline-none placeholder:text-neutral-300 transition-all"
                />
                {isSearching && (
                  <div className="mr-3 h-3.5 w-3.5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin shrink-0" />
                )}
                {searchQuery && !isSearching && (
                  <button onClick={clearSearch} className="mr-2 p-0.5 hover:bg-neutral-100 rounded">
                    <X className="h-3.5 w-3.5 text-neutral-400" />
                  </button>
                )}
                {/* Mode Toggle */}
                <div className="flex border-l border-neutral-200 h-full">
                  <button
                    onClick={() => handleModeChange('semantic')}
                    className={`px-3 text-[10px] uppercase tracking-wide transition-colors ${
                      searchMode === 'semantic'
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50'
                    }`}
                  >
                    {t.textSearch}
                  </button>
                  <button
                    onClick={() => handleModeChange('visual')}
                    className={`px-3 text-[10px] uppercase tracking-wide transition-colors flex items-center justify-center gap-1.5 ${
                      searchMode === 'visual'
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50'
                    }`}
                  >
                    {clipModelLoading && searchMode === 'visual' && (
                      <div className="h-2.5 w-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                    )}
                    {t.visualSearch}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleLangChange}
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-neutral-100 rounded transition-colors"
              title={lang === 'fr' ? 'Switch to English' : 'Passer au francais'}
            >
              {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              <span className="text-[10px] text-neutral-500 uppercase">
                {lang === 'fr' ? 'EN' : 'FR'}
              </span>
            </button>
            <a
              href="https://instagram.com/mtlarchives"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] tracking-wide text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              @mtlarchives
            </a>
          </div>
        </div>
      </header>

      {/* Grid */}
      <section className="pt-2 pb-8">
        {/* Results header */}
        <div className="flex items-center justify-between mb-2 px-2 sm:px-3">
          {hasSearched ? (
            <>
              <span className="text-xs text-neutral-400 uppercase tracking-wide">
                {searchResults.length} {searchResults.length === 1 ? t.result : t.results}
              </span>
              <button onClick={clearSearch} className="text-xs text-neutral-400 hover:text-neutral-900 uppercase tracking-wide">
                {t.clear}
              </button>
            </>
          ) : (
            <span className="text-xs text-neutral-400 uppercase tracking-wide">{t.featured}</span>
          )}
        </div>

        {/* Empty State */}
        {hasSearched && searchResults.length === 0 && !isSearching && (
          <div className="text-center py-16 px-4">
            <p className="text-neutral-500 text-sm mb-3">{t.noResults} &ldquo;{searchQuery}&rdquo;</p>
            <button onClick={clearSearch} className="text-xs text-neutral-400 hover:text-neutral-900 underline underline-offset-4 uppercase tracking-wide">
              {t.clearSearch}
            </button>
          </div>
        )}

        {/* Initial Loading */}
        {initialLoading && (
          <div className="text-center py-16">
            <div className="inline-block h-5 w-5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
          </div>
        )}

        {/* Photo Grid */}
        {!initialLoading && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5">
            {displayPhotos.map((photo, i) => (
              <PhotoCard
                key={photo.metadataFilename}
                photo={photo}
                getThumbnailUrl={getThumbnailUrl}
                priority={i < (isLowMemory ? 6 : 12)}
                onClick={() => handlePhotoClick(photo)}
                isLowMemory={isLowMemory}
              />
            ))}
          </div>
        )}

        {/* Load more - Button on mobile, auto-scroll sentinel on desktop */}
        {!hasSearched && nextCursor && (
          <>
            {/* Mobile: Manual load more button */}
            {isLowMemory && (
              <div className="flex justify-center py-6">
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
            )}
            {/* Desktop: Auto-scroll sentinel */}
            {!isLowMemory && (
              <div ref={loadMoreRef} className="flex justify-center py-8">
                {isLoadingMore && (
                  <div className="h-5 w-5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Footer */}
      <footer className="py-6 px-4 text-center">
        <p className="text-xs text-neutral-300 uppercase tracking-wide">
          © {new Date().getFullYear()} MTL Archives
        </p>
      </footer>
    </div>
  );
}
