import type { Metadata } from 'next';

// API endpoint for fetching photo data
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://mtl-archives-worker.wiel.workers.dev';

type PhotoData = {
  name?: string;
  dateValue?: string;
  description?: string;
  portalTitle?: string;
  portalDescription?: string;
};

async function getPhoto(id: string): Promise<PhotoData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(id)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}): Promise<Metadata> {
  const { id } = await params;
  const photo = await getPhoto(decodeURIComponent(id));
  
  const title = photo?.name || photo?.portalTitle || 'Photo historique';
  const date = photo?.dateValue ? ` (${photo.dateValue})` : '';
  const description = photo?.description && photo.description !== 'S/O' 
    ? photo.description 
    : photo?.portalDescription || 'Photo historique des archives de Montréal';

  return {
    title: `${title}${date}`,
    description: description.slice(0, 160),
    openGraph: {
      title: `${title}${date} | MTL Archives`,
      description: description.slice(0, 160),
      type: 'article',
      locale: 'fr_CA',
      siteName: 'MTL Archives',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title}${date}`,
      description: description.slice(0, 160),
    },
  };
}

export default function PhotoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
