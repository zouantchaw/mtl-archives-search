'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Share, ShoppingBag, X } from 'lucide-react';
import Image from 'next/image';
import type { PhotoRecord } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { WallPreview, PRINT_SIZES, PRODUCT_TYPES, type PrintSize, type ProductType } from '@/components/WallPreview';
import { DEFAULT_LANG, getLangFromSearchParams, type Lang } from '@/lib/i18n';

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
    orderPrint: 'Commander une impression · à partir de 45 $',
    backToPhoto: 'Retour à la photo',
    size: 'Format',
    product: 'Produit',
    addToCart: 'Ajouter au panier',
    added: 'Ajouté',
    notFound: 'Photo non trouvée',
    untitled: 'Sans titre',
    fulfillment: 'Imprimé à Montréal · Livraison en 5–7 jours ouvrables',
    noPaymentNow: 'Pas de paiement maintenant · taxes + livraison confirmées par courriel',
    pricing: 'Prix',
    sizeLine: 'Format',
    productLine: 'Produit',
    subtotalLine: 'Sous-total',
    credits: 'Archives de la Ville de Montréal',
  },
  en: {
    back: 'Back',
    share: 'Share',
    copied: 'Copied',
    orderPrint: 'Order a Print · from $45',
    backToPhoto: 'Back to photo',
    size: 'Size',
    product: 'Product',
    addToCart: 'Add to Cart',
    added: 'Added',
    notFound: 'Photo not found',
    untitled: 'Untitled',
    fulfillment: 'Printed in Montreal · Ships in 5–7 business days',
    noPaymentNow: 'No payment now · taxes + shipping confirmed by email',
    pricing: 'Pricing',
    sizeLine: 'Size',
    productLine: 'Product',
    subtotalLine: 'Subtotal',
    credits: 'Montreal City Archives',
  },
} as const;

type PhotoPageClientProps = {
  photo: PhotoRecord | null;
  photoId: string;
};

