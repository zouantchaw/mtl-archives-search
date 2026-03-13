'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search, ShoppingBag } from 'lucide-react';
import { MtlArchivesLogo } from '@/components/LandingHero';
import { useCart } from '@/lib/cart-context';
import { appendLangParam, getLangFromSearchParams } from '@/lib/i18n';
import type { PhotoRecord } from '@/lib/types';
import { normalizePhotoId } from '@/lib/photo-id';

const translations = {
  fr: {
    title: "Impressions d'archives",
    explore: 'Explorer',
    dailyGame: 'Jeu quotidien',
    prints: 'Impressions',
    featuredLabel: "Sélection de l'archiviste",
    curatedLabel: 'Coup de cœur',
    searchTitle: 'Chercher une photo à imprimer',
    searchPlaceholder: 'Rue, quartier, sujet...',
    order: 'Commander',
    fromPrice: 'dès 45 $',
    trust: 'Imprimé à Montréal · Papier d’art · Livraison 5-7 jours',
    cart: 'Panier',
    exploreArchives: 'Explorer les archives',
  },
  en: {
    title: 'Archive prints',
    explore: 'Explore',
    dailyGame: 'Daily game',
    prints: 'Prints',
    featuredLabel: "Archivist's pick",
    curatedLabel: 'Curated',
    searchTitle: 'Find a photo to print',
    searchPlaceholder: 'Street, neighbourhood, subject...',
    order: 'Order',
    fromPrice: 'from $45',
    trust: 'Printed in Montreal · Fine art paper · Ships in 5-7 days',
    cart: 'Cart',
    exploreArchives: 'Explore the archives',
  },
} as const;

export function PrintGalleryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];
  const { itemCount, openCart } = useCart();

  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadPhotos() {
      const response = await fetch('/api/photos?limit=8&shuffle=true&maxSize=20000000');
      const data = await response.json();
      if (!cancelled) setPhotos(data.items || []);
    }

    void loadPhotos();

    return () => {
      cancelled = true;
    };
  }, []);

  const featured = photos[0];
  const curated = useMemo(() => photos.slice(1, 4), [photos]);
  const browse = useMemo(() => photos.slice(4, 8), [photos]);

  const orderHref = (photo: PhotoRecord) => {
    const base = appendLangParam(`/photo/${encodeURIComponent(normalizePhotoId(photo.metadataFilename))}`, lang);
    return `${base}${base.includes('?') ? '&' : '?'}order=1`;
  };

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const next = new URLSearchParams();
    next.set('q', trimmed);
    if (lang !== 'fr') next.set('lang', lang);
    router.push(`/search?${next.toString()}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-12">
          <div className="flex items-center gap-3 lg:hidden">
            <Link href={appendLangParam('/', lang)} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="text-base font-semibold text-foreground">{t.title}</span>
          </div>
          <div className="hidden lg:flex lg:items-center lg:gap-10">
            <Link href={appendLangParam('/', lang)} className="flex items-center gap-2.5 no-underline">
              <MtlArchivesLogo size={24} />
              <span className="text-[16px] font-semibold text-foreground">mtl archives</span>
            </Link>
            <nav className="flex items-center gap-8 text-[14px]">
              <Link href={appendLangParam('/search', lang)} className="text-foreground/60 transition-colors hover:text-foreground">
                {t.explore}
              </Link>
              <Link href={appendLangParam('/game', lang)} className="text-primary transition-colors hover:text-primary/80">
                {t.dailyGame}
              </Link>
              <span className="font-medium text-foreground">{t.prints}</span>
            </nav>
          </div>
          <button type="button" onClick={openCart} className="relative text-muted-foreground transition-colors hover:text-foreground" aria-label={t.cart}>
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 ? (
              <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6 lg:px-12 lg:py-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-8">
            {featured ? (
              <section className="surface-subtle overflow-hidden p-4">
                <div className="relative overflow-hidden rounded-[1.5rem] bg-muted">
                  <div className="relative aspect-[7/5]">
                    <Image src={featured.imageUrl} alt={featured.name || ''} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 60vw" unoptimized />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="mono-metric text-[11px] text-primary">{t.featuredLabel}</p>
                    <h1 className="text-display mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.03em] text-foreground">
                      {featured.name || 'MTL Archives'}
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">{t.fromPrice}</p>
                  </div>
                  <Link
                    href={orderHref(featured)}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
                  >
                    {t.order}
                  </Link>
                </div>
              </section>
            ) : null}

            <section>
              <p className="mono-metric text-[11px] text-muted-foreground">{t.curatedLabel}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {curated.map((photo) => (
                  <Link key={photo.metadataFilename} href={orderHref(photo)} className="group block">
                    <div className="relative aspect-[4/4.2] overflow-hidden rounded-[1.25rem] bg-muted">
                      <Image src={photo.imageUrl} alt={photo.name || ''} fill className="object-cover transition-transform duration-200 group-hover:scale-[1.02]" sizes="(max-width: 640px) 100vw, 220px" unoptimized />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium text-foreground">{photo.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t.fromPrice}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="border-t border-border pt-6">
              <h2 className="text-display text-[2rem] font-semibold tracking-[-0.03em] text-foreground">{t.searchTitle}</h2>
              <form onSubmit={handleSearchSubmit} className="mt-4">
                <div className="input-shell flex h-11 items-center gap-3 px-4">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/75"
                  />
                </div>
              </form>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {browse.map((photo) => (
                  <Link key={photo.metadataFilename} href={orderHref(photo)} className="group block">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-[1rem] bg-muted">
                      <Image src={photo.imageUrl} alt={photo.name || ''} fill className="object-cover transition-transform duration-200 group-hover:scale-[1.02]" sizes="(max-width: 640px) 50vw, 240px" unoptimized />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <aside className="surface-dark hidden h-fit p-6 lg:block">
            <div className="flex items-center gap-3">
              <MtlArchivesLogo size={24} />
              <span className="text-lg font-semibold">mtl archives</span>
            </div>
            <p className="text-display mt-8 text-4xl font-semibold leading-[0.98] tracking-[-0.03em]">Vos murs méritent une histoire.</p>
            <p className="mt-4 text-sm text-white/70">{t.trust}</p>
            <Link
              href={appendLangParam('/search', lang)}
              className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
            >
              {t.exploreArchives}
            </Link>
          </aside>
        </div>
      </main>
    </div>
  );
}
