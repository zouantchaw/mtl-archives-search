import type { Metadata } from 'next';
import { GameClient } from './GameClient';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';
const gameShareDescription = 'Devine l’emplacement d’une photo d’archive de Montréal, marque des points, puis compare ton score.';
const gameShareImageUrl = `${siteUrl}/opengraph-image`;

export const metadata: Metadata = {
  title: 'Jeu quotidien',
  description: gameShareDescription,
  alternates: {
    canonical: `${siteUrl}/game`,
    languages: {
      'fr-CA': `${siteUrl}/game?lang=fr`,
      'en-CA': `${siteUrl}/game?lang=en`,
      'x-default': `${siteUrl}/game`,
    },
  },
  openGraph: {
    title: 'Jeu quotidien | MTL Archives',
    description: gameShareDescription,
    url: `${siteUrl}/game`,
    images: [
      {
        url: gameShareImageUrl,
        width: 1200,
        height: 630,
        alt: 'Jeu quotidien MTL Archives',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Jeu quotidien | MTL Archives',
    description: gameShareDescription,
    images: [gameShareImageUrl],
  },
};

export default function GamePage() {
  return <GameClient />;
}
