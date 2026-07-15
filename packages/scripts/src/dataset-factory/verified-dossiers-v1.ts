import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import sharp from "sharp";

type J = any;
type Pin = { path: string; sha256: string; bytes: number };
type TrackedAuthorityReader = {
  readonly readWorking: (relativePath: string) => Buffer | null;
  readonly readCommitted: (relativePath: string) => Buffer | null;
};
type VerifiedAuthorizationAuthority = {
  readonly pin: J;
  readonly authorization: J | null;
  readonly authorizationBytes: Buffer | null;
};
const INTERNAL_AUTHORIZATION_CAPABILITY = Symbol(
  "verified-dossiers-internal-authorization-capability",
);
type InternalAuthorizationCapability = {
  readonly [INTERNAL_AUTHORIZATION_CAPABILITY]: true;
  readonly pin: J;
  readonly authorityReader: TrackedAuthorityReader;
};
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REL = "docs/dataset-factory/fixtures/verified-dossiers-v1";
const FIXTURE = path.join(ROOT, REL);
const REGISTRY = path.join(
  ROOT,
  "docs/dataset-factory/artifact-registry.v0.jsonl",
);
const PRODUCTION_AUTHORIZATION_PIN_REL =
  "docs/dataset-factory/authorities/verified-dossiers-v1/production-authorization-pin-v1.json";
const PRODUCTION_AUTHORIZATION_PIN = path.join(
  ROOT,
  PRODUCTION_AUTHORIZATION_PIN_REL,
);
const PRODUCTION_REVIEWER_AUTHORIZATION_REL =
  "docs/dataset-factory/authorities/verified-dossiers-v1/reviewer-authorization-v1.json";
const PHASE = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/phase-d-scale-v1/candidate-selection-evidence-v1.json",
);
const INPUTS = {
  phase_d: [
    "dfv0_issue69_phase_d_scale_v1_20260713",
    "docs/dataset-factory/fixtures/phase-d-scale-v1/descriptor-v1.json",
  ],
  gate_e: [
    "dfv0_reviewed_source_evidence_v1",
    "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/descriptor-v1.json",
  ],
  gate_f: [
    "dfv0_aerial_source_evidence_authority_v1_publication",
    "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/final-descriptor-v1.json",
  ],
  ground_rights: [
    "dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1",
    "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/descriptor-v1.json",
  ],
  canonical_image_recovery: [
    "canonical_image_recovery_v1",
    "docs/dataset-factory/fixtures/canonical-image-recovery-v1/inspection-derivatives/manifest-v1.json",
  ],
} as const;
const GATE_E_RECEIPT = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json",
);
const GATE_F_RECEIPT = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/independent-source-authority-receipt-v1.json",
);
const GATE_F_LEDGER = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json",
);
const GATE_F_EVIDENCE = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/evidence-ledger-v1.json",
);
const GATE_F_SOURCE_BODIES = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/source-body-evidence-v1.json",
);
const GROUND_RIGHTS_ROOT = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1",
);
const GROUND_RIGHTS_LEDGER = path.join(
  GROUND_RIGHTS_ROOT,
  "source-ledger-v1.json",
);
const GROUND_RIGHTS_VERIFICATION = path.join(
  GROUND_RIGHTS_ROOT,
  "verification-run-v1.json",
);
const SCHEMAS = path.join(
  ROOT,
  "docs/dataset-factory/schemas/verified-dossiers-v1",
);
const VERSION = "verified_dossiers_v1.0.0";
const ID = "dfv0_verified_dossiers_v1_candidate_20260714";
const CREATED = "2026-07-14T00:00:00.000Z";
const AUTHOR = {
  identity: "codex-sol-medium-gate-g-implementation",
  session_id: "issue91-gate-g-implementation-20260714",
  role: "candidate_dossier_author_and_implementation",
};
const MIN_ACCEPTED = 25;
const EXPECTED_HOLDS = [8132, 8134, 8139, 8143];
const REGISTRY_DEPS = [
  "dfv0_issue69_phase_d_scale_v1_20260713",
  "dfv0_reviewed_source_evidence_v1",
  "dfv0_aerial_source_evidence_authority_v1_publication",
  "ccv1_visual_family_graph_recovery_terminal_20260711",
  "dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1",
];
const Ajv2020 = Ajv2020Import as unknown as new (o: J) => {
  compile(s: J): ((v: J) => boolean) & { errors?: J[] };
  addSchema(s: J, key: string): void;
  getSchema(key: string): (((v: J) => boolean) & { errors?: J[] }) | undefined;
};
const addFormats = addFormatsImport as unknown as (a: J) => void;

