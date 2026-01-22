'use client';

import { useState } from 'react';
import Image from 'next/image';

type PhotoTileProps = {
  src: string;
  alt: string;
  priority?: boolean;
  onClick?: () => void;
  onError?: () => void;
};

export function PhotoTile({ src, alt, priority = false, onClick, onError }: PhotoTileProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      onClick={onClick}
      className="relative aspect-square bg-neutral-100 overflow-hidden group"
    >
      {/* Skeleton placeholder - shows until image loads */}
      <div
        className={`absolute inset-0 skeleton transition-opacity duration-300 ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Image with fade-in */}
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 14vw"
        className={`object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        onLoad={() => setLoaded(true)}
        onError={onError}
      />

      {/* Subtle hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-200" />
    </button>
  );
}
