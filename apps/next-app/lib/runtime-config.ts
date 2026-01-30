const rawApiBase = process.env.NEXT_PUBLIC_API_URL || process.env.API_BASE_URL || '';
const isProd = process.env.NODE_ENV === 'production';

const defaultApiBase = rawApiBase || (!isProd ? 'http://localhost:8787' : '');

if (!defaultApiBase && isProd) {
  throw new Error('NEXT_PUBLIC_API_URL is required in production.');
}

export const API_BASE = defaultApiBase.replace(/\/$/, '');

export const API_ORIGIN = (() => {
  if (!API_BASE || !API_BASE.startsWith('http')) return '';
  try {
    return new URL(API_BASE).origin;
  } catch {
    return '';
  }
})();

export const R2_PUBLIC_DOMAIN = process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || '';
export const R2_ORIGIN = R2_PUBLIC_DOMAIN ? `https://${R2_PUBLIC_DOMAIN}` : '';
