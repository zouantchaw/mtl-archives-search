import fs from "node:fs";
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { sql, root, read as previous } from "./repair-search.mjs";
const d = root + "/data/mtl_archives/reports/gap-repair-20260913";
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});
let token,
  objects = new Map();
do {
  const r = await s3.send(
    new ListObjectsV2Command({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET,
      ContinuationToken: token,
    }),
  );
  for (const o of r.Contents || []) objects.set(o.Key, o.Size);
  token = r.NextContinuationToken;
} while (token);
const canonical = previous("canonical.json");
const missing = canonical
  .filter((r) => !objects.has(r.resolved_image_filename || r.image_filename))
  .map((r) => r.metadata_filename);
const restored = fs
  .readdirSync(d)
  .filter((n) => /^asset-mtl.*\.json$/.test(n))
  .map((n) => JSON.parse(fs.readFileSync(`${d}/${n}`)))
  .filter((a) => a.restored);
const checks = [];
for (const a of restored) {
  const h = await s3.send(
    new HeadObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET,
      Key: a.key,
    }),
  );
  const p = await fetch(
    `https://${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${encodeURIComponent(a.key)}?repair=20260913`,
    { method: "HEAD", signal: AbortSignal.timeout(60000) },
  );
  if (
    h.ContentLength !== a.bytes ||
    (h.Metadata["object-sha256"] || h.Metadata["source-sha256"]) !== a.sha256 ||
    !p.ok
  )
    throw Error("Restored asset verification failed " + a.id);
  checks.push({
    id: a.id,
    bytes: h.ContentLength,
    http: p.status,
    sha256: a.sha256,
  });
}
const live = [];
for (let offset = 0; ; offset += 500) {
  const batch = (
    await sql(
      "SELECT * FROM manifest ORDER BY metadata_filename LIMIT 500 OFFSET ?",
      [offset],
    )
  )[0].results;
  live.push(...batch);
  if (batch.length < 500) break;
}
const old = new Map(canonical.map((r) => [r.metadata_filename, r]));
const changed = [];
for (const r of live) {
  const b = old.get(r.metadata_filename);
  if (!b) {
    changed.push(r.metadata_filename);
    continue;
  }
  for (const k of [
    "name",
    "description",
    "date_value",
    "cote",
    "external_url",
    "resolved_image_filename",
    "image_filename",
    "latitude",
    "longitude",
  ])
    if (r[k] !== b[k]) changed.push({ id: r.metadata_filename, field: k });
}
const report = {
  at: new Date().toISOString(),
  canonicalRecords: canonical.length,
  objects: objects.size,
  missing,
  restored: checks,
  archivalFieldsChanged: changed,
};
fs.writeFileSync(
  d + "/asset-verification.json",
  JSON.stringify(report, null, 2),
);
fs.writeFileSync(d + "/manifest-after.json", JSON.stringify(live));
console.log({
  records: canonical.length,
  missing: missing.length,
  restored: checks.length,
  archivalFieldsChanged: changed.length,
});
if (missing.length || changed.length) process.exitCode = 1;
