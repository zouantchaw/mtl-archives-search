import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const out = process.argv[2];
if (!out) throw Error("Usage: node sample.mjs PRIVATE_OUTPUT_DIR");
const rows = JSON.parse(
  fs.readFileSync(path.join(out, "production-records.json")),
);
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const random = [...rows]
  .sort((a, b) =>
    hash("issue136-v1:" + a.metadata_filename).localeCompare(
      hash("issue136-v1:" + b.metadata_filename),
    ),
  )
  .slice(0, 24);
const targetIds = [
  0, 13, 31, 59, 67, 102, 104, 13693, 13695, 16177, 13004, 17336, 12557, 18526,
  11659, 16144, 17638, 18557, 18558, 12519, 12469, 12470, 12467, 16274,
];
const sample = [
  ...random.map((r) => ({ ...r, lane: "random" })),
  ...targetIds.map((id) => ({
    ...rows.find(
      (r) => r.metadata_filename === `mtl_archives_metadata_${id}.json`,
    ),
    lane: "targeted",
  })),
].map((r, i) => ({ ...r, audit_id: `A${String(i + 1).padStart(2, "0")}` }));
fs.mkdirSync(path.join(out, "images"), { recursive: true });
fs.writeFileSync(
  path.join(out, "sample.json"),
  JSON.stringify(sample, null, 2),
);
let next = 0;
const receipts = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < sample.length) {
      const r = sample[next++];
      const file = path.join(out, "images", r.audit_id + ".jpg");
      try {
        if (!fs.existsSync(file)) {
          const res = await fetch(
            "https://www.mtlarchives.com/api/research/image?id=" +
              encodeURIComponent(r.metadata_filename),
            { signal: AbortSignal.timeout(30000) },
          );
          if (!res.ok) throw Error(String(res.status));
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        }
        const b = fs.readFileSync(file);
        receipts.push({
          id: r.audit_id,
          record: r.metadata_filename,
          bytes: b.length,
          sha256: hash(b),
          status: "downloaded",
        });
      } catch (e) {
        receipts.push({ id: r.audit_id, status: "failed", error: e.message });
      }
    }
  }),
);
fs.writeFileSync(
  path.join(out, "image-receipts.json"),
  JSON.stringify(receipts, null, 2),
);
console.log(
  "images",
  receipts.length,
  "failed",
  receipts.filter((r) => r.status === "failed").length,
);
