import type { Metadata } from 'next';
import { PrintGalleryClient } from './PrintGalleryClient';
import { bilingualMetadata, langFromSearchParams } from '@/lib/seo';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/print', {
    fr: {
      title: 'Impressions',
      description: 'Choisissez une photo historique de Montréal à imprimer sur papier d\u2019art. Dès 45 $.',
    },
    en: {
      title: 'Prints',
      description: 'Choose a historical Montreal photo to print on fine art paper. From $45.',
    },
  });
}

export default function PrintPage() {
  return <PrintGalleryClient />;
}
