'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { frFR } from '@clerk/localizations';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { getLangFromSearchParams } from '@/lib/i18n';

const frLocalization = {
  ...frFR,
  signIn: {
    ...frFR.signIn,
    start: {
      ...frFR.signIn?.start,
      subtitle: 'Se connecter pour sauvegarder ton score et suivre ta série 🔥',
    },
  },
  signUp: {
    ...frFR.signUp,
    start: {
      ...frFR.signUp?.start,
      subtitle: 'Se connecter pour sauvegarder ton score et suivre ta série 🔥',
    },
  },
};

const enLocalization = {
  signIn: {
    start: {
      subtitle: 'Sign in to save your score and track your streak 🔥',
    },
  },
  signUp: {
    start: {
      subtitle: 'Sign in to save your score and track your streak 🔥',
    },
  },
};

function ClerkWithLang({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);

  return (
    <ClerkProvider localization={lang === 'fr' ? frLocalization : enLocalization}>
      {children}
    </ClerkProvider>
  );
}

export function ClerkLocalized({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <ClerkProvider localization={frLocalization}>{children}</ClerkProvider>
      }
    >
      <ClerkWithLang>{children}</ClerkWithLang>
    </Suspense>
  );
}
