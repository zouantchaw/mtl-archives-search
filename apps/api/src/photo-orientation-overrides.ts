const PHOTO_ORIENTATION_OVERRIDES: Record<string, number> = {
  // Known sideways archive scan; corrected to upright orientation.
  mtl_archives_metadata_13418: 90,
};

export function getPhotoOrientationOverride(metadataFilename: string): number | null {
  const normalized = metadataFilename.replace(/\.json$/i, '');
  const value = PHOTO_ORIENTATION_OVERRIDES[normalized];
  return Number.isFinite(value) ? value : null;
}

