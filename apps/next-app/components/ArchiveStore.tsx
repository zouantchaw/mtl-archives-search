'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Download, Copy, Check, ArrowLeft, ExternalLink } from 'lucide-react';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { useClipEmbedding } from '@/lib/use-clip';
import Image from 'next/image';

const API_BASE = '';

// ============================================================
// i18n - French primary, English secondary
// ============================================================
type Lang = 'fr' | 'en';

const translations = {
  fr: {
    title: 'Montréal, 1920–1990',
    subtitle: 'Parcourez 14 822 photographies historiques.',
    subtitleLine2: 'Trouvez votre rue, votre immeuble, votre histoire.',
    searchPlaceholder: 'Rue, quartier ou description...',
    textSearch: 'Texte',
    visualSearch: 'Visuel',
    featured: 'À la une',
    results: 'résultats',
    result: 'résultat',
    clear: 'Effacer',
    noResults: 'Aucune photo trouvée pour',
    clearSearch: 'Effacer la recherche',
    back: 'Retour',
    copy: 'Copier',
    copied: 'Copié',
    download: 'Télécharger',
    orderPrint: 'Commander une impression',
    size: 'Format',
    frame: 'Cadre',
    noFrame: 'Sans cadre',
    addToCart: 'Ajouter au panier',
    freeShipping: 'Livraison gratuite dès 150$ · Expédition 5-7 jours',
    viewArchives: 'Voir dans les Archives',
    credits: 'Crédits',
    reference: 'Référence',
    loadMore: 'Charger plus',
    loading: 'Chargement...',
    instagram: 'Instagram',
    about: 'À propos',
    contact: 'Contact',
  },
  en: {
    title: 'Montréal, 1920–1990',
    subtitle: 'Browse 14,822 historical photographs.',
    subtitleLine2: 'Find your street, your building, your history.',
    searchPlaceholder: 'Street, neighborhood, or describe...',
    textSearch: 'Text',
    visualSearch: 'Visual',
    featured: 'Featured',
    results: 'results',
    result: 'result',
    clear: 'Clear',
    noResults: 'No photos found for',
    clearSearch: 'Clear search',
    back: 'Back',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    orderPrint: 'Order Print',
    size: 'Size',
    frame: 'Frame',
    noFrame: 'No Frame',
    addToCart: 'Add to Cart',
    freeShipping: 'Free shipping over $150 · Ships in 5-7 days',
    viewArchives: 'View in City Archives',
    credits: 'Credits',
    reference: 'Reference',
    loadMore: 'Load more',
    loading: 'Loading...',
    instagram: 'Instagram',
    about: 'About',
    contact: 'Contact',
  },
} as const;

const PRINT_OPTIONS = [
  { id: 'small', name: '8×10"', price: 45 },
  { id: 'medium', name: '12×16"', price: 75 },
  { id: 'large', name: '18×24"', price: 120 },
  { id: 'xlarge', name: '24×36"', price: 180 },
];

const FRAME_OPTIONS_FR = [
  { id: 'none', name: 'Sans cadre', price: 0 },
  { id: 'black', name: 'Noir', price: 45 },
  { id: 'white', name: 'Blanc', price: 45 },
  { id: 'natural', name: 'Bois naturel', price: 60 },
];

const FRAME_OPTIONS_EN = [
  { id: 'none', name: 'No Frame', price: 0 },
  { id: 'black', name: 'Black', price: 45 },
  { id: 'white', name: 'White', price: 45 },
  { id: 'natural', name: 'Natural Wood', price: 60 },
];

