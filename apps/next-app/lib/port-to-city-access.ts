import evidenceCore from '@/content/port-to-city/evidence-core.v1.json';

export function canRenderPortToCity() {
  if (evidenceCore.releaseStatus === 'public') return true;
  return process.env.VERCEL_ENV !== 'production';
}
