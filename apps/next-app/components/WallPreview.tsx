'use client';

import { useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import { ROOM_BACKGROUNDS, PRINT_SIZES, PRODUCT_TYPES, type PrintSize, type ProductType, type RoomBackground } from '@/lib/room-backgrounds';

type Lang = 'fr' | 'en';

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

  // Build slides array: original photo first, then room backgrounds
  const slides: SlideType[] = [
    { type: 'original' },
    ...ROOM_BACKGROUNDS.map(room => ({ type: 'room' as const, room })),
  ];

  // Handle scroll snap detection
  const handleScroll = useCallback(() => {
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
  }, [currentIndex, slides.length, onSlideChange]);

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
    <div className="relative bg-neutral-100" role="region" aria-label={lang === 'fr' ? 'Aperçu du produit' : 'Product preview'}>
      {/* Carousel Container */}
      <div
        ref={scrollContainerRef}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {slides.map((slide, index) => (
          slide.type === 'original' ? (
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
          )
        ))}
      </div>

      {/* Dot Indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.type === 'original' ? 'original' : slide.room.id}
            onClick={() => handleDotClick(index)}
            className={`transition-all duration-300 ${
              index === currentIndex
                ? 'w-6 h-2 bg-white rounded-full'
                : 'w-2 h-2 bg-white/40 rounded-full hover:bg-white/60'
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
      className="relative flex-shrink-0 w-full snap-center aspect-[4/3] flex items-center justify-center bg-neutral-100"
      aria-hidden={!isActive}
    >
      {/* Product Preview - centered with styling based on product type */}
      <div className="relative w-[65%] max-w-md">
        <ProductFrame product={selectedProduct}>
          <div className="relative w-full aspect-[4/3] bg-neutral-200 overflow-hidden">
            {photoUrl && !imageError ? (
              <Image
                src={photoUrl}
                alt={photoAlt}
                fill
                sizes="(max-width: 768px) 70vw, 50vw"
                className="object-cover"
                priority
                onError={onImageError}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-200">
                <span className="text-neutral-400 text-xs">
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
          <div className="relative w-full aspect-[4/3] overflow-hidden bg-neutral-200">
            {photoUrl && !imageError ? (
              <Image
                src={photoUrl}
                alt={photoAlt}
                fill
                sizes="(max-width: 768px) 50vw, 30vw"
                className="object-cover"
                onError={onImageError}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-200">
                <span className="text-neutral-400 text-[10px]">Photo</span>
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
  const shadowBase = inRoom ? 12 : 20;
  const shadowBlur = shadowBase * style.shadowIntensity * 3;
  const shadowSpread = shadowBase * style.shadowIntensity;

  switch (style.type) {
    case 'poster':
      // Simple poster with subtle shadow
      return (
        <div
          className="relative transition-all duration-300"
          style={{
            boxShadow: `0 ${shadowSpread}px ${shadowBlur}px rgba(0,0,0,${style.shadowIntensity})`,
          }}
        >
          {children}
        </div>
      );

    case 'framed':
      // Wooden frame with mat
      return (
        <div
          className="relative transition-all duration-300"
          style={{
            padding: style.matColor ? (inRoom ? '3%' : '4%') : 0,
            backgroundColor: style.matColor || 'transparent',
            border: `${style.frameWidth || 8}px solid ${style.frameColor || '#1a1a1a'}`,
            boxShadow: `0 ${shadowSpread}px ${shadowBlur}px rgba(0,0,0,${style.shadowIntensity})`,
          }}
        >
          {children}
        </div>
      );

    case 'canvas':
      // Canvas with wrapped edge effect
      return (
        <div
          className="relative transition-all duration-300"
          style={{
            boxShadow: `
              ${inRoom ? 3 : 5}px ${inRoom ? 3 : 5}px 0 rgba(0,0,0,0.1),
              0 ${shadowSpread}px ${shadowBlur}px rgba(0,0,0,${style.shadowIntensity})
            `,
          }}
        >
          {/* Canvas depth effect */}
          <div 
            className="absolute -right-1 top-1 bottom-1 w-2 bg-neutral-300"
            style={{ transform: 'skewY(-45deg)', transformOrigin: 'top left' }}
          />
          <div 
            className="absolute left-1 right-1 -bottom-1 h-2 bg-neutral-400"
            style={{ transform: 'skewX(-45deg)', transformOrigin: 'top left' }}
          />
          <div className="relative">{children}</div>
        </div>
      );

    case 'hanger':
      // Poster with wooden hanger
      return (
        <div className="relative transition-all duration-300">
          {/* Top hanger */}
          <div
            className="absolute -top-2 left-1/2 -translate-x-1/2 h-3 rounded-sm z-10"
            style={{
              width: '110%',
              backgroundColor: style.hangerColor || '#c4a77d',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }}
          />
          {/* Hanging string */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-px h-4 bg-neutral-400" />
          {/* Poster */}
          <div
            style={{
              boxShadow: `0 ${shadowSpread}px ${shadowBlur}px rgba(0,0,0,${style.shadowIntensity})`,
            }}
          >
            {children}
          </div>
          {/* Bottom hanger */}
          <div
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-2 rounded-sm"
            style={{
              width: '110%',
              backgroundColor: style.hangerColor || '#c4a77d',
              boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
            }}
          />
        </div>
      );

    default:
      return <div className="relative">{children}</div>;
  }
};

export { ROOM_BACKGROUNDS, PRINT_SIZES, PRODUCT_TYPES };
export type { PrintSize, ProductType, RoomBackground };
