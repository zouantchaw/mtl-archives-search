export type Lang = 'fr' | 'en';

export const DEFAULT_LANG: Lang = 'fr';

export function normalizeLang(value?: string | null): Lang {
  return value === 'en' ? 'en' : 'fr';
}

export function getLangFromSearchParams(params: URLSearchParams | null): Lang {
  return normalizeLang(params?.get('lang'));
}

export function appendLangParam(path: string, lang: Lang): string {
  if (lang === DEFAULT_LANG) return path;
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}lang=${lang}`;
}
