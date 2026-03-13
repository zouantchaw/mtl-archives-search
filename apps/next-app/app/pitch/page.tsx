import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PitchDeck } from './PitchDeck';

export const metadata: Metadata = {
  title: 'MTL Archives — Pitch Deck',
  robots: { index: false, follow: false },
};

export default function PitchPage() {
  return (
    <Suspense>
      <PitchDeck />
    </Suspense>
  );
}
