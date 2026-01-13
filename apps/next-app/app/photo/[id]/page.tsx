import { Suspense } from 'react';
import { PhotoPageClient } from './PhotoPageClient';
import type { PhotoRecord } from '@/lib/types';

// API endpoint for fetching photo data - runs on server
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://mtl-archives-worker.wiel.workers.dev';

async function getPhoto(id: string): Promise<PhotoRecord | null> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(id)}`, {
      // Cache for 1 hour, revalidate in background
      next: { revalidate: 3600 },
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

  // Fetch photo data server-side (cached, no client waterfall)
  const photo = await getPhoto(decodedId);

  return (
    <Suspense fallback={<PhotoSkeleton />}>
      <PhotoPageClient photo={photo} photoId={decodedId} />
    </Suspense>
  );
}

// Inline skeleton for Suspense fallback
function PhotoSkeleton() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/90 backdrop-blur-sm border-b border-neutral-100">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="h-5 w-16 bg-neutral-200 rounded animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 bg-neutral-200 rounded animate-pulse" />
            <div className="h-5 w-5 bg-neutral-200 rounded animate-pulse" />
          </div>
        </div>
      </header>
      <main className="pt-12">
        <div className="relative bg-neutral-100">
          <div className="max-w-5xl mx-auto">
            <div className="w-full bg-neutral-200 animate-pulse" style={{ aspectRatio: '4/3', maxHeight: '70vh' }} />
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="h-6 w-3/4 bg-neutral-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-24 bg-neutral-100 rounded animate-pulse mb-8" />
          <div className="h-12 w-full bg-neutral-100 rounded-full animate-pulse" />
        </div>
      </main>
    </div>
  );
}
