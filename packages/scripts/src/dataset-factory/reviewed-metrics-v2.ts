import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import sharp from "sharp";

type J = any;
type Source = {
  source_key: string;
  source_ref: string;
  local_path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  component_id: string;
  split: string;
  rights: J;
  predecessor: J;
  purposes: string[];
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const REL = "docs/dataset-factory/fixtures/reviewed-metrics-v2";
const FIXTURE = path.join(ROOT, REL);
const SCHEMAS = path.join(ROOT, "docs/dataset-factory/schemas/reviewed-metrics-v2");
const REGISTRY = path.join(ROOT, "docs/dataset-factory/artifact-registry.v0.jsonl");
const V1_REL = "docs/dataset-factory/fixtures/reviewed-metrics-publication-v1";
const V1 = path.join(ROOT, V1_REL);
const V1_TASKS = path.join(V1, "candidate-benchmark-tasks-v1.json");
const PHASE_D = path.join(ROOT, "docs/dataset-factory/fixtures/phase-d-scale-v1/candidate-selection-evidence-v1.json");
const GROUND_INPUT = path.join(ROOT, "docs/dataset-factory/fixtures/ground-originals-v1/independent-review-input-v1.json");
const GROUND_ROOT = path.dirname(GROUND_INPUT);
const GROUND_RECORDS = path.join(GROUND_ROOT, "records-v1.json");
const GROUND_TRANSCRIPTIONS = path.join(GROUND_ROOT, "reviewed-visual-transcriptions-v1.json");
const PREDICTION_SCHEMA = path.join(SCHEMAS, "prediction-output.schema.v2.json");
const EXECUTION_AUTHORITY = path.join(ROOT, "docs/dataset-factory/authorities/reviewed-metrics-v2/execution-authorization-v2.json");
const CANDIDATE_ID = "dfv0_reviewed_metrics_v2_candidate_20260715";
const PUBLICATION_ID = "dfv0_reviewed_metrics_v2_publication";
const CREATED = "2026-07-15T00:00:00.000Z";
const IMPLEMENTATION_BASE_COMMIT = "5fe4dfbe51a320a51f1f126b4a2d8cf0722be5dc";
const REVIEWED_CANDIDATE_COMMIT = "73ec8a9acbbbc6cd8713f2ae2d944ca2aebd7140";
const EXECUTION_AUTHORITY_REL = "docs/dataset-factory/authorities/reviewed-metrics-v2/execution-authorization-v2.json";
const TRACKED_AUTHORITY_SHA256 = "34be01a2750894eab27ad8882acb79a0366f1de9b6c85fb96bb84e95ecfd81fa";
const TRACKED_AUTHORITY_BYTES = 56_908;
const V1_EXPECTED = {
  files: 19,
  bytes: 1_005_718,
  tree_sha256: "1e61ba2d92b6ee59f6eb6221b8274ef9a6bcbf56299274da7a5525b1e14974a1",
  final_descriptor_sha256: "e44ca758c7d17d2256b974e714b15795a637d634eb29253a7f7ecee6347c0b93",
  receipt_sha256: "422cd4d3faab3e233af0241ca11dd82cc9a26e75c0af08961698bc342b97552a",
  authorization_sha256: "d66a969563878b6e02f46d965ab374cf7e186d8c518c8d62aa1e275adcd96dbc",
} as const;
const CONTROL_SOURCES = [
  { id: 10145, token: "gold-batch-control:0099:first-view", file: "glb002-0099-0.jpg", sha256: "8c97cfd0b01d8baefd3e122a3d630ef85d535878024f73113e53bdc9a5421ee0", bytes: 145410, width: 1024, height: 662 },
  { id: 8465, token: "gold-batch-control:0001:first-view", file: "glb002-0001-0.jpg", sha256: "0ab54c10ed1a3ea564678232d9fb4a632bb8aeb2a9410b6278dd8b77e1b427b5", bytes: 118212, width: 1024, height: 622 },
  { id: 6059, token: "gold-batch-control:0126:first-view", file: "glb002-0126-0.jpg", sha256: "e620dbbce90fe373f198196adbba431de1ce574cffb230e64195d78def202a5d", bytes: 352794, width: 982, height: 1024 },
] as const;
const IMAGE_IDS = [10,11,17,30,31,33,45,54,58,77,88,100,101,102,105,106,4501,7929,8432,9092,9844,11836,11923,11993,12115,12117,12623,13272,13389,14135,14813,14965,10145,8465,11118,6059];
const AERIAL_IDS = [4501,7929,8432,9092,9844,11836,11923,11993,12115,12117,12623,13272,13389,14135,14813,14965];
const ABSTENTION_IDS = [...AERIAL_IDS, 11118, 6059];
const SCENE_IDS = [0,10,100,101,102,105];
const FIXED_OPAQUE_IDS = Array.from({ length: 44 }, (_, index) => `v2-${String(index + 1).padStart(4, "0")}`);
const IMAGE_MODE_CLASSES = ["ground_street", "aerial_vertical", "aerial_oblique", "document_map", "low_information"] as const;
const ENTITY_TYPES = ["organization", "brand", "person", "building", "street", "place", "other"] as const;
const METRIC_IDS = ["image_mode_accuracy", "ocr_exact_match", "entity_precision", "entity_recall", "place_link_precision", "place_link_recall", "aerial_land_use_micro_f1", "abstention_selective_error"] as const;
const FINAL_CRITERION_IDS = ["96.fixed_memberships", "96.controls_recovered", "96.blind_prediction", "96.independent_gold", "96.reviewed_metrics", "96.authority_chronology", "96.publication", "96.issue_92_close", "96.issue_69_close"];
const EXPECTED_FILES = [
  "blind-bundle-descriptor.template-v2.json", "candidate-criterion-matrix-v2.json",
  "candidate-descriptor-v2.json", "candidate-status-v2.json", "gold-review.template-v2.json",
  "input-authority-v2.json", "manifest-v2.json", "prediction-output.template-v2.json",
  "search-task-candidate-v2.json", "search-task-review.template-v2.json",
  "supersession-candidate-notice-v2.json",
].sort();
const DENY_KEYS = /(?:^|_)(?:class|claim_id|claim|disposition|gold|expected|answer|answers|label|labels|metadata|reviewer|reviewer_material|record|record_id|record_ids|source|source_path|mapping|repo|repository_path|locator|private|component|split|rights)(?:$|_)/i;
const DENY_TEXT = /(?:mtl_archives_metadata_[0-9]+|(?:^|[^a-z])record[_ -]?id(?:[^a-z]|$)|(?:^|[^a-z])claim[_ -]?id(?:[^a-z]|$)|gold[_ -]?(?:label|answer)|expected[_ -]?answer|reviewer[_ -]?material|(?:^|[\s"'])(?:docs|data|packages)\/|\/Users\/|(?:r2|s3|file):\/\/|private[_ -]?(?:locator|route|path)|artifact[s]?\/mtl-archives)/i;
const SAFE_ATTESTATION_KEYS = new Set(["zero_labels", "zero_answers", "zero_reviewer_material", "zero_source_metadata", "forbidden_metadata_fields"]);
const INTERNAL_SYNTHETIC_CAPABILITY = Symbol("reviewed-metrics-v2-internal-synthetic-capability");
type InternalSyntheticCapability = { readonly [INTERNAL_SYNTHETIC_CAPABILITY]: true };
type Reservation = { root: string; marker: string; token: string; dev: number; ino: number };
type ExecutionAuthorityEvidence = { head: string; tracked: boolean; headBytes: Buffer; indexBytes: Buffer; worktreeBytes: Buffer; indexClean: boolean; worktreeClean: boolean };
type ExecutionAuthorityReader = () => ExecutionAuthorityEvidence;
const Ajv2020 = Ajv2020Import as unknown as new (options: J) => J;
const addFormats = addFormatsImport as unknown as (ajv: J) => void;

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function hash(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function canon(value: J): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
}
function pretty(value: J): string { return `${JSON.stringify(value, null, 2)}\n`; }
function load(file: string): J { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file: string, value: J): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, pretty(value)); }
function rel(file: string): string { return path.relative(ROOT, file).split(path.sep).join("/"); }
function pin(file: string, shownPath = rel(file)): J { const b = fs.readFileSync(file); return { path: shownPath, sha256: hash(b), bytes: b.length }; }
function files(root: string, current = root): string[] {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    assert(!entry.isSymbolicLink(), `symlink refused: ${absolute}`);
    if (entry.isDirectory()) return files(root, absolute);
    assert(entry.isFile(), `unexpected filesystem member: ${absolute}`);
    return [path.relative(root, absolute).split(path.sep).join("/")];
  }).sort();
}
function tree(root: string, members = files(root)): J {
  const pins = members.map((member) => pin(path.join(root, member), member));
  return { members: pins, sha256: hash(`${pins.map((x) => `${x.path}\t${x.sha256}\t${x.bytes}`).join("\n")}\n`), bytes: pins.reduce((n, x) => n + x.bytes, 0) };
}
function same(a: J, b: J, label: string): void { assert(canon(a) === canon(b), `${label} differs`); }
function unique<T>(xs: T[], label: string): void { assert(new Set(xs).size === xs.length, `duplicate ${label}`); }
function exactSet(actual: string[], expected: readonly string[], label: string): void {
  unique(actual, label); same([...actual].sort(), [...expected].sort(), `${label} exact set`);
}
function before(a: string, b: string, label: string): void {
  const left = Date.parse(a); const right = Date.parse(b);
  assert(Number.isFinite(left) && Number.isFinite(right) && left < right, `${label} chronology`);
}
function isWithin(candidate: string, protectedRoot: string): boolean {
  return candidate === protectedRoot || candidate.startsWith(`${protectedRoot}${path.sep}`) || protectedRoot.startsWith(`${candidate}${path.sep}`);
}
function physicalPathSafety(output: string): string {
  assert(path.isAbsolute(output), "caller-supplied absolute output route required");
  assert(path.normalize(output) === output, "non-normalized/traversal output route refused");
  assert(!fs.existsSync(output), "output must be absent");
  assert(fs.existsSync(path.dirname(output)), "output parent must already exist");
  let cursor = path.dirname(output);
  for (;;) {
    const st = fs.lstatSync(cursor); const systemAlias = cursor === "/tmp" || cursor === "/var"; assert(!st.isSymbolicLink() || systemAlias, `symlink output ancestor refused: ${cursor}`);
    fs.realpathSync(cursor);
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const existing = fs.realpathSync(path.dirname(output));
  const physical = path.join(existing, path.basename(output));
  const protectedRoots = [ROOT, path.join(os.homedir(), "pkm/0xPKM"), path.join(os.homedir(), "pkm/0xPKM_Lab"), path.join(os.homedir(), ".ssh"), path.join(os.homedir(), ".aws")].filter(fs.existsSync).map((x) => fs.realpathSync(x));
  for (const protectedRoot of protectedRoots) assert(!isWithin(physical, protectedRoot), `output overlaps protected route: ${protectedRoot}`);
  const systemTemporaryPrefix = ["/private/tmp/", "/private/var/folders/"].find((prefix) => physical.startsWith(prefix));
  const privacyChecked = systemTemporaryPrefix ? physical.slice(systemTemporaryPrefix.length) : physical;
  assert(!privacyChecked.split(path.sep).some((part) => /^(?:private|secrets?)$/i.test(part)), "private output route refused");
  return physical;
}
function reserveOutput(output: string): Reservation {
  const root = physicalPathSafety(output); fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  const stat = fs.lstatSync(root); assert(stat.isDirectory() && !stat.isSymbolicLink(), "exclusive output reservation failed");
  const token = crypto.randomBytes(32).toString("hex"); const marker = path.join(root, `.reviewed-metrics-v2-owner-${token}`);
  fs.writeFileSync(marker, `${token}\n`, { flag: "wx", mode: 0o600 });
  return { root, marker, token, dev: stat.dev, ino: stat.ino };
}
function owned(reservation: Reservation): boolean {
  try { const stat = fs.lstatSync(reservation.root); return stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === reservation.dev && stat.ino === reservation.ino && fs.lstatSync(reservation.marker).isFile() && fs.readFileSync(reservation.marker, "utf8") === `${reservation.token}\n`; } catch { return false; }
}
function cleanupOwned(reservation: Reservation): void {
  assert(owned(reservation), "refusing cleanup of output not owned by this invocation"); fs.rmSync(reservation.root, { recursive: true, force: false });
}
function schema(name: string, value: J): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
  for (const file of fs.readdirSync(SCHEMAS).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(path.join(SCHEMAS, file)), file);
  const validate = ajv.getSchema(name); assert(validate && validate(value), `${name}: ${JSON.stringify(validate?.errors)}`);
}
function phaseRow(id: number): J {
  const row = load(PHASE_D).records.find((x: J) => x.numeric_id === id);
  assert(row, `Phase D row missing: ${id}`); return row;
}
function sourceFacts(file: string, expected: { sha256: string; bytes: number; width: number; height: number }): void {
  assert(fs.existsSync(file), `required registered control unavailable: ${expected.sha256}`);
  const b = fs.readFileSync(file); assert(hash(b) === expected.sha256 && b.length === expected.bytes, `control bytes drift: ${expected.sha256}`);
}
async function decoded(file: string): Promise<{ hash: string; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { hash: hash(data), width: info.width, height: info.height, channels: info.channels };
}
function predecessorPins(): J {
  return {
    phase_d: pin(PHASE_D),
    v1_tasks: pin(V1_TASKS),
    v1_receipt: pin(path.join(V1, "independent-task-review-v1.json")),
    v1_descriptor: pin(path.join(V1, "final-descriptor-v1.json")),
    gate_e_promotion: pin(path.join(ROOT, "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/promotion-ledger-v1.json")),
    gate_f_review: pin(path.join(ROOT, "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json")),
    gate_g_descriptor: pin(path.join(ROOT, "docs/dataset-factory/fixtures/verified-dossiers-publication-v1/publication-descriptor-v1.json")),
    ground_input: pin(GROUND_INPUT),
    ground_records: pin(GROUND_RECORDS),
    reviewed_visual_transcriptions: pin(GROUND_TRANSCRIPTIONS),
  };
}
async function sources(): Promise<Source[]> {
  const v1 = load(V1_TASKS).tasks as J[];
  assert(v1.length === 32, "v1 task count drift");
  const byId = new Map(v1.map((task) => [task.record.numeric_id, task]));
  const out: Source[] = [];
  for (const id of IMAGE_IDS) {
    const task = byId.get(id); const row = phaseRow(id); let input: J; let sourceRef: string; let localPath: string; let rights: J;
    if (task) { input = task.input; sourceRef = input.path; localPath = path.join(ROOT, input.path); rights = task.rights; }
    else if (id === 11118) {
      input = row.pixel_evidence.views[0]; sourceRef = input.path; localPath = path.join(ROOT, input.path); rights = row.rights;
    } else {
      const c = CONTROL_SOURCES.find((x) => x.id === id)!;
      localPath = path.join(ROOT, "data/mtl_archives/reports/gold_label_batch_002/packets/views", c.file);
      sourceFacts(localPath, c); input = c; sourceRef = c.token; rights = row.rights;
    }
    const b = fs.readFileSync(localPath); assert(hash(b) === input.sha256 && b.length === input.bytes, `source pin drift: ${id}`);
    const d = await decoded(localPath); assert(d.width === input.width && d.height === input.height, `source dimensions drift: ${id}`);
    out.push({ source_key: `image:${id}`, source_ref: sourceRef, local_path: localPath, sha256: input.sha256, bytes: input.bytes, width: input.width, height: input.height, component_id: row.component_id, split: row.split, rights, predecessor: task ? { v1_task_id: task.task_id, v1_task_sha256: hash(canon(task)) } : { phase_d_row_sha256: hash(canon(row)), registered_artifact_id: id === 11118 ? "canonical_image_recovery_v1" : "dfv0_gold_label_batch_002_final_r2_archive" }, purposes: ["image_mode"] });
  }
  const ground = load(GROUND_INPUT); const groundRecords = load(GROUND_RECORDS); const transcriptions = load(GROUND_TRANSCRIPTIONS);
  assert(transcriptions.input_sha256 === pin(GROUND_INPUT).sha256, "reviewed transcription input authority drift");
  const recordsByNeutral = new Map(groundRecords.records.map((record: J) => [record.neutral_id, record]));
  const transcriptByCrop = new Map(transcriptions.rows.map((row: J) => [row.neutral_crop_id, row]));
  for (let i = 0; i < ground.crops.length; i++) {
    const crop = ground.crops[i]; const file = path.join(GROUND_ROOT, crop.crop_path); const d = await decoded(file);
    assert(hash(fs.readFileSync(file)) === crop.crop_sha256 && d.width === crop.width && d.height === crop.height, "OCR crop drift");
    const record = recordsByNeutral.get(crop.parent_neutral_id) as J; const transcript = transcriptByCrop.get(crop.neutral_crop_id) as J;
    assert(record && record.id === 105 && transcript, `OCR authority mapping missing: ${crop.neutral_crop_id}`);
    const region = record.regions.find((candidate: J) => candidate.region_id === transcript.source_region.region_id);
    assert(region && transcript.parent_neutral_id === record.neutral_id && transcript.crop_sha256 === crop.crop_sha256 && transcript.source_region.numeric_id === record.id && canon(transcript.source_region.native_xyxy) === canon(region.native_xyxy), `OCR semantic join drift: ${crop.neutral_crop_id}`);
    const parent = phaseRow(record.id);
    out.push({ source_key: `ocr:${i + 1}`, source_ref: rel(file), local_path: file, sha256: crop.crop_sha256, bytes: fs.statSync(file).size, width: crop.width, height: crop.height, component_id: parent.component_id, split: parent.split, rights: parent.rights, predecessor: { ground_input_sha256: pin(GROUND_INPUT).sha256, ground_records_sha256: pin(GROUND_RECORDS).sha256, reviewed_visual_transcriptions_sha256: pin(GROUND_TRANSCRIPTIONS).sha256, neutral_crop_id: crop.neutral_crop_id, parent_neutral_id: record.neutral_id, numeric_id: record.id, region_id: region.region_id }, purposes: ["ocr"] });
  }
  for (let i = 0; i < ground.scenes.length; i++) {
    const scene = ground.scenes[i]; const record = recordsByNeutral.get(scene.neutral_id) as J; const id = SCENE_IDS[i];
    assert(record && record.id === id && record.review.path === scene.review_path && record.review.sha256 === scene.review_sha256 && record.review.width === scene.width && record.review.height === scene.height, `ground record mapping drift: ${scene.neutral_id}`);
    const file = path.join(GROUND_ROOT, scene.review_path); const d = await decoded(file); const row = phaseRow(record.id);
    assert(hash(fs.readFileSync(file)) === scene.review_sha256 && d.width === scene.width && d.height === scene.height, `scene drift: ${id}`);
    out.push({ source_key: `scene:${id}`, source_ref: rel(file), local_path: file, sha256: scene.review_sha256, bytes: fs.statSync(file).size, width: scene.width, height: scene.height, component_id: row.component_id, split: row.split, rights: row.rights, predecessor: { ground_input_sha256: pin(GROUND_INPUT).sha256, ground_records_sha256: pin(GROUND_RECORDS).sha256, neutral_scene_id: scene.neutral_id, numeric_id: record.id }, purposes: ["entity_place"] });
  }
  exactSet([...recordsByNeutral.keys()] as string[], ground.scenes.map((scene: J) => scene.neutral_id), "ground neutral record IDs");
  exactSet([...transcriptByCrop.keys()] as string[], ground.crops.map((crop: J) => crop.neutral_crop_id), "reviewed transcription crop IDs");
  for (const source of out) if (source.source_key.startsWith("image:")) {
    const id = Number(source.source_key.split(":")[1]);
    if (AERIAL_IDS.includes(id)) source.purposes.push("aerial_land_use");
    if (ABSTENTION_IDS.includes(id)) source.purposes.push("abstention");
  }
  unique(out.map((x) => x.source_key), "source key"); unique(out.map((x) => x.sha256), "source payload hash");
  assert(out.length === 44, `unique source count drift: ${out.length}`); return out;
}
function taskMembership(sourceRows: Source[]): J {
  const key = new Set(sourceRows.map((x) => x.source_key));
  const subsets = {
    image_mode: IMAGE_IDS.map((id) => `image:${id}`), ocr: ["ocr:1", "ocr:2"],
    entity_place: SCENE_IDS.map((id) => `scene:${id}`), aerial_land_use: AERIAL_IDS.map((id) => `image:${id}`),
    abstention: ABSTENTION_IDS.map((id) => `image:${id}`),
  };
  same(Object.fromEntries(Object.entries(subsets).map(([k, v]) => [k, v.length])), { image_mode: 36, ocr: 2, entity_place: 6, aerial_land_use: 16, abstention: 18 }, "fixed subset counts");
  for (const id of Object.values(subsets).flat()) assert(key.has(id), `membership source missing: ${id}`);
  return subsets;
}
function publicSource(source: Source, index: number, pixel: J): J {
  return {
    opaque_id: `v2-${String(index + 1).padStart(4, "0")}`,
    source_key: source.source_key, source_ref: source.source_ref,
    source: { sha256: source.sha256, bytes: source.bytes, width: source.width, height: source.height, normalized_pixel_sha256: pixel.hash, sanitized_normalized_pixel_sha256: pixel.hash },
    component_id: source.component_id, split: source.split,
    rights: { license_id: source.rights.license_id ?? null, attribution: source.rights.attribution ?? null, commercial_use_allowed: source.rights.commercial_use_allowed ?? null, complete: source.rights.complete ?? null },
    predecessor: source.predecessor, purposes: source.purposes,
  };
}
function blankPrediction(ids: string[]): J { return { schema_version: "reviewed_metrics_prediction_output_v2.0.0", status: "blank_no_prediction", candidate_id: CANDIDATE_ID, bundle_tree_sha256: null, session: null, outputs: [], required_opaque_ids: ids, attestations: { no_gold_received: true, no_expected_answers_received: true, no_repo_access: true, one_run_only: true } }; }
function blankGold(ids: string[]): J { return { schema_version: "reviewed_metrics_gold_review_authority_v2.0.0", status: "blank_external_review_required", candidate_id: CANDIDATE_ID, bundle_tree_sha256: null, reviewer: null, reviews: [], required_opaque_ids: ids, reviewed_exclusions: [], source_task_dossier_decision: null, private_expected_commitment: null }; }
function blankTaskReview(): J { return { schema_version: "reviewed_metrics_search_task_review_v2.0.0", status: "placeholder_issue_97_no_review", candidate_id: CANDIDATE_ID, task_pin: null, prediction_freeze_pin: null, score_commitment_pin: null, reviewer: null, checks: null, disposition: null, rationale: null }; }
async function candidateDocuments(output: string): Promise<Map<string, J>> {
  const raw = await sources(); const pixels = await Promise.all(raw.map((x) => decoded(x.local_path)));
  const inputs = raw.map((x, i) => publicSource(x, i, pixels[i])); const membership = taskMembership(raw); const ids = inputs.map((x) => x.opaque_id);
  const authority = { schema_version: "reviewed_metrics_input_authority_v2.0.0", artifact_id: CANDIDATE_ID, status: "fixed_membership_candidate_no_execution_authority", created_at: CREATED, implementation_base_commit: IMPLEMENTATION_BASE_COMMIT, candidate_commit: null, inputs, subsets: membership, counts: { unique_sources: 44, task_memberships: 78, image_mode: 36, ocr: 2, entity_place: 6, aerial_land_use: 16, abstention: 18 }, predecessors: predecessorPins(), mutations: { production: false, search_index: false, private_object_store_write: false, paid_gpu: false } };
  const blindTemplate = { schema_version: "reviewed_metrics_blind_bundle_descriptor_v2.0.0", status: "template_no_bundle_built", candidate_id: CANDIDATE_ID, generator_version: "blind-png-v2", members: [], media_tree: null, purpose: "uniform blind visual annotation over 44 opaque media inputs", output_schema: pin(PREDICTION_SCHEMA, "prediction-output.schema.v2.json"), scans: { denylisted_keys: 0, denylisted_text: 0, forbidden_metadata_fields: 0, ancillary_png_chunks: 0, extra_files: 0 }, attestations: { zero_labels: true, zero_answers: true, zero_reviewer_material: true, zero_source_metadata: true } };
  const matrix = { schema_version: "reviewed_metrics_final_criterion_matrix_v2.0.0", status: "candidate_open", candidate_id: CANDIDATE_ID, rows: [
    { criterion_id: "96.fixed_memberships", required: true, verdict: "satisfied_candidate", result_ids: ["input-authority-v2"], evidence: [pin(V1_TASKS), pin(PHASE_D)], limitations: [] },
    { criterion_id: "96.controls_recovered", required: true, verdict: "satisfied_local_untracked_sources", result_ids: ["input-authority-v2"], evidence: CONTROL_SOURCES.map((x) => ({ registered_artifact_id: "dfv0_gold_label_batch_002_final_r2_archive", source_sha256: x.sha256, bytes: x.bytes })), limitations: ["Source payloads remain ignored and are not duplicated in the candidate."] },
    ...["blind_prediction", "independent_gold", "reviewed_metrics", "authority_chronology", "publication", "issue_92_close", "issue_69_close"].map((id) => ({ criterion_id: `96.${id}`, required: true, verdict: "pending", result_ids: [], evidence: [], limitations: ["Not executed by issue #96 candidate construction."] })),
  ], issue_92_complete: false, issue_69_complete: false };
  const search = { schema_version: "reviewed_metrics_search_task_v2.0.0", status: "placeholder_issue_97_no_task_authority", candidate_id: CANDIDATE_ID, internal_provenance: null, public_projection: null, source_only_boundary: true, private_expected_commitment: null, rights_policy: null, component: null, split: null, review_state: "not_started" };
  const status = { schema_version: "reviewed_metrics_candidate_status_v2.0.0", artifact_id: CANDIDATE_ID, status: "candidate_ready_no_execution_authority", counts: authority.counts, issue_92_complete: false, issue_69_complete: false, candidate_complete: false, publication_exists: false, prediction_exists: false, gold_exists: false, mutations: authority.mutations, stop_conditions: [] };
  const supersession = { schema_version: "reviewed_metrics_supersession_candidate_notice_v2.0.0", status: "candidate_notice_v2_does_not_yet_exist", v2_publication_exists: false, current_close_authority: null, v1_historical_publication: { tree_sha256: V1_EXPECTED.tree_sha256, final_descriptor_sha256: V1_EXPECTED.final_descriptor_sha256, receipt_sha256: V1_EXPECTED.receipt_sha256, authorization_sha256: V1_EXPECTED.authorization_sha256 }, proposed_superseded_claims: ["v1 issue_complete=true as current close authority", "v1 69.reviewed_metrics satisfied_with_unavailable_denominators", "v1 satisfied task rows pointing to a blank template", "task acceptance alone proves all issue criteria"], preserved_claims: ["32 independently accepted v1 image-mode tasks and their exact receipt"], issue_92_complete: false, issue_69_complete: false };
  const map = new Map<string, J>([
    ["input-authority-v2.json", authority], ["blind-bundle-descriptor.template-v2.json", blindTemplate],
    ["prediction-output.template-v2.json", blankPrediction(ids)], ["gold-review.template-v2.json", blankGold(ids)],
    ["search-task-candidate-v2.json", search], ["search-task-review.template-v2.json", blankTaskReview()],
    ["candidate-criterion-matrix-v2.json", matrix], ["candidate-status-v2.json", status],
    ["supersession-candidate-notice-v2.json", supersession],
  ]);
  for (const [name, value] of map) writeJson(path.join(output, name), value);
  const candidateMembers = () => files(output).filter((member) => !/^\.reviewed-metrics-v2-owner-[a-f0-9]{64}$/.test(member));
  const preManifest = tree(output, candidateMembers());
  const manifest = { schema_version: "reviewed_metrics_candidate_manifest_v2.0.0", artifact_id: CANDIDATE_ID, members: preManifest.members, content_sha256: preManifest.sha256, counts: { files_before_manifest_and_descriptor: preManifest.members.length, bytes_before_manifest_and_descriptor: preManifest.bytes } };
  writeJson(path.join(output, "manifest-v2.json"), manifest); map.set("manifest-v2.json", manifest);
  const beforeDescriptor = tree(output, candidateMembers());
  const descriptor = { schema_version: "reviewed_metrics_candidate_descriptor_v2.0.0", artifact_id: CANDIDATE_ID, status: "candidate_only", created_at: CREATED, implementation_base_commit: IMPLEMENTATION_BASE_COMMIT, candidate_commit: null, members_before_descriptor: beforeDescriptor.members, tree_before_descriptor_sha256: beforeDescriptor.sha256, counts: { files_before_descriptor: beforeDescriptor.members.length, bytes_before_descriptor: beforeDescriptor.bytes, unique_sources: 44, task_memberships: 78 }, predecessors: predecessorPins(), completion: { candidate_complete: false, issue_92_complete: false, issue_69_complete: false, publication_exists: false }, mutations: authority.mutations };
  writeJson(path.join(output, "candidate-descriptor-v2.json"), descriptor); map.set("candidate-descriptor-v2.json", descriptor); return map;
}
async function build(output = FIXTURE): Promise<J> {
  assert(path.resolve(output) !== V1, "v1 output route refused"); const reservation = reserveOutput(path.resolve(output));
  let markerRemoved = false;
  try { await candidateDocuments(reservation.root); fs.rmSync(reservation.marker); markerRemoved = true; const result = await verifyCandidate(reservation.root, false); return { status: "candidate_built", ...result }; }
  catch (error) { if (markerRemoved) { try { const stat = fs.lstatSync(reservation.root); if (stat.dev === reservation.dev && stat.ino === reservation.ino) fs.writeFileSync(reservation.marker, `${reservation.token}\n`, { flag: "wx", mode: 0o600 }); } catch {} } if (owned(reservation)) cleanupOwned(reservation); throw error; }
}
function validateDenylist(value: J, where = "$"): number {
  let scans = 1;
  if (Array.isArray(value)) { value.forEach((x, i) => { scans += validateDenylist(x, `${where}[${i}]`); }); return scans; }
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { assert(SAFE_ATTESTATION_KEYS.has(key) || !DENY_KEYS.test(key), `denylisted key at ${where}.${key}`); scans += validateDenylist(child, `${where}.${key}`); }
  else if (typeof value === "string") assert(where.endsWith(".schema_version") || where.endsWith(".output_schema") || where.endsWith(".candidate_id") || !DENY_TEXT.test(value), `denylisted text at ${where}`);
  return scans;
}
function assertSanitizedMetadata(metadata: J): void {
  const unexpected = ["exif", "icc", "iptc", "xmp", "comments", "comment", "profiles", "thumbnail"].filter((key) => metadata[key] != null);
  assert(unexpected.length === 0, `unexpected metadata/profile/comment: ${unexpected.join(",")}`);
}
function pngChunks(buffer: Buffer): { type: string; bytes: Buffer }[] {
  assert(buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "PNG signature drift");
  const chunks: { type: string; bytes: Buffer }[] = []; let offset = 8;
  while (offset < buffer.length) { const length = buffer.readUInt32BE(offset); const end = offset + 12 + length; assert(end <= buffer.length, "PNG chunk bounds"); const type = buffer.subarray(offset + 4, offset + 8).toString("ascii"); chunks.push({ type, bytes: buffer.subarray(offset, end) }); offset = end; }
  assert(chunks.at(-1)?.type === "IEND" && offset === buffer.length, "PNG terminal chunk drift"); return chunks;
}
function stripPngAncillary(file: string): void {
  const input = fs.readFileSync(file); const critical = pngChunks(input).filter((chunk) => chunk.type[0] === chunk.type[0].toUpperCase());
  assert(critical.some((chunk) => chunk.type === "IHDR") && critical.some((chunk) => chunk.type === "IDAT") && critical.at(-1)?.type === "IEND", "PNG critical chunks missing");
  fs.writeFileSync(file, Buffer.concat([input.subarray(0, 8), ...critical.map((chunk) => chunk.bytes)]));
}
function assertOnlyCriticalPng(file: string): void { const ancillary = pngChunks(fs.readFileSync(file)).filter((chunk) => chunk.type[0] !== chunk.type[0].toUpperCase()); assert(ancillary.length === 0, `ancillary PNG chunks remain: ${ancillary.map((x) => x.type).join(",")}`); }
async function expectedAuthority(): Promise<J> { const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-authority-")); try { const docs = await candidateDocuments(temp); return docs.get("input-authority-v2.json"); } finally { fs.rmSync(temp, { recursive: true, force: true }); } }
async function trackedAuthority(injected?: J, capability?: InternalSyntheticCapability): Promise<J> {
  if (injected !== undefined) { assert(capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true, "internal authority injection capability required"); schema("input-authority.schema.v2.json", injected); same(injected, await expectedAuthority(), "injected authority semantic binding"); return injected; }
  const fixed = path.join(FIXTURE, "input-authority-v2.json"); const bytes = fs.readFileSync(fixed);
  assert(hash(bytes) === TRACKED_AUTHORITY_SHA256 && bytes.length === TRACKED_AUTHORITY_BYTES, "tracked input authority exact bytes drift");
  const authority = JSON.parse(bytes.toString("utf8")); schema("input-authority.schema.v2.json", authority); same(authority, await expectedAuthority(), "tracked authority semantic binding");
  exactSet(authority.inputs.map((input: J) => input.opaque_id), FIXED_OPAQUE_IDS, "authority opaque IDs"); return authority;
}
function assertNeutralBundleSemantics(descriptor: J, instructions: J): void {
  const visible = pretty({ descriptor, instructions }).toLowerCase();
  for (const forbidden of ["image_mode", "ocr", "entity_place", "aerial_land_use", "abstention", "subset", "membership", "purpose", "task_memberships"]) assert(!visible.includes(forbidden), `predictor-visible semantic inference token: ${forbidden}`);
  assert(descriptor.members.length === 44 && instructions.required_member_ids.length === 44, "uniform bundle count drift");
  for (const member of descriptor.members) same(Object.keys(member).sort(), ["bytes", "filename", "height", "opaque_id", "sha256", "width"].sort(), `uniform member fields ${member.opaque_id}`);
}
async function buildBlindBundle(output: string, injected?: J, capability?: InternalSyntheticCapability, failAfterReservation = false): Promise<J> {
  const reservation = reserveOutput(output); let markerRemoved = false;
  try {
  const authority = await trackedAuthority(injected, capability); if (failAfterReservation) throw new Error("synthetic failure after reservation");
  const raw = await sources(); const byKey = new Map(raw.map((x) => [x.source_key, x])); fs.mkdirSync(path.join(reservation.root, "media"), { recursive: false });
  const members: J[] = [];
  for (const input of authority.inputs) {
    const source = byKey.get(input.source_key); assert(source && source.sha256 === input.source.sha256, "source authority substitution");
    const filename = `${input.opaque_id}.png`; assert(/^v2-[0-9]{4}\.png$/.test(filename), "opaque filename invalid");
    const target = path.join(reservation.root, "media", filename);
    await sharp(source.local_path).removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toFile(target);
    stripPngAncillary(target);
    const before = await decoded(source.local_path); const after = await decoded(target); same(after, before, `normalized pixel drift ${input.opaque_id}`);
    assert(input.source.normalized_pixel_sha256 === before.hash && input.source.sanitized_normalized_pixel_sha256 === after.hash, `authority normalized-pixel binding drift ${input.opaque_id}`);
    const metadata = await sharp(target).metadata();
    assertSanitizedMetadata(metadata); assertOnlyCriticalPng(target);
    members.push({ opaque_id: input.opaque_id, filename: `media/${filename}`, sha256: hash(fs.readFileSync(target)), bytes: fs.statSync(target).size, width: after.width, height: after.height });
  }
  unique(members.map((x) => x.opaque_id), "opaque ID"); unique(members.map((x) => x.sha256), "sanitized hash");
  const instructions = { schema_version: "reviewed_metrics_blind_instructions_v2.0.0", assignment: "Annotate every opaque media input using every field in the bundled schema.", output_schema: "prediction-output.schema.v2.json", required_member_ids: members.map((x) => x.opaque_id), constraints: ["Return exactly one complete output object per required opaque ID.", "Use null, empty arrays, or the schema-defined uncertainty object when visual evidence does not support a value.", "Do not access any route outside this bundle and the assigned output route."] };
  validateDenylist(instructions); writeJson(path.join(reservation.root, "instructions.json"), instructions);
  fs.copyFileSync(PREDICTION_SCHEMA, path.join(reservation.root, "prediction-output.schema.v2.json"), fs.constants.COPYFILE_EXCL);
  const visualTree = tree(path.join(reservation.root, "media"));
  const descriptor = { schema_version: "reviewed_metrics_blind_bundle_descriptor_v2.0.0", status: "sealed_sanitized_bundle", candidate_id: CANDIDATE_ID, generator_version: "blind-png-v2", members, media_tree: visualTree, assignment: "uniform annotation of 44 opaque media inputs", output_schema: pin(path.join(reservation.root, "prediction-output.schema.v2.json"), "prediction-output.schema.v2.json"), scans: { denylisted_keys: 0, denylisted_text: 0, forbidden_metadata_fields: 0, ancillary_png_chunks: 0, extra_files: 0 }, attestations: { zero_labels: true, zero_answers: true, zero_reviewer_material: true, zero_source_metadata: true } };
  validateDenylist(descriptor); assertNeutralBundleSemantics(descriptor, instructions); schema("blind-bundle-descriptor.schema.v2.json", descriptor); writeJson(path.join(reservation.root, "blind-bundle-descriptor-v2.json"), descriptor);
  fs.rmSync(reservation.marker); markerRemoved = true;
  return await verifyBlindBundle(reservation.root, injected, capability);
  } catch (error) {
    if (markerRemoved) { try { const stat = fs.lstatSync(reservation.root); if (stat.dev === reservation.dev && stat.ino === reservation.ino) fs.writeFileSync(reservation.marker, `${reservation.token}\n`, { flag: "wx", mode: 0o600 }); } catch {} }
    if (owned(reservation)) cleanupOwned(reservation); throw error;
  }
}
async function verifyBlindBundle(root: string, injected?: J, capability?: InternalSyntheticCapability): Promise<J> {
  const expected = ["blind-bundle-descriptor-v2.json", "instructions.json", "prediction-output.schema.v2.json", ...fs.readdirSync(path.join(root, "media")).map((x) => `media/${x}`)].sort();
  same(files(root), expected, "blind bundle members"); const descriptor = load(path.join(root, "blind-bundle-descriptor-v2.json")); schema("blind-bundle-descriptor.schema.v2.json", descriptor);
  const instructions = load(path.join(root, "instructions.json"));
  const scans = validateDenylist({ descriptor, instructions }); assertNeutralBundleSemantics(descriptor, instructions);
  const schemaBytes = fs.readFileSync(path.join(root, "prediction-output.schema.v2.json")); assert(hash(schemaBytes) === descriptor.output_schema.sha256 && schemaBytes.length === descriptor.output_schema.bytes && schemaBytes.equals(fs.readFileSync(PREDICTION_SCHEMA)), "bundled prediction schema byte binding drift");
  const authority = await trackedAuthority(injected, capability); assert(descriptor.members.length === authority.inputs.length && descriptor.members.length === 44, "blind membership drift");
  unique(descriptor.members.map((x: J) => x.opaque_id), "blind opaque ID");
  unique(descriptor.members.map((x: J) => x.sha256), "blind sanitized hash");
  for (const member of descriptor.members) { assert(!member.filename.includes("..") && /^media\/v2-[0-9]{4}\.png$/.test(member.filename), "blind traversal/filename"); const file = path.join(root, member.filename); const actual = pin(file, member.filename); assert(actual.sha256 === member.sha256 && actual.bytes === member.bytes, "blind member drift"); const metadata = await sharp(file).metadata(); assert(metadata.format === "png", "blind media format drift"); assertSanitizedMetadata(metadata); assertOnlyCriticalPng(file); }
  same(tree(path.join(root, "media")), descriptor.media_tree, "blind media tree");
  return { status: "blind_bundle_verified", files: files(root).length, media_members: 44, bytes: tree(root).bytes, tree_sha256: tree(root).sha256, media_tree_sha256: descriptor.media_tree.sha256, prediction_schema_sha256: descriptor.output_schema.sha256, denylist_nodes_scanned: scans, metadata_members_scanned: 44, ancillary_png_chunks: 0 };
}
async function verifyCandidate(root = FIXTURE, registry = true): Promise<J> {
  same(files(root), EXPECTED_FILES, "candidate files");
  const schemas: [string, string][] = [["input-authority-v2.json", "input-authority.schema.v2.json"], ["blind-bundle-descriptor.template-v2.json", "blind-bundle-descriptor.schema.v2.json"], ["prediction-output.template-v2.json", "prediction-output.schema.v2.json"], ["gold-review.template-v2.json", "gold-review-authority.schema.v2.json"], ["search-task-candidate-v2.json", "search-task.schema.v2.json"], ["search-task-review.template-v2.json", "search-task-review.schema.v2.json"], ["candidate-criterion-matrix-v2.json", "final-criterion-matrix.schema.v2.json"], ["candidate-descriptor-v2.json", "publication-descriptor.schema.v2.json"]];
  for (const [file, schemaName] of schemas) schema(schemaName, load(path.join(root, file)));
  validatePredictionValue(load(path.join(root, "prediction-output.template-v2.json"))); validateGoldValue(load(path.join(root, "gold-review.template-v2.json"))); validateMatrixValue(load(path.join(root, "candidate-criterion-matrix-v2.json"))); validatePublicationValue(load(path.join(root, "candidate-descriptor-v2.json")));
  const authority = load(path.join(root, "input-authority-v2.json")); assert(authority.counts.image_mode === 36 && authority.counts.ocr === 2 && authority.counts.entity_place === 6 && authority.counts.aerial_land_use === 16 && authority.counts.abstention === 18 && authority.counts.unique_sources === 44 && authority.counts.task_memberships === 78, "candidate count drift");
  exactSet(authority.inputs.map((input: J) => input.opaque_id), FIXED_OPAQUE_IDS, "candidate authority opaque IDs"); same(authority, await expectedAuthority(), "candidate authority mapping");
  if (path.resolve(root) === FIXTURE) await trackedAuthority();
  assert(load(path.join(root, "candidate-status-v2.json")).issue_92_complete === false && load(path.join(root, "candidate-status-v2.json")).issue_69_complete === false, "candidate completion must be false");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-replay-")); await candidateDocuments(tmp); for (const file of EXPECTED_FILES) same(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(tmp, file)), `candidate replay ${file}`); fs.rmSync(tmp, { recursive: true, force: true });
  if (registry) verifyRegistryRow(CANDIDATE_ID, root, REL);
  const facts = tree(root); return { files: facts.members.length, bytes: facts.bytes, tree_sha256: facts.sha256, unique_sources: 44, task_memberships: 78, issue_92_complete: false, issue_69_complete: false };
}
function registryRows(): J[] { return fs.readFileSync(REGISTRY, "utf8").trim().split("\n").map((x) => JSON.parse(x)); }
function verifyRegistryRow(id: string, root: string, locator: string): void {
  const rows = registryRows().filter((x) => x.stable_id === id); assert(rows.length === 1, `registry row count: ${id}`); const row = rows[0]; const facts = tree(root);
  assert(row.storage.locator === locator && row.counts.file_count === facts.members.length && row.counts.byte_count === facts.bytes && row.content_digest.scope === "sorted_tree_manifest" && row.content_digest.value === facts.sha256, `file-backed registry drift: ${id}`);
}
function verifyV1Tracked(): J {
  const facts = tree(V1); assert(facts.members.length === V1_EXPECTED.files && facts.bytes === V1_EXPECTED.bytes && facts.sha256 === V1_EXPECTED.tree_sha256, "v1 immutable tree drift");
  assert(pin(path.join(V1, "final-descriptor-v1.json")).sha256 === V1_EXPECTED.final_descriptor_sha256 && pin(path.join(V1, "independent-task-review-v1.json")).sha256 === V1_EXPECTED.receipt_sha256 && pin(path.join(ROOT, "docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json")).sha256 === V1_EXPECTED.authorization_sha256, "v1 immutable authority drift");
  verifyRegistryRow("dfv0_reviewed_metrics_v1_publication", V1, V1_REL);
  return { historical_publication_verified: true, current_close_authority: false, supersession_status: "candidate_notice_only_v2_does_not_yet_exist", files: facts.members.length, bytes: facts.bytes, tree_sha256: facts.sha256, receipt_sha256: V1_EXPECTED.receipt_sha256, authorization_sha256: V1_EXPECTED.authorization_sha256, historical_issue_complete_byte_preserved: true };
}
function validatePrediction(file: string): J {
  const value = load(file); validatePredictionValue(value);
  return { status: "prediction_schema_and_semantics_valid", outputs: value.outputs.length };
}
function validatePredictionValue(value: J): void {
  schema("prediction-output.schema.v2.json", value); exactSet(value.required_opaque_ids, FIXED_OPAQUE_IDS, "prediction required IDs");
  const walk = (x: J, at = "$"): void => { if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${at}[${i}]`)); else if (x && typeof x === "object") for (const [key, child] of Object.entries(x)) { assert(["no_gold_received", "no_expected_answers_received"].includes(key) || !/(?:expected|gold|reviewer)/i.test(key), `prediction leaks authority field at ${at}.${key}`); walk(child, `${at}.${key}`); } };
  walk(value);
  if (value.status === "blank_no_prediction") assert(value.bundle_tree_sha256 === null && value.session === null && value.outputs.length === 0, "blank prediction must contain no execution evidence");
  else {
    assert(value.bundle_tree_sha256 && value.session, "completed prediction bindings required"); exactSet(value.outputs.map((row: J) => row.opaque_id), FIXED_OPAQUE_IDS, "prediction output IDs");
    before(value.session.started_at, value.session.ended_at, "prediction session");
    for (const row of value.outputs) { unique(row.entities.map((entity: J) => entity.entity_id), `prediction entity ID ${row.opaque_id}`); for (const entity of row.entities) { assert(ENTITY_TYPES.includes(entity.type), "controlled prediction entity type"); assert((entity.identity_decision === "linked") === (entity.identity !== null), "prediction entity identity consistency"); } assert(row.abstention.abstained ? typeof row.abstention.reason === "string" && row.abstention.reason.length > 0 : row.abstention.reason === null, "prediction abstention reason consistency"); }
  }
}
const IMAGE_OPAQUE = FIXED_OPAQUE_IDS.slice(0, 36); const OCR_OPAQUE = FIXED_OPAQUE_IDS.slice(36, 38); const SCENE_OPAQUE = FIXED_OPAQUE_IDS.slice(38, 44);
const AERIAL_OPAQUE = AERIAL_IDS.map((id) => FIXED_OPAQUE_IDS[IMAGE_IDS.indexOf(id)]); const ABSTENTION_OPAQUE = ABSTENTION_IDS.map((id) => FIXED_OPAQUE_IDS[IMAGE_IDS.indexOf(id)]);
function validateGold(file: string): J { const value = load(file); validateGoldValue(value); return { status: "gold_schema_and_semantics_valid", reviews: value.reviews.length }; }
function validateGoldValue(value: J): void {
  schema("gold-review-authority.schema.v2.json", value); exactSet(value.required_opaque_ids, FIXED_OPAQUE_IDS, "gold required IDs"); unique(value.reviewed_exclusions.map((x: J) => x.opaque_id), "gold exclusion ID");
  if (value.status === "blank_external_review_required") assert(value.bundle_tree_sha256 === null && value.reviewer === null && value.reviews.length === 0 && value.source_task_dossier_decision === null && value.private_expected_commitment === null && value.reviewed_exclusions.length === 0, "blank gold must contain no review evidence");
  else {
    assert(value.bundle_tree_sha256 && value.reviewer && value.source_task_dossier_decision && value.private_expected_commitment, "completed gold bindings required"); exactSet(value.reviews.map((row: J) => row.opaque_id), FIXED_OPAQUE_IDS, "gold review IDs");
    assert(value.reviewed_exclusions.length === 0 && value.reviews.every((row: J) => row.exclusion === null), "completed gold uses fixed universes without post-prediction exclusions");
    const classSupport = new Map(IMAGE_MODE_CLASSES.map((name) => [name, 0])); let reviewableAerial = 0; let entitySupport = 0;
    for (const row of value.reviews) {
      assert(IMAGE_OPAQUE.includes(row.opaque_id) ? IMAGE_MODE_CLASSES.includes(row.image_mode) : row.image_mode === null, `gold image mode support ${row.opaque_id}`); if (IMAGE_OPAQUE.includes(row.opaque_id)) classSupport.set(row.image_mode, classSupport.get(row.image_mode)! + 1);
      assert(OCR_OPAQUE.includes(row.opaque_id) ? typeof row.ocr_raw === "string" && row.ocr_raw.trim().length > 0 && typeof row.ocr_normalized === "string" && /[\p{L}\p{N}]/u.test(row.ocr_normalized) : row.ocr_raw === null && row.ocr_normalized === null, `gold OCR support ${row.opaque_id}`);
      assert(SCENE_OPAQUE.includes(row.opaque_id) ? row.entities.length > 0 : row.entities.length === 0 && row.place_opportunities.length === 0, `gold entity/place support ${row.opaque_id}`);
      unique(row.entities.map((entity: J) => entity.entity_id), `gold entity ID ${row.opaque_id}`); unique(row.place_opportunities.map((place: J) => place.opportunity_id), `gold place opportunity ID ${row.opaque_id}`); entitySupport += row.entities.length;
      for (const entity of row.entities) { assert(ENTITY_TYPES.includes(entity.type), "controlled gold entity type"); assert((entity.identity_decision === "linked") === (entity.supported_identity !== null), "gold entity identity consistency"); }
      if (AERIAL_OPAQUE.includes(row.opaque_id)) { assert(typeof row.aerial_reviewable === "boolean", `aerial reviewed support ${row.opaque_id}`); if (row.aerial_reviewable) { reviewableAerial++; assert(row.aerial_labels.length > 0 && !row.aerial_labels.includes("unreviewable"), "reviewable aerial labels required"); } else same(row.aerial_labels, ["unreviewable"], "unreviewable aerial label"); } else assert(row.aerial_reviewable === null && row.aerial_labels.length === 0, `non-aerial review fields ${row.opaque_id}`);
      assert(ABSTENTION_OPAQUE.includes(row.opaque_id) ? typeof row.answerable === "boolean" : row.answerable === null, `gold answerability support ${row.opaque_id}`);
    }
    assert([...classSupport.values()].every((count) => count > 0), "all five image-mode classes require positive gold support"); assert(entitySupport > 0, "scene entity gold support required");
    assert(reviewableAerial >= 12, `reviewable aerial denominator below minimum: ${reviewableAerial}`);
  }
}
function gitExecutionAuthorityEvidence(): ExecutionAuthorityEvidence {
  const git = (args: string[]): Buffer => execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let tracked = true; let headBytes: Buffer = Buffer.alloc(0); let indexBytes: Buffer = Buffer.alloc(0);
  try { git(["ls-files", "--error-unmatch", "--", EXECUTION_AUTHORITY_REL]); headBytes = git(["show", `HEAD:${EXECUTION_AUTHORITY_REL}`]); indexBytes = git(["show", `:${EXECUTION_AUTHORITY_REL}`]); } catch { tracked = false; }
  const clean = (cached: boolean): boolean => { try { execFileSync("git", ["diff", "--quiet", ...(cached ? ["--cached"] : []), "--", EXECUTION_AUTHORITY_REL], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; } };
  return { head: git(["rev-parse", "HEAD"]).toString("utf8").trim(), tracked, headBytes, indexBytes, worktreeBytes: fs.existsSync(EXECUTION_AUTHORITY) ? fs.readFileSync(EXECUTION_AUTHORITY) : Buffer.alloc(0), indexClean: clean(true), worktreeClean: clean(false) };
}
function validateAuthorityPrincipals(value: J): void {
  const actors = [value.implementation, value.predictor, value.gold_reviewer, value.task_reviewer, value.publisher];
  unique(actors.map((x: J) => x.principal), "authority principal"); unique(actors.map((x: J) => x.session_id), "authority session");
  const v1 = load(path.join(V1, "independent-task-review-v1.json")).reviewer; const gateE = load(path.join(ROOT, "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json")).reviewer; const gateF = load(path.join(ROOT, "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json")).reviewer; const gateG = load(path.join(ROOT, "docs/dataset-factory/fixtures/verified-dossiers-publication-v1/independent-dossier-review-v1.json")).reviewer;
  const expectedForbidden = [{ principal: v1.identity, session_id: v1.session_id, model: v1.model, role: "forbidden_prior_reviewer" }, { principal: gateE.identity, session_id: gateE.review_session_id, model: gateE.model_route, role: "forbidden_prior_reviewer" }, { principal: gateF.reviewer_id, session_id: gateF.session_id, model: gateF.model, role: "forbidden_prior_reviewer" }, { principal: gateG.reviewer_id, session_id: gateG.session_id, model: gateG.model, role: "forbidden_prior_reviewer" }];
  exactSet(value.forbidden_prior_reviewers.map((x: J) => canon(x)), expectedForbidden.map((x) => canon(x)), "authority forbidden prior reviewer receipts");
  const forbiddenPrincipals = new Set(value.forbidden_prior_reviewers.map((x: J) => x.principal)); const forbiddenSessions = new Set(value.forbidden_prior_reviewers.map((x: J) => x.session_id));
  for (const actor of actors) assert(!forbiddenPrincipals.has(actor.principal) && !forbiddenSessions.has(actor.session_id), `authority forbidden prior reviewer overlap: ${actor.role}`);
}
function executionAuthority(injected?: J, capability?: InternalSyntheticCapability, reader: ExecutionAuthorityReader = gitExecutionAuthorityEvidence): J {
  let value: J;
  if (injected !== undefined) { assert(capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true, "internal execution authority injection capability required"); value = injected; }
  else {
    const evidence = reader();
    assert(evidence.tracked && evidence.headBytes.length > 0, "prediction freeze unavailable: execution authorization is not tracked and committed at HEAD");
    assert(evidence.indexClean && evidence.worktreeClean, "prediction freeze unavailable: execution authorization is staged or modified");
    assert(evidence.headBytes.equals(evidence.indexBytes) && evidence.headBytes.equals(evidence.worktreeBytes), "prediction freeze unavailable: execution authorization bytes differ across HEAD, index, or worktree");
    value = JSON.parse(evidence.headBytes.toString("utf8"));
  }
  schema("execution-authorization.schema.v2.json", value);
  assert(value.candidate_commit === REVIEWED_CANDIDATE_COMMIT, "execution authorization candidate commit mismatch");
  validateAuthorityPrincipals(value); return value;
}
function freezePrediction(input: string, output: string, injected?: J, capability?: InternalSyntheticCapability): J {
  const authority = executionAuthority(injected, capability); const raw = fs.readFileSync(input); const prediction = JSON.parse(raw.toString("utf8")); validatePredictionValue(prediction); assert(prediction.status === "completed", "only completed prediction can freeze");
  assert(authority.candidate_id === CANDIDATE_ID && authority.implementation_base_commit === IMPLEMENTATION_BASE_COMMIT && authority.candidate_commit === REVIEWED_CANDIDATE_COMMIT, "freeze candidate binding"); assert(authority.bundle_tree_sha256 === prediction.bundle_tree_sha256, "freeze bundle binding");
  for (const key of ["principal", "session_id", "model", "reasoning_effort", "route"]) assert(authority.predictor[key] === prediction.session[key], `freeze predictor ${key} binding`);
  assert(authority.started_at === prediction.session.started_at && authority.ended_at === prediction.session.ended_at, "freeze session timestamp binding"); before(authority.authorized_at, authority.started_at, "authorization before prediction"); before(authority.started_at, authority.ended_at, "prediction execution"); before(authority.ended_at, authority.freeze_at, "prediction before freeze"); before(authority.freeze_at, authority.expires_at, "freeze authorization expiry");
  const frozen = { schema_version: "reviewed_metrics_prediction_freeze_v2.0.0", status: "frozen", candidate_id: CANDIDATE_ID, implementation_base_commit: IMPLEMENTATION_BASE_COMMIT, candidate_commit: authority.candidate_commit, bundle_tree_sha256: authority.bundle_tree_sha256, prediction: { sha256: hash(raw), bytes: raw.length }, principal: authority.predictor.principal, session_id: authority.predictor.session_id, model: authority.predictor.model, reasoning_effort: authority.predictor.reasoning_effort, route: authority.predictor.route, started_at: authority.started_at, ended_at: authority.ended_at, authorized_at: authority.authorized_at, frozen_at: authority.freeze_at };
  schema("prediction-freeze.schema.v2.json", frozen); const destination = physicalPathSafety(output); fs.writeFileSync(destination, pretty(frozen), { flag: "wx", mode: 0o600 }); return { status: "prediction_frozen", prediction_sha256: frozen.prediction.sha256, prediction_bytes: frozen.prediction.bytes, freeze_sha256: hash(fs.readFileSync(destination)) };
}
function metricUniverses(): Record<string, string[]> { return { image_mode_accuracy: IMAGE_OPAQUE, ocr_exact_match: OCR_OPAQUE, entity_precision: SCENE_OPAQUE, entity_recall: SCENE_OPAQUE, place_link_precision: SCENE_OPAQUE, place_link_recall: SCENE_OPAQUE, aerial_land_use_micro_f1: AERIAL_OPAQUE, abstention_selective_error: ABSTENTION_OPAQUE }; }
function validateResultsValue(value: J): void {
  schema("reviewed-metrics.schema.v2.json", value);
  if (value.status === "synthetic_test_only") { assert(value.metrics.length === 0 && value.criterion_matrix.required_rows === 0 && value.criterion_matrix.satisfied_rows === 0, "synthetic result must remain empty"); return; }
  exactSet(value.metrics.map((x: J) => x.metric_id), METRIC_IDS, "completed metric IDs"); assert(value.criterion_matrix.required_rows > 0 && value.criterion_matrix.satisfied_rows <= value.criterion_matrix.required_rows, "result criterion arithmetic");
  const universes = metricUniverses(); for (const metric of value.metrics) {
    exactSet(metric.fixed_universe_ids, universes[metric.metric_id], `metric universe ${metric.metric_id}`); exactSet(metric.included_ids, universes[metric.metric_id], `metric included universe ${metric.metric_id}`); assert(metric.excluded.length === 0, `metric post-prediction exclusions forbidden ${metric.metric_id}`);
    const c = metric.raw_counts; const rowMetric = ["image_mode_accuracy", "ocr_exact_match"].includes(metric.metric_id); const precision = ["entity_precision", "place_link_precision"].includes(metric.metric_id); const recall = ["entity_recall", "place_link_recall"].includes(metric.metric_id);
    const allowed = ["entity_precision", "place_link_precision", "abstention_selective_error"].includes(metric.metric_id) ? ["observed", "observed_undefined_zero_predicted_support"] : ["observed"];
    assert(allowed.includes(metric.status), `metric status not allowed for ${metric.metric_id}`);
    let expectedNumerator: number; let expectedDenominator: number;
    if (rowMetric) { assert(c.tp !== null && c.support === universes[metric.metric_id].length && c.fp === null && c.fn === null && c.tn === null && c.edits === null, `row metric raw counts ${metric.metric_id}`); expectedNumerator = c.tp; expectedDenominator = c.support; }
    else if (precision) { assert(c.tp !== null && c.fp !== null && c.fn === null && c.tn === null && c.edits === null && c.support === c.tp + c.fp, `precision raw counts ${metric.metric_id}`); expectedNumerator = c.tp; expectedDenominator = c.tp + c.fp; }
    else if (recall) { assert(c.tp !== null && c.fn !== null && c.fp === null && c.tn === null && c.edits === null && c.support === c.tp + c.fn, `recall raw counts ${metric.metric_id}`); expectedNumerator = c.tp; expectedDenominator = c.tp + c.fn; }
    else if (metric.metric_id === "aerial_land_use_micro_f1") { assert(c.tp !== null && c.fp !== null && c.fn !== null && c.tn === null && c.edits === null && c.support === 2 * c.tp + c.fp + c.fn, "aerial micro-F1 raw counts"); expectedNumerator = 2 * c.tp; expectedDenominator = c.support; }
    else { assert(c.fp !== null && c.support !== null && c.tp === null && c.fn === null && c.tn === null && c.edits === null, "abstention selective-error raw counts"); expectedNumerator = c.fp; expectedDenominator = c.support; }
    assert(metric.denominator === expectedDenominator, `metric denominator arithmetic ${metric.metric_id}`);
    assert(expectedNumerator >= 0 && expectedNumerator <= expectedDenominator, `metric numerator bounds ${metric.metric_id}`);
    if (metric.status === "observed") assert(expectedDenominator > 0 && metric.numerator === expectedNumerator && metric.value !== null && Math.abs(metric.value - expectedNumerator / expectedDenominator) < 1e-12 && metric.zero_support_reason === null, `observed metric arithmetic ${metric.metric_id}`);
    else assert(expectedDenominator === 0 && metric.numerator === null && metric.value === null && typeof metric.zero_support_reason === "string" && metric.zero_support_reason.length > 0, `zero-predicted-support state ${metric.metric_id}`);
  }
  assert(value.criterion_matrix.satisfied_rows === value.criterion_matrix.required_rows, "completed result requires all criterion rows satisfied");
}
function resolveEvidencePath(shownPath: string, baseDir = ROOT): string { assert(!path.isAbsolute(shownPath) && !shownPath.includes(".."), "evidence path must be safe and relative"); return shownPath.startsWith("docs/") ? path.join(ROOT, shownPath) : path.join(baseDir, shownPath); }
function verifyFilePin(pinValue: J, baseDir = ROOT): void { const file = resolveEvidencePath(pinValue.path, baseDir); assert(fs.existsSync(file) && fs.statSync(file).isFile(), `pinned evidence file missing: ${pinValue.path}`); const actual = pin(file, pinValue.path); assert(actual.sha256 === pinValue.sha256 && actual.bytes === pinValue.bytes, `pinned evidence bytes drift: ${pinValue.path}`); }
const FINAL_MATRIX_REQUIREMENTS: Record<string, { results: string[]; roles: string[] }> = {
  "96.fixed_memberships": { results: ["input-authority-v2"], roles: ["input_authority"] },
  "96.controls_recovered": { results: ["input-authority-v2"], roles: ["control_recovery_receipt"] },
  "96.blind_prediction": { results: ["prediction-output-v2"], roles: ["execution_authorization", "prediction_freeze"] },
  "96.independent_gold": { results: ["gold-review-v2"], roles: ["gold_review"] },
  "96.reviewed_metrics": { results: ["reviewed-metrics-v2"], roles: ["reviewed_metrics"] },
  "96.authority_chronology": { results: ["authority-chronology-v2"], roles: ["execution_authorization", "prediction_freeze", "gold_review"] },
  "96.publication": { results: ["publication-descriptor-v2"], roles: ["task_review", "final_criterion_matrix"] },
  "96.issue_92_close": { results: ["publication-descriptor-v2"], roles: ["task_review", "prediction_freeze", "reviewed_metrics"] },
  "96.issue_69_close": { results: ["publication-descriptor-v2"], roles: ["task_review", "prediction_freeze", "reviewed_metrics"] },
};
function validateMatrixValue(value: J, baseDir = ROOT): void {
  schema("final-criterion-matrix.schema.v2.json", value); exactSet(value.rows.map((x: J) => x.criterion_id), FINAL_CRITERION_IDS, "criterion row IDs");
  if (value.status === "candidate_open") { assert(!value.issue_92_complete && !value.issue_69_complete, "open matrix cannot complete issues"); return; }
  for (const row of value.rows) { const required = FINAL_MATRIX_REQUIREMENTS[row.criterion_id]; assert(row.required && row.verdict === "satisfied", `final criterion not satisfied: ${row.criterion_id}`); same(row.result_ids, required.results, `final result IDs ${row.criterion_id}`); exactSet(row.evidence.map((x: J) => x.role), required.roles, `final evidence roles ${row.criterion_id}`); assert(row.evidence.every((x: J) => x.path && !/(?:template|candidate)/i.test(x.path)), `final evidence cannot use templates/candidate paths: ${row.criterion_id}`); row.evidence.forEach((x: J) => verifyFilePin(x, baseDir)); }
  assert(value.issue_92_complete && value.issue_69_complete, "final matrix completion booleans");
}
const PUBLICATION_PREDECESSOR_PATHS: Record<string, string> = { candidate: "docs/dataset-factory/fixtures/reviewed-metrics-v2/candidate-descriptor-v2.json", execution_authorization: EXECUTION_AUTHORITY_REL, prediction_freeze: "prediction-freeze-v2.json", gold_review: "gold-review-v2.json", results: "reviewed-metrics-v2.json", criterion_matrix: "final-criterion-matrix-v2.json", task_review: "search-task-review-v2.json" };
function validatePublicationValue(value: J, baseDir = ROOT, authority?: J): void { schema("publication-descriptor.schema.v2.json", value); const pins = value.members_before_descriptor; unique(pins.map((x: J) => x.path), "descriptor member path"); same(pins.map((x: J) => x.path), pins.map((x: J) => x.path).sort(), "descriptor sorted members"); assert(value.tree_before_descriptor_sha256 === hash(`${pins.map((x: J) => `${x.path}\t${x.sha256}\t${x.bytes}`).join("\n")}\n`) && value.counts.files_before_descriptor === pins.length && value.counts.bytes_before_descriptor === pins.reduce((sum: number, x: J) => sum + x.bytes, 0), "descriptor tree/count arithmetic"); if (value.status === "candidate_only") { assert(value.candidate_commit === null && Object.values(value.completion).every((x) => x === false), "candidate descriptor completion state"); return; } assert(value.candidate_commit === REVIEWED_CANDIDATE_COMMIT && value.artifact_id === PUBLICATION_ID && Object.values(value.completion).every((x) => x === true), "published descriptor completion state"); exactSet(Object.keys(value.predecessors).filter((key) => key in PUBLICATION_PREDECESSOR_PATHS), Object.keys(PUBLICATION_PREDECESSOR_PATHS), "publication predecessor roles"); for (const [role, expectedPath] of Object.entries(PUBLICATION_PREDECESSOR_PATHS)) { const predecessor = value.predecessors[role]; assert(predecessor.path === expectedPath, `publication predecessor path ${role}`); verifyFilePin(predecessor, baseDir); } exactSet(pins.map((x: J) => x.path), value.required_publication_members, "publication commit-last members"); pins.forEach((x: J) => verifyFilePin(x, baseDir)); assert(value.counts.published_members === pins.length + 1, "publication member arithmetic"); assert(authority && value.publisher.principal === authority.publisher.principal && value.publisher.session_id === authority.publisher.session_id && value.publisher.model === authority.publisher.model && value.publisher.role === authority.publisher.role, "publication publisher authority binding"); const taskReceipt = load(resolveEvidencePath(value.predecessors.task_review.path, baseDir)); assert(taskReceipt.status === "completed" && taskReceipt.reviewer.identity === authority.task_reviewer.principal && taskReceipt.reviewer.session_id === authority.task_reviewer.session_id && taskReceipt.reviewer.model === authority.task_reviewer.model, "publication task-review authority binding"); before(taskReceipt.reviewer.reviewed_at, value.publisher.published_at, "task review before publication"); }
function validateIndependentChronology(prediction: J, gold: J, freeze: J, authority: J): void { assert(prediction.status === "completed" && gold.status === "completed" && freeze.status === "frozen", "completed chronology evidence required"); validateAuthorityPrincipals(authority); assert(prediction.bundle_tree_sha256 === gold.bundle_tree_sha256 && prediction.bundle_tree_sha256 === freeze.bundle_tree_sha256 && prediction.bundle_tree_sha256 === authority.bundle_tree_sha256, "chronology bundle binding"); for (const key of ["principal", "session_id", "model", "reasoning_effort", "route"]) assert(prediction.session[key] === authority.predictor[key], `prediction authority provenance ${key}`); assert(gold.reviewer.identity === authority.gold_reviewer.principal && gold.reviewer.session_id === authority.gold_reviewer.session_id && gold.reviewer.model === authority.gold_reviewer.model && gold.reviewer.reasoning_effort === authority.gold_reviewer.reasoning_effort, "gold reviewer authority provenance"); before(freeze.frozen_at, gold.reviewer.reviewed_at, "freeze before gold review"); }
function validateTaskReviewValue(value: J, baseDir = ROOT, authority?: J, gold?: J): void {
  schema("search-task-review.schema.v2.json", value); if (value.status !== "completed") return;
  assert(authority && gold, "completed task review requires execution authority and gold provenance");
  const expected = [[value.task_pin, "search-task-candidate-v2.json"], [value.prediction_freeze_pin, "prediction-freeze-v2.json"], [value.score_commitment_pin, "reviewed-metrics-v2.json"]] as const;
  for (const [evidence, expectedPath] of expected) { assert(evidence.path === expectedPath, `task review exact pin path: ${expectedPath}`); verifyFilePin(evidence, baseDir); }
  assert(value.reviewer.identity === authority.task_reviewer.principal && value.reviewer.session_id === authority.task_reviewer.session_id && value.reviewer.model === authority.task_reviewer.model && value.reviewer.reasoning_effort === authority.task_reviewer.reasoning_effort, "task reviewer authority provenance");
  before(gold.reviewer.reviewed_at, value.reviewer.reviewed_at, "gold before task review");
}
function scoreSynthetic(prediction: string, gold: string, output: string, capability: InternalSyntheticCapability): J {
  assert(capability[INTERNAL_SYNTHETIC_CAPABILITY] === true, "internal synthetic capability required"); validatePrediction(prediction); validateGold(gold);
  const result = { schema_version: "reviewed_metrics_results_v2.0.0", status: "synthetic_test_only", candidate_id: CANDIDATE_ID, metrics: [], criterion_matrix: { required_rows: 0, satisfied_rows: 0 }, limitations: ["Synthetic contract integration only; not evaluation evidence."] };
  schema("reviewed-metrics.schema.v2.json", result); writeJson(output, result); return { status: "synthetic_score_written", metrics: 0 };
}
async function selfTest(): Promise<J> {
  let rejections = 0; let cases = 0; const reject = async (fn: () => unknown | Promise<unknown>) => { cases++; try { await fn(); } catch { rejections++; return; } throw new Error("adversarial case accepted"); }; const accept = async (fn: () => unknown | Promise<unknown>) => { cases++; await fn(); };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-self-")); const candidate = path.join(root, "candidate"); await build(candidate);
  const capability: InternalSyntheticCapability = { [INTERNAL_SYNTHETIC_CAPABILITY]: true }; const authority = load(path.join(candidate, "input-authority-v2.json"));
  const deniedKeyCases = ["class", "claim_id", "disposition", "labels", "metadata", "answers", "reviewer_material", "record_id", "mapping"];
  for (const key of deniedKeyCases) await reject(() => validateDenylist({ [key]: "x" }));
  const deniedTextCases = ["mtl_archives_metadata_10145", "docs/private.json", "/Users/example/repo/input.png", "r2://private-bucket/object", "private_locator"];
  for (const value of deniedTextCases) await reject(() => validateDenylist({ purpose: value }));
  await reject(() => assertSanitizedMetadata({ icc: Buffer.from("profile") }));
  await reject(() => assertSanitizedMetadata({ comments: ["leak"] }));
  await reject(() => executionAuthority());
  const authorityBytes = Buffer.from(pretty(syntheticExecutionAuthority("a".repeat(64)))); const authorityEvidence = (overrides: Partial<ExecutionAuthorityEvidence> = {}): ExecutionAuthorityEvidence => ({ head: "d".repeat(40), tracked: true, headBytes: authorityBytes, indexBytes: authorityBytes, worktreeBytes: authorityBytes, indexClean: true, worktreeClean: true, ...overrides });
  await accept(() => executionAuthority(undefined, undefined, () => authorityEvidence()));
  await reject(() => executionAuthority(undefined, undefined, () => authorityEvidence({ tracked: false })));
  await reject(() => executionAuthority(undefined, undefined, () => authorityEvidence({ indexClean: false })));
  await reject(() => executionAuthority(undefined, undefined, () => authorityEvidence({ worktreeClean: false })));
  await reject(() => executionAuthority(undefined, undefined, () => authorityEvidence({ indexBytes: Buffer.from("{}\n") })));
  await reject(() => executionAuthority(undefined, undefined, () => authorityEvidence({ worktreeBytes: Buffer.from("{}\n") })));
  const wrongCommitAuthority = syntheticExecutionAuthority("a".repeat(64)); wrongCommitAuthority.candidate_commit = "e".repeat(40); const wrongCommitBytes = Buffer.from(pretty(wrongCommitAuthority)); await reject(() => executionAuthority(undefined, undefined, () => authorityEvidence({ headBytes: wrongCommitBytes, indexBytes: wrongCommitBytes, worktreeBytes: wrongCommitBytes })));
  await reject(() => buildBlindBundle(path.join(ROOT, ".blind"), authority, capability));
  const preserved = path.join(root, "preserved"); fs.mkdirSync(preserved); fs.writeFileSync(path.join(preserved, "sentinel"), "keep"); await reject(() => build(preserved)); assert(fs.readFileSync(path.join(preserved, "sentinel"), "utf8") === "keep", "caller path was modified");
  const realParent = path.join(root, "real-parent"); const aliasParent = path.join(root, "alias-parent"); fs.mkdirSync(realParent); fs.symlinkSync(realParent, aliasParent); await reject(() => buildBlindBundle(path.join(aliasParent, "bundle"), authority, capability)); assert(files(realParent).length === 0, "symlink parent was modified");
  const leafTarget = path.join(root, "leaf-target"); fs.mkdirSync(leafTarget); const leaf = path.join(root, "leaf"); fs.symlinkSync(leafTarget, leaf); await reject(() => buildBlindBundle(leaf, authority, capability));
  const failed = path.join(root, "failed-owned-child"); await reject(() => buildBlindBundle(failed, authority, capability, true)); assert(!fs.existsSync(failed), "owned failure reservation was not cleaned");
  const altered = structuredClone(authority); [altered.inputs[0].opaque_id, altered.inputs[1].opaque_id] = [altered.inputs[1].opaque_id, altered.inputs[0].opaque_id]; await reject(() => buildBlindBundle(path.join(root, "altered-authority"), altered, capability)); assert(!fs.existsSync(path.join(root, "altered-authority")), "altered authority failure cleanup");
  const bundle = path.join(root, "bundle"); await buildBlindBundle(bundle, authority, capability);
  await reject(() => buildBlindBundle(bundle, authority, capability));
  fs.writeFileSync(path.join(bundle, "extra.txt"), "x"); await reject(() => verifyBlindBundle(bundle, authority, capability)); fs.rmSync(path.join(bundle, "extra.txt"));
  fs.symlinkSync("instructions.json", path.join(bundle, "link.json")); await reject(() => verifyBlindBundle(bundle, authority, capability)); fs.rmSync(path.join(bundle, "link.json"));
  const bundledSchema = path.join(bundle, "prediction-output.schema.v2.json"); const originalSchema = fs.readFileSync(bundledSchema); fs.rmSync(bundledSchema); await reject(() => verifyBlindBundle(bundle, authority, capability)); fs.writeFileSync(bundledSchema, originalSchema);
  const media = path.join(bundle, "media/v2-0001.png"); const original = fs.readFileSync(media); await sharp(media).withMetadata().png({ compressionLevel: 9 }).toFile(`${media}.tampered`); fs.renameSync(`${media}.tampered`, media); await reject(() => verifyBlindBundle(bundle, authority, capability)); fs.writeFileSync(media, original);
  await sharp(media).negate().png({ compressionLevel: 9 }).toFile(`${media}.tampered`); fs.renameSync(`${media}.tampered`, media); await reject(() => verifyBlindBundle(bundle, authority, capability)); fs.writeFileSync(media, original);
  const descriptorFile = path.join(bundle, "blind-bundle-descriptor-v2.json"); const descriptor = load(descriptorFile);
  const originalName = descriptor.members[0].filename; descriptor.members[0].filename = "../escape.png"; writeJson(descriptorFile, descriptor); await reject(() => verifyBlindBundle(bundle, authority, capability)); descriptor.members[0].filename = originalName;
  const originalHash = descriptor.members[0].sha256; descriptor.members[0].sha256 = descriptor.members[1].sha256; writeJson(descriptorFile, descriptor); await reject(() => verifyBlindBundle(bundle, authority, capability)); descriptor.members[0].sha256 = originalHash;
  const originalId = descriptor.members[0].opaque_id; descriptor.members[0].opaque_id = descriptor.members[1].opaque_id; writeJson(descriptorFile, descriptor); await reject(() => verifyBlindBundle(bundle, authority, capability)); descriptor.members[0].opaque_id = originalId; writeJson(descriptorFile, descriptor);
  const instructions = load(path.join(bundle, "instructions.json")); const inferred = structuredClone(descriptor); inferred.members[0].purposes = ["aerial_land_use"]; await reject(() => assertNeutralBundleSemantics(inferred, instructions));
  const badInstructions = structuredClone(instructions); badInstructions.assignment = "OCR only"; await reject(() => assertNeutralBundleSemantics(descriptor, badInstructions));

  const completedPrediction = syntheticCompletedPrediction(descriptor.media_tree.sha256); await accept(() => validatePredictionValue(completedPrediction));
  for (const mutate of [
    (x: J) => { x.bundle_tree_sha256 = null; }, (x: J) => { x.outputs[1].opaque_id = x.outputs[0].opaque_id; }, (x: J) => { x.outputs[0].opaque_id = "v2-9999"; },
    (x: J) => { x.outputs[0].image_mode = "arbitrary"; }, (x: J) => { x.outputs[0].entities = [{ entity_id: "e", surface: "x", bbox: [0,0,1,1], type: "arbitrary", identity_decision: "surface_only", identity: null }]; },
    (x: J) => { x.outputs[0].place_links = [{ civic_number: null, street: null, place: null, official_url: "not a uri", abstained: false }]; }, (x: J) => { x.session.ended_at = "2026-07-15T00:00:01.000Z"; x.session.started_at = "2026-07-15T00:00:02.000Z"; }
  ]) { const value = structuredClone(completedPrediction); mutate(value); await reject(() => validatePredictionValue(value)); }
  const completedGold = syntheticCompletedGold(descriptor.media_tree.sha256); await accept(() => validateGoldValue(completedGold));
  for (const mutate of [(x: J) => { x.reviewer = null; }, (x: J) => { x.reviews[1].opaque_id = x.reviews[0].opaque_id; }, (x: J) => { x.reviews[0].image_mode = "arbitrary"; }, (x: J) => { x.reviews[38].entities = [{ entity_id: "e", surface: "x", bbox: [0,0,1,1], type: "arbitrary", identity_decision: "surface_only", supported_identity: null }]; }, (x: J) => { x.reviews.find((row: J) => AERIAL_OPAQUE.includes(row.opaque_id)).aerial_reviewable = false; }]) { const value = structuredClone(completedGold); mutate(value); await reject(() => validateGoldValue(value)); }
  for (const mutate of [
    (x: J) => { x.reviews.filter((row: J) => IMAGE_OPAQUE.includes(row.opaque_id)).forEach((row: J) => { row.image_mode = "ground_street"; }); },
    (x: J) => { x.reviews.forEach((row: J) => { row.entities = []; }); },
    (x: J) => { x.reviews.find((row: J) => OCR_OPAQUE.includes(row.opaque_id)).ocr_normalized = "..."; },
    (x: J) => { x.reviews.find((row: J) => OCR_OPAQUE.includes(row.opaque_id)).ocr_raw = " "; },
    (x: J) => { const row = x.reviews[38]; row.entities.push(structuredClone(row.entities[0])); },
    (x: J) => { const row = x.reviews[38]; row.place_opportunities = [{ opportunity_id: "p", civic_number: null, street: null, place: "x", official_url: null, supported: true }, { opportunity_id: "p", civic_number: null, street: null, place: "y", official_url: null, supported: true }]; },
    (x: J) => { x.reviewed_exclusions = [{ opaque_id: x.reviews[0].opaque_id, reason: "late", fixed_before_scoring: true }]; x.reviews[0].exclusion = "late"; }
  ]) { const value = structuredClone(completedGold); mutate(value); await reject(() => validateGoldValue(value)); }
  const thirteenAerial = structuredClone(completedGold); const thirteenth = thirteenAerial.reviews.filter((row: J) => AERIAL_OPAQUE.includes(row.opaque_id) && !row.aerial_reviewable)[0]; thirteenth.aerial_reviewable = true; thirteenth.aerial_labels = ["mixed_urban"]; await accept(() => validateGoldValue(thirteenAerial));
  const completedResults = syntheticCompletedResults(); await accept(() => validateResultsValue(completedResults));
  for (const mutate of [(x: J) => { x.metrics = []; }, (x: J) => { x.metrics[0].denominator = 0; }, (x: J) => { x.metrics[0].numerator = x.metrics[0].denominator + 1; }, (x: J) => { x.metrics[0].included_ids.pop(); }, (x: J) => { x.metrics[0].status = "observed_undefined_zero_predicted_support"; x.metrics[0].numerator = 0; x.metrics[0].value = 0; x.metrics[0].zero_support_reason = null; }]) { const value = structuredClone(completedResults); mutate(value); await reject(() => validateResultsValue(value)); }
  for (const mutate of [(x: J) => { x.metrics[0].status = "not_applicable_no_reviewed_masks"; }, (x: J) => { x.metrics[0].excluded = [{ opaque_id: x.metrics[0].included_ids.pop(), reason: "late", fixed_before_scoring: true }]; }, (x: J) => { x.metrics.find((m: J) => m.metric_id === "entity_precision").raw_counts.fp = 1; }, (x: J) => { x.metrics.find((m: J) => m.metric_id === "entity_recall").raw_counts.fn = 1; }, (x: J) => { x.metrics.find((m: J) => m.metric_id === "aerial_land_use_micro_f1").raw_counts.support--; }]) { const value = structuredClone(completedResults); mutate(value); await reject(() => validateResultsValue(value)); }
  const allAbstained = structuredClone(completedResults); const abstentionMetric = allAbstained.metrics.find((metric: J) => metric.metric_id === "abstention_selective_error"); abstentionMetric.status = "observed_undefined_zero_predicted_support"; abstentionMetric.numerator = null; abstentionMetric.denominator = 0; abstentionMetric.value = null; abstentionMetric.zero_support_reason = "all predictions abstained; fixed universe retained"; abstentionMetric.raw_counts.support = 0; await accept(() => validateResultsValue(allAbstained));
  const falseFinal = load(path.join(candidate, "candidate-criterion-matrix-v2.json")); falseFinal.status = "final"; falseFinal.issue_92_complete = true; falseFinal.issue_69_complete = true; await reject(() => validateMatrixValue(falseFinal));
  const matrixDir = path.join(root, "matrix"); fs.mkdirSync(matrixDir); const finalRows = FINAL_CRITERION_IDS.map((criterion_id) => { const requirement = FINAL_MATRIX_REQUIREMENTS[criterion_id]; const evidence = requirement.roles.map((role, index) => { const filename = `${criterion_id.replaceAll(".", "-")}-${role}-${index}.json`; fs.writeFileSync(path.join(matrixDir, filename), `${role}\n`); return { ...pin(path.join(matrixDir, filename), filename), role }; }); return { criterion_id, required: true, verdict: "satisfied", result_ids: requirement.results, evidence, limitations: [] }; });
  const completedMatrix = { schema_version: "reviewed_metrics_final_criterion_matrix_v2.0.0", status: "final", candidate_id: CANDIDATE_ID, rows: finalRows, issue_92_complete: true, issue_69_complete: true }; await accept(() => validateMatrixValue(completedMatrix, matrixDir));
  for (const mutate of [(x: J) => { x.rows[0].result_ids = ["arbitrary-result"]; }, (x: J) => { x.rows[0].evidence[0].role = "arbitrary-role"; }, (x: J) => { x.rows[0].evidence[0].path = "template.json"; }, (x: J) => { x.rows[0].evidence[0].sha256 = "0".repeat(64); }]) { const value = structuredClone(completedMatrix); mutate(value); await reject(() => validateMatrixValue(value, matrixDir)); }
  const falsePublication = load(path.join(candidate, "candidate-descriptor-v2.json")); falsePublication.status = "published"; falsePublication.artifact_id = PUBLICATION_ID; falsePublication.candidate_commit = "a".repeat(40); falsePublication.completion = { candidate_complete: true, issue_92_complete: true, issue_69_complete: true, publication_exists: true }; falsePublication.required_publication_members = falsePublication.members_before_descriptor.map((x: J) => x.path); falsePublication.counts.published_members = falsePublication.members_before_descriptor.length + 1; await reject(() => validatePublicationValue(falsePublication));
  const syntheticAuth = syntheticExecutionAuthority(descriptor.media_tree.sha256); const predictionFile = path.join(root, "completed-prediction.json"); writeJson(predictionFile, completedPrediction); const freezeFile = path.join(root, "prediction-freeze.json"); await accept(() => freezePrediction(predictionFile, freezeFile, syntheticAuth, capability)); const freeze = load(freezeFile); await accept(() => validateIndependentChronology(completedPrediction, completedGold, freeze, syntheticAuth));
  const overlapGold = structuredClone(completedGold); overlapGold.reviewer.identity = completedPrediction.session.principal; await reject(() => validateIndependentChronology(completedPrediction, overlapGold, freeze, syntheticAuth)); const earlyGold = structuredClone(completedGold); earlyGold.reviewer.reviewed_at = freeze.frozen_at; await reject(() => validateIndependentChronology(completedPrediction, earlyGold, freeze, syntheticAuth));
  for (const role of ["implementation", "gold_reviewer", "task_reviewer", "publisher"]) { for (const field of ["principal", "session_id"]) { const overlapping = structuredClone(syntheticAuth); overlapping[role][field] = overlapping.predictor[field]; await reject(() => validateAuthorityPrincipals(overlapping)); } }
  for (const role of ["implementation", "predictor", "gold_reviewer", "task_reviewer", "publisher"]) { const forbidden = structuredClone(syntheticAuth); forbidden.forbidden_prior_reviewers[0].principal = forbidden[role].principal; await reject(() => validateAuthorityPrincipals(forbidden)); }
  for (const [field, source] of [["started_at", "authorized_at"], ["ended_at", "started_at"], ["freeze_at", "ended_at"], ["expires_at", "freeze_at"]] as const) { const equal = structuredClone(syntheticAuth); equal[field] = equal[source]; await reject(() => freezePrediction(predictionFile, path.join(root, `equal-${field}.json`), equal, capability)); }
  const equalPrediction = structuredClone(completedPrediction); equalPrediction.session.ended_at = equalPrediction.session.started_at; await reject(() => validatePredictionValue(equalPrediction));
  const taskDir = path.join(root, "task"); fs.mkdirSync(taskDir); for (const name of ["search-task-candidate-v2.json", "prediction-freeze-v2.json", "reviewed-metrics-v2.json"]) fs.writeFileSync(path.join(taskDir, name), `${name}\n`);
  const taskReview = { schema_version: "reviewed_metrics_search_task_review_v2.0.0", status: "completed", candidate_id: CANDIDATE_ID, task_pin: pin(path.join(taskDir, "search-task-candidate-v2.json"), "search-task-candidate-v2.json"), prediction_freeze_pin: pin(path.join(taskDir, "prediction-freeze-v2.json"), "prediction-freeze-v2.json"), score_commitment_pin: pin(path.join(taskDir, "reviewed-metrics-v2.json"), "reviewed-metrics-v2.json"), reviewer: { identity: syntheticAuth.task_reviewer.principal, session_id: syntheticAuth.task_reviewer.session_id, model: syntheticAuth.task_reviewer.model, reasoning_effort: syntheticAuth.task_reviewer.reasoning_effort, reviewed_at: "2026-07-15T00:00:06.000Z", independent: true }, checks: { source_dossier_approved: true, accepted_source_claim: true, private_score_passed: true, rights_passed: true, no_leak_passed: true, component_split_pinned: true, separate_reviewer: true }, disposition: "accepted", rationale: "Synthetic completed contract evidence." };
  await accept(() => validateTaskReviewValue(taskReview, taskDir, syntheticAuth, completedGold));
  for (const mutate of [(x: J) => { x.task_pin = null; }, (x: J) => { x.disposition = "held"; }, (x: J) => { x.rationale = null; }, (x: J) => { x.reviewer.identity = syntheticAuth.predictor.principal; }, (x: J) => { x.reviewer.reviewed_at = completedGold.reviewer.reviewed_at; }, (x: J) => { x.score_commitment_pin.sha256 = "0".repeat(64); }]) { const value = structuredClone(taskReview); mutate(value); await reject(() => validateTaskReviewValue(value, taskDir, syntheticAuth, completedGold)); }
  fs.appendFileSync(predictionFile, " "); await reject(() => { const raw = fs.readFileSync(predictionFile); assert(hash(raw) === freeze.prediction.sha256 && raw.length === freeze.prediction.bytes, "frozen raw prediction mutation"); });
  fs.rmSync(root, { recursive: true, force: true }); return { status: "self_test_passed", cases, adversarial_rejections: rejections, accepted_foundations: cases - rejections, denylisted_key_cases: deniedKeyCases.length, denylisted_text_cases: deniedTextCases.length, mutation_and_filesystem_cases: cases - deniedKeyCases.length - deniedTextCases.length };
}
async function integrationTest(): Promise<J> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-int-")); const candidate = path.join(root, "candidate"); await build(candidate); const authority = load(path.join(candidate, "input-authority-v2.json")); const capability: InternalSyntheticCapability = { [INTERNAL_SYNTHETIC_CAPABILITY]: true }; const one = path.join(root, "bundle-a"); const two = path.join(root, "bundle-b"); const a = await buildBlindBundle(one); const b = await buildBlindBundle(two, authority, capability);
  const normalized = (dir: string) => tree(dir).members.map((x: J) => ({ ...x, path: x.path })); same(normalized(one), normalized(two), "blind deterministic replay"); assert(a.tree_sha256 === b.tree_sha256, "blind tree nondeterminism");
  const templateP = path.join(candidate, "prediction-output.template-v2.json"); const templateG = path.join(candidate, "gold-review.template-v2.json"); const score = path.join(root, "synthetic-score.json"); scoreSynthetic(templateP, templateG, score, { [INTERNAL_SYNTHETIC_CAPABILITY]: true }); fs.rmSync(root, { recursive: true, force: true }); return { status: "integration_test_passed", deterministic_bundle_tree_sha256: a.tree_sha256, media_members: 44, synthetic_prediction_gold_only: true, normal_score_cli_available: false };
}

function syntheticCompletedPrediction(bundle: string): J { return { schema_version: "reviewed_metrics_prediction_output_v2.0.0", status: "completed", candidate_id: CANDIDATE_ID, bundle_tree_sha256: bundle, session: { principal: "synthetic-predictor", session_id: "synthetic-prediction-session", model: "synthetic-model", reasoning_effort: "synthetic", route: "synthetic-isolated-route", started_at: "2026-07-15T00:00:02.000Z", ended_at: "2026-07-15T00:00:03.000Z" }, outputs: FIXED_OPAQUE_IDS.map((opaque_id) => ({ opaque_id, image_mode: null, ocr: null, entities: [], place_links: [], aerial_labels: [], abstention: { abstained: true, reason: "synthetic uncertainty" } })), required_opaque_ids: FIXED_OPAQUE_IDS, attestations: { no_gold_received: true, no_expected_answers_received: true, no_repo_access: true, one_run_only: true } }; }
function syntheticCompletedGold(bundle: string): J { let aerialSeen = 0; return { schema_version: "reviewed_metrics_gold_review_authority_v2.0.0", status: "completed", candidate_id: CANDIDATE_ID, bundle_tree_sha256: bundle, reviewer: { identity: "synthetic-gold-reviewer", session_id: "synthetic-gold-session", model: "synthetic-gold-model", reasoning_effort: "synthetic", reviewed_at: "2026-07-15T00:00:05.000Z", independence: { prediction_blind: true, no_implementation_overlap: true, no_predictor_overlap: true, distinct_session: true } }, reviews: FIXED_OPAQUE_IDS.map((opaque_id, index) => { const aerial = AERIAL_OPAQUE.includes(opaque_id); const reviewable = aerial && aerialSeen++ < 12; const scene = SCENE_OPAQUE.includes(opaque_id); return { opaque_id, image_mode: IMAGE_OPAQUE.includes(opaque_id) ? IMAGE_MODE_CLASSES[index % IMAGE_MODE_CLASSES.length] : null, ocr_raw: OCR_OPAQUE.includes(opaque_id) ? `Synthetic OCR ${index}` : null, ocr_normalized: OCR_OPAQUE.includes(opaque_id) ? `synthetic ocr ${index}` : null, entities: scene ? [{ entity_id: `entity-${index}`, surface: "Synthetic", bbox: [0,0,1,1], type: "place", identity_decision: "surface_only", supported_identity: null }] : [], place_opportunities: [], aerial_reviewable: aerial ? reviewable : null, aerial_labels: aerial ? (reviewable ? ["mixed_urban"] : ["unreviewable"]) : [], answerable: ABSTENTION_OPAQUE.includes(opaque_id) ? true : null, exclusion: null }; }), required_opaque_ids: FIXED_OPAQUE_IDS, reviewed_exclusions: [], source_task_dossier_decision: { status: "accepted", source_claim_supported: true, prediction_blind: true, rights_boundary_passed: true, no_pixel_identity_claim: true }, private_expected_commitment: { algorithm: "sha256", domain: "gate-h-v2-search-expected", value: "b".repeat(64) } }; }
function actor(role: string): J { return { principal: `synthetic-${role}`, session_id: `synthetic-${role}-session`, model: `synthetic-${role}-model`, reasoning_effort: "synthetic", route: "synthetic-isolated-route", role }; }
function syntheticExecutionAuthority(bundle: string): J { const v1 = load(path.join(V1, "independent-task-review-v1.json")).reviewer; const gateE = load(path.join(ROOT, "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json")).reviewer; const gateF = load(path.join(ROOT, "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json")).reviewer; const gateG = load(path.join(ROOT, "docs/dataset-factory/fixtures/verified-dossiers-publication-v1/independent-dossier-review-v1.json")).reviewer; return { schema_version: "reviewed_metrics_execution_authorization_v2.0.0", status: "activated_exact_one_shot", candidate_id: CANDIDATE_ID, implementation_base_commit: IMPLEMENTATION_BASE_COMMIT, candidate_commit: REVIEWED_CANDIDATE_COMMIT, bundle_tree_sha256: bundle, implementation: actor("implementation"), predictor: { ...actor("predictor"), principal: "synthetic-predictor", session_id: "synthetic-prediction-session", model: "synthetic-model" }, gold_reviewer: { ...actor("gold_reviewer"), principal: "synthetic-gold-reviewer", session_id: "synthetic-gold-session", model: "synthetic-gold-model" }, task_reviewer: actor("task_reviewer"), publisher: actor("publisher"), forbidden_prior_reviewers: [{ principal: v1.identity, session_id: v1.session_id, model: v1.model, role: "forbidden_prior_reviewer" }, { principal: gateE.identity, session_id: gateE.review_session_id, model: gateE.model_route, role: "forbidden_prior_reviewer" }, { principal: gateF.reviewer_id, session_id: gateF.session_id, model: gateF.model, role: "forbidden_prior_reviewer" }, { principal: gateG.reviewer_id, session_id: gateG.session_id, model: gateG.model, role: "forbidden_prior_reviewer" }], authorized_at: "2026-07-15T00:00:01.000Z", started_at: "2026-07-15T00:00:02.000Z", ended_at: "2026-07-15T00:00:03.000Z", freeze_at: "2026-07-15T00:00:04.000Z", expires_at: "2026-07-15T00:10:00.000Z" }; }
function syntheticCompletedResults(): J { const universes = metricUniverses(); return { schema_version: "reviewed_metrics_results_v2.0.0", status: "completed", candidate_id: CANDIDATE_ID, metrics: METRIC_IDS.map((metric_id) => { const n = universes[metric_id].length; const row = ["image_mode_accuracy", "ocr_exact_match"].includes(metric_id); const precision = ["entity_precision", "place_link_precision"].includes(metric_id); const recall = ["entity_recall", "place_link_recall"].includes(metric_id); const aerial = metric_id === "aerial_land_use_micro_f1"; const abstention = metric_id === "abstention_selective_error"; return { metric_id, fixed_universe_ids: universes[metric_id], included_ids: universes[metric_id], excluded: [], raw_counts: row ? { tp: n, fp: null, fn: null, tn: null, edits: null, support: n } : precision ? { tp: n, fp: 0, fn: null, tn: null, edits: null, support: n } : recall ? { tp: n, fp: null, fn: 0, tn: null, edits: null, support: n } : aerial ? { tp: n, fp: 0, fn: 0, tn: null, edits: null, support: 2 * n } : { tp: null, fp: 0, fn: null, tn: null, edits: null, support: n }, numerator: abstention ? 0 : aerial ? 2 * n : n, denominator: aerial ? 2 * n : n, status: "observed", value: abstention ? 0 : 1, zero_support_reason: null, limitations: [] }; }), criterion_matrix: { required_rows: FINAL_CRITERION_IDS.length, satisfied_rows: FINAL_CRITERION_IDS.length }, limitations: [] }; }

async function main(): Promise<void> {
  const command = process.argv[2] ?? "verify"; const parsed = parseArgs({ args: process.argv.slice(3), options: { output: { type: "string" }, input: { type: "string" }, gold: { type: "string" } }, allowPositionals: false }); const o = parsed.values;
  let result: J;
  if (command === "build") result = await build(o.output ? path.resolve(o.output) : FIXTURE);
  else if (command === "build-blind-bundle") result = await buildBlindBundle(path.resolve(assertString(o.output, "--output required")));
  else if (command === "verify") result = await verifyCandidate(o.output ? path.resolve(o.output) : FIXTURE);
  else if (command === "verify-tracked") result = { status: "tracked_candidates_verified", v1: verifyV1Tracked(), v2: await verifyCandidate(FIXTURE, true), publication: { artifact_id: PUBLICATION_ID, exists: false, verified: false, required_for_issue_close: true } };
  else if (command === "validate-prediction") result = validatePrediction(assertString(o.input, "--input required"));
  else if (command === "freeze-prediction") result = freezePrediction(path.resolve(assertString(o.input, "--input required")), path.resolve(assertString(o.output, "--output required")));
  else if (command === "validate-gold") result = validateGold(assertString(o.input, "--input required"));
  else if (command === "score") throw new Error("normal scoring is unavailable in the issue #96 candidate; synthetic scoring is internal integration-only");
  else if (command === "validate-task-review") { const file = path.resolve(assertString(o.input, "--input required")); const value = load(file); if (value.status === "completed") validateTaskReviewValue(value, path.dirname(file), executionAuthority(), load(path.resolve(assertString(o.gold, "--gold required for completed task review")))); else validateTaskReviewValue(value, path.dirname(file)); result = { status: value.status === "completed" ? "task_review_completed_valid" : "task_review_placeholder_valid" }; }
  else if (command === "publish") throw new Error("v2 publication is issue #97 scope and requires completed external authorities");
  else if (command === "self-test") result = await selfTest();
  else if (command === "integration-test") result = await integrationTest();
  else throw new Error(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
function assertString(value: string | undefined, message: string): string { assert(value, message); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
