'use client';

import { type FormEvent, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { CircleDot, Frame, Search, ShoppingBag, X } from 'lucide-react';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { PhotoTile } from './PhotoTile';
import { appendLangParam, DEFAULT_LANG, getLangFromSearchParams, type Lang } from '@/lib/i18n';
import { normalizePhotoId } from '@/lib/photo-id';
import { LandingHero, MtlArchivesLogo } from './LandingHero';

const API_BASE = '';


// Image loading limits - balanced for performance and exploration
// Mobile: Conservative due to memory constraints
// Desktop: More generous but still bounded
const MOBILE_PAGE_SIZE = 12;      // 4 rows of 3
const MOBILE_MAX_IMAGES = 24;     // 8 rows max
const DESKTOP_PAGE_SIZE = 24;     // Good batch size
const DESKTOP_MAX_IMAGES = 72;    // Generous but bounded
const FILTER_BURST_WINDOW_MS = 5000;

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
const translations = {
  fr: {
    featured: 'À découvrir',
    results: 'résultats',
    result: 'résultat',
    clear: 'Effacer',
    noResults: 'Aucune photo trouvée pour',
    clearSearch: 'Effacer la recherche',
    shuffle: 'Mélanger',
    photos: '13 000+ photos',
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
    game: 'Jeu',
    // Landing sections
    gameTitle: 'Jeu quotidien',
    gameSubtitle: 'Devine le quartier. Compare ton score.',
    gameQuestion: 'Où est cette photo?',
    gameMetaLine: '2 500+ joueurs · nouveau chaque jour',
    gamePlay: 'Jouer',
    printHeadline: 'Vos murs méritent une histoire.',
    printMeta: "Impressions d'archives \u00b7 d\u00e8s 45$",
    footerSource: 'Source: Archives de la Ville de Montréal',
    footerUrl: 'mtlarchives.com',
    // Desktop nav (landing mode)
    navExplore: 'Explorer',
    navDailyGame: 'Jeu quotidien',
    navPrints: 'Impressions',
    modeSemantic: 'Sémantique',
    modeVisual: 'Visuelle',
    sortRelevance: 'Pertinence',
    resultsFor: 'résultats pour',
    discoverLead: 'Explorer',
    discoverLeadBody: 'Chercher par mot, lieu ou époque',
    playLead: 'Jouer',
    playLeadBody: 'Deviner le quartier chaque jour',
    printLead: 'Imprimer',
    printLeadBody: "Papier d'art, dès 45 $",
    commitmentsTitle: 'Nos engagements',
    commitmentMemoryTitle: 'Mémoire civique',
    commitmentMemoryBody: "Préserver l'histoire de la ville",
    commitmentSourcesTitle: 'Rigueur des sources',
    commitmentSourcesBody: 'Métadonnées vérifiées, archives officielles',
    commitmentAccessTitle: 'Accès pour tous',
    commitmentAccessBody: 'Gratuit, bilingue, mobile-first',
    newsletterTitle: 'Chaque matin, une couche de plus.',
    newsletterBody: 'Le jeu du jour + une photo surprise dans votre boîte.',
    newsletterPlaceholder: 'votre@courriel.com',
    newsletterSubmit: "S'inscrire",
    printSearchPlaceholder: 'Rechercher les archives...',
    // Hook
    hookDefault: 'Explorez 13 499 photos d\'archives de Montréal',
    hookInstagram: 'Vu sur Instagram? Il y en a 14 822 autres...',
    hookFacebook: 'Vu sur Facebook? Il y en a 14 822 autres...',
  },
  en: {
    featured: 'Discover',
    results: 'results',
    result: 'result',
    clear: 'Clear',
    noResults: 'No photos found for',
    clearSearch: 'Clear search',
    shuffle: 'Shuffle',
    photos: '13,000+ photos',
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
    game: 'Game',
    // Landing sections
    gameTitle: 'Daily game',
    gameSubtitle: 'Guess the neighbourhood. Compare your score.',
    gameQuestion: 'Where was this photo taken?',
    gameMetaLine: '2,500+ players · new every day',
    gamePlay: 'Play',
    printHeadline: 'Your walls deserve a story.',
    printMeta: 'Archive prints \u00b7 from $45',
    footerSource: 'Source: Archives de la Ville de Montréal',
    footerUrl: 'mtlarchives.com',
    // Desktop nav (landing mode)
    navExplore: 'Explore',
    navDailyGame: 'Daily game',
    navPrints: 'Prints',
    modeSemantic: 'Semantic',
    modeVisual: 'Visual',
    sortRelevance: 'Relevance',
    resultsFor: 'results for',
    discoverLead: 'Explore',
    discoverLeadBody: 'Search by keyword, place, or decade',
    playLead: 'Play',
    playLeadBody: 'Guess the neighbourhood every day',
    printLead: 'Print',
    printLeadBody: 'Fine art paper, from $45',
    commitmentsTitle: 'Our commitments',
    commitmentMemoryTitle: 'Civic memory',
    commitmentMemoryBody: "Preserving the city's history",
    commitmentSourcesTitle: 'Source rigor',
    commitmentSourcesBody: 'Verified metadata, official archives',
    commitmentAccessTitle: 'Open to all',
    commitmentAccessBody: 'Free, bilingual, mobile-first',
    newsletterTitle: 'Every morning, another layer.',
    newsletterBody: 'The daily game + a surprise photo in your inbox.',
    newsletterPlaceholder: 'your@email.com',
    newsletterSubmit: 'Sign up',
    printSearchPlaceholder: 'Search the archives...',
    // Hook
    hookDefault: 'Explore 13, 499 archival photos of Montreal',
    hookInstagram: 'Saw this on Instagram? There are 14,822 more...',
    hookFacebook: 'Saw this on Facebook? There are 14,822 more...',
  },
} as const;

type SiteStrings = (typeof translations)[Lang];

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

// Discovery shortcuts — neighborhoods, landmarks, visual/thematic terms
// VLM-tagged + metadata-rich queries that work well with semantic search
const DISCOVERY_SHORTCUTS = [
  // Neighborhoods
  { name: { fr: 'Miron', en: 'Miron' }, query: 'Miron' },
  { name: { fr: 'Plateau', en: 'Plateau' }, query: 'Plateau' },
  { name: { fr: 'Ahuntsic', en: 'Ahuntsic' }, query: 'Ahuntsic' },
  { name: { fr: 'Portuguais', en: 'Portuguais' }, query: 'rue des Portuguais' },
  { name: { fr: 'Vieux-Montréal', en: 'Old Montreal' }, query: 'Vieux-Montréal' },
  { name: { fr: 'Villeray', en: 'Villeray' }, query: 'Villeray' },
  { name: { fr: 'Hochelaga', en: 'Hochelaga' }, query: 'Hochelaga' },
  { name: { fr: 'Rosemont', en: 'Rosemont' }, query: 'Rosemont' },
  // Landmarks & streets
  { name: { fr: 'Mont Royal', en: 'Mont Royal' }, query: 'Mont Royal' },
  { name: { fr: 'Notre-Dame', en: 'Notre-Dame' }, query: 'Notre-Dame' },
  { name: { fr: 'Jacques-Cartier', en: 'Jacques-Cartier' }, query: 'Jacques-Cartier' },
  { name: { fr: 'Ste-Catherine', en: 'Ste-Catherine' }, query: 'Sainte-Catherine' },
  { name: { fr: 'St-Laurent', en: 'St-Laurent' }, query: 'Saint-Laurent' },
  { name: { fr: 'Marché Jean-Talon', en: 'Jean-Talon Market' }, query: 'Jean-Talon' },
  // Montreal culture & life
  { name: { fr: 'Hockey', en: 'Hockey' }, query: 'hockey' },
  { name: { fr: 'Tramway', en: 'Streetcar' }, query: 'tramway' },
  { name: { fr: 'Escaliers', en: 'Staircases' }, query: 'escalier' },
  { name: { fr: 'Balcons', en: 'Balconies' }, query: 'balcon' },
  { name: { fr: 'Défilé', en: 'Parade' }, query: 'parade' },
  { name: { fr: 'Incendie', en: 'Fire' }, query: 'incendie' },
  { name: { fr: 'Démolition', en: 'Demolition' }, query: 'demolition' },
  { name: { fr: 'Construction', en: 'Construction' }, query: 'construction' },
  // Visual / thematic (VLM tags)
  { name: { fr: 'Neige', en: 'Snow' }, query: 'snow' },
  { name: { fr: 'Hiver', en: 'Winter' }, query: 'winter' },
  { name: { fr: 'Arbres', en: 'Trees' }, query: 'trees' },
  { name: { fr: 'Église', en: 'Church' }, query: 'church' },
  { name: { fr: 'Voitures', en: 'Cars' }, query: 'cars' },
  { name: { fr: 'Enfants', en: 'Children' }, query: 'children' },
  { name: { fr: 'Pont', en: 'Bridge' }, query: 'bridge' },
  { name: { fr: 'Nuit', en: 'Night' }, query: 'night' },
  { name: { fr: 'Chevaux', en: 'Horses' }, query: 'horse' },
  { name: { fr: 'Aérien', en: 'Aerial' }, query: 'aerial view' },
  { name: { fr: 'Fleuve', en: 'River' }, query: 'fleuve Saint-Laurent' },
  { name: { fr: 'Port', en: 'Harbour' }, query: 'port de Montréal' },
] as const;

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

function SearchModeTabs({
  value,
  onChange,
  labels,
}: {
  value: SearchMode;
  onChange: (nextMode: SearchMode) => void;
  labels: Pick<SiteStrings, 'modeSemantic' | 'modeVisual'>;
}) {
  const semanticActive = value !== 'visual';

  return (
    <div className="inline-flex rounded-full bg-secondary p-1">
      <button
        type="button"
        onClick={() => onChange('smart')}
        className={`rounded-full px-4 py-2 text-label text-[11px] transition-colors ${
          semanticActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
        }`}
      >
        {labels.modeSemantic}
      </button>
      <button
        type="button"
        onClick={() => onChange('visual')}
        className={`rounded-full px-4 py-2 text-label text-[11px] transition-colors ${
          !semanticActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
        }`}
      >
        {labels.modeVisual}
      </button>
    </div>
  );
}

function LandingRouteCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="surface-card flex min-h-[11rem] flex-col items-center justify-center gap-3 px-6 py-7 text-center no-underline transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background">{icon}</div>
      <div className="space-y-2">
        <p className="text-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-foreground">{title}</p>
        <p className="mx-auto max-w-[17rem] text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </Link>
  );
}

