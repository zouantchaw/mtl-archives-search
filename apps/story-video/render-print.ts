/**
 * Render "Print of the Week" videos in both square and story formats.
 *
 * Usage:
 *   npx tsx render-print.ts                       # random featured print
 *   npx tsx render-print.ts --photo <id>          # specific photo by ID
 *   npx tsx render-print.ts --out-dir ./custom    # custom output directory
 */

import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { FPS } from "./src/lib/brand";
import { SQUARE_DURATION, STORY_DURATION } from "./src/PrintOfTheWeek";
import { detectOrientation, stripExifAndCache } from "./src/lib/detect-orientation";
import { loadRepoEnv, resolveApiBase } from "./src/lib/load-env";

loadRepoEnv(path.resolve(__dirname, "../.."));

const API_BASE = resolveApiBase();

type PhotoRecord = {
  metadataFilename: string;
  imageUrl: string;
  name: string;
  dateValue: string;
  rotationDegrees: number | null;
};

type PrintProps = { imageUrl: string; title: string; date: string; rotation: number };

async function toProps(photo: PhotoRecord): Promise<PrintProps> {
  // Strip EXIF to prevent Chromium from applying bad orientation tags
  const publicDir = path.resolve(__dirname, "public");
  console.log("  Stripping EXIF and caching locally...");
  const staticKey = await stripExifAndCache(photo.imageUrl, publicDir);
  const cleanImageUrl = staticKey; // OrientedImg resolves via staticFile()

  // Use DB rotationDegrees if set, otherwise ask Gemini to detect
  let rotation = photo.rotationDegrees || 0;
  if (!rotation) {
    console.log("  Detecting orientation via Gemini...");
    rotation = await detectOrientation(photo.imageUrl);
    if (rotation) console.log(`  Gemini detected: needs ${rotation}° rotation`);
    else console.log("  Gemini: image is correctly oriented");
  }
  return {
    imageUrl: cleanImageUrl,
    title: photo.name || "Photo historique de Montréal",
    date: photo.dateValue || "",
    rotation,
  };
}

async function fetchFeaturedPrint(
  photoId?: string
): Promise<PrintProps> {
  if (photoId) {
    console.log(`Fetching photo ${photoId}...`);
    const res = await fetch(
      `${API_BASE}/api/photos?id=${encodeURIComponent(photoId)}`
    );
    if (!res.ok)
      throw new Error(`API returned ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items || [data];
    return toProps(items[0]);
  }

  // Fetch a batch and pick one at random (print-worthy photos)
  console.log("Fetching featured prints...");
  const res = await fetch(
    `${API_BASE}/api/photos?limit=12&shuffle=true&minTrust=0.65`
  );
  if (!res.ok)
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const photos: PhotoRecord[] = Array.isArray(data) ? data : data.items || data.photos || [];
  if (photos.length === 0) throw new Error("No photos returned from API");

  return toProps(photos[0]);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const photoIdx = args.indexOf("--photo");
  const photoId = photoIdx !== -1 ? args[photoIdx + 1] : undefined;
  const outIdx = args.indexOf("--out-dir");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : undefined;
  return { photoId, outDir };
}

async function main() {
  const { photoId, outDir } = parseArgs();

  const inputProps = await fetchFeaturedPrint(photoId);
  console.log(`  Photo: ${inputProps.title}`);
  console.log(`  Date: ${inputProps.date}`);
  console.log(`  Rotation: ${inputProps.rotation}°`);
  console.log(`  Image: ${inputProps.imageUrl}`);

  // Output directory
  const weekStr = getWeekString();
  const outputDir =
    outDir ||
    path.join(
      process.env.HOME || "~",
      "Desktop",
      "mtl-print-of-week",
      weekStr
    );
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log("\nBundling Remotion project...");
  const bundled = await bundle({
    entryPoint: path.resolve(__dirname, "src/index.ts"),
    onProgress: (progress) => {
      if (progress === 100) console.log("  Bundle complete.");
    },
  });

  // Render both formats
  const formats = [
    {
      id: "PrintOfTheWeek-Square",
      label: "Square (1080×1080)",
      duration: SQUARE_DURATION,
      filename: `${weekStr}-print-of-week-square.mp4`,
    },
    {
      id: "PrintOfTheWeek-Story",
      label: "Story (1080×1920)",
      duration: STORY_DURATION,
      filename: `${weekStr}-print-of-week-story.mp4`,
    },
  ];

  for (const fmt of formats) {
    console.log(`\nRendering ${fmt.label}...`);
    console.log(
      `  Duration: ${fmt.duration} frames (${(fmt.duration / FPS).toFixed(1)}s)`
    );

    const composition = await selectComposition({
      serveUrl: bundled,
      id: fmt.id,
      inputProps,
    });

    const outputLocation = path.join(outputDir, fmt.filename);

    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: "h264",
      outputLocation,
      inputProps,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 10 === 0) {
          process.stdout.write(`\r  Rendering: ${pct}%`);
        }
      },
    });

    console.log(`\n  Saved: ${outputLocation}`);
  }

  console.log(`\nDone! Videos saved to:\n  ${outputDir}/`);
}

/** Returns ISO week string like "2026-W13" */
function getWeekString(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor(
    (now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)
  );
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