function canon(v: J): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
    .join(",")}}`;
}
function pretty(v: J): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}
function hash(v: Buffer | string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}
function assert(v: unknown, m: string): asserts v {
  if (!v) throw new Error(m);
}
function load(f: string): J {
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
function filePin(
  f: string,
  p = path.relative(ROOT, f).split(path.sep).join("/"),
): Pin {
  const b = fs.readFileSync(f);
  return { path: p, sha256: hash(b), bytes: b.length };
}
function writeJson(f: string, v: J): void {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, pretty(v));
}
function files(root: string, current = root): string[] {
  return fs
    .readdirSync(current, { withFileTypes: true })
    .flatMap((e) => {
      const a = path.join(current, e.name);
      assert(!e.isSymbolicLink(), `symlink refused: ${a}`);
      return e.isDirectory()
        ? files(root, a)
        : e.isFile()
          ? [path.relative(root, a).split(path.sep).join("/")]
          : [];
    })
    .sort();
}
function tree(root: string, members = files(root)): J {
  const pins = members.map((m) => filePin(path.join(root, m), m));
  return {
    members: pins,
    sha256: hash(
      `${pins.map((p) => `${p.path}\t${p.sha256}\t${p.bytes}`).join("\n")}\n`,
    ),
    bytes: pins.reduce((s, p) => s + p.bytes, 0),
  };
}
function same(a: J, b: J, label: string): void {
  assert(
    canon(a) === canon(b),
    `${label} differs from deterministic derivation`,
  );
}
function esc(v: unknown): string {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function schema(name: string, value: J): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const member of fs
    .readdirSync(SCHEMAS)
    .filter((m) => m.endsWith(".json")))
    ajv.addSchema(load(path.join(SCHEMAS, member)), member);
  const validate = ajv.getSchema(name);
  assert(validate, `schema missing: ${name}`);
  assert(validate(value), `${name}: ${JSON.stringify(validate.errors)}`);
}

function predecessors(): J {
  const result: J = Object.fromEntries(
    Object.entries(INPUTS).map(([key, [artifact_id, rel]]) => [
      key,
      { artifact_id, descriptor: filePin(path.join(ROOT, rel), rel) },
    ]),
  );
  result.phase_d.selection = filePin(
    PHASE,
    path.relative(ROOT, PHASE).split(path.sep).join("/"),
  );
  return result;
}
function forbidden(): J {
  const e = load(GATE_E_RECEIPT).reviewer;
  const f = load(GATE_F_RECEIPT).reviewer;
  return {
    identities: [AUTHOR.identity, e.identity, f.reviewer_id].sort(),
    sessions: [AUTHOR.session_id, e.review_session_id, f.session_id].sort(),
    excluded_roles: [
      "candidate_dossier_author",
      "gate_e_source_reviewer",
      "gate_f_source_reviewer",
      "implementation",
    ],
  };
}
function cohort(): J[] {
  const rows = load(PHASE).records;
  const aerial = rows
    .filter((r: J) => r.primary_stratum === "aerial")
    .sort((a: J, b: J) => a.selection_index - b.selection_index);
  const ground = rows
    .filter(
      (r: J) =>
        r.primary_stratum === "ground" &&
        r.review_evidence.gold?.disposition === "promoted",
    )
    .sort((a: J, b: J) => a.selection_index - b.selection_index)
    .slice(0, 16);
  assert(aerial.length === 20 && ground.length === 16, "cohort count drift");
  const out = [...aerial, ...ground].sort(
    (a, b) => a.numeric_id - b.numeric_id,
  );
  assert(
    new Set(out.map((r) => r.component_id)).size === 36,
    "component collision",
  );
  assert(
    !out.some((r) => r.numeric_id === 10153 || r.numeric_id === 9504),
    "Gate F reserve selected",
  );
  return out;
}
function trackedPixelPath(id: number): string {
  return path.join(FIXTURE, `review-pixels/${id}.jpg`);
}
function sourcePixel(row: J): string {
  const tracked = trackedPixelPath(row.numeric_id);
  if (fs.existsSync(tracked)) return tracked;
  const local = path.join(ROOT, row.pixel_evidence.views[0].path);
  assert(
    fs.existsSync(local),
    `authenticated Gold review pixel missing: ${row.numeric_id}`,
  );
  return local;
}
function archiveMetadata(row: J): J {
  const n = JSON.parse(row.canonical_evidence.node.value_json);
  return {
    evidence_class: "archive_metadata_report",
    name: n.name ?? null,
    date: n.date ?? null,
    cote: n.cote ?? null,
    source_urls: n.source_urls ?? [],
    disclaimer:
      "Reported archive metadata; not asserted as independent historical truth.",
  };
}
function visualClaims(row: J): J[] {
  const g = row.review_evidence.gold;
  if (g?.disposition !== "promoted") return [];
  const a = JSON.parse(g.source_rows.adjudication.value_json);
  const l = a.final_labels.image_mode;
  if (l?.status !== "observed") return [];
  return [
    {
      claim_id: `visual:${row.numeric_id}:image-mode`,
      statement: `The reviewed pixels are classified as image mode ${l.value}.`,
      predicate: "image_mode",
      value: l.value,
      evidence: {
        declaration: "whole_image",
        normalized_bbox: null,
        review_row_sha256: g.source_rows.adjudication.row_sha256,
        target: "image_mode",
      },
      boundary:
        "Visual classification only; no identity, place, date, land-use, scale, measurement, OCR, brand, or entity claim.",
    },
  ];
}

function registryAuthorityPin(stableId: string): J {
  const line = fs
    .readFileSync(REGISTRY, "utf8")
    .split("\n")
    .find((value) => value && JSON.parse(value).stable_id === stableId);
  assert(line, `registered authority missing: ${stableId}`);
  const row = JSON.parse(line);
  return {
    stable_id: stableId,
    row_sha256: hash(line),
    content_digest: row.content_digest,
    counts: row.counts,
    rights_boundary: row.rights_boundary,
  };
}

function sourceLedgerEntry(key: string): J {
  const entry = load(GROUND_RIGHTS_LEDGER).sources.find(
    (source: J) => source.key === key,
  );
  assert(entry?.verified === true, `ground rights evidence missing: ${key}`);
  return {
    evidence_id: key,
    requested_url: entry.requested_url,
    final_url: entry.final_url,
    snapshot: filePin(
      path.join(GROUND_RIGHTS_ROOT, entry.snapshot_path),
      entry.snapshot_path,
    ),
    ledger_entry_sha256: hash(canon(entry)),
  };
}

function groundRights(): J {
  const verification = load(GROUND_RIGHTS_VERIFICATION);
  assert(
    verification.rights?.status === "official_pages_captured" &&
      verification.rights.license === "CC BY 4.0" &&
      verification.rights.attribution_required === true &&
      verification.rights.attribution === "Ville de Montreal",
    "ground rights verification authority drift",
  );
  const evidence = {
    dataset_page: sourceLedgerEntry("ground_page"),
    montreal_license_page: sourceLedgerEntry("license_page"),
    canonical_license_page: sourceLedgerEntry("cc_by"),
  };
  assert(
    evidence.dataset_page.snapshot.sha256 ===
      "deaa62e3a1ad38ff525a8295301df2e0b82bedf25201b59faa66f3825d406466" &&
      evidence.montreal_license_page.snapshot.sha256 ===
        "8d5838a3b7490fae99f7e2d353fcd5c16013dc0cd37434e76e76dd2c1bcaf810" &&
      evidence.canonical_license_page.snapshot.sha256 ===
        "231a5dac65bbf135ba27145969a63cd289faadc172f1512c4810a6c60ba91036",
    "ground rights snapshot pin drift",
  );
  return {
    license_id: "cc-by-4.0",
    attribution: "Ville de Montréal / Archives de la Ville de Montréal",
    commercial_use_allowed: true,
    complete: true,
    authority: "registered_dataset_wide_montreal_cc_by_4_0_rights",
    scope_note:
      "Rights-only authority: the official Montreal open-data license applies CC BY 4.0 to City open data/content, and the exact photographic-archive dataset page requires credit to Archives de la Ville de Montréal. It does not establish image identity, depicted location, date, history, OCR, brand, entity, land use, scale, or measurement.",
    evidence: {
      authority_artifact: registryAuthorityPin(
        "dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1",
      ),
      descriptor: filePin(
        path.join(GROUND_RIGHTS_ROOT, "descriptor-v1.json"),
        "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/descriptor-v1.json",
      ),
      source_ledger: filePin(
        GROUND_RIGHTS_LEDGER,
        "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/source-ledger-v1.json",
      ),
      verification_run: filePin(
        GROUND_RIGHTS_VERIFICATION,
        "docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/verification-run-v1.json",
      ),
      evidence,
      supported_facts: {
        dataset: "Archives photographiques (sélection)",
        license: "Creative Commons Attribution 4.0 International",
        dataset_credit: "Archives de la Ville de Montréal",
        license_attribution_party: "Ville de Montréal",
      },
    },
  };
}

function aerialRights(numericId: number): J {
  const receipt = load(GATE_F_RECEIPT);
  const reviewLedger = load(GATE_F_LEDGER);
  const evidenceLedger = load(GATE_F_EVIDENCE);
  const sourceBodies = load(GATE_F_SOURCE_BODIES);
  const disposition = receipt.dispositions.find(
    (value: J) => value.numeric_id === numericId,
  );
  const ledgerDisposition = reviewLedger.dispositions.find(
    (value: J) => value.numeric_id === numericId,
  );
  const recordBinding = receipt.bindings.records.find(
    (value: J) => value.numeric_id === numericId,
  );
  const evidenceRecord = evidenceLedger.records.find(
    (value: J) => value.numeric_id === numericId,
  );
  assert(
    disposition?.evidence_disposition === "accepted" &&
      canon(disposition) === canon(ledgerDisposition) &&
      recordBinding &&
      evidenceRecord,
    `Gate F accepted record authority missing: ${numericId}`,
  );
  const familyBinding = receipt.bindings.source_families.find(
    (value: J) => value.source_family_id === recordBinding.source_family_id,
  );
  const sourceBody = sourceBodies.packages.find(
    (value: J) => value.source_family_id === recordBinding.source_family_id,
  );
  assert(
    familyBinding && sourceBody,
    `Gate F source family missing: ${numericId}`,
  );
  const recordId = `${numericId}:record-media-identity`;
  const recordIndex = recordBinding.proposition_ids.indexOf(recordId);
  const licenseId = familyBinding.proposition_ids.find((id: string) =>
    id.endsWith(":license"),
  );
  const creditId = familyBinding.proposition_ids.find((id: string) =>
    id.endsWith(":credit"),
  );
  const proposition = (id: string): J => {
    const index = familyBinding.proposition_ids.indexOf(id);
    const body = sourceBody.propositions.find(
      (value: J) => value.proposition_id === id,
    );
    assert(
      index >= 0 && body,
      `Gate F proposition missing: ${numericId}/${id}`,
    );
    assert(
      familyBinding.proposition_hashes[index] === body.text_sha256,
      `Gate F proposition hash drift: ${numericId}/${id}`,
    );
    return {
      proposition_id: id,
      text_sha256: body.text_sha256,
      exact_text: body.exact_text,
    };
  };
  assert(
    recordIndex >= 0 &&
      disposition.accepted_proposition_ids.includes(recordId) &&
      disposition.accepted_proposition_ids.includes(licenseId) &&
      disposition.accepted_proposition_ids.includes(creditId),
    `Gate F accepted proposition membership drift: ${numericId}`,
  );
  assert(
    evidenceRecord.rights.source_family_id === recordBinding.source_family_id &&
      evidenceRecord.rights.exact_required_credit ===
        "Archives de la Ville de Montréal" &&
      evidenceRecord.rights.candidate_license_id === "cc-by-4.0" &&
      evidenceRecord.rights.commercial_use_candidate === true,
    `Gate F rights row drift: ${numericId}`,
  );
  return {
    license_id: "cc-by-4.0",
    attribution: "Archives de la Ville de Montréal",
    commercial_use_allowed: true,
    complete: true,
    authority: "gate_f_independently_accepted_source_media_rights_attribution",
    scope_note:
      "Gate F authority is limited to the exact record/media identity, source family, CC BY 4.0 license, and required credit propositions. It does not establish depicted location, georeference, scale, land use, or measurement.",
    evidence: {
      authority_receipt: filePin(GATE_F_RECEIPT),
      review_ledger: filePin(GATE_F_LEDGER),
      evidence_ledger: filePin(GATE_F_EVIDENCE),
      source_body_evidence: filePin(GATE_F_SOURCE_BODIES),
      disposition_sha256: hash(canon(disposition)),
      disposition: ledgerDisposition,
      accepted_proposition_ids: disposition.accepted_proposition_ids,
      source_family: {
        source_family_id: recordBinding.source_family_id,
        source_id: sourceBody.source_id,
        requested_url: sourceBody.requested_url,
        private_body: sourceBody.private_body,
      },
      record_media_identity: {
        proposition_id: recordId,
        proposition_sha256: recordBinding.proposition_hashes[recordIndex],
        media_sha256: recordBinding.media_sha256,
        source_row_sha256: recordBinding.source_row_sha256,
        resource_id: recordBinding.resource_id,
      },
      license: proposition(licenseId),
      credit: proposition(creditId),
    },
  };
}

function rightsFor(row: J): J {
  return row.primary_stratum === "aerial"
    ? aerialRights(row.numeric_id)
    : groundRights();
}
async function makePacket(row: J, pixelFile: string): Promise<J> {
  const b = fs.readFileSync(pixelFile);
  const expected = row.pixel_evidence.views[0];
  assert(
    hash(b) === expected.sha256 && b.length === expected.bytes,
    `Gold review pixel pin drift: ${row.numeric_id}`,
  );
  const decoded = await sharp(b, { failOn: "error" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(
    decoded.data.length ===
      decoded.info.width * decoded.info.height * decoded.info.channels,
    `full decode failed: ${row.numeric_id}`,
  );
  const heldIneligible = EXPECTED_HOLDS.includes(row.numeric_id);
  const rights = rightsFor(row);
  return {
    schema_version: VERSION,
    dossier_id: `verified-dossier-candidate:${row.numeric_id}`,
    state: "candidate_independent_review_required",
    fully_verified: false,
    source_acquisition_only: false,
    publication_eligible: !heldIneligible,
    expected_review_disposition: heldIneligible
      ? "held"
      : "independent_review_required",
    record: {
      record_id: row.record_id,
      numeric_id: row.numeric_id,
      component_id: row.component_id,
      split: row.split,
      phase_d_selection_index: row.selection_index,
      stratum: row.primary_stratum,
    },
    predecessors: predecessors(),
    review_pixels: {
      path: `review-pixels/${row.numeric_id}.jpg`,
      sha256: hash(b),
      bytes: b.length,
      format: "jpeg",
      width: decoded.info.width,
      height: decoded.info.height,
      full_decode_verified: true,
      evidence_declaration: "whole_image",
    },
    rights,
    archive_metadata: archiveMetadata(row),
    visual_claims: visualClaims(row),
    external_claims: [],
    alternatives: {
      held: [
        {
          proposition: "archive-reported identity, date, and location",
          reason:
            "Archive metadata is reported but not independently established by this dossier.",
        },
      ],
      rejected: [
        {
          proposition: "unreviewed OCR, brand, entity, or place promotion",
          reason:
            "No such promotion is allowed from candidate pixels or metadata.",
        },
      ],
      abstained: [
        "identity",
        "location",
        "georef",
        "scale",
        "land_use",
        "measurement",
      ].map((category) => ({
        category,
        reason: "No accepted dossier-level evidence establishes this category.",
      })),
    },
    contradictions: [],
    uncertainty: {
      statement: heldIneligible
        ? "Phase D Gold evidence is held; this dossier is categorically ineligible for acceptance or fully_verified publication."
        : "Candidate claims are limited to accepted/adjudicated visual classifications and reported metadata labels.",
      unresolved: [
        "historical identity",
        "exact location",
        "georeference",
        "scale",
        "land use",
        "measurement",
      ],
    },
    author: AUTHOR,
    independent_review: {
      required: true,
      completed: false,
      reviewer: null,
      disposition: null,
      required_attestations: [
        "visual_evidence",
        "metadata_labeling",
        "rights_attribution",
        "uncertainty",
        "projection_fidelity",
      ],
    },
  };
}
function candidateHtml(p: J): string {
  const claims = p.visual_claims.length
    ? p.visual_claims.map((c: J) => `<li>${esc(c.statement)}</li>`).join("")
    : "<li>No promoted visual claims.</li>";
  const m = p.archive_metadata;
  const embedded = canon(p).replaceAll("<", "\\u003c");
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dossier ${p.record.numeric_id}</title><style>body{font-family:Arial,sans-serif;color:#171717;background:#fff;margin:0}main{max-width:760px;margin:auto;padding:24px}img{display:block;width:100%;height:auto;border:1px solid #444}h1{font-size:24px;margin:0 0 16px}h2{font-size:16px;margin:24px 0 8px}.status{font-weight:700;color:#8a3b12}.meta{border-left:3px solid #777;padding-left:12px}dt{font-weight:700}dd{margin:0 0 8px}small{color:#555}</style></head><body><main><h1>Dossier candidate ${p.record.numeric_id}</h1><p class="status">Independent dossier review required. Not fully verified.</p><img src="../../overlays/${p.record.numeric_id}.jpg" width="${p.review_pixels.width}" height="${p.review_pixels.height}" alt="Whole-image evidence for record ${p.record.numeric_id}"><h2>Visual evidence</h2><ul>${claims}</ul><h2>Archive metadata report</h2><div class="meta"><dl><dt>Name</dt><dd>${esc(m.name ?? "Not reported")}</dd><dt>Date</dt><dd>${esc(m.date ?? "Not reported")}</dd><dt>Cote</dt><dd>${esc(m.cote ?? "Not reported")}</dd></dl><small>${esc(m.disclaimer)}</small></div><h2>Rights and attribution</h2><p>${esc(p.rights.license_id)}; ${esc(p.rights.attribution)}</p><h2>Uncertainty</h2><p>${esc(p.uncertainty.statement)}</p></main><script id="packet" type="application/json">${embedded}</script></body></html>\n`;
}
async function overlayBytes(input: string): Promise<Buffer> {
  const m = await sharp(input).metadata();
  assert(m.width && m.height, "overlay dimensions absent");
  const svg = `<svg width="${m.width}" height="${m.height}" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="${m.width - 4}" height="${m.height - 4}" fill="none" stroke="#f5c542" stroke-width="4"/></svg>`;
  return sharp(input, { failOn: "error" })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
function candidateSheetLabel(p: J): string {
  return p.expected_review_disposition === "held"
    ? "expected hold"
    : "review required";
}
async function sheetPageBytes(
  root: string,
  packets: J[],
  page: number,
  labelFor: (packet: J) => string,
  imageDirectory: string,
): Promise<Buffer> {
  const composites = (
    await Promise.all(
      packets.slice(page * 12, page * 12 + 12).map(async (p, i) => {
        const image = await sharp(
          path.join(root, `${imageDirectory}/${p.record.numeric_id}.jpg`),
        )
          .resize(300, 220, { fit: "contain", background: "#fff" })
          .toBuffer();
        const left = (i % 3) * 320 + 10;
        const top = Math.floor(i / 3) * 250 + 10;
        const label = Buffer.from(
          `<svg width="300" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="24" fill="#fff"/><text x="4" y="17" font-family="Arial" font-size="15" fill="#111">${p.record.numeric_id} | ${p.record.stratum} | ${labelFor(p)}</text></svg>`,
        );
        return [
          { input: image, left, top },
          { input: label, left, top: top + 220 },
        ];
      }),
    )
  ).flat();
  return sharp({
    create: { width: 970, height: 1010, channels: 3, background: "#fff" },
  })
    .composite(composites)
    .jpeg({ quality: 88 })
    .toBuffer();
}
async function sheets(root: string, packets: J[]): Promise<void> {
  for (let page = 0; page < 3; page++) {
    fs.writeFileSync(
      path.join(root, `contact-sheets/page-0${page + 1}.jpg`),
      await sheetPageBytes(
        root,
        packets,
        page,
        candidateSheetLabel,
        "overlays",
      ),
    );
  }
}

function blankReview(root: string, packets: J[]): J {
  return {
    schema_version: "verified_dossiers_independent_review_template_v1.0.0",
    status: "blank_independent_review_required",
    artifact_id: ID,
    candidate_descriptor_sha256: null,
    authorization_required: true,
    authorization_schema_version:
      "verified_dossiers_reviewer_authorization_v1.0.0",
    packet_manifest: filePin(
      path.join(root, "packet-manifest-v1.json"),
      "packet-manifest-v1.json",
    ),
    reviewer: {
      reviewer_id: "",
      session_id: "",
      model: "",
      reasoning_effort: "",
      reviewed_at: "",
      independence_attestations: {
        no_author_overlap: false,
        no_gate_e_source_review_overlap: false,
        no_gate_f_source_review_overlap: false,
        no_implementation_overlap: false,
      },
    },
    forbidden_principals: forbidden(),
    dispositions: packets.map((p) => ({
      dossier_id: p.dossier_id,
      numeric_id: p.record.numeric_id,
      packet_sha256: hash(pretty(p)),
      projection_json_sha256: filePin(
        path.join(root, `projections/json/${p.record.numeric_id}.json`),
      ).sha256,
      projection_html_sha256: filePin(
        path.join(root, `projections/html/${p.record.numeric_id}.html`),
      ).sha256,
      overlay_sha256: filePin(
        path.join(root, `overlays/${p.record.numeric_id}.jpg`),
      ).sha256,
      review_pixel_sha256: p.review_pixels.sha256,
      publication_eligible: p.publication_eligible,
      allowed_dispositions: p.publication_eligible
        ? ["accepted", "held", "rejected"]
        : ["held", "rejected"],
      disposition: null,
      approvals: {
        visual_evidence: false,
        metadata_labeling: false,
        rights_attribution: false,
        uncertainty: false,
        projection_fidelity: false,
      },
      rationale: "",
    })),
    counts: {
      candidates: 36,
      accepted: 0,
      held: 0,
      rejected: 0,
      fully_verified: 0,
    },
  };
}

function blankAuthorization(root: string, packets: J[]): J {
  return {
    schema_version: "verified_dossiers_reviewer_authorization_template_v1.0.0",
    status: "blank_coordinator_authorization_required",
    artifact_id: ID,
    candidate_descriptor_sha256: null,
    packet_manifest_sha256: filePin(path.join(root, "packet-manifest-v1.json"))
      .sha256,
    review_scope: {
      scope_id: `gate-g-review-scope:${hash(
        canon(packets.map((packet) => packet.dossier_id)),
      ).slice(0, 24)}`,
      dossier_ids: packets.map((packet) => packet.dossier_id),
      allowed_dispositions: ["accepted", "held", "rejected"],
      categorically_ineligible_numeric_ids: EXPECTED_HOLDS,
      minimum_eligible_acceptances: MIN_ACCEPTED,
    },
    approved_reviewer: {
      reviewer_id: "",
      session_id: "",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
    },
    authorizing_authority: {
      identity: "",
      session_id: "",
      role: "gate_g_review_authority",
    },
    authorized_at: "",
    forbidden_principals: forbidden(),
  };
}
function packetManifest(root: string, members: string[]): J {
  return {
    schema_version: "verified_dossiers_packet_manifest_v1.0.0",
    artifact_id: ID,
    candidate_count: 36,
    projection_contract:
      "Projections expose packet fields only and add no claims.",
    tree: tree(root, members),
    predecessors: predecessors(),
  };
}
function candidateStatus(): J {
  return {
    schema_version: "verified_dossiers_status_v1.0.0",
    artifact_id: ID,
    state: "candidate_independent_review_required",
    counts: {
      candidates: 36,
      aerial: 20,
      ground: 16,
      expected_hold: 4,
      fully_verified: 0,
      accepted: 0,
      held: 0,
      rejected: 0,
      benchmark_tasks: 0,
      search_tasks: 0,
    },
    production_mutation: false,
    paid_gpu: false,
    issue_complete: false,
  };
}
function candidateDescriptor(root: string, members: string[]): J {
  return {
    schema_version: "verified_dossiers_descriptor_v1.0.0",
    artifact_id: ID,
    state: "candidate_independent_review_required",
    created_at: CREATED,
    author: AUTHOR,
    candidate_count: 36,
    minimum_publication_acceptances: MIN_ACCEPTED,
    members: tree(root, members),
    predecessors: predecessors(),
    production_mutation: false,
    paid_gpu: false,
  };
}
async function build(output: string): Promise<J> {
  assert(
    output && !fs.existsSync(output),
    `output already exists or is empty: ${output}`,
  );
  fs.mkdirSync(output, { recursive: true });
  try {
    const rows = cohort();
    fs.mkdirSync(path.join(output, "review-pixels"), { recursive: true });
    for (const row of rows)
      fs.copyFileSync(
        sourcePixel(row),
        path.join(output, `review-pixels/${row.numeric_id}.jpg`),
      );
    const packets = await Promise.all(
      rows.map((row) =>
        makePacket(
          row,
          path.join(output, `review-pixels/${row.numeric_id}.jpg`),
        ),
      ),
    );
    writeJson(path.join(output, "candidate-packets-v1.json"), {
      schema_version: VERSION,
      artifact_id: ID,
      state: "candidate",
      packets,
    });
    for (const p of packets) {
      writeJson(
        path.join(output, `projections/json/${p.record.numeric_id}.json`),
        p,
      );
      fs.mkdirSync(path.join(output, "projections/html"), { recursive: true });
      fs.writeFileSync(
        path.join(output, `projections/html/${p.record.numeric_id}.html`),
        candidateHtml(p),
      );
      fs.mkdirSync(path.join(output, "overlays"), { recursive: true });
      fs.writeFileSync(
        path.join(output, `overlays/${p.record.numeric_id}.jpg`),
        await overlayBytes(
          path.join(output, `review-pixels/${p.record.numeric_id}.jpg`),
        ),
      );
    }
    fs.mkdirSync(path.join(output, "contact-sheets"), { recursive: true });
    await sheets(output, packets);
    const members = files(output);
    writeJson(
      path.join(output, "packet-manifest-v1.json"),
      packetManifest(output, members),
    );
    writeJson(
      path.join(output, "independent-dossier-review.template-v1.json"),
      blankReview(output, packets),
    );
    writeJson(
      path.join(output, "reviewer-authorization.template-v1.json"),
      blankAuthorization(output, packets),
    );
    writeJson(path.join(output, "status-report-v1.json"), candidateStatus());
    const descriptorMembers = files(output);
    const descriptor = candidateDescriptor(output, descriptorMembers);
    writeJson(path.join(output, "descriptor-v1.json"), descriptor);
    return descriptor;
  } catch (e) {
    fs.rmSync(output, { recursive: true, force: true });
    throw e;
  }
}

function registryRow(root = FIXTURE): J {
  const t = tree(root);
  return {
    stable_id: ID,
    schema_version: "dataset_factory_artifact_registry_v0",
    artifact_schema_version: VERSION,
    artifact_kind: "directory",
    content_digest: {
      algorithm: "sha256",
      value: t.sha256,
      scope: "sorted_tree_manifest",
    },
    counts: { file_count: t.members.length, byte_count: t.bytes },
    source_lineage: {
      description:
        "Issue #91 Gate G deterministic 36-dossier candidate with exact Gate F aerial and registered Montréal CC BY 4.0 ground rights authority, blank coordinator authorization and independent review templates, categorical pilot holds, and zero fully verified dossiers.",
      source_artifact_ids: REGISTRY_DEPS,
      source_urls: [
        "https://github.com/zouantchaw/mtl-archives-search/issues/91",
      ],
    },
    storage: {
      storage_class: "tracked_repository",
      path_class: "tracked_fixture",
      locator: REL,
    },
    generation: {
      method: "automated",
      command:
        "npm run dataset-factory:verified-dossiers-build-v1 -- --output /new/candidate && npm run dataset-factory:verified-dossiers-verify-v1",
      code_ref: "codex/91-verified-dossiers",
      human_input_ids: [],
    },
    dependency_ids: REGISTRY_DEPS,
    required_by: [
      "issue #91 independent dossier review and one-way publication",
    ],
    rights_boundary: {
      license_id: "cc-by-4.0",
      attribution:
        "Archives de la Ville de Montreal and Ville de Montreal as exactly bound per dossier",
      commercial_use_allowed: true,
      notes:
        "Candidate-only publication state. Aerial rows bind independently accepted Gate F record/media, source-body, license, and credit propositions. Ground rows bind the registered dataset-wide official Montreal license and exact archive-dataset credit snapshots. These authorities support rights and attribution only; external claims, fully verified dossiers, benchmark/search tasks, and production mutations are zero.",
    },
    created_at: CREATED,
    creation_time_basis: "report_metadata",
  };
}
function verifyRegistry(root: string): void {
  const matches = fs
    .readFileSync(REGISTRY, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r: J) => r.stable_id === ID);
  assert(matches.length === 1, "registry row missing or duplicated");
  same(matches[0], registryRow(root), "registry row");
}
function sealRegistry(): void {
  const rows = fs
    .readFileSync(REGISTRY, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const index = rows.findIndex((r: J) => r.stable_id === ID);
  if (index < 0) rows.push(registryRow());
  else rows[index] = registryRow();
  fs.writeFileSync(
    REGISTRY,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}
function exact(a: string, b: string, label: string): void {
  same(files(a), files(b), `${label} file set`);
  for (const m of files(a))
    assert(
      fs.readFileSync(path.join(a, m)).equals(fs.readFileSync(path.join(b, m))),
      `${label} bytes: ${m}`,
    );
}
async function verifyCandidate(
  root: string,
  registry = root === FIXTURE,
): Promise<J> {
  const allFiles = files(root);
  const publicationExtras = new Set([
    "independent-dossier-review-v1.json",
    "reviewer-authorization-v1.json",
    "published-dossiers-v1.json",
    "publication-status-v1.json",
    "publication-descriptor-v1.json",
    "publication-commit-v1.json",
  ]);
  const list = allFiles.filter(
    (member) =>
      !publicationExtras.has(member) &&
      !member.startsWith("published-projections/"),
  );
  assert(
    list.length === 153,
    `expected 153 candidate files, got ${list.length}`,
  );
  const bundle = load(path.join(root, "candidate-packets-v1.json"));
  schema("candidate-packets.schema.v1.json", bundle);
  assert(
    bundle.packets.length === 36 &&
      bundle.packets.every((p: J) => !p.fully_verified),
    "candidate verification count must be zero",
  );
  const selected = cohort(),
    expectedById = new Map(selected.map((row) => [row.numeric_id, row]));
  same(
    bundle.packets.map((p: J) => p.record.numeric_id),
    selected.map((r) => r.numeric_id).sort((a: number, b: number) => a - b),
    "cohort",
  );
  assert(
    new Set(bundle.packets.map((p: J) => p.record.component_id)).size === 36,
    "components not distinct",
  );
  same(
    bundle.packets
      .filter((p: J) => p.expected_review_disposition === "held")
      .map((p: J) => p.record.numeric_id),
    EXPECTED_HOLDS,
    "held aerials",
  );
  for (const p of bundle.packets) {
    const row = expectedById.get(p.record.numeric_id);
    assert(row, "unknown candidate record");
    same(
      p.record,
      {
        record_id: row.record_id,
        numeric_id: row.numeric_id,
        component_id: row.component_id,
        split: row.split,
        phase_d_selection_index: row.selection_index,
        stratum: row.primary_stratum,
      },
      `Phase D record ${p.record.numeric_id}`,
    );
    same(
      p.predecessors,
      predecessors(),
      `packet predecessors ${p.record.numeric_id}`,
    );
    same(
      p.archive_metadata,
      archiveMetadata(row),
      `metadata ${p.record.numeric_id}`,
    );
    same(
      p.visual_claims,
      visualClaims(row),
      `visual claims ${p.record.numeric_id}`,
    );
    assert(
      !p.external_claims.length &&
        p.archive_metadata.evidence_class === "archive_metadata_report",
      `claim boundary: ${p.record.numeric_id}`,
    );
    same(p.rights, rightsFor(row), `rights ${p.record.numeric_id}`);
    assert(
      p.alternatives.held.length &&
        p.alternatives.rejected.length &&
        p.alternatives.abstained.length === 6,
      `alternatives: ${p.record.numeric_id}`,
    );
    const pixelPath = path.join(root, p.review_pixels.path);
    const pixel = filePin(pixelPath, p.review_pixels.path);
    same(
      pixel,
      {
        path: p.review_pixels.path,
        sha256: p.review_pixels.sha256,
        bytes: p.review_pixels.bytes,
      },
      `pixels ${p.record.numeric_id}`,
    );
    assert(
      p.review_pixels.sha256 === row.pixel_evidence.views[0].sha256 &&
        p.review_pixels.width === row.pixel_evidence.views[0].width &&
        p.review_pixels.height === row.pixel_evidence.views[0].height,
      `Phase D pixel binding ${p.record.numeric_id}`,
    );
    const expectedPacket = await makePacket(row, pixelPath);
    same(p, expectedPacket, `packet ${p.record.numeric_id}`);
    assert(
      fs.readFileSync(
        path.join(root, `projections/json/${p.record.numeric_id}.json`),
        "utf8",
      ) === pretty(expectedPacket),
      `JSON projection bytes ${p.record.numeric_id}`,
    );
    assert(
      fs.readFileSync(
        path.join(root, `projections/html/${p.record.numeric_id}.html`),
        "utf8",
      ) === candidateHtml(expectedPacket),
      `HTML projection bytes ${p.record.numeric_id}`,
    );
    assert(
      fs
        .readFileSync(path.join(root, `overlays/${p.record.numeric_id}.jpg`))
        .equals(await overlayBytes(pixelPath)),
      `overlay bytes ${p.record.numeric_id}`,
    );
  }
  for (let page = 0; page < 3; page++)
    assert(
      fs
        .readFileSync(path.join(root, `contact-sheets/page-0${page + 1}.jpg`))
        .equals(
          await sheetPageBytes(
            root,
            bundle.packets,
            page,
            candidateSheetLabel,
            "overlays",
          ),
        ),
      `contact sheet bytes ${page + 1}`,
    );
  const manifest = load(path.join(root, "packet-manifest-v1.json"));
  const manifestMembers = list.filter(
    (m) =>
      ![
        "packet-manifest-v1.json",
        "independent-dossier-review.template-v1.json",
        "reviewer-authorization.template-v1.json",
        "status-report-v1.json",
        "descriptor-v1.json",
      ].includes(m),
  );
  same(manifest, packetManifest(root, manifestMembers), "packet manifest");
  const template = load(
    path.join(root, "independent-dossier-review.template-v1.json"),
  );
  schema("independent-review-template.schema.v1.json", template);
  assert(
    template.dispositions.every((d: J) => d.disposition === null),
    "tracked review is not blank",
  );
  same(template, blankReview(root, bundle.packets), "review template");
  const authorizationTemplate = load(
    path.join(root, "reviewer-authorization.template-v1.json"),
  );
  schema(
    "reviewer-authorization-template.schema.v1.json",
    authorizationTemplate,
  );
  same(
    authorizationTemplate,
    blankAuthorization(root, bundle.packets),
    "authorization template",
  );
  const status = load(path.join(root, "status-report-v1.json"));
  same(status, candidateStatus(), "candidate status");
  const descriptor = load(path.join(root, "descriptor-v1.json"));
  same(
    descriptor,
    candidateDescriptor(
      root,
      list.filter((m) => m !== "descriptor-v1.json"),
    ),
    "candidate descriptor",
  );
  if (registry) verifyRegistry(root);
  return {
    candidates: 36,
    files: list.length,
    bytes: tree(root).bytes,
    tree_sha256: tree(root).sha256,
    aerial_ids: bundle.packets
      .filter((p: J) => p.record.stratum === "aerial")
      .map((p: J) => p.record.numeric_id),
    ground_ids: bundle.packets
      .filter((p: J) => p.record.stratum === "ground")
      .map((p: J) => p.record.numeric_id),
  };
}
async function verify(root: string): Promise<J> {
  const result = await verifyCandidate(root);
  const replay = fs.mkdtempSync(path.join(os.tmpdir(), "gate-g-replay-"));
  fs.rmSync(replay, { recursive: true });
  try {
    await build(replay);
    exact(root, replay, "offline replay");
    return {
      status: "verified_candidate",
      ...result,
      deterministic_replay: true,
      production_mutation: false,
      paid_gpu: false,
    };
  } finally {
    fs.rmSync(replay, { recursive: true, force: true });
  }
}
function strictTime(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
    !Number.isNaN(Date.parse(v))
  );
}
function activeAuthorizationPin(
  candidate: string,
  authorizationFile: string,
): J {
  const authorization = load(authorizationFile);
  return {
    schema_version: "verified_dossiers_production_authorization_pin_v1.0.0",
    authority_id: "gate-g-production-authorization-pin",
    state: "active",
    candidate_artifact_id: ID,
    candidate_descriptor_sha256: filePin(
      path.join(candidate, "descriptor-v1.json"),
    ).sha256,
    authorization_file: {
      path: PRODUCTION_REVIEWER_AUTHORIZATION_REL,
      sha256: filePin(authorizationFile).sha256,
      bytes: filePin(authorizationFile).bytes,
    },
    approved_reviewer: authorization.approved_reviewer,
    authorizing_authority: authorization.authorizing_authority,
    authorized_at: authorization.authorized_at,
    scope_note:
      "Internal test-only positive authorization capability. This object is never accepted from a CLI path and is never a production trust root.",
  };
}
function internalAuthorizationCapability(
  candidate: string,
  authorizationFile: string,
): InternalAuthorizationCapability {
  const authorizationBytes = fs.readFileSync(authorizationFile);
  return {
    [INTERNAL_AUTHORIZATION_CAPABILITY]: true,
    pin: activeAuthorizationPin(candidate, authorizationFile),
    authorityReader: memoryAuthorityReader(
      authorizationBytes,
      authorizationBytes,
    ),
  };
}
function memoryAuthorityReader(
  working: Buffer | null,
  committed: Buffer | null,
): TrackedAuthorityReader {
  return {
    readWorking: (relativePath) =>
      relativePath === PRODUCTION_REVIEWER_AUTHORIZATION_REL ? working : null,
    readCommitted: (relativePath) =>
      relativePath === PRODUCTION_REVIEWER_AUTHORIZATION_REL ? committed : null,
  };
}
function committedBytes(relativePath: string): Buffer | null {
  try {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: ROOT,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
const productionAuthorityReader: TrackedAuthorityReader = {
  readWorking: (relativePath) => {
    const absolutePath = path.join(ROOT, relativePath);
    return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : null;
  },
  readCommitted: committedBytes,
};
function validateAuthorizationDocument(
  candidate: string,
  authorization: J,
  pin: J,
): void {
  schema("reviewer-authorization.schema.v1.json", authorization);
  assert(
    pin.candidate_artifact_id === ID &&
      pin.candidate_descriptor_sha256 ===
        filePin(path.join(candidate, "descriptor-v1.json")).sha256,
    "authorization pin candidate binding drift",
  );
  same(
    pin.approved_reviewer,
    authorization.approved_reviewer,
    "authorization pin reviewer route",
  );
  same(
    pin.authorizing_authority,
    authorization.authorizing_authority,
    "authorization pin authority route",
  );
  assert(
    pin.authorized_at === authorization.authorized_at,
    "authorization pin timestamp drift",
  );
  const packets = load(
    path.join(candidate, "candidate-packets-v1.json"),
  ).packets;
  const template = blankAuthorization(candidate, packets);
  assert(
    authorization.candidate_descriptor_sha256 ===
      filePin(path.join(candidate, "descriptor-v1.json")).sha256,
    "authorization candidate descriptor drift",
  );
  assert(
    authorization.packet_manifest_sha256 === template.packet_manifest_sha256,
    "authorization packet manifest drift",
  );
  same(
    authorization.review_scope,
    template.review_scope,
    "authorization review scope",
  );
  same(
    authorization.forbidden_principals,
    template.forbidden_principals,
    "authorization forbidden principals",
  );
  const reviewer = authorization.approved_reviewer;
  const authority = authorization.authorizing_authority;
  const principals = [
    reviewer.reviewer_id,
    reviewer.session_id,
    authority.identity,
    authority.session_id,
  ];
  assert(
    principals.every(
      (value: string) => value.trim() === value && value.length > 0,
    ) && new Set(principals).size === principals.length,
    "authorization principals invalid",
  );
  assert(
    reviewer.model === "gpt-5.6-sol" && reviewer.reasoning_effort === "high",
    "authorization reviewer route invalid",
  );
  assert(
    authority.role === "gate_g_review_authority",
    "authorization authority role invalid",
  );
  const blocked = new Set([
    ...template.forbidden_principals.identities,
    ...template.forbidden_principals.sessions,
  ]);
  assert(
    principals.every((value: string) => !blocked.has(value)),
    "authorization overlaps forbidden principal",
  );
  assert(
    strictTime(authorization.authorized_at) &&
      Date.parse(authorization.authorized_at) >= Date.parse(CREATED),
    "authorization timestamp invalid",
  );
}
function verifyTrackedAuthorizationAuthority(
  candidate: string,
  pin: J,
  reader: TrackedAuthorityReader,
): VerifiedAuthorizationAuthority {
  schema("production-authorization-pin.schema.v1.json", pin);
  assert(
    pin.candidate_artifact_id === ID,
    "production authorization pin artifact binding drift",
  );
  const working = reader.readWorking(PRODUCTION_REVIEWER_AUTHORIZATION_REL);
  const committed = reader.readCommitted(PRODUCTION_REVIEWER_AUTHORIZATION_REL);
  if (pin.state === "unconfigured") {
    assert(
      pin.candidate_descriptor_sha256 === null &&
        pin.authorization_file === null &&
        pin.approved_reviewer === null &&
        pin.authorizing_authority === null &&
        pin.authorized_at === null,
      "unconfigured production authorization pin is not fail-closed",
    );
    assert(
      working === null && committed === null,
      "unconfigured production authorization file must be absent",
    );
    return { pin, authorization: null, authorizationBytes: null };
  }
  assert(pin.state === "active", "unknown production authorization pin state");
  assert(working, "tracked reviewer authorization file is missing");
  assert(
    committed,
    "tracked reviewer authorization file is not committed at HEAD",
  );
  assert(
    working.equals(committed),
    "tracked reviewer authorization differs from committed HEAD bytes",
  );
  same(
    pin.authorization_file,
    {
      path: PRODUCTION_REVIEWER_AUTHORIZATION_REL,
      sha256: hash(committed),
      bytes: committed.length,
    },
    "active production pin authorization file",
  );
  let authorization: J;
  try {
    authorization = JSON.parse(committed.toString("utf8"));
  } catch {
    throw new Error("tracked reviewer authorization is not valid JSON");
  }
  validateAuthorizationDocument(candidate, authorization, pin);
  return { pin, authorization, authorizationBytes: committed };
}
function loadProductionAuthorizationAuthority(
  candidate = FIXTURE,
): VerifiedAuthorizationAuthority {
  const bytes = fs.readFileSync(PRODUCTION_AUTHORIZATION_PIN);
  const committed = committedBytes(PRODUCTION_AUTHORIZATION_PIN_REL);
  assert(committed, "production authorization pin is not committed at HEAD");
  assert(
    bytes.equals(committed),
    "production authorization pin differs from committed HEAD bytes",
  );
  const pin = JSON.parse(bytes.toString("utf8"));
  return verifyTrackedAuthorizationAuthority(
    candidate,
    pin,
    productionAuthorityReader,
  );
}
function resolveAuthorizationAuthority(
  candidate: string,
  capability?: InternalAuthorizationCapability,
): VerifiedAuthorizationAuthority {
  if (capability) {
    assert(
      capability[INTERNAL_AUTHORIZATION_CAPABILITY] === true,
      "invalid internal authorization capability",
    );
    return verifyTrackedAuthorizationAuthority(
      candidate,
      capability.pin,
      capability.authorityReader,
    );
  }
  return loadProductionAuthorizationAuthority(candidate);
}
function validateAuthorization(
  candidate: string,
  authorizationFile: string,
  receipt: J | null,
  capability?: InternalAuthorizationCapability,
): J {
  const suppliedBytes = fs.readFileSync(authorizationFile);
  const authority = resolveAuthorizationAuthority(candidate, capability);
  const pin = authority.pin;
  assert(
    pin.state === "active",
    "production authorization pin is unconfigured",
  );
  assert(
    authority.authorizationBytes &&
      authority.authorization &&
      suppliedBytes.equals(authority.authorizationBytes),
    "supplied authorization differs from tracked committed authority bytes",
  );
  const authorization = authority.authorization;
  const reviewer = authorization.approved_reviewer;
  if (receipt) {
    assert(
      receipt.authorization_sha256 === hash(suppliedBytes),
      "review authorization hash drift",
    );
    same(
      receipt.reviewer,
      {
        reviewer_id: reviewer.reviewer_id,
        session_id: reviewer.session_id,
        model: reviewer.model,
        reasoning_effort: reviewer.reasoning_effort,
        reviewed_at: receipt.reviewer.reviewed_at,
        independence_attestations: receipt.reviewer.independence_attestations,
      },
      "authorized reviewer",
    );
    assert(
      Date.parse(receipt.reviewer.reviewed_at) >=
        Date.parse(authorization.authorized_at),
      "review predates authorization",
    );
  }
  return authorization;
}

async function validateReview(
  candidate: string,
  receiptFile: string,
  authorizationFile: string,
  capability?: InternalAuthorizationCapability,
): Promise<J> {
  await verifyCandidate(candidate, false);
  const receipt = load(receiptFile);
  schema("completed-independent-review.schema.v1.json", receipt);
  const authorization = validateAuthorization(
    candidate,
    authorizationFile,
    receipt,
    capability,
  );
  assert(
    receipt.candidate_descriptor_sha256 ===
      filePin(path.join(candidate, "descriptor-v1.json")).sha256,
    "candidate descriptor hash drift",
  );
  const deny = forbidden();
  const blocked = new Set([...deny.identities, ...deny.sessions]);
  const r = receipt.reviewer;
  assert(
    strictTime(r.reviewed_at) &&
      Date.parse(r.reviewed_at) >= Date.parse(CREATED),
    "reviewed_at invalid",
  );
  assert(
    r.reviewer_id.trim() &&
      r.session_id.trim() &&
      r.reviewer_id === r.reviewer_id.trim() &&
      r.session_id === r.session_id.trim() &&
      r.reviewer_id !== r.session_id,
    "reviewer identity/session invalid",
  );
  assert(
    !blocked.has(r.reviewer_id) && !blocked.has(r.session_id),
    "review principal overlaps author/source-review/implementation",
  );
  assert(
    r.reviewer_id === authorization.approved_reviewer.reviewer_id &&
      r.session_id === authorization.approved_reviewer.session_id &&
      r.model === authorization.approved_reviewer.model &&
      r.reasoning_effort === authorization.approved_reviewer.reasoning_effort,
    "reviewer is not the exact authorized route",
  );
  assert(
    Object.values(r.independence_attestations).every(Boolean),
    "independence attestations incomplete",
  );
  const template = load(
    path.join(candidate, "independent-dossier-review.template-v1.json"),
  );
  assert(
    receipt.dispositions.length === 36 &&
      new Set(receipt.dispositions.map((d: J) => d.dossier_id)).size === 36,
    "review coverage invalid",
  );
  for (const expected of template.dispositions) {
    const actual = receipt.dispositions.find(
      (d: J) => d.dossier_id === expected.dossier_id,
    );
    assert(actual, `missing ${expected.dossier_id}`);
    for (const key of [
      "numeric_id",
      "packet_sha256",
      "projection_json_sha256",
      "projection_html_sha256",
      "overlay_sha256",
      "review_pixel_sha256",
    ])
      assert(
        actual[key] === expected[key],
        `${expected.dossier_id} ${key} drift`,
      );
    assert(actual.rationale.trim(), `${expected.dossier_id} rationale absent`);
    assert(
      expected.allowed_dispositions.includes(actual.disposition),
      `${expected.dossier_id} disposition is categorically ineligible`,
    );
    if (actual.disposition === "accepted")
      assert(
        Object.values(actual.approvals).every(Boolean),
        `${expected.dossier_id} acceptance lacks approval`,
      );
  }
  const counts = {
    accepted: receipt.dispositions.filter(
      (d: J) => d.disposition === "accepted",
    ).length,
    held: receipt.dispositions.filter((d: J) => d.disposition === "held")
      .length,
    rejected: receipt.dispositions.filter(
      (d: J) => d.disposition === "rejected",
    ).length,
  };
  same(
    receipt.counts,
    { candidates: 36, ...counts, fully_verified: counts.accepted },
    "review counts",
  );
  return { ...counts, fully_verified: counts.accepted, reviewer: r };
}
function publishedHtml(p: J): string {
  const status = p.fully_verified
    ? "Independently reviewed and fully verified."
    : `Independent review disposition: ${p.independent_review.disposition}. Not fully verified.`;
  const embedded = canon(p).replaceAll("<", "\\u003c");
  return candidateHtml(p)
    .replace(
      `Dossier candidate ${p.record.numeric_id}`,
      `Published dossier ${p.record.numeric_id}`,
    )
    .replace("Independent dossier review required. Not fully verified.", status)
    .replace(
      /<script id="packet" type="application\/json">[\s\S]+<\/script>/,
      `<script id="packet" type="application/json">${embedded}</script>`,
    );
}
function publishedSheetLabel(p: J): string {
  return p.independent_review.disposition;
}
function derivePublishedDossiers(candidatePackets: J[], receipt: J): J {
  const dispositions = new Map<string, J>(
    receipt.dispositions.map((disposition: J) => [
      disposition.dossier_id,
      disposition,
    ]),
  );
  const dossiers = candidatePackets.map((packet: J) => {
    const disposition = dispositions.get(packet.dossier_id);
    assert(disposition, `missing reviewed disposition: ${packet.dossier_id}`);
    return {
      ...packet,
      state:
        disposition.disposition === "accepted"
          ? "published_independently_verified"
          : `retained_${disposition.disposition}`,
      fully_verified: disposition.disposition === "accepted",
      independent_review: {
        required: true,
        completed: true,
        reviewer: receipt.reviewer,
        disposition: disposition.disposition,
        approvals: disposition.approvals,
        rationale: disposition.rationale,
      },
    };
  });
  return {
    schema_version: "verified_dossiers_publication_v1.0.0",
    source_candidate_artifact_id: ID,
    dossiers,
  };
}
function derivePublicationStatus(receipt: J): J {
  return {
    schema_version: "verified_dossiers_publication_status_v1.0.0",
    state: "published",
    counts: {
      candidates: 36,
      accepted: receipt.counts.accepted,
      held: receipt.counts.held,
      rejected: receipt.counts.rejected,
      fully_verified: receipt.counts.accepted,
      benchmark_tasks: 0,
      search_tasks: 0,
    },
    reviewer: receipt.reviewer,
    production_mutation: false,
    paid_gpu: false,
    issue_complete: receipt.counts.accepted >= MIN_ACCEPTED,
  };
}
function derivePublicationDescriptor(
  candidate: string,
  output: string,
  receipt: J,
): J {
  return {
    schema_version: "verified_dossiers_publication_descriptor_v1.0.0",
    source_candidate_descriptor: filePin(
      path.join(candidate, "descriptor-v1.json"),
      "descriptor-v1.json",
    ),
    review_receipt: filePin(
      path.join(output, "independent-dossier-review-v1.json"),
      "independent-dossier-review-v1.json",
    ),
    reviewer_authorization: filePin(
      path.join(output, "reviewer-authorization-v1.json"),
      "reviewer-authorization-v1.json",
    ),
    members: tree(
      output,
      files(output).filter(
        (member) =>
          ![
            "publication-descriptor-v1.json",
            "publication-commit-v1.json",
          ].includes(member),
      ),
    ),
    created_at: receipt.reviewer.reviewed_at,
  };
}
const PUBLICATION_COMMIT_INPUTS = [
  "reviewer-authorization-v1.json",
  "independent-dossier-review-v1.json",
  "published-dossiers-v1.json",
  "publication-status-v1.json",
  "publication-descriptor-v1.json",
];
function derivePublicationCommit(output: string, receipt: J): J {
  return {
    schema_version: "verified_dossiers_publication_commit_v1.0.0",
    state: "committed",
    inputs: PUBLICATION_COMMIT_INPUTS.map((member) =>
      filePin(path.join(output, member), member),
    ),
    committed_at: receipt.reviewer.reviewed_at,
  };
}
function expectedPublicationFiles(output: string, dossiers: J[]): string[] {
  const descriptor = load(path.join(output, "descriptor-v1.json"));
  const candidateFiles = [
    ...descriptor.members.members.map((member: J) => member.path),
    "descriptor-v1.json",
  ];
  return [
    ...candidateFiles,
    "reviewer-authorization-v1.json",
    "independent-dossier-review-v1.json",
    "published-dossiers-v1.json",
    "publication-status-v1.json",
    "publication-descriptor-v1.json",
    "publication-commit-v1.json",
    ...dossiers.flatMap((dossier: J) => [
      `published-projections/json/${dossier.record.numeric_id}.json`,
      `published-projections/html/${dossier.record.numeric_id}.html`,
    ]),
    ...[1, 2, 3].map(
      (page) => `published-projections/contact-sheets/page-0${page}.jpg`,
    ),
  ].sort();
}
async function derivePublication(
  candidate: string,
  receiptFile: string,
  authorizationFile: string,
  output: string,
): Promise<void> {
  fs.cpSync(candidate, output, { recursive: true });
  fs.copyFileSync(
    receiptFile,
    path.join(output, "independent-dossier-review-v1.json"),
  );
  fs.copyFileSync(
    authorizationFile,
    path.join(output, "reviewer-authorization-v1.json"),
  );
  const review = load(receiptFile);
  const packets = load(
    path.join(candidate, "candidate-packets-v1.json"),
  ).packets;
  const published = derivePublishedDossiers(packets, review);
  const dossiers = published.dossiers;
  for (const dossier of dossiers) {
    writeJson(
      path.join(
        output,
        `published-projections/json/${dossier.record.numeric_id}.json`,
      ),
      dossier,
    );
    fs.mkdirSync(path.join(output, "published-projections/html"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        output,
        `published-projections/html/${dossier.record.numeric_id}.html`,
      ),
      publishedHtml(dossier),
    );
  }
  fs.mkdirSync(path.join(output, "published-projections/contact-sheets"), {
    recursive: true,
  });
  for (let page = 0; page < 3; page++)
    fs.writeFileSync(
      path.join(
        output,
        `published-projections/contact-sheets/page-0${page + 1}.jpg`,
      ),
      await sheetPageBytes(
        output,
        dossiers,
        page,
        publishedSheetLabel,
        "overlays",
      ),
    );
  writeJson(path.join(output, "published-dossiers-v1.json"), published);
  writeJson(
    path.join(output, "publication-status-v1.json"),
    derivePublicationStatus(review),
  );
  writeJson(
    path.join(output, "publication-descriptor-v1.json"),
    derivePublicationDescriptor(candidate, output, review),
  );
  writeJson(
    path.join(output, "publication-commit-v1.json"),
    derivePublicationCommit(output, review),
  );
}
async function verifyPublished(
  output: string,
  authorizationFile: string,
  capability?: InternalAuthorizationCapability,
): Promise<J> {
  assert(
    fs.existsSync(path.join(output, "publication-commit-v1.json")),
    "commit marker absent",
  );
  assert(
    filePin(authorizationFile).sha256 ===
      filePin(path.join(output, "reviewer-authorization-v1.json")).sha256,
    "publication authorization differs from supplied authorization",
  );
  const review = await validateReview(
    output,
    path.join(output, "independent-dossier-review-v1.json"),
    authorizationFile,
    capability,
  );
  assert(review.accepted >= 25, "publication requires 25 acceptances");
  const receipt = load(path.join(output, "independent-dossier-review-v1.json"));
  const candidatePackets = load(
    path.join(output, "candidate-packets-v1.json"),
  ).packets;
  const expectedPublished = derivePublishedDossiers(candidatePackets, receipt);
  const published = load(path.join(output, "published-dossiers-v1.json"));
  schema("published-dossiers.schema.v1.json", published);
  same(published, expectedPublished, "published dossiers");
  assert(
    fs.readFileSync(path.join(output, "published-dossiers-v1.json"), "utf8") ===
      pretty(expectedPublished),
    "published dossiers bytes differ from deterministic derivation",
  );
  same(
    files(output),
    expectedPublicationFiles(output, expectedPublished.dossiers),
    "publication file set",
  );
  for (const d of expectedPublished.dossiers) {
    const jsonPath = path.join(
      output,
      `published-projections/json/${d.record.numeric_id}.json`,
    );
    const htmlPath = path.join(
      output,
      `published-projections/html/${d.record.numeric_id}.html`,
    );
    assert(
      fs.readFileSync(jsonPath, "utf8") === pretty(d),
      `published JSON bytes ${d.record.numeric_id}`,
    );
    assert(
      fs.readFileSync(htmlPath, "utf8") === publishedHtml(d),
      `published HTML bytes ${d.record.numeric_id}`,
    );
  }
  for (let page = 0; page < 3; page++)
    assert(
      fs
        .readFileSync(
          path.join(
            output,
            `published-projections/contact-sheets/page-0${page + 1}.jpg`,
          ),
        )
        .equals(
          await sheetPageBytes(
            output,
            expectedPublished.dossiers,
            page,
            publishedSheetLabel,
            "overlays",
          ),
        ),
      `published contact sheet bytes ${page + 1}`,
    );
  const status = load(path.join(output, "publication-status-v1.json"));
  same(status, derivePublicationStatus(receipt), "publication status");
  const descriptor = load(path.join(output, "publication-descriptor-v1.json"));
  same(
    descriptor,
    derivePublicationDescriptor(output, output, receipt),
    "publication descriptor",
  );
  same(
    load(path.join(output, "publication-commit-v1.json")),
    derivePublicationCommit(output, receipt),
    "publication commit",
  );
  return {
    status: "verified_published",
    ...review,
    files: files(output).length,
    bytes: tree(output).bytes,
    tree_sha256: tree(output).sha256,
    production_mutation: false,
    paid_gpu: false,
  };
}
async function publish(
  candidate: string,
  receipt: string,
  authorization: string,
  output: string,
  capability?: InternalAuthorizationCapability,
  hooks: { beforeReserve?: () => void; afterReserve?: () => void } = {},
): Promise<J> {
  assert(
    output && !fs.existsSync(output),
    `publication output exists or is empty: ${output}`,
  );
  const review = await validateReview(
    candidate,
    receipt,
    authorization,
    capability,
  );
  assert(
    review.accepted >= 25,
    "publication requires at least 25 accepted dossiers",
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(path.dirname(output), `.${path.basename(output)}.staging-`),
  );
  try {
    await derivePublication(candidate, receipt, authorization, staging);
    await verifyPublished(staging, authorization, capability);
    hooks.beforeReserve?.();
    fs.mkdirSync(output);
    const owner = crypto.randomUUID();
    const ownerFile = path.join(output, ".publication-owner");
    fs.writeFileSync(ownerFile, owner, { flag: "wx" });
    const reserved = fs.statSync(output);
    try {
      hooks.afterReserve?.();
      for (const member of files(staging).filter(
        (m) => m !== "publication-commit-v1.json",
      )) {
        const source = path.join(staging, member);
        const destination = path.join(output, member);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(source, destination);
      }
      assert(
        fs.statSync(output).ino === reserved.ino &&
          fs.readFileSync(ownerFile, "utf8") === owner,
        "publication reservation ownership lost",
      );
      fs.rmSync(ownerFile);
      fs.renameSync(
        path.join(staging, "publication-commit-v1.json"),
        path.join(output, "publication-commit-v1.json"),
      );
    } catch (error) {
      if (
        fs.existsSync(ownerFile) &&
        fs.statSync(output).ino === reserved.ino &&
        fs.readFileSync(ownerFile, "utf8") === owner
      )
        fs.rmSync(output, { recursive: true, force: true });
      throw error;
    }
    return await verifyPublished(output, authorization, capability);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

function syntheticAuthorization(candidate: string): J {
  const packets = load(
    path.join(candidate, "candidate-packets-v1.json"),
  ).packets;
  return {
    ...blankAuthorization(candidate, packets),
    schema_version: "verified_dossiers_reviewer_authorization_v1.0.0",
    status: "authorized",
    candidate_descriptor_sha256: filePin(
      path.join(candidate, "descriptor-v1.json"),
    ).sha256,
    approved_reviewer: {
      reviewer_id: "synthetic-independent-reviewer-test-only",
      session_id: "synthetic-independent-session-test-only",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
    },
    authorizing_authority: {
      identity: "synthetic-gate-g-coordinator-test-only",
      session_id: "synthetic-gate-g-coordinator-session-test-only",
      role: "gate_g_review_authority",
    },
    authorized_at: "2026-07-14T19:00:00Z",
  };
}
function syntheticReceipt(
  candidate: string,
  authorizationFile: string,
  accepted = 25,
): J {
  const t = load(
    path.join(candidate, "independent-dossier-review.template-v1.json"),
  );
  let acceptedRemaining = accepted;
  const dispositions = t.dispositions.map((d: J, i: number) => {
    const isAccepted = d.publication_eligible && acceptedRemaining > 0;
    if (isAccepted) acceptedRemaining--;
    return {
      ...d,
      disposition: isAccepted ? "accepted" : i % 2 ? "held" : "rejected",
      approvals: isAccepted
        ? {
            visual_evidence: true,
            metadata_labeling: true,
            rights_attribution: true,
            uncertainty: true,
            projection_fidelity: true,
          }
        : d.approvals,
      rationale: "Synthetic test-only disposition; never review authority.",
    };
  });
  assert(
    acceptedRemaining === 0,
    "synthetic acceptance request exceeds eligible cohort",
  );
  return {
    schema_version: "verified_dossiers_completed_independent_review_v1.0.0",
    authorization_sha256: filePin(authorizationFile).sha256,
    candidate_descriptor_sha256: filePin(
      path.join(candidate, "descriptor-v1.json"),
    ).sha256,
    reviewer: {
      reviewer_id: "synthetic-independent-reviewer-test-only",
      session_id: "synthetic-independent-session-test-only",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      reviewed_at: "2026-07-14T20:00:00Z",
      independence_attestations: {
        no_author_overlap: true,
        no_gate_e_source_review_overlap: true,
        no_gate_f_source_review_overlap: true,
        no_implementation_overlap: true,
      },
    },
    dispositions,
    counts: {
      candidates: 36,
      accepted,
      held: dispositions.filter((d: J) => d.disposition === "held").length,
      rejected: dispositions.filter((d: J) => d.disposition === "rejected")
        .length,
      fully_verified: accepted,
    },
  };
}
function normalCliReviewRefused(
  candidate: string,
  receipt: string,
  authorization: string,
): boolean {
  try {
    execFileSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [
        fileURLToPath(import.meta.url),
        "validate-review",
        "--candidate",
        candidate,
        "--receipt",
        receipt,
        "--authorization",
        authorization,
      ],
      { cwd: ROOT, stdio: "ignore" },
    );
    return false;
  } catch {
    return true;
  }
}
function resealCandidate(root: string): void {
  const bundle = load(path.join(root, "candidate-packets-v1.json"));
  for (const p of bundle.packets) {
    writeJson(
      path.join(root, `projections/json/${p.record.numeric_id}.json`),
      p,
    );
    fs.writeFileSync(
      path.join(root, `projections/html/${p.record.numeric_id}.html`),
      candidateHtml(p),
    );
  }
  resealCandidateEnvelope(root);
}
function resealCandidateEnvelope(root: string): void {
  const bundle = load(path.join(root, "candidate-packets-v1.json"));
  const manifestMembers = files(root).filter(
    (m) =>
      ![
        "packet-manifest-v1.json",
        "independent-dossier-review.template-v1.json",
        "reviewer-authorization.template-v1.json",
        "status-report-v1.json",
        "descriptor-v1.json",
      ].includes(m),
  );
  writeJson(
    path.join(root, "packet-manifest-v1.json"),
    packetManifest(root, manifestMembers),
  );
  writeJson(
    path.join(root, "independent-dossier-review.template-v1.json"),
    blankReview(root, bundle.packets),
  );
  writeJson(
    path.join(root, "reviewer-authorization.template-v1.json"),
    blankAuthorization(root, bundle.packets),
  );
  writeJson(
    path.join(root, "descriptor-v1.json"),
    candidateDescriptor(
      root,
      files(root).filter((m) => m !== "descriptor-v1.json"),
    ),
  );
}
function resealPublicationEnvelope(root: string): void {
  const descriptorPath = path.join(root, "publication-descriptor-v1.json");
  const descriptor = load(descriptorPath);
  descriptor.members = tree(
    root,
    files(root).filter(
      (member) =>
        ![
          "publication-descriptor-v1.json",
          "publication-commit-v1.json",
        ].includes(member),
    ),
  );
  writeJson(descriptorPath, descriptor);
  const commitPath = path.join(root, "publication-commit-v1.json");
  const commit = load(commitPath);
  commit.inputs = PUBLICATION_COMMIT_INPUTS.map((member) =>
    filePin(path.join(root, member), member),
  );
  writeJson(commitPath, commit);
}
async function resealPublishedFromSupplied(root: string): Promise<void> {
  const publishedPath = path.join(root, "published-dossiers-v1.json");
  const published = load(publishedPath);
  writeJson(publishedPath, published);
  for (const dossier of published.dossiers) {
    writeJson(
      path.join(
        root,
        `published-projections/json/${dossier.record.numeric_id}.json`,
      ),
      dossier,
    );
    fs.writeFileSync(
      path.join(
        root,
        `published-projections/html/${dossier.record.numeric_id}.html`,
      ),
      publishedHtml(dossier),
    );
  }
  for (let page = 0; page < 3; page++)
    fs.writeFileSync(
      path.join(
        root,
        `published-projections/contact-sheets/page-0${page + 1}.jpg`,
      ),
      await sheetPageBytes(
        root,
        published.dossiers,
        page,
        publishedSheetLabel,
        "overlays",
      ),
    );
  resealPublicationEnvelope(root);
}
async function selfTest(): Promise<J> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-g-self-")),
    candidate = path.join(root, "candidate");
  let cases = 0,
    rejected = 0;
  try {
    await build(candidate);
    await verifyCandidate(candidate, false);
    cases++;
    const authorization = path.join(root, "authorization.json");
    writeJson(authorization, syntheticAuthorization(candidate));
    const capability = internalAuthorizationCapability(
      candidate,
      authorization,
    );
    const base = syntheticReceipt(candidate, authorization),
      receipt = path.join(root, "review.json");
    writeJson(receipt, base);
    await validateReview(candidate, receipt, authorization, capability);
    cases++;
    const mutations: Array<[string, (v: J) => void]> = [
      [
        "descriptor",
        (v) => {
          v.candidate_descriptor_sha256 = "0".repeat(64);
        },
      ],
      [
        "author identity",
        (v) => {
          v.reviewer.reviewer_id = AUTHOR.identity;
        },
      ],
      [
        "author session",
        (v) => {
          v.reviewer.session_id = AUTHOR.session_id;
        },
      ],
      [
        "gate e identity",
        (v) => {
          v.reviewer.reviewer_id = forbidden().identities.find(
            (x: string) => x !== AUTHOR.identity,
          );
        },
      ],
      [
        "gate f session",
        (v) => {
          v.reviewer.session_id = forbidden().sessions.find(
            (x: string) => x !== AUTHOR.session_id,
          );
        },
      ],
      [
        "cross field identity",
        (v) => {
          v.reviewer.reviewer_id = forbidden().sessions[0];
        },
      ],
      [
        "cross field session",
        (v) => {
          v.reviewer.session_id = forbidden().identities[0];
        },
      ],
      [
        "untrimmed principal",
        (v) => {
          v.reviewer.reviewer_id = ` ${v.reviewer.reviewer_id}`;
        },
      ],
      [
        "same principal",
        (v) => {
          v.reviewer.session_id = v.reviewer.reviewer_id;
        },
      ],
      [
        "attestation",
        (v) => {
          v.reviewer.independence_attestations.no_implementation_overlap = false;
        },
      ],
      [
        "timestamp",
        (v) => {
          v.reviewer.reviewed_at = "today";
        },
      ],
      [
        "missing row",
        (v) => {
          v.dispositions.pop();
        },
      ],
      [
        "duplicate row",
        (v) => {
          v.dispositions[1] = v.dispositions[0];
        },
      ],
      [
        "numeric id",
        (v) => {
          v.dispositions[0].numeric_id++;
        },
      ],
      [
        "packet hash",
        (v) => {
          v.dispositions[0].packet_sha256 = "0".repeat(64);
        },
      ],
      [
        "json hash",
        (v) => {
          v.dispositions[0].projection_json_sha256 = "0".repeat(64);
        },
      ],
      [
        "html hash",
        (v) => {
          v.dispositions[0].projection_html_sha256 = "0".repeat(64);
        },
      ],
      [
        "overlay hash",
        (v) => {
          v.dispositions[0].overlay_sha256 = "0".repeat(64);
        },
      ],
      [
        "pixel hash",
        (v) => {
          v.dispositions[0].review_pixel_sha256 = "0".repeat(64);
        },
      ],
      [
        "rationale",
        (v) => {
          v.dispositions[0].rationale = "";
        },
      ],
      [
        "visual approval",
        (v) => {
          v.dispositions[0].approvals.visual_evidence = false;
        },
      ],
      [
        "metadata approval",
        (v) => {
          v.dispositions[0].approvals.metadata_labeling = false;
        },
      ],
      [
        "rights approval",
        (v) => {
          v.dispositions[0].approvals.rights_attribution = false;
        },
      ],
      [
        "uncertainty approval",
        (v) => {
          v.dispositions[0].approvals.uncertainty = false;
        },
      ],
      [
        "projection approval",
        (v) => {
          v.dispositions[0].approvals.projection_fidelity = false;
        },
      ],
      [
        "accepted count",
        (v) => {
          v.counts.accepted++;
        },
      ],
      [
        "verified count",
        (v) => {
          v.counts.fully_verified++;
        },
      ],
      [
        "held count",
        (v) => {
          v.counts.held++;
        },
      ],
      [
        "invalid disposition",
        (v) => {
          v.dispositions[0].disposition = "pending";
        },
      ],
      [
        "categorical pilot acceptance",
        (v) => {
          const pilot = v.dispositions.find((d: J) =>
            EXPECTED_HOLDS.includes(d.numeric_id),
          );
          const accepted = v.dispositions.find(
            (d: J) => d.disposition === "accepted",
          );
          pilot.disposition = "accepted";
          pilot.approvals = structuredClone(accepted.approvals);
          accepted.disposition = "held";
          accepted.approvals = {
            visual_evidence: false,
            metadata_labeling: false,
            rights_attribution: false,
            uncertainty: false,
            projection_fidelity: false,
          };
        },
      ],
    ];
    for (const [name, mutate] of mutations) {
      const value = structuredClone(base);
      mutate(value);
      const f = path.join(root, `${name.replaceAll(" ", "-")}.json`);
      writeJson(f, value);
      let failed = false;
      try {
        await validateReview(candidate, f, authorization, capability);
      } catch {
        failed = true;
      }
      assert(failed, `mutation accepted: ${name}`);
      cases++;
      rejected++;
    }
    const authorizationMutations: Array<[string, (v: J) => void]> = [
      [
        "authorization descriptor",
        (v) => {
          v.candidate_descriptor_sha256 = "0".repeat(64);
        },
      ],
      [
        "authorization manifest",
        (v) => {
          v.packet_manifest_sha256 = "0".repeat(64);
        },
      ],
      [
        "authorization scope",
        (v) => {
          v.review_scope.dossier_ids.pop();
        },
      ],
      [
        "authorization reviewer rename",
        (v) => {
          v.approved_reviewer.reviewer_id = "renamed-reviewer-test-only";
        },
      ],
      [
        "authorization model",
        (v) => {
          v.approved_reviewer.model = "different-model";
        },
      ],
      [
        "authorization role",
        (v) => {
          v.authorizing_authority.role = "reviewer";
        },
      ],
      [
        "authorization overlap",
        (v) => {
          v.authorizing_authority.identity = AUTHOR.identity;
        },
      ],
      [
        "authorization timestamp",
        (v) => {
          v.authorized_at = "not-a-time";
        },
      ],
    ];
    for (const [name, mutate] of authorizationMutations) {
      const value = syntheticAuthorization(candidate);
      mutate(value);
      const f = path.join(root, `${name.replaceAll(" ", "-")}.json`);
      writeJson(f, value);
      const receiptValue = structuredClone(base);
      receiptValue.authorization_sha256 = filePin(f).sha256;
      const rf = `${f}.receipt.json`;
      writeJson(rf, receiptValue);
      let failed = false;
      try {
        await validateReview(
          candidate,
          rf,
          f,
          internalAuthorizationCapability(candidate, f),
        );
      } catch {
        failed = true;
      }
      assert(failed, `authorization mutation accepted: ${name}`);
      cases++;
      rejected++;
    }
    const productionAuthority = loadProductionAuthorizationAuthority(FIXTURE);
    const productionPin = productionAuthority.pin;
    cases++;
    verifyTrackedAuthorizationAuthority(
      candidate,
      capability.pin,
      capability.authorityReader,
    );
    cases++;
    type AuthorityMutation = {
      name: string;
      mutatePin?: (pin: J) => void;
      mutateAuthorization?: (authorization: J) => void;
      committedBytes?: (working: Buffer) => Buffer;
    };
    const authorityMutations: AuthorityMutation[] = [
      {
        name: "tracked authority path",
        mutatePin: (pin) => {
          pin.authorization_file.path = "authorization-renamed.json";
        },
      },
      {
        name: "tracked authority hash",
        mutatePin: (pin) => {
          pin.authorization_file.sha256 = "0".repeat(64);
        },
      },
      {
        name: "tracked authority bytes",
        mutatePin: (pin) => {
          pin.authorization_file.bytes++;
        },
      },
      {
        name: "tracked authority candidate descriptor",
        mutateAuthorization: (value) => {
          value.candidate_descriptor_sha256 = "0".repeat(64);
        },
      },
      {
        name: "tracked authority packet manifest",
        mutateAuthorization: (value) => {
          value.packet_manifest_sha256 = "0".repeat(64);
        },
      },
      {
        name: "tracked authority review scope",
        mutateAuthorization: (value) => {
          value.review_scope.scope_id = "wrong-review-scope";
        },
      },
      {
        name: "tracked authority reviewer",
        mutateAuthorization: (value) => {
          value.approved_reviewer.reviewer_id = "different-reviewer";
        },
      },
      {
        name: "tracked authority authorizer",
        mutateAuthorization: (value) => {
          value.authorizing_authority.identity = "different-authorizer";
        },
      },
      {
        name: "tracked authority timestamp",
        mutateAuthorization: (value) => {
          value.authorized_at = "2026-07-14T19:00:01Z";
        },
      },
      {
        name: "tracked authority forbidden principals",
        mutateAuthorization: (value) => {
          value.forbidden_principals.identities[0] = "different-principal";
          value.forbidden_principals.identities.sort();
        },
      },
      {
        name: "tracked authority uncommitted bytes",
        committedBytes: (working) =>
          Buffer.concat([working, Buffer.from("\n")]),
      },
    ];
    for (const mutation of authorityMutations) {
      const pin = structuredClone(capability.pin);
      const authorizationValue = syntheticAuthorization(candidate);
      mutation.mutateAuthorization?.(authorizationValue);
      const working = Buffer.from(pretty(authorizationValue));
      if (mutation.mutateAuthorization) {
        pin.authorization_file.sha256 = hash(working);
        pin.authorization_file.bytes = working.length;
      }
      mutation.mutatePin?.(pin);
      const committed = mutation.committedBytes
        ? mutation.committedBytes(working)
        : working;
      let failed = false;
      try {
        verifyTrackedAuthorizationAuthority(
          candidate,
          pin,
          memoryAuthorityReader(working, committed),
        );
      } catch {
        failed = true;
      }
      assert(failed, `active authority mutation accepted: ${mutation.name}`);
      cases++;
      rejected++;
    }
    const differentSuppliedAuthorization = path.join(
      root,
      "different-supplied-authorization.json",
    );
    const differentSuppliedValue = syntheticAuthorization(candidate);
    differentSuppliedValue.artifact_id = "different-artifact-id";
    writeJson(differentSuppliedAuthorization, differentSuppliedValue);
    let differentSuppliedRejected = false;
    try {
      validateAuthorization(
        candidate,
        differentSuppliedAuthorization,
        null,
        capability,
      );
    } catch {
      differentSuppliedRejected = true;
    }
    assert(
      differentSuppliedRejected,
      "authorization bytes outside tracked authority were accepted",
    );
    cases++;
    rejected++;
    const productionReviewRejected = normalCliReviewRefused(
      candidate,
      receipt,
      authorization,
    );
    assert(
      productionReviewRejected,
      productionPin.state === "unconfigured"
        ? "normal CLI accepted an unconfigured production pin"
        : "normal CLI accepted authorization bytes not matching the active pin",
    );
    cases++;
    rejected++;
    const fabricatedPin = path.join(root, "fabricated-active-pin.json");
    writeJson(fabricatedPin, activeAuthorizationPin(candidate, authorization));
    assert(
      normalCliReviewRefused(candidate, receipt, authorization),
      "normal CLI accepted a fabricated active pin outside the tracked path",
    );
    cases++;
    rejected++;
    const renamedAuthorization = path.join(root, "renamed-authorization.json");
    const renamedAuthorizationValue = syntheticAuthorization(candidate);
    renamedAuthorizationValue.approved_reviewer.reviewer_id =
      "reviewer-91-independent";
    renamedAuthorizationValue.approved_reviewer.session_id =
      "reviewer-session-91-independent";
    renamedAuthorizationValue.authorizing_authority.identity =
      "gate-g-coordinator-authority";
    renamedAuthorizationValue.authorizing_authority.session_id =
      "gate-g-coordinator-session";
    writeJson(renamedAuthorization, renamedAuthorizationValue);
    const renamedReceipt = path.join(root, "renamed-receipt.json");
    const renamedReceiptValue = structuredClone(base);
    renamedReceiptValue.authorization_sha256 =
      filePin(renamedAuthorization).sha256;
    renamedReceiptValue.reviewer.reviewer_id =
      renamedAuthorizationValue.approved_reviewer.reviewer_id;
    renamedReceiptValue.reviewer.session_id =
      renamedAuthorizationValue.approved_reviewer.session_id;
    writeJson(renamedReceipt, renamedReceiptValue);
    assert(
      normalCliReviewRefused(candidate, renamedReceipt, renamedAuthorization),
      "normal CLI accepted renamed synthetic authorization",
    );
    cases++;
    rejected++;
    const routeMismatchCapability: InternalAuthorizationCapability = {
      [INTERNAL_AUTHORIZATION_CAPABILITY]: true,
      pin: structuredClone(capability.pin),
      authorityReader: capability.authorityReader,
    };
    routeMismatchCapability.pin.approved_reviewer.reviewer_id =
      "different-authorized-reviewer";
    let routeMismatchRejected = false;
    try {
      await validateReview(
        candidate,
        receipt,
        authorization,
        routeMismatchCapability,
      );
    } catch {
      routeMismatchRejected = true;
    }
    assert(routeMismatchRejected, "authorization pin route mismatch passed");
    cases++;
    rejected++;
    const hashMismatchCapability: InternalAuthorizationCapability = {
      [INTERNAL_AUTHORIZATION_CAPABILITY]: true,
      pin: structuredClone(capability.pin),
      authorityReader: capability.authorityReader,
    };
    hashMismatchCapability.pin.authorization_file.sha256 = "0".repeat(64);
    let hashMismatchRejected = false;
    try {
      await validateReview(
        candidate,
        receipt,
        authorization,
        hashMismatchCapability,
      );
    } catch {
      hashMismatchRejected = true;
    }
    assert(
      hashMismatchRejected,
      "authorization pin exact hash mismatch passed",
    );
    cases++;
    rejected++;
    const candidateMutations: Array<[string, (p: J, all: J[]) => void]> = [
      [
        "split",
        (p) => {
          p.record.split = "changed";
        },
      ],
      [
        "component",
        (p, all) => {
          p.record.component_id = all[1].record.component_id;
        },
      ],
      [
        "external claim",
        (p) => {
          p.external_claims.push({ unsupported: true });
        },
      ],
      [
        "metadata label",
        (p) => {
          p.archive_metadata.evidence_class = "historical_truth";
        },
      ],
      [
        "rights",
        (p) => {
          p.rights.complete = false;
        },
      ],
      [
        "ground rights url",
        (p) => {
          p.rights.evidence.evidence.dataset_page.requested_url =
            "https://example.invalid/";
        },
      ],
      [
        "ground rights snapshot",
        (p) => {
          p.rights.evidence.evidence.montreal_license_page.snapshot.sha256 =
            "0".repeat(64);
        },
      ],
      [
        "aerial receipt pin",
        (p) => {
          p.rights.evidence.authority_receipt.sha256 = "0".repeat(64);
        },
      ],
      [
        "aerial proposition hash",
        (p) => {
          p.rights.evidence.license.text_sha256 = "0".repeat(64);
        },
      ],
      [
        "aerial disposition",
        (p) => {
          p.rights.evidence.disposition.evidence_disposition = "held";
        },
      ],
      [
        "visual predicate",
        (p) => {
          p.visual_claims[0].predicate = "place";
        },
      ],
      [
        "expected hold",
        (p) => {
          p.expected_review_disposition = "held";
        },
      ],
      [
        "fully verified",
        (p) => {
          p.fully_verified = true;
        },
      ],
    ];
    for (const [name, mutate] of candidateMutations) {
      const copy = path.join(root, `resealed-${name.replaceAll(" ", "-")}`);
      fs.cpSync(candidate, copy, { recursive: true });
      const value = load(path.join(copy, "candidate-packets-v1.json"));
      const target =
        name === "expected hold"
          ? value.packets.find(
              (p: J) => !EXPECTED_HOLDS.includes(p.record.numeric_id),
            )
          : name.startsWith("aerial ")
            ? value.packets.find((p: J) => p.record.stratum === "aerial")
            : value.packets.find((p: J) => p.visual_claims.length);
      mutate(target, value.packets);
      writeJson(path.join(copy, "candidate-packets-v1.json"), value);
      resealCandidate(copy);
      let bad = false;
      try {
        await verifyCandidate(copy, false);
      } catch {
        bad = true;
      }
      assert(bad, `resealed candidate mutation passed: ${name}`);
      fs.rmSync(copy, { recursive: true, force: true });
      cases++;
      rejected++;
    }
    const visibleHtml = path.join(root, "resealed-visible-html");
    fs.cpSync(candidate, visibleHtml, { recursive: true });
    fs.appendFileSync(
      path.join(visibleHtml, "projections/html/10.html"),
      "<p>unsupported visible claim</p>\n",
    );
    resealCandidateEnvelope(visibleHtml);
    let visibleHtmlRejected = false;
    try {
      await verifyCandidate(visibleHtml, false);
    } catch {
      visibleHtmlRejected = true;
    }
    assert(visibleHtmlRejected, "resealed visible HTML insertion passed");
    cases++;
    rejected++;
    const short = path.join(root, "short.json");
    writeJson(short, syntheticReceipt(candidate, authorization, 24));
    let failed = false;
    try {
      await publish(
        candidate,
        short,
        authorization,
        path.join(root, "short-output"),
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "24 accepted publication passed");
    cases++;
    rejected++;
    const output = path.join(root, "published");
    await publish(candidate, receipt, authorization, output, capability);
    await verifyPublished(output, authorization, capability);
    let productionPublishRejected = false;
    try {
      await publish(
        candidate,
        receipt,
        authorization,
        path.join(root, "production-pin-required-output"),
      );
    } catch {
      productionPublishRejected = true;
    }
    assert(
      productionPublishRejected,
      productionPin.state === "unconfigured"
        ? "production publish accepted an unconfigured authorization pin"
        : "production publish bypassed the active authorization pin",
    );
    cases++;
    rejected++;
    let productionVerifyRejected = false;
    try {
      await verifyPublished(output, authorization);
    } catch {
      productionVerifyRejected = true;
    }
    assert(
      productionVerifyRejected,
      productionPin.state === "unconfigured"
        ? "production verify-published accepted an unconfigured authorization pin"
        : "production verify-published bypassed the active authorization pin",
    );
    cases++;
    rejected++;
    const publishedStates = load(
      path.join(output, "published-dossiers-v1.json"),
    ).dossiers;
    for (const disposition of ["accepted", "held", "rejected"]) {
      const dossier = publishedStates.find(
        (value: J) => value.independent_review.disposition === disposition,
      );
      assert(dossier, `published ${disposition} state absent`);
      assert(
        dossier.state ===
          (disposition === "accepted"
            ? "published_independently_verified"
            : `retained_${disposition}`) &&
          dossier.fully_verified === (disposition === "accepted") &&
          fs
            .readFileSync(
              path.join(
                output,
                `published-projections/html/${dossier.record.numeric_id}.html`,
              ),
              "utf8",
            )
            .includes(
              disposition === "accepted"
                ? "Independently reviewed and fully verified."
                : `Independent review disposition: ${disposition}. Not fully verified.`,
            ),
        `published ${disposition} projection state mismatch`,
      );
      cases++;
    }
    cases++;
    failed = false;
    try {
      await publish(candidate, receipt, authorization, output, capability);
    } catch {
      failed = true;
    }
    assert(failed, "second publication passed");
    cases++;
    rejected++;
    for (const member of [
      "published-dossiers-v1.json",
      "publication-status-v1.json",
      "publication-descriptor-v1.json",
      "publication-commit-v1.json",
      "published-projections/json/10.json",
      "published-projections/html/10.html",
      "published-projections/contact-sheets/page-01.jpg",
    ]) {
      const copy = path.join(root, `mut-${member.replaceAll("/", "-")}`);
      fs.cpSync(output, copy, { recursive: true });
      const target = path.join(copy, member);
      if (member === "publication-commit-v1.json") {
        const value = load(target);
        value.state = "changed";
        writeJson(target, value);
      } else fs.appendFileSync(target, " ");
      let bad = false;
      try {
        await verifyPublished(copy, authorization, capability);
      } catch {
        bad = true;
      }
      assert(bad, `resealed mutation passed: ${member}`);
      cases++;
      rejected++;
    }
    const coordinatedPublicationMutations: Array<
      [string, (copy: string) => Promise<void>]
    > = [
      [
        "accepted state drift",
        async (copy) => {
          const value = load(path.join(copy, "published-dossiers-v1.json"));
          value.dossiers.find(
            (dossier: J) =>
              dossier.independent_review.disposition === "accepted",
          ).state = "retained_held";
          writeJson(path.join(copy, "published-dossiers-v1.json"), value);
          await resealPublishedFromSupplied(copy);
        },
      ],
      [
        "archive metadata visible claim",
        async (copy) => {
          const value = load(path.join(copy, "published-dossiers-v1.json"));
          value.dossiers[0].archive_metadata.name =
            "Unsupported resealed publication claim";
          writeJson(path.join(copy, "published-dossiers-v1.json"), value);
          await resealPublishedFromSupplied(copy);
        },
      ],
      [
        "published rights drift",
        async (copy) => {
          const value = load(path.join(copy, "published-dossiers-v1.json"));
          value.dossiers[0].rights.attribution = "Unauthorized attribution";
          writeJson(path.join(copy, "published-dossiers-v1.json"), value);
          await resealPublishedFromSupplied(copy);
        },
      ],
      [
        "published visual claim drift",
        async (copy) => {
          const value = load(path.join(copy, "published-dossiers-v1.json"));
          const dossier = value.dossiers.find(
            (candidate: J) => candidate.visual_claims.length,
          );
          dossier.visual_claims[0].statement = "Unauthorized visual claim";
          writeJson(path.join(copy, "published-dossiers-v1.json"), value);
          await resealPublishedFromSupplied(copy);
        },
      ],
      [
        "published uncertainty drift",
        async (copy) => {
          const value = load(path.join(copy, "published-dossiers-v1.json"));
          value.dossiers[0].uncertainty.statement =
            "Unauthorized certainty promotion";
          writeJson(path.join(copy, "published-dossiers-v1.json"), value);
          await resealPublishedFromSupplied(copy);
        },
      ],
      [
        "published reviewer drift",
        async (copy) => {
          const value = load(path.join(copy, "published-dossiers-v1.json"));
          for (const dossier of value.dossiers)
            dossier.independent_review.reviewer.reviewer_id =
              "unauthorized-reviewer";
          writeJson(path.join(copy, "published-dossiers-v1.json"), value);
          const status = load(path.join(copy, "publication-status-v1.json"));
          status.reviewer.reviewer_id = "unauthorized-reviewer";
          writeJson(path.join(copy, "publication-status-v1.json"), status);
          await resealPublishedFromSupplied(copy);
        },
      ],
      [
        "publication status drift",
        async (copy) => {
          const status = load(path.join(copy, "publication-status-v1.json"));
          status.issue_complete = false;
          writeJson(path.join(copy, "publication-status-v1.json"), status);
          resealPublicationEnvelope(copy);
        },
      ],
      [
        "publication descriptor drift",
        async (copy) => {
          const descriptor = load(
            path.join(copy, "publication-descriptor-v1.json"),
          );
          descriptor.source_candidate_descriptor.sha256 = "0".repeat(64);
          writeJson(
            path.join(copy, "publication-descriptor-v1.json"),
            descriptor,
          );
          resealPublicationEnvelope(copy);
        },
      ],
    ];
    for (const [name, mutate] of coordinatedPublicationMutations) {
      const copy = path.join(root, `coordinated-${name.replaceAll(" ", "-")}`);
      fs.cpSync(output, copy, { recursive: true });
      await mutate(copy);
      let bad = false;
      try {
        await verifyPublished(copy, authorization, capability);
      } catch {
        bad = true;
      }
      assert(bad, `coordinated publication reseal passed: ${name}`);
      cases++;
      rejected++;
    }
    const raceOutput = path.join(root, "race-output");
    const competitor = path.join(raceOutput, "competitor");
    let raceRejected = false;
    let beforeReserveRan = false;
    try {
      await publish(candidate, receipt, authorization, raceOutput, capability, {
        beforeReserve: () => {
          beforeReserveRan = true;
          fs.mkdirSync(raceOutput);
          fs.writeFileSync(competitor, "owned elsewhere\n");
        },
      });
    } catch {
      raceRejected = true;
    }
    assert(
      raceRejected,
      "publication race did not reject concurrent destination",
    );
    assert(beforeReserveRan, "publication race hook did not run");
    assert(
      fs.existsSync(raceOutput),
      "publication race removed concurrent destination",
    );
    assert(
      fs.existsSync(competitor),
      "publication race removed competitor sentinel",
    );
    assert(
      fs.readFileSync(competitor, "utf8") === "owned elsewhere\n",
      "publication race replaced concurrent destination",
    );
    cases++;
    rejected++;
    const failedOutput = path.join(root, "failed-output");
    let failureRejected = false;
    try {
      await publish(
        candidate,
        receipt,
        authorization,
        failedOutput,
        capability,
        {
          afterReserve: () => {
            throw new Error("injected install failure");
          },
        },
      );
    } catch {
      failureRejected = true;
    }
    assert(
      failureRejected && !fs.existsSync(failedOutput),
      "failed publication reservation was not cleaned",
    );
    cases++;
    rejected++;
    return {
      self_test: "passed",
      cases,
      adversarial_rejections: rejected,
      production_pin_state: productionPin.state,
      production_authority_evidence:
        productionPin.state === "active"
          ? "committed_authorization_exact"
          : "unconfigured_authorization_absent",
      synthetic_publication_only: true,
      tracked_review_authored: false,
      production_mutation: false,
      paid_gpu: false,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function integration(): Promise<J> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-g-int-"));
  try {
    const candidate = path.join(root, "candidate");
    await build(candidate);
    const review = path.join(root, "review.json");
    const authorization = path.join(root, "authorization.json");
    writeJson(authorization, syntheticAuthorization(candidate));
    const capability = internalAuthorizationCapability(
      candidate,
      authorization,
    );
    writeJson(review, syntheticReceipt(candidate, authorization));
    const output = path.join(root, "published");
    const result = await publish(
      candidate,
      review,
      authorization,
      output,
      capability,
    );
    const replay = path.join(root, "replay");
    await build(replay);
    exact(candidate, replay, "integration replay");
    let refused = false;
    try {
      await publish(candidate, review, authorization, output, capability);
    } catch {
      refused = true;
    }
    assert(refused, "second publication not refused");
    return {
      integration_test: "passed",
      accepted: result.accepted,
      held: result.held,
      rejected: result.rejected,
      candidate_files: files(candidate).length,
      published_files: files(output).length,
      synthetic_receipt_only: true,
      second_publication_refused: true,
      production_mutation: false,
      paid_gpu: false,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const args = parseArgs({
    args: process.argv.slice(3),
    options: {
      output: { type: "string" },
      candidate: { type: "string" },
      receipt: { type: "string" },
      authorization: { type: "string" },
    },
    allowPositionals: true,
  });
  let result: J;
  if (command === "build")
    result = await build(path.resolve(args.values.output ?? ""));
  else if (command === "verify")
    result = await verify(path.resolve(args.values.candidate ?? FIXTURE));
  else if (command === "seal-registry") {
    await verifyCandidate(FIXTURE, false);
    sealRegistry();
    result = await verifyCandidate(FIXTURE);
  } else if (command === "validate-review")
    result = await validateReview(
      path.resolve(args.values.candidate ?? FIXTURE),
      path.resolve(args.values.receipt ?? ""),
      path.resolve(args.values.authorization ?? ""),
    );
  else if (command === "publish")
    result = await publish(
      path.resolve(args.values.candidate ?? FIXTURE),
      path.resolve(args.values.receipt ?? ""),
      path.resolve(args.values.authorization ?? ""),
      path.resolve(args.values.output ?? ""),
    );
  else if (command === "verify-published")
    result = await verifyPublished(
      path.resolve(args.values.output ?? ""),
      path.resolve(args.values.authorization ?? ""),
    );
  else if (command === "self-test") result = await selfTest();
  else if (command === "integration-test") result = await integration();
  else
    throw new Error(
      "usage: build|verify|seal-registry|validate-review|publish|verify-published|self-test|integration-test (review transitions require --authorization)",
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
