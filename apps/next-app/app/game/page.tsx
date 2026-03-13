import type { Metadata } from 'next';
import { GameClient } from './GameClient';
import { bilingualMetadata, langFromSearchParams, SITE_URL } from '@/lib/seo';

const gameShareImageUrl = `${SITE_URL}/opengraph-image`;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/game', {
    fr: {
      title: 'Jeu quotidien',
      description: 'Devine l\u2019emplacement d\u2019une photo d\u2019archive de Montréal, marque des points, puis compare ton score.',
    },
    en: {
      title: 'Daily game',
      description: 'Guess where a Montreal archive photo was taken, earn points, and compare your score.',
    },
  }, {
    openGraph: {
      title: lang === 'fr' ? 'Jeu quotidien | MTL Archives' : 'Daily game | MTL Archives',
      description: lang === 'fr'
        ? 'Devine l\u2019emplacement d\u2019une photo d\u2019archive de Montréal.'
        : 'Guess where a Montreal archive photo was taken.',
      url: `${SITE_URL}/game`,
      images: [{
        url: gameShareImageUrl,
        width: 1200,
        height: 630,
        alt: lang === 'fr' ? 'Jeu quotidien MTL Archives' : 'MTL Archives daily game',
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: lang === 'fr' ? 'Jeu quotidien | MTL Archives' : 'Daily game | MTL Archives',
      description: lang === 'fr'
        ? 'Devine l\u2019emplacement d\u2019une photo d\u2019archive de Montréal.'
        : 'Guess where a Montreal archive photo was taken.',
      images: [gameShareImageUrl],
    },
  });
}

export default function GamePage() {
  return <GameClient />;
}
