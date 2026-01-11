'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, Copy, Check, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import type { PhotoRecord } from '@/lib/types';

// API calls go through Vercel rewrite
const API_BASE = '';
// Images load directly from Cloudflare (bypasses Vercel proxy)
const THUMB_BASE = 'https://mtl-archives-worker.wiel.workers.dev';

// ============================================================
// i18n
// ============================================================
type Lang = 'fr' | 'en';

const translations = {
  fr: {
    back: 'Retour',
    copy: 'Copier',
    copied: 'Copie',
    download: 'Telecharger',
    orderPrint: 'Commander une impression',
    size: 'Format',
    frame: 'Cadre',
    noFrame: 'Sans cadre',
    addToCart: 'Ajouter au panier',
    freeShipping: 'Livraison gratuite des 150$ - Expedition 5-7 jours',
    viewArchives: 'Voir dans les Archives',
    credits: 'Credits',
    reference: 'Reference',
    portalTitle: 'Titre (Portail)',
    portalDescription: 'Description (Portail)',
    portalDate: 'Date (Portail)',
    notFound: 'Photo non trouvee',
    loading: 'Chargement...',
  },
  en: {
    back: 'Back',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    orderPrint: 'Order Print',
    size: 'Size',
    frame: 'Frame',
    noFrame: 'No Frame',
    addToCart: 'Add to Cart',
    freeShipping: 'Free shipping over $150 - Ships in 5-7 days',
    viewArchives: 'View in City Archives',
    credits: 'Credits',
    reference: 'Reference',
    portalTitle: 'Title (Portal)',
    portalDescription: 'Description (Portal)',
    portalDate: 'Date (Portal)',
    notFound: 'Photo not found',
    loading: 'Loading...',
  },
} as const;

const PRINT_OPTIONS = [
  { id: 'small', name: '8x10"', price: 45 },
  { id: 'medium', name: '12x16"', price: 75 },
  { id: 'large', name: '18x24"', price: 120 },
  { id: 'xlarge', name: '24x36"', price: 180 },
];

const FRAME_OPTIONS_FR = [
  { id: 'none', name: 'Sans cadre', price: 0 },
  { id: 'black', name: 'Noir', price: 45 },
  { id: 'white', name: 'Blanc', price: 45 },
  { id: 'natural', name: 'Bois naturel', price: 60 },
];

const FRAME_OPTIONS_EN = [
  { id: 'none', name: 'No Frame', price: 0 },
  { id: 'black', name: 'Black', price: 45 },
  { id: 'white', name: 'White', price: 45 },
  { id: 'natural', name: 'Natural Wood', price: 60 },
];

// Detect low-memory device
const getIsLowMemoryDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isSmallScreen = window.innerWidth < 768;
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
  const isLowMemory = deviceMemory !== undefined && deviceMemory < 4;
  return isMobile || isSmallScreen || isLowMemory;
};