export function PhotoPageClient({ photo, photoId }: PhotoPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem, itemCount, openCart } = useCart();
  const orderParam = searchParams?.get('order');
  const autoOrder = orderParam === '1' || orderParam === 'true' || orderParam === 'print';

  // Mode: 'viewing' or 'ordering'
  const [mode, setMode] = useState<'viewing' | 'ordering'>(() => (autoOrder ? 'ordering' : 'viewing'));

  // Print options
  const [selectedSize, setSelectedSize] = useState<PrintSize>(PRINT_SIZES[1]);
  const [selectedProduct, setSelectedProduct] = useState<ProductType>(PRODUCT_TYPES[0]);
  const [justAdded, setJustAdded] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];

  const totalPrice = selectedSize.price + selectedProduct.price;

  // Photo dwell timer — fires once after 5s on the page
  const dwellFired = useRef(false);
  useEffect(() => {
    if (!photo || dwellFired.current) return;
    const timer = setTimeout(() => {
      if (!dwellFired.current) {
        dwellFired.current = true;
        events.photoDwelled(photo.metadataFilename, 5000, { dateValue: photo.dateValue });
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [photo]);

  const autoOrderTrackedRef = useRef(false);
  useEffect(() => {
    if (!photo || !autoOrder || autoOrderTrackedRef.current) return;
    if (mode !== 'ordering') return;
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
    const q = searchParams.get('q');
    const searchMode = searchParams.get('mode');
    const backParams = new URLSearchParams();
    if (q) backParams.set('q', q);
    if (searchMode) backParams.set('mode', searchMode);
    if (lang !== DEFAULT_LANG) backParams.set('lang', lang);
    router.push(backParams.toString() ? `/?${backParams}` : '/');
  };

  const handleShare = async () => {
    if (!photo) return;
    const url = window.location.href;
    const title = cleanText(photo.name) || 'MTL Archives';

    events.photoShared(photo.metadataFilename, photo.name);

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(url);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    }
  };

  const handleAddToCart = () => {
    if (!photo) return;

    addItem({
      photoId: photo.metadataFilename,
      photoName: cleanText(photo.name) || t.untitled,
      photoUrl: photo.imageUrl || '',
      size: selectedSize.name,
      sizeId: selectedSize.id,
      frame: selectedProduct.name[lang],
      frameId: selectedProduct.id,
      price: totalPrice,
    });

    events.addToCartClicked(photo.metadataFilename, selectedSize.name, selectedProduct.name[lang], totalPrice, { dateValue: photo.dateValue });

    setJustAdded(true);
    setTimeout(() => {
      setJustAdded(false);
      setMode('viewing');
      openCart();
    }, 800);
  };

  // Error state - photo not found
  if (!photo) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center gap-4">
        <p className="text-neutral-400 text-sm">{t.notFound}</p>
        <button onClick={handleBack} className="text-xs uppercase tracking-wide text-neutral-900 hover:text-neutral-600 transition-colors">
          ← {t.back}
        </button>
      </div>
    );
  }

  const title = cleanText(photo.name) || t.untitled;
  const date = cleanText(photo.dateValue) || cleanText(photo.portalDate);
  const description = photo.description && photo.description !== 'S/O'
    ? cleanText(photo.description)
    : cleanText(photo.portalDescription);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/90 backdrop-blur-sm border-b border-neutral-100">
        <div className="flex items-center justify-between h-12 px-4">
          {/* Back */}
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 transition-colors"
            aria-label={mode === 'ordering' ? t.backToPhoto : t.back}
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="hidden sm:inline text-sm">
              {mode === 'ordering' ? t.backToPhoto : t.back}
            </span>
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            {/* Share - only in viewing mode */}
            {mode === 'viewing' && (
              <button
                onClick={handleShare}
                className="relative p-2 text-neutral-500 hover:text-neutral-900 transition-colors"
                aria-label={t.share}
              >
                <Share className="h-5 w-5" />
                {showCopied && (
                  <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] text-neutral-500 whitespace-nowrap bg-white px-2 py-0.5 rounded shadow-sm border border-neutral-100">
                    {t.copied}
                  </span>
                )}
              </button>
            )}

            {/* Close ordering mode */}
            {mode === 'ordering' && (
              <button
                onClick={() => exitOrderMode(false)}
                className="p-2 text-neutral-500 hover:text-neutral-900 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}

            {/* Cart */}
            <button
              onClick={openCart}
              className="relative p-2 text-neutral-500 hover:text-neutral-900 transition-colors"
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute top-0.5 right-0.5 h-4 w-4 bg-neutral-900 text-white text-[10px] font-medium flex items-center justify-center rounded-full">
                  {itemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content - Conditionally render active mode to release inactive image memory */}
      <main className="pt-12">
        {/* VIEWING MODE */}
        {mode === 'viewing' && (
        <div className="animate-fade-in">
          {/* Hero Image */}
          <div className="relative bg-neutral-100">
            <div className="max-w-5xl mx-auto">
              {photo.imageUrl && (
                <div className={`relative transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}>
                  <Image
                    src={photo.imageUrl}
                    alt={title}
                    width={1000}
                    height={750}
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 1000px"
                    className="w-full h-auto photo-orient-from-exif"
                    priority
                    // Preserve source orientation for legacy archive images carrying EXIF rotation.
                    unoptimized
                    onLoad={() => setImageLoaded(true)}
                    style={{
                      maxHeight: '70vh',
                      objectFit: 'contain',
                    }}
                  />
                </div>
              )}
              {!imageLoaded && (
                <div className="w-full bg-neutral-200 animate-pulse" style={{ aspectRatio: '4/3', maxHeight: '70vh' }} />
              )}
            </div>
          </div>

          {/* Info Section */}
          <div className="max-w-2xl mx-auto px-4 py-8">
            {/* Title & Date */}
            <div className="mb-4">
              <h1 className="text-lg sm:text-xl font-medium text-neutral-900 leading-tight">
                {title}
              </h1>
              {date && (
                <p className="text-sm text-neutral-500 mt-1">{date}</p>
              )}
            </div>

            {/* Description */}
            {description && (
              <p className="text-sm text-neutral-600 leading-relaxed mb-8">
                {description}
              </p>
            )}

            {/* Order Print Button */}
            <button
              onClick={() => {
                setMode('ordering');
                events.orderModeEntered(photo.metadataFilename);
                events.printCtaClicked(photo.metadataFilename);
              }}
              className="w-full py-3.5 text-sm font-medium text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-full transition-all active:scale-[0.99]"
            >
              {t.orderPrint}
            </button>

            {/* Credits */}
            <div className="mt-12 pt-6 border-t border-neutral-100 text-center">
              <p className="text-[11px] text-neutral-400 uppercase tracking-wider">
                {t.credits}
              </p>
            </div>
          </div>
        </div>
        )}

        {/* ORDERING MODE */}
        {mode === 'ordering' && (
        <div className="animate-fade-in lg:flex lg:items-start lg:max-w-6xl lg:mx-auto lg:gap-8 lg:px-6 lg:pt-6">
          {/* Wall Preview Carousel */}
          <div className="lg:flex-1 lg:min-w-0 lg:rounded-xl lg:overflow-hidden">
          {photo.imageUrl && (
            <WallPreview
              photoUrl={photo.imageUrl}
              photoAlt={title}
              selectedSize={selectedSize}
              selectedProduct={selectedProduct}
              lang={lang}
              onSlideChange={(_index, isRoom, roomId) => {
                if (isRoom && roomId) {
                  events.roomBackgroundChanged(roomId);
                }
              }}
            />
          )}
          </div>

          {/* Purchase Options */}
          <div className="max-w-lg mx-auto px-4 py-6 lg:w-[380px] lg:flex-shrink-0 lg:sticky lg:top-20 lg:px-0 lg:py-0 lg:mx-0">
            {/* Title (compact) */}
            <h2 className="text-base font-medium text-neutral-900 mb-6 text-center lg:text-left">
              {title}
            </h2>

            {/* Product Type */}
            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2.5">
                {t.product}
              </p>
              <div className="flex flex-wrap gap-2">
                {PRODUCT_TYPES.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => {
                      setSelectedProduct(product);
                      events.printFrameSelected(product.name[lang], product.price);
                    }}
                    className={`px-4 py-2 text-[11px] font-medium rounded-full transition-all ${
                      selectedProduct.id === product.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {product.shortName[lang]}
                  </button>
                ))}
              </div>
            </div>

            {/* Size */}
            <div className="mb-6">
              <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2.5">
                {t.size}
              </p>
              <div className="flex gap-2">
                {PRINT_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => {
                      setSelectedSize(size);
                      events.printSizeSelected(size.name, size.price);
                    }}
                    className={`flex-1 py-2.5 text-[11px] font-medium rounded-full transition-all ${
                      selectedSize.id === size.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {size.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Add to Cart */}
            <button
              onClick={handleAddToCart}
              disabled={justAdded}
              className={`w-full py-3.5 text-sm font-medium rounded-full transition-all ${
                justAdded
                  ? 'bg-green-600 text-white'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.99]'
              }`}
            >
              {justAdded ? `✓ ${t.added}` : `${t.addToCart} · $${totalPrice}`}
            </button>

            {/* Pricing breakdown */}
            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">
                {t.pricing}
              </p>
              <div className="space-y-1.5 text-xs text-neutral-600">
                <div className="flex items-center justify-between">
                  <span>{t.sizeLine} ({selectedSize.name})</span>
                  <span>${selectedSize.price}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t.productLine} ({selectedProduct.shortName[lang]})</span>
                  <span>${selectedProduct.price}</span>
                </div>
                <div className="h-px bg-neutral-200 my-1" />
                <div className="flex items-center justify-between text-sm font-medium text-neutral-900">
                  <span>{t.subtotalLine}</span>
                  <span>${totalPrice}</span>
                </div>
              </div>
            </div>

            {/* Fulfillment info */}
            <p className="text-[11px] text-neutral-500 text-center lg:text-left mt-3">
              {t.fulfillment}
            </p>
            <p className="text-[11px] text-neutral-500 text-center lg:text-left mt-1">
              {t.noPaymentNow}
            </p>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
