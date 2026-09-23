export const MAIN_SITE = 'https://www.mtlarchives.com'

export type Lang = 'en' | 'fr'

export function recordId(id: string): string {
  return id.replace(/\.json$/i, '')
}

export function mainSiteHome(lang: Lang): string {
  return lang === 'en' ? `${MAIN_SITE}/?lang=en` : `${MAIN_SITE}/`
}

export function mainSiteRecord(id: string, lang: Lang): string {
  const path = `${MAIN_SITE}/photo/${encodeURIComponent(recordId(id))}`
  return lang === 'en' ? `${path}?lang=en` : path
}

export function officialSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function thumbnailUrl(origin: string, src: string, width: number, height: number): string {
  const params = new URLSearchParams({
    src,
    w: String(width),
    h: String(height),
    fit: 'cover',
    format: 'auto',
    q: width > 800 ? '80' : '70',
  })
  const base = origin.replace(/\/$/, '')
  return `${base}/api/thumb?${params.toString()}`
}