export default function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [photo, setPhoto] = useState<PhotoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isLowMemory, setIsLowMemory] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);

  // Get lang from URL or default to 'fr'
  const lang = (searchParams.get('lang') as Lang) || 'fr';
  const t = translations[lang];

  // Unwrap params (Next.js 15 async params)
  useEffect(() => {
    params.then(p => setPhotoId(p.id));
  }, [params]);

  useEffect(() => {
    setIsLowMemory(getIsLowMemoryDevice());
  }, []);

  // Fetch photo by ID
  useEffect(() => {
    if (!photoId) return;

    const fetchPhoto = async () => {
      try {
        const decodedId = decodeURIComponent(photoId);
        const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(decodedId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
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

  const [selectedSize, setSelectedSize] = useState(PRINT_OPTIONS[1].id);
  const [selectedFrame, setSelectedFrame] = useState('none');
  const [copied, setCopied] = useState(false);

  const frameOptions = lang === 'fr' ? FRAME_OPTIONS_FR : FRAME_OPTIONS_EN;
  const selectedPrint = PRINT_OPTIONS.find(p => p.id === selectedSize)!;
  const selectedFrameOption = frameOptions.find(f => f.id === selectedFrame)!;
  const totalPrice = selectedPrint.price + selectedFrameOption.price;

  const detailImageSize = isLowMemory ? 600 : 1000;

  const getThumbnailUrl = useCallback((src: string, w = 400, h = 400) => {
    if (!src) return '';
    const urlParams = new URLSearchParams({
      src,
      w: String(w),
      h: String(h),
      fit: 'cover',
      format: 'webp',
      q: '75'
    });
    // Bypass Vercel - load direct from Cloudflare
    return `${THUMB_BASE}/api/thumb?${urlParams}`;
  }, []);

  const buildCaption = () => {
    if (!photo) return '';
    const lines = [];
    const title = photo.name || photo.portalTitle || 'Sans titre';
    const date = photo.dateValue || photo.portalDate;
    lines.push(date ? `${title}, ${date}` : title);
    lines.push('');
    const desc = photo.description && photo.description !== 'S/O'
      ? photo.description
      : photo.portalDescription;
    if (desc) lines.push(desc);
    lines.push('');
    if (photo.credits) lines.push(`Photo: ${photo.credits}`);
    if (photo.cote) lines.push(`Ref: ${photo.cote}`);
    lines.push('');
    lines.push('#Montreal #MontrealHistory #MTLArchives #VieuxMontreal #HistoireduQuebec');
    return lines.join('\n');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildCaption());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    if (!photo?.imageUrl) return;
    try {
      const res = await fetch(photo.imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = photo.resolvedImageFilename || `mtl-archives-${photo.metadataFilename}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(photo.imageUrl, '_blank');
    }
  };

  const handleBack = () => {
    // Preserve search params when going back
    const q = searchParams.get('q');
    const mode = searchParams.get('mode');
    const backParams = new URLSearchParams();
    if (q) backParams.set('q', q);
    if (mode) backParams.set('mode', mode);
    if (lang !== 'fr') backParams.set('lang', lang);

    const backUrl = backParams.toString() ? `/?${backParams}` : '/';
    router.push(backUrl);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="h-6 w-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !photo) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{t.notFound}</p>
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-400 hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.back}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm">
        <div className="flex items-center h-12 px-4 md:px-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-400 hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.back}
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          {/* Image */}
          <div className="relative aspect-square bg-neutral-100">
            {photo.imageUrl && (
              <Image
                src={getThumbnailUrl(photo.imageUrl, detailImageSize, detailImageSize)}
                alt={photo.name || ''}
                fill
                sizes={isLowMemory ? '(max-width: 768px) 100vw, 400px' : '(max-width: 768px) 100vw, 600px'}
                className="object-contain"
                unoptimized
                priority
              />
            )}
          </div>

          {/* Details */}
          <div>
            <h1 className="text-xl md:text-2xl font-light mb-1">
              {photo.name || 'Sans titre'}
            </h1>
            {photo.dateValue && (
              <p className="text-neutral-500 text-sm mb-4">{photo.dateValue}</p>
            )}

            {photo.description && photo.description !== 'S/O' && (
              <p className="text-neutral-600 text-sm mb-6 leading-relaxed">
                {photo.description}
              </p>
            )}

            {/* Meta */}
            <div className="space-y-1 mb-6 text-xs text-neutral-400">
              {photo.credits && <p>{t.credits}: {photo.credits}</p>}
              {photo.cote && <p>{t.reference}: {photo.cote}</p>}
              {photo.portalTitle && photo.portalTitle !== photo.name && (
                <p>{t.portalTitle}: {photo.portalTitle}</p>
              )}
              {photo.portalDescription && photo.portalDescription !== photo.description && (
                <p>{t.portalDescription}: {photo.portalDescription}</p>
              )}
              {photo.portalDate && photo.portalDate !== photo.dateValue && (
                <p>{t.portalDate}: {photo.portalDate}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mb-8">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-xs uppercase tracking-wide transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t.copied : t.copy}
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-xs uppercase tracking-wide transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t.download}
              </button>
            </div>

            {/* Print Options */}
            <div className="border-t border-neutral-200 pt-6">
              <h2 className="text-sm font-medium uppercase tracking-wide mb-4">{t.orderPrint}</h2>

              {/* Size */}
              <div className="mb-4">
                <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">{t.size}</p>
                <div className="grid grid-cols-4 gap-1">
                  {PRINT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedSize(opt.id)}
                      className={`py-2 text-xs transition-colors ${
                        selectedSize === opt.id
                          ? 'bg-neutral-900 text-white'
                          : 'bg-white border border-neutral-200 hover:border-neutral-400'
                      }`}
                    >
                      <div>{opt.name}</div>
                      <div className="opacity-60">${opt.price}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Frame */}
              <div className="mb-6">
                <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">{t.frame}</p>
                <div className="grid grid-cols-4 gap-1">
                  {frameOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedFrame(opt.id)}
                      className={`py-2 text-xs transition-colors ${
                        selectedFrame === opt.id
                          ? 'bg-neutral-900 text-white'
                          : 'bg-white border border-neutral-200 hover:border-neutral-400'
                      }`}
                    >
                      <div>{opt.name}</div>
                      <div className="opacity-60">{opt.price === 0 ? '-' : `+$${opt.price}`}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add to Cart */}
              <button className="w-full py-3 bg-neutral-900 text-white text-xs font-medium uppercase tracking-wide hover:bg-neutral-800 transition-colors">
                {t.addToCart} - ${totalPrice}
              </button>

              <p className="text-[10px] text-neutral-400 text-center mt-3 uppercase tracking-wide">
                {t.freeShipping}
              </p>

              {photo.externalUrl && (
                <a
                  href={photo.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 mt-4 text-xs text-neutral-400 hover:text-neutral-900 uppercase tracking-wide"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t.viewArchives}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
