export type AbVariant = 'home' | 'game';

const AB_COOKIE = 'mtl_ab_game';
const AB_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getAbVariant(): AbVariant | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${AB_COOKIE}=([^;]*)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return value === 'game' || value === 'home' ? value : null;
}

export function setAbVariant(variant: AbVariant): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${AB_COOKIE}=${encodeURIComponent(variant)}; Max-Age=${AB_MAX_AGE}; Path=/; SameSite=Lax`;
}

export function parseAbParam(params: URLSearchParams | null): AbVariant | null {
  if (!params) return null;
  const value = params.get('ab');
  if (value === 'game' || value === 'home') return value;
  return null;
}

export function assignAbVariant(ratio: number, current?: AbVariant | null): AbVariant {
  if (current) return current;
  return Math.random() < ratio ? 'game' : 'home';
}