function EditorialPhotoCard({
  photo,
  onClick,
  priority = false,
  aspectClassName = 'aspect-[4/3]',
}: {
  photo: PhotoRecord;
  onClick: () => void;
  priority?: boolean;
  aspectClassName?: string;
}) {
  const caption = photo.name || photo.portalTitle || photo.cote || 'MTL Archives';
  const meta = photo.dateValue || photo.portalDate || photo.cote || '';

  return (
    <button type="button" onClick={onClick} className="group block text-left">
      <div className={`relative overflow-hidden rounded-[1.15rem] bg-muted ${aspectClassName}`}>
        <Image
          src={photo.imageUrl}
          alt={caption}
          fill
          className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          sizes="(max-width: 640px) 44vw, (max-width: 1024px) 28vw, 22vw"
          priority={priority}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{caption}</p>
      {meta ? <p className="mt-1 text-xs text-muted-foreground">{meta}</p> : null}
    </button>
  );
}

function CommitmentBlurb({
  colorClassName,
  title,
  body,
}: {
  colorClassName: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-[0.45rem] h-2.5 w-2.5 rounded-full ${colorClassName}`} />
      <div>
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
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
        className={`fixed inset-x-0 bottom-0 z-[70] bg-card rounded-t-2xl max-h-[85vh] overflow-hidden sm:hidden transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-muted rounded-full" />
        </div>
        
        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-40px)] px-5 pb-8">
          <AboutContent t={t} onClose={onClose} />
        </div>
      </div>

      {/* Desktop: Right drawer */}
      <div 
        className={`fixed inset-y-0 right-0 z-[70] bg-card w-full max-w-md shadow-2xl hidden sm:block transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-5 border-b border-border">
          <span className="text-xs font-medium tracking-[0.1em] uppercase">{t.about}</span>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
            aria-label={t.close}
          >
            <X className="h-4 w-4 text-muted-foreground" />
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
        <h2 className="text-base font-semibold text-foreground mb-1.5">{t.aboutTitle}</h2>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{t.aboutDescription}</p>
      </section>

      {/* Divider */}
      <div className="h-px bg-muted" />

      {/* How to search - simplified */}
      <section>
        <h3 className="text-[11px] font-medium tracking-[0.05em] uppercase text-muted-foreground/70 mb-2">{t.howToUseTitle}</h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">{t.howToUseText}</p>
        <div className="bg-secondary rounded-lg px-3 py-2.5">
          <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1">{t.examplesTitle}</p>
          <p className="text-[12px] text-muted-foreground leading-relaxed">{t.examplesText}</p>
        </div>
      </section>

      {/* Prints */}
      <section>
        <h3 className="text-[11px] font-medium tracking-[0.05em] uppercase text-muted-foreground/70 mb-2">{t.printsTitle}</h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{t.printsText}</p>
      </section>

      {/* Divider */}
      <div className="h-px bg-muted" />

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
            <h3 className="text-[13px] font-medium text-foreground">{t.sourceTitle}</h3>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t.sourceText}</p>
          </div>
          <svg className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 17L17 7M17 7H7M17 7v10" />
          </svg>
        </a>
      </section>

      {/* Version/Credits - very subtle, Apple style */}
      <section className="pt-2">
        <p className="text-[10px] text-muted-foreground/50 text-center">
          MTL Archives · v1.0
        </p>
      </section>

      {/* Close button - mobile only, Apple style */}
      <button 
        onClick={onClose}
        className="w-full py-3.5 bg-muted text-foreground text-[15px] font-medium rounded-xl sm:hidden active:bg-muted transition-colors"
      >
        {t.close}
      </button>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
type ArchiveStoreProps = {
  initialView?: 'landing' | 'search';
};

export function ArchiveStore({ initialView = 'landing' }: ArchiveStoreProps) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ArchiveStoreInner initialView={initialView} />
    </Suspense>
  );
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="h-6 w-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
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

function ArchiveStoreInner({ initialView = 'landing' }: ArchiveStoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { itemCount, openCart } = useCart();
  const isSearchView = initialView === 'search';

  // Detect mobile ONCE on mount
  const [isMobile, setIsMobile] = useState<boolean | null>(null); // Detect after mount
  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    setIsMobile(mobile);
  }, []);

  // State from URL
  const initialQuery = searchParams.get('q') || '';
  const initialMode = (searchParams.get('mode') as SearchMode) || 'smart';
  const initialLang = getLangFromSearchParams(searchParams);

  const [lang, setLang] = useState<Lang>(initialLang);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode);
  const [searchResults, setSearchResults] = useState<PhotoRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(isSearchView || !!initialQuery);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [heroPhotos, setHeroPhotos] = useState<PhotoRecord[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [newsletterEmail, setNewsletterEmail] = useState('');

  const t = translations[lang];
  const homeLink = appendLangParam('/', lang);
  const gameLink = appendLangParam('/game', lang);
  const printLink = appendLangParam('/print', lang);
  const landingCards = [
    {
      href: appendLangParam('/search', lang),
      icon: <Search className="h-4 w-4 text-brand-blue" />,
      title: t.discoverLead,
      body: t.discoverLeadBody,
    },
    {
      href: gameLink,
      icon: <CircleDot className="h-4 w-4 text-brand-orange" />,
      title: t.playLead,
      body: t.playLeadBody,
    },
    {
      href: printLink,
      icon: <Frame className="h-4 w-4 text-brand-green" />,
      title: t.printLead,
      body: t.printLeadBody,
    },
  ];
  const isMobileSafe = isMobile ?? true;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const isInitialMount = useRef(true);
  const filterTapTimestampsRef = useRef<number[]>([]);
  const telemetryContextRef = useRef({
    query: initialQuery,
    mode: initialMode,
    hasSearched: !!initialQuery,
    resultCount: 0,
    isSearching: false,
    mobile: true,
    lang: initialLang,
  });

  // Search quality tracking refs (used by clearSearch and effects below)
  const lastCommittedRef = useRef<{ query: string; mode: SearchMode } | null>(null);
  const searchResultClickedRef = useRef(false);
  const abandonmentRef = useRef<{ query: string; mode: string; count: number } | null>(null);

  // Focus state for search input
  const [isInputFocused, setIsInputFocused] = useState(false);
  
  // About drawer state
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // Social referrer detection (for analytics)
  const [isFromInstagram, setIsFromInstagram] = useState(false);
  const [isFromFacebook, setIsFromFacebook] = useState(false);

  // Detect Instagram visitors on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    const referrer = document.referrer || '';
    if (utmSource === 'instagram' || referrer.includes('instagram')) {
      setIsFromInstagram(true);
      events.instagramVisitorLanded(params.get('utm_campaign') || undefined);
      return;
    }
    if (utmSource === 'facebook' || referrer.includes('facebook') || referrer.includes('fb.com')) {
      setIsFromFacebook(true);
      events.facebookVisitorLanded(params.get('utm_campaign') || undefined);
    }
  }, []);

  // Clean up return-to-home query params from the game flow.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromGame = params.get('from') === 'game' || document.referrer.includes('/game');
    if (fromGame) {
      params.delete('ab');
      params.delete('from');
      const cleaned = params.toString();
      router.replace(cleaned ? `/?${cleaned}` : '/', { scroll: false });
    }
  }, [lang, router]);

  // Hook dismisses on first user interaction (see trackFirstInteraction)
  // No auto-dismiss timer - avoids jarring layout shift

  // URL helper
  const updateUrl = useCallback((q: string, mode: SearchMode, currentLang: Lang) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'smart') params.set('mode', mode);
    if (currentLang !== DEFAULT_LANG) params.set('lang', currentLang);
    const basePath = isSearchView ? '/search' : '/';
    router.replace(params.toString() ? `${basePath}?${params}` : basePath, { scroll: false });
  }, [isSearchView, router]);

  // Typewriter placeholder - pauses when input is focused
  const placeholders = useMemo(() => searchExamples[lang], [lang]);
  const isTypewriterActive = !searchQuery && !isInputFocused;
  const typewriterText = useTypewriter(placeholders, isTypewriterActive, 50, 35, 1200);

  // Show typewriter only when not focused and no query
  const showTypewriter = !searchQuery && !isInputFocused;
  // Show static placeholder when focused but empty
  const showFocusedPlaceholder = isInputFocused && !searchQuery;

  // Total photo count for display

  // === Session & Interaction Tracking Helpers ===
  // (defined early so handlers below can reference them)

  // Track first interaction (fires once per session)
  const firstInteractionTracked = useRef(false);
  const trackFirstInteraction = useCallback((action: string) => {
    if (firstInteractionTracked.current) return;
    firstInteractionTracked.current = true;
    // First interaction tracked
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

  const trackClientIssue = useCallback((
    type: 'runtime' | 'rejection',
    payload: { message?: string; reason?: string; source?: string; line?: number; col?: number }
  ) => {
    const ctx = telemetryContextRef.current;
    if (type === 'runtime') {
      events.clientRuntimeError({
        message: payload.message || 'Unknown runtime error',
        source: payload.source,
        line: payload.line,
        col: payload.col,
        query: ctx.query || undefined,
        mode: ctx.mode,
        hasSearched: ctx.hasSearched,
        resultCount: ctx.resultCount,
        isSearching: ctx.isSearching,
        mobile: ctx.mobile,
        lang: ctx.lang,
      });
      return;
    }
    events.clientUnhandledRejection({
      reason: payload.reason || 'Unknown promise rejection',
      query: ctx.query || undefined,
      mode: ctx.mode,
      hasSearched: ctx.hasSearched,
      resultCount: ctx.resultCount,
      isSearching: ctx.isSearching,
      mobile: ctx.mobile,
      lang: ctx.lang,
    });
  }, []);

  // Session storage keys for persisting shuffle state
  const STORAGE_KEY_PHOTOS = 'mtl-archives-photos';

  // Load photos - restores from session or fetches new shuffled set
  const loadPhotos = useCallback(async (forceRefresh = false) => {
    // Try to restore from session storage first (unless forcing refresh)
    if (!forceRefresh && typeof window !== 'undefined') {
      try {
        const cachedPhotos = sessionStorage.getItem(STORAGE_KEY_PHOTOS);
        if (cachedPhotos) {
          const parsed = JSON.parse(cachedPhotos);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPhotos(parsed);
            setInitialLoading(false);
            return;
          }
        }
      } catch (err) {
        // Session storage unavailable or corrupted, proceed with fetch
        console.warn('Failed to restore from session:', err);
      }
    }

    // Only show full skeleton on initial load (no existing photos yet).
    // Shuffle refreshes keep existing photos visible for a smoother transition.
    if (!forceRefresh) setInitialLoading(true);
    try {
    if (isMobile === null) return;
    const pageSize = isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
      // On mobile, limit image size to 1MB to prevent browser crashes
      // Cap source image size: mobile 1MB (memory), desktop 20MB (Vercel 50MB optimization limit)
      const sizeLimit = isMobile ? '&maxSize=1000000' : '&maxSize=20000000';
      const cacheBust = forceRefresh ? `&_=${Date.now()}` : '';
      const res = await fetch(`${API_BASE}/api/photos?limit=${pageSize}&shuffle=true${sizeLimit}${cacheBust}`);
      const data = await res.json();
      const items = data.items || [];

      setPhotos(items);

      // Fetch 3 high-trust photos for the mobile hero stack (separate from grid)
      if (isMobile && heroPhotos.length === 0) {
        try {
          const heroRes = await fetch(`${API_BASE}/api/photos?limit=3&shuffle=true&maxSize=1000000&minTrust=0.65`);
          const heroData = await heroRes.json();
          if (heroData.items?.length) setHeroPhotos(heroData.items);
        } catch {
          // Fall back silently — mobile stack will use grid photos
        }
      }

      // Cache in session storage for back navigation
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(items));
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
    if (hasSearched) {
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(isSearchView);
    }
    trackFirstInteraction('shuffle');
    trackSessionAction('shuffle');
    events.shuffleClicked();
    loadPhotos(true); // Force refresh
  }, [hasSearched, isSearchView, loadPhotos, trackFirstInteraction, trackSessionAction]);

  useEffect(() => {
    if (isMobile === null) return;
    loadPhotos(false); // Try to restore from cache first
  }, [loadPhotos, isMobile]);


  // Search (semantic only on mobile - no CLIP)
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(isSearchView);
      lastCommittedRef.current = null;
      if (!isInitialMount.current) updateUrl('', searchMode, lang);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      // Abort any in-flight search request to avoid wasted D1 reads
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setIsSearching(true);
      setHasSearched(true);
      setFailedImages(new Set()); // Clear failed images on new search
      if (!isInitialMount.current || !initialQuery) updateUrl(searchQuery, searchMode, lang);
      isInitialMount.current = false;

      try {
        const searchLimit = isMobileSafe ? String(MOBILE_MAX_IMAGES) : String(DESKTOP_MAX_IMAGES);
        const params = new URLSearchParams({ q: searchQuery, mode: searchMode, limit: searchLimit });
        if (isMobileSafe) {
          params.set('maxSize', '1000000');
        }
        const res = await fetch(`${API_BASE}/api/search?${params}`, { signal: controller.signal });
        if (res.ok) {
          const data: SearchResponse = await res.json();
          setSearchResults(data.items);
          trackSessionAction('search');

          // Track no results - helps identify content gaps
          if (data.items.length === 0) {
            events.searchNoResults(searchQuery, searchMode, lang);
          }

          // Track "committed" search after 1.5s of no further typing
          // Only fires once user has stopped typing - reduces event volume
          const committedQuery = searchQuery.trim();
          commitTimeoutRef.current = setTimeout(() => {
            const prevCommitted = lastCommittedRef.current;
            if (prevCommitted && prevCommitted.query !== committedQuery) {
              events.searchRefined(prevCommitted.query, committedQuery, searchMode);
            }
            events.searchCommitted(committedQuery, searchMode, data.items.length, lang);
            lastCommittedRef.current = { query: committedQuery, mode: searchMode };
          }, 1200);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // Expected on rapid typing
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      searchAbortRef.current?.abort();
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
    setHasSearched(isSearchView);
    lastCommittedRef.current = null;
    updateUrl('', searchMode, lang);
    searchInputRef.current?.focus();
  }, [isSearchView, updateUrl, searchMode, lang]);

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

  useEffect(() => {
    telemetryContextRef.current = {
      query: searchQuery,
      mode: searchMode,
      hasSearched,
      resultCount: displayPhotos.length,
      isSearching,
      mobile: isMobileSafe,
      lang,
    };
  }, [searchQuery, searchMode, hasSearched, displayPhotos.length, isSearching, isMobileSafe, lang]);

  const handleImageError = useCallback((photoId: string) => {
    setFailedImages(prev => new Set(prev).add(photoId));
  }, []);

  // Navigate to photo
  const handlePhotoClick = useCallback((photo: PhotoRecord, position?: number) => {
    trackFirstInteraction('photo_click');
    trackSessionAction('photo');
    events.photoViewed(photo.metadataFilename, photo.name, {
      searchQuery: hasSearched ? searchQuery : undefined,
      position,
      dateValue: photo.dateValue,
    });

    // Track search result clicks with position - helps optimize ranking
    if (hasSearched && searchQuery && position !== undefined) {
      searchResultClickedRef.current = true;
      events.searchResultClicked(searchQuery, position, photo.metadataFilename, searchResults.length);
    }

    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchMode !== 'smart') params.set('mode', searchMode);
    if (lang !== DEFAULT_LANG) params.set('lang', lang);
    router.push(`/photo/${encodeURIComponent(normalizePhotoId(photo.metadataFilename))}${params.toString() ? `?${params}` : ''}`);
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

  const handleNewsletterSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newsletterEmail.trim();
    const subject = lang === 'fr' ? 'Inscription infolettre MTL Archives' : 'MTL Archives newsletter signup';
    const body = trimmed
      ? lang === 'fr'
        ? `Bonjour,\n\nVeuillez ajouter ${trimmed} à l'infolettre MTL Archives.`
        : `Hello,\n\nPlease add ${trimmed} to the MTL Archives newsletter.`
      : lang === 'fr'
        ? 'Bonjour,\n\nVeuillez m’ajouter à l’infolettre MTL Archives.'
        : 'Hello,\n\nPlease add me to the MTL Archives newsletter.';

    window.location.href = `mailto:support@mtlarchives.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [lang, newsletterEmail]);

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

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      trackClientIssue('runtime', {
        message: event.message || event.error?.message || 'Runtime error',
        source: event.filename || undefined,
        line: event.lineno || undefined,
        col: event.colno || undefined,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      let reason = 'Unknown promise rejection';
      if (event.reason instanceof Error) {
        reason = event.reason.message;
      } else if (typeof event.reason === 'string') {
        reason = event.reason;
      } else {
        try {
          reason = JSON.stringify(event.reason);
        } catch {
          reason = String(event.reason);
        }
      }
      trackClientIssue('rejection', { reason });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [trackClientIssue]);

  useEffect(() => {
    if (!isMobileSafe || !hasSearched || isSearching || displayPhotos.length === 0) return;
    const anomalyTimer = setTimeout(() => {
      const tileCount = document.querySelectorAll('button.aspect-square img').length;
      if (tileCount === 0) {
        events.mobileRenderAnomaly({
          query: searchQuery || undefined,
          mode: searchMode,
          resultCount: displayPhotos.length,
          tileCount,
          mobile: isMobileSafe,
          lang,
        });
      }
    }, 1800);
    return () => clearTimeout(anomalyTimer);
  }, [isMobileSafe, hasSearched, isSearching, displayPhotos.length, searchQuery, searchMode, lang]);


  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Mobile */}
        <div className="flex flex-col sm:hidden">
          <div className="flex items-center justify-between h-[52px] px-5">
            {/* Logo — landing: lowercase Figtree 600; search: uppercase label */}
            <a href={homeLink} className={hasSearched
              ? 'text-[11px] font-medium tracking-[0.1em] uppercase'
              : 'flex items-center gap-2'
            }>
              {!hasSearched && <MtlArchivesLogo size={24} />}
              <span className={hasSearched ? '' : 'text-[15px] font-semibold text-foreground'}>
                {hasSearched ? 'MTL Archives' : 'mtl archives'}
              </span>
            </a>
            <div className={`flex items-center ${hasSearched ? 'gap-0.5' : 'gap-4'}`}>
              <a
                href={gameLink}
                onClick={() => events.gameNavClicked()}
                className={hasSearched
                  ? 'px-2.5 py-1 rounded-full border border-input text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground'
                  : 'text-[13px] font-medium text-primary hover:text-primary/80 transition-colors'
                }
              >
                {t.game}
              </a>
              {hasSearched ? (
                <button onClick={handleLangChange} className="p-1.5" aria-label={lang === 'fr' ? 'Changer en anglais' : 'Switch to French'}>
                  {lang === 'fr' ? <FlagQC /> : <FlagEN />}
                </button>
              ) : (
                <button onClick={handleLangChange} className="text-[13px] font-medium text-foreground/50 hover:text-foreground transition-colors" aria-label={lang === 'fr' ? 'Changer en anglais' : 'Switch to French'}>
                  {lang === 'fr' ? 'FR' : 'EN'}
                </button>
              )}
              {hasSearched && <button
                onClick={() => {
                  trackSessionAction('cart');
                  events.cartOpened();
                  openCart();
                }}
                className="p-1.5 text-muted-foreground/70 hover:text-muted-foreground transition-colors relative"
                aria-label={t.cart}
              >
                <ShoppingBag className="h-4 w-4" />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-primary text-primary-foreground text-[9px] font-medium rounded-full flex items-center justify-center">
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                )}
              </button>}
            </div>
          </div>
          {hasSearched && <div className="px-3 pb-2.5">
            {/* Search input with integrated mode toggle */}
            <div className={`flex items-center bg-card border h-11 rounded-xl relative transition-all duration-200 ${
              isInputFocused ? 'border-border shadow-sm' : 'border-input'
            }`}>
              <Search className={`ml-3 h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                isInputFocused ? 'text-muted-foreground' : 'text-muted-foreground/70'
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
                  <span className="text-base text-muted-foreground/70 truncate">{typewriterText}</span>
                  <span className="text-base text-foreground animate-blink">|</span>
                </div>
                {/* Static placeholder when focused */}
                <div className={`absolute inset-0 flex items-center px-2 pointer-events-none transition-opacity duration-200 ${
                  showFocusedPlaceholder ? 'opacity-100' : 'opacity-0'
                }`}>
                  <span className="text-base text-muted-foreground/50">{t.searchPlaceholder}</span>
                </div>
              </div>
              {isSearching && <div className="mr-2 h-4 w-4 border-2 border-input border-t-foreground rounded-full animate-spin flex-shrink-0" />}
              {searchQuery && !isSearching && (
                <button
                  onClick={clearSearch}
                  className="mr-2 p-1.5 hover:bg-muted rounded-full transition-colors flex-shrink-0"
                  aria-label={t.clear}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>}
        </div>

        {/* Desktop — search mode */}
        {hasSearched && (
          <div className="hidden sm:flex items-center h-14 px-4 lg:px-6 gap-4">
            <a href={homeLink} className="text-xs font-medium tracking-[0.12em] uppercase shrink-0">MTL Archives</a>
            <a
              href={gameLink}
              onClick={() => events.gameNavClicked()}
              className="px-2.5 py-1 rounded-full border border-input text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              {t.game}
            </a>
            <a
              href={printLink}
              className="px-2.5 py-1 rounded-full border border-input text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              {t.navPrints}
            </a>
            <div className="flex-1 flex justify-center">
              <div className="w-full max-w-lg">
                <div className={`flex items-center bg-card border h-9 rounded-lg transition-all duration-200 ${
                  isInputFocused ? 'border-border shadow-sm' : 'border-input'
                }`}>
                  <Search className={`ml-3 h-3.5 w-3.5 flex-shrink-0 transition-colors duration-200 ${
                    isInputFocused ? 'text-muted-foreground' : 'text-muted-foreground/70'
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
                    <div className={`absolute inset-0 flex items-center px-2.5 pointer-events-none transition-opacity duration-200 ${
                      showTypewriter ? 'opacity-100' : 'opacity-0'
                    }`}>
                      <span className="text-sm text-muted-foreground/70">{typewriterText}</span>
                      <span className="text-sm text-foreground animate-blink">|</span>
                    </div>
                    <div className={`absolute inset-0 flex items-center px-2.5 pointer-events-none transition-opacity duration-200 ${
                      showFocusedPlaceholder ? 'opacity-100' : 'opacity-0'
                    }`}>
                      <span className="text-sm text-muted-foreground/50">{t.searchPlaceholder}</span>
                    </div>
                  </div>
                  {isSearching && <div className="mr-3 h-3.5 w-3.5 border border-border border-t-foreground rounded-full animate-spin flex-shrink-0" />}
                  {searchQuery && !isSearching && (
                    <button
                      onClick={clearSearch}
                      className="mr-2 p-1 hover:bg-muted rounded-full transition-colors flex-shrink-0"
                      aria-label={t.clear}
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleLangChange}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted rounded transition-colors"
                aria-label={lang === 'fr' ? 'Changer en anglais' : 'Switch to French'}
              >
                {lang === 'fr' ? <FlagQC /> : <FlagEN />}
                <span className="text-[10px] text-muted-foreground uppercase">{lang === 'fr' ? 'FR' : 'EN'}</span>
              </button>
              <button
                onClick={() => {
                  trackSessionAction('cart');
                  events.cartOpened();
                  openCart();
                }}
                className="p-2 text-muted-foreground/70 hover:text-muted-foreground transition-colors relative"
                aria-label={t.cart}
              >
                <ShoppingBag className="h-4 w-4" />
                {itemCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 h-4 w-4 bg-primary text-primary-foreground text-[9px] font-medium rounded-full flex items-center justify-center">
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
        {/* Desktop — landing mode */}
        {!hasSearched && (
          <div className="hidden sm:flex items-center justify-between h-14 px-12">
            <a href={homeLink} className="flex items-center gap-2.5">
              <MtlArchivesLogo size={28} />
              <span className="text-[16px] font-semibold text-foreground">mtl archives</span>
            </a>
            <div className="flex items-center gap-8">
              <button
                onClick={() => {
                  const heroInput = document.querySelector('section input[type="text"]') as HTMLInputElement;
                  heroInput?.focus();
                }}
                className="text-[14px] text-foreground/60 hover:text-foreground transition-colors"
              >
                {t.navExplore}
              </button>
              <a
                href={gameLink}
                onClick={() => events.gameNavClicked()}
                className="text-[14px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {t.navDailyGame}
              </a>
              <a
                href={printLink}
                className="text-[14px] text-foreground/60 hover:text-foreground transition-colors"
              >
                {t.navPrints}
              </a>
              <button
                onClick={handleLangChange}
                className="text-[13px] text-border hover:text-foreground/60 transition-colors"
                aria-label={lang === 'fr' ? 'Changer en anglais' : 'Switch to French'}
              >
                {lang === 'fr' ? 'FR / EN' : 'EN / FR'}
              </button>
            </div>
          </div>
        )}
      </header>
      
      {/* About Drawer */}
      <AboutDrawer isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} t={t} />

      {/* Landing hero — visible only when not searching */}
      {!hasSearched && !initialLoading && (
        <LandingHero
          lang={lang}
          onSearchSubmit={(q) => {
            const trimmed = q.trim();
            if (!trimmed) return;
            if (isSearchView) {
              setSearchQuery(trimmed);
              return;
            }
            const params = new URLSearchParams();
            params.set('q', trimmed);
            if (searchMode !== 'smart') params.set('mode', searchMode);
            if (lang !== DEFAULT_LANG) params.set('lang', lang);
            router.push(`/search?${params.toString()}`);
          }}
          discoveryShortcuts={DISCOVERY_SHORTCUTS}
          typewriterText={typewriterText}
          isTypewriterActive={isTypewriterActive}
          photos={displayPhotos}
          mobilePhotos={heroPhotos}
          onPhotoClick={handlePhotoClick}
        />
      )}

      {hasSearched ? (
        <>
          <section className="px-5 pb-4 pt-4 sm:px-12 sm:pb-5 sm:pt-6">
            <div className="sm:hidden">
              <SearchModeTabs
                value={searchMode}
                onChange={handleModeChange}
                labels={{ modeSemantic: t.modeSemantic, modeVisual: t.modeVisual }}
              />
            </div>

            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
              {DISCOVERY_SHORTCUTS.slice(0, 8).map((shortcut) => (
                <button
                  key={shortcut.query}
                  type="button"
                  disabled={isSearching}
                  onClick={() => {
                    const now = Date.now();
                    const recentTaps = filterTapTimestampsRef.current.filter((ts) => now - ts <= FILTER_BURST_WINDOW_MS);
                    recentTaps.push(now);
                    filterTapTimestampsRef.current = recentTaps;

                    if (isMobileSafe && recentTaps.length >= 5) {
                      events.mobileFilterBurst({
                        taps: recentTaps.length,
                        windowMs: FILTER_BURST_WINDOW_MS,
                        activeQuery: shortcut.query,
                        lang,
                      });
                    }

                    setSearchQuery(shortcut.query);
                    trackFirstInteraction('neighborhood_shortcut');
                    events.discoveryFilterClicked(shortcut.name.en, shortcut.query);
                  }}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm transition-colors ${
                    shortcut.query === searchQuery
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-input bg-card text-foreground hover:bg-secondary'
                  }`}
                >
                  {shortcut.name[lang]}
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground">{displayPhotos.length}</span>{' '}
                {searchQuery ? `${t.resultsFor} « ${searchQuery} »` : displayPhotos.length === 1 ? t.result : t.results}
              </p>
              <div className="flex items-center gap-5">
                <span className="text-label text-[11px] tracking-[0.12em] text-muted-foreground">
                  {t.sortRelevance} ↓
                </span>
                <button
                  type="button"
                  onClick={clearSearch}
                  className="hidden text-label text-[11px] tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:block"
                >
                  {t.clear}
                </button>
              </div>
            </div>
          </section>

          {hasSearched && displayPhotos.length === 0 && !isSearching ? (
            <div className="px-5 py-16 text-center sm:px-12">
              <p className="text-lg text-foreground">{t.noResults} “{searchQuery}”</p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-4 text-label text-[11px] tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t.clearSearch}
              </button>
            </div>
          ) : null}

          {(initialLoading || (isSearching && displayPhotos.length === 0)) ? <SkeletonGrid /> : null}

          {!initialLoading && displayPhotos.length > 0 && !isSearching ? (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-5 pb-10 sm:hidden">
                {displayPhotos.map((photo, index) => (
                  <EditorialPhotoCard
                    key={photo.metadataFilename}
                    photo={photo}
                    onClick={() => handlePhotoClick(photo, index + 1)}
                    priority={index < 4}
                    aspectClassName="aspect-[0.92]"
                  />
                ))}
              </div>
              <div className="hidden grid-cols-3 gap-1.5 px-12 pb-14 md:grid lg:grid-cols-5">
                {displayPhotos.map((photo, index) =>
                  photo.imageUrl ? (
                    <PhotoTile
                      key={photo.metadataFilename}
                      src={photo.imageUrl}
                      alt={photo.name || ''}
                      priority={index < 8}
                      onClick={() => handlePhotoClick(photo, index + 1)}
                      onError={() => handleImageError(photo.metadataFilename)}
                    />
                  ) : null,
                )}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          {(initialLoading || (isSearching && displayPhotos.length === 0)) ? <SkeletonGrid /> : null}

          {!initialLoading && displayPhotos.length > 0 ? (
            <section className="px-5 pb-10 sm:px-12">
              <div className="hidden grid-cols-3 gap-5 sm:grid">
                {landingCards.map((card) => (
                  <LandingRouteCard key={card.href} {...card} />
                ))}
              </div>

              <div className="mt-10 flex items-center justify-between sm:mt-16">
                <span className="text-label text-[11px] tracking-[0.12em] text-primary">{t.featured}</span>
                <button
                  type="button"
                  onClick={handleShuffle}
                  disabled={initialLoading}
                  className="text-sm font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
                >
                  {t.shuffle}
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:hidden">
                <div className="grid grid-cols-2 gap-3">
                  {displayPhotos.slice(0, 2).map((photo, index) => (
                    <EditorialPhotoCard
                      key={photo.metadataFilename}
                      photo={photo}
                      onClick={() => handlePhotoClick(photo, index + 1)}
                      priority={index === 0}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {displayPhotos.slice(2, 5).map((photo, index) => (
                    <EditorialPhotoCard
                      key={photo.metadataFilename}
                      photo={photo}
                      onClick={() => handlePhotoClick(photo, index + 3)}
                      aspectClassName="aspect-square"
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5 hidden grid-cols-4 gap-4 sm:grid">
                {displayPhotos.slice(0, 4).map((photo, index) => (
                  <EditorialPhotoCard
                    key={photo.metadataFilename}
                    photo={photo}
                    onClick={() => handlePhotoClick(photo, index + 1)}
                    priority={index < 2}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="surface-subtle rounded-none border-x-0 px-5 py-10 sm:mx-12 sm:rounded-[1.8rem] sm:border-x sm:px-8 lg:px-10">
            <p className="text-label text-[11px] tracking-[0.14em] text-muted-foreground">{t.commitmentsTitle}</p>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <CommitmentBlurb
                colorClassName="bg-brand-blue"
                title={t.commitmentMemoryTitle}
                body={t.commitmentMemoryBody}
              />
              <CommitmentBlurb
                colorClassName="bg-brand-orange"
                title={t.commitmentSourcesTitle}
                body={t.commitmentSourcesBody}
              />
              <CommitmentBlurb
                colorClassName="bg-brand-green"
                title={t.commitmentAccessTitle}
                body={t.commitmentAccessBody}
              />
            </div>
          </section>

          <section className="px-5 py-8 sm:px-12 sm:py-12">
            <Link
              href={gameLink}
              className="surface-dark flex items-center justify-between gap-4 px-5 py-5 no-underline sm:px-8 sm:py-7"
            >
              <div className="min-w-0">
                <p className="text-label text-[11px] tracking-[0.14em] text-brand-orange">{t.gameTitle}</p>
                <h2 className="text-display mt-2 text-[1.95rem] font-semibold leading-none tracking-[-0.03em] text-white sm:mt-3 sm:text-[2rem]">
                  {t.gameQuestion}
                </h2>
                <p className="mt-2 text-sm text-white/70">{t.gameMetaLine}</p>
              </div>
              <span className="inline-flex h-10 shrink-0 items-center justify-center rounded-[0.9rem] bg-primary px-5 text-sm font-medium text-primary-foreground sm:h-11 sm:rounded-full sm:px-6">
                {t.gamePlay}
              </span>
            </Link>
          </section>

          <section className="px-5 pb-10 text-left sm:px-12 sm:pb-12 sm:text-center">
            <h2 className="text-display text-[2.35rem] font-semibold leading-[0.98] tracking-[-0.03em] text-foreground sm:text-[3.5rem]">
              {t.newsletterTitle}
            </h2>
            <p className="mt-3 max-w-[23rem] text-sm leading-6 text-muted-foreground sm:mx-auto sm:max-w-2xl sm:text-base">
              {t.newsletterBody}
            </p>
            <form
              onSubmit={handleNewsletterSubmit}
              className="mt-6 grid max-w-xl grid-cols-[minmax(0,1fr)_auto] gap-3 sm:mx-auto"
            >
              <div className="input-shell flex h-12 min-w-0 items-center px-4">
                <input
                  type="email"
                  value={newsletterEmail}
                  onChange={(event) => setNewsletterEmail(event.target.value)}
                  placeholder={t.newsletterPlaceholder}
                  className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center rounded-[0.9rem] bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92 sm:rounded-full sm:px-6"
              >
                {t.newsletterSubmit}
              </button>
            </form>
          </section>

          <section className="border-y border-border/50 px-5 py-5 sm:px-12">
            <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
              <div>
                <p className="text-label text-[11px] tracking-[0.14em] text-foreground/35">{t.footerSource}</p>
                <p className="mt-1 text-label text-[11px] tracking-[0.14em] text-foreground/25">{t.footerUrl}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t.printMeta}</p>
            </div>
            <div className="mt-5 sm:hidden">
              <button
                type="button"
                onClick={() => router.push(appendLangParam('/search', lang))}
                className="input-shell flex h-12 w-full items-center gap-3 px-4 text-left text-sm text-muted-foreground"
              >
                <Search className="h-4 w-4" />
                <span>{t.printSearchPlaceholder}</span>
              </button>
            </div>
          </section>
        </>
      )}

      {/* Footer */}
      {hasSearched ? <footer className="px-4 py-8">
        <div className="flex flex-col items-center gap-4">
          {/* Links */}
          <div className="flex items-center gap-4">
            <a
              href="https://instagram.com/mtlarchives"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => events.instagramClicked()}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              aria-label={t.instagram}
            >
              <IconInstagram className="h-5 w-5" />
            </a>
            <a
              href="https://www.facebook.com/mtlarchives/"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => events.facebookClicked()}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              aria-label={t.facebook}
            >
              <IconFacebook className="h-5 w-5" />
            </a>
            <button
              onClick={() => {
                events.aboutOpened();
                setIsAboutOpen(true);
              }}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              aria-label={t.about}
            >
              <IconInfo className="h-5 w-5" />
            </button>
          </div>
          {/* Copyright */}
          <p className="text-[10px] text-muted-foreground/50 tracking-wide">© {new Date().getFullYear()} MTL Archives</p>
        </div>
      </footer> : null}
    </div>
  );
}
