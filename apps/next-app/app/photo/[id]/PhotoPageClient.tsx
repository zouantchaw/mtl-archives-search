'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Share, ShoppingBag, X } from 'lucide-react';
import Image from 'next/image';
import type { PhotoRecord } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { WallPreview, PRINT_SIZES, PRODUCT_TYPES, type PrintSize, type ProductType } from '@/components/WallPreview';

const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
};

// Generate thumbnail URL via Cloudflare Image Resizing
const getThumbnailUrl = (imageUrl: string, width = 1200) => {
  if (!imageUrl) return '';
  return `/api/thumb?src=${encodeURIComponent(imageUrl)}&w=${width}&q=85&format=auto`;
};

type Lang = 'fr' | 'en';

const translations = {
  fr: {
    back: 'Retour',
    share: 'Partager',
    copied: 'Copié',
    orderPrint: 'Commander une impression',
    backToPhoto: 'Retour à la photo',
    size: 'Format',
    product: 'Produit',
    addToCart: 'Ajouter au panier',
    added: 'Ajouté',
    notFound: 'Photo non trouvée',
    untitled: 'Sans titre',
    credits: 'Archives de la Ville de Montréal',
  },
  en: {
    back: 'Back',
    share: 'Share',
    copied: 'Copied',
    orderPrint: 'Order a Print',
    backToPhoto: 'Back to photo',
    size: 'Size',
    product: 'Product',
    addToCart: 'Add to Cart',
    added: 'Added',
    notFound: 'Photo not found',
    untitled: 'Untitled',
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

  // Mode: 'viewing' or 'ordering'
  const [mode, setMode] = useState<'viewing' | 'ordering'>('viewing');

  // Print options
  const [selectedSize, setSelectedSize] = useState<PrintSize>(PRINT_SIZES[1]);
  const [selectedProduct, setSelectedProduct] = useState<ProductType>(PRODUCT_TYPES[0]);
  const [justAdded, setJustAdded] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const lang = (searchParams.get('lang') as Lang) || 'fr';
  const t = translations[lang];

  const totalPrice = selectedSize.price + selectedProduct.price;

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
    if (lang !== 'fr') backParams.set('lang', lang);
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

    events.addToCartClicked(photo.metadataFilename, selectedSize.name, selectedProduct.name[lang], totalPrice);

    setJustAdded(true);
    setTimeout(() => {
      setJustAdded(false);
      setMode('viewing');
    }, 1200);
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

      {/* Main Content - Animated transition between modes */}
      <main className="pt-12">
        {/* VIEWING MODE */}
        <div className={`transition-all duration-500 ease-out ${
          mode === 'viewing'
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-4 pointer-events-none absolute inset-0 pt-12'
        }`}>
          {/* Hero Image */}
          <div className="relative bg-neutral-100">
            <div className="max-w-5xl mx-auto">
              {photo.imageUrl && (
                <div className={`relative transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}>
                  <Image
                    src={getThumbnailUrl(photo.imageUrl, 1000)}
                    alt={title}
                    width={1000}
                    height={750}
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 1000px"
                    className="w-full h-auto"
                    priority
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

        {/* ORDERING MODE */}
        <div className={`transition-all duration-500 ease-out ${
          mode === 'ordering'
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-4 pointer-events-none absolute inset-0 pt-12'
        }`}>
          {/* Wall Preview Carousel */}
          {photo.imageUrl && (
            <WallPreview
              photoUrl={getThumbnailUrl(photo.imageUrl, 800)}
              photoAlt={title}
              selectedSize={selectedSize}
              selectedProduct={selectedProduct}
              lang={lang}
            />
          )}

          {/* Purchase Options */}
          <div className="max-w-lg mx-auto px-4 py-6">
            {/* Title (compact) */}
            <h2 className="text-base font-medium text-neutral-900 mb-6 text-center">
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
                    onClick={() => setSelectedProduct(product)}
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
                    onClick={() => setSelectedSize(size)}
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
          </div>
        </div>
      </main>
    </div>
  );
}
