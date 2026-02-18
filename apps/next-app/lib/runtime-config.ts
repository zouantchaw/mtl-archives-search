import { resolveRuntimeConfig } from './runtime-env';

const isServer = typeof window === 'undefined';

const resolved = resolveRuntimeConfig({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  API_BASE_URL: process.env.API_BASE_URL,
  NEXT_PUBLIC_R2_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN,
  CLOUDFLARE_R2_PUBLIC_DOMAIN: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN,
}, process.env.NODE_ENV, { strict: isServer });

if (!isServer && !resolved.apiBase && process.env.NODE_ENV === 'production') {
  console.error('[runtime-config] NEXT_PUBLIC_API_URL missing in client bundle; using same-origin relative API paths.');
}

export const API_BASE = resolved.apiBase;
export const API_ORIGIN = resolved.apiOrigin;
export const R2_PUBLIC_DOMAIN = resolved.r2PublicDomain;
export const R2_ORIGIN = resolved.r2Origin;
