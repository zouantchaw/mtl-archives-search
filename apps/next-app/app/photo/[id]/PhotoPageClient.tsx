'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MapPin, Share, ShoppingBag, X } from 'lucide-react';
import { MtlArchivesLogo } from '@/components/LandingHero';
import { FlagQC, FlagEN } from '@/components/ui/lang-flags';
import {
  PRINT_SIZES,
  PRODUCT_TYPES,
  WallPreview,
  type PrintSize,
  type ProductType,
} from '@/components/WallPreview';
import { Map, MapMarker, MapTileLayer, MapZoomControl } from '@/components/ui/map';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { appendLangParam, DEFAULT_LANG, getLangFromSearchParams, type Lang } from '@/lib/i18n';
import { buildOrientedImagePath } from '@/lib/oriented-image';
import type { PhotoRecord } from '@/lib/types';

const MONTREAL_CENTER: [number, number] = [45.5019, -73.5674];

const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const translations = {
  fr: {
    back: 'Retour',
    share: 'Partager',
    copied: 'Copié',
    orderPrint: 'Imprimer',
    orderCardBody: "Impression d'art · dès 45 $",
    orderModeTitle: 'Commander une impression',
    backToPhoto: 'Retour à la photo',
    size: 'Format',
    product: 'Type',
    addToCart: 'Ajouter au panier',
    added: 'Ajouté',
    notFound: 'Photo non trouvée',
    notFoundBody: "Cette référence n'est pas disponible ou a été retirée.",
    untitled: 'Sans titre',
    fulfillment: 'Imprimé à Montréal · Livraison 5-7 jours',
    noPaymentNow: 'Paiement confirmé par courriel après validation de la commande.',
    pricing: 'Résumé',
    sizeLine: 'Format',
    productLine: 'Type',
    subtotalLine: 'Sous-total',
    archiveId: 'Archive ID',
    confidence: 'Confiance',
    location: 'Lieu',
    description: 'Description',
    mapLabel: 'Localisation',
    mapMissing: 'Localisation non disponible pour cette photo.',
    credits: 'Archives de la Ville de Montréal',
    explore: 'Explorer',
    game: 'Jeu quotidien',
    prints: 'Impressions',
    close: 'Fermer',
  },
  en: {
    back: 'Back',
    share: 'Share',
    copied: 'Copied',
    orderPrint: 'Print',
    orderCardBody: 'Fine art print · from $45',
    orderModeTitle: 'Order a print',
    backToPhoto: 'Back to photo',
    size: 'Size',
    product: 'Type',
    addToCart: 'Add to cart',
    added: 'Added',
    notFound: 'Photo not found',
    notFoundBody: 'This archive reference is unavailable or has been removed.',
    untitled: 'Untitled',
    fulfillment: 'Printed in Montreal · Ships in 5-7 days',
    noPaymentNow: 'Payment is confirmed by email after we review the order.',
    pricing: 'Summary',
    sizeLine: 'Size',
    productLine: 'Type',
    subtotalLine: 'Subtotal',
    archiveId: 'Archive ID',
    confidence: 'Confidence',
    location: 'Location',
    description: 'Description',
    mapLabel: 'Location',
    mapMissing: 'Location data is not available for this photo.',
    credits: 'Montreal City Archives',
    explore: 'Explore',
    game: 'Daily game',
    prints: 'Prints',
    close: 'Close',
  },
} as const;

type PhotoPageClientProps = {
  photo: PhotoRecord | null;
  photoId: string;
};

function formatConfidence(value: number | null): string {
  if (value == null) return '—';
  if (value > 1) return `${Math.round(value)}%`;
  return value.toFixed(2);
}

function getDisplayLocation(photo: PhotoRecord): string {
  if (photo.latitude != null && photo.longitude != null) return 'Montréal';
  return '—';
}

function getProductLabel(product: ProductType, lang: Lang): string {
  return product.shortName[lang];
}

function getBackHref(searchParams: URLSearchParams | null, lang: Lang): string {
  const q = searchParams?.get('q');
  const searchMode = searchParams?.get('mode');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (searchMode) params.set('mode', searchMode);
  if (lang !== DEFAULT_LANG) params.set('lang', lang);
  return params.toString() ? `/search?${params.toString()}` : appendLangParam('/', lang);
}

