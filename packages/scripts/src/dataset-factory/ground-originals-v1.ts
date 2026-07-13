import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import sharp from "sharp";
import Ajv2020Import from "ajv/dist/2020.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../../../");
export const FIXTURE = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/ground-originals-v1",
);
export const DATA = path.join(
  ROOT,
  "data/mtl_archives/reports/ground-originals-v1",
);
export const ORIGINALS = path.join(DATA, "originals");
export const ARCHIVE = path.join(DATA, "ground-originals-v1.tar.gz");
export const PUBLICATION_RECEIPT_INPUT = path.join(
  ROOT,
  "docs/dataset-factory/ground-originals-v1-publication-receipt-input.json",
);
export const PUBLICATION_RECEIPT_SEAL = path.join(
  ROOT,
  "docs/dataset-factory/ground-originals-v1-publication-receipt-seal.json",
);
export const INDEPENDENT_REVIEW_DECISIONS = path.join(
  DATA,
  "independent-review-decisions-v1.json",
);
export const INDEPENDENT_REVIEW_DECISIONS_SEAL = path.join(
  DATA,
  "independent-review-decisions-seal-v1.json",
);
const TRACKED_REVIEW_DECISIONS = path.join(
    FIXTURE,
    "independent-review-decisions-v1.json",
  ),
  TRACKED_REVIEW_DECISIONS_SEAL = path.join(
    FIXTURE,
    "independent-review-decisions-seal-v1.json",
  ),
  TRACKED_REVIEW_TRANSCRIPTIONS = path.join(
    FIXTURE,
    "reviewed-visual-transcriptions-v1.json",
  ),
  TRACKED_REVIEW_METRICS = path.join(
    FIXTURE,
    "independent-review-metrics-v1.json",
  ),
  TRACKED_REVIEW_MANIFEST = path.join(
    FIXTURE,
    "independent-review-publication-manifest-v1.json",
  );
const PUBLICATION_RECEIPT_INPUT_SCHEMA = path.join(
  ROOT,
  "docs/dataset-factory/schemas/ground-originals-v1/publication-receipt-input.schema.v1.json",
);
const PUBLICATION_RECEIPT_SEAL_SCHEMA = path.join(
  ROOT,
  "docs/dataset-factory/schemas/ground-originals-v1/publication-receipt-seal.schema.v1.json",
);
const INDEPENDENT_REVIEW_INPUT = path.join(
    FIXTURE,
    "independent-review-input-v1.json",
  ),
  INDEPENDENT_REVIEW_INPUT_SCHEMA = path.join(
    ROOT,
    "docs/dataset-factory/schemas/ground-originals-v1/review.schema.v1.json",
  ),
  INDEPENDENT_REVIEW_DECISION_SCHEMA = path.join(
    ROOT,
    "docs/dataset-factory/schemas/ground-originals-v1/review-decision.schema.v1.json",
  ),
  INDEPENDENT_REVIEW_DECISION_SEAL_SCHEMA = path.join(
    ROOT,
    "docs/dataset-factory/schemas/ground-originals-v1/review-decision-seal.schema.v1.json",
  );
export const SCHEMA = "ground_originals_v1.0.0";
export const IDS = [0, 10, 100, 101, 102, 105] as const;
export const MAX_FILE = 2 * 1024 * 1024,
  MAX_TOTAL = 8 * 1024 * 1024,
  MAX_RASTER = 256 * 1024,
  MAX_RASTERS = 2 * 1024 * 1024,
  MAX_FIXTURE = 3 * 1024 * 1024;
export const PREDECESSORS = {
  source_acquisition: {
    path: "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/descriptor-v1.json",
    sha256: "4a091067c919c465c9c8940aa1dd5acc6f46e740f6ad6416acdfff101f63de10",
  },
  intelligence: {
    path: "docs/dataset-factory/fixtures/real-pilot-intelligence-v1/descriptor-v1.json",
    sha256: "178ceef735838c85c800c5c57f0b69808c4ba23157bbad00187a02d93f7ab137",
  },
  selection: {
    path: "docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-selection-v1.json",
    sha256: "7c3729108057b374f2a108d0e3f556abcbec402d071b89268269c71340f9b96f",
  },
  promotion: {
    path: "docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-visual-promotion-v1.json",
    sha256: "8fe075ab8770891662b3b78045ea77d179455af893fdef5f68a28b4e6f2f075a",
  },
  independent_review: {
    path: "docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-independent-visual-review-v1.json",
    sha256: "e614092da109c9fc90802dafae1b62741669aa748323bb43b98c2ad6235513e7",
  },
} as const;
export const SOURCES = [
  {
    id: 0,
    cote: "VM94,SY,SS1,SSS17,D1",
    url: "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z2.jpg",
    file: "0.jpg",
    prefix: "0c3e665bded95be15fd2bbab773475c525964ac183e00e9b7a76971fbc2f7c4b",
  },
  {
    id: 10,
    cote: "VM94,SY,SS1,SSS17,D12",
    url: "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z13-1.jpg",
    file: "10.jpg",
    prefix: "af57af9c043292000722072088ae794522191def3c842504004505095a06c2de",
  },
  {
    id: 100,
    cote: "VM94,SY,SS1,SSS17,D180,P3",
    url: "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z181-3.jpg",
    file: "100.jpg",
    prefix: "ecce31bee1b8b5e87ae73fb878f64fecbaed9a8a43b2d38451cc5f1c028c0d45",
  },
  {
    id: 101,
    cote: "VM94,SY,SS1,SSS17,D180,P4",
    url: "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z181-4.jpg",
    file: "101.jpg",
    prefix: "6b3087cd899d4906935dbaeebc817493b983d4fc865d98565b6c5f8eb5239c63",
  },
  {
    id: 102,
    cote: "VM94,SY,SS1,SSS17,D180,P5",
    url: "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z181-5.jpg",
    file: "102.jpg",
    prefix: "6909f2773c0db6660e725fd948b2516302975e819d839f14d17020beaa1e4045",
  },
  {
    id: 105,
    cote: "VM94,SY,SS1,SSS17,D183,P14",
    url: "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z184-14.jpg",
    file: "105.jpg",
    prefix: "46c4601256ee149657e5e24e2b1e48469f6f21f9390cb922b528ef834b29f94c",
  },
] as const;
const metadataSeed = (literal: string, field: "Titre" | "Description") => ({
  literal,
  source_kind: "archive_metadata_report",
  source_locator: `real-pilot-intelligence-v1/dossiers/{id}.json#claims.archive_metadata_report[field=${field}]`,
});
const coteSeed = (literal: string) => ({
  literal,
  source_kind: "official_cote",
  source_locator: "records-v1.json#records[id={id}].cote",
});
const RESEARCH_CANDIDATES: Record<
  number,
  {
    query_seeds: any[];
    authority_classes: string[];
    rejected_hypotheses: any[];
  }
> = {
  0: {
    query_seeds: [
      coteSeed("VM94,SY,SS1,SSS17,D1"),
      metadataSeed("Rue Saint-Antoine", "Titre"),
      metadataSeed("rue Saint-David", "Description"),
      metadataSeed("The Gazette Printing Co", "Description"),
      metadataSeed("Magic Baking Powder", "Description"),
      metadataSeed("JJ Joubert Limitée", "Description"),
    ],
    authority_classes: [
      "municipal_archive_catalogue",
      "municipal_street_history",
      "library_archive_catalogue",
      "contemporary_directory_or_newspaper_archive",
    ],
    rejected_hypotheses: [],
  },
  10: {
    query_seeds: [
      coteSeed("VM94,SY,SS1,SSS17,D12"),
      metadataSeed("Boulevard Saint-Laurent", "Titre"),
      metadataSeed("avenue des Pins", "Titre"),
      metadataSeed("rue de l'Hôtel-Dieu", "Description"),
      metadataSeed("Melachrino", "Description"),
      metadataSeed("Institut Sténographique Perreault", "Description"),
      metadataSeed("salon de barbier Rex", "Description"),
    ],
    authority_classes: [
      "municipal_archive_catalogue",
      "municipal_street_history",
      "library_archive_catalogue",
      "contemporary_directory_or_newspaper_archive",
    ],
    rejected_hypotheses: [],
  },
  100: {
    query_seeds: [
      coteSeed("VM94,SY,SS1,SSS17,D180,P3"),
      metadataSeed("Hôtel Laurentien", "Titre"),
      metadataSeed("rues Peel et Dorchester", "Titre"),
      metadataSeed("boulevard René-Lévesque", "Titre"),
    ],
    authority_classes: [
      "municipal_archive_catalogue",
      "municipal_street_history",
      "official_building_or_institution_history",
      "library_archive_catalogue",
    ],
    rejected_hypotheses: [],
  },
  101: {
    query_seeds: [
      coteSeed("VM94,SY,SS1,SSS17,D180,P4"),
      metadataSeed("Rue Osborne", "Titre"),
      metadataSeed("rue de Lagauchetière", "Titre"),
      metadataSeed("rue Stanley", "Description"),
      metadataSeed("gare Windsor", "Description"),
      metadataSeed("Majestic Rooms", "Description"),
      metadataSeed("épicerie Osborne", "Description"),
      metadataSeed("Laphkas Bowling Academy", "Description"),
    ],
    authority_classes: [
      "municipal_archive_catalogue",
      "municipal_street_history",
      "official_building_or_institution_history",
      "library_archive_catalogue",
      "contemporary_directory_or_newspaper_archive",
    ],
    rejected_hypotheses: [],
  },
  102: {
    query_seeds: [
      coteSeed("VM94,SY,SS1,SSS17,D180,P5"),
      metadataSeed("Église Saint-Georges", "Titre"),
      metadataSeed("1086, rue Osborne", "Titre"),
      metadataSeed("rue de Lagauchetière", "Titre"),
    ],
    authority_classes: [
      "municipal_archive_catalogue",
      "municipal_street_history",
      "official_building_or_institution_history",
      "library_archive_catalogue",
    ],
    rejected_hypotheses: [],
  },
  105: {
    query_seeds: [
      coteSeed("VM94,SY,SS1,SSS17,D183,P14"),
      metadataSeed("Garage Tilden Drive Yourself", "Titre"),
      metadataSeed("Hertz Dri-Ur-Self System", "Titre"),
      metadataSeed("Dorchester Ouest", "Titre"),
      metadataSeed("rue Peel", "Titre"),
      metadataSeed("White Rose Gasoline", "Description"),
      metadataSeed("Catelli Egg Noodles", "Description"),
      metadataSeed("Claude Neon", "Description"),
      {
        literal: "CATELLI",
        source_kind: "full_resolution_visible_text",
        source_locator: "originals/105.jpg#region=ocr-2",
      },
      {
        literal: "EGG NOODLES",
        source_kind: "full_resolution_visible_text",
        source_locator: "originals/105.jpg#region=ocr-2",
      },
    ],
    authority_classes: [
      "municipal_archive_catalogue",
      "municipal_street_history",
      "official_business_or_institution_history",
      "library_archive_catalogue",
      "contemporary_directory_or_newspaper_archive",
    ],
    rejected_hypotheses: [
      {
        literal: "CASTROL",
        status: "rejected_false_precision_hypothesis",
        source_kind: "prior_256px_visual_reading",
        source_locator:
          "real-pilot-intelligence-v1/dossiers/105.json#region=ocr-2",
        reason:
          "Full-resolution visual QA reads CATELLI / EGG NOODLES; CASTROL is retained only as a false-precision example and is not an accepted transcription or identity.",
      },
    ],
  },
};
function researchCandidates() {
  return IDS.map((id) => ({
    numeric_id: id,
    ...RESEARCH_CANDIDATES[id],
    query_seeds: RESEARCH_CANDIDATES[id].query_seeds.map((seed) => ({
      ...seed,
      source_locator: seed.source_locator.replace("{id}", String(id)),
    })),
    rejected_hypotheses: RESEARCH_CANDIDATES[id].rejected_hypotheses.map(
      (row) => ({ ...row }),
    ),
    status: "pending",
    candidate_urls: null,
    claims: [],
  }));
}
export const sha256 = (b: string | Buffer) =>
  crypto.createHash("sha256").update(b).digest("hex");
const sort = (v: any): any =>
  Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, sort(x)]),
        )
      : v;
export const json = (v: unknown) => JSON.stringify(sort(v));
const read = (p: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const write = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, json(v) + "\n");
};
const files = (root: string, dir = root): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => {
          assert(
            !e.isSymbolicLink(),
            `fixture symlink forbidden: ${path.join(dir, e.name)}`,
          );
          return e.isDirectory()
            ? files(root, path.join(dir, e.name))
            : [
                path
                  .relative(root, path.join(dir, e.name))
                  .split(path.sep)
                  .join("/"),
              ];
        })
        .sort()
    : [];
