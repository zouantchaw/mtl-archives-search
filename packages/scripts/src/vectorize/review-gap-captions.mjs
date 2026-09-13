import fs from "node:fs";
import sharp from "sharp";
import { root } from "./repair-search.mjs";
const d = root + "/data/mtl_archives/reports/gap-repair-20260913";
const rows = JSON.parse(fs.readFileSync(d + "/targets-before.json")).filter(
  (r) => !r.vlm_caption,
);
const escape = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
for (let start = 0; start < rows.length; start += 16) {
  const layers = [];
  for (let i = 0; i < 16 && start + i < rows.length; i++) {
    const r = rows[start + i],
      p = d + "/images/" + r.metadata_filename + ".jpg";
    if (!fs.existsSync(p)) continue;
    const captionFile = d + "/caption-" + r.metadata_filename + ".json";
    const caption = fs.existsSync(captionFile)
      ? JSON.parse(fs.readFileSync(captionFile)).caption
      : "PENDING";
    const words = caption.split(" "),
      lines = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 54) {
        lines.push(line);
        line = w;
      } else line += " " + w;
    }
    lines.push(line);
    const label = `${start + i}: ${r.metadata_filename.replace("mtl_archives_metadata_", "")}`;
    layers.push({
      input: await sharp(p)
        .resize(400, 300, { fit: "contain", background: "white" })
        .toBuffer(),
      left: (i % 4) * 400,
      top: Math.floor(i / 4) * 460,
    });
    const svg = `<svg width="400" height="160"><rect width="400" height="160" fill="white"/><text font-size="16" x="5" y="20">${label}</text>${lines
      .slice(0, 7)
      .map(
        (l, j) =>
          `<text font-size="13" x="5" y="${42 + 16 * j}">${escape(l)}</text>`,
      )
      .join("")}</svg>`;
    layers.push({
      input: Buffer.from(svg),
      left: (i % 4) * 400,
      top: Math.floor(i / 4) * 460 + 300,
    });
  }
  await sharp({
    create: { width: 1600, height: 1840, channels: 3, background: "white" },
  })
    .composite(layers)
    .png()
    .toFile(`${d}/review-${start / 16}.png`);
}
fs.writeFileSync(
  d + "/review-order.json",
  JSON.stringify(rows.map((r) => r.metadata_filename)),
);
