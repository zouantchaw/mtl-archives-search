'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { frFR } from '@clerk/localizations';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { getLangFromSearchParams } from '@/lib/i18n';

function ClerkWithLang({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);

  return (
    <ClerkProvider localization={lang === 'fr' ? frFR : undefined}>
      {children}
    </ClerkProvider>
  );
}

export function ClerkLocalized({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <ClerkProvider localization={frFR}>{children}</ClerkProvider>
      }
    >
      <ClerkWithLang>{children}</ClerkWithLang>
    </Suspense>
  );
}
