import type { Metadata } from 'next';
import { GameClient } from './GameClient';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

export const metadata: Metadata = {
  alternates: {
    canonical: `${siteUrl}/game`,
    languages: {
      'fr-CA': `${siteUrl}/game?lang=fr`,
      'en-CA': `${siteUrl}/game?lang=en`,
      'x-default': `${siteUrl}/game`,
    },
  },
};

export default function GamePage() {
  return <GameClient />;
}
