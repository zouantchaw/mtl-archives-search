import type { Metadata } from 'next';
import { ArchiveStore } from '@/components/ArchiveStore';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

export const metadata: Metadata = {
  title: 'Recherche',
  description: 'Cherchez les archives de Montréal par rue, quartier, époque ou similarité visuelle.',
  alternates: {
    canonical: `${siteUrl}/search`,
    languages: {
      'fr-CA': `${siteUrl}/search?lang=fr`,
      'en-CA': `${siteUrl}/search?lang=en`,
      'x-default': `${siteUrl}/search`,
    },
  },
};

export default function SearchPage() {
  return <ArchiveStore initialView="search" />;
}
