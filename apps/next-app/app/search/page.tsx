import type { Metadata } from 'next';
import { ArchiveStore } from '@/components/ArchiveStore';
import { bilingualMetadata, langFromSearchParams } from '@/lib/seo';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/search', {
    fr: {
      title: 'Recherche',
      description: 'Cherchez les archives de Montréal par rue, quartier, époque ou similarité visuelle.',
    },
    en: {
      title: 'Search',
      description: 'Search the Montreal archives by street, neighbourhood, decade, or visual similarity.',
    },
  });
}

export default function SearchPage() {
  return <ArchiveStore initialView="search" />;
}
