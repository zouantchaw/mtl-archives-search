import type { Metadata } from 'next';
import { API_BASE } from '@/lib/runtime-config';
import { normalizePhotoId } from '@/lib/photo-id';

// API endpoint for fetching photo data
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

// Clean text: remove escaped newlines, normalize whitespace
function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type PhotoData = {
  name?: string;
  dateValue?: string;
  description?: string;
  portalTitle?: string;
  portalDescription?: string;
  imageUrl?: string;
  cote?: string;
  credits?: string;
  latitude?: number;
  longitude?: number;
  metadataFilename?: string;
};

async function getPhoto(id: string): Promise<PhotoData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(id)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

// Generate JSON-LD structured data for photo pages
function generateJsonLd(photo: PhotoData, photoId: string) {
  const canonicalPath = `/photo/${encodeURIComponent(photoId)}`;
  const title = cleanText(photo.name) || cleanText(photo.portalTitle) || 'Photo historique';
  const description = photo.description && photo.description !== 'S/O'
    ? cleanText(photo.description)
    : cleanText(photo.portalDescription) || 'Photo historique des archives de Montréal';
  const date = cleanText(photo.dateValue);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name: title,
    description: description,
    contentUrl: photo.imageUrl,
    thumbnailUrl: photo.imageUrl,
    url: `${SITE_URL}${canonicalPath}`,
    creditText: photo.credits || 'Archives de la Ville de Montréal',
    copyrightHolder: {
      '@type': 'Organization',
      name: 'Archives de la Ville de Montréal',
    },
    acquireLicensePage: `${SITE_URL}${canonicalPath}`,
    isPartOf: {
      '@type': 'CollectionPage',
      name: 'MTL Archives',
      url: SITE_URL,
    },
  };

  // Add date if available
  if (date) {
    jsonLd.dateCreated = date;
    // Try to parse year for temporal coverage
    const yearMatch = date.match(/\d{4}/);
    if (yearMatch) {
      jsonLd.temporalCoverage = yearMatch[0];
    }
  }

  // Add location if coordinates available
  if (photo.latitude && photo.longitude) {
    jsonLd.contentLocation = {
      '@type': 'Place',
      geo: {
        '@type': 'GeoCoordinates',
        latitude: photo.latitude,
        longitude: photo.longitude,
      },
    };
  }

  // Add archive reference
  if (photo.cote) {
    jsonLd.identifier = {
      '@type': 'PropertyValue',
      propertyID: 'cote',
      value: photo.cote,
    };
  }

  return jsonLd;
}

export async function generateMetadata({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}): Promise<Metadata> {
  const { id } = await params;
  const normalizedId = normalizePhotoId(decodeURIComponent(id));
  const canonicalUrl = `${SITE_URL}/photo/${encodeURIComponent(normalizedId)}`;
  const photo = await getPhoto(normalizedId);
  
  const title = cleanText(photo?.name) || cleanText(photo?.portalTitle) || 'Photo historique';
  const date = photo?.dateValue ? ` (${cleanText(photo.dateValue)})` : '';
  const description = photo?.description && photo.description !== 'S/O'
    ? cleanText(photo.description)
    : cleanText(photo?.portalDescription) || 'Photo historique des archives de Montréal';

  return {
    title: `${title}${date}`,
    description: description.slice(0, 160),
    openGraph: {
      title: `${title}${date} | MTL Archives`,
      description: description.slice(0, 160),
      type: 'article',
      locale: 'fr_CA',
      siteName: 'MTL Archives',
      url: canonicalUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title}${date}`,
      description: description.slice(0, 160),
    },
    alternates: {
      canonical: canonicalUrl,
    },
  };
}

export default async function PhotoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const normalizedId = normalizePhotoId(decodeURIComponent(id));
  const photo = await getPhoto(normalizedId);

  return (
    <>
      {photo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(generateJsonLd(photo, normalizedId)),
          }}
        />
      )}
      {children}
    </>
  );
}
