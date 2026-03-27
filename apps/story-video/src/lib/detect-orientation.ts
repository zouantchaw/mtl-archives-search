/**
 * Detect and fix image orientation for Remotion renders.
 *
 * Problem: archive scans have unreliable EXIF Orientation tags, and
 * Remotion's Chromium ignores `image-orientation: none`. So EXIF
 * rotation gets applied to images that shouldn't be rotated.
 *
 * Solution: strip EXIF from the JPEG before rendering, then ask
 * Gemini to detect if the raw pixels need rotation.
 *
 * Requires GEMINI_API_KEY in the environment.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { coerceRotation, type ImageRotation } from "./orientation";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const MODEL = "gemini-2.0-flash";

/**
 * Download the image, strip EXIF metadata, and save into the Remotion
 * `public/` folder so it can be loaded via `staticFile()`.
 *
 * Returns the staticFile key (e.g. "cached/image.jpg").
 */
export async function stripExifAndCache(
  imageUrl: string,
  publicDir: string
): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const original = Buffer.from(await res.arrayBuffer());

  const stripped = stripExifFromJpeg(original);

  const cacheDir = path.join(publicDir, "cached");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const filename = imageUrl.split("/").pop() || "image.jpg";
  fs.writeFileSync(path.join(cacheDir, filename), stripped);

  // Return the key for staticFile()
  return `cached/${filename}`;
}

/**
 * Remove EXIF (APP1) segment from a JPEG buffer.
 * This ensures the browser can't apply EXIF orientation.
 */
function stripExifFromJpeg(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf; // not JPEG

  const chunks: Buffer[] = [buf.subarray(0, 2)]; // SOI marker
  let offset = 2;

  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];

    // SOS (Start of Scan) — everything after is image data
    if (marker === 0xda) {
      chunks.push(buf.subarray(offset));
      break;
    }

    const segLen = buf.readUInt16BE(offset + 2);

    // Skip APP1 (EXIF) segments
    if (marker === 0xe1) {
      offset += 2 + segLen;
      continue;
    }

    // Keep all other segments
    chunks.push(buf.subarray(offset, offset + 2 + segLen));
    offset += 2 + segLen;
  }

  return Buffer.concat(chunks);
}

/**
 * Ask Gemini to look at the image and determine if it needs rotation.
 * The image should already be EXIF-stripped so Gemini sees raw pixels.
 * Returns 0, 90, 180, or 270 degrees clockwise.
 */
export async function detectOrientation(
  imageUrl: string
): Promise<ImageRotation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      "  GEMINI_API_KEY not set — skipping orientation detection"
    );
    return 0;
  }

  // Fetch the raw image bytes for Gemini (keeping EXIF here is fine —
  // Gemini auto-corrects orientation, and if the EXIF is wrong,
  // Gemini will still see the visual content and judge correctly)
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // Strip EXIF so Gemini sees the same raw pixels that Remotion will
  // render (after our EXIF stripping)
  const stripped = stripExifFromJpeg(buf);
  const base64 = stripped.toString("base64");

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64,
            },
          },
          {
            text: `Look at this historical photograph. Is it displayed in the correct orientation (right-side up)?

If the image is already correctly oriented (right-side up), respond with exactly: 0
If the image needs to be rotated 90° clockwise to be right-side up, respond with exactly: 90
If the image is upside down and needs 180° rotation, respond with exactly: 180
If the image needs to be rotated 270° clockwise (90° counter-clockwise), respond with exactly: 270

Look for clues like: text/signs should be readable, buildings should stand upright, sky/clouds should be at the top, water should pool at the bottom, people should be standing upright, trees should grow upward.

Respond with ONLY the number (0, 90, 180, or 270), nothing else.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 10,
    },
  };

  const url = `${GEMINI_URL.replace("{model}", MODEL)}?key=${apiKey}`;
  const apiRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!apiRes.ok) {
    const text = await apiRes.text();
    console.warn(
      `  Gemini orientation check failed (${apiRes.status}): ${text.slice(0, 200)}`
    );
    return 0;
  }

  const data = await apiRes.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p: { text?: string }) => p.text || "")
    .join("")
    .trim();

  const degrees = parseInt(text, 10);
  return coerceRotation(degrees);
}
