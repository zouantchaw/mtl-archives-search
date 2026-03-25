'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, MapPin, Search, ShoppingBag, Sparkles } from 'lucide-react';
import { MtlArchivesLogo } from '@/components/LandingHero';
import {
  PRINT_SIZES,
  PRODUCT_TYPES,
  WallPreview,
  type PrintSize,
  type ProductType,
} from '@/components/WallPreview';
import { ImageRotationControl } from '@/components/ImageRotationControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { useCart } from '@/lib/cart-context';
import { appendLangParam, getLangFromSearchParams, type Lang } from '@/lib/i18n';
import {
  buildOrientedImagePath,
  combineRotationDegrees,
  rotateClockwise,
  type ImageRotation,
} from '@/lib/oriented-image';
import { normalizePhotoId } from '@/lib/photo-id';
import type { PhotoRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const QUICK_SEARCHES = {
  fr: ['Vieux-Montréal', 'Plateau', 'Métro', 'Expo 67'],
  en: ['Old Montreal', 'Plateau', 'Metro', 'Expo 67'],
} as const;

const translations = {
  fr: {
    title: "Impressions d'archives",
    explore: 'Explorer',
    dailyGame: 'Jeu quotidien',
    prints: 'Impressions',
    cart: 'Panier',
    heroEyebrow: 'Impressions prêtes à commander',
    heroTitle: 'Des images historiques qui méritent déjà un mur.',
    heroBody:
      "Nous mettons de l'avant les photos les mieux documentées de la collection, pour que vous puissiez choisir vite, voir le rendu chez vous, puis commander sans friction.",
    heroPrimaryCta: 'Personnaliser cette impression',
    heroSecondaryCta: 'Explorer les archives',
    heroSearchLabel: 'Chercher une photo à imprimer',
    heroSearchPlaceholder: 'Rue, quartier, sujet...',
    heroSearchSubmit: 'Chercher',
    quickSearchLabel: 'Essais rapides',
    proofTitle: 'Pourquoi cette page convertit mieux',
    proofPoints: [
      'Photos avec métadonnées riches et repères plus clairs',
      "Aperçu mural immédiat avec papier, cadre et format",
      'Impression à Montréal et livraison Canada + Etats-Unis',
    ],
    previewEyebrow: "Aperçu d'impression",
    previewInstruction: 'Choisissez une image plus bas pour la voir instantanément sur le mur.',
    rotateImage: "Tourner l'image",
    product: 'Type',
    size: 'Format',
    selectedPrint: 'Sélection',
    customize: 'Personnaliser',
    fromPrice: 'dès 45 $',
    fulfillment: 'Paiement sécurisé à l’étape suivante. Nous préparons ensuite chaque commande manuellement à Montréal.',
    richMetadata: 'Métadonnées riches',
    verifiedRecord: 'Notice validée',
    mappedPhoto: 'Photo géolocalisée',
    datedPhoto: 'Date connue',
    picksEyebrow: 'Sélection de l’archiviste',
    picksTitle: 'Les meilleures photos à imprimer maintenant',
    picksBody:
      'Nous favorisons les images qui racontent déjà quelque chose: titre solide, date exploitable, localisation, description ou notice liée.',
    previewButton: 'Voir sur le mur',
    moreTitle: "Encore plus d'images prêtes à imprimer",
    moreBody: "Pour les visiteurs qui veulent comparer avant d'acheter, sans retomber dans une galerie froide.",
    stickyLabel: 'Impression sélectionnée',
    finalTitle: 'Vous cherchez plutôt une rue, un quartier ou un lieu précis ?',
    finalBody:
      "Lancez une recherche directe dans toute la collection puis ouvrez n'importe quelle photo en mode impression.",
    finalCta: 'Explorer toutes les archives',
    noPhotos: "Impossible de charger la sélection d'impressions pour le moment.",
    noPhotosBody: 'La recherche reste disponible pendant que la sélection se recharge.',
    untitled: 'MTL Archives',
    locationKnown: 'Montréal',
  },
  en: {
    title: 'Archive prints',
    explore: 'Explore',
    dailyGame: 'Daily game',
    prints: 'Prints',
    cart: 'Cart',
    heroEyebrow: 'Prints ready to order',
    heroTitle: 'Historic images that already deserve a wall.',
    heroBody:
      'This page leads with the strongest records in the collection so people can choose quickly, preview the piece in a room, and start an order without friction.',
    heroPrimaryCta: 'Customize this print',
    heroSecondaryCta: 'Explore the archives',
    heroSearchLabel: 'Find a photo to print',
    heroSearchPlaceholder: 'Street, neighbourhood, subject...',
    heroSearchSubmit: 'Search',
    quickSearchLabel: 'Quick starts',
    proofTitle: 'Built to convert',
    proofPoints: [
      'Photos with richer metadata and clearer context',
      'Instant wall preview with size and product options',
      'Printed in Montreal and shipped across Canada and the US',
    ],
    previewEyebrow: 'Print preview',
    previewInstruction: 'Pick another image below to preview it on the wall instantly.',
    rotateImage: 'Rotate image',
    product: 'Type',
    size: 'Size',
    selectedPrint: 'Selection',
    customize: 'Customize',
    fromPrice: 'from $45',
    fulfillment: 'Secure card payment happens at the next step. We then prepare every order manually in Montreal.',
    richMetadata: 'Rich metadata',
    verifiedRecord: 'Verified record',
    mappedPhoto: 'Mapped photo',
    datedPhoto: 'Known date',
    picksEyebrow: "Archivist's picks",
    picksTitle: 'The strongest images to print right now',
    picksBody:
      'These records surface first because they already carry enough context to feel collectible: strong title, usable date, location, description, or linked record.',
    previewButton: 'Preview on wall',
    moreTitle: 'More print-ready images',
    moreBody: 'For visitors who want to compare before ordering, without dropping them into a cold gallery.',
    stickyLabel: 'Selected print',
    finalTitle: 'Looking for a specific street, neighbourhood, or landmark?',
    finalBody:
      'Search across the full collection, then open any result directly in print mode.',
    finalCta: 'Explore the full archive',
    noPhotos: 'The print selection is unavailable right now.',
    noPhotosBody: 'Search is still available while the featured picks reload.',
    untitled: 'MTL Archives',
    locationKnown: 'Montreal',
  },
} as const;

function getPhotoTitle(photo: PhotoRecord, lang: Lang) {
  return cleanText(photo.name) || cleanText(photo.portalTitle) || translations[lang].untitled;
}

function getPhotoDate(photo: PhotoRecord) {
  return cleanText(photo.dateValue) || cleanText(photo.portalDate);
}

function getPhotoStory(photo: PhotoRecord) {
  const description = cleanText(photo.description);
  if (description && description !== 'S/O') return description;

  const portalDescription = cleanText(photo.portalDescription);
  if (portalDescription) return portalDescription;

  return cleanText(photo.vlmCaption);
}

function getPhotoLocation(photo: PhotoRecord, lang: Lang) {
  if (photo.latitude != null && photo.longitude != null) return translations[lang].locationKnown;
  return '';
}

function getPhotoImage(photo: PhotoRecord) {
  return buildOrientedImagePath(photo.imageUrl, photo.rotationDegrees);
}

function getProductLabel(product: ProductType, lang: Lang): string {
  return product.shortName[lang];
}

type PhotoPrintCardProps = {
  active?: boolean;
  lang: Lang;
  photo: PhotoRecord;
  previewLabel: string;
  customizeLabel: string;
  onPreview: () => void;
  orderHref: string;
};

function PhotoPrintCard({
  active = false,
  lang,
  photo,
  previewLabel,
  customizeLabel,
  onPreview,
  orderHref,
}: PhotoPrintCardProps) {
  const t = translations[lang];
  const title = getPhotoTitle(photo, lang);
  const date = getPhotoDate(photo);
  const location = getPhotoLocation(photo, lang);
  const story = getPhotoStory(photo);
  const photoImage = getPhotoImage(photo);

  return (
    <Card
      size="sm"
      className={cn(
        'overflow-hidden p-0 transition-[transform,box-shadow,border-color] duration-200',
        active ? 'border-primary/35 shadow-[var(--shadow-floating)]' : 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]'
      )}
    >
      <div className="relative aspect-[4/3] bg-muted">
        <Image
          src={photoImage}
          alt={title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 90vw, (max-width: 1280px) 45vw, 28vw"
          unoptimized
        />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {photo.portalMatch ? <Badge variant="secondary">{t.verifiedRecord}</Badge> : null}
          {date ? <Badge variant="outline">{date}</Badge> : null}
        </div>
      </div>

      <CardHeader className="gap-3 pt-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="accent">{t.richMetadata}</Badge>
          {location ? <Badge variant="outline">{location}</Badge> : null}
        </div>
        <div>
          <p className="line-clamp-2 text-base font-semibold tracking-[-0.02em] text-foreground">{title}</p>
          {story ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{story}</p> : null}
        </div>
      </CardHeader>

      <CardContent className="pb-5">
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="surface-subtle rounded-[1rem] px-3 py-2">
            <p className="mono-metric text-[10px] text-muted-foreground">{t.size}</p>
            <p className="mt-1 text-sm font-medium text-foreground">18×24"</p>
          </div>
          <div className="surface-subtle rounded-[1rem] px-3 py-2">
            <p className="mono-metric text-[10px] text-muted-foreground">{t.customize}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{t.fromPrice}</p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3">
        <Button type="button" variant={active ? 'secondary' : 'outline'} size="sm" onClick={onPreview}>
          {previewLabel}
        </Button>
        <Button asChild size="sm">
          <Link href={orderHref}>{customizeLabel}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function PrintGalleryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];
  const { itemCount, openCart } = useCart();

  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<PrintSize>(PRINT_SIZES[1]);
  const [selectedProduct, setSelectedProduct] = useState<ProductType>(PRODUCT_TYPES[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [selectedRotation, setSelectedRotation] = useState<ImageRotation>(0);

  useEffect(() => {
    let cancelled = false;

    async function loadPhotos() {
      setIsLoading(true);
      setHasError(false);

      try {
        const response = await fetch('/api/photos?limit=18&sort=print_best&maxSize=10000000&minTrust=0.55');
        if (!response.ok) throw new Error(`Failed to load print photos (${response.status})`);
        const data = await response.json();

        if (!cancelled) {
          setPhotos(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        if (!cancelled) {
          setPhotos([]);
          setHasError(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadPhotos();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setShowStickyCta(window.scrollY > 560);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const rankedPhotos = photos;

  const featured = rankedPhotos[0] ?? null;

  useEffect(() => {
    if (!featured) return;

    if (!selectedPhotoId || !rankedPhotos.some(photo => photo.metadataFilename === selectedPhotoId)) {
      setSelectedPhotoId(featured.metadataFilename);
    }
  }, [featured, rankedPhotos, selectedPhotoId]);

  useEffect(() => {
    setSelectedRotation(0);
  }, [selectedPhotoId]);

  const selectedPhoto = useMemo(
    () => rankedPhotos.find(photo => photo.metadataFilename === selectedPhotoId) ?? featured,
    [featured, rankedPhotos, selectedPhotoId]
  );

  const spotlightPhotos = useMemo(() => rankedPhotos.slice(0, 4), [rankedPhotos]);
  const browsePhotos = useMemo(
    () => rankedPhotos.filter(photo => photo.metadataFilename !== selectedPhoto?.metadataFilename).slice(0, 8),
    [rankedPhotos, selectedPhoto?.metadataFilename]
  );

  const selectedTitle = selectedPhoto ? getPhotoTitle(selectedPhoto, lang) : t.untitled;
  const selectedStory = selectedPhoto ? getPhotoStory(selectedPhoto) : '';
  const selectedDate = selectedPhoto ? getPhotoDate(selectedPhoto) : '';
  const selectedLocation = selectedPhoto ? getPhotoLocation(selectedPhoto, lang) : '';
  const selectedImage = selectedPhoto
    ? buildOrientedImagePath(
        selectedPhoto.imageUrl,
        combineRotationDegrees(selectedPhoto.rotationDegrees, selectedRotation)
      )
    : '';
  const totalPrice = selectedSize.price + selectedProduct.price;

  const orderHref = (photo: PhotoRecord, rotationAdjustment: ImageRotation = 0) => {
    const base = appendLangParam(`/photo/${encodeURIComponent(normalizePhotoId(photo.metadataFilename))}`, lang);
    const next = new URLSearchParams();
    next.set('order', '1');

    // The rot param stores the user's extra rotation, not the archive's base rotation.
    if (rotationAdjustment !== 0) {
      next.set('rot', String(rotationAdjustment));
    }

    return `${base}${base.includes('?') ? '&' : '?'}${next.toString()}`;
  };

  const selectedOrderHref = selectedPhoto ? orderHref(selectedPhoto, selectedRotation) : appendLangParam('/print', lang);

  function pushSearch(searchValue: string) {
    const trimmed = searchValue.trim();
    if (!trimmed) return;

    const next = new URLSearchParams();
    next.set('q', trimmed);
    if (lang !== 'fr') next.set('lang', lang);
    router.push(`/search?${next.toString()}`);
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pushSearch(query);
  }

  function handleQuickSearch(term: string) {
    setQuery(term);
    pushSearch(term);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-12">
          <div className="flex items-center gap-3 lg:hidden">
            <Link
              href={appendLangParam('/', lang)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Back"
            >
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

          <button
            type="button"
            onClick={openCart}
            className="relative text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t.cart}
          >
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 ? (
              <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6 pb-32 lg:px-12 lg:py-10 lg:pb-12">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] lg:items-start">
          <div className="space-y-6">
            <div className="space-y-4">
              <Badge variant="secondary">{t.heroEyebrow}</Badge>
              <div className="max-w-2xl">
                <h1 className="text-display text-[2.9rem] font-semibold leading-[0.92] tracking-[-0.05em] text-foreground sm:text-[4.4rem]">
                  {t.heroTitle}
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">{t.heroBody}</p>
              </div>
            </div>

            <div className="surface-subtle p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <p className="mono-metric text-[10px] text-primary">{t.heroSearchLabel}</p>
              </div>

              <form onSubmit={handleSearchSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <div className="input-shell flex h-14 min-w-0 flex-1 items-center gap-3 px-4 sm:h-12">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t.heroSearchPlaceholder}
                    className="h-full flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/75 sm:text-sm"
                  />
                </div>
                <Button type="submit" size="lg" className="h-14 text-base sm:h-12 sm:px-7 sm:text-sm">
                  {t.heroSearchSubmit}
                </Button>
              </form>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <p className="mono-metric mr-1 text-[10px] text-muted-foreground">{t.quickSearchLabel}</p>
                {QUICK_SEARCHES[lang].map(term => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => handleQuickSearch(term)}
                    className="inline-flex h-8 items-center rounded-full border border-border bg-background/75 px-3 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {t.proofPoints.map(point => (
                <div key={point} className="surface-card px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 text-primary">
                      <Check className="h-4 w-4" />
                    </span>
                    <p className="text-sm leading-6 text-foreground">{point}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="surface-subtle overflow-hidden p-3 sm:p-4 lg:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="mono-metric text-[10px] text-primary">{t.previewEyebrow}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t.previewInstruction}</p>
                </div>
                <Badge variant="outline">{t.fromPrice}</Badge>
              </div>

              {selectedPhoto ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="mono-metric text-[10px] text-muted-foreground">{t.rotateImage}</p>
                  <ImageRotationControl
                    lang={lang}
                    rotation={combineRotationDegrees(selectedPhoto.rotationDegrees, selectedRotation)}
                    onRotate={() => setSelectedRotation(current => rotateClockwise(current))}
                  />
                </div>
              ) : null}

              {selectedPhoto ? (
                <WallPreview
                  photoUrl={selectedImage}
                  photoAlt={selectedTitle}
                  selectedSize={selectedSize}
                  selectedProduct={selectedProduct}
                  lang={lang}
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-[1.5rem] bg-muted text-sm text-muted-foreground">
                  {isLoading ? t.previewEyebrow : t.noPhotos}
                </div>
              )}
            </div>

            <div className="surface-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="accent">{t.richMetadata}</Badge>
                    {selectedPhoto?.portalMatch ? <Badge variant="secondary">{t.verifiedRecord}</Badge> : null}
                    {selectedDate ? <Badge variant="outline">{selectedDate}</Badge> : null}
                    {selectedLocation ? (
                      <Badge variant="outline">
                        <MapPin className="h-3 w-3" />
                        {selectedLocation}
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="text-display mt-4 text-[2.1rem] font-semibold leading-[0.96] tracking-[-0.04em] text-foreground">
                    {selectedTitle}
                  </h2>
                  {selectedStory ? <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{selectedStory}</p> : null}
                </div>

                <div className="text-left sm:text-right">
                  <p className="mono-metric text-[10px] text-muted-foreground">{t.selectedPrint}</p>
                  <p className="text-display mt-2 text-5xl font-semibold tracking-[-0.05em] text-foreground">{totalPrice} $</p>
                </div>
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <p className="mono-metric mb-3 text-[10px] text-muted-foreground">{t.product}</p>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCT_TYPES.map(product => {
                      const active = selectedProduct.id === product.id;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => setSelectedProduct(product)}
                          className={
                            active
                              ? 'inline-flex h-10 items-center justify-center rounded-full bg-brand-charcoal px-4 text-sm font-medium text-white'
                              : 'inline-flex h-10 items-center justify-center rounded-full border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted'
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
                    {PRINT_SIZES.map(size => {
                      const active = selectedSize.id === size.id;
                      return (
                        <button
                          key={size.id}
                          type="button"
                          onClick={() => setSelectedSize(size)}
                          className={
                            active
                              ? 'inline-flex h-10 items-center justify-center rounded-full bg-brand-charcoal px-4 text-sm font-medium text-white'
                              : 'inline-flex h-10 items-center justify-center rounded-full border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted'
                          }
                        >
                          {size.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="sm:flex-1">
                  <Link href={selectedOrderHref}>
                    {t.heroPrimaryCta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="sm:flex-1">
                  <Link href={appendLangParam('/search', lang)}>{t.heroSecondaryCta}</Link>
                </Button>
              </div>

              <p className="mt-4 text-xs leading-6 text-muted-foreground">{t.fulfillment}</p>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="max-w-3xl">
            <p className="mono-metric text-[10px] text-primary">{t.picksEyebrow}</p>
            <h2 className="text-display mt-3 text-[2.25rem] font-semibold leading-[0.98] tracking-[-0.04em] text-foreground sm:text-[3rem]">
              {t.picksTitle}
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">{t.picksBody}</p>
          </div>

          {hasError && !spotlightPhotos.length ? (
            <div className="surface-card mt-6 px-5 py-6">
              <p className="text-base font-medium text-foreground">{t.noPhotos}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t.noPhotosBody}</p>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {isLoading
              ? Array.from({ length: 4 }, (_, index) => (
                  <div key={`skeleton-${index}`} className="surface-card overflow-hidden p-0">
                    <div className="aspect-[4/3] animate-pulse bg-muted" />
                    <div className="space-y-3 px-4 py-4">
                      <div className="h-5 w-32 animate-pulse rounded-full bg-muted" />
                      <div className="h-4 w-full animate-pulse rounded-full bg-muted" />
                      <div className="h-4 w-4/5 animate-pulse rounded-full bg-muted" />
                    </div>
                  </div>
                ))
              : spotlightPhotos.map(photo => (
                  <PhotoPrintCard
                    key={photo.metadataFilename}
                    active={photo.metadataFilename === selectedPhoto?.metadataFilename}
                    lang={lang}
                    photo={photo}
                    previewLabel={t.previewButton}
                    customizeLabel={t.customize}
                    onPreview={() => setSelectedPhotoId(photo.metadataFilename)}
                    orderHref={orderHref(photo)}
                  />
                ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-display text-[2rem] font-semibold leading-[0.98] tracking-[-0.04em] text-foreground sm:text-[2.7rem]">
                {t.moreTitle}
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">{t.moreBody}</p>
            </div>
            <Button asChild variant="outline">
              <Link href={appendLangParam('/search', lang)}>{t.finalCta}</Link>
            </Button>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {browsePhotos.map(photo => (
              <PhotoPrintCard
                key={photo.metadataFilename}
                lang={lang}
                photo={photo}
                previewLabel={t.previewButton}
                customizeLabel={t.customize}
                onPreview={() => setSelectedPhotoId(photo.metadataFilename)}
                orderHref={orderHref(photo)}
              />
            ))}
          </div>
        </section>

        <section className="surface-dark mt-10 overflow-hidden p-6 sm:p-8 lg:p-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-end">
            <div>
              <Badge variant="secondary" className="bg-white/12 text-white">
                <Sparkles className="h-3 w-3" />
                {t.heroSearchLabel}
              </Badge>
              <h2 className="text-display mt-5 max-w-2xl text-[2.3rem] font-semibold leading-[0.96] tracking-[-0.04em] text-white sm:text-[3.3rem]">
                {t.finalTitle}
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">{t.finalBody}</p>
            </div>

            <div className="space-y-3">
              <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3">
                <div className="input-shell flex h-14 items-center gap-3 px-4 sm:h-12">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t.heroSearchPlaceholder}
                    className="h-full flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/75 sm:text-sm"
                  />
                </div>
                <Button type="submit" size="lg" variant="brand" className="h-14 text-base sm:h-12 sm:text-sm">
                  {t.heroSearchSubmit}
                </Button>
              </form>
            </div>
          </div>
        </section>
      </main>

      {selectedPhoto && showStickyCta ? (
        <div className="fixed inset-x-4 bottom-4 z-40 lg:hidden">
          <div className="surface-dark flex items-center justify-between gap-4 px-4 py-4">
            <div className="min-w-0">
              <p className="mono-metric text-[10px] text-white/55">{t.stickyLabel}</p>
              <p className="mt-1 line-clamp-1 text-sm font-medium text-white">{selectedTitle}</p>
            </div>
            <Button asChild size="sm">
              <Link href={selectedOrderHref}>{t.customize}</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
