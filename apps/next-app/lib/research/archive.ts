import sharp from "sharp";
import type { PhotoRecord } from "../types";
import type { ArchivePhoto } from "./schema";
export const archiveOrigin =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://mtl-archives-worker.wiel.workers.dev";
const imageOrigin = "https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev";
export async function archiveFetch(path: string, signal?: AbortSignal) {
  const response = await fetch(new URL(path, archiveOrigin), {
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
      : AbortSignal.timeout(35000),
  });
  if (!response.ok)
    throw new Error(
      "The archive search is temporarily unavailable. Please try again.",
    );
  return response.json();
}
export async function getRecord(
  id: string,
  signal?: AbortSignal,
): Promise<PhotoRecord> {
  if (!/^mtl_archives_metadata_\d+(?:\.json)?$/.test(id))
    throw new Error("Invalid archive record");
  const data = await archiveFetch(
    `/api/photos?id=${encodeURIComponent(id)}`,
    signal,
  );
  if (!data.items?.[0]) throw new Error("Archive record not found");
  return data.items[0];
}
export function presentPhoto(r: PhotoRecord): ArchivePhoto {
  return {
    id: r.metadataFilename,
    title: r.name || r.portalTitle,
    date: r.dateValue,
    description:
      r.description && !/^(S\/O|N\/A)$/i.test(r.description)
        ? r.description
        : r.portalDescription,
    reference: r.cote || r.portalCote,
    sourceUrl: safeSource(r.externalUrl),
    archiveUrl: `/photo/${r.metadataFilename.replace(/\.json$/, "")}`,
    imageUrl: `/api/research/image?id=${encodeURIComponent(r.metadataFilename)}`,
    caption: r.vlmCaption,
    credits: r.credits,
    visualCheck: { status: "not_checked", observation: "" },
  };
}
function safeSource(value: string | null) {
  try {
    const u = new URL(value ?? "");
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export async function imageBytes(record: PhotoRecord, signal?: AbortSignal) {
  // Fetch only a canonical object's fixed public origin; never a client/model URL.
  if ((record.imageSizeBytes ?? Infinity) > 12_000_000)
    throw new Error(
      "This original is too large for an automatic visual check.",
    );
  const key = record.resolvedImageFilename || record.imageFilename;
  if (!/^mtl_archives_image_\d+\.(jpg|jpeg|png)$/i.test(key))
    throw new Error("Unsupported archive image");
  const response = await fetch(`${imageOrigin}/${encodeURIComponent(key)}`, {
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 12_000_000
  )
    throw new Error("Image is unavailable for visual inspection.");
  const reader = response.body!.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 12_000_000) throw new Error("Image size limit");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return sharp(Buffer.concat(parts), { limitInputPixels: 100_000_000 })
    .rotate(record.rotationDegrees ?? 0)
    .resize(900, 900, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}
