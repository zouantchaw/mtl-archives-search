const ORIENTED_IMAGE_VERSION = '2026-02-20';

export function buildOrientedImagePath(sourceUrl: string | null | undefined): string {
  if (!sourceUrl) return '';

  const params = new URLSearchParams();
  params.set('src', sourceUrl);
  params.set('v', ORIENTED_IMAGE_VERSION);
  return `/api/oriented-image?${params.toString()}`;
}