const members = (root: string, exclude: string[] = []) =>
  files(root)
    .filter((x) => !exclude.includes(x))
    .map((p) => {
      const b = fs.readFileSync(path.join(root, p));
      return { path: p, bytes: b.length, sha256: sha256(b) };
    });
const tree = (m: Array<{ path: string; bytes: number; sha256: string }>) =>
  sha256(m.map((x) => `${x.path}\t${x.sha256}\t${x.bytes}`).join("\n") + "\n");
function assert(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}
export function safeUrl(raw: string) {
  const u = new URL(raw);
  assert(u.protocol === "https:", "URL protocol");
  assert(u.hostname === "depot.ville.montreal.qc.ca", "URL host");
  assert(
    !u.username && !u.password && !u.search && !u.hash,
    "URL credentials/query/fragment",
  );
  assert(
    SOURCES.some((s) => s.url === u.toString()),
    "URL not exact allowlist",
  );
  return u;
}
async function body(res: Response, max: number) {
  assert(res.body, "missing body");
  const chunks: Buffer[] = [];
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const x = await reader.read();
    if (x.done) break;
    n += x.value.byteLength;
    assert(n <= max, "body exceeds per-file cap");
    chunks.push(Buffer.from(x.value));
  }
  return Buffer.concat(chunks);
}
async function request(url: string, method: "HEAD" | "GET") {
  safeUrl(url);
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: { "User-Agent": "MTL-Archives-ground-originals-v1/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  assert(!(res.status >= 300 && res.status < 400), "redirect forbidden");
  assert(res.status === 200, `${method} status ${res.status}`);
  assert(
    (res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase() === "image/jpeg",
    "MIME must be image/jpeg",
  );
  return res;
}
export async function inspectJpeg(bytes: Buffer) {
  assert(bytes.length >= 4096, "JPEG too short");
  assert(bytes[0] === 0xff && bytes[1] === 0xd8, "JPEG SOI");
  assert(bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9, "JPEG EOI");
  const meta = await sharp(bytes, { failOn: "error" }).metadata();
  assert(
    meta.format === "jpeg" && meta.width && meta.height && meta.channels,
    "sharp JPEG decode",
  );
  const normalized = await sharp(bytes, { failOn: "error" })
    .rotate()
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    channels: meta.channels,
    orientation: meta.orientation ?? null,
    normalized_width: normalized.info.width,
    normalized_height: normalized.info.height,
    normalized_channels: normalized.info.channels,
    pixel_sha256: sha256(normalized.data),
  };
}
export async function acquire() {
  fs.mkdirSync(ORIGINALS, { recursive: true });
  const rows = [];
  let total = 0;
  for (const s of SOURCES) {
    const head = await request(s.url, "HEAD");
    const declared = Number(head.headers.get("content-length"));
    assert(
      Number.isSafeInteger(declared) && declared > 0 && declared <= MAX_FILE,
      "HEAD content length",
    );
    const get = await request(s.url, "GET");
    const bytes = await body(get, MAX_FILE);
    total += bytes.length;
    assert(total <= MAX_TOTAL, "total original cap");
    assert(bytes.length === declared, "HEAD/GET length mismatch");
    assert(
      sha256(bytes.subarray(0, 4096)) === s.prefix,
      "predecessor prefix mismatch",
    );
    fs.writeFileSync(path.join(ORIGINALS, s.file), bytes);
    rows.push({
      ...s,
      bytes: bytes.length,
      sha256: sha256(bytes),
      etag: head.headers.get("etag"),
      last_modified: head.headers.get("last-modified"),
      content_type: "image/jpeg",
      decode: await inspectJpeg(bytes),
    });
  }
  write(path.join(DATA, "acquisition-v1.json"), {
    schema_version: SCHEMA,
    network_policy: "public GET/HEAD only; exact six URLs; redirects forbidden",
    total_bytes: total,
    rows,
  });
  return rows;
}
function acquisition() {
  const value = JSON.parse(
    fs.readFileSync(path.join(DATA, "acquisition-v1.json"), "utf8"),
  ) as { rows: any[]; total_bytes: number };
  const ledger = read(
    "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/source-ledger-v1.json",
  );
  const sourceDescriptor = read(
    "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/descriptor-v1.json",
  );
  const sourceManifestPath = path.join(
    ROOT,
    "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/manifest-v1.json",
  );
  assert(
    sha256(fs.readFileSync(sourceManifestPath)) ===
      sourceDescriptor.manifest_sha256,
    "source acquisition manifest predecessor binding",
  );
  const sourceManifest = JSON.parse(
    fs.readFileSync(sourceManifestPath, "utf8"),
  );
  const ledgerMember = sourceManifest.members.find(
    (x: any) => x.path === "source-ledger-v1.json",
  );
  assert(
    ledgerMember &&
      sha256(
        fs.readFileSync(
          path.join(
            ROOT,
            "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/source-ledger-v1.json",
          ),
        ),
      ) === ledgerMember.sha256,
    "source ledger predecessor binding",
  );
  value.rows = value.rows.map((row) => {
    const prior = ledger.sources.find((x: any) => x.key === `image_${row.id}`);
    assert(prior, "predecessor transport missing");
    assert(
      prior.requested_url === row.url &&
        prior.final_url === row.url &&
        prior.redirects.length === 0,
      "predecessor effective URL/redirect binding",
    );
    assert(
      prior.sample.etag === prior.head.etag &&
        prior.sample.last_modified === prior.head.last_modified,
      "HEAD/range GET validator mismatch",
    );
    assert(
      Number(prior.head.content_length) === row.bytes &&
        prior.sample.sha256 === row.prefix,
      "HEAD/range object identity mismatch",
    );
    return {
      ...row,
      transport: {
        head: {
          requested_url: row.url,
          effective_url: prior.head.final_url,
          status: prior.head.status,
          etag: prior.head.etag,
          last_modified: prior.head.last_modified,
          content_length: Number(prior.head.content_length),
          content_type: prior.head.content_type,
        },
        full_get: {
          requested_url: row.url,
          effective_url: row.url,
          status: 200,
          content_length: row.bytes,
          content_type: row.content_type,
          etag: null,
          last_modified: null,
          validators_retained: false,
        },
        validator_rule:
          "HEAD validators are authoritative; predecessor range GET validators equal HEAD; full GET validators were not retained and must remain null",
        object_identity_rule:
          "exact effective URL + HEAD object length/validators + predecessor 4096-byte prefix + full bytes/hash",
      },
    };
  });
  return value;
}
export function containTransform(w: number, h: number, box = 256) {
  const scale = Math.min(box / w, box / h);
  const resized_width = Math.round(w * scale),
    resized_height = Math.round(h * scale);
  const pad_left = Math.floor((box - resized_width) / 2),
    pad_top = Math.floor((box - resized_height) / 2);
  return {
    source_width: w,
    source_height: h,
    target_width: box,
    target_height: box,
    resized_width,
    resized_height,
    pad_left,
    pad_top,
    pad_right: box - resized_width - pad_left,
    pad_bottom: box - resized_height - pad_top,
  };
}
export function derivativeBoxToOriginal(
  box: [number, number, number, number],
  t: ReturnType<typeof containTransform>,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = box.map((x) => x * 256) as [
    number,
    number,
    number,
    number,
  ];
  const sx = t.source_width / t.resized_width,
    sy = t.source_height / t.resized_height;
  return [
    Math.max(0, Math.floor((x0 - t.pad_left) * sx)),
    Math.max(0, Math.floor((y0 - t.pad_top) * sy)),
    Math.min(t.source_width - 1, Math.ceil((x1 - t.pad_left) * sx) - 1),
    Math.min(t.source_height - 1, Math.ceil((y1 - t.pad_top) * sy) - 1),
  ];
}
export function originalBoxToDerivative(
  box: [number, number, number, number],
  t: ReturnType<typeof containTransform>,
): [number, number, number, number] {
  return [
    ((box[0] / t.source_width) * t.resized_width + t.pad_left) / 256,
    ((box[1] / t.source_height) * t.resized_height + t.pad_top) / 256,
    (((box[2] + 1) / t.source_width) * t.resized_width + t.pad_left) / 256,
    (((box[3] + 1) / t.source_height) * t.resized_height + t.pad_top) / 256,
  ];
}
function geometry(id: number, w: number, h: number) {
  const old = read(
    "docs/dataset-factory/fixtures/real-pilot-intelligence-v1/dossiers/" +
      id +
      ".json",
  );
  const transform = containTransform(w, h);
  const regions = old.regions.map((r: any) =>
    r.bbox_xyxy_norm
      ? {
          region_id:
            id === 105 && r.region_id === "ocr-1"
              ? "white-rose"
              : id === 105 && r.region_id === "ocr-2"
                ? "catelli-egg-noodles"
                : r.region_id,
          kind: r.kind,
          predecessor_region_id: r.region_id,
          predecessor_derivative_xyxy_norm: r.bbox_xyxy_norm,
          predecessor_to_original_transform: transform,
          native_xyxy: derivativeBoxToOriginal(r.bbox_xyxy_norm, transform),
          normalized_xyxy: derivativeBoxToOriginal(
            r.bbox_xyxy_norm,
            transform,
          ).map((v: number, i: number) => v / (i % 2 === 0 ? w - 1 : h - 1)),
        }
      : {
          region_id: r.region_id,
          kind: r.kind,
          normalized_xyxy: null,
          native_xyxy: [0, 0, w - 1, h - 1],
          predecessor_region_id: r.region_id,
          predecessor_derivative_xyxy_norm: null,
          predecessor_to_original_transform: transform,
        },
  );
  return regions;
}
async function boundedJpeg(input: sharp.Sharp, max = 170 * 1024) {
  for (const quality of [82, 72, 62, 52, 42]) {
    const b = await input.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (b.length <= max) return b;
  }
  throw new Error("review raster size cap");
}
function tesseractVersion() {
  return execFileSync("tesseract", ["--version"], { encoding: "utf8" })
    .split("\n")[0]
    .trim();
}
function runOcr(
  image: string,
  id: number,
  regions: any[],
  width: number,
  height: number,
) {
  const tsv = execFileSync(
    "tesseract",
    [image, "stdout", "-l", "eng", "--oem", "1", "--psm", "11", "tsv"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const lines = tsv.trim().split("\n").slice(1),
    proposals = [];
  for (const line of lines) {
    const c = line.split("\t");
    if (c.length < 12 || Number(c[10]) < 0 || !c[11].trim()) continue;
    const [x, y, w, h] = c.slice(6, 10).map(Number),
      W = width,
      H = height;
    proposals.push({
      text: c[11].trim(),
      confidence: Number(c[10]),
      polygon_native: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      polygon_normalized: [
        [x / W, y / H],
        [(x + w) / W, y / H],
        [(x + w) / W, (y + h) / H],
        [x / W, (y + h) / H],
      ],
      alternatives: [],
    });
  }
  return {
    engine: "tesseract",
    engine_version: tesseractVersion(),
    language: "eng",
    config: { oem: 1, psm: 11 },
    preprocessing:
      "original JPEG; Tesseract coordinates are original-frame; no review-derivative coordinate reuse",
    coordinate_frame: "orientation-normalized original pixels",
    original_width: width,
    original_height: height,
    regions,
    proposals,
    status: "proposal_only_not_accepted_evidence",
  };
}
function cropMachineProposal(ocr: any, native: number[]) {
  const [x0, y0, x1, y1] = native,
    proposals = ocr.proposals.filter((proposal: any) => {
      const polygon = proposal.polygon_native,
        centerX = (polygon[0][0] + polygon[2][0]) / 2,
        centerY = (polygon[0][1] + polygon[2][1]) / 2;
      return centerX >= x0 && centerX <= x1 && centerY >= y0 && centerY <= y1;
    });
  if (proposals.length === 0)
    return {
      text: null,
      confidence: null,
      alternatives: [],
      derivation: "no intersecting original-frame machine OCR proposals",
    };
  proposals.sort(
    (a: any, b: any) =>
      a.polygon_native[0][1] - b.polygon_native[0][1] ||
      a.polygon_native[0][0] - b.polygon_native[0][0],
  );
  return {
    text: proposals.map((proposal: any) => proposal.text).join(" "),
    confidence:
      proposals.reduce(
        (sum: number, proposal: any) => sum + proposal.confidence,
        0,
      ) / proposals.length,
    alternatives: [],
    derivation: "intersecting original-frame machine OCR proposals",
  };
}
export async function derive() {
  const trackedReviewArtifacts = [
      TRACKED_REVIEW_DECISIONS,
      TRACKED_REVIEW_DECISIONS_SEAL,
      TRACKED_REVIEW_TRANSCRIPTIONS,
      TRACKED_REVIEW_METRICS,
      TRACKED_REVIEW_MANIFEST,
    ],
    existingTrackedReviewArtifacts = trackedReviewArtifacts.filter((file) =>
      fs.existsSync(file),
    ),
    preservePublishedReview = existingTrackedReviewArtifacts.length > 0;
  if (preservePublishedReview) {
    assert(
      existingTrackedReviewArtifacts.length === trackedReviewArtifacts.length,
      "published review artifact set is incomplete",
    );
    assert(
      fs.existsSync(INDEPENDENT_REVIEW_DECISIONS) &&
        fs.existsSync(INDEPENDENT_REVIEW_DECISIONS_SEAL),
      "published review rebuild requires external decision and seal bytes",
    );
    assert(
      fs
        .readFileSync(TRACKED_REVIEW_DECISIONS)
        .equals(fs.readFileSync(INDEPENDENT_REVIEW_DECISIONS)) &&
        fs
          .readFileSync(TRACKED_REVIEW_DECISIONS_SEAL)
          .equals(fs.readFileSync(INDEPENDENT_REVIEW_DECISIONS_SEAL)),
      "published review rebuild external bytes changed",
    );
    verifyIndependentReviewFiles(
      INDEPENDENT_REVIEW_DECISIONS,
      INDEPENDENT_REVIEW_DECISIONS_SEAL,
    );
  }
  const a = acquisition();
  assert(a.rows.length === 6, "six originals required");
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  for (const d of ["review", "crops", "overlays"])
    fs.mkdirSync(path.join(FIXTURE, d), { recursive: true });
  const records = [],
    neutralCrops: any[] = [];
  for (const [recordIndex, row] of a.rows.entries()) {
    const original = fs.readFileSync(path.join(ORIGINALS, row.file));
    const oriented = sharp(original).rotate();
    const review = await boundedJpeg(
      oriented.clone().resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      }),
    );
    const neutralId = `ground-review-${String(recordIndex + 1).padStart(2, "0")}`,
      neutralFile = `${neutralId}.jpg`;
    fs.writeFileSync(path.join(FIXTURE, "review", neutralFile), review);
    const rm = await sharp(review).metadata();
    assert(rm.width && rm.height, "review decode dimensions");
    const reviewWidth = rm.width;
    const reviewHeight = rm.height;
    const regions = geometry(
      row.id,
      row.decode.normalized_width,
      row.decode.normalized_height,
    );
    const ocr = runOcr(
      path.join(ORIGINALS, row.file),
      row.id,
      regions,
      row.decode.normalized_width,
      row.decode.normalized_height,
    );
    for (const r of regions.filter((x: any) => x.region_id !== "whole")) {
      const [x0, y0, x1, y1] = r.native_xyxy;
      const crop = await boundedJpeg(
        oriented
          .clone()
          .extract({
            left: x0,
            top: y0,
            width: x1 - x0 + 1,
            height: y1 - y0 + 1,
          })
          .resize({
            width: 1200,
            height: 1200,
            fit: "inside",
            withoutEnlargement: true,
          }),
      );
      const neutralCropId = `ground-crop-${String(neutralCrops.length + 1).padStart(2, "0")}`,
        cropPath = `crops/${neutralCropId}.jpg`;
      fs.writeFileSync(path.join(FIXTURE, cropPath), crop);
      const cropMetadata = await sharp(crop).metadata();
      assert(cropMetadata.width && cropMetadata.height, "crop dimensions");
      neutralCrops.push({
        neutral_crop_id: neutralCropId,
        parent_neutral_id: neutralId,
        crop_path: cropPath,
        crop_sha256: sha256(crop),
        width: cropMetadata.width,
        height: cropMetadata.height,
        machine_ocr_proposal: cropMachineProposal(ocr, r.native_xyxy),
        numeric_id: row.id,
        region_id: r.region_id,
        native_xyxy: r.native_xyxy,
      });
    }
    const svg = Buffer.from(
      `<svg width="${reviewWidth}" height="${reviewHeight}">${regions
        .filter((x: any) => x.region_id !== "whole")
        .map((r: any) => {
          const [x0, y0, x1, y1] = r.normalized_xyxy;
          return `<rect x="${x0 * reviewWidth}" y="${y0 * reviewHeight}" width="${(x1 - x0) * reviewWidth}" height="${(y1 - y0) * reviewHeight}" fill="none" stroke="red" stroke-width="4"/>`;
        })
        .join("")}</svg>`,
    );
    const overlay = await boundedJpeg(
      sharp(review).composite([{ input: svg, top: 0, left: 0 }]),
    );
    fs.writeFileSync(path.join(FIXTURE, "overlays", row.file), overlay);
    write(path.join(FIXTURE, `ocr-${row.id}.json`), ocr);
    records.push({
      ...row,
      review: {
        path: `review/${neutralFile}`,
        bytes: review.length,
        sha256: sha256(review),
        width: reviewWidth,
        height: reviewHeight,
      },
      regions,
      ocr_path: `ocr-${row.id}.json`,
      neutral_id: neutralId,
      rights: {
        asset_source_url: row.url,
        archive_cote: row.cote,
        attribution: "Archives de la Ville de Montreal",
        license_id: "cc-by-4.0",
        license_lineage: [
          {
            path: "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/snapshot/license_page.html",
            sha256:
              "8d5838a3b7490fae99f7e2d353fcd5c16013dc0cd37434e76e76dd2c1bcaf810",
          },
          {
            path: "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/snapshot/cc_by.html",
            sha256:
              "231a5dac65bbf135ba27145969a63cd289faadc172f1512c4810a6c60ba91036",
          },
        ],
        scope: "rights lineage only; no historical or visual claim",
      },
    });
  }
  const thumbs = await Promise.all(
    records.map(async (r, i) => ({
      input: await sharp(path.join(FIXTURE, r.review.path))
        .resize({
          width: 480,
          height: 480,
          fit: "contain",
          background: "white",
        })
        .jpeg({ quality: 65, mozjpeg: true })
        .toBuffer(),
      left: (i % 3) * 480,
      top: Math.floor(i / 3) * 480,
    })),
  );
  const sheet = await boundedJpeg(
    sharp({
      create: { width: 1440, height: 960, channels: 3, background: "white" },
    }).composite(thumbs),
  );
  fs.writeFileSync(path.join(FIXTURE, "contact-sheet.jpg"), sheet);
  write(path.join(FIXTURE, "records-v1.json"), {
    schema_version: SCHEMA,
    predecessors: PREDECESSORS,
    records,
  });
  write(path.join(FIXTURE, "independent-review-input-v1.json"), {
    schema_version: "ground_originals_independent_review_input_v1.0.0",
    scope: "neutral pixel and OCR proposal review",
    status: "pending_external_independent_review",
    scenes: records.map((r) => ({
      neutral_id: r.neutral_id,
      review_path: r.review.path,
      review_sha256: r.review.sha256,
      width: r.review.width,
      height: r.review.height,
      decision: null,
      reviewer_id: null,
      status: "pending",
    })),
    crops: neutralCrops.map((crop) => ({
      neutral_crop_id: crop.neutral_crop_id,
      parent_neutral_id: crop.parent_neutral_id,
      crop_path: crop.crop_path,
      crop_sha256: crop.crop_sha256,
      width: crop.width,
      height: crop.height,
      machine_ocr_proposal: crop.machine_ocr_proposal,
      decision: null,
      reviewer_id: null,
      status: "pending",
    })),
  });
  write(path.join(FIXTURE, "trusted-neutral-map-v1.json"), {
    schema_version: SCHEMA,
    scenes: records.map((r) => ({
      neutral_id: r.neutral_id,
      numeric_id: r.id,
      record_id: `mtl_archives_metadata_${r.id}.json`,
      review_path: r.review.path,
      review_sha256: r.review.sha256,
      ocr_proposal_path: r.ocr_path,
    })),
    crops: neutralCrops.map((crop) => ({
      neutral_crop_id: crop.neutral_crop_id,
      parent_neutral_id: crop.parent_neutral_id,
      numeric_id: crop.numeric_id,
      region_id: crop.region_id,
      native_xyxy: crop.native_xyxy,
      crop_path: crop.crop_path,
      crop_sha256: crop.crop_sha256,
    })),
  });
  write(path.join(FIXTURE, "research-candidates-v1.json"), {
    schema_version: SCHEMA,
    external_claims: 0,
    rows: researchCandidates(),
  });
  if (preservePublishedReview) await publishIndependentReview(false);
  else write(path.join(FIXTURE, "report-v1.json"), pendingReport());
  await seal();
  return records;
}
function validateSchemas() {
  const Ajv = Ajv2020Import as any,
    ajv = new Ajv({ allErrors: true, strict: true });
  for (const [name, file] of [
    ["records", "records-v1.json"],
    ["review", "independent-review-input-v1.json"],
    ["research", "research-candidates-v1.json"],
    ["report", "report-v1.json"],
    ["descriptor", "descriptor-v1.json"],
    ["trusted-map", "trusted-neutral-map-v1.json"],
    ...(fs.existsSync(
      path.join(FIXTURE, "full-originals-archive-descriptor-v1.json"),
    )
      ? [["archive", "full-originals-archive-descriptor-v1.json"]]
      : []),
  ]) {
    const schema = read(
        `docs/dataset-factory/schemas/ground-originals-v1/${name}.schema.v1.json`,
      ),
      value = JSON.parse(fs.readFileSync(path.join(FIXTURE, file), "utf8"));
    assert(
      ajv.validate(schema, value),
      `${name} schema: ${JSON.stringify(ajv.errors)}`,
    );
  }
  const ocrSchema = read(
    "docs/dataset-factory/schemas/ground-originals-v1/ocr.schema.v1.json",
  );
  for (const id of IDS) {
    const value = JSON.parse(
      fs.readFileSync(path.join(FIXTURE, `ocr-${id}.json`), "utf8"),
    );
    assert(
      ajv.validate(ocrSchema, value),
      `ocr ${id} schema: ${JSON.stringify(ajv.errors)}`,
    );
  }
  const trackedReviewArtifacts = [
      TRACKED_REVIEW_DECISIONS,
      TRACKED_REVIEW_DECISIONS_SEAL,
      TRACKED_REVIEW_TRANSCRIPTIONS,
      TRACKED_REVIEW_METRICS,
      TRACKED_REVIEW_MANIFEST,
    ],
    existingTrackedReviewArtifacts = trackedReviewArtifacts.filter((file) =>
      fs.existsSync(file),
    );
  if (existingTrackedReviewArtifacts.length > 0) {
    assert(
      existingTrackedReviewArtifacts.length === trackedReviewArtifacts.length,
      "tracked independent review publication is incomplete",
    );
    validatePublicationReceiptValue(
      JSON.parse(fs.readFileSync(TRACKED_REVIEW_DECISIONS, "utf8")),
      INDEPENDENT_REVIEW_DECISION_SCHEMA,
      "tracked independent review decisions",
    );
    validatePublicationReceiptValue(
      JSON.parse(fs.readFileSync(TRACKED_REVIEW_DECISIONS_SEAL, "utf8")),
      INDEPENDENT_REVIEW_DECISION_SEAL_SCHEMA,
      "tracked independent review decision seal",
    );
    validatePublicationReceiptValue(
      JSON.parse(fs.readFileSync(TRACKED_REVIEW_TRANSCRIPTIONS, "utf8")),
      path.join(
        ROOT,
        "docs/dataset-factory/schemas/ground-originals-v1/reviewed-visual-transcriptions.schema.v1.json",
      ),
      "reviewed visual transcriptions",
    );
    validatePublicationReceiptValue(
      JSON.parse(fs.readFileSync(TRACKED_REVIEW_METRICS, "utf8")),
      path.join(
        ROOT,
        "docs/dataset-factory/schemas/ground-originals-v1/independent-review-metrics.schema.v1.json",
      ),
      "independent review metrics",
    );
    validatePublicationReceiptValue(
      JSON.parse(fs.readFileSync(TRACKED_REVIEW_MANIFEST, "utf8")),
      path.join(
        ROOT,
        "docs/dataset-factory/schemas/ground-originals-v1/independent-review-publication-manifest.schema.v1.json",
      ),
      "independent review publication manifest",
    );
  }
  validatePublicationReceiptFiles();
}
export async function seal() {
  const m = members(FIXTURE, ["descriptor-v1.json"]);
  const raster = m.filter((x) => /\.(jpg|png)$/.test(x.path));
  assert(
    raster.every((x) => x.bytes <= MAX_RASTER),
    "per-raster cap",
  );
  assert(
    raster.reduce((n, x) => n + x.bytes, 0) <= MAX_RASTERS,
    "raster aggregate cap",
  );
  assert(m.reduce((n, x) => n + x.bytes, 0) <= MAX_FIXTURE, "fixture cap");
  write(path.join(FIXTURE, "descriptor-v1.json"), {
    schema_version: SCHEMA,
    artifact_id: "ground-originals-v1",
    tree_sha256: tree(m),
    counts: {
      files: m.length,
      bytes: m.reduce((n, x) => n + x.bytes, 0),
      originals: 6,
      external_claims: 0,
      fully_verified_dossiers: 0,
      tasks: 0,
    },
    members: m,
  });
  validateSchemas();
}
function tarHeader(name: string, size: number) {
  assert(Buffer.byteLength(name) <= 100, "tar name too long");
  const b = Buffer.alloc(512);
  b.write(name);
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(size.toString(8).padStart(11, "0") + "\0", 124);
  b.write("00000000000\0", 136);
  b.fill(0x20, 148, 156);
  b[156] = 0x30;
  b.write("ustar\0", 257);
  b.write("00", 263);
  const sum = [...b].reduce((n, x) => n + x, 0);
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return b;
}
export async function buildBundle() {
  await verify(true, true);
  const chunks: Buffer[] = [];
  for (const s of SOURCES) {
    const name = `originals/${s.file}`,
      b = fs.readFileSync(path.join(ORIGINALS, s.file));
    chunks.push(
      tarHeader(name, b.length),
      b,
      Buffer.alloc((512 - (b.length % 512)) % 512),
    );
  }
  chunks.push(Buffer.alloc(1024));
  const gz = zlib.gzipSync(Buffer.concat(chunks), {
    level: 9,
    mtime: 0,
  } as any);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(ARCHIVE, gz);
  const a = acquisition();
  const publication = publicationForBundle(sha256(gz), gz.length);
  const descriptor = {
    schema_version: SCHEMA,
    artifact_id: "ground-originals-v1-full-originals",
    archive_path:
      "data/mtl_archives/reports/ground-originals-v1/ground-originals-v1.tar.gz",
    sha256: sha256(gz),
    bytes: gz.length,
    uncompressed_bytes: a.total_bytes,
    members: SOURCES.map((s) => {
      const r = a.rows.find((x) => x.id === s.id);
      return { path: `originals/${s.file}`, bytes: r.bytes, sha256: r.sha256 };
    }),
    publication,
  };
  write(
    path.join(FIXTURE, "full-originals-archive-descriptor-v1.json"),
    descriptor,
  );
  seal();
  return descriptor;
}
function validatePublicationReceiptValue(
  value: unknown,
  schemaPath: string,
  label: string,
) {
  const Ajv = Ajv2020Import as any,
    ajv = new Ajv({ allErrors: true, strict: true }),
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert(
    ajv.validate(schema, value),
    `${label} schema: ${JSON.stringify(ajv.errors)}`,
  );
  return value as any;
}
function validateReceiptInputValue(value: unknown) {
  return validatePublicationReceiptValue(
    value,
    PUBLICATION_RECEIPT_INPUT_SCHEMA,
    "publication receipt input",
  );
}
function validateReceiptSealValue(value: unknown) {
  return validatePublicationReceiptValue(
    value,
    PUBLICATION_RECEIPT_SEAL_SCHEMA,
    "publication receipt seal",
  );
}
function receiptInput() {
  return validateReceiptInputValue(
    JSON.parse(fs.readFileSync(PUBLICATION_RECEIPT_INPUT, "utf8")),
  );
}
function receiptSeal() {
  return validateReceiptSealValue(
    JSON.parse(fs.readFileSync(PUBLICATION_RECEIPT_SEAL, "utf8")),
  );
}
function validatePublicationReceiptFiles() {
  const receipt = receiptInput();
  if (!fs.existsSync(PUBLICATION_RECEIPT_SEAL)) return { receipt, seal: null };
  const seal = receiptSeal(),
    expected = expectedReceiptSeal(receipt);
  assert(json(seal) === json(expected), "publication receipt seal mismatch");
  return { receipt, seal };
}
function validateIndependentReviewInputValue(value: unknown) {
  const input = validatePublicationReceiptValue(
      value,
      INDEPENDENT_REVIEW_INPUT_SCHEMA,
      "independent review input",
    ),
    serialized = json(input);
  assert(
    json(input.scenes.map((row: any) => row.neutral_id)) ===
      json([
        "ground-review-01",
        "ground-review-02",
        "ground-review-03",
        "ground-review-04",
        "ground-review-05",
        "ground-review-06",
      ]) &&
      json(input.crops.map((row: any) => row.neutral_crop_id)) ===
        json(["ground-crop-01", "ground-crop-02"]),
    "independent review input exact neutral rows",
  );
  assert(
    !/CATELLI|CASTROL|WHITE ROSE|EGG NOODLES|VM94|mtl_archives|https?:\/\/|depot\.ville|archive_cote|numeric_id|record_id|region_id/i.test(
      serialized,
    ),
    "identity leaked into independent review input",
  );
  return input;
}
function independentReviewInput() {
  return validateIndependentReviewInputValue(
    JSON.parse(fs.readFileSync(INDEPENDENT_REVIEW_INPUT, "utf8")),
  );
}
function validateIndependentReviewDecisionsValue(
  value: unknown,
  input = independentReviewInput(),
) {
  const decisions = validatePublicationReceiptValue(
    value,
    INDEPENDENT_REVIEW_DECISION_SCHEMA,
    "independent review decisions",
  );
  assert(
    decisions.input_sha256 ===
      sha256(fs.readFileSync(INDEPENDENT_REVIEW_INPUT)),
    "independent review input digest mismatch",
  );
  assert(
    decisions.reviewer_id !== decisions.review_session_id &&
      ![
        "sol-high-primary-019f57f4-0222-7750-8a88-330fdf3a74cc",
        "vmi-primary-001",
      ].includes(decisions.reviewer_id),
    "independent reviewer/session or primary reviewer mismatch",
  );
  assert(
    json(decisions.scenes.map((row: any) => row.neutral_id)) ===
      json(input.scenes.map((row: any) => row.neutral_id)) &&
      json(decisions.crops.map((row: any) => row.neutral_crop_id)) ===
        json(input.crops.map((row: any) => row.neutral_crop_id)),
    "independent review missing, extra, duplicate, or reordered rows",
  );
  for (const decision of decisions.crops) {
    const crop = input.crops.find(
      (row: any) => row.neutral_crop_id === decision.neutral_crop_id,
    );
    assert(crop, "independent crop decision has no input");
    if (decision.decision === "accept")
      assert(
        crop.machine_ocr_proposal.text !== null &&
          decision.literal_text === crop.machine_ocr_proposal.text,
        "accepted transcription lacks matching machine proposal and independent decision",
      );
    if (decision.decision === "correct")
      assert(
        decision.literal_text &&
          decision.literal_text !== crop.machine_ocr_proposal.text,
        "corrected transcription must be an independent literal correction",
      );
  }
  return decisions;
}
function exactExternalReviewPath(
  candidate: string | undefined,
  expected: string,
) {
  const resolved = candidate ? path.resolve(ROOT, candidate) : expected;
  assert(resolved === expected, `review artifact path must be ${expected}`);
  return resolved;
}
function expectedIndependentReviewSeal(decisions: any, decisionsPath: string) {
  return {
    schema_version: "ground_originals_independent_review_decision_seal_v1.0.0",
    status: "sealed_external_independent_decisions",
    input_sha256: sha256(fs.readFileSync(INDEPENDENT_REVIEW_INPUT)),
    decisions_sha256: sha256(fs.readFileSync(decisionsPath)),
    decision_schema_sha256: sha256(
      fs.readFileSync(INDEPENDENT_REVIEW_DECISION_SCHEMA),
    ),
    reviewer_id: decisions.reviewer_id,
    review_session_id: decisions.review_session_id,
    scene_rows: decisions.scenes.length,
    crop_rows: decisions.crops.length,
    identity_claims: 0,
  };
}
function independentReviewMetrics(decisions: any) {
  const accepted = decisions.crops.filter((row: any) =>
    ["accept", "correct"].includes(row.decision),
  );
  assert(
    accepted.every(
      (row: any) =>
        typeof row.literal_text === "string" && row.literal_text.length > 0,
    ),
    "unreviewed accepted transcription",
  );
  return {
    status: "derived_from_sealed_external_independent_decisions",
    reviewer_id: decisions.reviewer_id,
    review_session_id: decisions.review_session_id,
    scenes_reviewed: decisions.scenes.length,
    scene_abstentions: decisions.scenes.filter((row: any) => row.abstained)
      .length,
    crops_reviewed: decisions.crops.length,
    crop_abstentions: decisions.crops.filter(
      (row: any) => row.decision === "abstain",
    ).length,
    accepted_transcriptions: accepted.map((row: any) => ({
      neutral_crop_id: row.neutral_crop_id,
      decision: row.decision,
      literal_text: row.literal_text,
    })),
    identity_claims: 0,
  };
}
function verifyIndependentReviewFiles(decisionsPath: string, sealPath: string) {
  const input = independentReviewInput(),
    decisions = validateIndependentReviewDecisionsValue(
      JSON.parse(fs.readFileSync(decisionsPath, "utf8")),
      input,
    ),
    seal = validatePublicationReceiptValue(
      JSON.parse(fs.readFileSync(sealPath, "utf8")),
      INDEPENDENT_REVIEW_DECISION_SEAL_SCHEMA,
      "independent review decision seal",
    ),
    expectedSeal = expectedIndependentReviewSeal(decisions, decisionsPath);
  assert(
    json(seal) === json(expectedSeal),
    "independent review decision seal mismatch",
  );
  return independentReviewMetrics(decisions);
}
export function verifyIndependentReview(
  decisionsCandidate?: string,
  sealCandidate?: string,
) {
  return verifyIndependentReviewFiles(
    exactExternalReviewPath(decisionsCandidate, INDEPENDENT_REVIEW_DECISIONS),
    exactExternalReviewPath(sealCandidate, INDEPENDENT_REVIEW_DECISIONS_SEAL),
  );
}
export function sealIndependentReview(
  decisionsCandidate?: string,
  sealCandidate?: string,
) {
  const decisionsPath = exactExternalReviewPath(
      decisionsCandidate,
      INDEPENDENT_REVIEW_DECISIONS,
    ),
    sealPath = exactExternalReviewPath(
      sealCandidate,
      INDEPENDENT_REVIEW_DECISIONS_SEAL,
    ),
    decisions = validateIndependentReviewDecisionsValue(
      JSON.parse(fs.readFileSync(decisionsPath, "utf8")),
    ),
    seal = expectedIndependentReviewSeal(decisions, decisionsPath);
  validatePublicationReceiptValue(
    seal,
    INDEPENDENT_REVIEW_DECISION_SEAL_SCHEMA,
    "independent review decision seal",
  );
  write(sealPath, seal);
  return verifyIndependentReview(decisionsPath, sealPath);
}
function pendingReport() {
  return {
    schema_version: SCHEMA,
    originals: 6,
    external_claims: 0,
    identity_claims: 0,
    fully_verified_dossiers: 0,
    tasks: 0,
    pixel_decisions: "pending_separate_agent",
    ocr_decisions: "pending_separate_agent",
    independent_review: null,
  };
}
function derivePublishedReviewArtifacts(
  decisionsPath: string,
  sealPath: string,
) {
  verifyIndependentReviewFiles(decisionsPath, sealPath);
  const decisionBytes = fs.readFileSync(decisionsPath),
    sealBytes = fs.readFileSync(sealPath);
  assert(
    sha256(decisionBytes) ===
      "32d85f7815a2ef583e36e988ed330347198db056de04f3fa60bd4e42414c536f" &&
      sha256(sealBytes) ===
        "fb3892870778ac9a683cada3187190fdd643992987436a2b7623a2b2cf4e3ff6",
    "external independent review bytes are not the approved evidence",
  );
  const decisions = JSON.parse(decisionBytes.toString("utf8")),
    input = independentReviewInput(),
    trusted = JSON.parse(
      fs.readFileSync(
        path.join(FIXTURE, "trusted-neutral-map-v1.json"),
        "utf8",
      ),
    ),
    records = JSON.parse(
      fs.readFileSync(path.join(FIXTURE, "records-v1.json"), "utf8"),
    ).records;
  const rows = decisions.crops.map((decision: any) => {
    const cropInput = input.crops.find(
        (row: any) => row.neutral_crop_id === decision.neutral_crop_id,
      ),
      mapping = trusted.crops.find(
        (row: any) => row.neutral_crop_id === decision.neutral_crop_id,
      ),
      record = records.find((row: any) => row.id === mapping?.numeric_id);
    assert(
      cropInput && mapping && record,
      "reviewed transcription mapping missing",
    );
    assert(
      decision.decision === "correct" &&
        cropInput.machine_ocr_proposal.text === null &&
        cropInput.machine_ocr_proposal.confidence === null,
      "published correction or raw OCR boundary mismatch",
    );
    return {
      neutral_crop_id: decision.neutral_crop_id,
      parent_neutral_id: cropInput.parent_neutral_id,
      decision: decision.decision,
      literal_text: decision.literal_text,
      alternatives: decision.alternatives,
      legibility: decision.legibility,
      reason: decision.reason,
      crop_sha256: cropInput.crop_sha256,
      source_region: {
        numeric_id: mapping.numeric_id,
        region_id: mapping.region_id,
        native_xyxy: mapping.native_xyxy,
        original_sha256: record.sha256,
      },
      evidence_scope: "literal_visual_transcription_only_not_identity",
      identity_status: "not_asserted",
    };
  });
  const metrics = {
    schema_version: "ground_originals_independent_review_metrics_v1.0.0",
    status: "derived_from_sealed_external_independent_decisions",
    input_sha256: sha256(fs.readFileSync(INDEPENDENT_REVIEW_INPUT)),
    decisions_sha256: sha256(decisionBytes),
    decision_seal_sha256: sha256(sealBytes),
    reviewer_id: decisions.reviewer_id,
    review_session_id: decisions.review_session_id,
    scenes_reviewed: 6,
    crops_reviewed: 2,
    corrected_transcriptions: 2,
    accepted_machine_transcriptions: 0,
    identity_claims: 0,
    external_claims: 0,
    fully_verified_dossiers: 0,
    tasks: 0,
    raw_ocr_comparison: {
      value: null,
      reason:
        "No original-frame machine OCR proposals intersect either reviewed crop.",
    },
  };
  const transcriptions = {
    schema_version: "ground_originals_reviewed_visual_transcriptions_v1.0.0",
    input_sha256: metrics.input_sha256,
    decisions_sha256: metrics.decisions_sha256,
    decision_seal_sha256: metrics.decision_seal_sha256,
    reviewer_id: decisions.reviewer_id,
    review_session_id: decisions.review_session_id,
    identity_claims: 0,
    rows,
  };
  const report = {
    schema_version: SCHEMA,
    originals: 6,
    external_claims: 0,
    identity_claims: 0,
    fully_verified_dossiers: 0,
    tasks: 0,
    pixel_decisions: "sealed_external_independent_review",
    ocr_decisions: "two_corrected_visual_transcriptions",
    independent_review: {
      input_sha256: metrics.input_sha256,
      decisions_sha256: metrics.decisions_sha256,
      decision_seal_sha256: metrics.decision_seal_sha256,
      reviewer_id: metrics.reviewer_id,
      review_session_id: metrics.review_session_id,
      scenes_reviewed: 6,
      crops_reviewed: 2,
      corrected_transcriptions: 2,
      raw_ocr_comparison: metrics.raw_ocr_comparison,
    },
  };
  return { decisionBytes, sealBytes, transcriptions, metrics, report };
}
function expectedReviewPublicationManifest() {
  return {
    schema_version:
      "ground_originals_independent_review_publication_manifest_v1.0.0",
    status: "published_verified_external_independent_review",
    reviewer_id: "independent-reviewer-pixel-ocr-v1",
    review_session_id: "independent-session-20260713-ground-v1",
    scenes_reviewed: 6,
    crops_reviewed: 2,
    corrected_transcriptions: 2,
    identity_claims: 0,
    external_claims: 0,
    fully_verified_dossiers: 0,
    tasks: 0,
    artifacts: [
      ["independent-review-input-v1.json", INDEPENDENT_REVIEW_INPUT],
      ["independent-review-decisions-v1.json", TRACKED_REVIEW_DECISIONS],
      [
        "independent-review-decisions-seal-v1.json",
        TRACKED_REVIEW_DECISIONS_SEAL,
      ],
      ["reviewed-visual-transcriptions-v1.json", TRACKED_REVIEW_TRANSCRIPTIONS],
      ["independent-review-metrics-v1.json", TRACKED_REVIEW_METRICS],
      ["report-v1.json", path.join(FIXTURE, "report-v1.json")],
    ].map(([artifactPath, absolutePath]) => ({
      path: artifactPath,
      sha256: sha256(fs.readFileSync(absolutePath)),
      bytes: fs.statSync(absolutePath).size,
    })),
  };
}
export async function publishIndependentReview(sealFixture = true) {
  const derived = derivePublishedReviewArtifacts(
    INDEPENDENT_REVIEW_DECISIONS,
    INDEPENDENT_REVIEW_DECISIONS_SEAL,
  );
  fs.writeFileSync(TRACKED_REVIEW_DECISIONS, derived.decisionBytes);
  fs.writeFileSync(TRACKED_REVIEW_DECISIONS_SEAL, derived.sealBytes);
  write(TRACKED_REVIEW_TRANSCRIPTIONS, derived.transcriptions);
  write(TRACKED_REVIEW_METRICS, derived.metrics);
  write(path.join(FIXTURE, "report-v1.json"), derived.report);
  write(TRACKED_REVIEW_MANIFEST, expectedReviewPublicationManifest());
  if (sealFixture) await seal();
  return derived.metrics;
}
function expectedReceiptSeal(receipt: any) {
  return {
    schema_version: "ground_originals_publication_receipt_seal_v1.0.0",
    status: "sealed_verified_readback_receipt",
    receipt_input_sha256: sha256(fs.readFileSync(PUBLICATION_RECEIPT_INPUT)),
    archive_sha256: receipt.sha256,
    archive_bytes: receipt.bytes,
    object_key: receipt.object_key,
    seal_sha256: sha256(json(receipt) + "\n"),
  };
}
function publicationForBundle(bundleHash: string, bundleBytes: number) {
  if (!fs.existsSync(PUBLICATION_RECEIPT_SEAL))
    return {
      status: "unpublished",
      receipt_input_sha256: null,
      receipt_seal_sha256: null,
    };
  const { receipt, seal } = validatePublicationReceiptFiles();
  assert(seal !== null, "publication receipt seal missing");
  const expected = expectedReceiptSeal(receipt);
  assert(
    receipt.sha256 === bundleHash && receipt.bytes === bundleBytes,
    "publication receipt does not match built archive",
  );
  return {
    status: "published_readback_verified",
    receipt_input_sha256: expected.receipt_input_sha256,
    receipt_seal_sha256: sha256(fs.readFileSync(PUBLICATION_RECEIPT_SEAL)),
    provider: receipt.provider,
    bucket: receipt.bucket,
    object_key: receipt.object_key,
    locator: `r2://${receipt.bucket}/${receipt.object_key}`,
    sha256: receipt.sha256,
    bytes: receipt.bytes,
    readback_status: receipt.readback_status,
  };
}
export function sealPublication() {
  const receipt = receiptInput(),
    gz = fs.readFileSync(ARCHIVE);
  assert(
    receipt.provider === "cloudflare_r2" &&
      receipt.bucket === "wiel-codex-worker-cache",
    "publication provider/bucket",
  );
  assert(
    receipt.object_key ===
      `artifacts/mtl-archives/ground-originals-v1/${receipt.sha256}.tar.gz`,
    "publication key is not hash-bound",
  );
  assert(
    receipt.sha256 === sha256(gz) && receipt.bytes === gz.length,
    "publication receipt archive mismatch",
  );
  assert(
    receipt.readback_status === "verified_sha256_and_bytes",
    "publication readback not verified",
  );
  const seal = expectedReceiptSeal(receipt);
  validateReceiptSealValue(seal);
  write(PUBLICATION_RECEIPT_SEAL, seal);
  return seal;
}
export function verifyBundle(archive = ARCHIVE) {
  validatePublicationReceiptFiles();
  const descriptor = JSON.parse(
    fs.readFileSync(
      path.join(FIXTURE, "full-originals-archive-descriptor-v1.json"),
      "utf8",
    ),
  );
  const archivePath = path.isAbsolute(archive)
    ? archive
    : path.join(ROOT, archive);
  const gz = fs.readFileSync(archivePath);
  assert(sha256(gz) === descriptor.sha256, "archive hash mismatch");
  assert(gz.length === descriptor.bytes, "archive byte count mismatch");
  assert(
    json(descriptor.publication) ===
      json(publicationForBundle(descriptor.sha256, descriptor.bytes)),
    "archive descriptor publication receipt mismatch",
  );
  const rows = parseTar(zlib.gunzipSync(gz));
  assert(
    json(
      rows.map((r) => ({
        path: r.path,
        bytes: r.bytes.length,
        sha256: sha256(r.bytes),
      })),
    ) === json(descriptor.members),
    "archive exact regular allowlist mismatch",
  );
  return descriptor;
}
function parseTar(tar: Buffer) {
  const out: Array<{ path: string; bytes: Buffer }> = [];
  for (let off = 0; off < tar.length; ) {
    const h = tar.subarray(off, off + 512);
    assert(h.length === 512, "truncated tar header");
    if (h.every((x) => x === 0)) {
      assert(
        tar.subarray(off).every((x) => x === 0),
        "data after tar terminator",
      );
      break;
    }
    const name = h.subarray(0, 100).toString().replace(/\0.*$/s, ""),
      type = h[156],
      size = parseInt(
        h.subarray(124, 136).toString().replace(/\0.*$/s, "").trim(),
        8,
      );
    assert(type === 0x30 || type === 0, "archive member not regular");
    assert(
      name &&
        !path.isAbsolute(name) &&
        !name.includes("\\") &&
        !name.split("/").includes(".."),
      "unsafe archive path",
    );
    assert(!out.some((x) => x.path === name), "duplicate archive member");
    assert(Number.isSafeInteger(size) && size >= 0, "tar size");
    const start = off + 512,
      end = start + size;
    assert(end <= tar.length, "truncated tar body");
    out.push({ path: name, bytes: tar.subarray(start, end) });
    off = start + Math.ceil(size / 512) * 512;
  }
  return out;
}
export function restore(archive = ARCHIVE, destination = ORIGINALS) {
  const archivePath = path.isAbsolute(archive)
    ? archive
    : path.join(ROOT, archive);
  const destinationPath = path.isAbsolute(destination)
    ? destination
    : path.join(ROOT, destination);
  assertNoSymlinkComponents(archivePath, true, "archive");
  const descriptor = JSON.parse(
      fs.readFileSync(
        path.join(FIXTURE, "full-originals-archive-descriptor-v1.json"),
        "utf8",
      ),
    ),
    gz = fs.readFileSync(archivePath);
  assert(
    sha256(gz) === descriptor.sha256,
    "archive hash mismatch before extraction",
  );
  const rows = parseTar(zlib.gunzipSync(gz)),
    allow = new Map(descriptor.members.map((x: any) => [x.path, x]));
  assert(rows.length === allow.size, "archive allowlist cardinality");
  const destinationParent = path.dirname(destinationPath);
  assertNoSymlinkComponents(destinationParent, true, "destination parent");
  const realParent = fs.realpathSync(destinationParent);
  assert(
    path.dirname(path.resolve(destinationPath)) ===
      path.resolve(destinationParent),
    "destination parent containment",
  );
  if (lstatMaybe(destinationPath)) {
    assertNoSymlinkComponents(destinationPath, true, "destination");
    assert(
      fs.lstatSync(destinationPath).isDirectory(),
      "destination must be directory",
    );
  } else {
    fs.mkdirSync(destinationPath, { mode: 0o700 });
  }
  const realDestination = fs.realpathSync(destinationPath);
  assert(
    path.dirname(realDestination) === realParent,
    "destination real parent mismatch",
  );
  for (const r of rows) {
    const expected: any = allow.get(r.path);
    assert(expected, "archive member outside allowlist");
    assert(
      r.bytes.length === expected.bytes && sha256(r.bytes) === expected.sha256,
      "archive member hash/bytes",
    );
    const target = path.join(destinationPath, path.basename(r.path));
    const existing = lstatMaybe(target);
    if (existing) {
      assert(!existing.isSymbolicLink(), "restore target symlink is forbidden");
      assert(existing.isFile(), "restore target must be regular file");
      assert(
        sha256(fs.readFileSync(target)) === expected.sha256,
        "overwrite mismatch",
      );
    } else {
      const fd = fs.openSync(
        target,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      try {
        fs.writeFileSync(fd, r.bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
  }
  return rows.length;
}
function lstatMaybe(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (e: any) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}
function assertNoSymlinkComponents(
  target: string,
  mustExist: boolean,
  label: string,
) {
  const absolute = path.resolve(target),
    parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const stat = lstatMaybe(current);
    if (!stat) {
      assert(!mustExist, `${label} component missing: ${current}`);
      return;
    }
    assert(!stat.isSymbolicLink(), `${label} symlink is forbidden: ${current}`);
  }
}
export async function verify(full = false, allowPublicationReset = false) {
  for (const x of Object.values(PREDECESSORS))
    assert(
      sha256(fs.readFileSync(path.join(ROOT, x.path))) === x.sha256,
      `predecessor drift: ${x.path}`,
    );
  validateSchemas();
  const d = JSON.parse(
      fs.readFileSync(path.join(FIXTURE, "descriptor-v1.json"), "utf8"),
    ),
    m = members(FIXTURE, ["descriptor-v1.json"]);
  assert(
    json(m) === json(d.members) && tree(m) === d.tree_sha256,
    "fixture descriptor mismatch",
  );
  const archiveDescriptorPath = path.join(
    FIXTURE,
    "full-originals-archive-descriptor-v1.json",
  );
  if (fs.existsSync(archiveDescriptorPath) && !allowPublicationReset) {
    const archiveDescriptor = JSON.parse(
      fs.readFileSync(archiveDescriptorPath, "utf8"),
    );
    assert(
      json(archiveDescriptor.publication) ===
        json(
          publicationForBundle(
            archiveDescriptor.sha256,
            archiveDescriptor.bytes,
          ),
        ),
      "archive publication is not backed by receipt seal",
    );
  }
  const records = JSON.parse(
    fs.readFileSync(path.join(FIXTURE, "records-v1.json"), "utf8"),
  ).records;
  assert(json(records.map((r: any) => r.id)) === json(IDS), "exact IDs");
  for (const r of records) {
    const s = SOURCES.find((x) => x.id === r.id)!;
    assert(
      r.cote === s.cote && r.url === s.url && r.prefix === s.prefix,
      "source identity",
    );
    assert(
      r.regions.every(
        (x: any) =>
          x.native_xyxy.every((n: number) => Number.isInteger(n) && n >= 0) &&
          (!x.normalized_xyxy ||
            x.normalized_xyxy.every((n: number) => n >= 0 && n <= 1)),
      ),
      "region geometry",
    );
    const o = JSON.parse(
      fs.readFileSync(path.join(FIXTURE, r.ocr_path), "utf8"),
    );
    assert(o.status === "proposal_only_not_accepted_evidence", "OCR promotion");
    assert(r.rights.license_lineage.length === 2, "rights lineage");
    for (const lineage of r.rights.license_lineage)
      assert(
        sha256(fs.readFileSync(path.join(ROOT, lineage.path))) ===
          lineage.sha256,
        "rights snapshot drift",
      );
    assert(
      fs.existsSync(path.join(FIXTURE, r.review.path)) &&
        fs.existsSync(path.join(FIXTURE, r.ocr_path)),
      "record path reference missing",
    );
  }
  const review = JSON.parse(
    fs.readFileSync(
      path.join(FIXTURE, "independent-review-input-v1.json"),
      "utf8",
    ),
  );
  const pendingReviewRows = [...review.scenes, ...review.crops];
  assert(
    review.scenes.length === 6 &&
      review.crops.length === 2 &&
      pendingReviewRows.every(
        (x: any) =>
          !("numeric_id" in x) &&
          !("cote" in x) &&
          !("url" in x) &&
          x.decision === null &&
          x.reviewer_id === null,
      ),
    "neutral review copying/promotion",
  );
  for (const crop of review.crops) {
    const cropBytes = fs.readFileSync(path.join(FIXTURE, crop.crop_path)),
      cropMetadata = await sharp(cropBytes).metadata();
    assert(
      sha256(cropBytes) === crop.crop_sha256 &&
        cropMetadata.width === crop.width &&
        cropMetadata.height === crop.height,
      "neutral crop binding mismatch",
    );
  }
  const research = JSON.parse(
    fs.readFileSync(path.join(FIXTURE, "research-candidates-v1.json"), "utf8"),
  );
  for (const row of research.rows)
    for (const seed of row.query_seeds) {
      const locator = seed.source_locator.split("#")[0];
      const target =
        locator === "records-v1.json"
          ? path.join(FIXTURE, locator)
          : locator.startsWith("real-pilot-intelligence-v1/")
            ? path.join(ROOT, "docs/dataset-factory/fixtures", locator)
            : locator.startsWith("originals/")
              ? path.join(DATA, locator)
              : null;
      assert(
        target && fs.existsSync(target),
        `research trigger locator missing: ${seed.source_locator}`,
      );
    }
  assert(
    research.external_claims === 0 &&
      json(research.rows) === json(researchCandidates()) &&
      research.rows.every(
        (x: any) =>
          x.status === "pending" &&
          x.candidate_urls === null &&
          x.claims.length === 0,
      ),
    "research claim promotion",
  );
  const neutralText = json(review);
  assert(
    !/CATELLI|CASTROL|WHITE ROSE|EGG NOODLES|VM94|mtl_archives|https?:\/\/|depot\.ville|archive_cote|numeric_id|record_id|region_id/i.test(
      neutralText,
    ),
    "identity or research conclusion leaked into neutral review",
  );
  const trustedMap = JSON.parse(
      fs.readFileSync(
        path.join(FIXTURE, "trusted-neutral-map-v1.json"),
        "utf8",
      ),
    ),
    expectedTrustedScenes = records.map((record: any) => ({
      neutral_id: record.neutral_id,
      numeric_id: record.id,
      record_id: `mtl_archives_metadata_${record.id}.json`,
      review_path: record.review.path,
      review_sha256: record.review.sha256,
      ocr_proposal_path: record.ocr_path,
    })),
    expectedTrustedCrops: any[] = [];
  for (const record of records)
    for (const region of record.regions.filter(
      (candidate: any) => candidate.region_id !== "whole",
    )) {
      const neutralCropId = `ground-crop-${String(expectedTrustedCrops.length + 1).padStart(2, "0")}`,
        cropInput = review.crops.find(
          (candidate: any) => candidate.neutral_crop_id === neutralCropId,
        );
      assert(cropInput, "trusted crop has no neutral review input");
      expectedTrustedCrops.push({
        neutral_crop_id: neutralCropId,
        parent_neutral_id: record.neutral_id,
        numeric_id: record.id,
        region_id: region.region_id,
        native_xyxy: region.native_xyxy,
        crop_path: cropInput.crop_path,
        crop_sha256: cropInput.crop_sha256,
      });
    }
  assert(
    json(trustedMap.scenes) === json(expectedTrustedScenes) &&
      json(trustedMap.crops) === json(expectedTrustedCrops),
    "trusted neutral mapping coordinated change",
  );
  const row105 = research.rows.find((x: any) => x.numeric_id === 105);
  assert(
    row105.query_seeds.some(
      (x: any) =>
        x.literal === "CATELLI" &&
        x.source_kind === "full_resolution_visible_text",
    ),
    "CATELLI trigger boundary",
  );
  assert(
    !row105.query_seeds.some((x: any) => /CASTROL/i.test(x.literal)),
    "CASTROL promoted to query seed",
  );
  assert(
    row105.rejected_hypotheses.length === 1 &&
      row105.rejected_hypotheses[0].literal === "CASTROL" &&
      row105.rejected_hypotheses[0].status ===
        "rejected_false_precision_hypothesis",
    "CASTROL rejection boundary",
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(FIXTURE, "report-v1.json"), "utf8"),
  );
  let expectedReport: any = pendingReport();
  if (fs.existsSync(TRACKED_REVIEW_DECISIONS)) {
    const published = derivePublishedReviewArtifacts(
      TRACKED_REVIEW_DECISIONS,
      TRACKED_REVIEW_DECISIONS_SEAL,
    );
    assert(
      json(
        JSON.parse(fs.readFileSync(TRACKED_REVIEW_TRANSCRIPTIONS, "utf8")),
      ) === json(published.transcriptions) &&
        json(JSON.parse(fs.readFileSync(TRACKED_REVIEW_METRICS, "utf8"))) ===
          json(published.metrics),
      "published independent review derived artifacts mismatch",
    );
    assert(
      json(JSON.parse(fs.readFileSync(TRACKED_REVIEW_MANIFEST, "utf8"))) ===
        json(expectedReviewPublicationManifest()),
      "independent review publication manifest mismatch",
    );
    expectedReport = published.report;
  }
  assert(json(report) === json(expectedReport), "truthful report");
  if (full) {
    const a = acquisition();
    const expectedReviewBuffers: Buffer[] = [],
      expectedNeutralCrops: any[] = [];
    assert(
      a.rows.length === 6 && a.total_bytes <= MAX_TOTAL,
      "full acquisition",
    );
    for (const r of a.rows) {
      const b = fs.readFileSync(path.join(ORIGINALS, r.file));
      const decoded = await inspectJpeg(b);
      assert(
        b.length === r.bytes &&
          sha256(b) === r.sha256 &&
          sha256(b.subarray(0, 4096)) === r.prefix &&
          json(decoded) === json(r.decode),
        "full/prefix hash mismatch",
      );
      const source = SOURCES.find((x) => x.id === r.id)!;
      assert(
        r.transport.head.requested_url === source.url &&
          r.transport.head.effective_url === source.url &&
          r.transport.full_get.requested_url === source.url &&
          r.transport.full_get.effective_url === source.url,
        "HEAD/GET effective URL mismatch",
      );
      assert(
        r.transport.head.etag === r.etag &&
          r.transport.head.last_modified === r.last_modified &&
          r.transport.head.content_length === r.bytes,
        "HEAD validator/object identity mismatch",
      );
      assert(
        r.transport.full_get.etag === null &&
          r.transport.full_get.last_modified === null &&
          r.transport.full_get.validators_retained === false,
        "full GET omission rule mismatch",
      );
      const record = records.find((x: any) => x.id === r.id);
      assert(
        record &&
          json(record.decode) === json(decoded) &&
          record.bytes === b.length &&
          record.sha256 === sha256(b),
        "record original facts mismatch",
      );
      const predecessorDossier = read(
        `docs/dataset-factory/fixtures/real-pilot-intelligence-v1/dossiers/${r.id}.json`,
      );
      const predecessorPixels = fs.readFileSync(
        path.join(ROOT, predecessorDossier.pixel_scope.path),
      );
      const predecessorMeta = await sharp(predecessorPixels).metadata();
      assert(
        sha256(predecessorPixels) === predecessorDossier.pixel_scope.sha256 &&
          predecessorMeta.width === 256 &&
          predecessorMeta.height === 256,
        "predecessor derivative pixel binding",
      );
      assert(
        json(record.regions) ===
          json(
            geometry(r.id, decoded.normalized_width, decoded.normalized_height),
          ),
        "region transform mismatch",
      );
      const expectedReview = await boundedJpeg(
        sharp(b).rotate().resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        }),
      );
      expectedReviewBuffers.push(expectedReview);
      assert(
        sha256(expectedReview) === record.review.sha256 &&
          expectedReview.length === record.review.bytes &&
          sha256(fs.readFileSync(path.join(FIXTURE, record.review.path))) ===
            record.review.sha256,
        "review derivative mismatch",
      );
      const reviewMeta = await sharp(expectedReview).metadata();
      assert(
        reviewMeta.width && reviewMeta.height,
        "expected review dimensions",
      );
      const expectedReviewWidth = reviewMeta.width;
      const expectedReviewHeight = reviewMeta.height;
      const expectedRights = {
        asset_source_url: r.url,
        archive_cote: r.cote,
        attribution: "Archives de la Ville de Montreal",
        license_id: "cc-by-4.0",
        license_lineage: [
          {
            path: "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/snapshot/license_page.html",
            sha256:
              "8d5838a3b7490fae99f7e2d353fcd5c16013dc0cd37434e76e76dd2c1bcaf810",
          },
          {
            path: "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/snapshot/cc_by.html",
            sha256:
              "231a5dac65bbf135ba27145969a63cd289faadc172f1512c4810a6c60ba91036",
          },
        ],
        scope: "rights lineage only; no historical or visual claim",
      };
      const expectedRecord = {
        ...r,
        review: {
          path: record.review.path,
          bytes: expectedReview.length,
          sha256: sha256(expectedReview),
          width: expectedReviewWidth,
          height: expectedReviewHeight,
        },
        regions: geometry(
          r.id,
          decoded.normalized_width,
          decoded.normalized_height,
        ),
        ocr_path: `ocr-${r.id}.json`,
        neutral_id: record.neutral_id,
        rights: expectedRights,
      };
      assert(
        json(record) === json(expectedRecord),
        "coordinated record reseal mismatch",
      );
      const storedOcr = JSON.parse(
        fs.readFileSync(path.join(FIXTURE, record.ocr_path), "utf8"),
      );
      for (const region of record.regions.filter(
        (x: any) => x.region_id !== "whole",
      )) {
        const [x0, y0, x1, y1] = region.native_xyxy;
        const expectedCrop = await boundedJpeg(
          sharp(b)
            .rotate()
            .extract({
              left: x0,
              top: y0,
              width: x1 - x0 + 1,
              height: y1 - y0 + 1,
            })
            .resize({
              width: 1200,
              height: 1200,
              fit: "inside",
              withoutEnlargement: true,
            }),
        );
        const neutralCropId = `ground-crop-${String(expectedNeutralCrops.length + 1).padStart(2, "0")}`,
          cropPath = `crops/${neutralCropId}.jpg`,
          cropMetadata = await sharp(expectedCrop).metadata();
        assert(
          cropMetadata.width && cropMetadata.height,
          "expected crop dimensions",
        );
        assert(
          sha256(fs.readFileSync(path.join(FIXTURE, cropPath))) ===
            sha256(expectedCrop),
          "crop coordinated reseal mismatch",
        );
        expectedNeutralCrops.push({
          neutral_crop_id: neutralCropId,
          parent_neutral_id: record.neutral_id,
          crop_path: cropPath,
          crop_sha256: sha256(expectedCrop),
          width: cropMetadata.width,
          height: cropMetadata.height,
          machine_ocr_proposal: cropMachineProposal(
            storedOcr,
            region.native_xyxy,
          ),
          numeric_id: r.id,
          region_id: region.region_id,
          native_xyxy: region.native_xyxy,
        });
      }
      const svg = Buffer.from(
        `<svg width="${expectedReviewWidth}" height="${expectedReviewHeight}">${record.regions
          .filter((x: any) => x.region_id !== "whole")
          .map((region: any) => {
            const [x0, y0, x1, y1] = region.normalized_xyxy;
            return `<rect x="${x0 * expectedReviewWidth}" y="${y0 * expectedReviewHeight}" width="${(x1 - x0) * expectedReviewWidth}" height="${(y1 - y0) * expectedReviewHeight}" fill="none" stroke="red" stroke-width="4"/>`;
          })
          .join("")}</svg>`,
      );
      const expectedOverlay = await boundedJpeg(
        sharp(expectedReview).composite([{ input: svg, top: 0, left: 0 }]),
      );
      assert(
        sha256(
          fs.readFileSync(path.join(FIXTURE, "overlays", `${r.id}.jpg`)),
        ) === sha256(expectedOverlay),
        "overlay coordinated reseal mismatch",
      );
      const expectedOcr = runOcr(
        path.join(ORIGINALS, r.file),
        r.id,
        record.regions,
        decoded.normalized_width,
        decoded.normalized_height,
      );
      assert(
        json(expectedOcr) ===
          json(
            JSON.parse(
              fs.readFileSync(path.join(FIXTURE, record.ocr_path), "utf8"),
            ),
          ),
        "OCR coordinated reseal mismatch",
      );
    }
    const thumbs = await Promise.all(
      expectedReviewBuffers.map(async (input, i) => ({
        input: await sharp(input)
          .resize({
            width: 480,
            height: 480,
            fit: "contain",
            background: "white",
          })
          .jpeg({ quality: 65, mozjpeg: true })
          .toBuffer(),
        left: (i % 3) * 480,
        top: Math.floor(i / 3) * 480,
      })),
    );
    const expectedSheet = await boundedJpeg(
      sharp({
        create: { width: 1440, height: 960, channels: 3, background: "white" },
      }).composite(thumbs),
    );
    assert(
      sha256(fs.readFileSync(path.join(FIXTURE, "contact-sheet.jpg"))) ===
        sha256(expectedSheet),
      "contact sheet coordinated reseal mismatch",
    );
    const map = JSON.parse(
      fs.readFileSync(
        path.join(FIXTURE, "trusted-neutral-map-v1.json"),
        "utf8",
      ),
    );
    assert(
      json(map.scenes) ===
        json(
          records.map((r: any) => ({
            neutral_id: r.neutral_id,
            numeric_id: r.id,
            record_id: `mtl_archives_metadata_${r.id}.json`,
            review_path: r.review.path,
            review_sha256: r.review.sha256,
            ocr_proposal_path: r.ocr_path,
          })),
        ) &&
        json(map.crops) ===
          json(
            expectedNeutralCrops.map((crop) => ({
              neutral_crop_id: crop.neutral_crop_id,
              parent_neutral_id: crop.parent_neutral_id,
              numeric_id: crop.numeric_id,
              region_id: crop.region_id,
              native_xyxy: crop.native_xyxy,
              crop_path: crop.crop_path,
              crop_sha256: crop.crop_sha256,
            })),
          ),
      "trusted neutral mapping mismatch",
    );
    const expectedReviewRows = records.map((r: any) => ({
      neutral_id: r.neutral_id,
      review_path: r.review.path,
      review_sha256: r.review.sha256,
      width: r.review.width,
      height: r.review.height,
      decision: null,
      reviewer_id: null,
      status: "pending",
    }));
    assert(
      json(review.scenes) === json(expectedReviewRows) &&
        json(review.crops) ===
          json(
            expectedNeutralCrops.map((crop) => ({
              neutral_crop_id: crop.neutral_crop_id,
              parent_neutral_id: crop.parent_neutral_id,
              crop_path: crop.crop_path,
              crop_sha256: crop.crop_sha256,
              width: crop.width,
              height: crop.height,
              machine_ocr_proposal: crop.machine_ocr_proposal,
              decision: null,
              reviewer_id: null,
              status: "pending",
            })),
          ),
      "neutral review coordinated reseal mismatch",
    );
    for (const row of review.scenes) {
      assert(
        /^review\/ground-review-0[1-6]\.jpg$/.test(row.review_path) &&
          !/[0-9]{3,}/.test(row.review_path),
        "review filename identity leak",
      );
    }
    for (const crop of review.crops)
      assert(
        /^crops\/ground-crop-0[12]\.jpg$/.test(crop.crop_path),
        "crop filename identity leak",
      );
  }
  return d;
}
export async function selfTest() {
  const bad = [
    "http://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z2.jpg",
    "https://x:y@depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z2.jpg",
    "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z2.jpg?q=1",
    "https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z2.jpg#x",
    "https://depot.ville.montreal.qc.ca/other.jpg",
  ];
  for (const u of bad) assertThrows(() => safeUrl(u));
  const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await assertRejects(() => inspectJpeg(tiny));
  const base = Buffer.concat([
    tarHeader("../x", 1),
    Buffer.from("x"),
    Buffer.alloc(511),
    Buffer.alloc(1024),
  ]);
  assertThrows(() => parseTar(base));
  const symlink = tarHeader("originals/0.jpg", 0);
  symlink[156] = 0x32;
  assertThrows(() => parseTar(Buffer.concat([symlink, Buffer.alloc(1024)])));
  const dup = Buffer.concat([
    tarHeader("originals/0.jpg", 0),
    tarHeader("originals/0.jpg", 0),
    Buffer.alloc(1024),
  ]);
  assertThrows(() => parseTar(dup));
  assertThrows(() => publicationForBundle("0".repeat(64), 1));
  const validReceipt = JSON.parse(
      fs.readFileSync(PUBLICATION_RECEIPT_INPUT, "utf8"),
    ),
    validReceiptSeal = JSON.parse(
      fs.readFileSync(PUBLICATION_RECEIPT_SEAL, "utf8"),
    );
  for (const mutate of [
    (value: any) => (value.unknown_field = "forbidden"),
    (value: any) => (value.schema_version = "changed"),
    (value: any) => (value.source = "changed"),
    (value: any) => (value.contains_secrets_or_links = true),
  ]) {
    const attacked = structuredClone(validReceipt);
    mutate(attacked);
    assertThrows(() => validateReceiptInputValue(attacked));
  }
  for (const mutate of [
    (value: any) => (value.unknown_field = "forbidden"),
    (value: any) => (value.schema_version = "changed"),
    (value: any) => (value.status = "changed"),
    (value: any) => (value.receipt_input_sha256 = "0".repeat(64)),
  ]) {
    const attacked = structuredClone(validReceiptSeal);
    mutate(attacked);
    assertThrows(() => validateReceiptSealValue(attacked));
  }
  const receiptBytes = fs.readFileSync(PUBLICATION_RECEIPT_INPUT),
    receiptSealBytes = fs.readFileSync(PUBLICATION_RECEIPT_SEAL),
    archiveDescriptorPath = path.join(
      FIXTURE,
      "full-originals-archive-descriptor-v1.json",
    ),
    archiveDescriptorBytes = fs.readFileSync(archiveDescriptorPath),
    fixtureDescriptorPath = path.join(FIXTURE, "descriptor-v1.json"),
    fixtureDescriptorBytes = fs.readFileSync(fixtureDescriptorPath),
    archiveBytes = fs.readFileSync(ARCHIVE);
  const assertReceiptRuntimeRejection = async (inputInvalid: boolean) => {
    if (inputInvalid) {
      assertThrows(() => receiptInput());
      assertThrows(() => sealPublication());
    } else receiptInput();
    assertThrows(() =>
      publicationForBundle(sha256(archiveBytes), archiveBytes.length),
    );
    assertThrows(() => verifyBundle());
    await assertRejects(() => verify(false));
    await assertRejects(() => verify(true));
    await assertRejects(() => buildBundle());
    assert(
      sha256(fs.readFileSync(ARCHIVE)) === sha256(archiveBytes),
      "rejected receipt attack changed archive",
    );
  };
  try {
    for (const mutate of [
      (value: any) => (value.unknown_field = "forbidden"),
      (value: any) => (value.schema_version = "changed"),
      (value: any) => (value.source = "changed"),
      (value: any) => (value.contains_secrets_or_links = true),
    ]) {
      const attacked = structuredClone(validReceipt);
      mutate(attacked);
      write(PUBLICATION_RECEIPT_INPUT, attacked);
      await assertReceiptRuntimeRejection(true);
      fs.writeFileSync(PUBLICATION_RECEIPT_INPUT, receiptBytes);
    }
    for (const mutate of [
      (value: any) => (value.unknown_field = "forbidden"),
      (value: any) => (value.schema_version = "changed"),
      (value: any) => (value.status = "changed"),
      (value: any) => (value.receipt_input_sha256 = "0".repeat(64)),
    ]) {
      const attacked = structuredClone(validReceiptSeal);
      mutate(attacked);
      write(PUBLICATION_RECEIPT_SEAL, attacked);
      await assertReceiptRuntimeRejection(false);
      fs.writeFileSync(PUBLICATION_RECEIPT_SEAL, receiptSealBytes);
    }

    const forgedReceipt = structuredClone(validReceipt);
    forgedReceipt.source = "coordinated_reseal_attack";
    write(PUBLICATION_RECEIPT_INPUT, forgedReceipt);
    const forgedSeal = {
      ...validReceiptSeal,
      receipt_input_sha256: sha256(fs.readFileSync(PUBLICATION_RECEIPT_INPUT)),
      seal_sha256: sha256(json(forgedReceipt) + "\n"),
    };
    write(PUBLICATION_RECEIPT_SEAL, forgedSeal);
    const forgedArchiveDescriptor = JSON.parse(
      archiveDescriptorBytes.toString("utf8"),
    );
    forgedArchiveDescriptor.publication.receipt_input_sha256 =
      forgedSeal.receipt_input_sha256;
    forgedArchiveDescriptor.publication.receipt_seal_sha256 = sha256(
      fs.readFileSync(PUBLICATION_RECEIPT_SEAL),
    );
    write(archiveDescriptorPath, forgedArchiveDescriptor);
    const forgedMembers = members(FIXTURE, ["descriptor-v1.json"]),
      forgedFixtureDescriptor = JSON.parse(
        fixtureDescriptorBytes.toString("utf8"),
      );
    forgedFixtureDescriptor.members = forgedMembers;
    forgedFixtureDescriptor.tree_sha256 = tree(forgedMembers);
    forgedFixtureDescriptor.counts.files = forgedMembers.length;
    forgedFixtureDescriptor.counts.bytes = forgedMembers.reduce(
      (sum, member) => sum + member.bytes,
      0,
    );
    write(fixtureDescriptorPath, forgedFixtureDescriptor);
    await assertReceiptRuntimeRejection(true);
  } finally {
    fs.writeFileSync(PUBLICATION_RECEIPT_INPUT, receiptBytes);
    fs.writeFileSync(PUBLICATION_RECEIPT_SEAL, receiptSealBytes);
    fs.writeFileSync(archiveDescriptorPath, archiveDescriptorBytes);
    fs.writeFileSync(fixtureDescriptorPath, fixtureDescriptorBytes);
  }
  try {
    const forgedArchiveDescriptor = JSON.parse(
      archiveDescriptorBytes.toString("utf8"),
    );
    forgedArchiveDescriptor.publication.receipt_input_sha256 = "0".repeat(64);
    write(archiveDescriptorPath, forgedArchiveDescriptor);
    const forgedMembers = members(FIXTURE, ["descriptor-v1.json"]),
      forgedFixtureDescriptor = JSON.parse(
        fixtureDescriptorBytes.toString("utf8"),
      );
    forgedFixtureDescriptor.members = forgedMembers;
    forgedFixtureDescriptor.tree_sha256 = tree(forgedMembers);
    forgedFixtureDescriptor.counts.files = forgedMembers.length;
    forgedFixtureDescriptor.counts.bytes = forgedMembers.reduce(
      (sum, member) => sum + member.bytes,
      0,
    );
    write(fixtureDescriptorPath, forgedFixtureDescriptor);
    assertThrows(() => verifyBundle());
    await assertRejects(() => verify(false));
    await assertRejects(() => verify(true));
  } finally {
    fs.writeFileSync(archiveDescriptorPath, archiveDescriptorBytes);
    fs.writeFileSync(fixtureDescriptorPath, fixtureDescriptorBytes);
  }
  const reviewInput = independentReviewInput(),
    validIndependentDecisions = {
      schema_version: "ground_originals_independent_review_decisions_v1.0.0",
      input_sha256: sha256(fs.readFileSync(INDEPENDENT_REVIEW_INPUT)),
      reviewer_id: "independent-reviewer-adversarial-test",
      review_session_id: "independent-session-adversarial-test",
      reviewer_role: "independent_external_reviewer",
      reviewer_independence_confirmed: true,
      primary_decisions_consulted: false,
      copied_from_primary_decisions: false,
      identity_claims: [],
      scenes: reviewInput.scenes.map((row: any) => ({
        neutral_id: row.neutral_id,
        suitability: "suitable",
        mode: "scene_pixel_and_ocr_context",
        abstained: false,
        reason: "Independent test decision based only on the blinded image.",
      })),
      crops: reviewInput.crops.map((row: any) => ({
        neutral_crop_id: row.neutral_crop_id,
        decision: "reject",
        literal_text: null,
        alternatives: [],
        legibility: "illegible",
        reason: "Independent test decision does not accept a transcription.",
      })),
    };
  validateIndependentReviewDecisionsValue(validIndependentDecisions);
  for (const attack of [
    (value: any) => (value.copied_from_primary_decisions = true),
    (value: any) => (value.primary_decisions_consulted = true),
    (value: any) =>
      (value.reviewer_id =
        "sol-high-primary-019f57f4-0222-7750-8a88-330fdf3a74cc"),
    (value: any) => (value.review_session_id = value.reviewer_id),
    (value: any) => (value.input_sha256 = "0".repeat(64)),
    (value: any) => value.scenes.pop(),
    (value: any) => value.crops.push(structuredClone(value.crops[0])),
  ]) {
    const attacked = structuredClone(validIndependentDecisions);
    attack(attacked);
    assertThrows(() =>
      validateIndependentReviewDecisionsValue(attacked, reviewInput),
    );
  }
  const unreviewedAcceptance = structuredClone(validIndependentDecisions);
  unreviewedAcceptance.crops[0] = {
    ...unreviewedAcceptance.crops[0],
    decision: "accept",
    literal_text: "unreviewed text",
    legibility: "clear",
  };
  assertThrows(() =>
    validateIndependentReviewDecisionsValue(unreviewedAcceptance, reviewInput),
  );
  const leakedInput = structuredClone(reviewInput);
  leakedInput.crops[0].machine_ocr_proposal.text = "CATELLI";
  leakedInput.crops[0].machine_ocr_proposal.confidence = 99;
  assertThrows(() => validateIndependentReviewInputValue(leakedInput));
  const leakedPathInput = structuredClone(reviewInput);
  leakedPathInput.crops[0].crop_path = "crops/105-CATELLI.jpg";
  assertThrows(() => validateIndependentReviewInputValue(leakedPathInput));
  const leakedMetadataInput = structuredClone(reviewInput);
  leakedMetadataInput.scenes[0].cote = "VM94,forbidden";
  assertThrows(() => validateIndependentReviewInputValue(leakedMetadataInput));
  const priorDecisions = fs.existsSync(INDEPENDENT_REVIEW_DECISIONS)
      ? fs.readFileSync(INDEPENDENT_REVIEW_DECISIONS)
      : null,
    priorDecisionSeal = fs.existsSync(INDEPENDENT_REVIEW_DECISIONS_SEAL)
      ? fs.readFileSync(INDEPENDENT_REVIEW_DECISIONS_SEAL)
      : null,
    trackedDecisionHash = sha256(fs.readFileSync(TRACKED_REVIEW_DECISIONS)),
    trackedDecisionSealHash = sha256(
      fs.readFileSync(TRACKED_REVIEW_DECISIONS_SEAL),
    );
  assert(
    priorDecisions && priorDecisionSeal,
    "published review self-test requires external evidence",
  );
  try {
    fs.rmSync(INDEPENDENT_REVIEW_DECISIONS, { force: true });
    fs.rmSync(INDEPENDENT_REVIEW_DECISIONS_SEAL, { force: true });
    assertThrows(() => verifyIndependentReview());
    await assertRejects(() => publishIndependentReview());
    await assertRejects(() => derive());
    write(INDEPENDENT_REVIEW_DECISIONS, validIndependentDecisions);
    assertThrows(() => verifyIndependentReview());
    assertThrows(() => sealIndependentReview());
    await assertRejects(() => publishIndependentReview());
    await assertRejects(() => derive());
    fs.writeFileSync(INDEPENDENT_REVIEW_DECISIONS, priorDecisions);
    fs.writeFileSync(INDEPENDENT_REVIEW_DECISIONS_SEAL, priorDecisionSeal);
    const metrics = verifyIndependentReview();
    assert(
      metrics.identity_claims === 0 &&
        metrics.scenes_reviewed === 6 &&
        metrics.crops_reviewed === 2 &&
        metrics.accepted_transcriptions.length === 2,
      "independent review metrics boundary",
    );
    const validDecisionSeal = JSON.parse(
      fs.readFileSync(INDEPENDENT_REVIEW_DECISIONS_SEAL, "utf8"),
    );
    for (const attack of [
      (value: any) => (value.input_sha256 = "0".repeat(64)),
      (value: any) =>
        (value.reviewer_id = "independent-reviewer-wrong-reviewer"),
      (value: any) =>
        (value.review_session_id = "independent-session-wrong-session"),
    ]) {
      const attacked = structuredClone(validDecisionSeal);
      attack(attacked);
      write(INDEPENDENT_REVIEW_DECISIONS_SEAL, attacked);
      assertThrows(() => verifyIndependentReview());
      await assertRejects(() => publishIndependentReview());
      fs.writeFileSync(INDEPENDENT_REVIEW_DECISIONS_SEAL, priorDecisionSeal);
    }
    assert(
      sha256(fs.readFileSync(TRACKED_REVIEW_DECISIONS)) ===
        trackedDecisionHash &&
        sha256(fs.readFileSync(TRACKED_REVIEW_DECISIONS_SEAL)) ===
          trackedDecisionSealHash,
      "rejected worker review attack changed tracked external bytes",
    );
  } finally {
    if (priorDecisions)
      fs.writeFileSync(INDEPENDENT_REVIEW_DECISIONS, priorDecisions);
    else fs.rmSync(INDEPENDENT_REVIEW_DECISIONS, { force: true });
    if (priorDecisionSeal)
      fs.writeFileSync(INDEPENDENT_REVIEW_DECISIONS_SEAL, priorDecisionSeal);
    else fs.rmSync(INDEPENDENT_REVIEW_DECISIONS_SEAL, { force: true });
  }
  const coordinatedReviewAttack = async (
    targetPath: string,
    mutate: (value: any) => void,
  ) => {
    const targetBytes = fs.readFileSync(targetPath),
      descriptorBytes = fs.readFileSync(fixtureDescriptorPath);
    try {
      const attacked = JSON.parse(targetBytes.toString("utf8"));
      mutate(attacked);
      write(targetPath, attacked);
      const attackedMembers = members(FIXTURE, ["descriptor-v1.json"]),
        attackedDescriptor = JSON.parse(descriptorBytes.toString("utf8"));
      attackedDescriptor.members = attackedMembers;
      attackedDescriptor.tree_sha256 = tree(attackedMembers);
      attackedDescriptor.counts.files = attackedMembers.length;
      attackedDescriptor.counts.bytes = attackedMembers.reduce(
        (sum, member) => sum + member.bytes,
        0,
      );
      write(fixtureDescriptorPath, attackedDescriptor);
      await assertRejects(() => verify(false));
    } finally {
      fs.writeFileSync(targetPath, targetBytes);
      fs.writeFileSync(fixtureDescriptorPath, descriptorBytes);
    }
  };
  await coordinatedReviewAttack(TRACKED_REVIEW_DECISIONS, (value) => {
    value.copied_from_primary_decisions = true;
  });
  await coordinatedReviewAttack(
    path.join(FIXTURE, "trusted-neutral-map-v1.json"),
    (value) => {
      const first = value.crops[0],
        second = value.crops[1];
      [first.region_id, second.region_id] = [second.region_id, first.region_id];
      [first.native_xyxy, second.native_xyxy] = [
        second.native_xyxy,
        first.native_xyxy,
      ];
    },
  );
  await coordinatedReviewAttack(TRACKED_REVIEW_TRANSCRIPTIONS, (value) => {
    value.rows[0].literal_text = "changed transcription";
  });
  await coordinatedReviewAttack(TRACKED_REVIEW_TRANSCRIPTIONS, (value) => {
    value.rows[0].source_region.region_id =
      value.rows[1].source_region.region_id;
  });
  await coordinatedReviewAttack(TRACKED_REVIEW_TRANSCRIPTIONS, (value) => {
    value.rows[0].source_region.original_sha256 = "0".repeat(64);
  });
  await coordinatedReviewAttack(TRACKED_REVIEW_METRICS, (value) => {
    value.identity_claims = 1;
  });
  await coordinatedReviewAttack(
    path.join(FIXTURE, "report-v1.json"),
    (value) => {
      value.independent_review.corrected_transcriptions = 3;
    },
  );
  const t = containTransform(3000, 2132),
    box: [number, number, number, number] = [
      0.10546875, 0.43359375, 0.23828125, 0.48828125,
    ],
    native = derivativeBoxToOriginal(box, t),
    roundtrip = originalBoxToDerivative(native, t);
  assert(
    roundtrip.every((v, i) => Math.abs(v - box[i]) <= 1 / 256),
    "contain transform roundtrip",
  );
  assert(
    native[0] <= 500 &&
      native[2] >= 500 &&
      native[1] <= 950 &&
      native[3] >= 950,
    "CATELLI semantic crop point",
  );
  const white = derivativeBoxToOriginal(
    [0.6953125, 0.515625, 0.95703125, 0.62109375],
    t,
  );
  assert(
    white[0] <= 2400 &&
      white[2] >= 2400 &&
      white[1] <= 1250 &&
      white[3] >= 1250,
    "WHITE ROSE semantic crop point",
  );
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ground-restore-test-")),
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "ground-restore-outside-")),
    link = path.join(temp, "dest");
  fs.symlinkSync(outside, link);
  assertThrows(() => restore(ARCHIVE, link));
  assert(
    fs.readdirSync(outside).length === 0,
    "restore wrote outside through destination symlink",
  );
  fs.unlinkSync(link);
  fs.mkdirSync(link);
  fs.symlinkSync(path.join(outside, "dangling.jpg"), path.join(link, "0.jpg"));
  assertThrows(() => restore(ARCHIVE, link));
  assert(
    !fs.existsSync(path.join(outside, "dangling.jpg")),
    "restore wrote outside through dangling target symlink",
  );
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  const researchPath = path.join(FIXTURE, "research-candidates-v1.json"),
    descriptorPath = path.join(FIXTURE, "descriptor-v1.json"),
    researchBytes = fs.readFileSync(researchPath),
    descriptorBytes = fs.readFileSync(descriptorPath);
  try {
    const forged = JSON.parse(researchBytes.toString("utf8"));
    forged.rows[0].query_seeds[1].literal = "coordinated reseal";
    write(researchPath, forged);
    await seal();
    await assertRejects(() => verify(false));
  } finally {
    fs.writeFileSync(researchPath, researchBytes);
    fs.writeFileSync(descriptorPath, descriptorBytes);
  }
  await verify(false);
  return true;
}
function assertThrows(fn: () => unknown) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, "expected rejection");
}
async function assertRejects(fn: () => Promise<unknown>) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, "expected async rejection");
}
