const ORIENTED_IMAGE_VERSION = '2026-02-20';

export type ImageRotation = 0 | 90 | 180 | 270;

function coerceRotation(rotationDegrees: number | null | undefined): ImageRotation {
  if (rotationDegrees == null) return 0;
  const parsed = Number(rotationDegrees);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = ((Math.round(parsed / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

export function normalizeRotationDegrees(rotationDegrees: number | null | undefined): ImageRotation {
  return coerceRotation(rotationDegrees);
}

export function combineRotationDegrees(
  baseRotationDegrees: number | null | undefined,
  userRotationDegrees: number | null | undefined
): ImageRotation {
  return coerceRotation(coerceRotation(baseRotationDegrees) + coerceRotation(userRotationDegrees));
}

export function rotateClockwise(rotationDegrees: number | null | undefined): ImageRotation {
  return combineRotationDegrees(rotationDegrees, 90);
}

export function parseImageRotationParam(value: string | null | undefined): ImageRotation {
  if (!value) return 0;
  return coerceRotation(Number.parseInt(value, 10));
}

export function buildOrientedImagePath(
  sourceUrl: string | null | undefined,
  rotationDegrees?: number | null
): string {
  if (!sourceUrl) return '';

  const params = new URLSearchParams();
  params.set('src', sourceUrl);
  const rotation = coerceRotation(rotationDegrees);
  if (rotation !== 0) {
    params.set('rot', String(rotation));
  }
  params.set('v', ORIENTED_IMAGE_VERSION);
  return `/api/oriented-image?${params.toString()}`;
}
