export function normalizePhotoId(id: string): string {
  return id.replace(/\.json$/i, '');
}

