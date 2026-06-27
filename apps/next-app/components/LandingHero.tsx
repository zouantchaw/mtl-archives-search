'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CircleDot, Frame, Search } from 'lucide-react';
import { appendLangParam, type Lang } from '@/lib/i18n';
import type { PhotoRecord } from '@/lib/types';

export function MtlArchivesLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="1.5" fill="#111318" />
      <circle cx="12" cy="7.5" r="1.2" fill="#0F5EA8" />
      <circle cx="12" cy="4.5" r="0.9" fill="#0F5EA8" />
      <circle cx="10.2" cy="6" r="0.9" fill="#0F5EA8" />
      <circle cx="13.8" cy="6" r="0.9" fill="#0F5EA8" />
      <circle cx="16.5" cy="12" r="1.2" fill="#FF9500" />
      <circle cx="19.5" cy="12" r="0.9" fill="#FF9500" />
      <circle cx="18" cy="10.2" r="0.9" fill="#FF9500" />
      <circle cx="18" cy="13.8" r="0.9" fill="#FF9500" />
      <circle cx="12" cy="16.5" r="1.2" fill="#34C759" />
      <circle cx="12" cy="19.5" r="0.9" fill="#34C759" />
      <circle cx="10.2" cy="18" r="0.9" fill="#34C759" />
      <circle cx="13.8" cy="18" r="0.9" fill="#34C759" />
      <circle cx="7.5" cy="12" r="1.2" fill="#FFD60A" />
      <circle cx="4.5" cy="12" r="0.9" fill="#FFD60A" />
      <circle cx="6" cy="10.2" r="0.9" fill="#FFD60A" />
      <circle cx="6" cy="13.8" r="0.9" fill="#FFD60A" />
    </svg>
  );
}

const translations = {
  fr: {
    headline: 'Montréal, couche par couche.',
    subtitle: '13 000+ photos historiques à explorer, jouer et collectionner.',
    searchPlaceholder: 'Rue Sainte-Catherine, 1960...',
    ctaExplore: 'Explorer les archives',
    ctaPlay: 'Jouer',
    proofPhotos: '13 000+ photos',
    proofPlayers: '2 500+ joueurs',
    proofSource: 'Archives de Montréal',
    exploreTitle: 'Explorer',
    exploreBody: 'Chercher par mot, lieu ou époque',
    playTitle: 'Jouer',
    playBody: 'Deviner le quartier chaque jour',
    printTitle: 'Imprimer',
    printBody: "Papier d'art, dès 45 $",
  },
  en: {
    headline: 'Montreal, layer by layer.',
    subtitle: '13,000+ historical photos to explore, play, and collect.',
    searchPlaceholder: 'Sainte-Catherine Street, 1960...',
    ctaExplore: 'Explore the archives',
    ctaPlay: 'Play',
    proofPhotos: '13,000+ photos',
    proofPlayers: '2,500+ players',
    proofSource: 'Montreal archives',
    exploreTitle: 'Explore',
    exploreBody: 'Search by keyword, place, or decade',
    playTitle: 'Play',
    playBody: 'Guess the neighbourhood every day',
    printTitle: 'Print',
    printBody: 'Fine art paper, from $45',
  },
} as const;

type DiscoveryShortcut = {
  name: { fr: string; en: string };
  query: string;
};

type LandingHeroProps = {
  lang: Lang;
  onSearchSubmit: (query: string) => void;
  discoveryShortcuts: readonly DiscoveryShortcut[];
  typewriterText: string;
  isTypewriterActive: boolean;
  photos?: PhotoRecord[];
  mobilePhotos?: PhotoRecord[];
  onPhotoClick?: (photo: PhotoRecord, index: number) => void;
};

const LANDING_PILLS = [
  { fr: 'Neige', en: 'Snow', query: 'snow' },
  { fr: 'Tramway', en: 'Streetcar', query: 'tramway' },
  { fr: 'Plateau', en: 'Plateau', query: 'Plateau' },
  { fr: 'Escaliers', en: 'Staircases', query: 'escalier' },
  { fr: 'Aérien', en: 'Aerial', query: 'aerial view' },
  { fr: 'Église', en: 'Church', query: 'church' },
  { fr: 'Hockey', en: 'Hockey', query: 'hockey' },
] as const;

