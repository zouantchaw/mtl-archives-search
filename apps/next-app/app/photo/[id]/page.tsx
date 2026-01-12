'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Share, ChevronDown } from 'lucide-react';
import type { PhotoRecord } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';
import { WallPreview, PRINT_SIZES, PRODUCT_TYPES, type PrintSize, type ProductType } from '@/components/WallPreview';

const API_BASE = '';

const cleanText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
};

type Lang = 'fr' | 'en';

const translations = {
  fr: {
    back: 'Retour',
    share: 'Partager',
    size: 'Format',
    product: 'Produit',
    addToCart: 'Ajouter au panier',
    added: 'Ajouté',
    viewInArchives: 'Voir aux Archives',
    description: 'Description',
    notFound: 'Photo non trouvée',
    untitled: 'Sans titre',
    wallArt: 'Art Mural',
    loading: 'Chargement...',
    swipeHint: 'Glissez pour voir dans différents décors',
  },
  en: {
    back: 'Back',
    share: 'Share',
    size: 'Size',
    product: 'Product',
    addToCart: 'Add to Cart',
    added: 'Added',
    viewInArchives: 'View in Archives',
    description: 'Description',
    notFound: 'Photo not found',
    untitled: 'Untitled',
    wallArt: 'Wall Art',
    loading: 'Loading...',
    swipeHint: 'Swipe to see in different settings',
  },
} as const;

export default function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem } = useCart();

  const [photo, setPhoto] = useState<PhotoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);

  // Print options - default to medium size and fine art
  const [selectedSize, setSelectedSize] = useState<PrintSize>(PRINT_SIZES[1]);
  const [selectedProduct, setSelectedProduct] = useState<ProductType>(PRODUCT_TYPES[0]);
  const [showDetails, setShowDetails] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const lang = (searchParams.get('lang') as Lang) || 'fr';
  const t = translations[lang];

  const totalPrice = selectedSize.price + selectedProduct.price;

  // Unwrap params
  useEffect(() => {
    params.then(p => setPhotoId(p.id));
  }, [params]);

  // Fetch photo
  useEffect(() => {
    if (!photoId) return;
    const fetchPhoto = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(decodeURIComponent(photoId))}`);
        if (res.ok) {
          const data = await res.json();
          if (data.items?.[0]) {
            setPhoto(data.items[0]);
          } else {
            setError(true);
          }
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPhoto();
  }, [photoId]);

  const handleBack = () => {
    const q = searchParams.get('q');
    const mode = searchParams.get('mode');
    const backParams = new URLSearchParams();
    if (q) backParams.set('q', q);
    if (mode) backParams.set('mode', mode);
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
        // User cancelled or error
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  const handleSizeChange = (size: PrintSize) => {
    setSelectedSize(size);
    events.printSizeSelected(size.name, size.price);
  };

  const handleProductChange = (product: ProductType) => {
    setSelectedProduct(product);
    events.printFrameSelected(product.name[lang], product.price);
  };

  const handleSlideChange = (index: number, isRoom: boolean, roomId?: string) => {
    if (isRoom && roomId) {
      events.roomBackgroundChanged(roomId);
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
    setTimeout(() => setJustAdded(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="h-5 w-5 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !photo) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center gap-4">
        <p className="text-neutral-400 text-sm">{t.notFound}</p>
        <button onClick={handleBack} className="text-xs uppercase tracking-wide text-neutral-900">
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
      {/* Minimal Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/90 backdrop-blur-sm">
        <div className="flex items-center justify-between h-12 px-4">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500 hover:text-neutral-900 transition-colors"
            aria-label={t.back}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t.back}</span>
          </button>
          
          <span className="text-[10px] uppercase tracking-wider text-neutral-400">
            {t.wallArt}
          </span>
          
          <button
            onClick={handleShare}
            className="p-2 text-neutral-400 hover:text-neutral-900 transition-colors"
            aria-label={t.share}
          >
            <Share className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-12">
        {/* Wall Preview Carousel */}
        {photo.imageUrl && (
          <WallPreview
            photoUrl={photo.imageUrl}
            photoAlt={title}
            selectedSize={selectedSize}
            selectedProduct={selectedProduct}
            lang={lang}
            onSlideChange={handleSlideChange}
          />
        )}

        {/* Info + Purchase Section */}
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Title & Date */}
          <div className="mb-5">
            <h1 className="text-base font-medium text-neutral-900 leading-tight">{title}</h1>
            {date && <p className="text-sm text-neutral-400 mt-0.5">{date}</p>}
          </div>

          {/* Expandable Description */}
          {description && (
            <div className="mb-5">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-400 hover:text-neutral-600 transition-colors"
                aria-expanded={showDetails}
              >
                {t.description}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
              </button>
              {showDetails && (
                <p className="text-sm text-neutral-500 mt-3 leading-relaxed">{description}</p>
              )}
            </div>
          )}

          {/* Print Options */}
          <div className="border-t border-neutral-100 pt-5">
            {/* Product Type Selection */}
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2.5">{t.product}</p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {PRODUCT_TYPES.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => handleProductChange(product)}
                    className={`flex-shrink-0 px-4 py-2.5 text-[11px] font-medium rounded-full transition-all whitespace-nowrap ${
                      selectedProduct.id === product.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                    aria-pressed={selectedProduct.id === product.id}
                  >
                    {product.shortName[lang]}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Selection */}
            <div className="mb-6">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2.5">{t.size}</p>
              <div className="flex gap-2">
                {PRINT_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => handleSizeChange(size)}
                    className={`flex-1 py-2.5 text-[11px] font-medium rounded-full transition-all ${
                      selectedSize.id === size.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                    aria-pressed={selectedSize.id === size.id}
                  >
                    {size.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Add to Cart Button */}
            <button
              onClick={handleAddToCart}
              disabled={justAdded}
              className={`w-full py-4 text-sm font-medium uppercase tracking-wide transition-all rounded-full ${
                justAdded
                  ? 'bg-green-600 text-white'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98]'
              }`}
              aria-label={justAdded ? t.added : `${t.addToCart} $${totalPrice}`}
            >
              {justAdded ? `✓ ${t.added}` : `${t.addToCart} · $${totalPrice}`}
            </button>

            {/* Archive Link */}
            {photo.externalUrl && (
              <a
                href={photo.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => events.archiveLinkClicked(photo.metadataFilename, photo.externalUrl!)}
                className="block text-center text-[11px] uppercase tracking-wide text-neutral-400 hover:text-neutral-600 mt-4 transition-colors"
              >
                {t.viewInArchives} →
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
