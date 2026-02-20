const PHOTO_ORIENTATION_OVERRIDES: Record<string, number> = {
};

export function getPhotoOrientationOverride(metadataFilename: string): number | null {
  const normalized = metadataFilename.replace(/\.json$/i, '');
  const value = PHOTO_ORIENTATION_OVERRIDES[normalized];
  return Number.isFinite(value) ? value : null;
}
