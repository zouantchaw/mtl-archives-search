'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { ROOM_BACKGROUNDS, PRINT_SIZES, PRODUCT_TYPES, type PrintSize, type ProductType, type RoomBackground } from '@/lib/room-backgrounds';
import type { Lang } from '@/lib/i18n';

type WallPreviewProps = {
  photoUrl: string;
  photoAlt: string;
  selectedSize: PrintSize;
  selectedProduct: ProductType;
  lang: Lang;
  onSlideChange?: (index: number, isRoom: boolean, roomId?: string) => void;
};

// Slide types: first is original photo, rest are room backgrounds
type SlideType =
  | { type: 'original' }
  | { type: 'room'; room: RoomBackground };

export const WallPreview = ({
  photoUrl,
  photoAlt,
  selectedSize,
  selectedProduct,
  lang,
  onSlideChange,
}: WallPreviewProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollThrottleRef = useRef<number | null>(null);

  // Build slides array: original photo first, then room backgrounds
  const slides: SlideType[] = useMemo(() => [
    { type: 'original' as const },
    ...ROOM_BACKGROUNDS.map(room => ({ type: 'room' as const, room })),
  ], []);

  // Handle scroll snap detection (throttled to prevent excessive state updates)
  const handleScroll = useCallback(() => {
    if (scrollThrottleRef.current) return;

    scrollThrottleRef.current = requestAnimationFrame(() => {
      scrollThrottleRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;

      const scrollLeft = container.scrollLeft;
      const itemWidth = container.clientWidth;
      const newIndex = Math.round(scrollLeft / itemWidth);

      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < slides.length) {
        setCurrentIndex(newIndex);
        const slide = slides[newIndex];
        if (slide.type === 'original') {
          onSlideChange?.(newIndex, false);
        } else {
          onSlideChange?.(newIndex, true, slide.room.id);
        }
      }
    });
  }, [currentIndex, slides, onSlideChange]);

  // Scroll to specific index
  const scrollToIndex = useCallback((index: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const itemWidth = container.clientWidth;
    container.scrollTo({
      left: index * itemWidth,
      behavior: 'smooth',
    });
  }, []);

  // Handle dot click
  const handleDotClick = (index: number) => {
    scrollToIndex(index);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && currentIndex > 0) {
      scrollToIndex(currentIndex - 1);
    } else if (e.key === 'ArrowRight' && currentIndex < slides.length - 1) {
      scrollToIndex(currentIndex + 1);
    }
  };

  const currentSlide = slides[currentIndex];
  const slideLabel = currentSlide.type === 'original' 
    ? (lang === 'fr' ? 'Photo originale' : 'Original Photo')
    : currentSlide.room.name[lang];

  return (
    <div className="relative bg-muted" role="region" aria-label={lang === 'fr' ? 'Aperçu du produit' : 'Product preview'}>
      {/* Carousel Container */}
      <div
        ref={scrollContainerRef}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {slides.map((slide, index) => {
          // Only render slides within 1 position of current (lazy loading)
          const isNearby = Math.abs(index - currentIndex) <= 1;
          if (!isNearby) {
            return <div key={slide.type === 'original' ? 'original' : slide.room.id} className="flex-shrink-0 w-full snap-center aspect-[4/3]" />;
          }
          return slide.type === 'original' ? (
            <OriginalPhotoSlide
              key="original"
              photoUrl={photoUrl}
              photoAlt={photoAlt}
              selectedProduct={selectedProduct}
              imageError={imageError}
              onImageError={() => setImageError(true)}
              isActive={index === currentIndex}
              lang={lang}
            />
          ) : (
            <RoomSlide
              key={slide.room.id}
              room={slide.room}
              photoUrl={photoUrl}
              photoAlt={photoAlt}
              selectedSize={selectedSize}
              selectedProduct={selectedProduct}
              imageError={imageError}
              onImageError={() => setImageError(true)}
              isActive={index === currentIndex}
            />
          );
        })}
      </div>

      {/* Dot Indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-black/30 backdrop-blur-sm rounded-full">
        {slides.map((slide, index) => (
          <button
            key={slide.type === 'original' ? 'original' : slide.room.id}
            onClick={() => handleDotClick(index)}
            className={`transition-all duration-300 ${
              index === currentIndex
                ? 'w-6 h-2 bg-card rounded-full'
                : 'w-2 h-2 bg-card/50 rounded-full hover:bg-card/80'
            }`}
            aria-label={slide.type === 'original' 
              ? (lang === 'fr' ? 'Voir photo originale' : 'View original photo')
              : `${lang === 'fr' ? 'Voir dans' : 'View in'} ${slide.room.name[lang]}`}
            aria-current={index === currentIndex ? 'true' : 'false'}
          />
        ))}
      </div>

      {/* Slide Label Badge */}
      <div className="absolute top-4 left-4">
        <span className="px-2.5 py-1 bg-black/40 backdrop-blur-sm text-white text-[10px] uppercase tracking-wider rounded-full">
          {slideLabel}
        </span>
      </div>
    </div>
  );
};

