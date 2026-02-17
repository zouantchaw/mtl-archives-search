import { resolveRuntimeConfig } from './runtime-env';

const resolved = resolveRuntimeConfig();

export const API_BASE = resolved.apiBase;
export const API_ORIGIN = resolved.apiOrigin;
export const R2_PUBLIC_DOMAIN = resolved.r2PublicDomain;
export const R2_ORIGIN = resolved.r2Origin;
