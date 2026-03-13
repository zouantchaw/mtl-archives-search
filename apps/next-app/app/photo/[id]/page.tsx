import { Suspense } from 'react';
import { PhotoPageClient } from './PhotoPageClient';
import type { PhotoRecord } from '@/lib/types';
import { API_BASE } from '@/lib/runtime-config';
import { normalizePhotoId } from '@/lib/photo-id';

// API endpoint for fetching photo data - runs on server
const PHOTO_API_CACHE_VERSION = '2026-02-20-rotation-v2';

async function getPhoto(id: string): Promise<PhotoRecord | null> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(id)}&cv=${PHOTO_API_CACHE_VERSION}`, {
      // Cache briefly to avoid stale metadata after worker-side cleanups.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

// Server component - fetches data and streams to client
export default async function PhotoPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const normalizedId = normalizePhotoId(decodedId);

  // Fetch photo data server-side (cached, no client waterfall)
  const photo = await getPhoto(normalizedId);

  return (
    <Suspense fallback={<PhotoSkeleton />}>
      <PhotoPageClient photo={photo} photoId={normalizedId} />
    </Suspense>
  );
}

// Inline skeleton for Suspense fallback - matches loading.tsx
function PhotoSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 skeleton rounded" />
            <div className="hidden sm:block h-4 w-14 skeleton rounded" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 skeleton rounded" />
            <div className="h-5 w-5 skeleton rounded" />
          </div>
        </div>
      </header>
      <main className="pt-12">
        <div className="relative bg-muted">
          <div className="max-w-5xl mx-auto">
            <div className="w-full skeleton" style={{ aspectRatio: '4/3', maxHeight: 'min(60vh, 500px)' }} />
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
          <div className="mb-3">
            <div className="h-5 sm:h-6 w-3/4 skeleton rounded mb-2" />
            <div className="h-4 w-20 skeleton rounded" />
          </div>
          <div className="space-y-2 mb-6">
            <div className="h-4 w-full skeleton rounded" />
            <div className="h-4 w-5/6 skeleton rounded" />
            <div className="h-4 w-2/3 skeleton rounded" />
          </div>
          <div className="h-12 w-full skeleton rounded-full" />
          <div className="mt-10 pt-5 border-t border-border flex justify-center">
            <div className="h-3 w-40 skeleton rounded" />
          </div>
        </div>
      </main>
    </div>
  );
}
