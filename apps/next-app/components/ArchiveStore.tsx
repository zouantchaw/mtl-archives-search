'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ShoppingBag } from 'lucide-react';
import Image from 'next/image';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';

const API_BASE = '';

// Conservative limits for mobile
const MOBILE_PAGE_SIZE = 9;
const MOBILE_MAX_IMAGES = 27;
const DESKTOP_PAGE_SIZE = 20;

// ============================================================
// Typewriter Hook - with pause capability
// ============================================================
function useTypewriter(
  texts: readonly string[],
  isActive: boolean,
  typingSpeed = 80,
  deletingSpeed = 40,
  pauseDuration = 2000
) {
  const [displayText, setDisplayText] = useState('');
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    // Stop all animation when not active
    if (!isActive) return;

    const currentFullText = texts[textIndex];
    
    if (isPaused) {
      const pauseTimer = setTimeout(() => {
        setIsPaused(false);
        setIsDeleting(true);
      }, pauseDuration);
      return () => clearTimeout(pauseTimer);
    }

    if (isDeleting) {
      if (displayText.length === 0) {
        setIsDeleting(false);
        setTextIndex((prev) => (prev + 1) % texts.length);
        return;
      }
      const deleteTimer = setTimeout(() => {
        setDisplayText((prev) => prev.slice(0, -1));
      }, deletingSpeed);
      return () => clearTimeout(deleteTimer);
    }

    // Typing
    if (displayText.length < currentFullText.length) {
      const typeTimer = setTimeout(() => {
        setDisplayText(currentFullText.slice(0, displayText.length + 1));
      }, typingSpeed);
      return () => clearTimeout(typeTimer);
    }

    // Finished typing, pause before deleting
    setIsPaused(true);
  }, [displayText, textIndex, isDeleting, isPaused, texts, isActive, typingSpeed, deletingSpeed, pauseDuration]);

  return displayText;
}

// ============================================================
// Translations
// ============================================================
type Lang = 'fr' | 'en';

const translations = {
  fr: {
    featured: 'À la une',
    results: 'résultats',
    result: 'résultat',
    clear: 'Effacer',
    noResults: 'Aucune photo trouvée pour',
    clearSearch: 'Effacer la recherche',
    loadMore: 'Voir plus',
    photoCount: '14 822 photos',
    searchPlaceholder: 'Rechercher...',
    // About drawer
    about: 'À propos',
    aboutTitle: 'MTL Archives',
    aboutDescription: 'Une collection de plus de 14 000 photos historiques de Montréal, numérisées et rendues accessibles au public.',
    howToUseTitle: 'Comment chercher',
    howToUseText: 'Décrivez ce que vous cherchez en français ou en anglais. Essayez des lieux, des époques ou même des ambiances.',
    examplesTitle: 'Exemples',
    examplesText: 'église en hiver • tramway années 50 • Expo 67 • pont Jacques-Cartier • rue animée',
    printsTitle: 'Tirages',
    printsText: 'Des reproductions haute qualité sont disponibles à l\'achat. Cliquez sur une photo pour voir les options d\'impression.',
    sourceTitle: 'Source',
    sourceText: 'Photos provenant des Archives de la Ville de Montréal.',
    visitArchives: 'Visiter les archives',
    close: 'Fermer',
    // Footer & aria labels
    cart: 'Panier',
    instagram: 'Instagram',
    facebook: 'Facebook',
  },
  en: {
    featured: 'Featured',
    results: 'results',
    result: 'result',
    clear: 'Clear',
    noResults: 'No photos found for',
    clearSearch: 'Clear search',
    loadMore: 'Load more',
    photoCount: '14,822 photos',
    searchPlaceholder: 'Search...',
    // About drawer
    about: 'About',
    aboutTitle: 'MTL Archives',
    aboutDescription: 'A collection of over 14,000 historical photos of Montreal, digitized and made accessible to the public.',
    howToUseTitle: 'How to search',
    howToUseText: 'Describe what you\'re looking for in English or French. Try places, eras, or even moods.',
    examplesTitle: 'Examples',
    examplesText: 'church in winter • 1950s tramway • Expo 67 • Jacques-Cartier Bridge • busy street',
    printsTitle: 'Prints',
    printsText: 'High-quality reproductions are available for purchase. Click on any photo to see print options.',
    sourceTitle: 'Source',
    sourceText: 'Photos sourced from the City of Montreal Archives.',
    visitArchives: 'Visit archives',
    close: 'Close',
    // Footer & aria labels
    cart: 'Cart',
    instagram: 'Instagram',
    facebook: 'Facebook',
  },
} as const;