// ============================================================
// Main Component
// ============================================================
export function ArchiveStore() {
  // Language state - French default
  const [lang, setLang] = useState<Lang>('fr');
  const t = translations[lang];

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic');
  const [searchResults, setSearchResults] = useState<PhotoRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Infinite scroll state
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Selected product
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | null>(null);

  // CLIP embedding
  const { generateEmbedding, preloadModel } = useClipEmbedding();

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial photos
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/photos?limit=30`);
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

  // Infinite scroll - load more when sentinel is visible
  useEffect(() => {
    if (!loadMoreRef.current || hasSearched) return;

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
  }, [nextCursor, isLoadingMore, hasSearched]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`${API_BASE}/api/photos?limit=30&cursor=${encodeURIComponent(nextCursor)}`);
      if (res.ok) {
        const data = await res.json();
        setPhotos(prev => [...prev, ...(data.items || [])]);
        setNextCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Preload CLIP when visual mode selected
  useEffect(() => {
    if (searchMode === 'visual') {
      preloadModel();
    }
  }, [searchMode, preloadModel]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setHasSearched(true);
      try {
        const params = new URLSearchParams({
          q: searchQuery,
          mode: searchMode,
          limit: '50',
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
  }, [searchQuery, searchMode, generateEmbedding]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    searchInputRef.current?.focus();
  }, []);

  // Cloudflare-optimized thumbnail URL
  const getThumbnailUrl = useCallback((src: string, w = 400, h = 400) => {
    if (!src) return '';
    const params = new URLSearchParams({
      src,
      w: String(w),
      h: String(h),
      fit: 'cover',
      format: 'webp', // Force WebP for better compression
      q: '80'
    });
    return `${API_BASE}/api/thumb?${params}`;
  }, []);

  const displayPhotos = hasSearched ? searchResults : photos;

  // Product detail view
  if (selectedPhoto) {
    return (
      <ProductDetail
        photo={selectedPhoto}
        onBack={() => setSelectedPhoto(null)}
        getThumbnailUrl={getThumbnailUrl}
        lang={lang}
        t={t}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-12 px-4 md:px-6">
          <a href="/" className="text-xs font-medium tracking-[0.15em] uppercase">
            MTL Archives
          </a>

          <div className="flex items-center gap-4">
            {/* Language Toggle */}
            <button
              onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
              className="text-xs tracking-wide text-neutral-400 hover:text-neutral-900 transition-colors uppercase"
            >
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>

            <a
              href="https://instagram.com/mtlarchives"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:block text-xs tracking-wide text-neutral-400 hover:text-neutral-900 transition-colors uppercase"
            >
              {t.instagram}
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-16 pb-12 md:pt-24 md:pb-16 px-4">
        <div className="max-w-md mx-auto text-center">
          <h1 className="text-2xl md:text-3xl font-light tracking-tight mb-3">
            {t.title}
          </h1>
          <p className="text-sm text-neutral-500 mb-8">
            {t.subtitle}<br />
            {t.subtitleLine2}
          </p>

          {/* Search */}
          <div className="relative">
            <div className="flex items-center bg-white border border-neutral-200 focus-within:border-neutral-900 transition-colors">
              <Search className="ml-4 h-4 w-4 text-neutral-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-3 py-3 text-sm bg-transparent outline-none placeholder:text-neutral-400"
              />
              {isSearching && (
                <div className="mr-4 h-4 w-4 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin shrink-0" />
              )}
              {searchQuery && !isSearching && (
                <button onClick={clearSearch} className="mr-3 p-1 hover:bg-neutral-100">
                  <X className="h-4 w-4 text-neutral-400" />
                </button>
              )}
            </div>

            {/* Mode Toggle */}
            <div className="flex justify-center gap-1 mt-3">
              <button
                onClick={() => setSearchMode('semantic')}
                className={`px-4 py-1.5 text-xs uppercase tracking-wide transition-colors ${
                  searchMode === 'semantic'
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-400 hover:text-neutral-900'
                }`}
              >
                {t.textSearch}
              </button>
              <button
                onClick={() => setSearchMode('visual')}
                className={`px-4 py-1.5 text-xs uppercase tracking-wide transition-colors ${
                  searchMode === 'visual'
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-400 hover:text-neutral-900'
                }`}
              >
                {t.visualSearch}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="px-1 sm:px-2 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 px-3">
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
          <div className="text-center py-20">
            <p className="text-neutral-500 text-sm mb-4">{t.noResults} &ldquo;{searchQuery}&rdquo;</p>
            <button onClick={clearSearch} className="text-xs text-neutral-400 hover:text-neutral-900 underline underline-offset-4 uppercase tracking-wide">
              {t.clearSearch}
            </button>
          </div>
        )}

        {/* Initial Loading */}
        {initialLoading && (
          <div className="text-center py-20">
            <div className="inline-block h-5 w-5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
          </div>
        )}

        {/* Photo Grid */}
        {!initialLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-0.5 sm:gap-1">
            {displayPhotos.map((photo, i) => (
              <button
                key={photo.metadataFilename}
                onClick={() => setSelectedPhoto(photo)}
                className="group relative aspect-square bg-neutral-100 overflow-hidden focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-inset"
              >
                {photo.imageUrl && (
                  <Image
                    src={getThumbnailUrl(photo.imageUrl, 400, 400)}
                    alt={photo.name || ''}
                    fill
                    className="object-cover"
                    unoptimized
                    loading={i < 12 ? 'eager' : 'lazy'}
                  />
                )}
                {/* Hover overlay - minimal */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
              </button>
            ))}
          </div>
        )}

        {/* Load more sentinel */}
        {!hasSearched && nextCursor && (
          <div ref={loadMoreRef} className="flex justify-center py-8">
            {isLoadingMore && (
              <div className="h-5 w-5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
            )}
          </div>
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

// ============================================================
// Product Detail
// ============================================================
function ProductDetail({
  photo,
  onBack,
  getThumbnailUrl,
  lang,
  t,
}: {
  photo: PhotoRecord;
  onBack: () => void;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
  lang: Lang;
  t: typeof translations.fr;
}) {
  const [selectedSize, setSelectedSize] = useState(PRINT_OPTIONS[1].id);
  const [selectedFrame, setSelectedFrame] = useState('none');
  const [copied, setCopied] = useState(false);

  const frameOptions = lang === 'fr' ? FRAME_OPTIONS_FR : FRAME_OPTIONS_EN;
  const selectedPrint = PRINT_OPTIONS.find(p => p.id === selectedSize)!;
  const selectedFrameOption = frameOptions.find(f => f.id === selectedFrame)!;
  const totalPrice = selectedPrint.price + selectedFrameOption.price;

  const buildCaption = () => {
    const parts = [];
    if (photo.name) parts.push(photo.name);
    if (photo.dateValue) parts.push(photo.dateValue);
    if (photo.description && photo.description !== 'S/O') parts.push(photo.description);
    parts.push('');
    parts.push('#Montréal #MontrealHistory #MTLArchives');
    return parts.join('\n');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildCaption());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (photo.imageUrl) {
      window.open(photo.imageUrl, '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm">
        <div className="flex items-center h-12 px-4 md:px-6">
          <button onClick={onBack} className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-400 hover:text-neutral-900">
            <ArrowLeft className="h-4 w-4" />
            {t.back}
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          {/* Image */}
          <div className="relative aspect-square bg-neutral-100">
            {photo.imageUrl && (
              <Image
                src={getThumbnailUrl(photo.imageUrl, 1000, 1000)}
                alt={photo.name || ''}
                fill
                className="object-contain"
                unoptimized
                priority
              />
            )}
          </div>

          {/* Details */}
          <div>
            <h1 className="text-xl md:text-2xl font-light mb-1">
              {photo.name || 'Sans titre'}
            </h1>
            {photo.dateValue && (
              <p className="text-neutral-500 text-sm mb-4">{photo.dateValue}</p>
            )}

            {photo.description && photo.description !== 'S/O' && (
              <p className="text-neutral-600 text-sm mb-6 leading-relaxed">
                {photo.description}
              </p>
            )}

            {/* Meta */}
            <div className="space-y-1 mb-6 text-xs text-neutral-400">
              {photo.credits && <p>{t.credits}: {photo.credits}</p>}
              {photo.cote && <p>{t.reference}: {photo.cote}</p>}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mb-8">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-xs uppercase tracking-wide transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t.copied : t.copy}
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-xs uppercase tracking-wide transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t.download}
              </button>
            </div>

            {/* Print Options */}
            <div className="border-t border-neutral-200 pt-6">
              <h2 className="text-sm font-medium uppercase tracking-wide mb-4">{t.orderPrint}</h2>

              {/* Size */}
              <div className="mb-4">
                <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">{t.size}</p>
                <div className="grid grid-cols-4 gap-1">
                  {PRINT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedSize(opt.id)}
                      className={`py-2 text-xs transition-colors ${
                        selectedSize === opt.id
                          ? 'bg-neutral-900 text-white'
                          : 'bg-white border border-neutral-200 hover:border-neutral-400'
                      }`}
                    >
                      <div>{opt.name}</div>
                      <div className="opacity-60">${opt.price}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Frame */}
              <div className="mb-6">
                <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">{t.frame}</p>
                <div className="grid grid-cols-4 gap-1">
                  {frameOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedFrame(opt.id)}
                      className={`py-2 text-xs transition-colors ${
                        selectedFrame === opt.id
                          ? 'bg-neutral-900 text-white'
                          : 'bg-white border border-neutral-200 hover:border-neutral-400'
                      }`}
                    >
                      <div>{opt.name}</div>
                      <div className="opacity-60">{opt.price === 0 ? '—' : `+$${opt.price}`}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add to Cart */}
              <button className="w-full py-3 bg-neutral-900 text-white text-xs font-medium uppercase tracking-wide hover:bg-neutral-800 transition-colors">
                {t.addToCart} — ${totalPrice}
              </button>

              <p className="text-[10px] text-neutral-400 text-center mt-3 uppercase tracking-wide">
                {t.freeShipping}
              </p>

              {photo.externalUrl && (
                <a
                  href={photo.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 mt-4 text-xs text-neutral-400 hover:text-neutral-900 uppercase tracking-wide"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t.viewArchives}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
