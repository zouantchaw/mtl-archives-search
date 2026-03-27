/**
 * Image orientation helpers.
 *
 * Archive scans often have incorrect EXIF Orientation tags, so we
 * ignore EXIF entirely (image-orientation: none in OrientedImg) and
 * only trust the DB `rotationDegrees` field which is manually verified.
 */

export type ImageRotation = 0 | 90 | 180 | 270;

export function coerceRotation(
  deg: number | null | undefined
): ImageRotation {
  if (deg == null) return 0;
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  const normalized = (((Math.round(n / 90) * 90) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270)
    return normalized;
  return 0;
}