export function PhotoPageClient({ photo, photoId }: PhotoPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem, itemCount, openCart } = useCart();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];
  const orderParam = searchParams?.get('order');
  const autoOrder = orderParam === '1' || orderParam === 'true' || orderParam === 'print';

  const [mode, setMode] = useState<'viewing' | 'ordering'>(() => (autoOrder ? 'ordering' : 'viewing'));
  const [selectedSize, setSelectedSize] = useState<PrintSize>(PRINT_SIZES[1]);
  const [selectedProduct, setSelectedProduct] = useState<ProductType>(PRODUCT_TYPES[0]);
  const [justAdded, setJustAdded] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const dwellFired = useRef(false);
  const autoOrderTrackedRef = useRef(false);
  const totalPrice = selectedSize.price + selectedProduct.price;
  const backHref = getBackHref(searchParams, lang);

  useEffect(() => {
    if (!photo || dwellFired.current) return;
    const timer = setTimeout(() => {
      if (dwellFired.current) return;
      dwellFired.current = true;
      events.photoDwelled(photo.metadataFilename, 5000, { dateValue: photo.dateValue });
    }, 5000);
    return () => clearTimeout(timer);
  }, [photo]);

  useEffect(() => {
    if (!photo || !autoOrder || autoOrderTrackedRef.current || mode !== 'ordering') return;
    autoOrderTrackedRef.current = true;
    events.orderModeEntered(photo.metadataFilename);
  }, [autoOrder, mode, photo]);

  const exitOrderMode = (addedToCart = false) => {
    if (photo) {
      events.orderModeExited(photo.metadataFilename, addedToCart);
    }
    setMode('viewing');
  };

  const handleBack = () => {
    if (mode === 'ordering') {
      exitOrderMode(false);
      return;
    }
    router.push(backHref);
  };

  const handleShare = async () => {
    if (!photo) return;
    const url = window.location.href;
    const title = cleanText(photo.name) || 'MTL Archives';
    events.photoShared(photo.metadataFilename, photo.name);

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled the share sheet.
      }
    }

    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(url);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 1800);
  };

  const handleAddToCart = () => {
    if (!photo) return;

    addItem({
      photoId: photo.metadataFilename,
      photoName: cleanText(photo.name) || t.untitled,
      photoUrl: buildOrientedImagePath(photo.imageUrl, photo.rotationDegrees),
      size: selectedSize.name,
      sizeId: selectedSize.id,
      frame: getProductLabel(selectedProduct, lang),
      frameId: selectedProduct.id,
      price: totalPrice,
    });

    events.addToCartClicked(
      photo.metadataFilename,
      selectedSize.name,
      getProductLabel(selectedProduct, lang),
      totalPrice,
      { dateValue: photo.dateValue }
    );

    setJustAdded(true);
    setTimeout(() => {
      setJustAdded(false);
      exitOrderMode(true);
      openCart();
    }, 800);
  };

  if (!photo) {
    return (
      <main className="min-h-screen bg-background px-5 py-12 lg:px-12">
        <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-2xl items-center justify-center">
          <div className="surface-card w-full px-8 py-10 text-center">
            <p className="mono-metric text-[11px] text-primary">mtl archives</p>
            <h1 className="text-display mt-6 text-4xl font-semibold tracking-[-0.03em] text-foreground">
              {t.notFound}
            </h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{t.notFoundBody}</p>
            <p className="mono-metric mt-6 text-[11px] text-muted-foreground">{photoId}</p>
            <Link
              href={backHref}
              className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
            >
              {t.back}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const title = cleanText(photo.name) || t.untitled;
  const date = cleanText(photo.dateValue) || cleanText(photo.portalDate);
  const description =
    photo.description && photo.description !== 'S/O'
      ? cleanText(photo.description)
      : cleanText(photo.portalDescription);
  const displayImageUrl = buildOrientedImagePath(photo.imageUrl, photo.rotationDegrees);
  const archiveId = cleanText(photo.cote) || cleanText(photo.portalCote) || photoId;
  const confidence = formatConfidence(photo.geocodeConfidence);
  const location = getDisplayLocation(photo);
  const hasMap = photo.latitude != null && photo.longitude != null;

  const imagePane = (
    <div className="relative overflow-hidden bg-muted lg:h-[calc(100vh-4.5rem)] lg:rounded-none">
      {!imageLoaded ? (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      ) : null}
      <div className="relative mx-auto aspect-[4/3] max-w-[1200px] lg:h-full lg:max-w-none lg:aspect-auto">
        <Image
          src={displayImageUrl}
          alt={title}
          fill
          priority
          unoptimized
          onLoad={() => setImageLoaded(true)}
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-contain"
        />
      </div>
    </div>
  );

  const metadataStrip = (
    <div className="grid gap-4 border-y border-border py-4 sm:grid-cols-3">
      <div>
        <p className="mono-metric text-[10px] text-muted-foreground">{t.archiveId}</p>
        <p className="mt-2 text-sm font-medium text-foreground">{archiveId}</p>
      </div>
      <div>
        <p className="mono-metric text-[10px] text-muted-foreground">{t.location}</p>
        <p className="mt-2 text-sm font-medium text-foreground">{location}</p>
      </div>
      <div>
        <p className="mono-metric text-[10px] text-muted-foreground">{t.confidence}</p>
        <p
          className={`mt-2 text-sm font-medium ${
            photo.geocodeConfidence != null && photo.geocodeConfidence >= 0.75
              ? 'text-brand-green'
              : 'text-foreground'
          }`}
        >
          {confidence}
        </p>
      </div>
    </div>
  );

  const printCard = (
    <button
      type="button"
      onClick={() => {
        setMode('ordering');
        events.orderModeEntered(photo.metadataFilename);
        events.printCtaClicked(photo.metadataFilename);
      }}
      className="surface-subtle flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-card"
    >
      <div className="relative h-16 w-20 overflow-hidden rounded-2xl bg-muted">
        <Image src={displayImageUrl} alt={title} fill unoptimized sizes="80px" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold text-foreground">{t.orderPrint}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.orderCardBody}</p>
      </div>
      <span className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground">
        {t.orderPrint}
      </span>
    </button>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="sm:hidden">
          <div className="flex h-12 items-center justify-between px-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={mode === 'ordering' ? t.backToPhoto : t.back}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-1">
              {mode === 'viewing' ? (
                <button
                  type="button"
                  onClick={handleShare}
                  className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t.share}
                >
                  <Share className="h-5 w-5" />
                  {showCopied ? (
                    <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t.copied}
                    </span>
                  ) : null}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => exitOrderMode(false)}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t.close}
                >
                  <X className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={openCart}
                className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Cart"
              >
                <ShoppingBag className="h-5 w-5" />
                {itemCount > 0 ? (
                  <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>

        <div className="hidden h-14 items-center justify-between px-12 sm:flex">
          <Link href={appendLangParam('/', lang)} className="flex items-center gap-2.5">
            <MtlArchivesLogo size={28} />
            <span className="text-[16px] font-semibold text-foreground">mtl archives</span>
          </Link>
          <div className="flex items-center gap-8 text-[14px]">
            <Link href={appendLangParam('/', lang)} className="text-foreground/60 transition-colors hover:text-foreground">
              {t.explore}
            </Link>
            <Link
              href={appendLangParam('/game', lang)}
              className="font-medium text-primary transition-colors hover:text-primary/80"
            >
              {t.game}
            </Link>
            <Link href={appendLangParam('/print', lang)} className="text-foreground transition-colors hover:text-primary">
              {t.prints}
            </Link>
            <button
              type="button"
              onClick={() => {
                const nextLang = lang === 'fr' ? 'en' : 'fr';
                const params = new URLSearchParams(searchParams?.toString());
                if (nextLang === DEFAULT_LANG) params.delete('lang');
                else params.set('lang', nextLang);
                router.push(params.toString() ? `/photo/${encodeURIComponent(photoId)}?${params.toString()}` : `/photo/${encodeURIComponent(photoId)}`);
              }}
              className="p-1.5 hover:bg-muted rounded transition-colors"
              aria-label={lang === 'fr' ? 'Changer en anglais' : 'Switch to French'}
            >
              {lang === 'fr' ? <FlagQC /> : <FlagEN />}
            </button>
          </div>
        </div>
      </header>

      {mode === 'viewing' ? (
        <main className="animate-fade-in lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,40rem)]">
          <section className="lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)]">{imagePane}</section>

          <section className="px-5 py-6 sm:px-8 lg:px-12 lg:py-9">
            <div className="max-w-3xl">
              <h1 className="text-display text-[2.25rem] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground sm:text-[3.25rem]">
                {title}
              </h1>
              {date ? <p className="mt-3 text-lg text-muted-foreground">{date}</p> : null}
              {description ? (
                <div className="mt-8">
                  <p className="mono-metric text-[10px] text-muted-foreground">{t.description}</p>
                  <p className="mt-3 max-w-2xl text-base leading-8 text-muted-foreground">{description}</p>
                </div>
              ) : null}

              <div className="mt-8">{metadataStrip}</div>

              <div className="mt-6">{printCard}</div>

              <div className="mt-6">
                <p className="mono-metric mb-3 text-[10px] text-muted-foreground">{t.mapLabel}</p>
                {hasMap ? (
                  <div className="surface-subtle overflow-hidden p-3">
                    <div className="relative h-40 overflow-hidden rounded-[1.25rem] bg-muted sm:h-56">
                      <Map
                        center={[photo.latitude ?? MONTREAL_CENTER[0], photo.longitude ?? MONTREAL_CENTER[1]]}
                        zoom={13}
                        className="h-full min-h-0 rounded-[1.25rem]"
                      >
                        <MapTileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                        <MapZoomControl className="bottom-3 right-3" />
                        <MapMarker
                          position={[photo.latitude ?? MONTREAL_CENTER[0], photo.longitude ?? MONTREAL_CENTER[1]]}
                          iconAnchor={[12, 12]}
                          icon={
                            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary shadow-lg">
                              <MapPin className="h-3.5 w-3.5 text-white" />
                            </div>
                          }
                        />
                      </Map>
                    </div>
                  </div>
                ) : (
                  <div className="surface-subtle px-5 py-8 text-sm text-muted-foreground">{t.mapMissing}</div>
                )}
              </div>

              <div className="mt-10 border-t border-border pt-6">
                <p className="mono-metric text-[10px] text-muted-foreground">{t.credits}</p>
              </div>
            </div>
          </section>
        </main>
      ) : (
        <main className="animate-fade-in bg-background px-5 py-4 sm:px-8 lg:px-12 lg:py-6">
          <div className="mx-auto lg:grid lg:max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
            <section>
              <div className="mb-4 flex items-center justify-between sm:hidden">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t.backToPhoto}
                </button>
                <p className="text-sm font-medium text-foreground">{t.orderModeTitle}</p>
                <button
                  type="button"
                  onClick={() => exitOrderMode(false)}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="surface-subtle overflow-hidden p-3 lg:rounded-[2rem] lg:p-6">
                {displayImageUrl ? (
                  <WallPreview
                    photoUrl={displayImageUrl}
                    photoAlt={title}
                    selectedSize={selectedSize}
                    selectedProduct={selectedProduct}
                    lang={lang}
                    onSlideChange={(_index, isRoom, roomId) => {
                      if (isRoom && roomId) events.roomBackgroundChanged(roomId);
                    }}
                  />
                ) : null}
              </div>
            </section>

            <aside className="mt-6 lg:mt-0 lg:sticky lg:top-20 lg:h-fit">
              <div className="hidden lg:block">
                <p className="text-display text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground">
                  {title}
                </p>
                {date ? <p className="mono-metric mt-4 text-[11px] text-muted-foreground">{date}</p> : null}
              </div>

              <div className="mt-6 space-y-6">
                <div>
                  <p className="mono-metric mb-3 text-[10px] text-muted-foreground">{t.product}</p>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCT_TYPES.map((product) => {
                      const active = selectedProduct.id === product.id;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            setSelectedProduct(product);
                            events.printFrameSelected(getProductLabel(product, lang), product.price);
                          }}
                          className={
                            active
                              ? 'inline-flex h-11 items-center justify-center rounded-full bg-brand-charcoal px-5 text-sm font-medium text-white'
                              : 'inline-flex h-11 items-center justify-center rounded-full border border-input bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted'
                          }
                        >
                          {getProductLabel(product, lang)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mono-metric mb-3 text-[10px] text-muted-foreground">{t.size}</p>
                  <div className="flex flex-wrap gap-2">
                    {PRINT_SIZES.map((size) => {
                      const active = selectedSize.id === size.id;
                      return (
                        <button
                          key={size.id}
                          type="button"
                          onClick={() => {
                            setSelectedSize(size);
                            events.printSizeSelected(size.name, size.price);
                          }}
                          className={
                            active
                              ? 'inline-flex h-11 items-center justify-center rounded-full bg-brand-charcoal px-5 text-sm font-medium text-white'
                              : 'inline-flex h-11 items-center justify-center rounded-full border border-input bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted'
                          }
                        >
                          {size.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-10 border-t border-border pt-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {getProductLabel(selectedProduct, lang)} · {selectedSize.name}
                    </p>
                  </div>
                  <p className="text-display text-5xl font-semibold tracking-[-0.04em] text-foreground">
                    {totalPrice} $
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={justAdded}
                  className={
                    justAdded
                      ? 'mt-6 inline-flex h-14 w-full items-center justify-center rounded-full bg-brand-green text-base font-semibold text-brand-dark'
                      : 'mt-6 inline-flex h-14 w-full items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/92'
                  }
                >
                  {justAdded ? t.added : t.addToCart}
                </button>

                <div className="mt-6 space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>{t.sizeLine}</span>
                    <span>{selectedSize.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t.productLine}</span>
                    <span>{getProductLabel(selectedProduct, lang)}</span>
                  </div>
                  <div className="flex items-center justify-between font-medium text-foreground">
                    <span>{t.subtotalLine}</span>
                    <span>{totalPrice} $</span>
                  </div>
                </div>

                <p className="mt-6 text-xs text-muted-foreground">{t.fulfillment}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t.noPaymentNow}</p>
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
