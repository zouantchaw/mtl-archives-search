import type { Metadata } from 'next';

// API endpoint for fetching photo data
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://mtl-archives-worker.wiel.workers.dev';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mtl-archives.com';

// Clean text: remove escaped newlines, normalize whitespace
function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\\n/g, ' ')
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
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

// Generate JSON-LD structured data for photo pages
function generateJsonLd(photo: PhotoData, id: string) {
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
    url: `${SITE_URL}/photo/${id}`,
    creditText: photo.credits || 'Archives de la Ville de Montréal',
    copyrightHolder: {
      '@type': 'Organization',
      name: 'Archives de la Ville de Montréal',
    },
    acquireLicensePage: `${SITE_URL}/photo/${id}`,
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
  const photo = await getPhoto(decodeURIComponent(id));
  
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
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title}${date}`,
      description: description.slice(0, 160),
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
  const photo = await getPhoto(decodeURIComponent(id));

  return (
    <>
      {photo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(generateJsonLd(photo, id)),
          }}
        />
      )}
      {children}
    </>
  );
}
