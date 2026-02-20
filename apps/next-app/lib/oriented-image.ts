const ORIENTED_IMAGE_VERSION = '2026-02-20';

function normalizeRotationDegrees(rotationDegrees: number | null | undefined): number | null {
  if (rotationDegrees == null) return null;
  const parsed = Number(rotationDegrees);
  if (!Number.isFinite(parsed)) return null;
  const normalized = ((Math.round(parsed / 90) * 90) % 360 + 360) % 360;
  return normalized === 0 ? null : normalized;
}

export function buildOrientedImagePath(
  sourceUrl: string | null | undefined,
  rotationDegrees?: number | null
): string {
  if (!sourceUrl) return '';

  const params = new URLSearchParams();
  params.set('src', sourceUrl);
  const rotation = normalizeRotationDegrees(rotationDegrees);
  if (rotation != null) {
    params.set('rot', String(rotation));
  }
  params.set('v', ORIENTED_IMAGE_VERSION);
  return `/api/oriented-image?${params.toString()}`;
}