// Original photo slide - clean presentation with product type styling
type OriginalPhotoSlideProps = {
  photoUrl: string;
  photoAlt: string;
  selectedProduct: ProductType;
  imageError: boolean;
  onImageError: () => void;
  isActive: boolean;
  lang: Lang;
};

const OriginalPhotoSlide = ({
  photoUrl,
  photoAlt,
  selectedProduct,
  imageError,
  onImageError,
  isActive,
  lang,
}: OriginalPhotoSlideProps) => {
  return (
    <div
      className="relative flex-shrink-0 w-full snap-center aspect-[4/3] flex items-center justify-center bg-muted"
      aria-hidden={!isActive}
    >
      {/* Product Preview - centered with styling based on product type */}
      <div className="relative w-[65%] max-w-md">
        <ProductFrame product={selectedProduct}>
          <div className="relative w-full aspect-[4/3] bg-muted overflow-hidden">
            {photoUrl && !imageError ? (
              <Image
                src={photoUrl}
                alt={photoAlt}
                fill
                sizes="(max-width: 768px) 70vw, 50vw"
                className="object-cover"
                priority
                unoptimized
                onError={onImageError}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <span className="text-muted-foreground/70 text-xs">
                  {lang === 'fr' ? 'Image non disponible' : 'Image unavailable'}
                </span>
              </div>
            )}
          </div>
        </ProductFrame>
      </div>
    </div>
  );
};

// Room slide with photo composited on wall
type RoomSlideProps = {
  room: RoomBackground;
  photoUrl: string;
  photoAlt: string;
  selectedSize: PrintSize;
  selectedProduct: ProductType;
  imageError: boolean;
  onImageError: () => void;
  isActive: boolean;
};

const RoomSlide = ({
  room,
  photoUrl,
  photoAlt,
  selectedSize,
  selectedProduct,
  imageError,
  onImageError,
  isActive,
}: RoomSlideProps) => {
  // Calculate photo dimensions based on size and wall constraints
  const photoWidth = room.wall.maxWidth * selectedSize.scale;

  return (
    <div
      className="relative flex-shrink-0 w-full snap-center aspect-[4/3]"
      aria-hidden={!isActive}
    >
      {/* Room Background */}
      <Image
        src={room.src}
        alt={room.name.en}
        fill
        sizes="100vw"
        className="object-cover"
        priority={room.id === 'plateau'}
      />

      {/* Photo on Wall - Positioned absolutely based on room config */}
      <div
        className="absolute transform -translate-x-1/2 -translate-y-1/2"
        style={{
          left: `${room.wall.centerX}%`,
          top: `${room.wall.centerY}%`,
          width: `${photoWidth}%`,
        }}
      >
        <ProductFrame product={selectedProduct} inRoom>
          <div className="relative w-full aspect-[4/3] overflow-hidden bg-muted">
            {photoUrl && !imageError ? (
              <Image
                src={photoUrl}
                alt={photoAlt}
                fill
                sizes="(max-width: 768px) 50vw, 30vw"
                className="object-cover"
                unoptimized
                onError={onImageError}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <span className="text-muted-foreground/70 text-[10px]">Photo</span>
              </div>
            )}
          </div>
        </ProductFrame>
      </div>
    </div>
  );
};

