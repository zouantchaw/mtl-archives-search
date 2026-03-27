/**
 * Image orientation helpers — mirrors apps/next-app/lib/oriented-image.ts
 *
 * The archive stores a `rotationDegrees` field (0, 90, 180, 270) that
 * indicates how the raw R2 image needs to be rotated for correct display.
 * The next-app applies this server-side via sharp; here we apply it
 * client-side via CSS transform since Remotion renders in Chromium.
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
 * Returns inline style props to apply rotation to an image container.
 * For 90° or 270° rotations the image swaps width/height, so we also
 * need to adjust the container dimensions via a scale trick.
 */
export function orientedStyle(
  rotation: ImageRotation
): React.CSSProperties {
  if (rotation === 0) return {};
  return { transform: `rotate(${rotation}deg)` };
}