function MobileArchiveStack({
  photos,
  onPhotoClick,
}: {
  photos: PhotoRecord[];
  onPhotoClick?: (photo: PhotoRecord, index: number) => void;
}) {
  const stackPhotos = photos.filter((photo) => photo.imageUrl).slice(0, 3);
  const [activeIndex, setActiveIndex] = useState(0);

  const advance = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % 3);
  }, []);

  useEffect(() => {
    const id = setInterval(advance, 2800);
    return () => clearInterval(id);
  }, [advance]);

  const cards = [
    { restX: 8, restY: 32, rotation: -5 },
    { restX: 75, restY: 4, rotation: 1.5 },
    { restX: 141, restY: 40, rotation: -1 },
  ];

  return (
    <div className="relative mx-auto h-[250px] max-w-[21rem]">
      {cards.map((card, index) => {
        const photo = stackPhotos[index];
        const isActive = index === activeIndex;

        return (
          <button
            key={index}
            type="button"
            onClick={() => photo && onPhotoClick?.(photo, index)}
            className="absolute h-[140px] w-[132px] overflow-hidden rounded-[0.95rem] border border-white/60 bg-[#d8d1c7] active:scale-95"
            style={{
              left: card.restX,
              top: card.restY,
              zIndex: isActive ? 20 : 10 - index,
              transform: isActive
                ? `rotate(${card.rotation}deg) translateY(-14px) scale(1.06)`
                : `rotate(${card.rotation}deg) translateY(0) scale(1)`,
              boxShadow: isActive
                ? '0 20px 44px rgba(17,19,24,0.14), 0 2px 8px rgba(17,19,24,0.06)'
                : '0 16px 34px rgba(17,19,24,0.08)',
              transition: 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.8s cubic-bezier(0.22, 1, 0.36, 1), z-index 0s',
            }}
          >
            {photo?.imageUrl ? (
              <Image
                src={photo.imageUrl}
                alt={photo.name || ''}
                fill
                className="object-cover opacity-80 sepia-[0.15]"
                sizes="134px"
                priority={index === 0}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function LandingActionCard({
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
      className="surface-card flex min-h-[7.9rem] flex-col items-center justify-center gap-3 px-3 py-4 text-center no-underline transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background">{icon}</div>
      <div className="space-y-1.5">
        <p className="text-[1.35rem] font-semibold leading-none tracking-[-0.03em] text-foreground">{title}</p>
        <p className="text-[0.92rem] leading-5 text-muted-foreground">{body}</p>
      </div>
    </Link>
  );
}

export function LandingHero({
  lang,
  onSearchSubmit,
  typewriterText,
  isTypewriterActive,
  photos,
  mobilePhotos,
  onPhotoClick,
}: LandingHeroProps) {
  const t = translations[lang];
  const [localQuery, setLocalQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showTypewriter = !localQuery && !isFocused && isTypewriterActive;
  const showStaticPlaceholder = isFocused && !localQuery;
  const mosaicPhotos = photos?.filter((photo) => photo.imageUrl).slice(0, 6) ?? [];
  const homeActions = [
    {
      href: appendLangParam('/search', lang),
      icon: <Search className="h-4 w-4 text-brand-blue" />,
      title: t.exploreTitle,
      body: t.exploreBody,
    },
    {
      href: appendLangParam('/game', lang),
      icon: <CircleDot className="h-4 w-4 text-brand-orange" />,
      title: t.playTitle,
      body: t.playBody,
    },
    {
      href: appendLangParam('/print', lang),
      icon: <Frame className="h-4 w-4 text-brand-green" />,
      title: t.printTitle,
      body: t.printBody,
    },
  ];

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = localQuery.trim();
    if (!trimmed) return;
    onSearchSubmit(trimmed);
  }

  return (
    <section className="px-5 pb-8 pt-10 sm:px-12 sm:pb-10 sm:pt-12">
      <div className="flex flex-col gap-10 sm:grid sm:grid-cols-[minmax(0,31rem)_minmax(0,1fr)] sm:items-start sm:gap-14">
        <div className="flex flex-col gap-7 sm:gap-7">
          <div className="space-y-4">
            <h1 className="text-display max-w-[20rem] text-[3.6rem] font-semibold leading-[0.94] tracking-[-0.05em] text-foreground sm:max-w-none sm:text-[4.9rem]">
              {t.headline}
            </h1>
            <p className="max-w-[21rem] text-[1.04rem] leading-8 text-muted-foreground sm:max-w-[36rem]">
              {t.subtitle}
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="hidden sm:block">
            <div className="input-shell flex h-[3.25rem] items-center gap-3 px-4 sm:h-12">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="relative h-full min-w-0 flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={localQuery}
                  onChange={(event) => setLocalQuery(event.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  className="absolute inset-0 h-full w-full bg-transparent text-[15px] text-foreground outline-none"
                />
                <div
                  className={`pointer-events-none absolute inset-0 flex items-center transition-opacity duration-200 ${
                    showTypewriter ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <span className="truncate text-[15px] text-muted-foreground/70">{typewriterText}</span>
                  <span className="text-[15px] text-foreground animate-blink">|</span>
                </div>
                <div
                  className={`pointer-events-none absolute inset-0 flex items-center transition-opacity duration-200 ${
                    showStaticPlaceholder ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <span className="text-[15px] text-muted-foreground/55">{t.searchPlaceholder}</span>
                </div>
              </div>
            </div>
          </form>

          <div className="hidden items-center gap-3 sm:flex">
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
            >
              {t.ctaExplore}
            </button>
            <Link
              href={appendLangParam('/game', lang)}
              className="inline-flex h-11 items-center justify-center rounded-full border border-input px-6 text-sm font-medium text-foreground no-underline transition-colors hover:bg-card"
            >
              {t.ctaPlay}
            </Link>
          </div>

          <div className="hidden items-center gap-2 overflow-x-auto pb-1 sm:flex sm:flex-wrap">
            {LANDING_PILLS.map((pill) => (
              <button
                key={pill.query}
                type="button"
                onClick={() => onSearchSubmit(pill.query)}
                className="rounded-full border border-input px-4 py-2 text-sm text-foreground transition-colors hover:bg-card"
              >
                {pill[lang]}
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-6 text-label text-[11px] tracking-[0.14em] text-foreground/38 sm:flex">
            <span>{t.proofPhotos}</span>
            <span>•</span>
            <span>{t.proofPlayers}</span>
            <span>•</span>
            <span>{t.proofSource}</span>
          </div>

          <div className="sm:hidden">
            <MobileArchiveStack photos={mobilePhotos?.length ? mobilePhotos : (photos ?? [])} onPhotoClick={onPhotoClick} />
          </div>

          <div className="grid grid-cols-3 gap-3.5 sm:hidden">
            {homeActions.map((action) => (
              <LandingActionCard key={action.href} {...action} />
            ))}
          </div>
        </div>

        {mosaicPhotos.length > 0 ? (
          <div className="hidden h-[26rem] gap-3 sm:flex">
            {[0, 1, 2].map((columnIndex) => (
              <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-3">
                {mosaicPhotos.slice(columnIndex * 2, columnIndex * 2 + 2).map((photo, photoIndex) => (
                  <button
                    key={photo.metadataFilename}
                    type="button"
                    onClick={() => onPhotoClick?.(photo, columnIndex * 2 + photoIndex + 1)}
                    className="relative min-w-0 overflow-hidden rounded-[1.4rem] bg-muted"
                    style={{ flex: (columnIndex + photoIndex) % 2 === 0 ? '1.1 1 0%' : '0.85 1 0%' }}
                  >
                    <Image
                      src={photo.imageUrl!}
                      alt={photo.name || ''}
                      fill
                      className="object-cover"
                      sizes="(min-width: 640px) 24vw, 0px"
                      priority={columnIndex * 2 + photoIndex < 3}
                    />
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
