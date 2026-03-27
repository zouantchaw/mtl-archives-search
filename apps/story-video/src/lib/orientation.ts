/**
 * Image orientation helpers — mirrors apps/next-app/lib/oriented-image.ts
 *
 * Two sources of rotation:
 * 1. DB `rotationDegrees` — explicit manual override stored in the manifest.
 * 2. EXIF Orientation tag — embedded in the JPEG by the scanner/camera.
 *
 * The render scripts resolve both at fetch time into a single `rotation`
 * value (0, 90, 180, 270) before passing it to the compositions.
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

/**
 * Convert EXIF Orientation tag (1-8) to degrees of clockwise rotation.
 * Only handles the simple rotation cases (1, 3, 6, 8).
 * Mirror/transpose orientations (2, 4, 5, 7) are treated as 0.
 */
export function exifOrientationToDegrees(
  exifOrientation: number | null | undefined
): ImageRotation {
  if (exifOrientation == null) return 0;
  switch (exifOrientation) {
    case 3:
      return 180;
    case 6:
      return 90;
    case 8:
      return 270;
    default:
      return 0;
  }
}