// Product frame wrapper - renders different styles based on product type
type ProductFrameProps = {
  product: ProductType;
  children: React.ReactNode;
  inRoom?: boolean;
};

const ProductFrame = ({ product, children, inRoom = false }: ProductFrameProps) => {
  const { style } = product;
  const scale = inRoom ? 0.7 : 1;

  switch (style.type) {
    case 'poster':
      // Fine art poster - clean with subtle shadow
      return (
        <div
          className="relative transition-all duration-300"
          style={{
            boxShadow: `
              0 1px 2px rgba(0,0,0,0.04),
              0 4px 8px rgba(0,0,0,0.04),
              0 ${12 * scale}px ${24 * scale}px rgba(0,0,0,0.08)
            `,
          }}
        >
          {children}
        </div>
      );

    case 'framed':
      // Floater frame - canvas recessed inside black frame
      const frameWidth = inRoom ? 4 : 6;
      const gapWidth = inRoom ? 2 : 3;
      const totalInset = frameWidth + gapWidth;
      
      return (
        <div 
          className="relative transition-all duration-300"
          style={{
            padding: totalInset,
            backgroundColor: '#0a0a0a',
            boxShadow: `
              0 2px 4px rgba(0,0,0,0.08),
              0 ${8 * scale}px ${16 * scale}px rgba(0,0,0,0.12),
              0 ${20 * scale}px ${40 * scale}px rgba(0,0,0,0.16)
            `,
          }}
        >
          {/* Frame border */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              border: `${frameWidth}px solid #1a1a1a`,
            }}
          />
          
          {/* Canvas with recessed shadow */}
          <div
            className="relative"
            style={{
              boxShadow: `
                inset 0 1px 3px rgba(0,0,0,0.3),
                inset 0 0 1px rgba(0,0,0,0.2)
              `,
            }}
          >
            {children}
          </div>
        </div>
      );

    case 'hanger':
      // Magnetic poster hanger using actual wood rail image
      const railHeight = inRoom ? 8 : 12;
      const railOverhang = inRoom ? 3 : 5;
      const cordHeight = inRoom ? 12 : 18;
      
      return (
        <div 
          className="relative transition-all duration-300" 
          style={{ 
            paddingTop: cordHeight + railHeight,
            paddingBottom: railHeight, // Space for bottom rail
          }}
        >
          {/* Hanging string - simple black cord */}
          <svg 
            className="absolute left-1/2 -translate-x-1/2"
            style={{ top: 0, width: 50 * scale, height: cordHeight + 2 }}
            viewBox="0 0 50 20"
            fill="none"
          >
            <path 
              d="M10 18 L25 4 L40 18" 
              stroke="#2a2a2a"
              strokeWidth="1"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          
          {/* Top hanger rail - actual wood image */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-10"
            style={{
              top: cordHeight,
              width: `calc(100% + ${railOverhang * 2}px)`,
              height: railHeight,
            }}
          >
            <img
              src="/images/items/wooden-hanger-rail.png"
              alt=""
              className="w-full h-full object-fill"
              style={{
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))',
              }}
            />
          </div>
          
          {/* Poster */}
          <div
            style={{
              boxShadow: `
                0 2px 4px rgba(0,0,0,0.03),
                0 ${4 * scale}px ${8 * scale}px rgba(0,0,0,0.05),
                0 ${8 * scale}px ${16 * scale}px rgba(0,0,0,0.06)
              `,
            }}
          >
            {children}
          </div>
          
          {/* Bottom hanger rail - actual wood image, positioned at bottom edge of poster */}
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: 0,
              width: `calc(100% + ${railOverhang * 2}px)`,
              height: railHeight,
            }}
          >
            <img
              src="/images/items/wooden-hanger-rail.png"
              alt=""
              className="w-full h-full object-fill"
              style={{
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.12))',
              }}
            />
          </div>
        </div>
      );

    default:
      return <div className="relative">{children}</div>;
  }
};

export { ROOM_BACKGROUNDS, PRINT_SIZES, PRODUCT_TYPES };
export type { PrintSize, ProductType, RoomBackground };
