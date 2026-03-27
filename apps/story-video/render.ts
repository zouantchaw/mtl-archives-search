/**
 * Programmatic render script for daily game story videos.
 *
 * Usage:
 *   npx tsx render.ts                          # render with default sample data
 *   npx tsx render.ts --today                   # fetch today's daily game and render
 *   npx tsx render.ts --today --out ./my.mp4    # custom output path
 */

import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { STORY_WIDTH, STORY_HEIGHT, FPS, TOTAL_DURATION } from "./src/lib/brand";
import { exifOrientationToDegrees } from "./src/lib/orientation";

const API_BASE =
  process.env.API_BASE || "https://mtl-archives-worker.wiel.workers.dev";

/**
 * Read the EXIF Orientation tag from a JPEG URL.
 * Parses just the first ~64KB to find the tag without downloading the full image.
 */
async function readExifOrientation(imageUrl: string): Promise<number> {
  try {
    const res = await fetch(imageUrl, {
      headers: { Range: "bytes=0-65535" },
    });
    const buf = Buffer.from(await res.arrayBuffer());

    // Quick EXIF parser — find orientation tag (0x0112) in TIFF IFD
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1; // not JPEG
    let offset = 2;
    while (offset < buf.length - 4) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === 0xe1) {
        // APP1 — likely EXIF
        const exifStart = offset + 4;
        if (
          buf.toString("ascii", exifStart, exifStart + 4) === "Exif" &&
          buf[exifStart + 4] === 0 &&
          buf[exifStart + 5] === 0
        ) {
          const tiffStart = exifStart + 6;
          const littleEndian = buf.toString("ascii", tiffStart, tiffStart + 2) === "II";
          const read16 = (pos: number) =>
            littleEndian
              ? buf.readUInt16LE(tiffStart + pos)
              : buf.readUInt16BE(tiffStart + pos);
          const ifdOffset = littleEndian
            ? buf.readUInt32LE(tiffStart + 4)
            : buf.readUInt32BE(tiffStart + 4);
          const entries = read16(ifdOffset);
          for (let i = 0; i < entries; i++) {
            const entryOffset = ifdOffset + 2 + i * 12;
            const tag = read16(entryOffset);
            if (tag === 0x0112) {
              // Orientation tag
              return read16(entryOffset + 8);
            }
          }
        }
        break;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  } catch {
    // If EXIF parsing fails, assume normal orientation
  }
  return 1;
}

type PhotoRecord = {
  metadataFilename: string;
  imageUrl: string;
  name: string;
  dateValue: string;
  latitude: number;
  longitude: number;
  description: string;
  credits: string;
  cote: string;
  rotationDegrees: number | null;
};

type DailyResponse = {
  date: string;
  daily: {
    photo: PhotoRecord;
    played: boolean;
    result: unknown;
  };
};

async function fetchDailyGame(): Promise<{
  imageUrl: string;
  title: string;
  date: string;
  rotation: number;
}> {
  console.log("Fetching today's daily game...");
  const res = await fetch(`${API_BASE}/api/game/daily`);
  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }
  const data: DailyResponse = await res.json();
  const photo = data.daily.photo;

  console.log(`  Photo: ${photo.name || photo.metadataFilename}`);
  console.log(`  Date: ${photo.dateValue}`);
  console.log(`  Image: ${photo.imageUrl}`);

  // Resolve rotation: prefer DB value, fall back to EXIF
  let rotation = photo.rotationDegrees || 0;
  if (!rotation) {
    const exif = await readExifOrientation(photo.imageUrl);
    rotation = exifOrientationToDegrees(exif);
    if (rotation) console.log(`  EXIF orientation: ${exif} → ${rotation}°`);
  }
  console.log(`  Rotation: ${rotation}°`);

  return {
    imageUrl: photo.imageUrl,
    title: photo.name || "Photo historique de Montréal",
    date: photo.dateValue || data.date,
    rotation,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const today = args.includes("--today");
  const outIdx = args.indexOf("--out");
  const out = outIdx !== -1 ? args[outIdx + 1] : undefined;
  return { today, out };
}

async function main() {
  const { today, out } = parseArgs();

  // Resolve props
  let inputProps: { imageUrl: string; title: string; date: string; rotation: number };

  if (today) {
    inputProps = await fetchDailyGame();
  } else {
    inputProps = {
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      title: "Rue Sainte-Catherine, vue vers l'est",
      date: "vers 1930",
      rotation: 0,
    };
    console.log("Using sample data. Pass --today to fetch the real daily game.");
  }

  // Output path
  const dateStr = new Date().toISOString().split("T")[0];
  const outputDir = path.join(
    process.env.HOME || "~",
    "Desktop",
    "mtl-game-stories"
  );
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputLocation =
    out || path.join(outputDir, `${dateStr}-daily-game-story.mp4`);

  console.log("\nBundling Remotion project...");
  const bundled = await bundle({
    entryPoint: path.resolve(__dirname, "src/index.ts"),
    // Silence webpack output
    onProgress: (progress) => {
      if (progress === 100) console.log("  Bundle complete.");
    },
  });

  console.log("Selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundled,
    id: "DailyGameStory",
    inputProps,
  });

  console.log(`Rendering ${STORY_WIDTH}x${STORY_HEIGHT} @ ${FPS}fps...`);
  console.log(`  Duration: ${TOTAL_DURATION} frames (${(TOTAL_DURATION / FPS).toFixed(1)}s)`);
  console.log(`  Output: ${outputLocation}`);

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

  console.log(`\n\nDone! Video saved to:\n  ${outputLocation}`);
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
