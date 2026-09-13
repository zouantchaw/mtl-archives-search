/** Read-only D1 and Vectorize inventory. Env credentials are never written to artifacts. */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
const out = process.argv[2];
if (!out) throw Error("Usage: node collect.mjs PRIVATE_OUTPUT_DIR");
if (process.env.AUDIT_ENV_FILE)
  dotenv.config({ path: process.env.AUDIT_ENV_FILE, quiet: true });
const account =
    process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID,
  token =
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_AI_TOKEN ||
    process.env.CLOUDFLARE_AI_TOKEN;
if (!account || !token) throw Error("Cloudflare read credentials required");
fs.mkdirSync(out, { recursive: true });
async function request(route, body) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${route}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    },
  );
  const data = await r.json();
  if (!r.ok || !data.success) throw Error(`Read failed ${r.status} ${route}`);
  return data.result;
}
const records = [];
for (let offset = 0; ; offset += 500) {
  const data = await request(
    "/d1/database/5c847f8e-5f2a-4d5e-8a7d-fae70025c398/query",
    {
      sql: "SELECT * FROM manifest ORDER BY metadata_filename LIMIT 500 OFFSET ?",
      params: [offset],
    },
  );
  const batch = data[0].results;
  records.push(...batch);
  if (batch.length < 500) break;
}
fs.writeFileSync(
  path.join(out, "production-records.json"),
  JSON.stringify(records),
);
for (const [kind, index] of Object.entries({
  text: "mtl-archives-text-canonical-20260912",
  clip: "mtl-archives-clip-canonical-20260912",
})) {
  const ids = [];
  let cursor;
  do {
    const data = await request(
      `/vectorize/v2/indexes/${index}/list?count=1000${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    ids.push(...data.vectors.map((v) => v.id));
    cursor = data.isTruncated ? data.nextCursor : null;
  } while (cursor);
  fs.writeFileSync(path.join(out, kind + "-ids.json"), JSON.stringify(ids));
}
console.log("Read-only snapshot complete", records.length);
