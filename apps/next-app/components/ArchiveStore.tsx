'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Download, Copy, Check, ArrowLeft, ExternalLink } from 'lucide-react';
import type { PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { useClipEmbedding } from '@/lib/use-clip';
import Image from 'next/image';

const API_BASE = '';

// Print options (dummy data for now)
const PRINT_OPTIONS = [
  { id: 'small', name: '8×10"', price: 45 },
  { id: 'medium', name: '12×16"', price: 75 },
  { id: 'large', name: '18×24"', price: 120 },
  { id: 'xlarge', name: '24×36"', price: 180 },
];

const FRAME_OPTIONS = [
  { id: 'none', name: 'No Frame', price: 0 },
  { id: 'black', name: 'Black Frame', price: 45 },
  { id: 'white', name: 'White Frame', price: 45 },
  { id: 'natural', name: 'Natural Wood', price: 60 },
];

export function ArchiveStore() {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic');
  const [searchResults, setSearchResults] = useState<PhotoRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Selected product
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | null>(null);

  // CLIP embedding
  const { generateEmbedding, preloadModel } = useClipEmbedding();

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Featured photos (shown on landing)
  const [featuredPhotos, setFeaturedPhotos] = useState<PhotoRecord[]>([]);

  // Load featured photos on mount
  useEffect(() => {
    async function fetchFeatured() {
      try {
        const res = await fetch(`${API_BASE}/api/photos?limit=12`);
        if (res.ok) {
          const data = await res.json();
          setFeaturedPhotos(data.items || []);
        }
      } catch (err) {
        console.error('Failed to fetch featured photos:', err);
      }
    }
    fetchFeatured();
  }, []);

  // Preload CLIP when visual mode selected
  useEffect(() => {
    if (searchMode === 'visual') {
      preloadModel();
    }
  }, [searchMode, preloadModel]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setHasSearched(true);
      try {
        const params = new URLSearchParams({
          q: searchQuery,
          mode: searchMode,
          limit: '50',
        });

        let res: Response;

        if (searchMode === 'visual') {
          const embedding = await generateEmbedding(searchQuery);
          if (!embedding) {
            setSearchResults([]);
            return;
          }
          res = await fetch(`${API_BASE}/api/search?${params}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embedding }),
          });
        } else {
          res = await fetch(`${API_BASE}/api/search?${params}`);
        }

        if (res.ok) {
          const data: SearchResponse = await res.json();
          setSearchResults(data.items);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchMode, generateEmbedding]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    searchInputRef.current?.focus();
  }, []);

  const getThumbnailUrl = useCallback((src: string, w = 400, h = 400) => {
    if (!src) return '';
    const params = new URLSearchParams({ src, w: String(w), h: String(h), fit: 'cover', format: 'auto', q: '80' });
    return `${API_BASE}/api/thumb?${params}`;
  }, []);

  const displayPhotos = hasSearched ? searchResults : featuredPhotos;

  // If a photo is selected, show product detail
  if (selectedPhoto) {
    return (
      <ProductDetail
        photo={selectedPhoto}
        onBack={() => setSelectedPhoto(null)}
        getThumbnailUrl={getThumbnailUrl}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <a href="/" className="text-lg font-medium tracking-tight">
              MTL ARCHIVES
            </a>

            {/* Nav */}
            <nav className="hidden sm:flex items-center gap-8 text-sm">
              <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="text-neutral-600 hover:text-black transition-colors">
                Instagram
              </a>
              <a href="#about" className="text-neutral-600 hover:text-black transition-colors">
                About
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero / Search Section */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight mb-4">
            Montréal, 1920–1990
          </h1>
          <p className="text-neutral-600 mb-8">
            Search 14,822 historical photographs. Find your street, your building, your history.
          </p>

          {/* Search Bar */}
          <div className="relative">
            <div className="flex items-center border border-neutral-300 rounded-none bg-white focus-within:border-black transition-colors">
              <Search className="ml-4 h-5 w-5 text-neutral-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by street, neighborhood, or describe what you're looking for..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-4 py-4 text-base bg-transparent outline-none placeholder:text-neutral-400"
              />
              {isSearching && (
                <div className="mr-4 h-5 w-5 border-2 border-neutral-300 border-t-black rounded-full animate-spin" />
              )}
              {searchQuery && !isSearching && (
                <button onClick={clearSearch} className="mr-4 p-1 hover:bg-neutral-100 rounded">
                  <X className="h-5 w-5 text-neutral-400" />
                </button>
              )}
            </div>

            {/* Search Mode Toggle */}
            <div className="flex justify-center gap-4 mt-4 text-sm">
              <button
                onClick={() => setSearchMode('semantic')}
                className={`px-4 py-2 transition-colors ${
                  searchMode === 'semantic'
                    ? 'text-black border-b-2 border-black'
                    : 'text-neutral-400 hover:text-black'
                }`}
              >
                Text Search
              </button>
              <button
                onClick={() => setSearchMode('visual')}
                className={`px-4 py-2 transition-colors ${
                  searchMode === 'visual'
                    ? 'text-black border-b-2 border-black'
                    : 'text-neutral-400 hover:text-black'
                }`}
              >
                Visual Search
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Results / Featured Grid */}
      <section className="px-4 sm:px-6 lg:px-8 pb-20">
        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          {hasSearched ? (
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium">
                {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
              </h2>
              <button onClick={clearSearch} className="text-sm text-neutral-600 hover:text-black">
                Clear search
              </button>
            </div>
          ) : (
            <h2 className="text-sm font-medium mb-6">Featured</h2>
          )}

          {/* Empty State */}
          {hasSearched && searchResults.length === 0 && !isSearching && (
            <div className="text-center py-20">
              <p className="text-neutral-600 mb-4">No photos found for "{searchQuery}"</p>
              <button onClick={clearSearch} className="text-sm underline hover:no-underline">
                Clear search
              </button>
            </div>
          )}

          {/* Photo Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 sm:gap-2">
            {displayPhotos.map((photo) => (
              <PhotoCard
                key={photo.metadataFilename}
                photo={photo}
                onClick={() => setSelectedPhoto(photo)}
                getThumbnailUrl={getThumbnailUrl}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-600">
          <p>© {new Date().getFullYear()} MTL Archives. Public domain photographs.</p>
          <div className="flex items-center gap-6">
            <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="hover:text-black">
              Instagram
            </a>
            <a href="#" className="hover:text-black">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Photo Card Component
// ============================================================
function PhotoCard({
  photo,
  onClick,
  getThumbnailUrl,
}: {
  photo: PhotoRecord;
  onClick: () => void;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative aspect-square bg-neutral-100 overflow-hidden text-left"
    >
      {photo.imageUrl ? (
        <Image
          src={getThumbnailUrl(photo.imageUrl, 400, 400)}
          alt={photo.name || 'Historical photograph'}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-neutral-200">
          <span className="text-neutral-400 text-sm">No image</span>
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300" />

      {/* Info on hover */}
      <div className="absolute inset-x-0 bottom-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
        <p className="text-white text-sm font-medium truncate">
          {photo.name || 'Untitled'}
        </p>
        {photo.dateValue && (
          <p className="text-white/70 text-xs mt-0.5">{photo.dateValue}</p>
        )}
      </div>
    </button>
  );
}

// ============================================================
// Product Detail Component
// ============================================================
function ProductDetail({
  photo,
  onBack,
  getThumbnailUrl,
}: {
  photo: PhotoRecord;
  onBack: () => void;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
}) {
  const [selectedSize, setSelectedSize] = useState(PRINT_OPTIONS[1].id);
  const [selectedFrame, setSelectedFrame] = useState(FRAME_OPTIONS[0].id);
  const [copied, setCopied] = useState(false);

  const selectedPrint = PRINT_OPTIONS.find(p => p.id === selectedSize)!;
  const selectedFrameOption = FRAME_OPTIONS.find(f => f.id === selectedFrame)!;
  const totalPrice = selectedPrint.price + selectedFrameOption.price;

  // Build caption for copying
  const buildCaption = () => {
    const parts = [];
    if (photo.name) parts.push(photo.name);
    if (photo.dateValue) parts.push(photo.dateValue);
    if (photo.description) parts.push(photo.description);
    parts.push('');
    parts.push('#Montreal #MontrealHistory #MTLArchives #VintagePhotos');
    if (photo.name?.toLowerCase().includes('plateau')) parts.push('#PlateauMontRoyal');
    if (photo.name?.toLowerCase().includes('downtown') || photo.name?.toLowerCase().includes('centre-ville')) parts.push('#DowntownMontreal');
    return parts.join('\n');
  };

  const handleCopyCaption = async () => {
    const caption = buildCaption();
    await navigator.clipboard.writeText(caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (photo.imageUrl) {
      const link = document.createElement('a');
      link.href = photo.imageUrl;
      link.download = photo.imageFilename || 'mtl-archives-photo.jpg';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <button onClick={onBack} className="flex items-center gap-2 text-sm hover:opacity-70 transition-opacity">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
        </div>
      </header>

      {/* Product Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-16">
          {/* Image */}
          <div className="relative aspect-square bg-neutral-100">
            {photo.imageUrl ? (
              <Image
                src={getThumbnailUrl(photo.imageUrl, 800, 800)}
                alt={photo.name || 'Historical photograph'}
                fill
                className="object-contain"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="text-neutral-400">No image available</span>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col">
            {/* Title & Date */}
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">
                {photo.name || 'Untitled Photograph'}
              </h1>
              {photo.dateValue && (
                <p className="text-neutral-600 mt-2">{photo.dateValue}</p>
              )}
            </div>

            {/* Description */}
            {(photo.description || photo.vlmCaption) && (
              <p className="text-neutral-600 mb-6 leading-relaxed">
                {photo.description || photo.vlmCaption}
              </p>
            )}

            {/* Metadata */}
            <div className="space-y-2 mb-8 text-sm">
              {photo.credits && (
                <p><span className="text-neutral-400">Credits:</span> {photo.credits}</p>
              )}
              {photo.cote && (
                <p><span className="text-neutral-400">Reference:</span> {photo.cote}</p>
              )}
              {photo.portalTitle && (
                <p><span className="text-neutral-400">Archive Title:</span> {photo.portalTitle}</p>
              )}
            </div>

            {/* Actions: Copy & Download */}
            <div className="flex gap-3 mb-8">
              <button
                onClick={handleCopyCaption}
                className="flex-1 flex items-center justify-center gap-2 py-3 border border-neutral-300 hover:border-black transition-colors text-sm"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy Caption'}
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 py-3 border border-neutral-300 hover:border-black transition-colors text-sm"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>

            {/* Divider */}
            <div className="border-t border-neutral-200 pt-8 mb-6">
              <h2 className="text-lg font-medium mb-6">Order Print</h2>
            </div>

            {/* Size Selection */}
            <div className="mb-6">
              <label className="block text-sm text-neutral-600 mb-3">Size</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRINT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setSelectedSize(option.id)}
                    className={`py-3 px-4 border text-sm transition-colors ${
                      selectedSize === option.id
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-300 hover:border-black'
                    }`}
                  >
                    <div className="font-medium">{option.name}</div>
                    <div className="text-xs mt-0.5 opacity-70">${option.price}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Selection */}
            <div className="mb-8">
              <label className="block text-sm text-neutral-600 mb-3">Frame</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {FRAME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setSelectedFrame(option.id)}
                    className={`py-3 px-4 border text-sm transition-colors ${
                      selectedFrame === option.id
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-300 hover:border-black'
                    }`}
                  >
                    <div className="font-medium">{option.name}</div>
                    <div className="text-xs mt-0.5 opacity-70">
                      {option.price === 0 ? '—' : `+$${option.price}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Add to Cart */}
            <button className="w-full py-4 bg-black text-white text-sm font-medium hover:bg-neutral-800 transition-colors">
              Add to Cart — ${totalPrice}
            </button>

            <p className="text-xs text-neutral-400 text-center mt-4">
              Free shipping on orders over $150. Prints ship within 5-7 business days.
            </p>

            {/* External Link */}
            {photo.externalUrl && (
              <a
                href={photo.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 mt-6 text-sm text-neutral-600 hover:text-black transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View in City Archives
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-200 py-8 px-4 sm:px-6 lg:px-8 mt-20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-600">
          <p>© {new Date().getFullYear()} MTL Archives. Public domain photographs.</p>
          <div className="flex items-center gap-6">
            <a href="https://instagram.com/mtlarchives" target="_blank" rel="noopener noreferrer" className="hover:text-black">
              Instagram
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
