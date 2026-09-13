/** Targeted, checkpointed asset/caption/CLIP backfill. Explicit phases only. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { api, sql, root, indexes, read as previous } from "./repair-search.mjs";
import { hash, buildSearchText, textVersion } from "./repair-lib.mjs";
const dir = path.join(root, "data/mtl_archives/reports/gap-repair-20260913");
fs.mkdirSync(path.join(dir, "images"), { recursive: true });
const save = (n, v) =>
  fs.writeFileSync(path.join(dir, n), JSON.stringify(v, null, 2));
const read = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
const publicRoot = `https://${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
const imagePath = (r) => path.join(dir, "images", r.metadata_filename + ".jpg");
const targets = read("targets-before.json");
const all = previous("canonical.json");
const clipIds = previous("clip-missing.json");
const extra = fs.existsSync(path.join(dir, "r2-missing-audit.json"))
  ? read("r2-missing-audit.json")
  : [];
const rows = [
  ...new Map(
    [
      ...targets,
      ...extra,
      ...all.filter((r) => clipIds.includes(r.metadata_filename)),
    ].map((r) => [r.metadata_filename, r]),
  ).values(),
];
const model = "@cf/llava-hf/llava-1.5-7b-hf";
async function assets() {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });
  const assetRows = process.env.GAP_ASSETS === "extra" ? extra : rows;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < assetRows.length) {
        const r = assetRows[cursor++],
          id = r.metadata_filename,
          checkpoint = `asset-${id}.json`;
        if (fs.existsSync(path.join(dir, checkpoint))) continue;
        try {
          const key = r.resolved_image_filename || r.image_filename,
            url = `${publicRoot}/${encodeURIComponent(key)}`;
          const head = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(60000),
          });
          if (!head.ok && head.status !== 404)
            throw Error("R2 HEAD " + head.status);
          const missing = head.status === 404;
          const source = missing
            ? r.external_url.replace(/^http:/, "https:")
            : url;
          const tmp = imagePath(r) + ".original";
          const result = await new Promise((resolve) => {
            const child = spawn("curl", [
              "--fail",
              "--location",
              "--retry",
              "3",
              "--max-time",
              "240",
              "--silent",
              "--show-error",
              new URL(source).href,
              "-o",
              tmp,
            ]);
            let stderr = "";
            child.stderr.on("data", (b) => (stderr += b));
            child.on("close", (status) => resolve({ status, stderr }));
          });
          if (result.status !== 0) throw Error(result.stderr);
          const metadata = await sharp(tmp, {
            limitInputPixels: false,
          }).metadata();
          if (!metadata.width || !metadata.height) throw Error("Invalid image");
          const original =
            missing && metadata.format !== "jpeg"
              ? await sharp(tmp, { limitInputPixels: false })
                  .jpeg({ quality: 95 })
                  .toBuffer()
              : fs.readFileSync(tmp);
          const digest = hash(original);
          await sharp(tmp, { limitInputPixels: false })
            .resize({
              width: 1024,
              height: 1024,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 85 })
            .toFile(imagePath(r));
          if (missing) {
            await s3.send(
              new PutObjectCommand({
                Bucket: process.env.CLOUDFLARE_R2_BUCKET,
                Key: key,
                Body: original,
                ContentType: "image/jpeg",
                IfNoneMatch: "*",
                Metadata: {
                  "object-sha256": digest,
                  "repair-date": "2026-09-13",
                },
              }),
            );
          }
          save(checkpoint, {
            id,
            key,
            source,
            restored: missing,
            bytes: original.length,
            sha256: digest,
            sourceFormat: metadata.format,
            convertedToJpeg: missing && metadata.format !== "jpeg",
            width: metadata.width,
            height: metadata.height,
            derivativeSha256: hash(fs.readFileSync(imagePath(r))),
            at: new Date().toISOString(),
          });
          fs.unlinkSync(tmp);
          console.log("asset", id, missing ? "restored" : "downloaded");
        } catch (e) {
          console.error("asset failed", id, e.message);
          save(`asset-error-${id}.json`, { id, error: e.message });
        }
      }
    }),
  );
}
async function captions() {
  const queue = targets.filter((r) => !r.vlm_caption);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < queue.length) {
        const r = queue[cursor++];
        const name = `caption-${r.metadata_filename}.json`;
        if (fs.existsSync(path.join(dir, name))) continue;
        if (!fs.existsSync(imagePath(r))) {
          console.log("no asset", r.metadata_filename);
          continue;
        }
        try {
          const result = await api(`/ai/run/${model}`, {
            image: [...fs.readFileSync(imagePath(r))],
            prompt:
              "Describe only what is visibly present in this archival image in two concise sentences. Identify major objects and their spatial relationships. Do not infer dates, locations, identities, occupations, historical events, or emotions. If this is a map or document, describe it as such. Do not invent details that are unclear.",
            max_tokens: 160,
          });
          const caption = (result.description || result.response || "").trim();
          if (caption.length < 20)
            throw Error(
              "Empty or very short caption " + JSON.stringify(result),
            );
          save(name, {
            id: r.metadata_filename,
            caption,
            model,
            status: "unreviewed",
            source: `gap-repair-20260913#${r.metadata_filename}`,
            imageSha256: hash(fs.readFileSync(imagePath(r))),
            at: new Date().toISOString(),
          });
          console.log("caption", r.metadata_filename, caption);
        } catch (e) {
          console.error("caption failed", r.metadata_filename, e.message);
        }
      }
    }),
  );
}
async function clip() {
  const { CLIPVisionModelWithProjection, AutoProcessor, RawImage, env } =
    await import("@xenova/transformers");
  env.cacheDir = path.join(dir, "model-cache");
  const name = "Xenova/clip-vit-base-patch32";
  const vision = await CLIPVisionModelWithProjection.from_pretrained(name, {
    quantized: false,
  });
  const processor = await AutoProcessor.from_pretrained(name);
  for (const id of [
    ...new Set([
      "mtl_archives_metadata_0.json",
      "mtl_archives_metadata_10.json",
      "mtl_archives_metadata_153.json",
      ...clipIds,
    ]),
  ]) {
    const output = `clip-${id}.json`;
    if (fs.existsSync(path.join(dir, output))) continue;
    const r = rows.find((r) => r.metadata_filename === id);
    if (!fs.existsSync(imagePath(r))) continue;
    const image = await RawImage.read(imagePath(r));
    const inputs = await processor(image);
    const result = await vision(inputs);
    const values = Array.from(result.image_embeds.data);
    const norm = Math.hypot(...values);
    if (values.length !== 512 || !Number.isFinite(norm) || norm === 0)
      throw Error("Invalid CLIP vector");
    save(output, {
      id,
      values: values.map((v) => v / norm),
      metadata: {
        image: r.resolved_image_filename || r.image_filename,
        sourceId: id,
        version: textVersion,
        model: name,
        preprocessing: "1024px-jpeg-then-clip-processor",
      },
    });
    console.log("clip", id);
  }
}

async function prepare() {
  const order = read("review-order.json"),
    corrections = read("caption-corrections.json"),
    reviewed = new Set(read("reviewed-captions.json"));
  const changes = [];
  for (const r of targets.filter((r) => !r.vlm_caption)) {
    if (!reviewed.has(r.metadata_filename))
      throw Error("Caption requires visual review: " + r.metadata_filename);
    const c = read(`caption-${r.metadata_filename}.json`),
      override = corrections[String(order.indexOf(r.metadata_filename))];
    const asset = read(`asset-${r.metadata_filename}.json`);
    if (c.imageSha256 !== asset.derivativeSha256)
      throw Error("Caption asset mismatch");
    const caption = override || c.caption;
    changes.push({
      ...r,
      vlm_caption: caption,
      vlm_caption_model: override
        ? c.model + ";codex-visual-revision"
        : c.model,
      vlm_caption_source: c.source + ";codex-visual-review",
      vlm_caption_status: "unreviewed",
      revision: override ? "corrected-after-visual-review" : "visually-checked",
    });
  }
  const vectors = [];
  for (let i = 0; i < changes.length; i += 24) {
    const batch = changes.slice(i, i + 24),
      texts = batch.map(buildSearchText);
    const n = `text-batch-${hash(JSON.stringify(texts)).slice(0, 16)}.json`;
    let result;
    if (fs.existsSync(path.join(dir, n))) result = read(n);
    else {
      result = (await api("/ai/run/@cf/baai/bge-m3", { text: texts })).data;
      save(n, result);
    }
    if (
      result.length !== batch.length ||
      result.some((v) => v.length !== 1024 || !v.every(Number.isFinite))
    )
      throw Error("Invalid text vectors");
    vectors.push(
      ...batch.map((r, j) => ({
        id: r.metadata_filename,
        values: result[j],
        metadata: {
          textHash: hash(texts[j]),
          version: textVersion,
          model: "@cf/baai/bge-m3",
        },
      })),
    );
  }
  const clip = clipIds.map((id) => read(`clip-${id}.json`));
  for (const v of clip)
    if (
      v.values.length !== 512 ||
      v.values.some((x) => !Number.isFinite(x)) ||
      Math.abs(Math.hypot(...v.values) - 1) > 1e-5
    )
      throw Error("Invalid clip vector");
  if (changes.length !== 184 || clip.length !== 40)
    throw Error("Incomplete repair plan");
  save("caption-changes.json", changes);
  save("text-vectors.json", vectors);
  save("clip-vectors.json", clip);
  console.log(
    "Prepared",
    changes.length,
    "captions",
    clip.length,
    "CLIP vectors",
  );
}
async function publish() {
  const changes = read("caption-changes.json");
  // Refuse stale plans; only fill the exact empty captions captured before the repair.
  for (const r of changes) {
    const current = (
      await sql("SELECT * FROM manifest WHERE metadata_filename=?", [
        r.metadata_filename,
      ])
    )[0].results[0];
    if (current.vlm_caption && current.vlm_caption !== r.vlm_caption)
      throw Error("Concurrent caption edit: " + r.metadata_filename);
    for (const key of [
      "name",
      "description",
      "external_url",
      "resolved_image_filename",
      "date_value",
      "cote",
    ])
      if (current[key] !== r[key])
        throw Error("Stale canonical record: " + r.metadata_filename);
  }
  for (const kind of ["text", "clip"]) {
    const vectors = read(`${kind}-vectors.json`);
    const backup = [];
    for (let i = 0; i < vectors.length; i += 20)
      backup.push(
        ...(await api(`/vectorize/v2/indexes/${indexes[kind]}/get_by_ids`, {
          ids: vectors.slice(i, i + 20).map((v) => v.id),
        })),
      );
    if (!fs.existsSync(path.join(dir, `${kind}-before.json`)))
      save(`${kind}-before.json`, backup);
    for (let i = 0; i < vectors.length; i += 50) {
      const payload =
        vectors
          .slice(i, i + 50)
          .map(JSON.stringify)
          .join("\n") + "\n";
      const n = `mutation-${kind}-${hash(payload).slice(0, 12)}.json`;
      if (!fs.existsSync(path.join(dir, n)))
        save(
          n,
          await api(
            `/vectorize/v2/indexes/${indexes[kind]}/upsert`,
            payload,
            "POST",
            true,
          ),
        );
    }
  }
  for (const r of changes)
    await sql(
      "UPDATE manifest SET vlm_caption=?,vlm_caption_source=?,vlm_caption_model=?,vlm_caption_status=? WHERE metadata_filename=? AND (vlm_caption IS NULL OR vlm_caption='')",
      [
        r.vlm_caption,
        r.vlm_caption_source,
        r.vlm_caption_model,
        r.vlm_caption_status,
        r.metadata_filename,
      ],
    );
  for (const n of fs
    .readdirSync(dir)
    .filter((n) => /^asset-mtl.*\.json$/.test(n))) {
    const a = read(n);
    if (a.restored)
      await sql(
        "UPDATE manifest SET image_size_bytes=? WHERE metadata_filename=? AND resolved_image_filename=?",
        [a.bytes, a.id, a.key],
      );
  }
  const assetMap = new Map(
    fs
      .readdirSync(dir)
      .filter((n) => /^asset-mtl.*\.json$/.test(n))
      .map((n) => read(n))
      .filter((a) => a.restored)
      .map((a) => [a.id, a]),
  );
  const byId = new Map(changes.map((r) => [r.metadata_filename, r]));
  const canonical = all.map((r) => {
    const updated = byId.get(r.metadata_filename);
    if (assetMap.has(r.metadata_filename))
      r = { ...r, image_size_bytes: assetMap.get(r.metadata_filename).bytes };
    return updated
      ? {
          ...r,
          ...updated,
          image_size_bytes: r.image_size_bytes,
          caption_source: updated.vlm_caption_source,
          caption_model: updated.vlm_caption_model,
          caption_status: updated.vlm_caption_status,
        }
      : r;
  });
  fs.writeFileSync(
    path.join(root, "data/mtl_archives/manifest_search_canonical.jsonl"),
    canonical.map(JSON.stringify).join("\n") + "\n",
  );
  save("published.json", {
    at: new Date().toISOString(),
    captions: changes.length,
    clip: clipIds.length,
  });
  console.log("Published");
}
async function verify() {
  const result = {};
  for (const kind of ["text", "clip"]) {
    const wanted = read(`${kind}-vectors.json`);
    let verified = 0;
    for (let i = 0; i < wanted.length; i += 20) {
      const batch = wanted.slice(i, i + 20),
        stored = await api(
          `/vectorize/v2/indexes/${indexes[kind]}/get_by_ids`,
          { ids: batch.map((v) => v.id) },
        );
      for (const v of batch) {
        const found = stored.find((x) => x.id === v.id);
        if (
          !found ||
          found.values.length !== v.values.length ||
          v.values.some((x, j) => Math.abs(x - found.values[j]) > 1e-5)
        )
          throw Error("Stored vector mismatch: " + v.id);
        if (kind === "text" && found.metadata.textHash !== v.metadata.textHash)
          throw Error("Text hash mismatch");
        verified++;
      }
    }
    result[kind] = {
      verified,
      info: await api(`/vectorize/v2/indexes/${indexes[kind]}/info`),
    };
  }
  const counts = (
    await sql(
      "SELECT COUNT(*) records,SUM(vlm_caption IS NOT NULL AND vlm_caption!='') captions FROM manifest",
    )
  )[0].results[0];
  for (const r of read("caption-changes.json")) {
    const found = (
      await sql(
        "SELECT vlm_caption,vlm_caption_source,vlm_caption_model,vlm_caption_status FROM manifest WHERE metadata_filename=?",
        [r.metadata_filename],
      )
    )[0].results[0];
    for (const k of Object.keys(found))
      if (found[k] !== r[k]) throw Error("D1 caption mismatch");
  }
  result.d1 = counts;
  save("verification.json", result);
  console.log(result);
}

const action = { assets, captions, clip, prepare, publish, verify }[
  process.argv[2]
];
if (!action) throw Error("Choose assets|captions|clip|prepare|publish|verify");
await action();
