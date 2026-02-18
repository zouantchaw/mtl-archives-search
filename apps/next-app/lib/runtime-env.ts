type RuntimeConfig = {
  apiBase: string;
  apiOrigin: string;
  r2PublicDomain: string;
  r2Origin: string;
};

type ResolveRuntimeConfigOptions = {
  strict?: boolean;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function toOrigin(value: string): string {
  if (!value || !value.startsWith('http')) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function resolveRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  options: ResolveRuntimeConfigOptions = {}
): RuntimeConfig {
  const isProd = nodeEnv === 'production';
  const strict = options.strict ?? true;

  const rawApiBase = env.NEXT_PUBLIC_API_URL || env.API_BASE_URL || '';
  const apiBase = trimTrailingSlash(rawApiBase || (!isProd ? 'http://localhost:8787' : ''));

  if (!apiBase && isProd && strict) {
    throw new Error('NEXT_PUBLIC_API_URL is required in production.');
  }

  const r2PublicDomain = env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '';

  return {
    apiBase,
    apiOrigin: toOrigin(apiBase),
    r2PublicDomain,
    r2Origin: r2PublicDomain ? `https://${r2PublicDomain}` : '',
  };
}
