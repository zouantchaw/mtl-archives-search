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

const API_BASE =
  process.env.API_BASE || "https://mtl-archives-worker.wiel.workers.dev";

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

  return {
    imageUrl: photo.imageUrl,
    title: photo.name || "Photo historique de Montréal",
    date: photo.dateValue || data.date,
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
  let inputProps: { imageUrl: string; title: string; date: string };

  if (today) {
    inputProps = await fetchDailyGame();
  } else {
    inputProps = {
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      title: "Rue Sainte-Catherine, vue vers l'est",
      date: "vers 1930",
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