// Typewriter search examples - localized, mix of places and visual concepts
const searchExamples = {
  fr: [
    'église en hiver',
    'rue animée',
    'tramway',
    'neige',
    'Expo 67',
    'pont Jacques-Cartier',
    'Mont-Royal',
    'vieilles voitures',
    'marché',
    'construction',
    'parc en été',
    'bâtiment historique',
    'gare Windsor',
    'fleuve Saint-Laurent',
    'rue Sainte-Catherine',
  ],
  en: [
    'church in winter',
    'busy street',
    'tramway',
    'snow',
    'Expo 67',
    'Jacques-Cartier Bridge',
    'Mount Royal',
    'old cars',
    'market',
    'construction',
    'park in summer',
    'historic building',
    'Windsor Station',
    'St. Lawrence River',
    'Sainte-Catherine Street',
  ],
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
// Social Icons
// ============================================================
function IconInstagram({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function IconFacebook({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="currentColor"
      className={className}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function IconInfo({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// ============================================================
// About Drawer Component
// ============================================================
function AboutDrawer({ 
  isOpen, 
  onClose, 
  t 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  t: (typeof translations)[Lang];
}) {
  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      
      {/* Mobile: Bottom drawer */}
      <div 
        className={`fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-2xl max-h-[85vh] overflow-hidden sm:hidden transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-neutral-200 rounded-full" />
        </div>
        
        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-40px)] px-5 pb-8">
          <AboutContent t={t} onClose={onClose} />
        </div>
      </div>

      {/* Desktop: Right drawer */}
      <div 
        className={`fixed inset-y-0 right-0 z-[70] bg-white w-full max-w-md shadow-2xl hidden sm:block transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-5 border-b border-neutral-100">
          <span className="text-xs font-medium tracking-[0.1em] uppercase">{t.about}</span>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
            aria-label={t.close}
          >
            <X className="h-4 w-4 text-neutral-500" />
          </button>
        </div>
        
        {/* Content */}
        <div className="overflow-y-auto h-[calc(100vh-56px)] px-5 py-6">
          <AboutContent t={t} onClose={onClose} />
        </div>
      </div>
    </>
  );
}

function AboutContent({ t, onClose }: { t: (typeof translations)[Lang]; onClose: () => void }) {
  return (
    <div className="space-y-6">
      {/* About section */}
      <section>
        <h2 className="text-base font-semibold text-neutral-900 mb-1.5">{t.aboutTitle}</h2>
        <p className="text-[13px] text-neutral-500 leading-relaxed">{t.aboutDescription}</p>
      </section>

      {/* Divider */}
      <div className="h-px bg-neutral-100" />

      {/* How to search - simplified */}
      <section>
        <h3 className="text-[11px] font-medium tracking-[0.05em] uppercase text-neutral-400 mb-2">{t.howToUseTitle}</h3>
        <p className="text-[13px] text-neutral-500 leading-relaxed mb-3">{t.howToUseText}</p>
        <div className="bg-neutral-50 rounded-lg px-3 py-2.5">
          <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-1">{t.examplesTitle}</p>
          <p className="text-[12px] text-neutral-600 leading-relaxed">{t.examplesText}</p>
        </div>
      </section>

      {/* Prints */}
      <section>
        <h3 className="text-[11px] font-medium tracking-[0.05em] uppercase text-neutral-400 mb-2">{t.printsTitle}</h3>
        <p className="text-[13px] text-neutral-500 leading-relaxed">{t.printsText}</p>
      </section>

      {/* Divider */}
      <div className="h-px bg-neutral-100" />

      {/* Source - Apple style row */}
      <section>
        <a 
          href="https://archivesdemontreal.ica-atom.org/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center justify-between py-2 group"
        >
          <div>
            <h3 className="text-[13px] font-medium text-neutral-900">{t.sourceTitle}</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">{t.sourceText}</p>
          </div>
          <svg className="h-4 w-4 text-neutral-300 group-hover:text-neutral-500 transition-colors flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 17L17 7M17 7H7M17 7v10" />
          </svg>
        </a>
      </section>

      {/* Version/Credits - very subtle, Apple style */}
      <section className="pt-2">
        <p className="text-[10px] text-neutral-300 text-center">
          MTL Archives · v1.0
        </p>
      </section>

      {/* Close button - mobile only, Apple style */}
      <button 
        onClick={onClose}
        className="w-full py-3.5 bg-neutral-100 text-neutral-900 text-[15px] font-medium rounded-xl sm:hidden active:bg-neutral-200 transition-colors"
      >
        {t.close}
      </button>
    </div>
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

function SkeletonGrid() {
  // Show skeleton placeholders matching the grid layout
  const skeletonCount = 12;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5 px-0.5">
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <div
          key={i}
          className="relative aspect-square bg-neutral-200 animate-pulse"
        />
      ))}
    </div>
  );
}

function ArchiveStoreInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { itemCount, openCart } = useCart();

  // Detect mobile ONCE on mount
  const [isMobile, setIsMobile] = useState(true); // Default to mobile-safe
  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    setIsMobile(mobile);
  }, []);

  // State from URL
  const initialQuery = searchParams.get('q') || '';
  const initialMode = (searchParams.get('mode') as SearchMode) || 'smart';
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
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const t = translations[lang];
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  // Focus state for search input
  const [isInputFocused, setIsInputFocused] = useState(false);
  
  // About drawer state
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // URL helper
  const updateUrl = useCallback((q: string, mode: SearchMode, currentLang: Lang) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'semantic') params.set('mode', mode);
    if (currentLang !== 'fr') params.set('lang', currentLang);
    router.replace(params.toString() ? `/?${params}` : '/', { scroll: false });
  }, [router]);

  // Typewriter placeholder - pauses when input is focused
  const placeholders = useMemo(() => searchExamples[lang], [lang]);
  const isTypewriterActive = !searchQuery && !isInputFocused;
  const typewriterText = useTypewriter(placeholders, isTypewriterActive, 70, 35, 1800);

  // Show typewriter only when not focused and no query
  const showTypewriter = !searchQuery && !isInputFocused;
  // Show static placeholder when focused but empty
  const showFocusedPlaceholder = isInputFocused && !searchQuery;

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

    events.loadMoreClicked(photos.length);
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
        const params = new URLSearchParams({ q: searchQuery, mode: searchMode, limit: isMobile ? '20' : '50' });
        const res = await fetch(`${API_BASE}/api/search?${params}`);
        if (res.ok) {
          const data: SearchResponse = await res.json();
          setSearchResults(data.items);
          events.searchPerformed(searchQuery, searchMode, data.items.length);
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
    events.searchCleared();
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
      if (failedImages.has(p.metadataFilename)) return false;
      seen.add(p.metadataFilename);
      return true;
    });
  }, [hasSearched, searchResults, photos, failedImages]);

  const handleImageError = useCallback((photoId: string) => {
    setFailedImages(prev => new Set(prev).add(photoId));
  }, []);

  // Navigate to photo
  const handlePhotoClick = useCallback((photo: PhotoRecord) => {
    events.photoViewed(photo.metadataFilename, photo.name);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchMode !== 'semantic') params.set('mode', searchMode);
    if (lang !== 'fr') params.set('lang', lang);
    router.push(`/photo/${encodeURIComponent(photo.metadataFilename)}${params.toString() ? `?${params}` : ''}`);
  }, [router, searchQuery, searchMode, lang]);

  const handleLangChange = useCallback(() => {
    const newLang = lang === 'fr' ? 'en' : 'fr';
    events.languageChanged(lang, newLang);
    setLang(newLang);
    // Always update URL so CartDrawer and other components get the new language
    updateUrl(searchQuery, searchMode, newLang);
  }, [lang, searchQuery, searchMode, updateUrl]);

  const handleModeChange = useCallback((newMode: SearchMode) => {
    setSearchMode(newMode);
    if (searchQuery) updateUrl(searchQuery, newMode, lang);
  }, [searchQuery, lang, updateUrl]);

  const canLoadMore = nextCursor && !hasSearched && (!isMobile || photos.length < MOBILE_MAX_IMAGES);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm border-b border-neutral-100">
        {/* Mobile */}
        <div className="flex flex-col sm:hidden">
          <div className="flex items-center justify-between h-11 px-3">
            <a href="/" className="text-[11px] font-medium tracking-[0.1em] uppercase">MTL Archives</a>
            <div className="flex items-center gap-0.5">
              <button onClick={handleLangChange} className="p-1.5">
                {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              </button>
              <button
                onClick={() => {
                  events.cartOpened();
                  openCart();
                }}
                className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors relative"
                aria-label={t.cart}
              >
                <ShoppingBag className="h-4 w-4" />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-neutral-900 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="px-3 pb-2.5">
            {/* Search input with integrated mode toggle */}
            <div className={`flex items-center bg-white border h-11 rounded-xl relative transition-all duration-200 ${
              isInputFocused ? 'border-neutral-300 shadow-sm' : 'border-neutral-200'
            }`}>
              <Search className={`ml-3 h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                isInputFocused ? 'text-neutral-600' : 'text-neutral-400'
              }`} />
              <div className="flex-1 relative h-full min-w-0">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  className="w-full h-full px-2 text-base bg-transparent outline-none"
                  aria-label={t.searchPlaceholder}
                />
                {/* Typewriter animation - fades out on focus */}
                <div className={`absolute inset-0 flex items-center px-2 pointer-events-none transition-opacity duration-200 ${
                  showTypewriter ? 'opacity-100' : 'opacity-0'
                }`}>
                  <span className="text-base text-neutral-400 truncate">{typewriterText}</span>
                  <span className="text-base text-neutral-900 animate-blink">|</span>
                </div>
                {/* Static placeholder when focused */}
                <div className={`absolute inset-0 flex items-center px-2 pointer-events-none transition-opacity duration-200 ${
                  showFocusedPlaceholder ? 'opacity-100' : 'opacity-0'
                }`}>
                  <span className="text-base text-neutral-300">{t.searchPlaceholder}</span>
                </div>
              </div>
              {isSearching && <div className="mr-2 h-4 w-4 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin flex-shrink-0" />}
              {searchQuery && !isSearching && (
                <button
                  onClick={clearSearch}
                  className="mr-2 p-1.5 hover:bg-neutral-100 rounded-full transition-colors flex-shrink-0"
                  aria-label={t.clear}
                >
                  <X className="h-4 w-4 text-neutral-500" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden sm:flex items-center h-14 px-4 lg:px-6 gap-4">
          <a href="/" className="text-xs font-medium tracking-[0.12em] uppercase shrink-0">MTL Archives</a>
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-lg">
              <div className={`flex items-center bg-white border h-9 rounded-lg transition-all duration-200 ${
                isInputFocused ? 'border-neutral-300 shadow-sm' : 'border-neutral-200'
              }`}>
                <Search className={`ml-3 h-3.5 w-3.5 flex-shrink-0 transition-colors duration-200 ${
                  isInputFocused ? 'text-neutral-600' : 'text-neutral-400'
                }`} />
                <div className="flex-1 relative h-full min-w-0">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    className="w-full h-full px-2.5 text-sm bg-transparent outline-none"
                    aria-label={t.searchPlaceholder}
                  />
                  {/* Typewriter animation - fades out on focus */}
                  <div className={`absolute inset-0 flex items-center px-2.5 pointer-events-none transition-opacity duration-200 ${
                    showTypewriter ? 'opacity-100' : 'opacity-0'
                  }`}>
                    <span className="text-sm text-neutral-400">{typewriterText}</span>
                    <span className="text-sm text-neutral-900 animate-blink">|</span>
        </div>
                  {/* Static placeholder when focused */}
                  <div className={`absolute inset-0 flex items-center px-2.5 pointer-events-none transition-opacity duration-200 ${
                    showFocusedPlaceholder ? 'opacity-100' : 'opacity-0'
                  }`}>
                    <span className="text-sm text-neutral-300">{t.searchPlaceholder}</span>
          </div>
        </div>
                {isSearching && <div className="mr-3 h-3.5 w-3.5 border border-neutral-300 border-t-neutral-900 rounded-full animate-spin flex-shrink-0" />}
                {searchQuery && !isSearching && (
                  <button
                    onClick={clearSearch}
                    className="mr-2 p-1 hover:bg-neutral-100 rounded-full transition-colors flex-shrink-0"
                    aria-label={t.clear}
                  >
                    <X className="h-3.5 w-3.5 text-neutral-500" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button 
              onClick={handleLangChange} 
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-neutral-100 rounded transition-colors"
            >
              {lang === 'fr' ? <FlagEN /> : <FlagQC />}
              <span className="text-[10px] text-neutral-500 uppercase">{lang === 'fr' ? 'EN' : 'FR'}</span>
            </button>
            <button
              onClick={() => {
                events.cartOpened();
                openCart();
              }}
              className="p-2 text-neutral-400 hover:text-neutral-600 transition-colors relative"
              aria-label={t.cart}
            >
              <ShoppingBag className="h-4 w-4" />
              {itemCount > 0 && (
                <span className="absolute top-0.5 right-0.5 h-4 w-4 bg-neutral-900 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
            )}
            </button>
          </div>
        </div>
      </header>
      
      {/* About Drawer */}
      <AboutDrawer isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} t={t} />

      {/* Results header */}
      <div className="flex items-center justify-between py-2 px-2 sm:px-3">
        {hasSearched ? (
          <>
            <span className="text-xs text-neutral-400 uppercase" translate="no">{displayPhotos.length} {displayPhotos.length === 1 ? t.result : t.results}</span>
            <button onClick={clearSearch} className="text-xs text-neutral-400 uppercase">{t.clear}</button>
          </>
        ) : (
          <span className="text-xs text-neutral-400 uppercase">{t.featured}</span>
        )}
      </div>

      {/* Empty state */}
      {hasSearched && displayPhotos.length === 0 && !isSearching && (
        <div className="text-center py-16 px-4">
          <p className="text-neutral-500 text-sm mb-3">{t.noResults} &ldquo;{searchQuery}&rdquo;</p>
          <button onClick={clearSearch} className="text-xs text-neutral-400 underline uppercase">{t.clearSearch}</button>
        </div>
      )}

      {/* Loading skeleton */}
      {initialLoading && <SkeletonGrid />}

      {/* Simple Grid - Using Next.js Image for automatic optimization */}
      {!initialLoading && displayPhotos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5 px-0.5">
          {displayPhotos.map((photo, index) => (
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
                  priority={index < 6}
                  loading={index < 6 ? undefined : 'lazy'}
                  onError={() => handleImageError(photo.metadataFilename)}
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
      <footer className="py-8 px-4">
        <div className="flex flex-col items-center gap-4">
          {/* Links */}
          <div className="flex items-center gap-4">
            <a
              href="https://instagram.com/mtlarchives"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => events.instagramClicked()}
              className="text-neutral-300 hover:text-neutral-500 transition-colors"
              aria-label={t.instagram}
            >
              <IconInstagram className="h-5 w-5" />
            </a>
            <a
              href="https://www.facebook.com/mtlarchives/"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => events.facebookClicked()}
              className="text-neutral-300 hover:text-neutral-500 transition-colors"
              aria-label={t.facebook}
            >
              <IconFacebook className="h-5 w-5" />
            </a>
            <button
              onClick={() => {
                events.aboutOpened();
                setIsAboutOpen(true);
              }}
              className="text-neutral-300 hover:text-neutral-500 transition-colors"
              aria-label={t.about}
            >
              <IconInfo className="h-5 w-5" />
            </button>
          </div>
          {/* Copyright */}
          <p className="text-[10px] text-neutral-300 tracking-wide">© {new Date().getFullYear()} MTL Archives</p>
        </div>
      </footer>
    </div>
  );
}
