'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Share, ChevronDown } from 'lucide-react';
import Image from 'next/image';
import type { PhotoRecord } from '@/lib/types';
import { events } from '@/lib/analytics';
import { useCart } from '@/lib/cart-context';

const API_BASE = '';

function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

type Lang = 'fr' | 'en';

const translations = {
  fr: {
    back: 'Retour',
    share: 'Partager',
    orderPrint: 'Commander',
    size: 'Format',
    frame: 'Cadre',
    addToCart: 'Ajouter',
    added: 'Ajouté',
    viewInArchives: 'Voir aux Archives',
    description: 'Description',
    notFound: 'Photo non trouvée',
    untitled: 'Sans titre',
    imageUnavailable: 'Image non disponible',
  },
  en: {
    back: 'Back',
    share: 'Share',
    orderPrint: 'Order Print',
    size: 'Size',
    frame: 'Frame',
    addToCart: 'Add to Cart',
    added: 'Added',
    viewInArchives: 'View in Archives',
    description: 'Description',
    notFound: 'Photo not found',
    untitled: 'Untitled',
    imageUnavailable: 'Image unavailable',
  },
} as const;

const PRINT_SIZES = [
  { id: '8x10', name: '8×10"', price: 45 },
  { id: '12x16', name: '12×16"', price: 75 },
  { id: '18x24', name: '18×24"', price: 120 },
  { id: '24x36', name: '24×36"', price: 180 },
];

const FRAME_OPTIONS = {
  fr: [
    { id: 'none', name: 'Sans cadre', price: 0 },
    { id: 'black', name: 'Noir', price: 45 },
    { id: 'white', name: 'Blanc', price: 45 },
    { id: 'natural', name: 'Naturel', price: 60 },
  ],
  en: [
    { id: 'none', name: 'No frame', price: 0 },
    { id: 'black', name: 'Black', price: 45 },
    { id: 'white', name: 'White', price: 45 },
    { id: 'natural', name: 'Natural', price: 60 },
  ],
};

export default function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem } = useCart();

  const [photo, setPhoto] = useState<PhotoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  // Print options
  const [selectedSize, setSelectedSize] = useState(PRINT_SIZES[1].id);
  const [selectedFrame, setSelectedFrame] = useState('none');
  const [showDetails, setShowDetails] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const lang = (searchParams.get('lang') as Lang) || 'fr';
  const t = translations[lang];
  const frameOptions = FRAME_OPTIONS[lang];

  const selectedPrint = PRINT_SIZES.find(p => p.id === selectedSize)!;
  const selectedFrameOpt = frameOptions.find(f => f.id === selectedFrame)!;
  const totalPrice = selectedPrint.price + selectedFrameOpt.price;

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

  const handleAddToCart = () => {
    if (!photo) return;
    
    addItem({
      photoId: photo.metadataFilename,
      photoName: cleanText(photo.name) || 'Sans titre',
      photoUrl: photo.imageUrl || '',
      size: selectedPrint.name,
      sizeId: selectedPrint.id,
      frame: selectedFrameOpt.name,
      frameId: selectedFrameOpt.id,
      price: totalPrice,
    });
    
    events.addToCartClicked(photo.metadataFilename, selectedPrint.name, selectedFrameOpt.name, totalPrice);
    
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
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t.back}</span>
          </button>
          
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
        {/* Image - Full width on mobile, constrained on desktop */}
        <div className="relative bg-neutral-100 aspect-square sm:aspect-[4/3] md:aspect-[16/10] max-h-[70vh]">
          {photo.imageUrl && !imageError ? (
            <Image
              src={photo.imageUrl}
              alt={title}
              fill
              sizes="100vw"
              className="object-contain"
              priority
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-neutral-300">
              <span className="text-sm">{t.imageUnavailable}</span>
            </div>
          )}
        </div>

        {/* Info + Purchase Section */}
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Title & Date */}
          <div className="mb-6">
            <h1 className="text-lg font-medium text-neutral-900 leading-tight">{title}</h1>
            {date && <p className="text-sm text-neutral-400 mt-1">{date}</p>}
          </div>

          {/* Expandable Description */}
          {description && (
            <div className="mb-6">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                {t.description}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
              </button>
              {showDetails && (
                <p className="text-sm text-neutral-500 mt-3 leading-relaxed">{description}</p>
              )}
            </div>
          )}

          {/* Print Options - Compact */}
          <div className="border-t border-neutral-100 pt-6">
            {/* Size Selection */}
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">{t.size}</p>
              <div className="flex gap-1">
                {PRINT_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => {
                      setSelectedSize(size.id);
                      events.printSizeSelected(size.name, size.price);
                    }}
                    className={`flex-1 py-2.5 text-[11px] font-medium transition-all ${
                      selectedSize === size.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                    }`}
                  >
                    {size.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Selection */}
            <div className="mb-6">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">{t.frame}</p>
              <div className="flex gap-1">
                {frameOptions.map((frame) => (
                  <button
                    key={frame.id}
                    onClick={() => {
                      setSelectedFrame(frame.id);
                      events.printFrameSelected(frame.name, frame.price);
                    }}
                    className={`flex-1 py-2.5 text-[11px] font-medium transition-all ${
                      selectedFrame === frame.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                    }`}
                  >
                    {frame.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Add to Cart Button */}
            <button
              onClick={handleAddToCart}
              disabled={justAdded}
              className={`w-full py-4 text-sm font-medium uppercase tracking-wide transition-all ${
                justAdded
                  ? 'bg-green-600 text-white'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98]'
              }`}
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
