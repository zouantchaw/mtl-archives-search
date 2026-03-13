const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type NewsletterLang = 'fr' | 'en';
export type NewsletterTokenAction = 'unsubscribe' | 'resubscribe';

export type NewsletterTokenPayload = {
  action: NewsletterTokenAction;
  email: string;
  lang: NewsletterLang;
  issuedAt: string;
};

export function normalizeNewsletterLang(value: unknown): NewsletterLang {
  return value === 'en' ? 'en' : 'fr';
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function getTorontoDateKey(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

export function getTorontoHour(date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'America/Toronto',
  });
  return Number(formatter.format(date));
}

export function isTorontoNewsletterSendHour(date = new Date(), sendHour = 7): boolean {
  return getTorontoHour(date) === sendHour;
}

export function formatNewsletterDateLabel(lang: NewsletterLang, date = new Date()): string {
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Toronto',
  }).format(date).toLocaleUpperCase(locale);
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signValue(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createNewsletterToken(
  payload: NewsletterTokenPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = encodeBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await signValue(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyNewsletterToken(
  token: string,
  secret: string,
): Promise<NewsletterTokenPayload | null> {
  const [encodedPayload, providedSignature] = token.split('.');
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = await signValue(secret, encodedPayload);
  if (!timingSafeEqual(providedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(textDecoder.decode(decodeBase64Url(encodedPayload))) as Partial<NewsletterTokenPayload>;
    if (!payload || typeof payload !== 'object') return null;
    if (payload.action !== 'unsubscribe' && payload.action !== 'resubscribe') return null;
    if (typeof payload.email !== 'string' || !isValidEmail(payload.email)) return null;
    if (payload.lang !== 'fr' && payload.lang !== 'en') return null;
    if (typeof payload.issuedAt !== 'string' || !payload.issuedAt) return null;
    return {
      action: payload.action,
      email: normalizeEmail(payload.email),
      lang: payload.lang,
      issuedAt: payload.issuedAt,
    };
  } catch {
    return null;
  }
}
