'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { frFR } from '@clerk/localizations';

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

const resolveClientLang = (): 'fr' | 'en' => {
  if (typeof window === 'undefined') return 'fr';

  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  if (fromQuery === 'en' || fromQuery === 'fr') return fromQuery;

  return window.navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
};

export function ClerkScopedProvider({ children }: { children: React.ReactNode }) {
  const lang = resolveClientLang();

  return (
    <ClerkProvider localization={lang === 'fr' ? frLocalization : enLocalization}>
      {children}
    </ClerkProvider>
  );
}
