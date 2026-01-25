'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ShoppingBag } from 'lucide-react';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { PhotoTile } from './PhotoTile';

const API_BASE = '';

// Generate thumbnail URL via Cloudflare Image Resizing
// This prevents loading 50MB+ aerial photos - resizing happens at the edge
const getThumbnailUrl = (imageUrl: string, width = 400) => {
  if (!imageUrl) return '';
  return `/api/thumb?src=${encodeURIComponent(imageUrl)}&w=${width}&q=75&format=auto`;
};

// Image loading limits - balanced for performance and exploration
// Mobile: Conservative due to memory constraints
// Desktop: More generous but still bounded
const MOBILE_PAGE_SIZE = 12;      // 4 rows of 3
const MOBILE_MAX_IMAGES = 36;     // 12 rows max
const DESKTOP_PAGE_SIZE = 24;     // Good batch size
const DESKTOP_MAX_IMAGES = 72;    // Generous but bounded

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
    featured: 'À découvrir',
    results: 'résultats',
    result: 'résultat',
    clear: 'Effacer',
    noResults: 'Aucune photo trouvée pour',
    clearSearch: 'Effacer la recherche',
    shuffle: 'Mélanger',
    photos: 'photos',
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
    // Hook
    hookDefault: 'Explorez 13 499 photos d\'archives de Montréal',
    hookInstagram: 'Vu sur Instagram? Il y en a 14 822 autres...',
  },
  en: {
    featured: 'Discover',
    results: 'results',
    result: 'result',
    clear: 'Clear',
    noResults: 'No photos found for',
    clearSearch: 'Clear search',
    shuffle: 'Shuffle',
    photos: 'photos',
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
    // Hook
    hookDefault: 'Explore 13, 499 archival photos of Montreal',
    hookInstagram: 'Saw this on Instagram? There are 14,822 more...',
  },
} as const;

