import type { Metadata } from 'next';
import { ArchiveStore } from "@/components/ArchiveStore";
import { bilingualMetadata, langFromSearchParams } from '@/lib/seo';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/', {
    fr: {
      title: 'MTL Archives — Photos historiques de Montréal',
      description: 'Explorez 14 822 photos historiques de Montréal. Recherchez par rue, quartier ou lieu emblématique.',
    },
    en: {
      title: 'MTL Archives — Historical Photos of Montreal',
      description: 'Explore 14,822 historical photos of Montreal. Search by street, neighbourhood, or landmark.',
    },
  });
}

export default function Page() {
  return <ArchiveStore initialView="landing" />;
}
