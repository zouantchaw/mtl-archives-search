import type { Metadata } from 'next';
import type { Lang } from './i18n';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

/**
 * Generate canonical + hreflang alternates for a given path.
 * French is the default language (x-default), matching the primary audience.
 */
export function localizedAlternates(path: string) {
  const base = `${SITE_URL}${path}`;
  const joiner = path.includes('?') ? '&' : '?';
  return {
    canonical: base,
    languages: {
      'fr-CA': `${base}${joiner}lang=fr`,
      'en-CA': `${base}${joiner}lang=en`,
      'x-default': base,
    },
  };
}

/**
 * Build bilingual page metadata from fr/en title and description pairs.
 */
export function bilingualMetadata(
  lang: Lang,
  path: string,
  content: {
    fr: { title: string; description: string };
    en: { title: string; description: string };
  },
  extra?: Partial<Metadata>,
): Metadata {
  const t = content[lang];
  return {
    title: t.title,
    description: t.description,
    alternates: localizedAlternates(path),
    openGraph: {
      title: `${t.title} | MTL Archives`,
      description: t.description,
      url: `${SITE_URL}${path}`,
      locale: lang === 'fr' ? 'fr_CA' : 'en_CA',
      siteName: 'MTL Archives',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${t.title} | MTL Archives`,
      description: t.description,
    },
    ...extra,
  };
}

/** Extract lang from page searchParams (works in generateMetadata). */
export function langFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): Lang {
  const raw = searchParams.lang;
  return raw === 'en' ? 'en' : 'fr';
}