// Typewriter search examples - short, evocative (5 examples for faster cycling)
const searchExamples = {
  fr: [
    'ma rue',
    'Expo 67',
    'tramway',
    'neige',
    'Vieux-Montréal',
  ],
  en: [
    'my street',
    'Expo 67',
    'tramway',
    'snow',
    'Old Montreal',
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
          onClick={() => events.archiveLinkClicked('https://archivesdemontreal.ica-atom.org/')}
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
  // Staggered animation for organic Apple-like feel
  const skeletonCount = 24;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5 px-0.5">
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <div
          key={i}
          className="relative aspect-square skeleton"
          style={{
            animationDelay: `${(i % 8) * 0.1}s`,
          }}
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const t = translations[lang];
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  // Search quality tracking refs (used by clearSearch and effects below)
  const previousQueryRef = useRef<string>('');
  const searchResultClickedRef = useRef(false);
  const abandonmentRef = useRef<{ query: string; mode: string; count: number } | null>(null);

  // Focus state for search input
  const [isInputFocused, setIsInputFocused] = useState(false);
  
  // About drawer state
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // Hook state (above-fold messaging for IG bounce reduction)
  const [showHook, setShowHook] = useState(true);
  const [isFromInstagram, setIsFromInstagram] = useState(false);

  // Detect Instagram visitors on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    if (utmSource === 'instagram' || document.referrer.includes('instagram')) {
      setIsFromInstagram(true);
      events.instagramVisitorLanded(params.get('utm_campaign') || undefined);
    }
  }, []);

  // Auto-dismiss hook after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowHook(false), 10000);
    return () => clearTimeout(timer);
  }, []);

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
  const typewriterText = useTypewriter(placeholders, isTypewriterActive, 50, 35, 1200);

  // Show typewriter only when not focused and no query
  const showTypewriter = !searchQuery && !isInputFocused;
  // Show static placeholder when focused but empty
  const showFocusedPlaceholder = isInputFocused && !searchQuery;

  // Total photo count for display
  const [totalPhotos, setTotalPhotos] = useState<number | null>(null);

  // === Session & Interaction Tracking Helpers ===
  // (defined early so handlers below can reference them)

  // Track first interaction (fires once per session)
  const firstInteractionTracked = useRef(false);
  const trackFirstInteraction = useCallback((action: string) => {
    if (firstInteractionTracked.current) return;
    firstInteractionTracked.current = true;
    setShowHook(false); // Dismiss hook on first interaction
    events.pageFirstInteraction(action);
  }, []);

  // Increment event count on any tracked action (for session classification)
  const sessionStartTime = useRef(Date.now());
  const sessionEventCount = useRef(0);
  const sessionActions = useRef(new Set<string>());
  const trackSessionAction = useCallback((action: string) => {
    sessionEventCount.current++;
    sessionActions.current.add(action);
  }, []);

  // Session storage keys for persisting shuffle state
  const STORAGE_KEY_PHOTOS = 'mtl-archives-photos';
  const STORAGE_KEY_TOTAL = 'mtl-archives-total';

  // Load photos - restores from session or fetches new shuffled set
  const loadPhotos = useCallback(async (forceRefresh = false) => {
    // Try to restore from session storage first (unless forcing refresh)
    if (!forceRefresh && typeof window !== 'undefined') {
      try {
        const cachedPhotos = sessionStorage.getItem(STORAGE_KEY_PHOTOS);
        const cachedTotal = sessionStorage.getItem(STORAGE_KEY_TOTAL);
        if (cachedPhotos) {
          const parsed = JSON.parse(cachedPhotos);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPhotos(parsed);
            setTotalPhotos(cachedTotal ? parseInt(cachedTotal, 10) : null);
            setInitialLoading(false);
            return;
          }
        }
      } catch (err) {
        // Session storage unavailable or corrupted, proceed with fetch
        console.warn('Failed to restore from session:', err);
      }
    }

    // Fetch fresh shuffled photos
    setInitialLoading(true);
    try {
      const pageSize = isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
      // On mobile, limit image size to 1MB to prevent browser crashes
      const sizeLimit = isMobile ? '&maxSize=1000000' : '';
      const res = await fetch(`${API_BASE}/api/photos?limit=${pageSize}&shuffle=true${sizeLimit}`);
      const data = await res.json();
      const items = data.items || [];
      const total = data.total || null;

      setPhotos(items);
      setTotalPhotos(total);

      // Cache in session storage for back navigation
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(items));
          if (total) sessionStorage.setItem(STORAGE_KEY_TOTAL, String(total));
        } catch (err) {
          // Session storage full or unavailable, continue without caching
          console.warn('Failed to cache photos:', err);
        }
      }
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setInitialLoading(false);
    }
  }, [isMobile]);

  // Handle user-initiated shuffle (with analytics) - always fetches fresh
  const handleShuffle = useCallback(() => {
    trackFirstInteraction('shuffle');
    trackSessionAction('shuffle');
    events.shuffleClicked();
    loadPhotos(true); // Force refresh
  }, [loadPhotos, trackFirstInteraction, trackSessionAction]);

  useEffect(() => {
    loadPhotos(false); // Try to restore from cache first
  }, [loadPhotos]);


  // Search (semantic only on mobile - no CLIP)
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      if (!isInitialMount.current) updateUrl('', searchMode, lang);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setHasSearched(true);
      setFailedImages(new Set()); // Clear failed images on new search
      if (!isInitialMount.current || !initialQuery) updateUrl(searchQuery, searchMode, lang);
      isInitialMount.current = false;

      try {
        const searchLimit = isMobile ? String(MOBILE_MAX_IMAGES) : String(DESKTOP_MAX_IMAGES);
        const params = new URLSearchParams({ q: searchQuery, mode: searchMode, limit: searchLimit });
        const res = await fetch(`${API_BASE}/api/search?${params}`);
        if (res.ok) {
          const data: SearchResponse = await res.json();
          setSearchResults(data.items);
          trackSessionAction('search');
          events.searchPerformed(searchQuery, searchMode, data.items.length);

          // Track no results - helps identify content gaps
          if (data.items.length === 0) {
            events.searchNoResults(searchQuery, searchMode);
          }

          // Track "committed" search after 1.5s of no further changes
          // This is the metric to use for business analytics (vs intermediate searches)
          commitTimeoutRef.current = setTimeout(() => {
            events.searchCommitted(searchQuery, searchMode, data.items.length);
          }, 1200); // 1.2s after results load = ~1.5s after typing stops
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
    };
  }, [searchQuery, searchMode, updateUrl, lang, initialQuery, isMobile, trackSessionAction]);

  const clearSearch = useCallback(() => {
    // Track abandonment if user had results but never clicked one
    if (abandonmentRef.current && !searchResultClickedRef.current) {
      events.searchAbandoned(abandonmentRef.current.query, abandonmentRef.current.mode, abandonmentRef.current.count);
    }
    abandonmentRef.current = null;
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
  const handlePhotoClick = useCallback((photo: PhotoRecord, position?: number) => {
    trackFirstInteraction('photo_click');
    trackSessionAction('photo');
    events.photoViewed(photo.metadataFilename, photo.name);

    // Track search result clicks with position - helps optimize ranking
    if (hasSearched && searchQuery && position !== undefined) {
      searchResultClickedRef.current = true;
      events.searchResultClicked(searchQuery, position, photo.metadataFilename);
    }

    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchMode !== 'semantic') params.set('mode', searchMode);
    if (lang !== 'fr') params.set('lang', lang);
    router.push(`/photo/${encodeURIComponent(photo.metadataFilename)}${params.toString() ? `?${params}` : ''}`);
  }, [router, searchQuery, searchMode, lang, hasSearched, trackFirstInteraction, trackSessionAction]);

  const handleLangChange = useCallback(() => {
    const newLang = lang === 'fr' ? 'en' : 'fr';
    events.languageChanged(lang, newLang);
    setLang(newLang);
    // Always update URL so CartDrawer and other components get the new language
    updateUrl(searchQuery, searchMode, newLang);
  }, [lang, searchQuery, searchMode, updateUrl]);

  const handleModeChange = useCallback((newMode: SearchMode) => {
    events.searchModeChanged(newMode);
    setSearchMode(newMode);
    if (searchQuery) updateUrl(searchQuery, newMode, lang);
  }, [searchQuery, lang, updateUrl]);

  // === Landing & Bounce Intelligence ===

  // Track page load time (fires once)
  const pageLoadTracked = useRef(false);
  useEffect(() => {
    if (pageLoadTracked.current) return;
    pageLoadTracked.current = true;
    const measure = () => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const loadTime = nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0;
      if (loadTime > 0) {
        events.pageLoaded(loadTime);
      }
    };
    if (document.readyState === 'complete') {
      setTimeout(measure, 0);
    } else {
      window.addEventListener('load', measure, { once: true });
    }
  }, []);

  // Track scroll depth milestones (25/50/75/100%)
  const scrollMilestones = useRef(new Set<number>());
  useEffect(() => {
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;
      const percent = Math.round((window.scrollY / scrollHeight) * 100);
      for (const milestone of [25, 50, 75, 100]) {
        if (percent >= milestone && !scrollMilestones.current.has(milestone)) {
          scrollMilestones.current.add(milestone);
          events.pageScrollDepth(milestone);
          if (milestone === 25) trackFirstInteraction('scroll');
        }
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [trackFirstInteraction]);

  // === Search Quality: refined & abandoned ===

  // Track search refinement (user modifies existing query)
  useEffect(() => {
    const prev = previousQueryRef.current;
    if (searchQuery && prev && searchQuery !== prev && prev.length > 0) {
      events.searchRefined(prev, searchQuery, searchMode);
    }
    previousQueryRef.current = searchQuery;
  }, [searchQuery, searchMode]);

  // Track search abandonment (clear/navigate without clicking result)
  useEffect(() => {
    if (hasSearched && searchResults.length > 0 && searchQuery) {
      searchResultClickedRef.current = false;
      abandonmentRef.current = { query: searchQuery, mode: searchMode, count: searchResults.length };
    }
  }, [hasSearched, searchResults, searchQuery, searchMode]);

  // === Session Classification (beforeunload) ===
  useEffect(() => {
    const handleBeforeUnload = () => {
      const duration = Date.now() - sessionStartTime.current;
      const actions = sessionActions.current;
      let type = 'bounced';
      if (actions.has('order') || actions.has('cart')) type = 'shopper';
      else if (actions.has('search')) type = 'searcher';
      else if (actions.has('shuffle') || actions.has('photo') || actions.has('scroll')) type = 'browser';
      events.sessionEnded(type, sessionEventCount.current, duration);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);


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
                  trackSessionAction('cart');
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
                  onFocus={() => { setIsInputFocused(true); trackFirstInteraction('search_focus'); }}
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
                    onFocus={() => { setIsInputFocused(true); trackFirstInteraction('search_focus'); }}
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
                trackSessionAction('cart');
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

      {/* Above-fold hook - dismisses on first interaction or after 10s */}
      <div
        className={`overflow-hidden transition-all duration-500 ease-out ${
          showHook ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 py-3 text-center">
          <p className="text-sm sm:text-base font-medium text-neutral-700">
            {isFromInstagram ? t.hookInstagram : t.hookDefault}
          </p>
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between py-2 px-2 sm:px-3">
        {hasSearched ? (
          <>
            <span className="text-xs text-neutral-400 uppercase" translate="no">{displayPhotos.length} {displayPhotos.length === 1 ? t.result : t.results}</span>
            <button onClick={clearSearch} className="text-xs text-neutral-400 uppercase">{t.clear}</button>
          </>
        ) : (
          <>
            <span className="text-xs text-neutral-400 uppercase">
              {t.featured}
              {totalPhotos && (
                <span className="ml-1.5 text-neutral-300" translate="no">
                  · {totalPhotos.toLocaleString()} {t.photos}
                </span>
              )}
            </span>
            <button
              onClick={handleShuffle}
              disabled={initialLoading}
              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 uppercase transition-colors disabled:opacity-50"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              {t.shuffle}
            </button>
          </>
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

      {/* Photo Grid - with smooth fade-in loading */}
      {!initialLoading && displayPhotos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5 px-0.5">
          {displayPhotos.map((photo, index) => (
            photo.imageUrl && (
              <PhotoTile
                key={photo.metadataFilename}
                src={getThumbnailUrl(photo.imageUrl, 400)}
                alt={photo.name || ''}
                priority={index < 9}
                onClick={() => handlePhotoClick(photo, index + 1)}
                onError={() => handleImageError(photo.metadataFilename)}
              />
            )
          ))}
        </div>
      )}

      {/* Shuffle Button - Apple-style understated call to action */}
      {!hasSearched && !initialLoading && (
        <div className="flex justify-center py-8">
          <button
            onClick={handleShuffle}
            className="flex items-center gap-2 px-5 py-2.5 text-neutral-500 hover:text-neutral-900 text-xs uppercase tracking-wide transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            {t.shuffle}
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
