export function photoShortId(id: string) {
  return id.replace(/^mtl_archives_metadata_/, "").replace(/\.json$/, "");
}

export function photoCanonicalId(value: string) {
  const n = value.replace(/[^\d]/g, "");
  return n ? `mtl_archives_metadata_${n}.json` : null;
}

export function encodeCollection(ids: string[]) {
  return [...new Set(ids.map(photoShortId).filter(Boolean))].slice(0, 24).join(",");
}

export function decodeCollection(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(",")
    .map(photoCanonicalId)
    .filter((id): id is string => Boolean(id))
    .slice(0, 24);
}
