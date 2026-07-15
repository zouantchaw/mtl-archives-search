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
const CANONICAL_AUTHORITY_REL = `${REL}/input-authority-v2.json`;
const CANONICAL_AUTHORITY = path.join(ROOT, CANONICAL_AUTHORITY_REL);
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
const EXECUTION_AUTHORITY_REL = "docs/dataset-factory/authorities/reviewed-metrics-v2/execution-authorization-v2.json";
const TRACKED_AUTHORITY_SHA256 = "34be01a2750894eab27ad8882acb79a0366f1de9b6c85fb96bb84e95ecfd81fa";
const TRACKED_AUTHORITY_BYTES = 56_908;
const SYNTHETIC_CANDIDATE_COMMIT = "c".repeat(40);
const SYNTHETIC_STALE_PARENT_COMMIT = "b".repeat(40);
const ISSUE_97_TASK_ID = "task-7b1d4f0c9a2e6d83";
const RPCQ_ORIGIN = "https://www.patrimoine-culturel.gouv.qc.ca";
const OFFICIAL_DOMAIN_SUFFIX = ".gouv.qc.ca";
const ISSUE_97_OUTPUT_FIELDS = [
  "year",
  "civic_number",
  "street",
  "place",
  "official_url",
];
const SOURCE_SEARCH_QUERY_SUBJECT = {
  kind: "organization_name",
  value: "The Gazette",
} as const;
const SOURCE_SEARCH_NORMALIZATION_CONTRACT = {
  unicode: "NFKC",
  whitespace: "trim_and_collapse",
  text_comparison: "casefold_strip_diacritics_and_punctuation",
  street_designators: "normalize_common_french_english_designators",
  numeric_fields: "ascii_digits_without_leading_zeroes",
  official_url: "https_lowercase_host_remove_fragment_sort_query",
} as const;
const SOURCE_SEARCH_COMMITMENT_DOMAIN = "gate-h-v2-search-expected";
const SOURCE_SEARCH_CANONICALIZATION = "rfc8785-compatible-canonical-json-v1";
const SOURCE_SEARCH_TASK_FILE = "search-task-v2.json";
const SOURCE_SEARCH_BUNDLE_FILE = "source-search-bundle-v2.json";
const SOURCE_SEARCH_OUTPUT_SCHEMA_FILE = "source-search-output-schema-v2.json";
const SOURCE_SEARCH_PREDICTION_FILE = "source-search-prediction-v2.json";
const SOURCE_SEARCH_FREEZE_FILE = "source-search-freeze-v2.json";
const PRIVATE_SCORE_RECEIPT_FILE = "private-score-receipt-v2.json";
const GATE_E_PATHS = {
  promotion_ledger: "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/promotion-ledger-v1.json",
  review_receipt: "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json",
  source_representation: "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/bounded-review-representations-v1.json",
  source_acquisition: "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/acquisition-manifest-v1.json",
} as const;
const V1_EXPECTED = {
  files: 19,
  bytes: 1_005_718,
  tree_sha256: "1e61ba2d92b6ee59f6eb6221b8274ef9a6bcbf56299274da7a5525b1e14974a1",
  final_descriptor_sha256: "e44ca758c7d17d2256b974e714b15795a637d634eb29253a7f7ecee6347c0b93",
  receipt_sha256: "422cd4d3faab3e233af0241ca11dd82cc9a26e75c0af08961698bc342b97552a",
  authorization_sha256: "d66a969563878b6e02f46d965ab374cf7e186d8c518c8d62aa1e275adcd96dbc",
} as const;
const CONTROL_SOURCES = [
  {
    id: 10145,
    token: "gold-batch-control:0099:first-view",
    file: "glb002-0099-0.jpg",
    sha256: "8c97cfd0b01d8baefd3e122a3d630ef85d535878024f73113e53bdc9a5421ee0",
    bytes: 145410,
    width: 1024,
    height: 662,
  },
  {
    id: 8465,
    token: "gold-batch-control:0001:first-view",
    file: "glb002-0001-0.jpg",
    sha256: "0ab54c10ed1a3ea564678232d9fb4a632bb8aeb2a9410b6278dd8b77e1b427b5",
    bytes: 118212,
    width: 1024,
    height: 622,
  },
  {
    id: 6059,
    token: "gold-batch-control:0126:first-view",
    file: "glb002-0126-0.jpg",
    sha256: "e620dbbce90fe373f198196adbba431de1ce574cffb230e64195d78def202a5d",
    bytes: 352794,
    width: 982,
    height: 1024,
  },
] as const;
const IMAGE_IDS = [
  10, 11, 17, 30, 31, 33, 45, 54, 58, 77, 88, 100, 101, 102, 105, 106, 4501,
  7929, 8432, 9092, 9844, 11836, 11923, 11993, 12115, 12117, 12623, 13272,
  13389, 14135, 14813, 14965, 10145, 8465, 11118, 6059,
];
const AERIAL_IDS = [
  4501, 7929, 8432, 9092, 9844, 11836, 11923, 11993, 12115, 12117, 12623, 13272,
  13389, 14135, 14813, 14965,
];
const ABSTENTION_IDS = [...AERIAL_IDS, 11118, 6059];
const SCENE_IDS = [0,10,100,101,102,105];
const FIXED_OPAQUE_IDS = Array.from({ length: 44 }, (_, index) => `v2-${String(index + 1).padStart(4, "0")}`);
const IMAGE_MODE_CLASSES = [
  "ground_street",
  "aerial_vertical",
  "aerial_oblique",
  "document_map",
  "low_information",
] as const;
const AERIAL_LABELS = [
  "farmland",
  "residential",
  "industrial",
  "rail",
  "waterfront",
  "roads",
  "parks_forest",
  "mixed_urban",
] as const;
const ENTITY_TYPES = [
  "organization",
  "brand",
  "person",
  "building",
  "street",
  "place",
  "other",
] as const;
const METRIC_IDS = [
  "ocr_normalized_exact_match",
  "ocr_cer",
  "ocr_wer",
  "entity_precision",
  "entity_recall",
  "entity_false_identity_rate",
  "place_link_precision",
  "place_link_coverage",
  ...IMAGE_MODE_CLASSES.flatMap((name) => [
    `image_mode_${name}_precision`,
    `image_mode_${name}_recall`,
    `image_mode_${name}_f1`,
  ]),
  "image_mode_macro_f1",
  "aerial_exact_set_accuracy",
  "aerial_jaccard",
  ...AERIAL_LABELS.flatMap((name) => [
    `aerial_${name}_precision`,
    `aerial_${name}_recall`,
    `aerial_${name}_f1`,
  ]),
  "aerial_micro_precision",
  "aerial_micro_recall",
  "aerial_micro_f1",
  "abstention_coverage",
  "abstention_rate",
  "appropriate_abstention_recall",
  "unsafe_non_abstention_rate",
  "abstention_selective_error",
  "abstention_decision_accuracy",
  "mask_iou",
  "geolocation_distance",
  "operation_timing_seconds",
  "model_tool_cost",
] as const;
const FINAL_CRITERION_IDS = [
  "96.fixed_memberships",
  "96.controls_recovered",
  "96.blind_prediction",
  "96.independent_gold",
  "96.reviewed_metrics",
  "96.authority_chronology",
  "96.publication",
  "96.issue_92_close",
  "96.issue_69_close",
];
const EXPECTED_FILES = [
  "blind-bundle-descriptor.template-v2.json",
  "candidate-criterion-matrix-v2.json",
  "candidate-descriptor-v2.json",
  "candidate-status-v2.json",
  "gold-review.template-v2.json",
  "input-authority-v2.json",
  "manifest-v2.json",
  "prediction-output.template-v2.json",
  "source-search-bundle.template-v2.json",
  "source-search-prediction.template-v2.json",
  "search-task-candidate-v2.json",
  "search-task-review.template-v2.json",
  "supersession-candidate-notice-v2.json",
].sort();
const DENY_KEYS = /(?:^|_)(?:class|claim_id|claim|disposition|gold|expected|answer|answers|label|labels|metadata|reviewer|reviewer_material|record|record_id|record_ids|source|source_path|mapping|repo|repository_path|locator|private|component|split|rights)(?:$|_)/i;
const DENY_TEXT = /(?:mtl_archives_metadata_[0-9]+|(?:^|[^a-z])record[_ -]?id(?:[^a-z]|$)|(?:^|[^a-z])claim[_ -]?id(?:[^a-z]|$)|gold[_ -]?(?:label|answer)|expected[_ -]?answer|reviewer[_ -]?material|(?:^|[\s"'])(?:docs|data|packages)\/|\/Users\/|(?:r2|s3|file):\/\/|private[_ -]?(?:locator|route|path)|artifact[s]?\/mtl-archives)/i;
const SAFE_ATTESTATION_KEYS = new Set([
  "zero_labels",
  "zero_answers",
  "zero_reviewer_material",
  "zero_source_metadata",
  "forbidden_metadata_fields",
]);
const INTERNAL_SYNTHETIC_CAPABILITY = Symbol("reviewed-metrics-v2-internal-synthetic-capability");
const SYNTHETIC_EVALUATOR_KEYS = crypto.generateKeyPairSync("ed25519");
const SYNTHETIC_COORDINATOR_KEYS = crypto.generateKeyPairSync("ed25519");
const ENTITY_IOU_THRESHOLD = 0.5;
const ENTITY_DUPLICATE_IOU_THRESHOLD = 0.98;
const ENTITY_BBOX_QUANTIZATION = 10_000;
const MAX_ENTITIES_PER_ROW = 12;
const ROUTE_RECEIPT_MAX_AGE_MS = 5 * 60 * 1000;
type InternalSyntheticCapability = { readonly [INTERNAL_SYNTHETIC_CAPABILITY]: true };
type Reservation = { root: string; marker: string; token: string; dev: number; ino: number };
type ExecutionAuthorityEvidence = { head: string; parents: string[]; changedPaths: string[]; repositoryClean: boolean; tracked: boolean; headBytes: Buffer; indexBytes: Buffer; worktreeBytes: Buffer; indexClean: boolean; worktreeClean: boolean };
type ExecutionAuthorityReader = () => ExecutionAuthorityEvidence;
type Clock = () => Date;
type FileSnapshot = { file: string; fd: number; raw: Buffer; value: J; stat: fs.Stats };
type FinalizationHooks = {
  afterInputs?: () => void;
  afterDetailWrite?: () => void;
  beforeSign?: () => void;
};
const FREEZE_CLOCK_TOLERANCE_MS = 5_000;
const Ajv2020 = Ajv2020Import as unknown as new (options: J) => J;
const addFormats = addFormatsImport as unknown as (ajv: J) => void;
let schemaRegistry: J | undefined;
class GateH2Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "GateH2Error";
  }
}
function assert(
  value: unknown,
  message: string,
  code = "H2_INVARIANT",
): asserts value {
  if (!value) throw new GateH2Error(code, message);
}
function codedAssert(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  assert(value, message, code);
}
function hash(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function canon(value: J): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
}
function pretty(value: J): string { return `${JSON.stringify(value, null, 2)}\n`; }
function load(file: string): J { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file: string, value: J): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, pretty(value), { mode: 0o600 }); }
function readJsonSnapshot(
  file: string,
  code: string,
  requireCanonical = true,
  expectedRaw?: Buffer,
): FileSnapshot {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd);
    codedAssert(
      before.isFile() &&
        before.uid === process.getuid!() &&
        (before.mode & 0o022) === 0,
      code,
      "retained evaluator input must be an owner-controlled regular non-symlink file with no group/world write bits",
    );
    const raw = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    codedAssert(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        raw.length === before.size,
      code,
      "retained evaluator input changed while open",
    );
    if (expectedRaw)
      codedAssert(raw.equals(expectedRaw), "H2_FINALIZATION_EXACT_BYTES", "sealed artifact readback differs from the exact canonical bytes written");
    let value: J;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new GateH2Error(code, "retained evaluator input is not valid JSON");
    }
    if (requireCanonical)
      codedAssert(
        raw.equals(Buffer.from(pretty(value), "utf8")),
        "H2_FINALIZATION_NONCANONICAL",
        "retained evaluator JSON must use exact canonical pretty bytes",
      );
    const pathStat = fs.lstatSync(file);
    codedAssert(
      pathStat.dev === before.dev && pathStat.ino === before.ino,
      code,
      "retained evaluator path must still name the safely opened descriptor",
    );
    codedAssert(
      before.nlink === 1 && [0o400, 0o600].includes(before.mode & 0o777),
      code,
      "retained evaluator input must have one link and exact mode 0400 or 0600",
    );
    const retainedFd = fd;
    fd = undefined;
    return { file, fd: retainedFd, raw, value, stat: before };
  } catch (error) {
    if (error instanceof GateH2Error) throw error;
    throw new GateH2Error(
      code,
      "retained evaluator input could not be opened safely",
    );
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function closeSnapshot(snapshot: FileSnapshot): void {
  fs.closeSync(snapshot.fd);
}
function readExactDescriptor(fd: number, size: number): Buffer {
  const raw = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(fd, raw, offset, size - offset, offset);
    codedAssert(count > 0, "H2_FINALIZATION_EXACT_BYTES", "unexpected EOF while rereading retained descriptor");
    offset += count;
  }
  return raw;
}
function assertSnapshotPathUnchanged(snapshot: FileSnapshot): void {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(snapshot.file);
  } catch {
    throw new GateH2Error(
      "H2_FINALIZATION_PATH_SUBSTITUTION",
      "retained evaluator input path disappeared before finalization",
    );
  }
  codedAssert(
    current.isFile() &&
      !current.isSymbolicLink() &&
      current.dev === snapshot.stat.dev &&
      current.ino === snapshot.stat.ino &&
      current.size === snapshot.stat.size &&
      current.nlink === 1,
    "H2_FINALIZATION_PATH_SUBSTITUTION",
    "retained evaluator input path was substituted before finalization",
  );
  const raw = readExactDescriptor(snapshot.fd, snapshot.raw.length);
  codedAssert(
    raw.equals(snapshot.raw),
    "H2_FINALIZATION_EXACT_BYTES",
    "retained evaluator input bytes changed before finalization",
  );
}
function snapshotPin(snapshot: FileSnapshot, shownPath: string): J {
  return {
    path: shownPath,
    sha256: hash(snapshot.raw),
    bytes: snapshot.raw.length,
  };
}
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
  return {
    members: pins,
    sha256: hash(
      `${pins.map((x) => `${x.path}\t${x.sha256}\t${x.bytes}`).join("\n")}\n`,
    ),
    bytes: pins.reduce((n, x) => n + x.bytes, 0),
  };
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
function notAfter(a: string, b: string, label: string): void {
  const left = Date.parse(a); const right = Date.parse(b);
  assert(Number.isFinite(left) && Number.isFinite(right) && left <= right, `${label} chronology`);
}
function isWithin(candidate: string, protectedRoot: string): boolean {
  return (
    candidate === protectedRoot ||
    candidate.startsWith(`${protectedRoot}${path.sep}`) ||
    protectedRoot.startsWith(`${candidate}${path.sep}`)
  );
}
function nearestExistingPhysicalRoot(attested: string): {
  canonicalRoot: string;
  existingAncestor: string;
  stat: fs.Stats;
} {
  codedAssert(
    path.isAbsolute(attested) && path.normalize(attested) === attested,
    "H2_ROUTE_PATH",
    "route canonical_root must be normalized and absolute",
  );
  let existing = attested;
  const suffix: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    codedAssert(
      parent !== existing,
      "H2_ROUTE_PATH",
      `no existing ancestor for ${attested}`,
    );
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const canonicalAncestor = fs.realpathSync(existing);
  return {
    canonicalRoot: path.join(canonicalAncestor, ...suffix),
    existingAncestor: canonicalAncestor,
    stat: fs.statSync(canonicalAncestor),
  };
}
function trustedInventoryDigest(inventory: J): string {
  return hash(canon(inventory));
}
function trustedSurfaceId(inventory: J): string {
  return hash(`gate-h2-trusted-surface-v2\n${canon(inventory)}`);
}
function routeReceiptPayload(receipt: J): Buffer {
  const unsigned = structuredClone(receipt);
  delete unsigned.signature_base64;
  return Buffer.from(canon(unsigned), "utf8");
}
function parseEd25519PublicKey(
  pem: string,
  code = "H2_EVALUATOR_PUBLIC_KEY",
): crypto.KeyObject {
  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey(pem);
  } catch {
    throw new GateH2Error(code, "public key must parse");
  }
  codedAssert(
    key.asymmetricKeyType === "ed25519",
    code,
    "public key must be Ed25519",
  );
  return key;
}
function authorityBindingHash(authority: J): string {
  const unsigned = structuredClone(authority);
  for (const role of ["implementation", "predictor", "search_predictor", "private_evaluator", "gold_reviewer", "task_reviewer", "publisher"])
    if (unsigned[role]) delete unsigned[role].route_receipt;
  return hash(canon(unsigned));
}
function validateRouteIdentity(actorValue: J, authority: J, inventoryByDigest: Map<string, J>): void {
  const receipt = actorValue.route_receipt;
  const inventory = inventoryByDigest.get(actorValue.surface_inventory_digest);
  codedAssert(
    inventory !== undefined,
    "H2_ROUTE_SURFACE_ID",
    `authority ${actorValue.role} must reference an exact trusted inventory entry`,
  );
  const coordinatorKey = parseEd25519PublicKey(
    authority.coordinator_trust.public_key_pem,
    "H2_COORDINATOR_TRUST_KEY",
  );
  const canonicalCoordinatorKey = coordinatorKey
    .export({ type: "spki", format: "pem" })
    .toString();
  codedAssert(
    authority.coordinator_trust.public_key_pem === canonicalCoordinatorKey &&
      authority.coordinator_trust.public_key_sha256 === hash(canonicalCoordinatorKey),
    "H2_COORDINATOR_TRUST_KEY",
    "coordinator trust key must be canonical and hash-bound",
  );
  const inventoryDigest = trustedInventoryDigest(inventory);
  const derivedSurfaceId = trustedSurfaceId(inventory);
  codedAssert(
    actorValue.surface_inventory_digest === inventoryDigest &&
      actorValue.surface_id === derivedSurfaceId && receipt.surface_id === derivedSurfaceId &&
      receipt.surface_inventory_digest === inventoryDigest,
    "H2_ROUTE_SURFACE_ID",
    `authority ${actorValue.role} surface_id must derive from canonical trusted inventory bytes`,
  );
  codedAssert(
    receipt.role === actorValue.role &&
      receipt.nonce === actorValue.route_nonce &&
      receipt.candidate_commit === authority.candidate_commit &&
      receipt.authority_hash === authorityBindingHash(authority) &&
      receipt.requested_root === actorValue.route &&
      receipt.canonical_root === actorValue.canonical_root,
    "H2_ROUTE_RECEIPT_BINDING",
    `authority ${actorValue.role} route receipt binding`,
  );
  codedAssert(
    path.isAbsolute(receipt.requested_root) &&
      path.normalize(receipt.requested_root) === receipt.requested_root &&
      path.isAbsolute(receipt.canonical_root) &&
      path.normalize(receipt.canonical_root) === receipt.canonical_root,
    "H2_ROUTE_PATH",
    "attested routes must be normalized absolute paths",
  );
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      routeReceiptPayload(receipt),
      coordinatorKey,
      Buffer.from(receipt.signature_base64, "base64"),
    );
  } catch {
    valid = false;
  }
  codedAssert(
    valid,
    "H2_ROUTE_RECEIPT_SIGNATURE",
    `authority ${actorValue.role} route receipt must be signed by the coordinator trust key`,
  );
  const issued = Date.parse(receipt.issued_at);
  const expires = Date.parse(receipt.expires_at);
  codedAssert(
    Number.isFinite(issued) && Number.isFinite(expires) &&
      issued >= Date.parse(authority.authorized_at) && expires <= Date.parse(authority.expires_at) &&
      expires > issued && expires - issued <= ROUTE_RECEIPT_MAX_AGE_MS,
    "H2_ROUTE_RECEIPT_FRESHNESS",
    "route receipt must be fresh and bounded by the one-shot authority window",
  );
  if (inventory.kind === "local_host") {
    const physical = nearestExistingPhysicalRoot(receipt.requested_root);
    codedAssert(
      physical.canonicalRoot === receipt.canonical_root &&
        physical.existingAncestor === receipt.existing_ancestor &&
        physical.stat.dev === receipt.ancestor_device &&
        physical.stat.ino === receipt.ancestor_inode,
      "H2_ROUTE_CANONICAL_MISMATCH",
      `authority ${actorValue.role} local route receipt no longer matches physical route`,
    );
  }
}
function physicalPathSafety(output: string): string {
  assert(
    path.isAbsolute(output),
    "caller-supplied absolute output route required",
  );
  assert(
    path.normalize(output) === output,
    "non-normalized/traversal output route refused",
  );
  assert(!fs.existsSync(output), "output must be absent");
  assert(
    fs.existsSync(path.dirname(output)),
    "output parent must already exist",
  );
  let cursor = path.dirname(output);
  for (;;) {
    const st = fs.lstatSync(cursor);
    const systemAlias = cursor === "/tmp" || cursor === "/var";
    assert(
      !st.isSymbolicLink() || systemAlias,
      `symlink output ancestor refused: ${cursor}`,
    );
    fs.realpathSync(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const existing = fs.realpathSync(path.dirname(output));
  const physical = path.join(existing, path.basename(output));
  const protectedRoots = [
    ROOT,
    path.join(os.homedir(), "pkm/0xPKM"),
    path.join(os.homedir(), "pkm/0xPKM_Lab"),
    path.join(os.homedir(), ".ssh"),
    path.join(os.homedir(), ".aws"),
  ]
    .filter(fs.existsSync)
    .map((x) => fs.realpathSync(x));
  for (const protectedRoot of protectedRoots)
    assert(
      !isWithin(physical, protectedRoot),
      `output overlaps protected route: ${protectedRoot}`,
    );
  const systemTemporaryPrefix = ["/private/tmp/", "/private/var/folders/"].find(
    (prefix) => physical.startsWith(prefix),
  );
  const privacyChecked = systemTemporaryPrefix
    ? physical.slice(systemTemporaryPrefix.length)
    : physical;
  assert(
    !privacyChecked
      .split(path.sep)
      .some((part) => /^(?:private|secrets?)$/i.test(part)),
    "private output route refused",
  );
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
  try {
    const stat = fs.lstatSync(reservation.root);
    return (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.dev === reservation.dev &&
      stat.ino === reservation.ino &&
      fs.lstatSync(reservation.marker).isFile() &&
      fs.readFileSync(reservation.marker, "utf8") === `${reservation.token}\n`
    );
  } catch {
    return false;
  }
}
function cleanupOwned(reservation: Reservation): void {
  assert(owned(reservation), "refusing cleanup of output not owned by this invocation"); fs.rmSync(reservation.root, { recursive: true, force: false });
}
function schema(name: string, value: J): void {
  if (!schemaRegistry) {
    schemaRegistry = new Ajv2020({ allErrors: true, strict: false });
    addFormats(schemaRegistry);
    for (const file of fs
      .readdirSync(SCHEMAS)
      .filter((x) => x.endsWith(".json")))
      schemaRegistry.addSchema(load(path.join(SCHEMAS, file)), file);
  }
  const validate = schemaRegistry.getSchema(name);
  assert(
    validate && validate(value),
    `${name}: ${JSON.stringify(validate?.errors)}`,
  );
}
function phaseRow(id: number): J {
  const row = load(PHASE_D).records.find((x: J) => x.numeric_id === id);
  assert(row, `Phase D row missing: ${id}`); return row;
}
function sourceFacts(file: string, expected: { sha256: string; bytes: number; width: number; height: number }): void {
  assert(fs.existsSync(file), `required registered control unavailable: ${expected.sha256}`);
  const b = fs.readFileSync(file); assert(hash(b) === expected.sha256 && b.length === expected.bytes, `control bytes drift: ${expected.sha256}`);
}
async function decoded(
  file: string,
): Promise<{ hash: string; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    hash: hash(data),
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
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
    const task = byId.get(id);
    const row = phaseRow(id);
    let input: J;
    let sourceRef: string;
    let localPath: string;
    let rights: J;
    if (task) {
      input = task.input;
      sourceRef = input.path;
      localPath = path.join(ROOT, input.path);
      rights = task.rights;
    } else if (id === 11118) {
      input = row.pixel_evidence.views[0];
      sourceRef = input.path;
      localPath = path.join(ROOT, input.path);
      rights = row.rights;
    } else {
      const c = CONTROL_SOURCES.find((x) => x.id === id)!;
      localPath = path.join(
        ROOT,
        "data/mtl_archives/reports/gold_label_batch_002/packets/views",
        c.file,
      );
      sourceFacts(localPath, c);
      input = c;
      sourceRef = c.token;
      rights = row.rights;
    }
    const b = fs.readFileSync(localPath);
    assert(
      hash(b) === input.sha256 && b.length === input.bytes,
      `source pin drift: ${id}`,
    );
    const d = await decoded(localPath);
    assert(
      d.width === input.width && d.height === input.height,
      `source dimensions drift: ${id}`,
    );
    out.push({
      source_key: `image:${id}`,
      source_ref: sourceRef,
      local_path: localPath,
      sha256: input.sha256,
      bytes: input.bytes,
      width: input.width,
      height: input.height,
      component_id: row.component_id,
      split: row.split,
      rights,
      predecessor: task
        ? { v1_task_id: task.task_id, v1_task_sha256: hash(canon(task)) }
        : {
            phase_d_row_sha256: hash(canon(row)),
            registered_artifact_id:
              id === 11118
                ? "canonical_image_recovery_v1"
                : "dfv0_gold_label_batch_002_final_r2_archive",
          },
      purposes: ["image_mode"],
    });
  }
  const ground = load(GROUND_INPUT);
  const groundRecords = load(GROUND_RECORDS);
  const transcriptions = load(GROUND_TRANSCRIPTIONS);
  assert(
    transcriptions.input_sha256 === pin(GROUND_INPUT).sha256,
    "reviewed transcription input authority drift",
  );
  const recordsByNeutral = new Map(
    groundRecords.records.map((record: J) => [record.neutral_id, record]),
  );
  const transcriptByCrop = new Map(
    transcriptions.rows.map((row: J) => [row.neutral_crop_id, row]),
  );
  for (let i = 0; i < ground.crops.length; i++) {
    const crop = ground.crops[i];
    const file = path.join(GROUND_ROOT, crop.crop_path);
    const d = await decoded(file);
    assert(
      hash(fs.readFileSync(file)) === crop.crop_sha256 &&
        d.width === crop.width &&
        d.height === crop.height,
      "OCR crop drift",
    );
    const record = recordsByNeutral.get(crop.parent_neutral_id) as J;
    const transcript = transcriptByCrop.get(crop.neutral_crop_id) as J;
    assert(
      record && record.id === 105 && transcript,
      `OCR authority mapping missing: ${crop.neutral_crop_id}`,
    );
    const region = record.regions.find(
      (candidate: J) =>
        candidate.region_id === transcript.source_region.region_id,
    );
    assert(
      region &&
        transcript.parent_neutral_id === record.neutral_id &&
        transcript.crop_sha256 === crop.crop_sha256 &&
        transcript.source_region.numeric_id === record.id &&
        canon(transcript.source_region.native_xyxy) ===
          canon(region.native_xyxy),
      `OCR semantic join drift: ${crop.neutral_crop_id}`,
    );
    const parent = phaseRow(record.id);
    out.push({
      source_key: `ocr:${i + 1}`,
      source_ref: rel(file),
      local_path: file,
      sha256: crop.crop_sha256,
      bytes: fs.statSync(file).size,
      width: crop.width,
      height: crop.height,
      component_id: parent.component_id,
      split: parent.split,
      rights: parent.rights,
      predecessor: {
        ground_input_sha256: pin(GROUND_INPUT).sha256,
        ground_records_sha256: pin(GROUND_RECORDS).sha256,
        reviewed_visual_transcriptions_sha256: pin(GROUND_TRANSCRIPTIONS)
          .sha256,
        neutral_crop_id: crop.neutral_crop_id,
        parent_neutral_id: record.neutral_id,
        numeric_id: record.id,
        region_id: region.region_id,
      },
      purposes: ["ocr"],
    });
  }
  for (let i = 0; i < ground.scenes.length; i++) {
    const scene = ground.scenes[i];
    const record = recordsByNeutral.get(scene.neutral_id) as J;
    const id = SCENE_IDS[i];
    assert(
      record &&
        record.id === id &&
        record.review.path === scene.review_path &&
        record.review.sha256 === scene.review_sha256 &&
        record.review.width === scene.width &&
        record.review.height === scene.height,
      `ground record mapping drift: ${scene.neutral_id}`,
    );
    const file = path.join(GROUND_ROOT, scene.review_path);
    const d = await decoded(file);
    const row = phaseRow(record.id);
    assert(
      hash(fs.readFileSync(file)) === scene.review_sha256 &&
        d.width === scene.width &&
        d.height === scene.height,
      `scene drift: ${id}`,
    );
    out.push({
      source_key: `scene:${id}`,
      source_ref: rel(file),
      local_path: file,
      sha256: scene.review_sha256,
      bytes: fs.statSync(file).size,
      width: scene.width,
      height: scene.height,
      component_id: row.component_id,
      split: row.split,
      rights: row.rights,
      predecessor: {
        ground_input_sha256: pin(GROUND_INPUT).sha256,
        ground_records_sha256: pin(GROUND_RECORDS).sha256,
        neutral_scene_id: scene.neutral_id,
        numeric_id: record.id,
      },
      purposes: ["entity_place"],
    });
  }
  exactSet(
    [...recordsByNeutral.keys()] as string[],
    ground.scenes.map((scene: J) => scene.neutral_id),
    "ground neutral record IDs",
  );
  exactSet(
    [...transcriptByCrop.keys()] as string[],
    ground.crops.map((crop: J) => crop.neutral_crop_id),
    "reviewed transcription crop IDs",
  );
  for (const source of out)
    if (source.source_key.startsWith("image:")) {
      const id = Number(source.source_key.split(":")[1]);
      if (AERIAL_IDS.includes(id)) source.purposes.push("aerial_land_use");
      if (ABSTENTION_IDS.includes(id)) source.purposes.push("abstention");
    }
  unique(
    out.map((x) => x.source_key),
    "source key",
  );
  unique(
    out.map((x) => x.sha256),
    "source payload hash",
  );
  assert(out.length === 44, `unique source count drift: ${out.length}`);
  return out;
}
function taskMembership(sourceRows: Source[]): J {
  const key = new Set(sourceRows.map((x) => x.source_key));
  const subsets = {
    image_mode: IMAGE_IDS.map((id) => `image:${id}`),
    ocr: ["ocr:1", "ocr:2"],
    entity_place: SCENE_IDS.map((id) => `scene:${id}`),
    aerial_land_use: AERIAL_IDS.map((id) => `image:${id}`),
    abstention: ABSTENTION_IDS.map((id) => `image:${id}`),
  };
  same(
    Object.fromEntries(Object.entries(subsets).map(([k, v]) => [k, v.length])),
    {
      image_mode: 36,
      ocr: 2,
      entity_place: 6,
      aerial_land_use: 16,
      abstention: 18,
    },
    "fixed subset counts",
  );
  for (const id of Object.values(subsets).flat())
    assert(key.has(id), `membership source missing: ${id}`);
  return subsets;
}
function publicSource(source: Source, index: number, pixel: J): J {
  return {
    opaque_id: `v2-${String(index + 1).padStart(4, "0")}`,
    source_key: source.source_key,
    source_ref: source.source_ref,
    source: {
      sha256: source.sha256,
      bytes: source.bytes,
      width: source.width,
      height: source.height,
      normalized_pixel_sha256: pixel.hash,
      sanitized_normalized_pixel_sha256: pixel.hash,
    },
    component_id: source.component_id,
    split: source.split,
    rights: {
      license_id: source.rights.license_id ?? null,
      attribution: source.rights.attribution ?? null,
      commercial_use_allowed: source.rights.commercial_use_allowed ?? null,
      complete: source.rights.complete ?? null,
    },
    predecessor: source.predecessor,
    purposes: source.purposes,
  };
}
function blankPrediction(ids: string[]): J {
  return {
    schema_version: "reviewed_metrics_prediction_output_v2.0.0",
    status: "blank_no_prediction",
    candidate_id: CANDIDATE_ID,
    bundle_tree_sha256: null,
    session: null,
    outputs: [],
    required_opaque_ids: ids,
    attestations: {
      no_gold_received: true,
      no_expected_answers_received: true,
      no_repo_access: true,
      one_run_only: true,
    },
  };
}
function blankGold(ids: string[]): J {
  return {
    schema_version: "reviewed_metrics_gold_review_authority_v2.0.0",
    status: "blank_external_review_required",
    candidate_id: CANDIDATE_ID,
    bundle_tree_sha256: null,
    reviewer: null,
    reviews: [],
    required_opaque_ids: ids,
    reviewed_exclusions: [],
  };
}
function blankSourceSearchBundle(): J {
  return {
    schema_version: "reviewed_metrics_source_search_bundle_v2.0.0",
    status: "template_no_bundle",
    task_id: ISSUE_97_TASK_ID,
    prompt:
      "Locate the official Quebec cultural-heritage record for the public query subject. Return the required public fields under the normalization contract with one bounded paraphrase.",
    query_subject: SOURCE_SEARCH_QUERY_SUBJECT,
    normalization_contract: SOURCE_SEARCH_NORMALIZATION_CONTRACT,
    official_domain_policy: {
      scheme: "https",
      hostname_suffix: OFFICIAL_DOMAIN_SUFFIX,
    },
    output_schema: null,
  };
}
function blankSourceSearchPrediction(): J {
  return {
    schema_version: "reviewed_metrics_source_search_prediction_v2.0.0",
    status: "blank_no_prediction",
    task_id: ISSUE_97_TASK_ID,
    public_bundle: null,
    session: null,
    answer: null,
    evidence: [],
    attestations: {
      no_expected_received: true,
      no_private_body_received: true,
      no_repo_access: true,
      no_pixel_identity_claim: true,
      one_run_only: true,
    },
  };
}
function blankTaskReview(): J {
  return {
    schema_version: "reviewed_metrics_search_task_review_v2.0.0",
    status: "placeholder_issue_97_no_review",
    candidate_id: CANDIDATE_ID,
    task_pin: null,
    source_search_freeze_pin: null,
    public_score_receipt_pin: null,
    private_score_detail: null,
    expected_commitment: null,
    source_dossier_pins: null,
    authority_pins: null,
    reviewer: null,
    checks: null,
    disposition: null,
    rationale: null,
  };
}
async function candidateDocuments(output: string): Promise<Map<string, J>> {
  const raw = await sources();
  const pixels = await Promise.all(raw.map((x) => decoded(x.local_path)));
  const inputs = raw.map((x, i) => publicSource(x, i, pixels[i]));
  const membership = taskMembership(raw);
  const ids = inputs.map((x) => x.opaque_id);
  const authority = {
    schema_version: "reviewed_metrics_input_authority_v2.0.0",
    artifact_id: CANDIDATE_ID,
    status: "fixed_membership_candidate_no_execution_authority",
    created_at: CREATED,
    implementation_base_commit: IMPLEMENTATION_BASE_COMMIT,
    candidate_commit: null,
    inputs,
    subsets: membership,
    counts: {
      unique_sources: 44,
      task_memberships: 78,
      image_mode: 36,
      ocr: 2,
      entity_place: 6,
      aerial_land_use: 16,
      abstention: 18,
    },
    predecessors: predecessorPins(),
    mutations: {
      production: false,
      search_index: false,
      private_object_store_write: false,
      paid_gpu: false,
    },
  };
  const blindTemplate = {
    schema_version: "reviewed_metrics_blind_bundle_descriptor_v2.0.0",
    status: "template_no_bundle_built",
    candidate_id: CANDIDATE_ID,
    generator_version: "blind-png-v2",
    members: [],
    media_tree: null,
    purpose: "uniform blind visual annotation over 44 opaque media inputs",
    output_schema: pin(PREDICTION_SCHEMA, "prediction-output.schema.v2.json"),
    scans: {
      denylisted_keys: 0,
      denylisted_text: 0,
      forbidden_metadata_fields: 0,
      ancillary_png_chunks: 0,
      extra_files: 0,
    },
    attestations: {
      zero_labels: true,
      zero_answers: true,
      zero_reviewer_material: true,
      zero_source_metadata: true,
    },
  };
  const matrix = {
    schema_version: "reviewed_metrics_final_criterion_matrix_v2.0.0",
    status: "candidate_open",
    candidate_id: CANDIDATE_ID,
    rows: [
      {
        criterion_id: "96.fixed_memberships",
        required: true,
        verdict: "satisfied_candidate",
        result_ids: ["input-authority-v2"],
        evidence: [pin(V1_TASKS), pin(PHASE_D)],
        limitations: [],
      },
      {
        criterion_id: "96.controls_recovered",
        required: true,
        verdict: "satisfied_local_untracked_sources",
        result_ids: ["input-authority-v2"],
        evidence: CONTROL_SOURCES.map((x) => ({
          registered_artifact_id: "dfv0_gold_label_batch_002_final_r2_archive",
          source_sha256: x.sha256,
          bytes: x.bytes,
        })),
        limitations: [
          "Source payloads remain ignored and are not duplicated in the candidate.",
        ],
      },
      ...[
        "blind_prediction",
        "independent_gold",
        "reviewed_metrics",
        "authority_chronology",
        "publication",
        "issue_92_close",
        "issue_69_close",
      ].map((id) => ({
        criterion_id: `96.${id}`,
        required: true,
        verdict: "pending",
        result_ids: [],
        evidence: [],
        limitations: ["Not executed by issue #96 candidate construction."],
      })),
    ],
    issue_92_complete: false,
    issue_69_complete: false,
  };
  const search = {
    schema_version: "reviewed_metrics_search_task_v2.0.0",
    status: "placeholder_issue_97_no_task_authority",
    candidate_id: CANDIDATE_ID,
    authored_by: null,
    authored_at: null,
    source_search_freeze: null,
    internal_provenance: null,
    public_projection: null,
    source_only_boundary: true,
    private_expected_commitment: null,
    rights_policy: null,
    component: null,
    split: null,
    review_state: "not_started",
  };
  const status = {
    schema_version: "reviewed_metrics_candidate_status_v2.0.0",
    artifact_id: CANDIDATE_ID,
    status: "candidate_ready_no_execution_authority",
    counts: authority.counts,
    issue_92_complete: false,
    issue_69_complete: false,
    candidate_complete: false,
    publication_exists: false,
    prediction_exists: false,
    gold_exists: false,
    mutations: authority.mutations,
    stop_conditions: [],
  };
  const supersession = {
    schema_version: "reviewed_metrics_supersession_candidate_notice_v2.0.0",
    status: "candidate_notice_v2_does_not_yet_exist",
    v2_publication_exists: false,
    current_close_authority: null,
    v1_historical_publication: {
      tree_sha256: V1_EXPECTED.tree_sha256,
      final_descriptor_sha256: V1_EXPECTED.final_descriptor_sha256,
      receipt_sha256: V1_EXPECTED.receipt_sha256,
      authorization_sha256: V1_EXPECTED.authorization_sha256,
    },
    proposed_superseded_claims: [
      "v1 issue_complete=true as current close authority",
      "v1 69.reviewed_metrics satisfied_with_unavailable_denominators",
      "v1 satisfied task rows pointing to a blank template",
      "task acceptance alone proves all issue criteria",
    ],
    preserved_claims: [
      "32 independently accepted v1 image-mode tasks and their exact receipt",
    ],
    issue_92_complete: false,
    issue_69_complete: false,
  };
  const map = new Map<string, J>([
    ["input-authority-v2.json", authority],
    ["blind-bundle-descriptor.template-v2.json", blindTemplate],
    ["prediction-output.template-v2.json", blankPrediction(ids)],
    ["gold-review.template-v2.json", blankGold(ids)],
    ["source-search-bundle.template-v2.json", blankSourceSearchBundle()],
    [
      "source-search-prediction.template-v2.json",
      blankSourceSearchPrediction(),
    ],
    ["search-task-candidate-v2.json", search],
    ["search-task-review.template-v2.json", blankTaskReview()],
    ["candidate-criterion-matrix-v2.json", matrix],
    ["candidate-status-v2.json", status],
    ["supersession-candidate-notice-v2.json", supersession],
  ]);
  for (const [name, value] of map) writeJson(path.join(output, name), value);
  const candidateMembers = () =>
    files(output).filter(
      (member) => !/^\.reviewed-metrics-v2-owner-[a-f0-9]{64}$/.test(member),
    );
  const preManifest = tree(output, candidateMembers());
  const manifest = {
    schema_version: "reviewed_metrics_candidate_manifest_v2.0.0",
    artifact_id: CANDIDATE_ID,
    members: preManifest.members,
    content_sha256: preManifest.sha256,
    counts: {
      files_before_manifest_and_descriptor: preManifest.members.length,
      bytes_before_manifest_and_descriptor: preManifest.bytes,
    },
  };
  writeJson(path.join(output, "manifest-v2.json"), manifest);
  map.set("manifest-v2.json", manifest);
  const beforeDescriptor = tree(output, candidateMembers());
  const descriptor = {
    schema_version: "reviewed_metrics_candidate_descriptor_v2.0.0",
    artifact_id: CANDIDATE_ID,
    status: "candidate_only",
    created_at: CREATED,
    implementation_base_commit: IMPLEMENTATION_BASE_COMMIT,
    candidate_commit: null,
    members_before_descriptor: beforeDescriptor.members,
    tree_before_descriptor_sha256: beforeDescriptor.sha256,
    counts: {
      files_before_descriptor: beforeDescriptor.members.length,
      bytes_before_descriptor: beforeDescriptor.bytes,
      unique_sources: 44,
      task_memberships: 78,
    },
    predecessors: predecessorPins(),
    completion: {
      candidate_complete: false,
      issue_92_complete: false,
      issue_69_complete: false,
      publication_exists: false,
    },
    mutations: authority.mutations,
  };
  writeJson(path.join(output, "candidate-descriptor-v2.json"), descriptor);
  map.set("candidate-descriptor-v2.json", descriptor);
  return map;
}
async function build(output = FIXTURE): Promise<J> {
  assert(path.resolve(output) !== V1, "v1 output route refused");
  const reservation = reserveOutput(path.resolve(output));
  let markerRemoved = false;
  try {
    await candidateDocuments(reservation.root);
    fs.rmSync(reservation.marker);
    markerRemoved = true;
    const result = await verifyCandidate(reservation.root, false);
    return { status: "candidate_built", ...result };
  } catch (error) {
    if (markerRemoved) {
      try {
        const stat = fs.lstatSync(reservation.root);
        if (stat.dev === reservation.dev && stat.ino === reservation.ino)
          fs.writeFileSync(reservation.marker, `${reservation.token}\n`, {
            flag: "wx",
            mode: 0o600,
          });
      } catch {}
    }
    if (owned(reservation)) cleanupOwned(reservation);
    throw error;
  }
}
function validateDenylist(value: J, where = "$"): number {
  let scans = 1;
  if (Array.isArray(value)) {
    value.forEach((x, i) => {
      scans += validateDenylist(x, `${where}[${i}]`);
    });
    return scans;
  }
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      assert(
        SAFE_ATTESTATION_KEYS.has(key) || !DENY_KEYS.test(key),
        `denylisted key at ${where}.${key}`,
      );
      scans += validateDenylist(child, `${where}.${key}`);
    }
  else if (typeof value === "string")
    assert(
      where.endsWith(".schema_version") ||
        where.endsWith(".output_schema") ||
        where.endsWith(".candidate_id") ||
        !DENY_TEXT.test(value),
      `denylisted text at ${where}`,
    );
  return scans;
}
function assertSanitizedMetadata(metadata: J): void {
  const unexpected = [
    "exif",
    "icc",
    "iptc",
    "xmp",
    "comments",
    "comment",
    "profiles",
    "thumbnail",
  ].filter((key) => metadata[key] != null);
  assert(
    unexpected.length === 0,
    `unexpected metadata/profile/comment: ${unexpected.join(",")}`,
  );
}
function pngChunks(buffer: Buffer): { type: string; bytes: Buffer }[] {
  assert(
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "PNG signature drift",
  );
  const chunks: { type: string; bytes: Buffer }[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert(end <= buffer.length, "PNG chunk bounds");
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    chunks.push({ type, bytes: buffer.subarray(offset, end) });
    offset = end;
  }
  assert(
    chunks.at(-1)?.type === "IEND" && offset === buffer.length,
    "PNG terminal chunk drift",
  );
  return chunks;
}
function stripPngAncillary(file: string): void {
  const input = fs.readFileSync(file);
  const critical = pngChunks(input).filter(
    (chunk) => chunk.type[0] === chunk.type[0].toUpperCase(),
  );
  assert(
    critical.some((chunk) => chunk.type === "IHDR") &&
      critical.some((chunk) => chunk.type === "IDAT") &&
      critical.at(-1)?.type === "IEND",
    "PNG critical chunks missing",
  );
  fs.writeFileSync(
    file,
    Buffer.concat([
      input.subarray(0, 8),
      ...critical.map((chunk) => chunk.bytes),
    ]),
  );
}
function assertOnlyCriticalPng(file: string): void {
  const ancillary = pngChunks(fs.readFileSync(file)).filter(
    (chunk) => chunk.type[0] !== chunk.type[0].toUpperCase(),
  );
  assert(
    ancillary.length === 0,
    `ancillary PNG chunks remain: ${ancillary.map((x) => x.type).join(",")}`,
  );
}
async function expectedAuthority(): Promise<J> { const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-authority-")); try { const docs = await candidateDocuments(temp); return docs.get("input-authority-v2.json"); } finally { fs.rmSync(temp, { recursive: true, force: true }); } }
async function trackedAuthority(injected?: J, capability?: InternalSyntheticCapability): Promise<J> {
  if (injected !== undefined) { assert(capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true, "internal authority injection capability required"); schema("input-authority.schema.v2.json", injected); same(injected, await expectedAuthority(), "injected authority semantic binding"); return injected; }
  const bytes = canonicalCommittedHeadAuthorityBytes();
  const authority = JSON.parse(bytes.toString("utf8")); schema("input-authority.schema.v2.json", authority); same(authority, await expectedAuthority(), "tracked authority semantic binding");
  exactSet(authority.inputs.map((input: J) => input.opaque_id), FIXED_OPAQUE_IDS, "authority opaque IDs"); return authority;
}
function assertNeutralBundleSemantics(descriptor: J, instructions: J): void {
  const visible = pretty({ descriptor, instructions }).toLowerCase();
  for (const forbidden of [
    "image_mode",
    "ocr",
    "entity_place",
    "aerial_land_use",
    "abstention",
    "subset",
    "membership",
    "purpose",
    "task_memberships",
  ])
    assert(
      !visible.includes(forbidden),
      `predictor-visible semantic inference token: ${forbidden}`,
    );
  assert(
    descriptor.members.length === 44 &&
      instructions.required_member_ids.length === 44,
    "uniform bundle count drift",
  );
  for (const member of descriptor.members)
    same(
      Object.keys(member).sort(),
      ["bytes", "filename", "height", "opaque_id", "sha256", "width"].sort(),
      `uniform member fields ${member.opaque_id}`,
    );
}
async function buildBlindBundle(
  output: string,
  injected?: J,
  capability?: InternalSyntheticCapability,
  failAfterReservation = false,
): Promise<J> {
  const reservation = reserveOutput(output);
  let markerRemoved = false;
  try {
    const authority = await trackedAuthority(injected, capability);
    if (failAfterReservation)
      throw new GateH2Error("H2_TEST_INJECTED_FAILURE", "synthetic failure after reservation");
    const raw = await sources();
    const byKey = new Map(raw.map((x) => [x.source_key, x]));
    fs.mkdirSync(path.join(reservation.root, "media"), { recursive: false });
    const members: J[] = [];
    for (const input of authority.inputs) {
      const source = byKey.get(input.source_key);
      assert(
        source && source.sha256 === input.source.sha256,
        "source authority substitution",
      );
      const filename = `${input.opaque_id}.png`;
      assert(/^v2-[0-9]{4}\.png$/.test(filename), "opaque filename invalid");
      const target = path.join(reservation.root, "media", filename);
      await sharp(source.local_path)
        .removeAlpha()
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
        .toFile(target);
      stripPngAncillary(target);
      const before = await decoded(source.local_path);
      const after = await decoded(target);
      same(after, before, `normalized pixel drift ${input.opaque_id}`);
      assert(
        input.source.normalized_pixel_sha256 === before.hash &&
          input.source.sanitized_normalized_pixel_sha256 === after.hash,
        `authority normalized-pixel binding drift ${input.opaque_id}`,
      );
      const metadata = await sharp(target).metadata();
      assertSanitizedMetadata(metadata);
      assertOnlyCriticalPng(target);
      members.push({
        opaque_id: input.opaque_id,
        filename: `media/${filename}`,
        sha256: hash(fs.readFileSync(target)),
        bytes: fs.statSync(target).size,
        width: after.width,
        height: after.height,
      });
    }
    unique(
      members.map((x) => x.opaque_id),
      "opaque ID",
    );
    unique(
      members.map((x) => x.sha256),
      "sanitized hash",
    );
    const instructions = {
      schema_version: "reviewed_metrics_blind_instructions_v2.0.0",
      assignment:
        "Annotate every opaque media input using every field in the bundled schema.",
      output_schema: "prediction-output.schema.v2.json",
      required_member_ids: members.map((x) => x.opaque_id),
      constraints: [
        "Return exactly one complete output object per required opaque ID.",
        "Use null, empty arrays, or the schema-defined uncertainty object when visual evidence does not support a value.",
        "Do not access any route outside this bundle and the assigned output route.",
      ],
    };
    validateDenylist(instructions);
    writeJson(path.join(reservation.root, "instructions.json"), instructions);
    fs.copyFileSync(
      PREDICTION_SCHEMA,
      path.join(reservation.root, "prediction-output.schema.v2.json"),
      fs.constants.COPYFILE_EXCL,
    );
    const visualTree = tree(path.join(reservation.root, "media"));
    const descriptor = {
      schema_version: "reviewed_metrics_blind_bundle_descriptor_v2.0.0",
      status: "sealed_sanitized_bundle",
      candidate_id: CANDIDATE_ID,
      generator_version: "blind-png-v2",
      members,
      media_tree: visualTree,
      assignment: "uniform annotation of 44 opaque media inputs",
      output_schema: pin(
        path.join(reservation.root, "prediction-output.schema.v2.json"),
        "prediction-output.schema.v2.json",
      ),
      scans: {
        denylisted_keys: 0,
        denylisted_text: 0,
        forbidden_metadata_fields: 0,
        ancillary_png_chunks: 0,
        extra_files: 0,
      },
      attestations: {
        zero_labels: true,
        zero_answers: true,
        zero_reviewer_material: true,
        zero_source_metadata: true,
      },
    };
    validateDenylist(descriptor);
    assertNeutralBundleSemantics(descriptor, instructions);
    schema("blind-bundle-descriptor.schema.v2.json", descriptor);
    writeJson(
      path.join(reservation.root, "blind-bundle-descriptor-v2.json"),
      descriptor,
    );
    fs.rmSync(reservation.marker);
    markerRemoved = true;
    return await verifyBlindBundle(reservation.root, injected, capability);
  } catch (error) {
    if (markerRemoved) {
      try {
        const stat = fs.lstatSync(reservation.root);
        if (stat.dev === reservation.dev && stat.ino === reservation.ino)
          fs.writeFileSync(reservation.marker, `${reservation.token}\n`, {
            flag: "wx",
            mode: 0o600,
          });
      } catch {}
    }
    if (owned(reservation)) cleanupOwned(reservation);
    throw error;
  }
}
async function verifyBlindBundle(
  root: string,
  injected?: J,
  capability?: InternalSyntheticCapability,
): Promise<J> {
  const expected = [
    "blind-bundle-descriptor-v2.json",
    "instructions.json",
    "prediction-output.schema.v2.json",
    ...fs.readdirSync(path.join(root, "media")).map((x) => `media/${x}`),
  ].sort();
  same(files(root), expected, "blind bundle members");
  const descriptor = load(path.join(root, "blind-bundle-descriptor-v2.json"));
  schema("blind-bundle-descriptor.schema.v2.json", descriptor);
  const instructions = load(path.join(root, "instructions.json"));
  const scans = validateDenylist({ descriptor, instructions });
  assertNeutralBundleSemantics(descriptor, instructions);
  const schemaBytes = fs.readFileSync(
    path.join(root, "prediction-output.schema.v2.json"),
  );
  assert(
    hash(schemaBytes) === descriptor.output_schema.sha256 &&
      schemaBytes.length === descriptor.output_schema.bytes &&
      schemaBytes.equals(fs.readFileSync(PREDICTION_SCHEMA)),
    "bundled prediction schema byte binding drift",
  );
  const authority = await trackedAuthority(injected, capability);
  assert(
    descriptor.members.length === authority.inputs.length &&
      descriptor.members.length === 44,
    "blind membership drift",
  );
  unique(
    descriptor.members.map((x: J) => x.opaque_id),
    "blind opaque ID",
  );
  unique(
    descriptor.members.map((x: J) => x.sha256),
    "blind sanitized hash",
  );
  for (const member of descriptor.members) {
    assert(
      !member.filename.includes("..") &&
        /^media\/v2-[0-9]{4}\.png$/.test(member.filename),
      "blind traversal/filename",
    );
    const file = path.join(root, member.filename);
    const actual = pin(file, member.filename);
    assert(
      actual.sha256 === member.sha256 && actual.bytes === member.bytes,
      "blind member drift",
    );
    const metadata = await sharp(file).metadata();
    assert(metadata.format === "png", "blind media format drift");
    assertSanitizedMetadata(metadata);
    assertOnlyCriticalPng(file);
  }
  same(
    tree(path.join(root, "media")),
    descriptor.media_tree,
    "blind media tree",
  );
  return {
    status: "blind_bundle_verified",
    files: files(root).length,
    media_members: 44,
    bytes: tree(root).bytes,
    tree_sha256: tree(root).sha256,
    media_tree_sha256: descriptor.media_tree.sha256,
    prediction_schema_sha256: descriptor.output_schema.sha256,
    denylist_nodes_scanned: scans,
    metadata_members_scanned: 44,
    ancillary_png_chunks: 0,
  };
}
async function verifyCandidate(root = FIXTURE, registry = true): Promise<J> {
  same(files(root), EXPECTED_FILES, "candidate files");
  const schemas: [string, string][] = [
    ["input-authority-v2.json", "input-authority.schema.v2.json"],
    [
      "blind-bundle-descriptor.template-v2.json",
      "blind-bundle-descriptor.schema.v2.json",
    ],
    ["prediction-output.template-v2.json", "prediction-output.schema.v2.json"],
    ["gold-review.template-v2.json", "gold-review-authority.schema.v2.json"],
    [
      "source-search-bundle.template-v2.json",
      "source-search-bundle.schema.v2.json",
    ],
    [
      "source-search-prediction.template-v2.json",
      "source-search-prediction.schema.v2.json",
    ],
    ["search-task-candidate-v2.json", "search-task.schema.v2.json"],
    [
      "search-task-review.template-v2.json",
      "search-task-review.schema.v2.json",
    ],
    [
      "candidate-criterion-matrix-v2.json",
      "final-criterion-matrix.schema.v2.json",
    ],
    ["candidate-descriptor-v2.json", "publication-descriptor.schema.v2.json"],
  ];
  for (const [file, schemaName] of schemas)
    schema(schemaName, load(path.join(root, file)));
  validatePredictionValue(
    load(path.join(root, "prediction-output.template-v2.json")),
  );
  validateGoldValue(load(path.join(root, "gold-review.template-v2.json")));
  validateSourceSearchPredictionValue(
    load(path.join(root, "source-search-prediction.template-v2.json")),
  );
  validateMatrixValue(
    load(path.join(root, "candidate-criterion-matrix-v2.json")),
  );
  validatePublicationValue(
    load(path.join(root, "candidate-descriptor-v2.json")),
  );
  const authority = load(path.join(root, "input-authority-v2.json"));
  assert(
    authority.counts.image_mode === 36 &&
      authority.counts.ocr === 2 &&
      authority.counts.entity_place === 6 &&
      authority.counts.aerial_land_use === 16 &&
      authority.counts.abstention === 18 &&
      authority.counts.unique_sources === 44 &&
      authority.counts.task_memberships === 78,
    "candidate count drift",
  );
  exactSet(
    authority.inputs.map((input: J) => input.opaque_id),
    FIXED_OPAQUE_IDS,
    "candidate authority opaque IDs",
  );
  same(authority, await expectedAuthority(), "candidate authority mapping");
  if (path.resolve(root) === FIXTURE) await trackedAuthority();
  assert(
    load(path.join(root, "candidate-status-v2.json")).issue_92_complete ===
      false &&
      load(path.join(root, "candidate-status-v2.json")).issue_69_complete ===
        false,
    "candidate completion must be false",
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-replay-"));
  await candidateDocuments(tmp);
  for (const file of EXPECTED_FILES)
    same(
      fs.readFileSync(path.join(root, file)),
      fs.readFileSync(path.join(tmp, file)),
      `candidate replay ${file}`,
    );
  fs.rmSync(tmp, { recursive: true, force: true });
  if (registry) verifyRegistryRow(CANDIDATE_ID, root, REL);
  const facts = tree(root);
  return {
    files: facts.members.length,
    bytes: facts.bytes,
    tree_sha256: facts.sha256,
    unique_sources: 44,
    task_memberships: 78,
    issue_92_complete: false,
    issue_69_complete: false,
  };
}
function registryRows(): J[] { return fs.readFileSync(REGISTRY, "utf8").trim().split("\n").map((x) => JSON.parse(x)); }
function verifyRegistryRow(id: string, root: string, locator: string): void {
  const rows = registryRows().filter((x) => x.stable_id === id);
  assert(rows.length === 1, `registry row count: ${id}`);
  const row = rows[0];
  const facts = tree(root);
  assert(
    row.storage.locator === locator &&
      row.counts.file_count === facts.members.length &&
      row.counts.byte_count === facts.bytes &&
      row.content_digest.scope === "sorted_tree_manifest" &&
      row.content_digest.value === facts.sha256,
    `file-backed registry drift: ${id}`,
  );
}
function verifyV1Tracked(): J {
  const facts = tree(V1);
  assert(
    facts.members.length === V1_EXPECTED.files &&
      facts.bytes === V1_EXPECTED.bytes &&
      facts.sha256 === V1_EXPECTED.tree_sha256,
    "v1 immutable tree drift",
  );
  assert(
    pin(path.join(V1, "final-descriptor-v1.json")).sha256 ===
      V1_EXPECTED.final_descriptor_sha256 &&
      pin(path.join(V1, "independent-task-review-v1.json")).sha256 ===
        V1_EXPECTED.receipt_sha256 &&
      pin(
        path.join(
          ROOT,
          "docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json",
        ),
      ).sha256 === V1_EXPECTED.authorization_sha256,
    "v1 immutable authority drift",
  );
  verifyRegistryRow("dfv0_reviewed_metrics_v1_publication", V1, V1_REL);
  return {
    historical_publication_verified: true,
    current_close_authority: false,
    supersession_status: "candidate_notice_only_v2_does_not_yet_exist",
    files: facts.members.length,
    bytes: facts.bytes,
    tree_sha256: facts.sha256,
    receipt_sha256: V1_EXPECTED.receipt_sha256,
    authorization_sha256: V1_EXPECTED.authorization_sha256,
    historical_issue_complete_byte_preserved: true,
  };
}
function validatePrediction(file: string): J {
  const value = load(file);
  validatePredictionValue(value);
  return {
    status: "prediction_schema_and_semantics_valid",
    outputs: value.outputs.length,
  };
}
function validatePredictionValue(value: J): void {
  if (Array.isArray(value?.outputs))
    codedAssert(value.outputs.every((row: J) => Array.isArray(row.place_links) && row.place_links.length === 0), "H2_PLACE_VISUAL_ATTACHMENT", "visual prediction rows cannot carry source-only place tasks");
  if (Array.isArray(value?.outputs))
    codedAssert(value.outputs.every((row: J) => Array.isArray(row.entities) && row.entities.length <= MAX_ENTITIES_PER_ROW), "H2_ENTITY_SIZE_CAP", "visual prediction exceeds bounded entity assignment size");
  schema("prediction-output.schema.v2.json", value);
  exactSet(
    value.required_opaque_ids,
    FIXED_OPAQUE_IDS,
    "prediction required IDs",
  );
  const walk = (x: J, at = "$"): void => {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (x && typeof x === "object")
      for (const [key, child] of Object.entries(x)) {
        assert(
          ["no_gold_received", "no_expected_answers_received"].includes(key) ||
            !/(?:expected|gold|reviewer)/i.test(key),
          `prediction leaks authority field at ${at}.${key}`,
        );
        walk(child, `${at}.${key}`);
      }
  };
  walk(value);
  if (value.status === "blank_no_prediction")
    assert(
      value.bundle_tree_sha256 === null &&
        value.session === null &&
        value.outputs.length === 0,
      "blank prediction must contain no execution evidence",
    );
  else {
    assert(
      value.bundle_tree_sha256 && value.session,
      "completed prediction bindings required",
    );
    exactSet(
      value.outputs.map((row: J) => row.opaque_id),
      FIXED_OPAQUE_IDS,
      "prediction output IDs",
    );
    before(
      value.session.started_at,
      value.session.ended_at,
      "prediction session",
    );
    for (const row of value.outputs) {
      validateMentions(row.entities, `prediction ${row.opaque_id}`, "identity");
      for (const place of row.place_links) {
        codedAssert(
          typeof place.opportunity_id === "string" &&
            place.opportunity_id.trim().length > 0,
          "H2_PLACE_PSEUDO_SUPPORT",
          "prediction place link requires a stable opportunity_id",
        );
        codedAssert(
          place.abstained ||
            [
              place.civic_number,
              place.street,
              place.place,
              place.official_url,
            ].some(
              (field: J) =>
                typeof field === "string" && field.trim().length > 0,
            ),
          "H2_PLACE_PSEUDO_SUPPORT",
          "non-abstained place link requires visible linked fields",
        );
      }
      codedAssert(
        row.place_links.length === 0,
        "H2_PLACE_VISUAL_ATTACHMENT",
        "visual rows cannot carry source-only place predictions",
      );
      unique(
        row.place_links.map((place: J) => place.opportunity_id),
        `prediction place opportunity ${row.opaque_id}`,
      );
      assert(
        row.abstention.abstained
          ? typeof row.abstention.reason === "string" &&
              row.abstention.reason.length > 0
          : row.abstention.reason === null,
        "prediction abstention reason consistency",
      );
    }
  }
}
const IMAGE_OPAQUE = FIXED_OPAQUE_IDS.slice(0, 36);
const OCR_OPAQUE = FIXED_OPAQUE_IDS.slice(36, 38);
const SCENE_OPAQUE = FIXED_OPAQUE_IDS.slice(38, 44);
const AERIAL_OPAQUE = AERIAL_IDS.map((id) => FIXED_OPAQUE_IDS[IMAGE_IDS.indexOf(id)]);
const ABSTENTION_OPAQUE = ABSTENTION_IDS.map((id) => FIXED_OPAQUE_IDS[IMAGE_IDS.indexOf(id)]);
function validateGold(file: string): J {
  const value = load(file);
  validateGoldValue(value);
  return {
    status: "gold_schema_and_semantics_valid",
    reviews: value.reviews.length,
  };
}
function normalizedMentionKey(entity: J): string {
  return canon({
    surface: normalizePublicText(entity.surface),
    bbox: entity.bbox.map((coordinate: number) =>
      Math.round(coordinate * ENTITY_BBOX_QUANTIZATION),
    ),
    type: entity.type,
  });
}
function validateMentions(
  entities: J[],
  label: string,
  identityField: "identity" | "supported_identity",
): void {
  codedAssert(
    entities.length <= MAX_ENTITIES_PER_ROW,
    "H2_ENTITY_SIZE_CAP",
    `${label} exceeds the ${MAX_ENTITIES_PER_ROW}-mention per-row bound`,
  );
  unique(
    entities.map((entity: J) => entity.entity_id),
    `${label} entity ID`,
  );
  const canonical: string[] = [];
  for (const entity of entities) {
    codedAssert(
      typeof entity.entity_id === "string" &&
        entity.entity_id.trim().length > 0 &&
        typeof entity.surface === "string" &&
        normalizePublicText(entity.surface).length > 0,
      "H2_ENTITY_PSEUDO_MENTION",
      `${label} entity ID and visible surface required`,
    );
    codedAssert(
      ENTITY_TYPES.includes(entity.type),
      "H2_ENTITY_TYPE",
      `${label} controlled entity type`,
    );
    codedAssert(
      Array.isArray(entity.bbox) &&
        entity.bbox.length === 4 &&
        entity.bbox.every(
          (coordinate: J) =>
            typeof coordinate === "number" &&
            Number.isFinite(coordinate) &&
            coordinate >= 0 &&
            coordinate <= 1,
        ) &&
        entity.bbox[0] < entity.bbox[2] &&
        entity.bbox[1] < entity.bbox[3],
      "H2_ENTITY_BBOX",
      `${label} bbox must be normalized and have positive area`,
    );
    const identity = entity[identityField];
    codedAssert(
      (entity.identity_decision === "linked") ===
        (typeof identity === "string" &&
          normalizePublicText(identity).length > 0),
      "H2_ENTITY_IDENTITY",
      `${label} identity decision/value consistency`,
    );
    canonical.push(normalizedMentionKey(entity));
  }
  codedAssert(
    new Set(canonical).size === canonical.length,
    "H2_ENTITY_DUPLICATE_MENTION",
    `${label} duplicate canonical mention`,
  );
  for (let left = 0; left < entities.length; left++)
    for (let right = left + 1; right < entities.length; right++)
      codedAssert(
        entities[left].type !== entities[right].type ||
          normalizePublicText(entities[left].surface) !==
            normalizePublicText(entities[right].surface) ||
          bboxIou(entities[left].bbox, entities[right].bbox) <
            ENTITY_DUPLICATE_IOU_THRESHOLD,
        "H2_ENTITY_DUPLICATE_MENTION",
        `${label} near-identical mention exceeds IoU ${ENTITY_DUPLICATE_IOU_THRESHOLD}`,
      );
}
function validateGoldValue(value: J, sourceTask?: J): void {
  if (Array.isArray(value?.reviews))
    codedAssert(value.reviews.every((row: J) => Array.isArray(row.place_opportunities) && row.place_opportunities.length === 0), "H2_PLACE_VISUAL_ATTACHMENT", "visual gold rows cannot carry source-only place support");
  if (Array.isArray(value?.reviews))
    codedAssert(value.reviews.every((row: J) => Array.isArray(row.entities) && row.entities.length <= MAX_ENTITIES_PER_ROW), "H2_ENTITY_SIZE_CAP", "visual gold exceeds bounded entity assignment size");
  schema("gold-review-authority.schema.v2.json", value);
  exactSet(value.required_opaque_ids, FIXED_OPAQUE_IDS, "gold required IDs");
  unique(
    value.reviewed_exclusions.map((x: J) => x.opaque_id),
    "gold exclusion ID",
  );
  if (value.status === "blank_external_review_required")
    assert(
      value.bundle_tree_sha256 === null &&
        value.reviewer === null &&
        value.reviews.length === 0 &&
        value.reviewed_exclusions.length === 0,
      "blank gold must contain no review evidence",
    );
  else {
    assert(
      value.bundle_tree_sha256 && value.reviewer,
      "completed gold bindings required",
    );
    exactSet(
      value.reviews.map((row: J) => row.opaque_id),
      FIXED_OPAQUE_IDS,
      "gold review IDs",
    );
    assert(
      value.reviewed_exclusions.length === 0 &&
        value.reviews.every((row: J) => row.exclusion === null),
      "completed gold uses fixed universes without post-prediction exclusions",
    );
    const classSupport = new Map(IMAGE_MODE_CLASSES.map((name) => [name, 0]));
    let reviewableAerial = 0;
    let entitySupport = 0;
    for (const row of value.reviews) {
      assert(
        IMAGE_OPAQUE.includes(row.opaque_id)
          ? IMAGE_MODE_CLASSES.includes(row.image_mode)
          : row.image_mode === null,
        `gold image mode support ${row.opaque_id}`,
      );
      if (IMAGE_OPAQUE.includes(row.opaque_id))
        classSupport.set(row.image_mode, classSupport.get(row.image_mode)! + 1);
      if (OCR_OPAQUE.includes(row.opaque_id)) {
        codedAssert(
          typeof row.ocr_raw === "string" && row.ocr_raw.trim().length > 0,
          "H2_OCR_GOLD_SUPPORT",
          `gold OCR raw support ${row.opaque_id}`,
        );
        const derived = normalizePublicText(row.ocr_raw);
        codedAssert(
          derived.length > 0 && row.ocr_normalized === derived,
          "H2_OCR_NORMALIZED_MISMATCH",
          `gold OCR normalized text must be exactly derived from ocr_raw ${row.opaque_id}`,
        );
      } else
        codedAssert(
          row.ocr_raw === null && row.ocr_normalized === null,
          "H2_OCR_GOLD_SUPPORT",
          `non-OCR gold fields ${row.opaque_id}`,
        );
      assert(
        SCENE_OPAQUE.includes(row.opaque_id) ||
          (row.entities.length === 0 && row.place_opportunities.length === 0),
        `gold entity/place support ${row.opaque_id}`,
      );
      validateMentions(
        row.entities,
        `gold ${row.opaque_id}`,
        "supported_identity",
      );
      unique(
        row.place_opportunities.map((place: J) => place.opportunity_id),
        `gold place opportunity ID ${row.opaque_id}`,
      );
      entitySupport += row.entities.length;
      for (const place of row.place_opportunities) {
        codedAssert(
          typeof place.opportunity_id === "string" &&
            place.opportunity_id.trim().length > 0,
          "H2_PLACE_PSEUDO_SUPPORT",
          "gold place opportunity ID required",
        );
        if (place.supported)
          codedAssert(
            place.official_url !== null &&
              [place.civic_number, place.street, place.place].some(
                (field) => typeof field === "string" && field.trim().length > 0,
              ),
            "H2_PLACE_PSEUDO_SUPPORT",
            "supported place opportunity requires reviewed source-search identity and official URL",
          );
        else
          codedAssert(
            place.task_gate_id === null &&
              place.accepted_claim_id === null &&
              place.source_representation_id === null &&
              place.civic_number === null &&
              place.street === null &&
              place.place === null &&
              place.official_url === null,
            "H2_PLACE_PSEUDO_SUPPORT",
            "unsupported opportunity cannot carry pseudo-support",
          );
      }
      codedAssert(
        row.place_opportunities.length === 0,
        "H2_PLACE_VISUAL_ATTACHMENT",
        "visual rows cannot create support for the source-only place universe",
      );
      if (AERIAL_OPAQUE.includes(row.opaque_id)) {
        assert(
          typeof row.aerial_reviewable === "boolean",
          `aerial reviewed support ${row.opaque_id}`,
        );
        if (row.aerial_reviewable) {
          reviewableAerial++;
          assert(
            row.aerial_labels.length > 0 &&
              !row.aerial_labels.includes("unreviewable"),
            "reviewable aerial labels required",
          );
        } else
          same(
            row.aerial_labels,
            ["unreviewable"],
            "unreviewable aerial label",
          );
      } else
        assert(
          row.aerial_reviewable === null && row.aerial_labels.length === 0,
          `non-aerial review fields ${row.opaque_id}`,
        );
      assert(
        ABSTENTION_OPAQUE.includes(row.opaque_id)
          ? typeof row.answerable === "boolean"
          : row.answerable === null,
        `gold answerability support ${row.opaque_id}`,
      );
    }
    codedAssert(
      [...classSupport.values()].every((count) => count > 0),
      "H2_STOP_CLASS_SUPPORT_COLLAPSE",
      "all five image-mode classes require positive gold support",
    );
    codedAssert(
      entitySupport > 0,
      "H2_STOP_ZERO_ENTITY_GOLD",
      "scene entity gold support required",
    );
    codedAssert(
      reviewableAerial >= 12,
      "H2_STOP_AERIAL_REVIEWABLE_MINIMUM",
      `reviewable aerial denominator below minimum: ${reviewableAerial}`,
    );
  }
  if (value.status === "completed" && sourceTask)
    validateGoldPlaceSupport(value, sourceTask);
}
function sourceSearchCommitmentPayload(envelope: J): J { return envelope.expected; }
function recomputeSourceSearchCommitment(
  envelope: J,
  domain = SOURCE_SEARCH_COMMITMENT_DOMAIN,
): string {
  assert(
    /^[a-f0-9]{64}$/.test(envelope.salt_hex),
    "private expected salt must be exact lowercase 32-byte hex",
  );
  return hash(
    Buffer.concat([
      Buffer.from(`${domain}\0`, "utf8"),
      Buffer.from(envelope.salt_hex, "hex"),
      Buffer.from("\0", "utf8"),
      Buffer.from(canon(sourceSearchCommitmentPayload(envelope)), "utf8"),
    ]),
  );
}
function validateCommitmentShape(commitment: J): void {
  assert(
    commitment.algorithm === "sha256" &&
      commitment.domain === SOURCE_SEARCH_COMMITMENT_DOMAIN &&
      commitment.canonicalization === SOURCE_SEARCH_CANONICALIZATION &&
      /^[a-f0-9]{64}$/.test(commitment.value),
    "source-search commitment contract",
  );
}
function validateSalt(
  value: J,
  capability?: InternalSyntheticCapability,
): void {
  assert(
    /^[a-f0-9]{64}$/.test(value.salt_hex),
    "private expected salt must be exact lowercase 32-byte hex",
  );
  const bytes = Buffer.from(value.salt_hex, "hex");
  const diversity = new Set(bytes).size;
  assert(
    bytes.some((byte) => byte !== 0) && bytes.some((byte) => byte !== 0xff),
    "private expected salt cannot be all-zero or all-one",
  );
  assert(
    diversity >= 16 && !bytes.every((byte) => byte === bytes[0]),
    "private expected salt has insufficient byte diversity",
  );
  const periodic = Array.from(
    { length: bytes.length / 2 },
    (_, index) => index + 1,
  ).some(
    (period) =>
      bytes.length % period === 0 &&
      bytes.every((byte, index) => byte === bytes[index % period]),
  );
  assert(
    !periodic,
    "private expected salt cannot repeat a shorter byte pattern",
  );
  const predictable = new Set([
    Buffer.alloc(32).toString("hex"),
    Buffer.alloc(32, 1).toString("hex"),
    Buffer.alloc(32, 0xff).toString("hex"),
    Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString(
      "hex",
    ),
  ]);
  assert(
    !predictable.has(value.salt_hex),
    "private expected salt matches a predictable fixture value",
  );
  const syntheticSalt = hash(
    "reviewed-metrics-v2 synthetic high-diversity salt",
  );
  assert(
    value.salt_hex !== syntheticSalt ||
      capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true,
    "deterministic synthetic salt requires internal capability",
  );
  assert(
    value.salt_generation.method === "operating_system_csprng" &&
      value.salt_generation.attestation ===
        "author_attested_not_independently_proven" &&
      /^[a-f0-9]{64}$/.test(value.salt_generation.attestation_id),
    "CSPRNG attestation metadata required without proof claim",
  );
}
function validateSourceSearchBundleValue(value: J, baseDir = ROOT): void {
  schema("source-search-bundle.schema.v2.json", value);
  same(
    value.query_subject,
    SOURCE_SEARCH_QUERY_SUBJECT,
    "source-search public query subject",
  );
  same(
    value.normalization_contract,
    SOURCE_SEARCH_NORMALIZATION_CONTRACT,
    "source-search normalization contract",
  );
  same(
    value.official_domain_policy,
    { scheme: "https", hostname_suffix: OFFICIAL_DOMAIN_SUFFIX },
    "source-search bundle generic official-domain policy",
  );
  if (value.status === "template_no_bundle") {
    assert(
      value.output_schema === null,
      "source-search bundle template contains execution evidence",
    );
    return;
  }
  assert(
    value.status === "sealed_public_bundle" && value.output_schema,
    "sealed source-search bundle requires bundle-local schema bytes",
  );
  assert(
    value.output_schema.path === SOURCE_SEARCH_OUTPUT_SCHEMA_FILE,
    "source-search bundle schema must be bundle-local",
  );
  verifyFilePin(value.output_schema, baseDir);
  assert(
    fs
      .readFileSync(path.join(baseDir, SOURCE_SEARCH_OUTPUT_SCHEMA_FILE))
      .equals(
        fs.readFileSync(
          path.join(SCHEMAS, "source-search-prediction.schema.v2.json"),
        ),
      ),
    "source-search bundled schema exact bytes",
  );
  const visible = canon(value);
  assert(
    !/(?:candidate|gate[_ -]?[a-z]|predecessor|source_dossier|private_expected|commitment|salt_hex|accepted_claim|representation_id|source_id|rpcq|patrimoine-culturel|(?:docs|packages|data)\/|\.\.)/i.test(
      visible,
    ),
    "source-search public bundle leaks post-review, predecessor, repository, or source-specific material",
  );
}
function normalizePublicText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("fr-CA").normalize("NFD").replace(/\p{M}+/gu, "").replace(/[\p{P}\p{S}]+/gu, " ").trim().replace(/\s+/gu, " ");
}
function normalizeStreet(value: string): string {
  const tokens = normalizePublicText(value).split(" ").filter(Boolean);
  const designators = new Map([
    ["r", "street"],
    ["rue", "street"],
    ["st", "street"],
    ["street", "street"],
    ["av", "avenue"],
    ["ave", "avenue"],
    ["avenue", "avenue"],
    ["boul", "boulevard"],
    ["blvd", "boulevard"],
    ["boulevard", "boulevard"],
  ]);
  return tokens.map((token) => designators.get(token) ?? token).join(" ");
}
function normalizeNumeric(value: string): string {
  const digits = value.normalize("NFKC").replace(/\s+/gu, "");
  assert(
    /^\d+$/.test(digits),
    "normalized source-search numeric field must contain ASCII digits",
  );
  return digits.replace(/^0+(?=\d)/, "");
}
function normalizeOfficialUrl(value: string): string {
  const url = new URL(value.normalize("NFKC").trim());
  assert(
    url.protocol === "https:" && url.hostname.endsWith(OFFICIAL_DOMAIN_SUFFIX),
    "normalized source-search URL must remain an official HTTPS Quebec government URL",
  );
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
function normalizeSourceSearchField(field: string, value: string): string {
  if (field === "year" || field === "civic_number") return normalizeNumeric(value);
  if (field === "street") return normalizeStreet(value);
  if (field === "official_url") return normalizeOfficialUrl(value);
  return normalizePublicText(value);
}
function validateSourceSearchBundleDirectory(root: string): J {
  exactSet(
    files(root),
    [SOURCE_SEARCH_BUNDLE_FILE, SOURCE_SEARCH_OUTPUT_SCHEMA_FILE],
    "public source-search bundle members",
  );
  const value = load(path.join(root, SOURCE_SEARCH_BUNDLE_FILE));
  validateSourceSearchBundleValue(value, root);
  assert(
    value.status === "sealed_public_bundle",
    "public source-search bundle must be sealed before prediction",
  );
  const facts = tree(root);
  return {
    status: "public_source_search_bundle_valid",
    files: facts.members.length,
    bytes: facts.bytes,
    tree_sha256: facts.sha256,
    task_id: value.task_id,
    output_schema_sha256: value.output_schema.sha256,
  };
}
function buildSourceSearchBundle(output: string): J {
  const reservation = reserveOutput(path.resolve(output));
  let markerRemoved = false;
  try {
    fs.copyFileSync(
      path.join(SCHEMAS, "source-search-prediction.schema.v2.json"),
      path.join(reservation.root, SOURCE_SEARCH_OUTPUT_SCHEMA_FILE),
    );
    const value = {
      ...blankSourceSearchBundle(),
      status: "sealed_public_bundle",
      output_schema: pin(
        path.join(reservation.root, SOURCE_SEARCH_OUTPUT_SCHEMA_FILE),
        SOURCE_SEARCH_OUTPUT_SCHEMA_FILE,
      ),
    };
    writeJson(path.join(reservation.root, SOURCE_SEARCH_BUNDLE_FILE), value);
    fs.rmSync(reservation.marker);
    markerRemoved = true;
    return validateSourceSearchBundleDirectory(reservation.root);
  } catch (error) {
    if (!markerRemoved && owned(reservation)) cleanupOwned(reservation);
    throw error;
  }
}
function validateSourceSearchPredictionValue(value: J, baseDir = ROOT, boundBundle?: FileSnapshot): void {
  schema("source-search-prediction.schema.v2.json", value);
  if (value.status === "blank_no_prediction") {
    assert(
      value.public_bundle === null &&
        value.session === null &&
        value.answer === null &&
        value.evidence.length === 0,
      "blank source-search prediction contains execution evidence",
    );
    return;
  }
  assert(
    value.public_bundle &&
      value.session &&
      value.answer &&
      value.evidence.length === 1,
    "completed source-search prediction requires answer and official evidence",
  );
  before(
    value.session.started_at,
    value.session.ended_at,
    "source-search prediction session",
  );
  assert(
    value.public_bundle.path === SOURCE_SEARCH_BUNDLE_FILE,
    "source-search prediction exact bundle path",
  );
  if (boundBundle) same(value.public_bundle, snapshotPin(boundBundle, SOURCE_SEARCH_BUNDLE_FILE), "source-search prediction immutable bundle bytes"); else verifyFilePin(value.public_bundle, baseDir);
  const bundle = boundBundle ? boundBundle.value : load(resolveEvidencePath(value.public_bundle.path, baseDir));
  validateSourceSearchBundleValue(bundle, baseDir);
  const evidence = value.evidence[0];
  assert(
    value.answer.official_url === evidence.official_url,
    "source-search answer/evidence URL join",
  );
  const official = new URL(value.answer.official_url);
  const evidenceOfficial = new URL(evidence.official_url);
  assert(
    official.protocol === "https:" &&
      official.hostname.endsWith(OFFICIAL_DOMAIN_SUFFIX) &&
      evidenceOfficial.protocol === "https:" &&
      evidenceOfficial.hostname.endsWith(OFFICIAL_DOMAIN_SUFFIX),
    "unsupported official Quebec government source URL",
  );
  const words = evidence.paraphrase.trim().split(/\s+/u);
  assert(
    words.length <= 32 && evidence.paraphrase.length <= 240,
    "source-search bounded paraphrase exceeded",
  );
  assert(
    !/[“”\"']/.test(evidence.paraphrase),
    "source-search raw quote markers refused",
  );
  const normalizedParaphrase = evidence.paraphrase
    .normalize("NFKC")
    .toLocaleLowerCase("fr-CA");
  const echoedFields = ISSUE_97_OUTPUT_FIELDS.filter((field) =>
    normalizedParaphrase.includes(
      String(value.answer[field]).normalize("NFKC").toLocaleLowerCase("fr-CA"),
    ),
  );
  assert(
    echoedFields.length < 3,
    "source-search raw answer restatement refused",
  );
  const publicText = canon({ answer: value.answer, evidence: value.evidence });
  assert(
    !/(?:v2-[0-9]{4}|pixel|image[_ -]?identity|private[_ -]?(?:body|content|path|route|locator)|salt_hex|secret|token|\/Users\/|(?:docs|packages|data)\/)/i.test(
      publicText,
    ),
    "source-search pixel identity/private/repo/secret leakage",
  );
}
function validatePrivateExpectedEnvelopeValue(
  value: J,
  capability?: InternalSyntheticCapability,
  authority?: J,
): void {
  schema("private-expected-envelope.schema.v2.json", value);
  validateCommitmentShape(value.commitment);
  validateSalt(value, capability);
  assert(
    value.task_id === ISSUE_97_TASK_ID,
    "private envelope opaque task binding",
  );
  if (authority) {
    assert(
      authority.schema_version ===
        "reviewed_metrics_execution_authorization_v2.2.0",
      "private envelope chronology requires v2.2 unified authority",
    );
    codedAssert(
      canon(value.authored_by) === canon(identityPin(authority.gold_reviewer)),
      "H2_ENVELOPE_AUTHOR",
      "private envelope author must be the authorized gold reviewer",
    );
    assert(
      value.authored_at === authority.private_envelope_sealed_at,
      "private envelope authored/sealed timestamp binding",
    );
    before(
      authority.source_search_freeze_at,
      value.salt_generation.generated_at,
      "source-search freeze before salt generation",
    );
    notAfter(
      value.salt_generation.generated_at,
      value.authored_at,
      "salt generation no later than envelope seal",
    );
  }
  const provenance = {
    internal_task_id: value.task_id,
    accepted_claim_id: value.gate_e_provenance.accepted_claim_id,
    source_representation_id: value.expected.source_representation_id,
    source_id: value.expected.source_id,
    source_family_id: value.gate_e_provenance.source_family_id,
    official_source_url: value.expected.official_url,
    ...value.gate_e_provenance,
    no_pixel_identity_claim: true,
  };
  const derived = validateGateESourceProvenance(provenance);
  same(
    value.expected,
    derived.expected,
    "private expected fields must derive from accepted Gate E receipt and independently authored dossier",
  );
  assert(
    recomputeSourceSearchCommitment(value) === value.commitment.value,
    "private expected commitment opening mismatch",
  );
}
function validateSourceSearchFreezeValue(
  freeze: J,
  rawPrediction: Buffer,
  prediction: J,
  rawBundle: Buffer,
  authority: J,
): void {
  schema("source-search-freeze.schema.v2.json", freeze);
  assert(
    authority.schema_version ===
      "reviewed_metrics_execution_authorization_v2.2.0",
    "source-search freeze requires v2.2 unified authority",
  );
  assert(
    freeze.prediction.sha256 === hash(rawPrediction) &&
      freeze.prediction.bytes === rawPrediction.length,
    "source-search freeze raw prediction bytes",
  );
  assert(
    freeze.public_bundle.sha256 === hash(rawBundle) &&
      freeze.public_bundle.bytes === rawBundle.length &&
      freeze.public_bundle.path === SOURCE_SEARCH_BUNDLE_FILE,
    "source-search freeze exact public bundle raw bytes",
  );
  same(
    freeze.public_bundle,
    prediction.public_bundle,
    "source-search freeze/prediction bundle pin",
  );
  assert(
    freeze.candidate_commit === authority.candidate_commit &&
      freeze.task_id === ISSUE_97_TASK_ID,
    "source-search freeze authority/task join",
  );
  for (const key of [
    "principal",
    "session_id",
    "model",
    "reasoning_effort",
    "route",
  ])
    assert(
      freeze[key] === prediction.session[key] &&
        freeze[key] === authority.search_predictor[key],
      `source-search freeze predictor ${key}`,
    );
  assert(
    freeze.started_at === prediction.session.started_at &&
      freeze.ended_at === prediction.session.ended_at &&
      freeze.started_at === authority.source_search_started_at &&
      freeze.ended_at === authority.source_search_ended_at &&
      freeze.authorized_at === authority.authorized_at &&
      freeze.frozen_at === authority.source_search_freeze_at,
    "source-search freeze chronology binding",
  );
}
function freezeSourceSearchPrediction(
  input: string,
  bundleFile: string,
  output: string,
  injected?: J,
  capability?: InternalSyntheticCapability,
  injectedClock?: Clock,
): J {
  const authority = executionAuthority(
    injected,
    capability,
    gitExecutionAuthorityEvidence,
    injectedClock,
  );
  const rawPrediction = fs.readFileSync(input);
  const prediction = JSON.parse(rawPrediction.toString("utf8"));
  const baseDir = path.dirname(input);
  assert(
    path.dirname(bundleFile) === baseDir &&
      path.basename(input) === SOURCE_SEARCH_PREDICTION_FILE &&
      path.basename(bundleFile) === SOURCE_SEARCH_BUNDLE_FILE &&
      path.basename(output) === SOURCE_SEARCH_FREEZE_FILE,
    "source-search freeze exact workspace filenames",
  );
  validateSourceSearchPredictionValue(prediction, baseDir);
  assert(
    prediction.status === "completed",
    "only completed source-search prediction can freeze",
  );
  const rawBundle = fs.readFileSync(bundleFile);
  same(
    prediction.public_bundle,
    pin(bundleFile, SOURCE_SEARCH_BUNDLE_FILE),
    "source-search prediction exact bundle bytes",
  );
  const now = (injectedClock ?? (() => new Date()))().getTime();
  assert(
    Math.abs(now - Date.parse(authority.source_search_freeze_at)) <=
      FREEZE_CLOCK_TOLERANCE_MS,
    "declared source-search freeze time outside current-clock tolerance",
  );
  const frozen = {
    schema_version: "reviewed_metrics_source_search_freeze_v2.0.0",
    status: "frozen",
    candidate_id: CANDIDATE_ID,
    candidate_commit: authority.candidate_commit,
    task_id: ISSUE_97_TASK_ID,
    public_bundle: pin(bundleFile, SOURCE_SEARCH_BUNDLE_FILE),
    prediction: { sha256: hash(rawPrediction), bytes: rawPrediction.length },
    principal: authority.search_predictor.principal,
    session_id: authority.search_predictor.session_id,
    model: authority.search_predictor.model,
    reasoning_effort: authority.search_predictor.reasoning_effort,
    route: authority.search_predictor.route,
    started_at: authority.source_search_started_at,
    ended_at: authority.source_search_ended_at,
    authorized_at: authority.authorized_at,
    frozen_at: authority.source_search_freeze_at,
  };
  validateSourceSearchFreezeValue(
    frozen,
    rawPrediction,
    prediction,
    rawBundle,
    authority,
  );
  const destination = physicalPathSafety(output);
  fs.writeFileSync(destination, pretty(frozen), { flag: "wx", mode: 0o600 });
  return {
    status: "source_search_prediction_frozen",
    prediction_sha256: frozen.prediction.sha256,
    prediction_bytes: frozen.prediction.bytes,
  };
}
function gitExecutionAuthorityEvidence(): ExecutionAuthorityEvidence {
  const git = (args: string[]): Buffer =>
    execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let tracked = true;
  let headBytes: Buffer = Buffer.alloc(0);
  let indexBytes: Buffer = Buffer.alloc(0);
  try {
    git(["ls-files", "--error-unmatch", "--", EXECUTION_AUTHORITY_REL]);
    headBytes = git(["show", `HEAD:${EXECUTION_AUTHORITY_REL}`]);
    indexBytes = git(["show", `:${EXECUTION_AUTHORITY_REL}`]);
  } catch {
    tracked = false;
  }
  const clean = (cached: boolean): boolean => {
    try {
      execFileSync(
        "git",
        [
          "diff",
          "--quiet",
          ...(cached ? ["--cached"] : []),
          "--",
          EXECUTION_AUTHORITY_REL,
        ],
        { cwd: ROOT, stdio: "ignore" },
      );
      return true;
    } catch {
      return false;
    }
  };
  const revision = git(["rev-list", "--parents", "-n", "1", "HEAD"])
    .toString("utf8")
    .trim()
    .split(/\s+/);
  const changedPaths = git([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "HEAD",
  ])
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const repositoryClean =
    git(["status", "--porcelain=v1", "--untracked-files=all"]).toString("utf8")
      .length === 0;
  return {
    head: revision[0],
    parents: revision.slice(1),
    changedPaths,
    repositoryClean,
    tracked,
    headBytes,
    indexBytes,
    worktreeBytes: fs.existsSync(EXECUTION_AUTHORITY)
      ? fs.readFileSync(EXECUTION_AUTHORITY)
      : Buffer.alloc(0),
    indexClean: clean(true),
    worktreeClean: clean(false),
  };
}
function validateAuthorityPrincipals(value: J): void {
  const actors = [
    value.implementation,
    value.predictor,
    value.search_predictor,
    value.private_evaluator,
    value.gold_reviewer,
    value.task_reviewer,
    value.publisher,
  ].filter(Boolean);
  unique(
    actors.map((x: J) => x.principal),
    "authority principal",
  );
  unique(
    actors.map((x: J) => x.session_id),
    "authority session",
  );
  const v1 = load(path.join(V1, "independent-task-review-v1.json")).reviewer;
  const gateE = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json",
    ),
  ).reviewer;
  const gateF = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json",
    ),
  ).reviewer;
  const gateG = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/verified-dossiers-publication-v1/independent-dossier-review-v1.json",
    ),
  ).reviewer;
  const expectedForbidden = [
    {
      principal: v1.identity,
      session_id: v1.session_id,
      model: v1.model,
      role: "forbidden_prior_reviewer",
    },
    {
      principal: gateE.identity,
      session_id: gateE.review_session_id,
      model: gateE.model_route,
      role: "forbidden_prior_reviewer",
    },
    {
      principal: gateF.reviewer_id,
      session_id: gateF.session_id,
      model: gateF.model,
      role: "forbidden_prior_reviewer",
    },
    {
      principal: gateG.reviewer_id,
      session_id: gateG.session_id,
      model: gateG.model,
      role: "forbidden_prior_reviewer",
    },
  ];
  exactSet(
    value.forbidden_prior_reviewers.map((x: J) => canon(x)),
    expectedForbidden.map((x) => canon(x)),
    "authority forbidden prior reviewer receipts",
  );
  const forbiddenPrincipals = new Set(
    value.forbidden_prior_reviewers.map((x: J) => x.principal),
  );
  const forbiddenSessions = new Set(
    value.forbidden_prior_reviewers.map((x: J) => x.session_id),
  );
  for (const actor of actors)
    assert(
      !forbiddenPrincipals.has(actor.principal) &&
        !forbiddenSessions.has(actor.session_id),
      `authority forbidden prior reviewer overlap: ${actor.role}`,
    );
  if (value.schema_version === "reviewed_metrics_execution_authorization_v2.2.0") {
    const isolated = [
      value.implementation,
      value.predictor,
      value.search_predictor,
      value.private_evaluator,
      value.gold_reviewer,
      value.task_reviewer,
      value.publisher,
    ];
    const inventoryByDigest = new Map<string, J>();
    for (const inventory of value.trusted_surface_inventory) {
      const digest = trustedInventoryDigest(inventory);
      codedAssert(!inventoryByDigest.has(digest), "H2_ROUTE_INVENTORY_DUPLICATE", "trusted inventory entries must be byte-unique");
      inventoryByDigest.set(digest, inventory);
    }
    const nonces = new Set<string>();
    for (const actorValue of isolated) {
      validateRouteIdentity(actorValue, value, inventoryByDigest);
      codedAssert(!nonces.has(actorValue.route_receipt.nonce), "H2_ROUTE_NONCE_REPLAY", "route receipt nonce must be one-shot across roles");
      nonces.add(actorValue.route_receipt.nonce);
    }
    for (let left = 0; left < isolated.length; left++)
      for (let right = left + 1; right < isolated.length; right++) {
        if (isolated[left].surface_id !== isolated[right].surface_id) continue;
        codedAssert(
          !isWithin(
            isolated[left].canonical_root,
            isolated[right].canonical_root,
          ),
          "H2_ROUTE_PHYSICAL_OVERLAP",
          `authority physical routes overlap: ${isolated[left].role}/${isolated[right].role}`,
        );
      }
    const evaluatorKey = parseEd25519PublicKey(
      value.private_evaluator.signing_public_key_pem,
    );
    codedAssert(
      value.private_evaluator.signing_public_key_pem ===
        evaluatorKey.export({ type: "spki", format: "pem" }).toString(),
      "H2_EVALUATOR_PUBLIC_KEY",
      "private evaluator public key must use canonical SPKI PEM bytes",
    );
    for (const actorValue of isolated.filter(
      (candidate: J) => candidate !== value.private_evaluator,
    ))
      codedAssert(
        actorValue.signing_public_key_pem === undefined,
        "H2_EVALUATOR_PUBLIC_KEY",
        `signing key forbidden for ${actorValue.role}`,
      );
  }
}
function validateAuthorityValue(value: J): void {
  schema("execution-authorization.schema.v2.json", value);
  before(value.authorized_at, value.started_at, "authorization before visual prediction"); before(value.started_at, value.ended_at, "visual prediction execution"); before(value.ended_at, value.freeze_at, "visual prediction before freeze"); if (value.schema_version === "reviewed_metrics_execution_authorization_v2.2.0") { before(value.freeze_at, value.source_search_started_at, "visual freeze before source-search run"); before(value.source_search_started_at, value.source_search_ended_at, "source-search execution"); before(value.source_search_ended_at, value.source_search_freeze_at, "source-search prediction before freeze"); before(value.source_search_freeze_at, value.source_dossier_authored_at, "source-search freeze before dossier authoring"); before(value.source_dossier_authored_at, value.private_envelope_sealed_at, "dossier before private envelope seal"); before(value.private_envelope_sealed_at, value.expires_at, "private envelope before authorization expiry"); } else before(value.freeze_at, value.expires_at, "visual freeze authorization expiry");
  validateAuthorityPrincipals(value);
}
function executionAuthority(
  injected?: J,
  capability?: InternalSyntheticCapability,
  reader: ExecutionAuthorityReader = gitExecutionAuthorityEvidence,
  injectedClock?: Clock,
): J {
  assert(
    injectedClock === undefined ||
      capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true,
    "internal clock injection capability required",
  );
  const clock = injectedClock ?? (() => new Date());
  let value: J;
  if (injected !== undefined) {
    assert(
      capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true,
      "internal execution authority injection capability required",
    );
    value = injected;
  } else {
    const evidence = reader();
    assert(
      evidence.tracked && evidence.headBytes.length > 0,
      "prediction freeze unavailable: execution authorization is not tracked and committed at HEAD",
    );
    assert(
      evidence.parents.length === 1,
      "prediction freeze unavailable: authority commit must have exactly one parent",
    );
    same(
      evidence.changedPaths,
      [EXECUTION_AUTHORITY_REL],
      "authority activation changed paths",
    );
    assert(
      evidence.repositoryClean,
      "prediction freeze unavailable: authority activation repository is not clean",
    );
    assert(
      evidence.indexClean && evidence.worktreeClean,
      "prediction freeze unavailable: execution authorization is staged or modified",
    );
    assert(
      evidence.headBytes.equals(evidence.indexBytes) &&
        evidence.headBytes.equals(evidence.worktreeBytes),
      "prediction freeze unavailable: execution authorization bytes differ across HEAD, index, or worktree",
    );
    value = JSON.parse(evidence.headBytes.toString("utf8"));
    assert(
      value.candidate_commit === evidence.parents[0],
      "prediction freeze unavailable: authority candidate_commit must equal the authority commit sole parent",
    );
  }
  validateAuthorityValue(value);
  const now = clock().getTime();
  assert(Number.isFinite(now), "execution authority clock invalid");
  assert(
    Date.parse(value.authorized_at) <= now &&
      now < Date.parse(value.expires_at),
    "execution authorization is not live at current UTC",
  );
  return value;
}
function freezePrediction(
  input: string,
  output: string,
  injected?: J,
  capability?: InternalSyntheticCapability,
  injectedClock?: Clock,
): J {
  assert(
    injectedClock === undefined ||
      capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true,
    "internal clock injection capability required",
  );
  const clock = injectedClock ?? (() => new Date());
  const authority = executionAuthority(
    injected,
    capability,
    gitExecutionAuthorityEvidence,
    injectedClock,
  );
  const raw = fs.readFileSync(input);
  const prediction = JSON.parse(raw.toString("utf8"));
  validatePredictionValue(prediction);
  assert(
    prediction.status === "completed",
    "only completed prediction can freeze",
  );
  assert(
    authority.candidate_id === CANDIDATE_ID &&
      authority.implementation_base_commit === IMPLEMENTATION_BASE_COMMIT &&
      /^[a-f0-9]{40}$/.test(authority.candidate_commit),
    "freeze candidate binding",
  );
  assert(
    authority.bundle_tree_sha256 === prediction.bundle_tree_sha256,
    "freeze bundle binding",
  );
  for (const key of [
    "principal",
    "session_id",
    "model",
    "reasoning_effort",
    "route",
  ])
    assert(
      authority.predictor[key] === prediction.session[key],
      `freeze predictor ${key} binding`,
    );
  assert(
    authority.started_at === prediction.session.started_at &&
      authority.ended_at === prediction.session.ended_at,
    "freeze session timestamp binding",
  );
  const now = clock().getTime();
  assert(
    Math.abs(now - Date.parse(authority.freeze_at)) <=
      FREEZE_CLOCK_TOLERANCE_MS,
    "declared freeze time is outside current-clock tolerance",
  );
  const frozen = {
    schema_version: "reviewed_metrics_prediction_freeze_v2.0.0",
    status: "frozen",
    candidate_id: CANDIDATE_ID,
    implementation_base_commit: IMPLEMENTATION_BASE_COMMIT,
    candidate_commit: authority.candidate_commit,
    bundle_tree_sha256: authority.bundle_tree_sha256,
    prediction: { sha256: hash(raw), bytes: raw.length },
    principal: authority.predictor.principal,
    session_id: authority.predictor.session_id,
    model: authority.predictor.model,
    reasoning_effort: authority.predictor.reasoning_effort,
    route: authority.predictor.route,
    started_at: authority.started_at,
    ended_at: authority.ended_at,
    authorized_at: authority.authorized_at,
    frozen_at: authority.freeze_at,
  };
  schema("prediction-freeze.schema.v2.json", frozen);
  const destination = physicalPathSafety(output);
  fs.writeFileSync(destination, pretty(frozen), { flag: "wx", mode: 0o600 });
  return {
    status: "prediction_frozen",
    prediction_sha256: frozen.prediction.sha256,
    prediction_bytes: frozen.prediction.bytes,
    freeze_sha256: hash(fs.readFileSync(destination)),
  };
}
function metricUniverse(metricId: string): string[] {
  if (metricId.startsWith("ocr_")) return OCR_OPAQUE;
  if (metricId.startsWith("entity_")) return SCENE_OPAQUE;
  if (metricId.startsWith("place_link_")) return [ISSUE_97_TASK_ID];
  if (metricId.startsWith("image_mode_") || metricId === "mask_iou") return IMAGE_OPAQUE;
  if (metricId.startsWith("aerial_")) return AERIAL_OPAQUE;
  if (metricId.startsWith("abstention_")) return ABSTENTION_OPAQUE;
  if (metricId === "geolocation_distance") return FIXED_OPAQUE_IDS;
  return ["visual_prediction_session", "source_search_prediction_session"];
}
function levenshtein<T>(a: ArrayLike<T>, b: ArrayLike<T>): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const prior = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = prior;
    }
  }
  return row[b.length];
}
function multisetCounts(
  predicted: J[],
  gold: J[],
  normalize: (value: J) => string,
): { tp: number; fp: number; fn: number } {
  const remaining = new Map<string, number>();
  for (const item of gold) {
    const key = normalize(item);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let tp = 0;
  let fp = 0;
  for (const item of predicted) {
    const key = normalize(item);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      tp++;
      remaining.set(key, count - 1);
    } else fp++;
  }
  return {
    tp,
    fp,
    fn: [...remaining.values()].reduce((sum, count) => sum + count, 0),
  };
}
function bboxIou(left: number[], right: number[]): number {
  const width = Math.max(
    0,
    Math.min(left[2], right[2]) - Math.max(left[0], right[0]),
  );
  const height = Math.max(
    0,
    Math.min(left[3], right[3]) - Math.max(left[1], right[1]),
  );
  const intersection = width * height;
  const leftArea = (left[2] - left[0]) * (left[3] - left[1]);
  const rightArea = (right[2] - right[0]) * (right[3] - right[1]);
  return intersection / (leftArea + rightArea - intersection);
}
type MentionMatch = { prediction: number; gold: number; iou: number };
function maximumMentionMatching(predicted: J[], gold: J[]): MentionMatch[] {
  codedAssert(predicted.length <= MAX_ENTITIES_PER_ROW && gold.length <= MAX_ENTITIES_PER_ROW, "H2_ENTITY_SIZE_CAP", "entity assignment exceeds bounded matrix");
  const size = Math.max(predicted.length, gold.length);
  if (size === 0) return [];
  const iouScale = 1_000_000;
  const tieScale = 4_096;
  const maximumTiePenalty = MAX_ENTITIES_PER_ROW ** 2 - 1;
  const cardinalityWeight =
    (MAX_ENTITIES_PER_ROW + 1) *
      (iouScale * tieScale + maximumTiePenalty) +
    1;
  const weights: number[][] = Array.from({ length: size }, () =>
    Array(size).fill(0),
  );
  const validMatches = new Map<string, MentionMatch>();
  for (let prediction = 0; prediction < predicted.length; prediction++)
    for (let goldIndex = 0; goldIndex < gold.length; goldIndex++) {
      const iou = bboxIou(predicted[prediction].bbox, gold[goldIndex].bbox);
      if (iou < ENTITY_IOU_THRESHOLD || predicted[prediction].type !== gold[goldIndex].type || normalizePublicText(predicted[prediction].surface) !== normalizePublicText(gold[goldIndex].surface)) continue;
      const iouWeight = Math.round(iou * iouScale);
      const tiePenalty =
        Math.abs(prediction - goldIndex) * MAX_ENTITIES_PER_ROW + goldIndex;
      weights[prediction][goldIndex] =
        cardinalityWeight + iouWeight * tieScale - tiePenalty;
      validMatches.set(`${prediction}:${goldIndex}`, {
        prediction,
        gold: goldIndex,
        iou,
      });
    }

  // Hungarian assignment minimizes cost. Padding and invalid edges have zero
  // weight, so the weighted square assignment also permits unmatched mentions.
  const maximumWeight = Math.max(0, ...weights.flat());
  const potentialsByRow = Array(size + 1).fill(0);
  const potentialsByColumn = Array(size + 1).fill(0);
  const rowForColumn = Array(size + 1).fill(0);
  const previousColumn = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row++) {
    rowForColumn[0] = row;
    let column = 0;
    const minimumReducedCost = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(size + 1).fill(false);
    do {
      used[column] = true;
      const currentRow = rowForColumn[column];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let candidateColumn = 1; candidateColumn <= size; candidateColumn++) {
        if (used[candidateColumn]) continue;
        const cost = maximumWeight - weights[currentRow - 1][candidateColumn - 1];
        const reducedCost =
          cost - potentialsByRow[currentRow] - potentialsByColumn[candidateColumn];
        if (reducedCost < minimumReducedCost[candidateColumn]) {
          minimumReducedCost[candidateColumn] = reducedCost;
          previousColumn[candidateColumn] = column;
        }
        if (
          minimumReducedCost[candidateColumn] < delta ||
          (minimumReducedCost[candidateColumn] === delta &&
            candidateColumn < nextColumn)
        ) {
          delta = minimumReducedCost[candidateColumn];
          nextColumn = candidateColumn;
        }
      }
      for (let candidateColumn = 0; candidateColumn <= size; candidateColumn++) {
        if (used[candidateColumn]) {
          potentialsByRow[rowForColumn[candidateColumn]] += delta;
          potentialsByColumn[candidateColumn] -= delta;
        } else {
          minimumReducedCost[candidateColumn] -= delta;
        }
      }
      column = nextColumn;
    } while (rowForColumn[column] !== 0);
    do {
      const nextColumn = previousColumn[column];
      rowForColumn[column] = rowForColumn[nextColumn];
      column = nextColumn;
    } while (column !== 0);
  }
  const matches: MentionMatch[] = [];
  for (let column = 1; column <= size; column++) {
    const prediction = rowForColumn[column] - 1;
    const match = validMatches.get(`${prediction}:${column - 1}`);
    if (match) {
      matches.push(match);
    }
  }
  return matches.sort((a, b) => a.prediction - b.prediction || a.gold - b.gold);
}
function metricRow(
  metric_id: string,
  raw_counts: J,
  numerator: number | null,
  denominator: number,
  provenance: string[],
  status = "observed",
  reason: string | null = null,
  limitations: string[] = [],
  includedIds?: string[],
  exclusions?: J[],
): J {
  if (denominator === 0 && status === "observed") {
    numerator = null;
    status = "observed_undefined_zero_support";
    reason ??=
      "zero support in the fixed universe; denominator was not replaced or shrunk";
  }
  const universe = metricUniverse(metric_id);
  const included = includedIds ?? universe;
  const excluded = exclusions ?? [];
  exactSet(
    [...included, ...excluded.map((item) => item.opaque_id)],
    universe,
    `${metric_id} included/excluded partition`,
  );
  return {
    metric_id,
    fixed_universe_ids: universe,
    included_ids: included,
    excluded,
    raw_counts,
    numerator,
    denominator,
    status,
    value: numerator === null ? null : numerator / denominator,
    undefined_or_na_reason: numerator === null ? reason : null,
    limitations,
    support: {
      fixed_universe: universe.length,
      denominator,
      no_denominator_shrinkage: true,
    },
    provenance,
  };
}
function deriveMetrics(
  prediction: J,
  gold: J,
  privateScoreReceipt?: J,
  authority?: J,
  sourceTask?: J,
): J[] {
  const predictions = new Map<string, J>(
    prediction.outputs.map((row: J) => [row.opaque_id, row]),
  );
  const reviews = new Map<string, J>(
    gold.reviews.map((row: J) => [row.opaque_id, row]),
  );
  const rows: J[] = [];
  const visualProvenance = [
    "prediction-output-v2.json",
    "gold-review-v2.json",
    "input-authority-v2.json",
  ];
  const ocrRows = OCR_OPAQUE.map((id) => ({
    prediction: normalizePublicText(predictions.get(id).ocr ?? ""),
    gold: normalizePublicText(reviews.get(id).ocr_raw),
  }));
  const ocrTp = ocrRows.filter((row) => row.prediction === row.gold).length;
  const charEdits = ocrRows.reduce(
    (sum, row) =>
      sum + levenshtein(Array.from(row.prediction), Array.from(row.gold)),
    0,
  );
  const goldChars = ocrRows.reduce(
    (sum, row) => sum + Array.from(row.gold).length,
    0,
  );
  const wordEdits = ocrRows.reduce(
    (sum, row) =>
      sum +
      levenshtein(
        row.prediction.split(" ").filter(Boolean),
        row.gold.split(" ").filter(Boolean),
      ),
    0,
  );
  const goldWords = ocrRows.reduce(
    (sum, row) => sum + row.gold.split(" ").filter(Boolean).length,
    0,
  );
  rows.push(
    metricRow(
      "ocr_normalized_exact_match",
      { exact_matches: ocrTp, support: OCR_OPAQUE.length },
      ocrTp,
      OCR_OPAQUE.length,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "ocr_cer",
      { character_edits: charEdits, gold_characters: goldChars },
      charEdits,
      goldChars,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "ocr_wer",
      { word_edits: wordEdits, gold_words: goldWords },
      wordEdits,
      goldWords,
      visualProvenance,
    ),
  );
  let entity = { tp: 0, fp: 0, fn: 0 };
  let linkedIdentityPredictions = 0;
  let falseIdentities = 0;
  for (const id of SCENE_OPAQUE) {
    const predictedEntities = predictions.get(id).entities;
    const goldEntities = reviews.get(id).entities;
    const matches = maximumMentionMatching(predictedEntities, goldEntities);
    entity.tp += matches.length;
    entity.fp += predictedEntities.length - matches.length;
    entity.fn += goldEntities.length - matches.length;
    const matchByPrediction = new Map(
      matches.map((match) => [match.prediction, match.gold]),
    );
    predictedEntities.forEach((mention: J, index: number) => {
      if (mention.identity_decision !== "linked") return;
      linkedIdentityPredictions++;
      const goldIndex = matchByPrediction.get(index);
      if (goldIndex === undefined) {
        falseIdentities++;
        return;
      }
      const supported = goldEntities[goldIndex];
      if (
        supported.identity_decision !== "linked" ||
        normalizePublicText(mention.identity) !==
          normalizePublicText(supported.supported_identity)
      )
        falseIdentities++;
    });
  }
  rows.push(
    metricRow(
      "entity_precision",
      {
        ...entity,
        iou_threshold: ENTITY_IOU_THRESHOLD,
      },
      entity.tp,
      entity.tp + entity.fp,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "entity_recall",
      {
        ...entity,
        iou_threshold: ENTITY_IOU_THRESHOLD,
      },
      entity.tp,
      entity.tp + entity.fn,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "entity_false_identity_rate",
      {
        false_identities: falseIdentities,
        linked_identity_predictions: linkedIdentityPredictions,
      },
      falseIdentities,
      linkedIdentityPredictions,
      visualProvenance,
    ),
  );
  if (sourceTask) validateGoldPlaceSupport(gold, sourceTask);
  const place = {
    correct: privateScoreReceipt.source_task_outcome.correct_supported_source_tasks ? 1 : 0,
    predicted: privateScoreReceipt.source_task_outcome.predicted_source_tasks ? 1 : 0,
    opportunities: 1,
    covered: privateScoreReceipt.source_task_outcome.predicted_source_tasks ? 1 : 0,
  };
  const placeProvenance = [
    SOURCE_SEARCH_PREDICTION_FILE,
    SOURCE_SEARCH_FREEZE_FILE,
    PRIVATE_SCORE_RECEIPT_FILE,
    SOURCE_SEARCH_TASK_FILE,
  ];
  rows.push(
    metricRow(
      "place_link_precision",
      {
        correct_supported_links: place.correct,
        predicted_links: place.predicted,
        reviewed_supported_opportunities: place.opportunities,
        covered_opportunities: place.covered,
      },
      place.correct,
      place.predicted,
      placeProvenance,
    ),
  );
  rows.push(
    metricRow(
      "place_link_coverage",
      {
        correct_supported_links: place.correct,
        predicted_links: place.predicted,
        reviewed_supported_opportunities: place.opportunities,
        covered_opportunities: place.covered,
      },
      place.covered,
      place.opportunities,
      placeProvenance,
    ),
  );
  const confusion: Record<string, number> = {};
  for (const predicted of IMAGE_MODE_CLASSES)
    for (const actual of IMAGE_MODE_CLASSES)
      confusion[`${actual}__predicted_${predicted}`] = 0;
  for (const id of IMAGE_OPAQUE)
    confusion[
      `${reviews.get(id).image_mode}__predicted_${predictions.get(id).image_mode}`
    ] =
      (confusion[
        `${reviews.get(id).image_mode}__predicted_${predictions.get(id).image_mode}`
      ] ?? 0) + 1;
  const imageF1: number[] = [];
  for (const className of IMAGE_MODE_CLASSES) {
    const tp = IMAGE_OPAQUE.filter(
      (id) =>
        reviews.get(id).image_mode === className &&
        predictions.get(id).image_mode === className,
    ).length;
    const fp = IMAGE_OPAQUE.filter(
      (id) =>
        reviews.get(id).image_mode !== className &&
        predictions.get(id).image_mode === className,
    ).length;
    const fn = IMAGE_OPAQUE.filter(
      (id) =>
        reviews.get(id).image_mode === className &&
        predictions.get(id).image_mode !== className,
    ).length;
    const f1Den = 2 * tp + fp + fn;
    const f1 = f1Den === 0 ? 0 : (2 * tp) / f1Den;
    imageF1.push(f1);
    rows.push(
      metricRow(
        `image_mode_${className}_precision`,
        { tp, fp, fn, gold_support: tp + fn, predicted_support: tp + fp },
        tp,
        tp + fp,
        visualProvenance,
      ),
    );
    rows.push(
      metricRow(
        `image_mode_${className}_recall`,
        { tp, fp, fn, gold_support: tp + fn, predicted_support: tp + fp },
        tp,
        tp + fn,
        visualProvenance,
      ),
    );
    rows.push(
      metricRow(
        `image_mode_${className}_f1`,
        { tp, fp, fn, gold_support: tp + fn, predicted_support: tp + fp },
        2 * tp,
        f1Den,
        visualProvenance,
      ),
    );
  }
  rows.push(
    metricRow(
      "image_mode_macro_f1",
      {
        ...confusion,
        classes: IMAGE_MODE_CLASSES.length,
        image_support: IMAGE_OPAQUE.length,
      },
      imageF1.reduce((sum, value) => sum + value, 0),
      IMAGE_MODE_CLASSES.length,
      visualProvenance,
    ),
  );
  const reviewableAerialIds = AERIAL_OPAQUE.filter(
    (id) => reviews.get(id).aerial_reviewable,
  );
  const aerialExclusions = AERIAL_OPAQUE.filter(
    (id) => !reviews.get(id).aerial_reviewable,
  ).map((opaque_id) => ({
    opaque_id,
    reason:
      "independent gold review found the whole-image aerial label prerequisite unreviewable",
    fixed_before_scoring: true,
  }));
  let aerial = { tp: 0, fp: 0, fn: 0 };
  let exactSets = 0;
  let jaccardSum = 0;
  const perLabel = new Map(
    AERIAL_LABELS.map((label) => [label, { tp: 0, fp: 0, fn: 0 }]),
  );
  for (const id of reviewableAerialIds) {
    const p = new Set<string>(predictions.get(id).aerial_labels);
    const g = new Set<string>(reviews.get(id).aerial_labels);
    if (canon([...p].sort()) === canon([...g].sort())) exactSets++;
    const union = new Set([...p, ...g]);
    const intersection = [...p].filter((label) => g.has(label));
    jaccardSum += union.size === 0 ? 1 : intersection.length / union.size;
    for (const label of AERIAL_LABELS) {
      const counts = perLabel.get(label)!;
      if (p.has(label) && g.has(label)) {
        counts.tp++;
        aerial.tp++;
      } else if (p.has(label)) {
        counts.fp++;
        aerial.fp++;
      } else if (g.has(label)) {
        counts.fn++;
        aerial.fn++;
      }
    }
  }
  rows.push(
    metricRow(
      "aerial_exact_set_accuracy",
      {
        exact_sets: exactSets,
        fixed_images: AERIAL_OPAQUE.length,
        reviewable_images: reviewableAerialIds.length,
        excluded_unreviewable: aerialExclusions.length,
      },
      exactSets,
      reviewableAerialIds.length,
      visualProvenance,
      "observed",
      null,
      [],
      reviewableAerialIds,
      aerialExclusions,
    ),
  );
  rows.push(
    metricRow(
      "aerial_jaccard",
      {
        jaccard_sum: jaccardSum,
        fixed_images: AERIAL_OPAQUE.length,
        reviewable_images: reviewableAerialIds.length,
        excluded_unreviewable: aerialExclusions.length,
      },
      jaccardSum,
      reviewableAerialIds.length,
      visualProvenance,
      "observed",
      null,
      [],
      reviewableAerialIds,
      aerialExclusions,
    ),
  );
  for (const label of AERIAL_LABELS) {
    const c = perLabel.get(label)!;
    const counts = {
      ...c,
      reviewable_images: reviewableAerialIds.length,
      excluded_unreviewable: aerialExclusions.length,
    };
    rows.push(
      metricRow(
        `aerial_${label}_precision`,
        counts,
        c.tp,
        c.tp + c.fp,
        visualProvenance,
        "observed",
        null,
        [],
        reviewableAerialIds,
        aerialExclusions,
      ),
    );
    rows.push(
      metricRow(
        `aerial_${label}_recall`,
        counts,
        c.tp,
        c.tp + c.fn,
        visualProvenance,
        "observed",
        null,
        [],
        reviewableAerialIds,
        aerialExclusions,
      ),
    );
    rows.push(
      metricRow(
        `aerial_${label}_f1`,
        counts,
        2 * c.tp,
        2 * c.tp + c.fp + c.fn,
        visualProvenance,
        "observed",
        null,
        [],
        reviewableAerialIds,
        aerialExclusions,
      ),
    );
  }
  const aerialCounts = {
    ...aerial,
    reviewable_images: reviewableAerialIds.length,
    excluded_unreviewable: aerialExclusions.length,
  };
  rows.push(
    metricRow(
      "aerial_micro_precision",
      aerialCounts,
      aerial.tp,
      aerial.tp + aerial.fp,
      visualProvenance,
      "observed",
      null,
      [],
      reviewableAerialIds,
      aerialExclusions,
    ),
  );
  rows.push(
    metricRow(
      "aerial_micro_recall",
      aerialCounts,
      aerial.tp,
      aerial.tp + aerial.fn,
      visualProvenance,
      "observed",
      null,
      [],
      reviewableAerialIds,
      aerialExclusions,
    ),
  );
  rows.push(
    metricRow(
      "aerial_micro_f1",
      aerialCounts,
      2 * aerial.tp,
      2 * aerial.tp + aerial.fp + aerial.fn,
      visualProvenance,
      "observed",
      null,
      [],
      reviewableAerialIds,
      aerialExclusions,
    ),
  );
  let selectiveSupport = 0;
  let selectiveErrors = 0;
  for (const id of ABSTENTION_OPAQUE) {
    const p = predictions.get(id);
    const g = reviews.get(id);
    if (p.abstention.abstained) continue;
    selectiveSupport++;
    const imageWrong =
      IMAGE_OPAQUE.includes(id) && p.image_mode !== g.image_mode;
    const aerialWrong =
      AERIAL_OPAQUE.includes(id) &&
      g.aerial_reviewable &&
      canon([...p.aerial_labels].sort()) !== canon([...g.aerial_labels].sort());
    if (imageWrong || aerialWrong || !g.answerable) selectiveErrors++;
  }
  const abstained = ABSTENTION_OPAQUE.filter(
    (id) => predictions.get(id).abstention.abstained,
  ).length;
  const unanswerable = ABSTENTION_OPAQUE.filter(
    (id) => reviews.get(id).answerable === false,
  ).length;
  const appropriate = ABSTENTION_OPAQUE.filter(
    (id) =>
      reviews.get(id).answerable === false &&
      predictions.get(id).abstention.abstained,
  ).length;
  const unsafe = unanswerable - appropriate;
  const decisionCorrect = ABSTENTION_OPAQUE.filter(
    (id) =>
      predictions.get(id).abstention.abstained === !reviews.get(id).answerable,
  ).length;
  const abstentionCounts = {
    abstained,
    non_abstained: ABSTENTION_OPAQUE.length - abstained,
    unanswerable,
    appropriate_abstentions: appropriate,
    unsafe_non_abstentions: unsafe,
    selective_errors: selectiveErrors,
  };
  rows.push(
    metricRow(
      "abstention_coverage",
      abstentionCounts,
      ABSTENTION_OPAQUE.length - abstained,
      ABSTENTION_OPAQUE.length,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "abstention_rate",
      abstentionCounts,
      abstained,
      ABSTENTION_OPAQUE.length,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "appropriate_abstention_recall",
      abstentionCounts,
      appropriate,
      unanswerable,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "unsafe_non_abstention_rate",
      abstentionCounts,
      unsafe,
      unanswerable,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "abstention_selective_error",
      abstentionCounts,
      selectiveErrors,
      selectiveSupport,
      visualProvenance,
    ),
  );
  rows.push(
    metricRow(
      "abstention_decision_accuracy",
      abstentionCounts,
      decisionCorrect,
      ABSTENTION_OPAQUE.length,
      visualProvenance,
    ),
  );
  const prerequisiteExclusions = (ids: string[], reason: string) =>
    ids.map((opaque_id) => ({ opaque_id, reason, fixed_before_scoring: true }));
  rows.push(
    metricRow(
      "mask_iou",
      { reviewed_masks: 0, excluded_missing_prerequisite: IMAGE_OPAQUE.length },
      null,
      0,
      visualProvenance,
      "prerequisite_not_applicable",
      "no real reviewed masks exist; masks must not be fabricated",
      ["Prerequisite evidence absent by design."],
      [],
      prerequisiteExclusions(
        IMAGE_OPAQUE,
        "no reviewed mask prerequisite exists",
      ),
    ),
  );
  rows.push(
    metricRow(
      "geolocation_distance",
      {
        verified_coordinates: 0,
        excluded_missing_prerequisite: FIXED_OPAQUE_IDS.length,
      },
      null,
      0,
      visualProvenance,
      "prerequisite_not_applicable",
      "no real verified coordinates exist; coordinates must not be fabricated",
      ["Prerequisite evidence absent by design."],
      [],
      prerequisiteExclusions(
        FIXED_OPAQUE_IDS,
        "no verified coordinate prerequisite exists",
      ),
    ),
  );
  const visualSeconds =
    (Date.parse(prediction.session.ended_at) -
      Date.parse(prediction.session.started_at)) /
    1000;
  const sourceSeconds = authority
    ? (Date.parse(authority.source_search_ended_at) -
        Date.parse(authority.source_search_started_at)) /
      1000
    : 0;
  rows.push(
    metricRow(
      "operation_timing_seconds",
      {
        visual_prediction_seconds: visualSeconds,
        source_search_prediction_seconds: sourceSeconds,
      },
      visualSeconds + sourceSeconds,
      1,
      ["prediction-output-v2.json", "execution-authorization-v2.json"],
    ),
  );
  rows.push(
    metricRow(
      "model_tool_cost",
      { real_usage_receipts: 0 },
      null,
      0,
      ["execution-authorization-v2.json"],
      "unavailable_no_real_usage_receipt",
      "model/tool cost is unavailable because no real usage receipt is present",
      ["No estimate or authored cost is accepted."],
    ),
  );
  exactSet(
    rows.map((row) => row.metric_id),
    METRIC_IDS,
    "complete issue #96 metric universe",
  );
  return rows;
}
function exactPinnedValue(
  pinValue: J,
  expectedPath: string,
  schemaName: string,
  baseDir: string,
): J {
  assert(
    pinValue.path === expectedPath,
    `exact evidence path required: ${expectedPath}`,
  );
  verifyFilePin(pinValue, baseDir);
  const value = load(resolveEvidencePath(pinValue.path, baseDir));
  schema(schemaName, value);
  return value;
}
function validateFreezeValue(
  freeze: J,
  rawPrediction: Buffer,
  prediction: J,
  authority: J,
): void {
  schema("prediction-freeze.schema.v2.json", freeze);
  assert(
    freeze.status === "frozen" &&
      freeze.prediction.sha256 === hash(rawPrediction) &&
      freeze.prediction.bytes === rawPrediction.length,
    "freeze raw prediction byte pin mismatch",
  );
  assert(
    freeze.candidate_commit === authority.candidate_commit &&
      freeze.bundle_tree_sha256 === prediction.bundle_tree_sha256 &&
      freeze.bundle_tree_sha256 === authority.bundle_tree_sha256,
    "freeze authority join mismatch",
  );
  for (const key of [
    "principal",
    "session_id",
    "model",
    "reasoning_effort",
    "route",
    "started_at",
    "ended_at",
  ])
    assert(
      freeze[key] ===
        (key in prediction.session ? prediction.session[key] : authority[key]),
      `freeze prediction join ${key}`,
    );
  assert(
    freeze.authorized_at === authority.authorized_at &&
      freeze.frozen_at === authority.freeze_at,
    "freeze timestamp authority join",
  );
}
function identityPin(actorValue: J): J {
  return {
    principal: actorValue.principal,
    session_id: actorValue.session_id,
    model: actorValue.model,
    reasoning_effort: actorValue.reasoning_effort,
    route: actorValue.route,
    surface_id: actorValue.surface_id,
    canonical_root: actorValue.canonical_root,
  };
}
function receiptSigningPayload(receipt: J): Buffer { const unsigned = structuredClone(receipt); delete unsigned.finalization_signature; return Buffer.from(canon(unsigned), "utf8"); }
function retentionSigningPayload(receipt: J): Buffer { const unsigned = structuredClone(receipt); delete unsigned.signature; return Buffer.from(canon(unsigned), "utf8"); }
function fsyncDirectory(directory: string): void {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function validatePrivateRetentionReceiptValue(value: J, envelopePin: J, detailPin: J, authority: J): void {
  codedAssert(value && Array.isArray(value.objects), "H2_RETENTION_MISSING", "private retention receipt is required");
  codedAssert(value.objects.every((object: J) => object.no_public_acl === true), "H2_RETENTION_PUBLIC_ACL", "private retention objects must attest no public ACL");
  codedAssert(value.objects.every((object: J) => object.readback_verified === true), "H2_RETENTION_READBACK", "private retention objects require byte-identical readback");
  schema("private-retention-receipt.schema.v2.json", value);
  const expected = new Map([
    ["private_expected_envelope", envelopePin],
    ["private_score_detail", detailPin],
  ]);
  exactSet(value.objects.map((object: J) => object.artifact_role), [...expected.keys()], "private retention object roles");
  for (const object of value.objects) {
    const pinValue = expected.get(object.artifact_role)!;
    codedAssert(object.sha256 === pinValue.sha256 && object.bytes === pinValue.bytes, "H2_RETENTION_EXACT_BYTES", `retention ${object.artifact_role} must bind exact private bytes`);
    codedAssert(object.object_key_sha256 === hash(`gate-h2-private-object:${object.sha256}`), "H2_RETENTION_OBJECT_KEY", "private object key must be content-addressed and exposed only by hash");
    codedAssert(Date.parse(object.written_at) <= Date.parse(object.readback_at) && Date.parse(object.readback_at) <= Date.parse(value.issued_at), "H2_RETENTION_CHRONOLOGY", "private retention write/readback chronology");
  }
  const evaluatorPem = authority.private_evaluator.signing_public_key_pem;
  codedAssert(value.signer.authority_role === "private_evaluator" && value.signer.public_key_sha256 === hash(evaluatorPem), "H2_RETENTION_SIGNER", "retention receipt signer must be the authorized evaluator");
  let valid = false;
  try { valid = crypto.verify(null, retentionSigningPayload(value), evaluatorPem, Buffer.from(value.signature.signature_base64, "base64")); } catch { valid = false; }
  codedAssert(valid, "H2_RETENTION_SIGNATURE", "private retention receipt signature verification failed");
}
function syntheticPrivateRetentionReceipt(envelopeRaw: Buffer, detailRaw: Buffer, authority: J, signingKey: crypto.KeyObject): J {
  const objects = [
    ["private_expected_envelope", envelopeRaw],
    ["private_score_detail", detailRaw],
  ].map(([artifact_role, raw]) => {
    const bytes = raw as Buffer;
    const sha256 = hash(bytes);
    return { artifact_role, object_key_sha256: hash(`gate-h2-private-object:${sha256}`), version_id: hash(`memory-version:${sha256}`).slice(0, 32), etag: hash(`memory-etag:${sha256}`), sha256, bytes: bytes.length, written_at: "2026-07-15T00:00:08.700Z", readback_at: "2026-07-15T00:00:08.800Z", no_public_acl: true, readback_verified: true };
  });
  const receipt: J = { schema_version: "reviewed_metrics_private_retention_receipt_v2.0.0", candidate_id: CANDIDATE_ID, provider_capability: { provider: "synthetic_in_memory", bucket_capability_id: hash("gate-h2-synthetic-private-store") }, objects, issued_at: "2026-07-15T00:00:08.900Z", signer: { authority_role: "private_evaluator", public_key_sha256: hash(authority.private_evaluator.signing_public_key_pem) }, signature: null };
  receipt.signature = { algorithm: "ed25519", signature_base64: crypto.sign(null, retentionSigningPayload(receipt), signingKey).toString("base64") };
  return receipt;
}
function verifyReceiptSignature(receipt: J, authority: J): void {
  codedAssert(
    receipt.finalization_signature?.algorithm === "ed25519",
    "H2_FINALIZATION_SIGNATURE",
    "receipt finalization must use Ed25519",
  );
  codedAssert(
    receipt.finalization_signature.public_key_sha256 ===
      hash(authority.private_evaluator.signing_public_key_pem),
    "H2_FINALIZATION_WRONG_KEY",
    "receipt signing key does not match authority",
  );
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      receiptSigningPayload(receipt),
      authority.private_evaluator.signing_public_key_pem,
      Buffer.from(receipt.finalization_signature.signature_base64, "base64"),
    );
  } catch {
    valid = false;
  }
  codedAssert(
    valid,
    "H2_FINALIZATION_SIGNATURE",
    "evaluator signature verification failed",
  );
}
function pathInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
function evaluatorSigningKey(
  signingKey: crypto.KeyObject | string | undefined,
  authority: J,
  capability?: InternalSyntheticCapability,
): crypto.KeyObject {
  const expectedPublic = parseEd25519PublicKey(
    authority.private_evaluator.signing_public_key_pem,
  );
  if (signingKey instanceof crypto.KeyObject) {
    codedAssert(
      capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true,
      "H2_FINALIZATION_KEY_UNSAFE",
      "in-memory signing keys are synthetic-test only",
    );
    codedAssert(
      signingKey.asymmetricKeyType === "ed25519",
      "H2_FINALIZATION_KEY_TYPE",
      "signing key must be Ed25519",
    );
    const derived = crypto
      .createPublicKey(signingKey)
      .export({ type: "spki", format: "der" });
    codedAssert(
      Buffer.from(derived).equals(
        Buffer.from(expectedPublic.export({ type: "spki", format: "der" })),
      ),
      "H2_FINALIZATION_WRONG_KEY",
      "signing key does not derive the authority public key",
    );
    return signingKey;
  }
  codedAssert(
    typeof signingKey === "string",
    "H2_FINALIZATION_KEY_MISSING",
    "private finalization requires an evaluator signing-key path",
  );
  const keyPath = path.resolve(signingKey);
  let fd: number | undefined;
  let keyStat: fs.Stats;
  let raw: Buffer;
  try {
    fd = fs.openSync(keyPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    keyStat = fs.fstatSync(fd);
    codedAssert(keyStat.isFile() && keyStat.uid === process.getuid!() && keyStat.nlink === 1, "H2_FINALIZATION_KEY_UNSAFE", "signing key descriptor must be an owner-controlled regular file with one link");
    const pathStat = fs.lstatSync(keyPath);
    codedAssert(pathStat.dev === keyStat.dev && pathStat.ino === keyStat.ino, "H2_FINALIZATION_KEY_SWAP", "signing key path must still name the opened descriptor");
    raw = fs.readFileSync(fd);
    codedAssert(readExactDescriptor(fd, raw.length).equals(raw), "H2_FINALIZATION_KEY_SWAP", "signing key bytes changed while retained open");
  } catch (error) {
    if (error instanceof GateH2Error) throw error;
    throw new GateH2Error("H2_FINALIZATION_KEY_UNSAFE", "signing key could not be opened safely");
  }
  const physical = fs.realpathSync(keyPath);
  const evaluatorRoot = authority.private_evaluator.canonical_root;
  codedAssert(
    pathInside(physical, evaluatorRoot),
    "H2_FINALIZATION_KEY_ROUTE",
    "signing key must be physically inside the private evaluator canonical root",
  );
  for (const protectedRoot of [
    ROOT,
    path.join(os.homedir(), "pkm/0xPKM"),
    path.join(os.homedir(), "pkm/0xPKM_Lab"),
  ]
    .filter(fs.existsSync)
    .map((root) => fs.realpathSync(root)))
    codedAssert(
      !pathInside(physical, protectedRoot),
      "H2_FINALIZATION_KEY_TRACKED",
      "signing key cannot be inside repository or PKM trees",
    );
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", physical], {
      cwd: ROOT,
      stdio: "ignore",
    });
    throw new GateH2Error(
      "H2_FINALIZATION_KEY_TRACKED",
      "signing key cannot be tracked",
    );
  } catch (error) {
    if (error instanceof GateH2Error) throw error;
  }
  codedAssert((keyStat.mode & 0o777) === 0o600, "H2_FINALIZATION_KEY_UNSAFE", "signing key descriptor must have exact mode 0600");
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(raw!);
  } catch {
    throw new GateH2Error(
      "H2_FINALIZATION_KEY_TYPE",
      "signing key must parse as a private key",
    );
  }
  codedAssert(
    privateKey.asymmetricKeyType === "ed25519",
    "H2_FINALIZATION_KEY_TYPE",
    "signing key must be Ed25519",
  );
  const derived = crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "der" });
  codedAssert(
    Buffer.from(derived).equals(
      Buffer.from(expectedPublic.export({ type: "spki", format: "der" })),
    ),
    "H2_FINALIZATION_WRONG_KEY",
    "signing key does not derive the authority public key",
  );
  if (fd !== undefined) fs.closeSync(fd);
  return privateKey;
}
function validatePrivateScoreReceiptValue(
  value: J,
  baseDir: string,
  authority: J,
): void {
  codedAssert(
    value.finalization_signature !== undefined &&
      value.finalization_signature !== null,
    "H2_FINALIZATION_MISSING",
    "signed private finalization is required",
  );
  codedAssert(value.private_retention !== undefined && value.private_retention !== null, "H2_RETENTION_MISSING", "public finalization requires a signed private retention receipt");
  if (value.private_retention?.objects && value.private_envelope?.sha256 && value.private_detail?.sha256)
    validatePrivateRetentionReceiptValue(value.private_retention, value.private_envelope, value.private_detail, authority);
  schema("private-score-receipt.schema.v2.json", value);
  validatePrivateRetentionReceiptValue(value.private_retention, value.private_envelope, value.private_detail, authority);
  assert(
    value.pass === true && value.failure_codes.length === 0,
    "final source-search chain requires passing private score receipt",
  );
  validateCommitmentShape(value.expected_commitment);
  codedAssert(
    value.source_task_outcome.predicted_source_tasks === true &&
      value.source_task_outcome.correct_supported_source_tasks === value.pass &&
      value.source_task_outcome.no_visual_scene_support === true,
    "H2_PLACE_SOURCE_TASK_OUTCOME",
    "place outcome must derive only from the signed private source-task finalization",
  );
  const exactPins: [J, string][] = [
    [value.source_task, SOURCE_SEARCH_TASK_FILE],
    [value.public_bundle, SOURCE_SEARCH_BUNDLE_FILE],
    [value.prediction, SOURCE_SEARCH_PREDICTION_FILE],
    [value.source_search_freeze, SOURCE_SEARCH_FREEZE_FILE],
  ];
  for (const [p, expectedPath] of exactPins) {
    assert(
      p.path === expectedPath,
      `private score receipt exact path ${expectedPath}`,
    );
    verifyFilePin(p, baseDir);
  }
  const task = load(resolveEvidencePath(value.source_task.path, baseDir));
  validateSearchTaskValue(task);
  const rawBundle = fs.readFileSync(
    resolveEvidencePath(value.public_bundle.path, baseDir),
  );
  const bundle = JSON.parse(rawBundle.toString("utf8"));
  validateSourceSearchBundleValue(bundle, baseDir);
  const rawPrediction = fs.readFileSync(
    resolveEvidencePath(value.prediction.path, baseDir),
  );
  const prediction = JSON.parse(rawPrediction.toString("utf8"));
  validateSourceSearchPredictionValue(prediction, baseDir);
  const freeze = load(
    resolveEvidencePath(value.source_search_freeze.path, baseDir),
  );
  validateSourceSearchFreezeValue(
    freeze,
    rawPrediction,
    prediction,
    rawBundle,
    authority,
  );
  same(
    task.private_expected_commitment,
    value.expected_commitment,
    "private score receipt/task commitment",
  );
  same(
    task.source_search_freeze,
    value.source_search_freeze,
    "private score receipt/task freeze join",
  );
  same(
    task.authored_by,
    identityPin(authority.gold_reviewer),
    "private score receipt dossier author",
  );
  assert(
    task.authored_at === authority.source_dossier_authored_at,
    "private score receipt dossier timestamp",
  );
  assert(
    value.evaluator_authority.authority_pin.path ===
      "execution-authorization-v2.json",
    "private score evaluator exact authority path",
  );
  verifyFilePin(value.evaluator_authority.authority_pin, baseDir);
  same(
    identityPin(value.evaluator_authority),
    identityPin(authority.private_evaluator),
    "private score evaluator authority identity",
  );
  before(
    freeze.frozen_at,
    task.authored_at,
    "source-search freeze before dossier",
  );
  before(
    authority.private_envelope_sealed_at,
    value.scored_at,
    "private envelope seal before private score",
  );
  verifyReceiptSignature(value, authority);
  const publicReceipt = canon(value);
  assert(
    !/(?:salt_hex|\"expected\"\s*:)/i.test(publicReceipt),
    "public private-score receipt leaks private expected content or salt",
  );
}
function scorePrivateSourceSearch(
  baseDir: string,
  envelopeFile: string,
  detailOutput: string,
  receiptOutput: string,
  injected?: J,
  capability?: InternalSyntheticCapability,
  scoredAt?: string,
  signingKey?: crypto.KeyObject | string,
  hooks?: FinalizationHooks,
  retentionReceiptFile?: string,
): J {
  assert(
    injected === undefined ||
      capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true,
    "internal private scorer authority capability required",
  );
  const authority = executionAuthority(
    injected,
    capability,
    gitExecutionAuthorityEvidence,
    scoredAt ? () => new Date(scoredAt) : undefined,
  );
  const authorityFile = path.join(baseDir, "execution-authorization-v2.json");
  const taskFile = path.join(baseDir, SOURCE_SEARCH_TASK_FILE);
  const bundleFile = path.join(baseDir, SOURCE_SEARCH_BUNDLE_FILE);
  const predictionFile = path.join(baseDir, SOURCE_SEARCH_PREDICTION_FILE);
  const freezeFile = path.join(baseDir, SOURCE_SEARCH_FREEZE_FILE);
  assert(
    path.basename(envelopeFile) === "private-expected-envelope-v2.json" &&
      path.basename(detailOutput) === "private-score-detail-v2.json" &&
      path.basename(receiptOutput) === PRIVATE_SCORE_RECEIPT_FILE,
    "private scorer exact artifact filenames",
  );
  const evaluatorRoot = authority.private_evaluator.canonical_root;
  if (capability?.[INTERNAL_SYNTHETIC_CAPABILITY] !== true)
    for (const route of [baseDir, envelopeFile, detailOutput, receiptOutput])
      codedAssert(
        pathInside(
          nearestExistingPhysicalRoot(path.resolve(route)).canonicalRoot,
          evaluatorRoot,
        ),
        "H2_FINALIZATION_ROUTE",
        "private scorer inputs and outputs must stay inside the private evaluator canonical root",
      );
  const snapshots = [
    authorityFile,
    taskFile,
    bundleFile,
    predictionFile,
    freezeFile,
    envelopeFile,
  ].map((file) => readJsonSnapshot(file, "H2_FINALIZATION_INPUT"));
  const [
    authoritySnapshot,
    taskSnapshot,
    bundleSnapshot,
    predictionSnapshot,
    freezeSnapshot,
    envelopeSnapshot,
  ] = snapshots;
  const task = taskSnapshot.value;
  const bundle = bundleSnapshot.value;
  const prediction = predictionSnapshot.value;
  const freeze = freezeSnapshot.value;
  const envelope = envelopeSnapshot.value;
  same(
    authoritySnapshot.value,
    authority,
    "private scorer unified authority copy",
  );
  validateSearchTaskValue(task);
  validateSourceSearchBundleValue(bundle, baseDir);
  validateSourceSearchPredictionValue(prediction, baseDir, bundleSnapshot);
  assert(
    prediction.status === "completed",
    "private scorer requires completed source-search prediction",
  );
  validateSourceSearchFreezeValue(
    freeze,
    predictionSnapshot.raw,
    prediction,
    bundleSnapshot.raw,
    authority,
  );
  validatePrivateExpectedEnvelopeValue(envelope, capability, authority);
  same(
    task.private_expected_commitment,
    envelope.commitment,
    "private scorer task commitment",
  );
  same(
    task.source_search_freeze,
    snapshotPin(freezeSnapshot, SOURCE_SEARCH_FREEZE_FILE),
    "private scorer task/freeze pin",
  );
  same(
    task.authored_by,
    identityPin(authority.gold_reviewer),
    "private scorer dossier author",
  );
  same(
    envelope.authored_by,
    identityPin(authority.gold_reviewer),
    "private scorer envelope author",
  );
  assert(
    task.authored_at === authority.source_dossier_authored_at &&
      envelope.authored_at === authority.private_envelope_sealed_at,
    "private scorer post-freeze authority timestamps",
  );
  before(
    freeze.frozen_at,
    task.authored_at,
    "source freeze before dossier authoring",
  );
  before(
    task.authored_at,
    envelope.authored_at,
    "dossier before envelope seal",
  );
  hooks?.afterInputs?.();
  const fieldResults = Object.fromEntries(
    ISSUE_97_OUTPUT_FIELDS.map((field) => [
      field,
      normalizeSourceSearchField(field, prediction.answer[field]) ===
        normalizeSourceSearchField(field, envelope.expected[field]),
    ]),
  );
  fieldResults.bounded_paraphrase = true;
  fieldResults.no_pixel_identity = true;
  fieldResults.no_private_leakage = true;
  const failures = Object.entries(fieldResults)
    .filter(([, passed]) => !passed)
    .map(([field]) => `MISMATCH_${field.toUpperCase()}`);
  const pass = failures.length === 0;
  const actualScoredAt = scoredAt ?? new Date().toISOString();
  before(
    envelope.authored_at,
    actualScoredAt,
    "private envelope seal before private score current UTC",
  );
  const detail = {
    schema_version: "reviewed_metrics_private_score_detail_v2.0.0",
    status: "completed_private",
    candidate_id: CANDIDATE_ID,
    task_id: ISSUE_97_TASK_ID,
    evaluator: identityPin(authority.private_evaluator),
    inputs: {
      source_task: snapshotPin(taskSnapshot, SOURCE_SEARCH_TASK_FILE),
      public_bundle: snapshotPin(bundleSnapshot, SOURCE_SEARCH_BUNDLE_FILE),
      prediction: snapshotPin(
        predictionSnapshot,
        SOURCE_SEARCH_PREDICTION_FILE,
      ),
      source_search_freeze: snapshotPin(
        freezeSnapshot,
        SOURCE_SEARCH_FREEZE_FILE,
      ),
      private_envelope: snapshotPin(
        envelopeSnapshot,
        "private-expected-envelope-v2.json",
      ),
    },
    commitment_opening: {
      commitment: envelope.commitment,
      recomputed_value: recomputeSourceSearchCommitment(envelope),
      matched: true,
    },
    field_results: fieldResults,
    pass,
    failure_codes: failures,
    scored_at: actualScoredAt,
  };
  schema("private-score-detail.schema.v2.json", detail);
  const canonicalDetailRaw = Buffer.from(pretty(detail), "utf8");
  const detailPath = path.resolve(detailOutput);
  if (!fs.existsSync(detailPath)) {
    physicalPathSafety(detailPath);
    let detailFd: number | undefined;
    try {
      detailFd = fs.openSync(detailPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
      fs.writeFileSync(detailFd, canonicalDetailRaw);
      fs.fsyncSync(detailFd);
    } finally { if (detailFd !== undefined) fs.closeSync(detailFd); }
    fsyncDirectory(path.dirname(detailPath));
  }
  const writtenDetailStat = fs.lstatSync(detailPath);
  hooks?.afterDetailWrite?.();
  const detailSnapshot = readJsonSnapshot(detailPath, "H2_FINALIZATION_DETAIL", true, canonicalDetailRaw);
  codedAssert(
    detailSnapshot.stat.dev === writtenDetailStat.dev &&
      detailSnapshot.stat.ino === writtenDetailStat.ino &&
      detailSnapshot.stat.size === writtenDetailStat.size &&
      detailSnapshot.stat.mtimeMs === writtenDetailStat.mtimeMs,
    "H2_FINALIZATION_PATH_SUBSTITUTION",
    "generated private detail path was substituted before readback",
  );
  schema("private-score-detail.schema.v2.json", detailSnapshot.value);
  same(detailSnapshot.value, detail, "private score detail semantic readback");
  codedAssert(
    detailSnapshot.raw.equals(canonicalDetailRaw),
    "H2_FINALIZATION_DETAIL_BYTES",
    "private score detail exact canonical readback mismatch",
  );
  const finalizationKey = evaluatorSigningKey(
    signingKey ?? (capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true ? SYNTHETIC_EVALUATOR_KEYS.privateKey : undefined),
    authority,
    capability,
  );
  let retentionPath = retentionReceiptFile ? path.resolve(retentionReceiptFile) : path.join(path.dirname(detailPath), "private-retention-receipt-v2.json");
  if (capability?.[INTERNAL_SYNTHETIC_CAPABILITY] === true && !fs.existsSync(retentionPath)) {
    const retention = syntheticPrivateRetentionReceipt(envelopeSnapshot.raw, detailSnapshot.raw, authority, finalizationKey);
    const raw = Buffer.from(pretty(retention), "utf8");
    const fd = fs.openSync(retentionPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDirectory(path.dirname(retentionPath));
  }
  if (!fs.existsSync(retentionPath)) {
    [...snapshots, detailSnapshot].forEach(closeSnapshot);
    return { status: "private_detail_prepared_retention_required", detail_sha256: hash(detailSnapshot.raw), detail_bytes: detailSnapshot.raw.length, retention_ingestion_network_write_performed: false };
  }
  const retentionSnapshot = readJsonSnapshot(retentionPath, "H2_RETENTION_INPUT");
  validatePrivateRetentionReceiptValue(retentionSnapshot.value, { sha256: hash(envelopeSnapshot.raw), bytes: envelopeSnapshot.raw.length }, { sha256: hash(detailSnapshot.raw), bytes: detailSnapshot.raw.length }, authority);
  const receipt: J = {
    schema_version: "reviewed_metrics_private_score_receipt_v2.0.0",
    status: "completed_public_receipt",
    candidate_id: CANDIDATE_ID,
    task_id: ISSUE_97_TASK_ID,
    source_task: snapshotPin(taskSnapshot, SOURCE_SEARCH_TASK_FILE),
    public_bundle: snapshotPin(bundleSnapshot, SOURCE_SEARCH_BUNDLE_FILE),
    prediction: snapshotPin(predictionSnapshot, SOURCE_SEARCH_PREDICTION_FILE),
    source_search_freeze: snapshotPin(
      freezeSnapshot,
      SOURCE_SEARCH_FREEZE_FILE,
    ),
    private_envelope: {
      path: "private-expected-envelope-v2.json",
      sha256: hash(envelopeSnapshot.raw),
      bytes: envelopeSnapshot.raw.length,
    },
    private_detail: {
      sha256: hash(detailSnapshot.raw),
      bytes: detailSnapshot.raw.length,
    },
    private_retention: retentionSnapshot.value,
    source_task_outcome: {
      universe: [ISSUE_97_TASK_ID],
      predicted_source_tasks: true,
      correct_supported_source_tasks: pass,
      no_visual_scene_support: true,
    },
    expected_commitment: envelope.commitment,
    evaluator_authority: {
      ...identityPin(authority.private_evaluator),
      authority_pin: snapshotPin(
        authoritySnapshot,
        "execution-authorization-v2.json",
      ),
    },
    pass,
    failure_codes: failures,
    scored_at: actualScoredAt,
    privacy: {
      plaintext_expected_exposed: false,
      salt_exposed: false,
      private_content_exposed: false,
    },
    finalization_signature: null,
  };
  hooks?.beforeSign?.();
  [...snapshots, detailSnapshot, retentionSnapshot].forEach(assertSnapshotPathUnchanged);
  receipt.finalization_signature = {
    algorithm: "ed25519",
    public_key_sha256: hash(authority.private_evaluator.signing_public_key_pem),
    signature_base64: crypto
      .sign(null, receiptSigningPayload(receipt), finalizationKey)
      .toString("base64"),
  };
  schema("private-score-receipt.schema.v2.json", receipt);
  const receiptPath = physicalPathSafety(receiptOutput);
  const receiptRaw = Buffer.from(pretty(receipt), "utf8");
  fs.writeFileSync(receiptPath, receiptRaw, { flag: "wx", mode: 0o644 });
  fsyncDirectory(path.dirname(receiptPath));
  if (pass) validatePrivateScoreReceiptValue(receipt, baseDir, authority);
  [...snapshots, detailSnapshot, retentionSnapshot].forEach(closeSnapshot);
  return {
    status: pass
      ? "private_source_search_score_passed"
      : "private_source_search_score_failed",
    failure_codes: failures,
    detail_sha256: hash(detailSnapshot.raw),
    detail_bytes: detailSnapshot.raw.length,
    receipt_sha256: hash(receiptRaw),
  };
}
function validateResultsValue(
  value: J,
  baseDir = ROOT,
  suppliedAuthority?: J,
): void {
  schema("reviewed-metrics.schema.v2.json", value);
  if (value.status === "synthetic_test_only") {
    assert(
      value.evidence === null &&
        value.scoring === null &&
        value.metrics.length === 0 &&
        value.criterion_matrix.required_rows === 0 &&
        value.criterion_matrix.satisfied_rows === 0,
      "synthetic result must remain empty",
    );
    return;
  }
  assert(
    suppliedAuthority,
    "completed results require committed execution authority",
  );
  const authority = exactPinnedValue(
    value.evidence.execution_authorization,
    "execution-authorization-v2.json",
    "execution-authorization.schema.v2.json",
    baseDir,
  );
  validateAuthorityValue(authority);
  same(authority, suppliedAuthority, "results supplied authority");
  const predictionPath = resolveEvidencePath(
    value.evidence.prediction.path,
    baseDir,
  );
  assert(
    value.evidence.prediction.path === "prediction-output-v2.json",
    "exact evidence path required: prediction-output-v2.json",
  );
  verifyFilePin(value.evidence.prediction, baseDir);
  const rawPrediction = fs.readFileSync(predictionPath);
  const prediction = JSON.parse(rawPrediction.toString("utf8"));
  validatePredictionValue(prediction);
  assert(
    prediction.status === "completed",
    "completed prediction evidence required",
  );
  const freeze = exactPinnedValue(
    value.evidence.prediction_freeze,
    "prediction-freeze-v2.json",
    "prediction-freeze.schema.v2.json",
    baseDir,
  );
  const gold = exactPinnedValue(
    value.evidence.gold_review,
    "gold-review-v2.json",
    "gold-review-authority.schema.v2.json",
    baseDir,
  );
  assert(gold.status === "completed", "completed gold evidence required");
  validateFreezeValue(freeze, rawPrediction, prediction, authority);
  validateIndependentChronology(prediction, gold, freeze, authority);
  const task = exactPinnedValue(
    value.evidence.source_task,
    SOURCE_SEARCH_TASK_FILE,
    "search-task.schema.v2.json",
    baseDir,
  );
  validateSearchTaskValue(task);
  validateGoldValue(gold, task);
  const privateReceipt = exactPinnedValue(
    value.evidence.private_score_receipt,
    PRIVATE_SCORE_RECEIPT_FILE,
    "private-score-receipt.schema.v2.json",
    baseDir,
  );
  validatePrivateScoreReceiptValue(privateReceipt, baseDir, authority);
  same(
    privateReceipt.source_task,
    value.evidence.source_task,
    "results exact accepted source task/private receipt join",
  );
  before(
    gold.reviewer.reviewed_at,
    value.scoring.scored_at,
    "gold before deterministic score",
  );
  codedAssert(
    Date.parse(privateReceipt.scored_at) < Date.parse(value.scoring.scored_at),
    "H2_RESULTS_BEFORE_PRIVATE_SCORE",
    "private score must strictly precede final metrics",
  );
  assert(
    value.scoring.algorithm ===
      "reviewed-metrics-v2-deterministic-derivation-v1",
    "scoring algorithm binding",
  );
  const derived = deriveMetrics(
    prediction,
    gold,
    privateReceipt,
    authority,
    task,
  );
  same(value.metrics, derived, "completed metrics deterministic derivation");
  const entityPredicted = prediction.outputs
    .filter((row: J) => SCENE_OPAQUE.includes(row.opaque_id))
    .reduce(
      (sum: number, row: J) =>
        sum + new Set(row.entities.map(normalizedMentionKey)).size,
      0,
    );
  codedAssert(
    entityPredicted > 0,
    "H2_STOP_ZERO_ENTITY_PREDICTIONS",
    "zero valid unique entity prediction support blocks this candidate version",
  );
  const complete = exactMetricCompletion(derived);
  same(
    value.criterion_matrix,
    {
      required_rows: FINAL_CRITERION_IDS.length,
      satisfied_rows: complete
        ? FINAL_CRITERION_IDS.length
        : FINAL_CRITERION_IDS.length - 1,
    },
    "result criterion derivation",
  );
}
function exactMetricCompletion(metrics: J[]): boolean {
  exactSet(
    metrics.map((metric) => metric.metric_id),
    METRIC_IDS,
    "completion exact metric universe",
  );
  return metrics.every(
    (metric) =>
      metric.status === "observed" ||
      metric.status === "observed_undefined_zero_support" ||
      metric.status === "prerequisite_not_applicable" ||
      metric.status === "unavailable_no_real_usage_receipt",
  );
}
function independentSyntheticMetricExpectations(): Map<string, J> {
  const expected = new Map<string, J>();
  const visual = ["prediction-output-v2.json", "gold-review-v2.json", "input-authority-v2.json"];
  const universe = (id: string): string[] => id.startsWith("ocr_") ? OCR_OPAQUE : id.startsWith("entity_") ? SCENE_OPAQUE : id.startsWith("place_link_") ? [ISSUE_97_TASK_ID] : id.startsWith("image_mode_") || id === "mask_iou" ? IMAGE_OPAQUE : id.startsWith("aerial_") ? AERIAL_OPAQUE : id.startsWith("abstention_") ? ABSTENTION_OPAQUE : id === "geolocation_distance" ? FIXED_OPAQUE_IDS : ["visual_prediction_session", "source_search_prediction_session"];
  const row = (id: string, raw: J, numerator: number | null, denominator: number, provenance: J, status = "observed", reason: string | null = null, limitations: string[] = [], included?: string[], excluded: J[] = []): void => {
    if (denominator === 0 && status === "observed") { numerator = null; status = "observed_undefined_zero_support"; reason = "zero support in the fixed universe; denominator was not replaced or shrunk"; }
    const fixed = universe(id); const used = included ?? fixed;
    expected.set(id, { metric_id: id, fixed_universe_ids: fixed, included_ids: used, excluded, raw_counts: raw, numerator, denominator, status, value: numerator === null ? null : numerator / denominator, undefined_or_na_reason: numerator === null ? reason : null, limitations, support: { fixed_universe: fixed.length, denominator, no_denominator_shrinkage: true }, provenance });
  };
  row("ocr_normalized_exact_match", { exact_matches: 2, support: 2 }, 2, 2, visual); row("ocr_cer", { character_edits: 0, gold_characters: 32 }, 0, 32, visual); row("ocr_wer", { word_edits: 0, gold_words: 6 }, 0, 6, visual);
  const entity = { tp: 6, fp: 0, fn: 0, iou_threshold: 0.5 }; row("entity_precision", entity, 6, 6, visual); row("entity_recall", entity, 6, 6, visual); row("entity_false_identity_rate", { false_identities: 0, linked_identity_predictions: 0 }, 0, 0, visual);
  const place = { correct_supported_links: 1, predicted_links: 1, reviewed_supported_opportunities: 1, covered_opportunities: 1 }; const placeProvenance = [SOURCE_SEARCH_PREDICTION_FILE, SOURCE_SEARCH_FREEZE_FILE, PRIVATE_SCORE_RECEIPT_FILE, SOURCE_SEARCH_TASK_FILE]; row("place_link_precision", place, 1, 1, placeProvenance); row("place_link_coverage", place, 1, 1, placeProvenance);
  const confusion: J = {}; for (const predicted of IMAGE_MODE_CLASSES) for (const actual of IMAGE_MODE_CLASSES) confusion[`${actual}__predicted_${predicted}`] = actual === predicted ? (actual === "ground_street" ? 8 : 7) : 0;
  for (const className of IMAGE_MODE_CLASSES) { const support = className === "ground_street" ? 8 : 7; const raw = { tp: support, fp: 0, fn: 0, gold_support: support, predicted_support: support }; row(`image_mode_${className}_precision`, raw, support, support, visual); row(`image_mode_${className}_recall`, raw, support, support, visual); row(`image_mode_${className}_f1`, raw, 2 * support, 2 * support, visual); }
  row("image_mode_macro_f1", { ...confusion, classes: 5, image_support: 36 }, 5, 5, visual);
  const aerialIncluded = AERIAL_OPAQUE.slice(0, 12); const aerialExcluded = AERIAL_OPAQUE.slice(12).map((opaque_id) => ({ opaque_id, reason: "independent gold review found the whole-image aerial label prerequisite unreviewable", fixed_before_scoring: true }));
  row("aerial_exact_set_accuracy", { exact_sets: 12, fixed_images: 16, reviewable_images: 12, excluded_unreviewable: 4 }, 12, 12, visual, "observed", null, [], aerialIncluded, aerialExcluded); row("aerial_jaccard", { jaccard_sum: 12, fixed_images: 16, reviewable_images: 12, excluded_unreviewable: 4 }, 12, 12, visual, "observed", null, [], aerialIncluded, aerialExcluded);
  for (const label of AERIAL_LABELS) { const active = label === "mixed_urban"; const raw = { tp: active ? 12 : 0, fp: 0, fn: 0, reviewable_images: 12, excluded_unreviewable: 4 }; for (const suffix of ["precision", "recall", "f1"]) row(`aerial_${label}_${suffix}`, raw, active ? (suffix === "f1" ? 24 : 12) : 0, active ? (suffix === "f1" ? 24 : 12) : 0, visual, "observed", null, [], aerialIncluded, aerialExcluded); }
  const aerialRaw = { tp: 12, fp: 0, fn: 0, reviewable_images: 12, excluded_unreviewable: 4 }; row("aerial_micro_precision", aerialRaw, 12, 12, visual, "observed", null, [], aerialIncluded, aerialExcluded); row("aerial_micro_recall", aerialRaw, 12, 12, visual, "observed", null, [], aerialIncluded, aerialExcluded); row("aerial_micro_f1", aerialRaw, 24, 24, visual, "observed", null, [], aerialIncluded, aerialExcluded);
  const abstention = { abstained: 9, non_abstained: 9, unanswerable: 9, appropriate_abstentions: 9, unsafe_non_abstentions: 0, selective_errors: 0 }; row("abstention_coverage", abstention, 9, 18, visual); row("abstention_rate", abstention, 9, 18, visual); row("appropriate_abstention_recall", abstention, 9, 9, visual); row("unsafe_non_abstention_rate", abstention, 0, 9, visual); row("abstention_selective_error", abstention, 0, 9, visual); row("abstention_decision_accuracy", abstention, 18, 18, visual);
  const exclusions = (ids: string[], reason: string) => ids.map((opaque_id) => ({ opaque_id, reason, fixed_before_scoring: true })); row("mask_iou", { reviewed_masks: 0, excluded_missing_prerequisite: 36 }, null, 0, visual, "prerequisite_not_applicable", "no real reviewed masks exist; masks must not be fabricated", ["Prerequisite evidence absent by design."], [], exclusions(IMAGE_OPAQUE, "no reviewed mask prerequisite exists")); row("geolocation_distance", { verified_coordinates: 0, excluded_missing_prerequisite: 44 }, null, 0, visual, "prerequisite_not_applicable", "no real verified coordinates exist; coordinates must not be fabricated", ["Prerequisite evidence absent by design."], [], exclusions(FIXED_OPAQUE_IDS, "no verified coordinate prerequisite exists"));
  row("operation_timing_seconds", { visual_prediction_seconds: 1, source_search_prediction_seconds: 1 }, 2, 1, ["prediction-output-v2.json", "execution-authorization-v2.json"]); row("model_tool_cost", { real_usage_receipts: 0 }, null, 0, ["execution-authorization-v2.json"], "unavailable_no_real_usage_receipt", "model/tool cost is unavailable because no real usage receipt is present", ["No estimate or authored cost is accepted."]);
  codedAssert(expected.size === 63, "H2_TEST_METRIC_FIXTURE", `independent full-row fixture must contain 63 rows, found ${expected.size}`); return expected;
}
function resolveEvidencePath(shownPath: string, baseDir = ROOT): string {
  assert(
    !path.isAbsolute(shownPath) && !shownPath.includes(".."),
    "evidence path must be safe and relative",
  );
  return shownPath.startsWith("docs/")
    ? path.join(ROOT, shownPath)
    : path.join(baseDir, shownPath);
}
function verifyFilePin(pinValue: J, baseDir = ROOT): void {
  const file = resolveEvidencePath(pinValue.path, baseDir);
  assert(
    fs.existsSync(file) && fs.statSync(file).isFile(),
    `pinned evidence file missing: ${pinValue.path}`,
  );
  const actual = pin(file, pinValue.path);
  assert(
    actual.sha256 === pinValue.sha256 && actual.bytes === pinValue.bytes,
    `pinned evidence bytes drift: ${pinValue.path}`,
  );
}
const FINAL_MATRIX_REQUIREMENTS: Record<
  string,
  { results: string[]; roles: string[] }
> = {
  "96.fixed_memberships": {
    results: ["input-authority-v2"],
    roles: ["input_authority"],
  },
  "96.controls_recovered": {
    results: ["input-authority-v2"],
    roles: ["input_authority"],
  },
  "96.blind_prediction": {
    results: ["prediction-output-v2", "prediction-freeze-v2"],
    roles: [
      "execution_authorization",
      "prediction_output",
      "prediction_freeze",
    ],
  },
  "96.independent_gold": {
    results: ["gold-review-v2"],
    roles: ["gold_review"],
  },
  "96.reviewed_metrics": {
    results: ["reviewed-metrics-v2"],
    roles: ["reviewed_metrics", "private_score_receipt"],
  },
  "96.authority_chronology": {
    results: ["authority-chronology-v2"],
    roles: [
      "execution_authorization",
      "prediction_output",
      "prediction_freeze",
      "source_search_prediction",
      "source_search_freeze",
      "gold_review",
      "private_score_receipt",
      "reviewed_metrics",
    ],
  },
  "96.publication": {
    results: ["publication-readiness-v2"],
    roles: [
      "search_task",
      "source_search_bundle",
      "source_search_prediction",
      "source_search_freeze",
      "private_score_receipt",
      "task_review",
      "reviewed_metrics",
    ],
  },
  "96.issue_92_close": {
    results: ["publication-descriptor-v2"],
    roles: [
      "task_review",
      "prediction_freeze",
      "source_search_freeze",
      "private_score_receipt",
      "reviewed_metrics",
    ],
  },
  "96.issue_69_close": {
    results: ["publication-descriptor-v2"],
    roles: [
      "task_review",
      "prediction_freeze",
      "source_search_freeze",
      "private_score_receipt",
      "reviewed_metrics",
    ],
  },
};
const FINAL_EVIDENCE_PATHS: Record<string, string> = {
  input_authority:
    "docs/dataset-factory/fixtures/reviewed-metrics-v2/input-authority-v2.json",
  execution_authorization: "execution-authorization-v2.json",
  prediction_output: "prediction-output-v2.json",
  prediction_freeze: "prediction-freeze-v2.json",
  source_search_bundle: SOURCE_SEARCH_BUNDLE_FILE,
  source_search_prediction: SOURCE_SEARCH_PREDICTION_FILE,
  source_search_freeze: SOURCE_SEARCH_FREEZE_FILE,
  private_score_receipt: PRIVATE_SCORE_RECEIPT_FILE,
  gold_review: "gold-review-v2.json",
  reviewed_metrics: "reviewed-metrics-v2.json",
  search_task: SOURCE_SEARCH_TASK_FILE,
  task_review: "search-task-review-v2.json",
};
function canonicalCommittedHeadAuthorityBytes(): Buffer {
  const head = execFileSync(
    "git",
    ["cat-file", "blob", `HEAD:${CANONICAL_AUTHORITY_REL}`],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  assert(
    head.length === TRACKED_AUTHORITY_BYTES &&
      hash(head) === TRACKED_AUTHORITY_SHA256,
    "canonical input authority committed HEAD blob exact bytes drift",
  );
  const worktree = fs.readFileSync(CANONICAL_AUTHORITY);
  assert(
    worktree.equals(head),
    "canonical input authority worktree bytes must equal the committed HEAD blob",
  );
  const value = JSON.parse(head.toString("utf8"));
  validateInputAuthorityValue(value);
  return head;
}
function validateGateESourceProvenance(provenance: J): {
  expected: J;
  disposition: J;
  representation: J;
  capture: J;
} {
  assert(
    provenance.internal_task_id === ISSUE_97_TASK_ID,
    "issue #97 opaque task binding",
  );
  for (const [role, expectedPath] of Object.entries(GATE_E_PATHS)) {
    const evidence = provenance[role];
    assert(
      evidence.path === expectedPath,
      `issue #97 exact Gate E path ${role}`,
    );
    verifyFilePin(evidence);
  }
  const promotion = load(resolveEvidencePath(provenance.promotion_ledger.path));
  assert(
    promotion.authority_receipt_sha256 === provenance.review_receipt.sha256,
    "issue #97 Gate E promotion/review receipt join",
  );
  const promoted = promotion.rows.filter(
    (row: J) =>
      row.disposition === "accepted" && row.promotion_eligible === true,
  );
  assert(
    promoted.length === 1,
    "issue #97 requires exactly one accepted Gate E promotion",
  );
  const receipt = load(resolveEvidencePath(provenance.review_receipt.path));
  const disposition = receipt.dispositions.find(
    (row: J) => row.claim_id === promoted[0].claim_id,
  );
  assert(
    disposition?.disposition === "accepted" &&
      disposition.complete_claim_wording_supported === true &&
      disposition.supported_source_representation_ids.length === 1,
    "issue #97 requires independently accepted Gate E receipt",
  );
  const representations = load(
    resolveEvidencePath(provenance.source_representation.path),
  );
  const representation = representations.representations.find(
    (row: J) =>
      row.representation_id ===
      disposition.supported_source_representation_ids[0],
  );
  assert(
    representation?.body_sha256 &&
      representation.body_bytes > 0 &&
      disposition.supported_proposition_ids.every((id: string) =>
        representation.propositions.some((p: J) => p.proposition_id === id),
      ),
    "issue #97 accepted source representation join",
  );
  const acquisition = load(
    resolveEvidencePath(provenance.source_acquisition.path),
  );
  const capture = acquisition.captures.find(
    (row: J) =>
      row.source_family_id === representation.source_family_id &&
      row.body_sha256 === representation.body_sha256,
  );
  const official = new URL(capture?.effective_url ?? "https://invalid.example");
  assert(
    capture?.status === 200 &&
      official.origin === RPCQ_ORIGIN &&
      official.pathname.startsWith("/rpcq/") &&
      capture.rights_mode === "private_review_snapshot",
    "issue #97 official Quebec/RPCQ acquisition provenance",
  );
  assert(
    provenance.accepted_claim_id === disposition.claim_id &&
      provenance.source_representation_id ===
        representation.representation_id &&
      provenance.source_id === representation.source_id &&
      provenance.source_family_id === representation.source_family_id &&
      provenance.official_source_url === capture.effective_url,
    "issue #97 dossier values must dynamically join accepted Gate E artifacts",
  );
  const passage = representation.propositions
    .map((item: J) => item.passage)
    .sort((a: string, b: string) => b.length - a.length)[0];
  const year = passage.match(/\b((?:18|19|20)[0-9]{2})\b/u)?.[1];
  const address = passage.match(
    /\b([0-9]{1,6})\s*,?\s*((?:rue|avenue|boulevard|chemin)\s+[^,]+),?\s+à\s+([^,.;]+)/iu,
  );
  assert(
    year && address,
    "accepted Gate E representation must expose normalized year/address/place fields",
  );
  return {
    expected: {
      year,
      civic_number: address[1],
      street: address[2].trim(),
      place: address[3].trim(),
      official_url: capture.effective_url,
      source_id: representation.source_id,
      source_representation_id: representation.representation_id,
    },
    disposition,
    representation,
    capture,
  };
}
function validateGoldPlaceSupport(gold: J, sourceTask: J): void {
  validateGateESourceProvenance(sourceTask.internal_provenance);
  codedAssert(
    gold.reviews.every((row: J) => row.place_opportunities.length === 0),
    "H2_PLACE_VISUAL_ATTACHMENT",
    "Gate E source support cannot be attached to any visual row or mention",
  );
}
function validateSearchTaskValue(value: J, _legacyGold?: J): void {
  schema("search-task.schema.v2.json", value);
  assert(
    value.status === "published" &&
      value.review_state === "accepted" &&
      value.authored_by &&
      value.authored_at &&
      value.source_search_freeze &&
      value.internal_provenance &&
      value.public_projection &&
      value.source_task_dossier &&
      value.private_expected_commitment &&
      value.rights_policy &&
      value.component &&
      value.split,
    "completed matrix/task review requires an authorized post-freeze search dossier",
  );
  const derived = validateGateESourceProvenance(value.internal_provenance);
  same(
    value.public_projection.official_origins,
    [RPCQ_ORIGIN],
    "issue #97 exact official RPCQ origin",
  );
  same(
    value.public_projection.output_fields,
    ISSUE_97_OUTPUT_FIELDS,
    "issue #97 exact place output fields",
  );
  assert(
    value.public_projection.scoring_version ===
      "gate-h-v2-official-source-search-v1",
    "issue #97 exact scoring version",
  );
  const dossier = value.source_task_dossier;
  assert(
    dossier.task_gate_id === ISSUE_97_TASK_ID &&
      dossier.accepted_claim_id === derived.disposition.claim_id &&
      dossier.source_representation_id ===
        derived.representation.representation_id &&
      dossier.source_id === derived.representation.source_id &&
      dossier.source_family_id === derived.representation.source_family_id &&
      dossier.official_source_origin === RPCQ_ORIGIN &&
      dossier.no_pixel_identity_claim === true,
    "issue #97 source-task dossier must dynamically join accepted Gate E authority",
  );
  validateCommitmentShape(value.private_expected_commitment);
  const publicText = canon({
    public_projection: value.public_projection,
    rights_policy: value.rights_policy,
  });
  assert(
    !/(?:salt_hex|private_expected|accepted_claim|representation_id|source_id)/i.test(
      publicText,
    ),
    "public task duplicates private or internal expected fields",
  );
}
function validateMatrixValue(
  value: J,
  baseDir = ROOT,
  suppliedAuthority?: J,
): void {
  schema("final-criterion-matrix.schema.v2.json", value);
  exactSet(
    value.rows.map((x: J) => x.criterion_id),
    FINAL_CRITERION_IDS,
    "criterion row IDs",
  );
  if (value.status === "candidate_open") {
    assert(
      !value.issue_92_complete && !value.issue_69_complete,
      "open matrix cannot complete issues",
    );
    return;
  }
  const byRole = new Map<string, J>();
  for (const row of value.rows) {
    const required = FINAL_MATRIX_REQUIREMENTS[row.criterion_id];
    assert(
      row.required && row.verdict === "satisfied",
      `final criterion not satisfied: ${row.criterion_id}`,
    );
    same(
      row.result_ids,
      required.results,
      `final result IDs ${row.criterion_id}`,
    );
    exactSet(
      row.evidence.map((x: J) => x.role),
      required.roles,
      `final evidence roles ${row.criterion_id}`,
    );
    for (const evidence of row.evidence) {
      assert(
        evidence.path === FINAL_EVIDENCE_PATHS[evidence.role],
        `final exact evidence path ${evidence.role}`,
      );
      verifyFilePin(evidence, baseDir);
      const prior = byRole.get(evidence.role);
      if (prior)
        same(evidence, prior, `final repeated evidence pin ${evidence.role}`);
      else byRole.set(evidence.role, evidence);
    }
  }
  const matrixAuthorityPin = byRole.get("input_authority");
  const canonicalAuthorityRaw = canonicalCommittedHeadAuthorityBytes();
  assert(
    matrixAuthorityPin.sha256 === TRACKED_AUTHORITY_SHA256 &&
      matrixAuthorityPin.bytes === TRACKED_AUTHORITY_BYTES,
    "final matrix canonical input authority committed-file pin",
  );
  const matrixAuthorityRaw = fs.readFileSync(
    resolveEvidencePath(matrixAuthorityPin.path, baseDir),
  );
  assert(
    matrixAuthorityRaw.equals(canonicalAuthorityRaw),
    "final matrix input authority must be canonical committed HEAD bytes",
  );
  validateInputAuthorityValue(JSON.parse(matrixAuthorityRaw.toString("utf8")));
  assert(
    suppliedAuthority,
    "final matrix requires committed execution authority",
  );
  const authority = load(
    resolveEvidencePath(byRole.get("execution_authorization").path, baseDir),
  );
  validateAuthorityValue(authority);
  same(authority, suppliedAuthority, "matrix authority");
  const predictionRaw = fs.readFileSync(
    resolveEvidencePath(byRole.get("prediction_output").path, baseDir),
  );
  const prediction = JSON.parse(predictionRaw.toString("utf8"));
  validatePredictionValue(prediction);
  assert(prediction.status === "completed", "matrix completed prediction");
  const freeze = load(
    resolveEvidencePath(byRole.get("prediction_freeze").path, baseDir),
  );
  const gold = load(
    resolveEvidencePath(byRole.get("gold_review").path, baseDir),
  );
  validateGoldValue(gold);
  assert(gold.status === "completed", "matrix completed gold");
  validateFreezeValue(freeze, predictionRaw, prediction, authority);
  validateIndependentChronology(prediction, gold, freeze, authority);
  const task = load(
    resolveEvidencePath(byRole.get("search_task").path, baseDir),
  );
  validateSearchTaskValue(task);
  const sourceRaw = fs.readFileSync(
    resolveEvidencePath(byRole.get("source_search_prediction").path, baseDir),
  );
  const sourcePrediction = JSON.parse(sourceRaw.toString("utf8"));
  validateSourceSearchPredictionValue(sourcePrediction, baseDir);
  const sourceBundleRaw = fs.readFileSync(
    resolveEvidencePath(byRole.get("source_search_bundle").path, baseDir),
  );
  const sourceFreeze = load(
    resolveEvidencePath(byRole.get("source_search_freeze").path, baseDir),
  );
  validateSourceSearchFreezeValue(
    sourceFreeze,
    sourceRaw,
    sourcePrediction,
    sourceBundleRaw,
    authority,
  );
  const privateReceipt = load(
    resolveEvidencePath(byRole.get("private_score_receipt").path, baseDir),
  );
  validatePrivateScoreReceiptValue(privateReceipt, baseDir, authority);
  const results = load(
    resolveEvidencePath(byRole.get("reviewed_metrics").path, baseDir),
  );
  validateResultsValue(results, baseDir, authority);
  same(
    results.evidence.private_score_receipt,
    {
      path: byRole.get("private_score_receipt").path,
      sha256: byRole.get("private_score_receipt").sha256,
      bytes: byRole.get("private_score_receipt").bytes,
    },
    "matrix results/private receipt pin join",
  );
  const review = load(
    resolveEvidencePath(byRole.get("task_review").path, baseDir),
  );
  validateTaskReviewValue(review, baseDir, authority);
  codedAssert(
    exactMetricCompletion(results.metrics),
    "H2_METRIC_UNIVERSE_INCOMPLETE",
    "final matrix requires the exact complete metric universe and allowed honest N/A/unavailable rows",
  );
  assert(
    value.issue_92_complete && value.issue_69_complete,
    "final matrix completion booleans",
  );
}
const PUBLICATION_MEMBER_PATHS = [
  "candidate-descriptor-v2.json",
  "execution-authorization-v2.json",
  "final-criterion-matrix-v2.json",
  "gold-review-v2.json",
  "input-authority-v2.json",
  "prediction-freeze-v2.json",
  "prediction-output-v2.json",
  PRIVATE_SCORE_RECEIPT_FILE,
  "reviewed-metrics-v2.json",
  "search-task-review-v2.json",
  SOURCE_SEARCH_BUNDLE_FILE,
  SOURCE_SEARCH_OUTPUT_SCHEMA_FILE,
  SOURCE_SEARCH_FREEZE_FILE,
  SOURCE_SEARCH_PREDICTION_FILE,
  SOURCE_SEARCH_TASK_FILE,
].sort();
const PUBLICATION_DYNAMIC_PREDECESSORS: Record<string, string> = {
  candidate: "candidate-descriptor-v2.json",
  input_authority: "input-authority-v2.json",
  execution_authorization: "execution-authorization-v2.json",
  prediction_output: "prediction-output-v2.json",
  prediction_freeze: "prediction-freeze-v2.json",
  gold_review: "gold-review-v2.json",
  private_score_receipt: PRIVATE_SCORE_RECEIPT_FILE,
  results: "reviewed-metrics-v2.json",
  source_search_bundle: SOURCE_SEARCH_BUNDLE_FILE,
  source_search_prediction: SOURCE_SEARCH_PREDICTION_FILE,
  source_search_freeze: SOURCE_SEARCH_FREEZE_FILE,
  search_task: SOURCE_SEARCH_TASK_FILE,
  criterion_matrix: "final-criterion-matrix-v2.json",
  task_review: "search-task-review-v2.json",
};
function validateInputAuthorityValue(value: J): void {
  schema("input-authority.schema.v2.json", value);
  assert(
    value.status === "fixed_membership_candidate_no_execution_authority" &&
      value.inputs.length === 44 &&
      value.counts.unique_sources === 44 &&
      value.counts.task_memberships === 78,
    "publication input authority semantics",
  );
  exactSet(
    value.inputs.map((row: J) => row.opaque_id),
    FIXED_OPAQUE_IDS,
    "publication input authority IDs",
  );
  same(
    value.subsets,
    taskMembership(
      value.inputs.map((row: J) => ({ source_key: row.source_key }) as Source),
    ),
    "publication fixed memberships",
  );
}
function validatePublicationValue(
  value: J,
  baseDir = ROOT,
  authority?: J,
): void {
  schema("publication-descriptor.schema.v2.json", value);
  const pins = value.members_before_descriptor;
  codedAssert(
    new Set(pins.map((x: J) => x.path)).size === pins.length,
    "H2_PUBLICATION_EXACT_UNIVERSE",
    "duplicate descriptor member path",
  );
  same(
    pins.map((x: J) => x.path),
    pins.map((x: J) => x.path).sort(),
    "descriptor sorted members",
  );
  assert(
    value.tree_before_descriptor_sha256 ===
      hash(
        `${pins.map((x: J) => `${x.path}\t${x.sha256}\t${x.bytes}`).join("\n")}\n`,
      ) &&
      value.counts.files_before_descriptor === pins.length &&
      value.counts.bytes_before_descriptor ===
        pins.reduce((sum: number, x: J) => sum + x.bytes, 0),
    "descriptor tree/count arithmetic",
  );
  if (value.status === "candidate_only") {
    assert(
      value.candidate_commit === null &&
        Object.values(value.completion).every((x) => x === false),
      "candidate descriptor completion state",
    );
    return;
  }
  assert(
    authority,
    "published descriptor requires committed execution authority",
  );
  validateAuthorityValue(authority);
  assert(
    value.candidate_commit === authority.candidate_commit &&
      value.artifact_id === PUBLICATION_ID,
    "published descriptor identity",
  );
  codedAssert(
    canon([...pins.map((x: J) => x.path)].sort()) ===
      canon(PUBLICATION_MEMBER_PATHS),
    "H2_PUBLICATION_EXACT_UNIVERSE",
    "publication exact member filenames",
  );
  same(
    value.required_publication_members,
    PUBLICATION_MEMBER_PATHS,
    "publication required member order",
  );
  pins.forEach((member: J) => verifyFilePin(member, baseDir));
  assert(
    value.counts.published_members === pins.length + 1 &&
      value.counts.unique_sources === 44 &&
      value.counts.task_memberships === 78,
    "publication member/count arithmetic",
  );
  const inherited = predecessorPins();
  const expectedRoles = [
    ...Object.keys(inherited),
    ...Object.keys(PUBLICATION_DYNAMIC_PREDECESSORS),
  ];
  exactSet(
    Object.keys(value.predecessors),
    expectedRoles,
    "publication exact predecessor roles",
  );
  for (const [role, expected] of Object.entries(inherited)) {
    same(
      value.predecessors[role],
      expected,
      `publication inherited predecessor ${role}`,
    );
    verifyFilePin(value.predecessors[role]);
  }
  for (const [role, expectedPath] of Object.entries(
    PUBLICATION_DYNAMIC_PREDECESSORS,
  )) {
    const predecessor = value.predecessors[role];
    assert(
      predecessor.path === expectedPath,
      `publication predecessor path ${role}`,
    );
    verifyFilePin(predecessor, baseDir);
    const member = pins.find((candidate: J) => candidate.path === expectedPath);
    same(predecessor, member, `publication predecessor/member join ${role}`);
  }
  const candidate = load(path.join(baseDir, "candidate-descriptor-v2.json"));
  validatePublicationValue(candidate);
  const inputAuthorityRaw = fs.readFileSync(
    path.join(baseDir, "input-authority-v2.json"),
  );
  const canonicalAuthorityRaw = canonicalCommittedHeadAuthorityBytes();
  assert(
    inputAuthorityRaw.equals(canonicalAuthorityRaw),
    "publication input authority must be byte-identical to canonical committed HEAD authority",
  );
  const inputAuthority = JSON.parse(inputAuthorityRaw.toString("utf8"));
  validateInputAuthorityValue(inputAuthority);
  const committedAuthority = load(
    path.join(baseDir, "execution-authorization-v2.json"),
  );
  validateAuthorityValue(committedAuthority);
  same(committedAuthority, authority, "publication committed authority bytes");
  const predictionRaw = fs.readFileSync(
    path.join(baseDir, "prediction-output-v2.json"),
  );
  const prediction = JSON.parse(predictionRaw.toString("utf8"));
  validatePredictionValue(prediction);
  assert(prediction.status === "completed", "publication completed prediction");
  const freeze = load(path.join(baseDir, "prediction-freeze-v2.json"));
  const gold = load(path.join(baseDir, "gold-review-v2.json"));
  validateGoldValue(gold);
  assert(gold.status === "completed", "publication completed gold");
  validateFreezeValue(freeze, predictionRaw, prediction, authority);
  validateIndependentChronology(prediction, gold, freeze, authority);
  const results = load(path.join(baseDir, "reviewed-metrics-v2.json"));
  validateResultsValue(results, baseDir, authority);
  const task = load(path.join(baseDir, "search-task-v2.json"));
  validateSearchTaskValue(task, gold);
  const taskReceipt = load(path.join(baseDir, "search-task-review-v2.json"));
  validateTaskReviewValue(taskReceipt, baseDir, authority);
  const matrix = load(path.join(baseDir, "final-criterion-matrix-v2.json"));
  validateMatrixValue(matrix, baseDir, authority);
  const matrixInputPin = matrix.rows
    .flatMap((row: J) => row.evidence)
    .find((evidence: J) => evidence.role === "input_authority");
  const publicationInputPin = pins.find(
    (member: J) => member.path === "input-authority-v2.json",
  );
  same(
    publicationInputPin,
    value.predecessors.input_authority,
    "publication input authority member/predecessor pin",
  );
  assert(
    publicationInputPin.sha256 === matrixInputPin.sha256 &&
      publicationInputPin.bytes === matrixInputPin.bytes,
    "publication input authority matrix byte-pin join",
  );
  const derivedCompletion = {
    candidate_complete: true,
    issue_92_complete: matrix.issue_92_complete,
    issue_69_complete: matrix.issue_69_complete,
    publication_exists: true,
  };
  same(value.completion, derivedCompletion, "publication derived completion");
  assert(
    value.publisher.principal === authority.publisher.principal &&
      value.publisher.session_id === authority.publisher.session_id &&
      value.publisher.model === authority.publisher.model &&
      value.publisher.role === authority.publisher.role,
    "publication publisher authority binding",
  );
  before(
    taskReceipt.reviewer.reviewed_at,
    value.publisher.published_at,
    "task review before publication",
  );
  const actualFiles = files(baseDir);
  const descriptorName = "publication-descriptor-v2.json";
  exactSet(
    actualFiles,
    fs.existsSync(path.join(baseDir, descriptorName))
      ? [...PUBLICATION_MEMBER_PATHS, descriptorName]
      : PUBLICATION_MEMBER_PATHS,
    "publication directory exact files",
  );
  if (fs.existsSync(path.join(baseDir, descriptorName)))
    assert(
      fs.readFileSync(path.join(baseDir, descriptorName), "utf8") ===
        pretty(value),
      "publication descriptor commit marker bytes",
    );
}
function validateIndependentChronology(
  prediction: J,
  gold: J,
  freeze: J,
  authority: J,
): void {
  assert(
    prediction.status === "completed" &&
      gold.status === "completed" &&
      freeze.status === "frozen",
    "completed chronology evidence required",
  );
  validateAuthorityPrincipals(authority);
  assert(
    authority.schema_version ===
      "reviewed_metrics_execution_authorization_v2.2.0",
    "completed visual gold requires unified v2.2 authority",
  );
  assert(
    prediction.bundle_tree_sha256 === gold.bundle_tree_sha256 &&
      prediction.bundle_tree_sha256 === freeze.bundle_tree_sha256 &&
      prediction.bundle_tree_sha256 === authority.bundle_tree_sha256,
    "chronology bundle binding",
  );
  for (const key of [
    "principal",
    "session_id",
    "model",
    "reasoning_effort",
    "route",
  ])
    assert(
      prediction.session[key] === authority.predictor[key],
      `prediction authority provenance ${key}`,
    );
  assert(
    gold.reviewer.identity === authority.gold_reviewer.principal &&
      gold.reviewer.session_id === authority.gold_reviewer.session_id &&
      gold.reviewer.model === authority.gold_reviewer.model &&
      gold.reviewer.reasoning_effort ===
        authority.gold_reviewer.reasoning_effort,
    "gold reviewer authority provenance",
  );
  before(
    freeze.frozen_at,
    gold.reviewer.reviewed_at,
    "visual freeze before gold review",
  );
  before(
    authority.source_search_freeze_at,
    gold.reviewer.reviewed_at,
    "source-search freeze before gold review",
  );
}
function validateTaskReviewValue(
  value: J,
  baseDir = ROOT,
  authority?: J,
): void {
  schema("search-task-review.schema.v2.json", value);
  if (value.status !== "completed") return;
  assert(
    authority,
    "completed task review requires execution authority provenance",
  );
  const expected = [
    [value.task_pin, SOURCE_SEARCH_TASK_FILE],
    [value.source_search_freeze_pin, SOURCE_SEARCH_FREEZE_FILE],
    [value.public_score_receipt_pin, PRIVATE_SCORE_RECEIPT_FILE],
  ] as const;
  for (const [evidence, expectedPath] of expected) {
    assert(
      evidence.path === expectedPath,
      `task review exact pin path: ${expectedPath}`,
    );
    verifyFilePin(evidence, baseDir);
  }
  const task = load(resolveEvidencePath(value.task_pin.path, baseDir));
  validateSearchTaskValue(task);
  const receipt = load(
    resolveEvidencePath(value.public_score_receipt_pin.path, baseDir),
  );
  validatePrivateScoreReceiptValue(receipt, baseDir, authority);
  same(
    receipt.source_task,
    value.task_pin,
    "task review exact source task/receipt join",
  );
  same(
    receipt.source_search_freeze,
    value.source_search_freeze_pin,
    "task review exact source-search freeze/receipt join",
  );
  same(
    receipt.private_detail,
    value.private_score_detail,
    "task review private detail hash/bytes join",
  );
  same(
    receipt.expected_commitment,
    value.expected_commitment,
    "task review expected commitment join",
  );
  same(
    task.private_expected_commitment,
    value.expected_commitment,
    "task review task commitment join",
  );
  same(
    value.source_dossier_pins,
    {
      promotion_ledger: task.internal_provenance.promotion_ledger,
      review_receipt: task.internal_provenance.review_receipt,
      source_representation: task.internal_provenance.source_representation,
      source_acquisition: task.internal_provenance.source_acquisition,
    },
    "task review exact source dossier pins",
  );
  assert(
    value.authority_pins.execution_authorization.path ===
      "execution-authorization-v2.json",
    "task review exact unified authority path",
  );
  verifyFilePin(value.authority_pins.execution_authorization, baseDir);
  same(
    value.authority_pins.search_predictor,
    identityPin(authority.search_predictor),
    "task review search predictor authority",
  );
  same(
    value.authority_pins.private_evaluator,
    identityPin(authority.private_evaluator),
    "task review private evaluator authority",
  );
  same(
    value.authority_pins.task_reviewer,
    identityPin(authority.task_reviewer),
    "task review reviewer authority pin",
  );
  assert(
    value.reviewer.identity === authority.task_reviewer.principal &&
      value.reviewer.session_id === authority.task_reviewer.session_id &&
      value.reviewer.model === authority.task_reviewer.model &&
      value.reviewer.reasoning_effort ===
        authority.task_reviewer.reasoning_effort,
    "task reviewer authority provenance",
  );
  before(
    receipt.scored_at,
    value.reviewer.reviewed_at,
    "deterministic private score before task review",
  );
}
function scoreSynthetic(
  prediction: string,
  gold: string,
  output: string,
  capability: InternalSyntheticCapability,
): J {
  assert(
    capability[INTERNAL_SYNTHETIC_CAPABILITY] === true,
    "internal synthetic capability required",
  );
  validatePrediction(prediction);
  validateGold(gold);
  const result = {
    schema_version: "reviewed_metrics_results_v2.0.0",
    status: "synthetic_test_only",
    candidate_id: CANDIDATE_ID,
    evidence: null,
    scoring: null,
    metrics: [],
    criterion_matrix: { required_rows: 0, satisfied_rows: 0 },
    limitations: [
      "Synthetic contract integration only; not evaluation evidence.",
    ],
  };
  schema("reviewed-metrics.schema.v2.json", result);
  writeJson(output, result);
  return { status: "synthetic_score_written", metrics: 0 };
}
function scoreCompleted(
  predictionFile: string,
  freezeFile: string,
  goldFile: string,
  outputFile: string,
): J {
  const baseDir = path.dirname(outputFile);
  assert(
    path.dirname(predictionFile) === baseDir &&
      path.dirname(freezeFile) === baseDir &&
      path.dirname(goldFile) === baseDir,
    "score evidence must share one publication workspace",
  );
  assert(
    path.basename(predictionFile) === "prediction-output-v2.json" &&
      path.basename(freezeFile) === "prediction-freeze-v2.json" &&
      path.basename(goldFile) === "gold-review-v2.json" &&
      path.basename(outputFile) === "reviewed-metrics-v2.json",
    "score exact evidence filenames",
  );
  const authority = executionAuthority();
  const authorityCopy = path.join(baseDir, "execution-authorization-v2.json");
  assert(
    fs.existsSync(authorityCopy),
    "score requires committed authority byte copy in publication workspace",
  );
  same(load(authorityCopy), authority, "score authority copy");
  const rawPrediction = fs.readFileSync(predictionFile);
  const prediction = JSON.parse(rawPrediction.toString("utf8"));
  validatePredictionValue(prediction);
  assert(
    prediction.status === "completed",
    "score requires completed prediction",
  );
  const freeze = load(freezeFile);
  const gold = load(goldFile);
  assert(gold.status === "completed", "score requires completed gold");
  validateFreezeValue(freeze, rawPrediction, prediction, authority);
  validateIndependentChronology(prediction, gold, freeze, authority);
  const taskFile = path.join(baseDir, SOURCE_SEARCH_TASK_FILE);
  const receiptFile = path.join(baseDir, PRIVATE_SCORE_RECEIPT_FILE);
  assert(
    fs.existsSync(taskFile) && fs.existsSync(receiptFile),
    "completed metrics require exact source task and passing private score receipt",
  );
  const task = load(taskFile);
  validateSearchTaskValue(task);
  validateGoldValue(gold, task);
  const privateReceipt = load(receiptFile);
  validatePrivateScoreReceiptValue(privateReceipt, baseDir, authority);
  const scoredAt = new Date().toISOString();
  before(gold.reviewer.reviewed_at, scoredAt, "gold before score current UTC");
  before(
    privateReceipt.scored_at,
    scoredAt,
    "private score before final metrics",
  );
  const metrics = deriveMetrics(
    prediction,
    gold,
    privateReceipt,
    authority,
    task,
  );
  const complete = exactMetricCompletion(metrics);
  const result = {
    schema_version: "reviewed_metrics_results_v2.0.0",
    status: "completed",
    candidate_id: CANDIDATE_ID,
    evidence: {
      execution_authorization: pin(
        authorityCopy,
        "execution-authorization-v2.json",
      ),
      prediction: pin(predictionFile, "prediction-output-v2.json"),
      prediction_freeze: pin(freezeFile, "prediction-freeze-v2.json"),
      gold_review: pin(goldFile, "gold-review-v2.json"),
      source_task: pin(taskFile, SOURCE_SEARCH_TASK_FILE),
      private_score_receipt: pin(receiptFile, PRIVATE_SCORE_RECEIPT_FILE),
    },
    scoring: {
      algorithm: "reviewed-metrics-v2-deterministic-derivation-v1",
      scored_at: scoredAt,
    },
    metrics,
    criterion_matrix: {
      required_rows: FINAL_CRITERION_IDS.length,
      satisfied_rows: complete
        ? FINAL_CRITERION_IDS.length
        : FINAL_CRITERION_IDS.length - 1,
    },
    limitations: complete
      ? []
      : [
          "The exact metric universe or a required reviewed-support gate is incomplete.",
        ],
  };
  validateResultsValue(result, baseDir, authority);
  fs.writeFileSync(physicalPathSafety(outputFile), pretty(result), {
    flag: "wx",
    mode: 0o600,
  });
  return {
    status: "completed_metrics_derived",
    metrics: metrics.length,
    results_sha256: hash(fs.readFileSync(outputFile)),
  };
}
async function runCurrentFinalChainRegressionControls(
  baseDir: string,
  authority: J,
  results: J,
  accept: (fn: () => unknown | Promise<unknown>) => Promise<void>,
  reject: (fn: () => unknown | Promise<unknown>) => Promise<void>,
): Promise<string[]> {
  const task = load(path.join(baseDir, SOURCE_SEARCH_TASK_FILE));
  const bundle = load(path.join(baseDir, SOURCE_SEARCH_BUNDLE_FILE));
  const prediction = load(path.join(baseDir, SOURCE_SEARCH_PREDICTION_FILE));
  const freeze = load(path.join(baseDir, SOURCE_SEARCH_FREEZE_FILE));
  const receipt = load(path.join(baseDir, PRIVATE_SCORE_RECEIPT_FILE));
  const rawPrediction = fs.readFileSync(
    path.join(baseDir, SOURCE_SEARCH_PREDICTION_FILE),
  );
  const rawBundle = fs.readFileSync(
    path.join(baseDir, SOURCE_SEARCH_BUNDLE_FILE),
  );
  const caseIds: string[] = [];
  const accepted = async (id: string, fn: () => unknown | Promise<unknown>) => {
    await accept(fn);
    caseIds.push(id);
  };
  const rejected = async (
    id: string,
    foundation: J,
    mutate: (value: J) => void,
    validate: (value: J) => void,
  ) => {
    const value = structuredClone(foundation);
    mutate(value);
    await reject(() => validate(value));
    caseIds.push(id);
  };
  await accepted("current-task-foundation", () =>
    validateSearchTaskValue(task),
  );
  await accepted("current-public-bundle-foundation", () =>
    validateSourceSearchBundleValue(bundle, baseDir),
  );
  await accepted("current-source-freeze-foundation", () =>
    validateSourceSearchFreezeValue(
      freeze,
      rawPrediction,
      prediction,
      rawBundle,
      authority,
    ),
  );
  await accepted("current-private-receipt-foundation", () =>
    validatePrivateScoreReceiptValue(receipt, baseDir, authority),
  );
  await accepted("current-results-foundation", () =>
    validateResultsValue(results, baseDir, authority),
  );
  await rejected(
    "task-accepted-claim-dynamic-join",
    task,
    (x) => {
      x.internal_provenance.accepted_claim_id = `${x.internal_provenance.accepted_claim_id}-mismatch`;
    },
    validateSearchTaskValue,
  );
  await rejected(
    "task-review-receipt-pin",
    task,
    (x) => {
      x.internal_provenance.review_receipt.sha256 = "0".repeat(64);
    },
    validateSearchTaskValue,
  );
  await rejected(
    "bundle-local-schema-pin",
    bundle,
    (x) => {
      x.output_schema.sha256 = "0".repeat(64);
    },
    (x) => validateSourceSearchBundleValue(x, baseDir),
  );
  await rejected(
    "prediction-public-bundle-pin",
    prediction,
    (x) => {
      x.public_bundle.sha256 = "0".repeat(64);
    },
    (x) => validateSourceSearchPredictionValue(x, baseDir),
  );
  await rejected(
    "freeze-raw-prediction-pin",
    freeze,
    (x) => {
      x.prediction.sha256 = "0".repeat(64);
    },
    (x) =>
      validateSourceSearchFreezeValue(
        x,
        rawPrediction,
        prediction,
        rawBundle,
        authority,
      ),
  );
  await rejected(
    "receipt-source-freeze-pin",
    receipt,
    (x) => {
      x.source_search_freeze.sha256 = "0".repeat(64);
    },
    (x) => validatePrivateScoreReceiptValue(x, baseDir, authority),
  );
  await rejected(
    "results-private-receipt-pin",
    results,
    (x) => {
      x.evidence.private_score_receipt.sha256 = "0".repeat(64);
    },
    (x) => validateResultsValue(x, baseDir, authority),
  );
  await rejected(
    "results-derived-metrics",
    results,
    (x) => {
      x.metrics = [];
    },
    (x) => validateResultsValue(x, baseDir, authority),
  );
  return caseIds;
}
async function baselineContractSelfTest(): Promise<J> {
  let rejections = 0;
  let cases = 0;
  const reject = async (fn: () => unknown | Promise<unknown>) => {
    cases++;
    try {
      await fn();
    } catch (error) {
      codedAssert(
        error instanceof GateH2Error,
        "H2_TEST_UNTYPED_REJECTION",
        `baseline case ${cases} must reject through a Gate H2 boundary`,
      );
      rejections++;
      return;
    }
    throw new Error(`adversarial case accepted at baseline case ${cases}`);
  };
  const accept = async (fn: () => unknown | Promise<unknown>) => {
    cases++;
    await fn();
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-self-"));
  try {
    const candidate = path.join(root, "candidate");
    await build(candidate);
    const capability: InternalSyntheticCapability = {
      [INTERNAL_SYNTHETIC_CAPABILITY]: true,
    };
    const syntheticClock = () => new Date("2026-07-15T00:00:04.000Z");
    const authority = load(path.join(candidate, "input-authority-v2.json"));
    const deniedKeyCases = [
      "class",
      "claim_id",
      "disposition",
      "labels",
      "metadata",
      "answers",
      "reviewer_material",
      "record_id",
      "mapping",
    ];
    for (const key of deniedKeyCases)
      await reject(() => validateDenylist({ [key]: "x" }));
    const deniedTextCases = [
      "mtl_archives_metadata_10145",
      "docs/private.json",
      "/Users/example/repo/input.png",
      "r2://private-bucket/object",
      "private_locator",
    ];
    for (const value of deniedTextCases)
      await reject(() => validateDenylist({ purpose: value }));
    await reject(() =>
      assertSanitizedMetadata({ icc: Buffer.from("profile") }),
    );
    await reject(() => assertSanitizedMetadata({ comments: ["leak"] }));
    await reject(() => executionAuthority());
    await reject(() =>
      scoreCompleted(
        "prediction-output-v2.json",
        "prediction-freeze-v2.json",
        "gold-review-v2.json",
        "reviewed-metrics-v2.json",
      ),
    );
    const authorityBytes = Buffer.from(
      pretty(syntheticExecutionAuthority("a".repeat(64))),
    );
    const authorityEvidence = (
      overrides: Partial<ExecutionAuthorityEvidence> = {},
    ): ExecutionAuthorityEvidence =>
      ({
        head: "d".repeat(40),
        parents: [SYNTHETIC_CANDIDATE_COMMIT],
        changedPaths: [EXECUTION_AUTHORITY_REL],
        repositoryClean: true,
        tracked: true,
        headBytes: authorityBytes,
        indexBytes: authorityBytes,
        worktreeBytes: authorityBytes,
        indexClean: true,
        worktreeClean: true,
        ...overrides,
      }) as ExecutionAuthorityEvidence;
    await reject(() =>
      executionAuthority(
        undefined,
        undefined,
        () => authorityEvidence(),
        syntheticClock,
      ),
    );
    await accept(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence(),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ parents: [SYNTHETIC_STALE_PARENT_COMMIT] }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ parents: ["0".repeat(40)] }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () =>
          authorityEvidence({
            parents: [SYNTHETIC_CANDIDATE_COMMIT, "0".repeat(40)],
          }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () =>
          authorityEvidence({
            changedPaths: [EXECUTION_AUTHORITY_REL, "README.md"],
          }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ repositoryClean: false }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ tracked: false }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ indexClean: false }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ worktreeClean: false }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ indexBytes: Buffer.from("{}\n") }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () => authorityEvidence({ worktreeBytes: Buffer.from("{}\n") }),
        syntheticClock,
      ),
    );
    await reject(() =>
      executionAuthority(
        syntheticExecutionAuthority("a".repeat(64)),
        capability,
        gitExecutionAuthorityEvidence,
        () => new Date("2026-07-14T23:59:59.000Z"),
      ),
    );
    await reject(() =>
      executionAuthority(
        syntheticExecutionAuthority("a".repeat(64)),
        capability,
        gitExecutionAuthorityEvidence,
        () => new Date("2026-07-15T00:20:00.000Z"),
      ),
    );
    const wrongCommitAuthority = syntheticExecutionAuthority("a".repeat(64));
    wrongCommitAuthority.candidate_commit = "e".repeat(40);
    const wrongCommitBytes = Buffer.from(pretty(wrongCommitAuthority));
    await reject(() =>
      executionAuthority(
        undefined,
        capability,
        () =>
          authorityEvidence({
            headBytes: wrongCommitBytes,
            indexBytes: wrongCommitBytes,
            worktreeBytes: wrongCommitBytes,
          }),
        syntheticClock,
      ),
    );
    await reject(() =>
      buildBlindBundle(path.join(ROOT, ".blind"), authority, capability),
    );
    const preserved = path.join(root, "preserved");
    fs.mkdirSync(preserved);
    fs.writeFileSync(path.join(preserved, "sentinel"), "keep");
    await reject(() => build(preserved));
    assert(
      fs.readFileSync(path.join(preserved, "sentinel"), "utf8") === "keep",
      "caller path was modified",
    );
    const realParent = path.join(root, "real-parent");
    const aliasParent = path.join(root, "alias-parent");
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, aliasParent);
    await reject(() =>
      buildBlindBundle(path.join(aliasParent, "bundle"), authority, capability),
    );
    assert(files(realParent).length === 0, "symlink parent was modified");
    const leafTarget = path.join(root, "leaf-target");
    fs.mkdirSync(leafTarget);
    const leaf = path.join(root, "leaf");
    fs.symlinkSync(leafTarget, leaf);
    await reject(() => buildBlindBundle(leaf, authority, capability));
    const failed = path.join(root, "failed-owned-child");
    await reject(() => buildBlindBundle(failed, authority, capability, true));
    assert(!fs.existsSync(failed), "owned failure reservation was not cleaned");
    const altered = structuredClone(authority);
    [altered.inputs[0].opaque_id, altered.inputs[1].opaque_id] = [
      altered.inputs[1].opaque_id,
      altered.inputs[0].opaque_id,
    ];
    await reject(() =>
      buildBlindBundle(
        path.join(root, "altered-authority"),
        altered,
        capability,
      ),
    );
    assert(
      !fs.existsSync(path.join(root, "altered-authority")),
      "altered authority failure cleanup",
    );
    const bundle = path.join(root, "bundle");
    await buildBlindBundle(bundle, authority, capability);
    await reject(() => buildBlindBundle(bundle, authority, capability));
    fs.writeFileSync(path.join(bundle, "extra.txt"), "x");
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    fs.rmSync(path.join(bundle, "extra.txt"));
    fs.symlinkSync("instructions.json", path.join(bundle, "link.json"));
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    fs.rmSync(path.join(bundle, "link.json"));
    const bundledSchema = path.join(bundle, "prediction-output.schema.v2.json");
    const originalSchema = fs.readFileSync(bundledSchema);
    fs.rmSync(bundledSchema);
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    fs.writeFileSync(bundledSchema, originalSchema);
    const media = path.join(bundle, "media/v2-0001.png");
    const original = fs.readFileSync(media);
    await sharp(media)
      .withMetadata()
      .png({ compressionLevel: 9 })
      .toFile(`${media}.tampered`);
    fs.renameSync(`${media}.tampered`, media);
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    fs.writeFileSync(media, original);
    await sharp(media)
      .negate()
      .png({ compressionLevel: 9 })
      .toFile(`${media}.tampered`);
    fs.renameSync(`${media}.tampered`, media);
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    fs.writeFileSync(media, original);
    const descriptorFile = path.join(bundle, "blind-bundle-descriptor-v2.json");
    const descriptor = load(descriptorFile);
    const originalName = descriptor.members[0].filename;
    descriptor.members[0].filename = "../escape.png";
    writeJson(descriptorFile, descriptor);
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    descriptor.members[0].filename = originalName;
    const originalHash = descriptor.members[0].sha256;
    descriptor.members[0].sha256 = descriptor.members[1].sha256;
    writeJson(descriptorFile, descriptor);
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    descriptor.members[0].sha256 = originalHash;
    const originalId = descriptor.members[0].opaque_id;
    descriptor.members[0].opaque_id = descriptor.members[1].opaque_id;
    writeJson(descriptorFile, descriptor);
    await reject(() => verifyBlindBundle(bundle, authority, capability));
    descriptor.members[0].opaque_id = originalId;
    writeJson(descriptorFile, descriptor);
    const instructions = load(path.join(bundle, "instructions.json"));
    const inferred = structuredClone(descriptor);
    inferred.members[0].purposes = ["aerial_land_use"];
    await reject(() => assertNeutralBundleSemantics(inferred, instructions));
    const badInstructions = structuredClone(instructions);
    badInstructions.assignment = "OCR only";
    await reject(() =>
      assertNeutralBundleSemantics(descriptor, badInstructions),
    );

    const completedPrediction = syntheticCompletedPrediction(
      descriptor.media_tree.sha256,
    );
    await accept(() => validatePredictionValue(completedPrediction));
    for (const mutate of [
      (x: J) => {
        x.bundle_tree_sha256 = null;
      },
      (x: J) => {
        x.outputs[1].opaque_id = x.outputs[0].opaque_id;
      },
      (x: J) => {
        x.outputs[0].opaque_id = "v2-9999";
      },
      (x: J) => {
        x.outputs[0].image_mode = "arbitrary";
      },
      (x: J) => {
        x.outputs[0].entities = [
          {
            entity_id: "e",
            surface: "x",
            bbox: [0, 0, 1, 1],
            type: "arbitrary",
            identity_decision: "surface_only",
            identity: null,
          },
        ];
      },
      (x: J) => {
        x.outputs[0].place_links = [
          {
            civic_number: null,
            street: null,
            place: null,
            official_url: "not a uri",
            abstained: false,
          },
        ];
      },
      (x: J) => {
        x.session.ended_at = "2026-07-15T00:00:01.000Z";
        x.session.started_at = "2026-07-15T00:00:02.000Z";
      },
    ]) {
      const value = structuredClone(completedPrediction);
      mutate(value);
      await reject(() => validatePredictionValue(value));
    }
    const completedGold = syntheticGoldV21(descriptor.media_tree.sha256);
    await accept(() => validateGoldValue(completedGold));
    for (const mutate of [
      (x: J) => {
        x.reviewer = null;
      },
      (x: J) => {
        x.reviews[1].opaque_id = x.reviews[0].opaque_id;
      },
      (x: J) => {
        x.reviews[0].image_mode = "arbitrary";
      },
      (x: J) => {
        x.reviews[38].entities = [
          {
            entity_id: "e",
            surface: "x",
            bbox: [0, 0, 1, 1],
            type: "arbitrary",
            identity_decision: "surface_only",
            supported_identity: null,
          },
        ];
      },
      (x: J) => {
        x.reviews.find((row: J) =>
          AERIAL_OPAQUE.includes(row.opaque_id),
        ).aerial_reviewable = false;
      },
    ]) {
      const value = structuredClone(completedGold);
      mutate(value);
      await reject(() => validateGoldValue(value));
    }
    for (const mutate of [
      (x: J) => {
        x.reviews
          .filter((row: J) => IMAGE_OPAQUE.includes(row.opaque_id))
          .forEach((row: J) => {
            row.image_mode = "ground_street";
          });
      },
      (x: J) => {
        x.reviews.forEach((row: J) => {
          row.entities = [];
        });
      },
      (x: J) => {
        x.reviews.find((row: J) =>
          OCR_OPAQUE.includes(row.opaque_id),
        ).ocr_normalized = "...";
      },
      (x: J) => {
        x.reviews.find((row: J) => OCR_OPAQUE.includes(row.opaque_id)).ocr_raw =
          " ";
      },
      (x: J) => {
        const row = x.reviews[38];
        row.entities.push(structuredClone(row.entities[0]));
      },
      (x: J) => {
        const row = x.reviews[38];
        row.place_opportunities = [
          {
            opportunity_id: "p",
            civic_number: null,
            street: null,
            place: "x",
            official_url: null,
            supported: true,
          },
          {
            opportunity_id: "p",
            civic_number: null,
            street: null,
            place: "y",
            official_url: null,
            supported: true,
          },
        ];
      },
      (x: J) => {
        x.reviews[38].place_opportunities = [
          {
            opportunity_id: "p",
            civic_number: null,
            street: null,
            place: "x",
            official_url: null,
            supported: true,
          },
        ];
      },
      (x: J) => {
        x.reviewed_exclusions = [
          {
            opaque_id: x.reviews[0].opaque_id,
            reason: "late",
            fixed_before_scoring: true,
          },
        ];
        x.reviews[0].exclusion = "late";
      },
    ]) {
      const value = structuredClone(completedGold);
      mutate(value);
      await reject(() => validateGoldValue(value));
    }
    const thirteenAerial = structuredClone(completedGold);
    const thirteenth = thirteenAerial.reviews.filter(
      (row: J) =>
        AERIAL_OPAQUE.includes(row.opaque_id) && !row.aerial_reviewable,
    )[0];
    thirteenth.aerial_reviewable = true;
    thirteenth.aerial_labels = ["mixed_urban"];
    await accept(() => validateGoldValue(thirteenAerial));
    const syntheticAuth = syntheticAuthorityV21(descriptor.media_tree.sha256);
    const evidenceDir = path.join(root, "evidence");
    const sourcePaths = makeSyntheticSearchWorkspace(
      evidenceDir,
      syntheticAuth,
      capability,
    );
    scorePrivateSourceSearch(
      evidenceDir,
      sourcePaths.envelopeFile,
      sourcePaths.detailFile,
      sourcePaths.receiptFile,
      syntheticAuth,
      capability,
      "2026-07-15T00:00:09.000Z",
      SYNTHETIC_EVALUATOR_KEYS.privateKey,
    );
    const privateReceipt = load(sourcePaths.receiptFile);
    const evidencePredictionFile = path.join(
      evidenceDir,
      "prediction-output-v2.json",
    );
    const evidenceGoldFile = path.join(evidenceDir, "gold-review-v2.json");
    const evidenceAuthorityFile = path.join(
      evidenceDir,
      "execution-authorization-v2.json",
    );
    const evidenceFreezeFile = path.join(
      evidenceDir,
      "prediction-freeze-v2.json",
    );
    writeJson(evidencePredictionFile, completedPrediction);
    writeJson(evidenceGoldFile, completedGold);
    await accept(() =>
      freezePrediction(
        evidencePredictionFile,
        evidenceFreezeFile,
        syntheticAuth,
        capability,
        syntheticClock,
      ),
    );
    const completedResults = syntheticCompletedResults(
      completedPrediction,
      completedGold,
      {
        execution_authorization: pin(
          evidenceAuthorityFile,
          "execution-authorization-v2.json",
        ),
        prediction: pin(evidencePredictionFile, "prediction-output-v2.json"),
        prediction_freeze: pin(evidenceFreezeFile, "prediction-freeze-v2.json"),
        gold_review: pin(evidenceGoldFile, "gold-review-v2.json"),
        source_task: pin(
          path.join(evidenceDir, SOURCE_SEARCH_TASK_FILE),
          SOURCE_SEARCH_TASK_FILE,
        ),
        private_score_receipt: pin(
          sourcePaths.receiptFile,
          PRIVATE_SCORE_RECEIPT_FILE,
        ),
      },
      privateReceipt,
      syntheticAuth,
      load(path.join(evidenceDir, SOURCE_SEARCH_TASK_FILE)),
    );
    await accept(() =>
      validateResultsValue(completedResults, evidenceDir, syntheticAuth),
    );
    for (const mutate of [
      (x: J) => {
        x.metrics = [];
      },
      (x: J) => {
        x.metrics[0].denominator = 0;
      },
      (x: J) => {
        x.metrics[0].numerator = 99;
      },
      (x: J) => {
        x.metrics[0].included_ids.pop();
      },
      (x: J) => {
        x.evidence.prediction.sha256 = "0".repeat(64);
      },
      (x: J) => {
        x.scoring.scored_at = completedGold.reviewer.reviewed_at;
      },
    ]) {
      const value = structuredClone(completedResults);
      mutate(value);
      await reject(() =>
        validateResultsValue(value, evidenceDir, syntheticAuth),
      );
    }
    for (const mutate of [
      (x: J) => {
        x.metrics[0].status = "not_applicable_no_reviewed_masks";
      },
      (x: J) => {
        x.metrics[0].excluded = [
          {
            opaque_id: x.metrics[0].included_ids.pop(),
            reason: "late",
            fixed_before_scoring: true,
          },
        ];
      },
      (x: J) => {
        x.metrics.find(
          (m: J) => m.metric_id === "entity_precision",
        ).raw_counts.fp = 1;
      },
      (x: J) => {
        x.metrics.find(
          (m: J) => m.metric_id === "entity_recall",
        ).raw_counts.fn = 1;
      },
      (x: J) => {
        x.metrics.find((m: J) => m.metric_id === "aerial_micro_f1").raw_counts
          .tp--;
      },
      (x: J) => {
        x.metrics.find((m: J) => m.metric_id === "ocr_cer").raw_counts
          .character_edits++;
      },
    ]) {
      const value = structuredClone(completedResults);
      mutate(value);
      await reject(() =>
        validateResultsValue(value, evidenceDir, syntheticAuth),
      );
    }
    fs.appendFileSync(evidencePredictionFile, " ");
    await reject(() =>
      validateResultsValue(completedResults, evidenceDir, syntheticAuth),
    );
    writeJson(evidencePredictionFile, completedPrediction);
    await accept(() =>
      validateResultsValue(completedResults, evidenceDir, syntheticAuth),
    );
    const falseFinal = load(
      path.join(candidate, "candidate-criterion-matrix-v2.json"),
    );
    falseFinal.status = "final";
    falseFinal.issue_92_complete = true;
    falseFinal.issue_69_complete = true;
    await reject(() => validateMatrixValue(falseFinal));
    const currentFinalChainCases = await runCurrentFinalChainRegressionControls(
      evidenceDir,
      syntheticAuth,
      completedResults,
      accept,
      reject,
    );
    const predictionFile = path.join(root, "completed-prediction.json");
    writeJson(predictionFile, completedPrediction);
    const freezeFile = path.join(root, "prediction-freeze.json");
    await accept(() =>
      freezePrediction(
        predictionFile,
        freezeFile,
        syntheticAuth,
        capability,
        syntheticClock,
      ),
    );
    const freeze = load(freezeFile);
    await accept(() =>
      validateIndependentChronology(
        completedPrediction,
        completedGold,
        freeze,
        syntheticAuth,
      ),
    );
    const overlapGold = structuredClone(completedGold);
    overlapGold.reviewer.identity = completedPrediction.session.principal;
    await reject(() =>
      validateIndependentChronology(
        completedPrediction,
        overlapGold,
        freeze,
        syntheticAuth,
      ),
    );
    const earlyGold = structuredClone(completedGold);
    earlyGold.reviewer.reviewed_at = freeze.frozen_at;
    await reject(() =>
      validateIndependentChronology(
        completedPrediction,
        earlyGold,
        freeze,
        syntheticAuth,
      ),
    );
    const goldAtSourceFreeze = structuredClone(completedGold);
    goldAtSourceFreeze.reviewer.reviewed_at =
      syntheticAuth.source_search_freeze_at;
    await reject(() =>
      validateIndependentChronology(
        completedPrediction,
        goldAtSourceFreeze,
        freeze,
        syntheticAuth,
      ),
    );
    const goldBeforeSourceFreeze = structuredClone(completedGold);
    goldBeforeSourceFreeze.reviewer.reviewed_at = "2026-07-15T00:00:07.999Z";
    await reject(() =>
      validateIndependentChronology(
        completedPrediction,
        goldBeforeSourceFreeze,
        freeze,
        syntheticAuth,
      ),
    );
    for (const role of [
      "implementation",
      "gold_reviewer",
      "task_reviewer",
      "publisher",
    ]) {
      for (const field of ["principal", "session_id"]) {
        const overlapping = structuredClone(syntheticAuth);
        overlapping[role][field] = overlapping.predictor[field];
        await reject(() => validateAuthorityPrincipals(overlapping));
      }
    }
    for (const role of [
      "implementation",
      "predictor",
      "gold_reviewer",
      "task_reviewer",
      "publisher",
    ]) {
      const forbidden = structuredClone(syntheticAuth);
      forbidden.forbidden_prior_reviewers[0].principal =
        forbidden[role].principal;
      await reject(() => validateAuthorityPrincipals(forbidden));
    }
    for (const [field, source] of [
      ["started_at", "authorized_at"],
      ["ended_at", "started_at"],
      ["freeze_at", "ended_at"],
      ["expires_at", "freeze_at"],
    ] as const) {
      const equal = structuredClone(syntheticAuth);
      equal[field] = equal[source];
      await reject(() =>
        freezePrediction(
          predictionFile,
          path.join(root, `equal-${field}.json`),
          equal,
          capability,
          syntheticClock,
        ),
      );
    }
    await reject(() =>
      freezePrediction(
        predictionFile,
        path.join(root, "stale-clock.json"),
        syntheticAuth,
        capability,
        () => new Date("2026-07-15T00:00:10.000Z"),
      ),
    );
    const equalPrediction = structuredClone(completedPrediction);
    equalPrediction.session.ended_at = equalPrediction.session.started_at;
    await reject(() => validatePredictionValue(equalPrediction));
    fs.appendFileSync(predictionFile, " ");
    await reject(() => {
      const raw = fs.readFileSync(predictionFile);
      assert(
        hash(raw) === freeze.prediction.sha256 &&
          raw.length === freeze.prediction.bytes,
        "frozen raw prediction mutation",
      );
    });
    return {
      status: "baseline_and_current_tests_passed",
      executed_test_ids: currentFinalChainCases,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function syntheticAuthorityV21(bundle: string): J {
  return syntheticExecutionAuthority(bundle);
}
function syntheticGoldV21(bundle: string): J { const legacy = syntheticCompletedGold(bundle); delete legacy.source_task_dossier_decision; delete legacy.private_expected_commitment; return legacy; }
function syntheticGateEExpected(gateEPins: J): {
  expected: J;
  claimId: string;
  representation: J;
  capture: J;
} {
  const promotion = load(resolveEvidencePath(gateEPins.promotion_ledger.path));
  const promoted = promotion.rows.filter(
    (row: J) =>
      row.disposition === "accepted" && row.promotion_eligible === true,
  );
  assert(promoted.length === 1, "synthetic Gate E accepted promotion");
  const receipt = load(resolveEvidencePath(gateEPins.review_receipt.path));
  const disposition = receipt.dispositions.find(
    (row: J) => row.claim_id === promoted[0].claim_id,
  );
  const representations = load(
    resolveEvidencePath(gateEPins.source_representation.path),
  );
  const representation = representations.representations.find(
    (row: J) =>
      row.representation_id ===
      disposition.supported_source_representation_ids[0],
  );
  const acquisition = load(
    resolveEvidencePath(gateEPins.source_acquisition.path),
  );
  const capture = acquisition.captures.find(
    (row: J) =>
      row.source_family_id === representation.source_family_id &&
      row.body_sha256 === representation.body_sha256,
  );
  const passage = representation.propositions
    .map((item: J) => item.passage)
    .sort((a: string, b: string) => b.length - a.length)[0];
  const year = passage.match(/\b((?:18|19|20)[0-9]{2})\b/u)?.[1];
  const address = passage.match(
    /\b([0-9]{1,6})\s*,?\s*((?:rue|avenue|boulevard|chemin)\s+[^,]+),?\s+à\s+([^,.;]+)/iu,
  );
  assert(
    year && address && capture,
    "synthetic Gate E dynamic expected extraction",
  );
  return {
    expected: {
      year,
      civic_number: address[1],
      street: address[2].trim(),
      place: address[3].trim(),
      official_url: capture.effective_url,
      source_id: representation.source_id,
      source_representation_id: representation.representation_id,
    },
    claimId: disposition.claim_id,
    representation,
    capture,
  };
}
function syntheticEnvelope(gateEPins: J, authority: J): J {
  const derived = syntheticGateEExpected(gateEPins);
  const saltHex = hash("reviewed-metrics-v2 synthetic high-diversity salt");
  const value: J = {
    schema_version: "reviewed_metrics_private_expected_envelope_v2.0.0",
    status: "sealed_private_expected",
    candidate_id: CANDIDATE_ID,
    task_id: ISSUE_97_TASK_ID,
    authored_by: identityPin(authority.gold_reviewer),
    authored_at: authority.private_envelope_sealed_at,
    salt_hex: saltHex,
    salt_generation: {
      method: "operating_system_csprng",
      generator: "synthetic-test-adapter",
      generated_at: authority.private_envelope_sealed_at,
      attestation_id: hash(`synthetic-csprng-attestation\0${saltHex}`),
      attestation: "author_attested_not_independently_proven",
    },
    commitment: {
      algorithm: "sha256",
      domain: SOURCE_SEARCH_COMMITMENT_DOMAIN,
      canonicalization: SOURCE_SEARCH_CANONICALIZATION,
      value: "0".repeat(64),
    },
    expected: derived.expected,
    gate_e_provenance: {
      accepted_claim_id: derived.claimId,
      source_family_id: derived.representation.source_family_id,
      ...gateEPins,
    },
  };
  value.commitment.value = recomputeSourceSearchCommitment(value);
  return value;
}
function syntheticSearchTask(
  commitment: J,
  gateEPins: J,
  authority: J,
  freezePin: J,
): J {
  const derived = syntheticGateEExpected(gateEPins);
  return {
    schema_version: "reviewed_metrics_search_task_v2.0.0",
    status: "published",
    candidate_id: CANDIDATE_ID,
    authored_by: identityPin(authority.gold_reviewer),
    authored_at: authority.source_dossier_authored_at,
    source_search_freeze: freezePin,
    internal_provenance: {
      internal_task_id: ISSUE_97_TASK_ID,
      accepted_claim_id: derived.claimId,
      source_representation_id: derived.representation.representation_id,
      source_id: derived.representation.source_id,
      source_family_id: derived.representation.source_family_id,
      official_source_url: derived.capture.effective_url,
      ...gateEPins,
      no_pixel_identity_claim: true,
    },
    public_projection: {
      prompt:
        "Find every required normalized public field in the allowed official source and cite it with a bounded paraphrase.",
      official_origins: [RPCQ_ORIGIN],
      output_fields: ISSUE_97_OUTPUT_FIELDS,
      scoring_version: "gate-h-v2-official-source-search-v1",
    },
    source_task_dossier: {
      task_gate_id: ISSUE_97_TASK_ID,
      opportunity_id: "gate-h-v2-place:task-0001",
      accepted_claim_id: derived.claimId,
      source_representation_id: derived.representation.representation_id,
      source_id: derived.representation.source_id,
      source_family_id: derived.representation.source_family_id,
      official_source_origin: RPCQ_ORIGIN,
      no_pixel_identity_claim: true,
    },
    source_only_boundary: true,
    private_expected_commitment: commitment,
    rights_policy: {
      citation_only: true,
      private_body_redistribution_allowed: false,
      bounded_paraphrase_required: true,
    },
    component: "source-only-official-search",
    split: "test",
    review_state: "accepted",
  };
}
function syntheticSearchPrediction(
  bundlePin: J,
  answer: J,
  paraphrase = "The official record reports the organization at this address in the stated year.",
): J {
  const publicAnswer = Object.fromEntries(
    ISSUE_97_OUTPUT_FIELDS.map((field) => [field, answer[field]]),
  );
  return {
    schema_version: "reviewed_metrics_source_search_prediction_v2.0.0",
    status: "completed",
    task_id: ISSUE_97_TASK_ID,
    public_bundle: bundlePin,
    session: {
      principal: "synthetic-search-predictor",
      session_id: "synthetic-search-prediction-session",
      model: "synthetic-search-model",
      reasoning_effort: "synthetic",
      route: actor("search_predictor").route,
      started_at: "2026-07-15T00:00:06.000Z",
      ended_at: "2026-07-15T00:00:07.000Z",
    },
    answer: publicAnswer,
    evidence: [{ official_url: publicAnswer.official_url, paraphrase }],
    attestations: {
      no_expected_received: true,
      no_private_body_received: true,
      no_repo_access: true,
      no_pixel_identity_claim: true,
      one_run_only: true,
    },
  };
}
function makeSyntheticSearchWorkspace(
  root: string,
  authority: J,
  capability: InternalSyntheticCapability,
  answer?: J,
  paraphrase?: string,
): { envelopeFile: string; detailFile: string; receiptFile: string } {
  fs.mkdirSync(root);
  writeJson(path.join(root, "execution-authorization-v2.json"), authority);
  const gateEPins = Object.fromEntries(
    Object.entries(GATE_E_PATHS).map(([role, shownPath]) => [
      role,
      pin(path.join(ROOT, shownPath), shownPath),
    ]),
  );
  const derived = syntheticGateEExpected(gateEPins);
  fs.copyFileSync(
    path.join(SCHEMAS, "source-search-prediction.schema.v2.json"),
    path.join(root, SOURCE_SEARCH_OUTPUT_SCHEMA_FILE),
  );
  const bundle = {
    ...blankSourceSearchBundle(),
    status: "sealed_public_bundle",
    output_schema: pin(
      path.join(root, SOURCE_SEARCH_OUTPUT_SCHEMA_FILE),
      SOURCE_SEARCH_OUTPUT_SCHEMA_FILE,
    ),
  };
  writeJson(path.join(root, SOURCE_SEARCH_BUNDLE_FILE), bundle);
  const prediction = syntheticSearchPrediction(
    pin(path.join(root, SOURCE_SEARCH_BUNDLE_FILE), SOURCE_SEARCH_BUNDLE_FILE),
    answer ?? derived.expected,
    paraphrase,
  );
  writeJson(path.join(root, SOURCE_SEARCH_PREDICTION_FILE), prediction);
  freezeSourceSearchPrediction(
    path.join(root, SOURCE_SEARCH_PREDICTION_FILE),
    path.join(root, SOURCE_SEARCH_BUNDLE_FILE),
    path.join(root, SOURCE_SEARCH_FREEZE_FILE),
    authority,
    capability,
    () => new Date(authority.source_search_freeze_at),
  );
  const envelope = syntheticEnvelope(gateEPins, authority);
  const sealedDir = path.join(
    path.dirname(root),
    `${path.basename(root)}-sealed`,
  );
  const detailDir = path.join(
    path.dirname(root),
    `${path.basename(root)}-detail`,
  );
  fs.mkdirSync(sealedDir);
  fs.mkdirSync(detailDir);
  const envelopeFile = path.join(
    sealedDir,
    "private-expected-envelope-v2.json",
  );
  writeJson(envelopeFile, envelope);
  const task = syntheticSearchTask(
    envelope.commitment,
    gateEPins,
    authority,
    pin(path.join(root, SOURCE_SEARCH_FREEZE_FILE), SOURCE_SEARCH_FREEZE_FILE),
  );
  writeJson(path.join(root, SOURCE_SEARCH_TASK_FILE), task);
  return {
    envelopeFile,
    detailFile: path.join(detailDir, "private-score-detail-v2.json"),
    receiptFile: path.join(root, PRIVATE_SCORE_RECEIPT_FILE),
  };
}
async function sourceSearchSelfTest(): Promise<J> {
  let cases = 0;
  let rejections = 0;
  const groups: Record<string, string[]> = {
    baseline_contract: [],
    authority: [],
    commitment: [],
    prediction: [],
    private_score: [],
    receipt: [],
    final_chain: [],
  };
  const rejectionCodes: Record<string, { intended: string; observed: string }> =
    {};
  const accept = async (
    group: string,
    label: string,
    fn: () => unknown | Promise<unknown>,
  ) => {
    cases++;
    await fn();
    groups[group].push(label);
  };
  const reject = async (
    group: string,
    label: string,
    fn: () => unknown | Promise<unknown>,
    expectedCode = "H2_INVARIANT",
  ) => {
    cases++;
    try {
      await fn();
    } catch (error) {
      const observed =
        error instanceof GateH2Error
          ? error.code
          : error instanceof Error
            ? error.message
            : String(error);
      codedAssert(
        observed === expectedCode,
        "H2_TEST_WRONG_REJECTION",
        `${label} expected ${expectedCode}, observed ${observed}`,
      );
      rejections++;
      groups[group].push(label);
      rejectionCodes[label] = {
        intended: expectedCode,
        observed,
      };
      return;
    }
    throw new GateH2Error(
      "H2_TEST_ACCEPTED_ADVERSARY",
      `${label}: adversarial case accepted`,
    );
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-v21-self-"));
  const capability: InternalSyntheticCapability = {
    [INTERNAL_SYNTHETIC_CAPABILITY]: true,
  };
  try {
    const candidate = path.join(root, "candidate");
    await build(candidate);
    await accept("baseline_contract", "candidate-replay", () =>
      verifyCandidate(candidate, false),
    );
    const inputAuthority = load(
      path.join(candidate, "input-authority-v2.json"),
    );
    const visualBundle = path.join(root, "visual-bundle");
    await buildBlindBundle(visualBundle, inputAuthority, capability);
    await accept("baseline_contract", "visual-bundle-replay", () =>
      verifyBlindBundle(visualBundle, inputAuthority, capability),
    );
    const visualDescriptor = load(
      path.join(visualBundle, "blind-bundle-descriptor-v2.json"),
    );
    for (const key of [
      "class",
      "claim_id",
      "disposition",
      "labels",
      "metadata",
      "answers",
      "reviewer_material",
      "record_id",
      "mapping",
    ])
      await reject("baseline_contract", `deny-key-${key}`, () =>
        validateDenylist({ [key]: "x" }),
      );
    for (const textValue of [
      "mtl_archives_metadata_1",
      "docs/private.json",
      "/Users/example/repo",
      "r2://private/object",
      "private_locator",
    ])
      await reject("baseline_contract", `deny-text-${textValue}`, () =>
        validateDenylist({ purpose: textValue }),
      );
    await reject("baseline_contract", "metadata-icc", () =>
      assertSanitizedMetadata({ icc: Buffer.from("x") }),
    );
    await reject("baseline_contract", "metadata-comment", () =>
      assertSanitizedMetadata({ comments: ["x"] }),
    );
    await reject("authority", "no-real-authority", () => executionAuthority());
    const authority = syntheticAuthorityV21(visualDescriptor.media_tree.sha256);
    const resignAuthority = (authorityValue: J): void => {
      const bindingHash = authorityBindingHash(authorityValue);
      for (const role of ["implementation", "predictor", "search_predictor", "private_evaluator", "gold_reviewer", "task_reviewer", "publisher"]) {
        const actorValue = authorityValue[role];
        Object.assign(actorValue.route_receipt, {
          surface_id: actorValue.surface_id,
          surface_inventory_digest: actorValue.surface_inventory_digest,
          candidate_commit: authorityValue.candidate_commit,
          authority_hash: bindingHash,
          role: actorValue.role,
          requested_root: actorValue.route,
          canonical_root: actorValue.canonical_root,
          signature_base64: "",
        });
        actorValue.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(actorValue.route_receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
      }
    };
    await accept("authority", "unified-v21", () =>
      validateAuthorityValue(authority),
    );
    const actorRoles = [
      "implementation",
      "predictor",
      "search_predictor",
      "private_evaluator",
      "gold_reviewer",
      "task_reviewer",
      "publisher",
    ];
    for (const role of actorRoles)
      for (const field of ["principal", "session_id"] as const) {
        const bad = structuredClone(authority);
        const other =
          role === "implementation" ? "predictor" : "implementation";
        bad[role][field] = authority[other][field];
        await reject("authority", `${role}-${field}-overlap`, () =>
          validateAuthorityPrincipals(bad),
        );
      }
    for (const role of actorRoles) {
      const bad = structuredClone(authority);
      bad.forbidden_prior_reviewers[0].principal = bad[role].principal;
      await reject("authority", `${role}-prior-reviewer-overlap`, () =>
        validateAuthorityPrincipals(bad),
      );
    }
    for (const role of [
      "predictor",
      "search_predictor",
      "private_evaluator",
      "gold_reviewer",
      "task_reviewer",
      "publisher",
    ]) {
      const equal = structuredClone(authority);
      equal[role].route = equal[role].canonical_root =
        equal.implementation.canonical_root;
      equal[role].surface_id = equal.implementation.surface_id;
      equal[role].surface_inventory_digest = equal.implementation.surface_inventory_digest;
      resignAuthority(equal);
      await reject(
        "authority",
        `implementation-${role}-route-equality`,
        () => validateAuthorityPrincipals(equal),
        "H2_ROUTE_PHYSICAL_OVERLAP",
      );
      const nested = structuredClone(authority);
      nested[role].route = nested[role].canonical_root = path.join(
        nested.implementation.canonical_root,
        role,
      );
      nested[role].surface_id = nested.implementation.surface_id;
      nested[role].surface_inventory_digest = nested.implementation.surface_inventory_digest;
      resignAuthority(nested);
      await reject(
        "authority",
        `implementation-${role}-route-descendant`,
        () => validateAuthorityPrincipals(nested),
        "H2_ROUTE_PHYSICAL_OVERLAP",
      );
      const ancestor = structuredClone(authority);
      ancestor.implementation.route = ancestor.implementation.canonical_root =
        path.dirname(ancestor[role].canonical_root);
      ancestor.implementation.surface_id = ancestor[role].surface_id;
      ancestor.implementation.surface_inventory_digest = ancestor[role].surface_inventory_digest;
      resignAuthority(ancestor);
      await reject(
        "authority",
        `implementation-${role}-route-ancestor`,
        () => validateAuthorityPrincipals(ancestor),
        "H2_ROUTE_PHYSICAL_OVERLAP",
      );
    }
    for (const role of [
      "search_predictor",
      "private_evaluator",
      "gold_reviewer",
      "task_reviewer",
      "publisher",
    ]) {
      const overlap = structuredClone(authority);
      overlap[role].route = overlap[role].canonical_root =
        overlap.predictor.canonical_root;
      overlap[role].surface_id = overlap.predictor.surface_id;
      overlap[role].surface_inventory_digest = overlap.predictor.surface_inventory_digest;
      resignAuthority(overlap);
      await reject(
        "authority",
        `visual-${role}-route-overlap`,
        () => validateAuthorityPrincipals(overlap),
        "H2_ROUTE_PHYSICAL_OVERLAP",
      );
    }
    const aliasedImplementationRoute = structuredClone(authority);
    aliasedImplementationRoute.implementation.route =
      aliasedImplementationRoute.implementation.canonical_root = `${path.dirname(aliasedImplementationRoute.predictor.canonical_root)}/alias/../predictor`;
    resignAuthority(aliasedImplementationRoute);
    await reject(
      "authority",
      "implementation-route-non-normalized-alias",
      () => validateAuthorityPrincipals(aliasedImplementationRoute),
      "H2_ROUTE_PATH",
    );
    const relativeRoute = structuredClone(authority);
    relativeRoute.publisher.route = relativeRoute.publisher.canonical_root =
      "relative/publisher";
    resignAuthority(relativeRoute);
    await reject(
      "authority",
      "relative-filesystem-route",
      () => validateAuthorityPrincipals(relativeRoute),
      "H2_ROUTE_PATH",
    );
    const nestedRoute = structuredClone(authority);
    nestedRoute.publisher.route = nestedRoute.publisher.canonical_root =
      path.join(nestedRoute.task_reviewer.canonical_root, "nested");
    nestedRoute.publisher.surface_id = nestedRoute.task_reviewer.surface_id;
    nestedRoute.publisher.surface_inventory_digest = nestedRoute.task_reviewer.surface_inventory_digest;
    resignAuthority(nestedRoute);
    await reject(
      "authority",
      "nested-filesystem-route-overlap",
      () => validateAuthorityPrincipals(nestedRoute),
      "H2_ROUTE_PHYSICAL_OVERLAP",
    );
    const tmpAlias = structuredClone(authority);
    tmpAlias.implementation.route = tmpAlias.implementation.canonical_root =
      "/tmp/h2-route-a";
    tmpAlias.predictor.route = tmpAlias.predictor.canonical_root =
      "/private/tmp/h2-route-a";
    resignAuthority(tmpAlias);
    await reject(
      "authority",
      "tmp-private-tmp-physical-alias",
      () => validateAuthorityPrincipals(tmpAlias),
      "H2_ROUTE_CANONICAL_MISMATCH",
    );
    const aliasRoot = path.join(root, "route-alias-real");
    fs.mkdirSync(aliasRoot);
    const aliasLink = path.join(root, "route-alias-link");
    fs.symlinkSync(aliasRoot, aliasLink);
    const symlinkAlias = structuredClone(authority);
    symlinkAlias.implementation.route =
      symlinkAlias.implementation.canonical_root = path.join(
        aliasRoot,
        "worker",
      );
    symlinkAlias.predictor.route = symlinkAlias.predictor.canonical_root =
      path.join(aliasLink, "worker");
    resignAuthority(symlinkAlias);
    await reject(
      "authority",
      "symlink-physical-alias",
      () => validateAuthorityPrincipals(symlinkAlias),
      "H2_ROUTE_CANONICAL_MISMATCH",
    );
    const relabeledSurface = structuredClone(authority);
    relabeledSurface.predictor.surface_inventory_digest = relabeledSurface.implementation.surface_inventory_digest;
    resignAuthority(relabeledSurface);
    await reject("authority", "one-inventory-multiple-surface-ids", () => validateAuthorityPrincipals(relabeledSurface), "H2_ROUTE_SURFACE_ID");
    const duplicateInventory = structuredClone(authority);
    duplicateInventory.trusted_surface_inventory[1] = structuredClone(duplicateInventory.trusted_surface_inventory[0]);
    resignAuthority(duplicateInventory);
    await reject("authority", "duplicate-trusted-inventory", () => validateAuthorityPrincipals(duplicateInventory), "H2_ROUTE_INVENTORY_DUPLICATE");
    const remoteInventory = { kind: "remote_host", ssh_host_fingerprint_sha256: hash("synthetic-kami-ssh-host"), instance_identity: { provider: "coordinator_verified_ssh", instance_id: "i-synthetic-kami", identity_document_sha256: hash("synthetic-instance-identity"), aws_signature_verified: false } };
    const remoteSymlinkAlias = structuredClone(authority);
    remoteSymlinkAlias.trusted_surface_inventory[0] = remoteInventory;
    for (const role of ["implementation", "predictor"]) { remoteSymlinkAlias[role].surface_inventory_digest = trustedInventoryDigest(remoteInventory); remoteSymlinkAlias[role].surface_id = trustedSurfaceId(remoteInventory); }
    remoteSymlinkAlias.implementation.route = "/srv/work-link"; remoteSymlinkAlias.implementation.canonical_root = "/srv/work-real"; remoteSymlinkAlias.predictor.route = "/srv/work-real"; remoteSymlinkAlias.predictor.canonical_root = "/srv/work-real"; resignAuthority(remoteSymlinkAlias);
    await reject("authority", "remote-symlink-canonical-alias", () => validateAuthorityPrincipals(remoteSymlinkAlias), "H2_ROUTE_PHYSICAL_OVERLAP");
    const remoteTmpAlias = structuredClone(remoteSymlinkAlias); remoteTmpAlias.implementation.route = "/tmp/h2-shared"; remoteTmpAlias.implementation.canonical_root = "/private/tmp/h2-shared"; remoteTmpAlias.predictor.route = remoteTmpAlias.predictor.canonical_root = "/private/tmp/h2-shared"; resignAuthority(remoteTmpAlias);
    await reject("authority", "remote-tmp-private-tmp-alias", () => validateAuthorityPrincipals(remoteTmpAlias), "H2_ROUTE_PHYSICAL_OVERLAP");
    const replayedNonce = structuredClone(authority);
    replayedNonce.predictor.route_nonce = replayedNonce.implementation.route_nonce;
    replayedNonce.predictor.route_receipt.nonce = replayedNonce.implementation.route_receipt.nonce;
    resignAuthority(replayedNonce);
    await reject("authority", "one-shot-nonce-replay", () => validateAuthorityPrincipals(replayedNonce), "H2_ROUTE_NONCE_REPLAY");
    const staleReceipt = structuredClone(authority);
    staleReceipt.publisher.route_receipt.issued_at = "2026-07-14T23:00:00.000Z";
    staleReceipt.publisher.route_receipt.expires_at = "2026-07-14T23:01:00.000Z";
    staleReceipt.publisher.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(staleReceipt.publisher.route_receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
    await reject("authority", "stale-route-receipt", () => validateAuthorityPrincipals(staleReceipt), "H2_ROUTE_RECEIPT_FRESHNESS");
    const wrongCandidateReceipt = structuredClone(authority);
    wrongCandidateReceipt.publisher.route_receipt.candidate_commit = "0".repeat(40);
    wrongCandidateReceipt.publisher.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(wrongCandidateReceipt.publisher.route_receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
    await reject("authority", "wrong-candidate-route-receipt", () => validateAuthorityPrincipals(wrongCandidateReceipt), "H2_ROUTE_RECEIPT_BINDING");
    const wrongNonceReceipt = structuredClone(authority);
    wrongNonceReceipt.publisher.route_receipt.nonce = hash("wrong-nonce").slice(0, 32);
    wrongNonceReceipt.publisher.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(wrongNonceReceipt.publisher.route_receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
    await reject("authority", "wrong-precommitted-route-nonce", () => validateAuthorityPrincipals(wrongNonceReceipt), "H2_ROUTE_RECEIPT_BINDING");
    const wrongAuthorityHashReceipt = structuredClone(authority);
    wrongAuthorityHashReceipt.publisher.route_receipt.authority_hash = "0".repeat(64);
    wrongAuthorityHashReceipt.publisher.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(wrongAuthorityHashReceipt.publisher.route_receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
    await reject("authority", "wrong-authority-hash-route-receipt", () => validateAuthorityPrincipals(wrongAuthorityHashReceipt), "H2_ROUTE_RECEIPT_BINDING");
    const wrongRoleReceipt = structuredClone(authority);
    wrongRoleReceipt.publisher.route_receipt.role = "predictor";
    wrongRoleReceipt.publisher.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(wrongRoleReceipt.publisher.route_receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
    await reject("authority", "wrong-role-route-receipt", () => validateAuthorityPrincipals(wrongRoleReceipt), "H2_ROUTE_RECEIPT_BINDING");
    const selfSignedReceipt = structuredClone(authority);
    const selfKey = crypto.generateKeyPairSync("ed25519");
    selfSignedReceipt.publisher.route_receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(selfSignedReceipt.publisher.route_receipt), selfKey.privateKey).toString("base64");
    await reject("authority", "self-signed-route-receipt", () => validateAuthorityPrincipals(selfSignedReceipt), "H2_ROUTE_RECEIPT_SIGNATURE");
    const forgedReceipt = structuredClone(authority);
    forgedReceipt.publisher.route_receipt.signature_base64 = Buffer.alloc(
      64,
      9,
    ).toString("base64");
    await reject(
      "authority",
      "forged-route-receipt",
      () => validateAuthorityPrincipals(forgedReceipt),
      "H2_ROUTE_RECEIPT_SIGNATURE",
    );
    const rsaAuthority = structuredClone(authority);
    rsaAuthority.private_evaluator.signing_public_key_pem = crypto
      .generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    resignAuthority(rsaAuthority);
    await reject(
      "authority",
      "rsa-evaluator-authority-key",
      () => validateAuthorityValue(rsaAuthority),
      "H2_EVALUATOR_PUBLIC_KEY",
    );
    for (const [label, leftRoot, rightRoot] of [
      [
        "physical-route-equality",
        "/synthetic-isolation/shared",
        "/synthetic-isolation/shared",
      ],
      [
        "physical-route-descendant",
        "/synthetic-isolation/shared",
        "/synthetic-isolation/shared/child",
      ],
      [
        "physical-route-ancestor",
        "/synthetic-isolation/shared/child",
        "/synthetic-isolation/shared",
      ],
    ] as const) {
      const bad = structuredClone(authority);
      bad.implementation.route = bad.implementation.canonical_root = leftRoot;
      bad.predictor.route = bad.predictor.canonical_root = rightRoot;
      bad.predictor.surface_id = bad.implementation.surface_id;
      bad.predictor.surface_inventory_digest = bad.implementation.surface_inventory_digest;
      resignAuthority(bad);
      await reject(
        "authority",
        label,
        () => validateAuthorityPrincipals(bad),
        "H2_ROUTE_PHYSICAL_OVERLAP",
      );
    }
    for (const [field, prior] of [
      ["started_at", "authorized_at"],
      ["ended_at", "started_at"],
      ["freeze_at", "ended_at"],
      ["source_search_started_at", "freeze_at"],
      ["source_search_ended_at", "source_search_started_at"],
      ["source_search_freeze_at", "source_search_ended_at"],
      ["source_dossier_authored_at", "source_search_freeze_at"],
      ["private_envelope_sealed_at", "source_dossier_authored_at"],
      ["expires_at", "private_envelope_sealed_at"],
    ] as const) {
      const bad = structuredClone(authority);
      bad[field] = bad[prior];
      resignAuthority(bad);
      await reject("authority", `chronology-${field}`, () =>
        validateAuthorityValue(bad),
      );
    }
    const oldVersion = structuredClone(authority);
    oldVersion.schema_version =
      "reviewed_metrics_execution_authorization_v2.0.0";
    for (const key of [
      "search_predictor",
      "private_evaluator",
      "source_search_started_at",
      "source_search_ended_at",
      "source_search_freeze_at",
      "source_dossier_authored_at",
      "private_envelope_sealed_at",
    ])
      delete oldVersion[key];
    await accept("authority", "v20-visual-authority-schema-compatible", () =>
      validateAuthorityValue(oldVersion),
    );

    const passDir = path.join(root, "pass");
    const passPaths = makeSyntheticSearchWorkspace(
      passDir,
      authority,
      capability,
    );
    const envelope = load(passPaths.envelopeFile);
    await accept("commitment", "envelope-open-internal-capability", () =>
      validatePrivateExpectedEnvelopeValue(envelope, capability, authority),
    );
    const wrongEnvelopeAuthor = structuredClone(envelope);
    wrongEnvelopeAuthor.authored_by = identityPin(authority.task_reviewer);
    await reject(
      "commitment",
      "wrong-envelope-author",
      () =>
        validatePrivateExpectedEnvelopeValue(
          wrongEnvelopeAuthor,
          capability,
          authority,
        ),
      "H2_ENVELOPE_AUTHOR",
    );
    await reject(
      "commitment",
      "synthetic-salt-refused-without-capability",
      () =>
        validatePrivateExpectedEnvelopeValue(envelope, undefined, authority),
    );
    for (const mutation of [
      [
        "all-zero-salt",
        (x: J) => {
          x.salt_hex = Buffer.alloc(32).toString("hex");
        },
      ],
      [
        "all-one-salt",
        (x: J) => {
          x.salt_hex = Buffer.alloc(32, 0xff).toString("hex");
        },
      ],
      [
        "repeated-byte-salt",
        (x: J) => {
          x.salt_hex = Buffer.alloc(32, 2).toString("hex");
        },
      ],
      [
        "repeated-pattern-salt",
        (x: J) => {
          x.salt_hex = Buffer.concat([
            Buffer.from(Array.from({ length: 16 }, (_, index) => index + 32)),
            Buffer.from(Array.from({ length: 16 }, (_, index) => index + 32)),
          ]).toString("hex");
        },
      ],
      [
        "low-diversity-salt",
        (x: J) => {
          x.salt_hex = Buffer.from(
            Array.from({ length: 32 }, (_, index) => index % 4),
          ).toString("hex");
        },
      ],
      [
        "predictable-sequential-salt",
        (x: J) => {
          x.salt_hex = Buffer.from(
            Array.from({ length: 32 }, (_, index) => index),
          ).toString("hex");
        },
      ],
      [
        "short-salt",
        (x: J) => {
          x.salt_hex = envelope.salt_hex.slice(2);
        },
      ],
      [
        "long-salt",
        (x: J) => {
          x.salt_hex = `${envelope.salt_hex}00`;
        },
      ],
      [
        "false-csprng-proof",
        (x: J) => {
          x.salt_generation.attestation = "cryptographically_proven";
        },
      ],
      [
        "missing-csprng-attestation",
        (x: J) => {
          x.salt_generation.attestation_id = "";
        },
      ],
      [
        "high-diversity-non-csprng",
        (x: J) => {
          x.salt_generation.method = "deterministic_prng";
        },
      ],
      [
        "salt-at-source-freeze",
        (x: J) => {
          x.salt_generation.generated_at = authority.source_search_freeze_at;
        },
      ],
      [
        "salt-before-source-freeze",
        (x: J) => {
          x.salt_generation.generated_at = "2026-07-15T00:00:07.999Z";
        },
      ],
      [
        "salt-after-envelope-seal",
        (x: J) => {
          x.salt_generation.generated_at = "2026-07-15T00:00:08.401Z";
        },
      ],
      [
        "salt-invalid-timestamp",
        (x: J) => {
          x.salt_generation.generated_at = "not-a-timestamp";
        },
      ],
      [
        "wrong-commitment",
        (x: J) => {
          x.commitment.value = "f".repeat(64);
        },
      ],
      [
        "wrong-domain",
        (x: J) => {
          x.commitment.domain = "wrong-domain";
        },
      ],
      [
        "wrong-canonicalization",
        (x: J) => {
          x.commitment.canonicalization = "wrong";
        },
      ],
      [
        "wrong-year",
        (x: J) => {
          x.expected.year = `${Number(x.expected.year) + 1}`;
        },
      ],
      [
        "wrong-civic",
        (x: J) => {
          x.expected.civic_number = `${x.expected.civic_number}9`;
        },
      ],
      [
        "wrong-street",
        (x: J) => {
          x.expected.street = "Wrong Street";
        },
      ],
      [
        "wrong-place",
        (x: J) => {
          x.expected.place = "Wrong Place";
        },
      ],
      [
        "wrong-url",
        (x: J) => {
          x.expected.official_url = "https://example.invalid";
        },
      ],
      [
        "wrong-source",
        (x: J) => {
          x.expected.source_id = "unrelated";
        },
      ],
      [
        "wrong-representation",
        (x: J) => {
          x.expected.source_representation_id = "unrelated";
        },
      ],
      [
        "wrong-claim",
        (x: J) => {
          x.gate_e_provenance.accepted_claim_id = `${x.gate_e_provenance.accepted_claim_id}-wrong`;
        },
      ],
      [
        "wrong-family",
        (x: J) => {
          x.gate_e_provenance.source_family_id = "unrelated";
        },
      ],
      [
        "wrong-receipt-pin",
        (x: J) => {
          x.gate_e_provenance.review_receipt.sha256 = "0".repeat(64);
        },
      ],
    ] as [string, (x: J) => void][]) {
      const bad = structuredClone(envelope);
      mutation[1](bad);
      await reject("commitment", mutation[0], () =>
        validatePrivateExpectedEnvelopeValue(bad, capability, authority),
      );
    }
    const saltAtSeal = structuredClone(envelope);
    saltAtSeal.salt_generation.generated_at =
      authority.private_envelope_sealed_at;
    await accept("commitment", "salt-equal-envelope-seal-allowed", () =>
      validatePrivateExpectedEnvelopeValue(saltAtSeal, capability, authority),
    );
    const publicBundle = load(path.join(passDir, SOURCE_SEARCH_BUNDLE_FILE));
    await accept("prediction", "public-bundle", () =>
      validateSourceSearchBundleValue(publicBundle, passDir),
    );
    const missingSubject = structuredClone(publicBundle);
    delete missingSubject.query_subject;
    await reject("prediction", "public-bundle-missing-query-subject", () =>
      validateSourceSearchBundleValue(missingSubject, passDir),
    );
    const substitutedSubject = structuredClone(publicBundle);
    substitutedSubject.query_subject.value = "Unrelated public organization";
    await reject("prediction", "public-bundle-substituted-query-subject", () =>
      validateSourceSearchBundleValue(substitutedSubject, passDir),
    );
    const sourcePrediction = load(
      path.join(passDir, SOURCE_SEARCH_PREDICTION_FILE),
    );
    await accept("prediction", "source-prediction", () =>
      validateSourceSearchPredictionValue(sourcePrediction, passDir),
    );
    const predictionMutations: [string, (x: J) => void][] = [
      [
        "answer-only",
        (x) => {
          x.evidence = [];
        },
      ],
      [
        "unsupported-url",
        (x) => {
          x.answer.official_url = "https://example.invalid/wrong";
          x.evidence[0].official_url = x.answer.official_url;
        },
      ],
      [
        "raw-quote",
        (x) => {
          x.evidence[0].paraphrase = Object.values(envelope.expected).join(" ");
        },
      ],
      [
        "quote-markers",
        (x) => {
          x.evidence[0].paraphrase = '"Quoted source wording"';
        },
      ],
      [
        "excessive-paraphrase",
        (x) => {
          x.evidence[0].paraphrase = Array.from(
            { length: 33 },
            () => "word",
          ).join(" ");
        },
      ],
      [
        "pixel-id",
        (x) => {
          x.evidence[0].paraphrase = "Evidence from v2-0001";
        },
      ],
      [
        "pixel-identity",
        (x) => {
          x.evidence[0].paraphrase = "The image identity proves this";
        },
      ],
      [
        "private-body",
        (x) => {
          x.evidence[0].paraphrase = "Read the private body";
        },
      ],
      [
        "repo-path",
        (x) => {
          x.evidence[0].paraphrase = "Read docs/source.json";
        },
      ],
      [
        "secret",
        (x) => {
          x.evidence[0].paraphrase = "Use secret token";
        },
      ],
      [
        "bundle-substitution",
        (x) => {
          x.public_bundle.sha256 = "0".repeat(64);
        },
      ],
      [
        "session-backwards",
        (x) => {
          x.session.ended_at = x.session.started_at;
        },
      ],
      [
        "source-evidence-mismatch",
        (x) => {
          x.evidence[0].source_id = "unrelated";
        },
      ],
      [
        "representation-mismatch",
        (x) => {
          x.evidence[0].source_representation_id = "unrelated";
        },
      ],
      [
        "duplicate-evidence",
        (x) => {
          x.evidence.push(structuredClone(x.evidence[0]));
        },
      ],
    ];
    for (const [label, mutate] of predictionMutations) {
      const bad = structuredClone(sourcePrediction);
      mutate(bad);
      await reject("prediction", label, () =>
        validateSourceSearchPredictionValue(bad, passDir),
      );
    }
    const predictionExtra = structuredClone(sourcePrediction);
    predictionExtra.forbidden_extra = true;
    await reject("prediction", "top-level-additional-property", () =>
      validateSourceSearchPredictionValue(predictionExtra, passDir),
    );
    const sourceFreeze = load(path.join(passDir, SOURCE_SEARCH_FREEZE_FILE));
    const rawSourcePrediction = fs.readFileSync(
      path.join(passDir, SOURCE_SEARCH_PREDICTION_FILE),
    );
    const rawPublicBundle = fs.readFileSync(
      path.join(passDir, SOURCE_SEARCH_BUNDLE_FILE),
    );
    await accept("prediction", "source-freeze", () =>
      validateSourceSearchFreezeValue(
        sourceFreeze,
        rawSourcePrediction,
        sourcePrediction,
        rawPublicBundle,
        authority,
      ),
    );
    await reject("authority", "v20-cannot-activate-source-search", () =>
      validateSourceSearchFreezeValue(
        sourceFreeze,
        rawSourcePrediction,
        sourcePrediction,
        rawPublicBundle,
        oldVersion,
      ),
    );
    for (const [label, mutate] of [
      [
        "freeze-prediction-substitution",
        (x: J) => {
          x.prediction.sha256 = "0".repeat(64);
        },
      ],
      [
        "freeze-bundle-substitution",
        (x: J) => {
          x.public_bundle.sha256 = "0".repeat(64);
        },
      ],
      [
        "freeze-principal",
        (x: J) => {
          x.principal = authority.predictor.principal;
        },
      ],
      [
        "freeze-route",
        (x: J) => {
          x.route = authority.predictor.route;
        },
      ],
      [
        "freeze-time",
        (x: J) => {
          x.frozen_at = authority.freeze_at;
        },
      ],
    ] as [string, (x: J) => void][]) {
      const bad = structuredClone(sourceFreeze);
      mutate(bad);
      await reject("prediction", label, () =>
        validateSourceSearchFreezeValue(
          bad,
          rawSourcePrediction,
          sourcePrediction,
          rawPublicBundle,
          authority,
        ),
      );
    }
    const scoreBeforeSealDir = path.join(root, "score-before-seal");
    const scoreBeforeSealPaths = makeSyntheticSearchWorkspace(
      scoreBeforeSealDir,
      authority,
      capability,
    );
    await reject("private_score", "score-equal-envelope-seal", () =>
      scorePrivateSourceSearch(
        scoreBeforeSealDir,
        scoreBeforeSealPaths.envelopeFile,
        scoreBeforeSealPaths.detailFile,
        scoreBeforeSealPaths.receiptFile,
        authority,
        capability,
        authority.private_envelope_sealed_at,
      ),
    );
    const score = scorePrivateSourceSearch(
      passDir,
      passPaths.envelopeFile,
      passPaths.detailFile,
      passPaths.receiptFile,
      authority,
      capability,
      "2026-07-15T00:00:09.000Z",
    );
    assert(
      score.status === "private_source_search_score_passed",
      "synthetic passing score",
    );
    const receipt = load(passPaths.receiptFile);
    await accept("private_score", "passing-private-score", () =>
      validatePrivateScoreReceiptValue(receipt, passDir, authority),
    );
    const substitutionCase = async (
      label: string,
      targetName: string,
    ): Promise<void> => {
      const caseDir = path.join(root, `race-${label}`);
      const casePaths = makeSyntheticSearchWorkspace(
        caseDir,
        authority,
        capability,
      );
      const target =
        targetName === "envelope"
          ? casePaths.envelopeFile
          : path.join(caseDir, targetName);
      await reject(
        "private_score",
        `finalization-${label}-substitution`,
        () =>
          scorePrivateSourceSearch(
            caseDir,
            casePaths.envelopeFile,
            casePaths.detailFile,
            casePaths.receiptFile,
            authority,
            capability,
            "2026-07-15T00:00:09.000Z",
            SYNTHETIC_EVALUATOR_KEYS.privateKey,
            {
              afterInputs: () => {
                const bytes = fs.readFileSync(target);
                fs.renameSync(target, `${target}.replaced`);
                fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
              },
            },
          ),
        "H2_FINALIZATION_PATH_SUBSTITUTION",
      );
    };
    for (const [label, filename] of [
      ["authority", "execution-authorization-v2.json"],
      ["task", SOURCE_SEARCH_TASK_FILE],
      ["bundle", SOURCE_SEARCH_BUNDLE_FILE],
      ["prediction", SOURCE_SEARCH_PREDICTION_FILE],
      ["freeze", SOURCE_SEARCH_FREEZE_FILE],
      ["envelope", "envelope"],
    ] as const)
      await substitutionCase(label, filename);
    const sameInodeRewriteCase = async (label: string, targetName: string): Promise<void> => {
      const caseDir = path.join(root, `same-inode-${label}`);
      const casePaths = makeSyntheticSearchWorkspace(caseDir, authority, capability);
      const target = targetName === "envelope" ? casePaths.envelopeFile : path.join(caseDir, targetName);
      await reject("private_score", `finalization-${label}-same-inode-restored-metadata`, () => scorePrivateSourceSearch(caseDir, casePaths.envelopeFile, casePaths.detailFile, casePaths.receiptFile, authority, capability, "2026-07-15T00:00:09.000Z", SYNTHETIC_EVALUATOR_KEYS.privateKey, { afterInputs: () => {
        const stat = fs.statSync(target); const bytes = fs.readFileSync(target); const changed = Buffer.from(bytes); changed[changed.length - 2] = changed[changed.length - 2] === 0x7d ? 0x20 : 0x7d;
        const fd = fs.openSync(target, "r+"); try { fs.writeSync(fd, changed, 0, changed.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.utimesSync(target, stat.atime, stat.mtime);
      } }), "H2_FINALIZATION_EXACT_BYTES");
    };
    for (const [label, filename] of [["authority", "execution-authorization-v2.json"], ["task", SOURCE_SEARCH_TASK_FILE], ["bundle", SOURCE_SEARCH_BUNDLE_FILE], ["prediction", SOURCE_SEARCH_PREDICTION_FILE], ["freeze", SOURCE_SEARCH_FREEZE_FILE], ["envelope", "envelope"]] as const) await sameInodeRewriteCase(label, filename);
    const detailRaceDir = path.join(root, "race-detail");
    const detailRace = makeSyntheticSearchWorkspace(
      detailRaceDir,
      authority,
      capability,
    );
    await reject(
      "private_score",
      "finalization-detail-substitution",
      () =>
        scorePrivateSourceSearch(
          detailRaceDir,
          detailRace.envelopeFile,
          detailRace.detailFile,
          detailRace.receiptFile,
          authority,
          capability,
          "2026-07-15T00:00:09.000Z",
          SYNTHETIC_EVALUATOR_KEYS.privateKey,
          {
            afterDetailWrite: () => {
              const bytes = fs.readFileSync(detailRace.detailFile);
              fs.renameSync(
                detailRace.detailFile,
                `${detailRace.detailFile}.replaced`,
              );
              fs.writeFileSync(detailRace.detailFile, bytes, {
                flag: "wx",
                mode: 0o600,
              });
            },
          },
        ),
      "H2_FINALIZATION_PATH_SUBSTITUTION",
    );
    const detailBytesRaceDir = path.join(root, "same-inode-detail");
    const detailBytesRace = makeSyntheticSearchWorkspace(detailBytesRaceDir, authority, capability);
    await reject("private_score", "finalization-detail-same-inode-restored-metadata", () => scorePrivateSourceSearch(detailBytesRaceDir, detailBytesRace.envelopeFile, detailBytesRace.detailFile, detailBytesRace.receiptFile, authority, capability, "2026-07-15T00:00:09.000Z", SYNTHETIC_EVALUATOR_KEYS.privateKey, { afterDetailWrite: () => {
      const stat = fs.statSync(detailBytesRace.detailFile); const bytes = fs.readFileSync(detailBytesRace.detailFile); const changed = Buffer.from(bytes); changed[changed.length - 2] = 0x20;
      fs.chmodSync(detailBytesRace.detailFile, 0o600); const fd = fs.openSync(detailBytesRace.detailFile, "r+"); try { fs.writeSync(fd, changed, 0, changed.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.chmodSync(detailBytesRace.detailFile, 0o400); fs.utimesSync(detailBytesRace.detailFile, stat.atime, stat.mtime);
    } }), "H2_FINALIZATION_EXACT_BYTES");
    const hardLinkDir = path.join(root, "hard-link-input");
    const hardLinkPaths = makeSyntheticSearchWorkspace(hardLinkDir, authority, capability);
    fs.linkSync(hardLinkPaths.envelopeFile, `${hardLinkPaths.envelopeFile}.alias`);
    await reject("private_score", "finalization-envelope-hard-link", () => scorePrivateSourceSearch(hardLinkDir, hardLinkPaths.envelopeFile, hardLinkPaths.detailFile, hardLinkPaths.receiptFile, authority, capability, "2026-07-15T00:00:09.000Z", SYNTHETIC_EVALUATOR_KEYS.privateKey), "H2_FINALIZATION_INPUT");
    const symlinkDir = path.join(root, "symlink-input");
    const symlinkPaths = makeSyntheticSearchWorkspace(
      symlinkDir,
      authority,
      capability,
    );
    const realEnvelope = `${symlinkPaths.envelopeFile}.real`;
    fs.renameSync(symlinkPaths.envelopeFile, realEnvelope);
    fs.symlinkSync(realEnvelope, symlinkPaths.envelopeFile);
    await reject(
      "private_score",
      "finalization-envelope-symlink",
      () =>
        scorePrivateSourceSearch(
          symlinkDir,
          symlinkPaths.envelopeFile,
          symlinkPaths.detailFile,
          symlinkPaths.receiptFile,
          authority,
          capability,
          "2026-07-15T00:00:09.000Z",
          SYNTHETIC_EVALUATOR_KEYS.privateKey,
        ),
      "H2_FINALIZATION_INPUT",
    );
    const noncanonicalDir = path.join(root, "noncanonical-input");
    const noncanonicalPaths = makeSyntheticSearchWorkspace(
      noncanonicalDir,
      authority,
      capability,
    );
    fs.appendFileSync(noncanonicalPaths.envelopeFile, " ");
    await reject(
      "private_score",
      "finalization-envelope-noncanonical",
      () =>
        scorePrivateSourceSearch(
          noncanonicalDir,
          noncanonicalPaths.envelopeFile,
          noncanonicalPaths.detailFile,
          noncanonicalPaths.receiptFile,
          authority,
          capability,
          "2026-07-15T00:00:09.000Z",
          SYNTHETIC_EVALUATOR_KEYS.privateKey,
        ),
      "H2_FINALIZATION_NONCANONICAL",
    );
    const keyRoot = path.join(root, "synthetic-private-evaluator");
    fs.mkdirSync(keyRoot);
    const keyAuthority = structuredClone(authority);
    keyAuthority.private_evaluator.canonical_root = fs.realpathSync(keyRoot);
    const evaluatorPem = SYNTHETIC_EVALUATOR_KEYS.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const validKey = path.join(keyRoot, "evaluator.key");
    fs.writeFileSync(validKey, evaluatorPem, { mode: 0o600, flag: "wx" });
    await accept("authority", "ed25519-key-path-safe", () =>
      evaluatorSigningKey(validKey, keyAuthority),
    );
    const hardLinkedKey = path.join(keyRoot, "evaluator-hardlink.key");
    fs.linkSync(validKey, hardLinkedKey);
    await reject("authority", "hard-linked-signing-key", () => evaluatorSigningKey(validKey, keyAuthority), "H2_FINALIZATION_KEY_UNSAFE");
    fs.unlinkSync(hardLinkedKey);
    const rsaKey = path.join(keyRoot, "rsa.key");
    fs.writeFileSync(
      rsaKey,
      crypto
        .generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
    await reject(
      "authority",
      "rsa-signing-key",
      () => evaluatorSigningKey(rsaKey, keyAuthority),
      "H2_FINALIZATION_KEY_TYPE",
    );
    const wrongKey = path.join(keyRoot, "wrong.key");
    fs.writeFileSync(
      wrongKey,
      crypto
        .generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600, flag: "wx" },
    );
    await reject(
      "authority",
      "wrong-ed25519-signing-key",
      () => evaluatorSigningKey(wrongKey, keyAuthority),
      "H2_FINALIZATION_WRONG_KEY",
    );
    const unsafeKey = path.join(keyRoot, "unsafe.key");
    fs.writeFileSync(unsafeKey, evaluatorPem, { mode: 0o644, flag: "wx" });
    await reject(
      "authority",
      "unsafe-mode-signing-key",
      () => evaluatorSigningKey(unsafeKey, keyAuthority),
      "H2_FINALIZATION_KEY_UNSAFE",
    );
    const symlinkKey = path.join(keyRoot, "symlink.key");
    fs.symlinkSync(validKey, symlinkKey);
    await reject(
      "authority",
      "symlink-signing-key",
      () => evaluatorSigningKey(symlinkKey, keyAuthority),
      "H2_FINALIZATION_KEY_UNSAFE",
    );
    const outsideKey = path.join(root, "outside.key");
    fs.writeFileSync(outsideKey, evaluatorPem, { mode: 0o600, flag: "wx" });
    await reject(
      "authority",
      "outside-route-signing-key",
      () => evaluatorSigningKey(outsideKey, keyAuthority),
      "H2_FINALIZATION_KEY_ROUTE",
    );
    const trackedAuthority = structuredClone(keyAuthority);
    trackedAuthority.private_evaluator.canonical_root = ROOT;
    await reject(
      "authority",
      "tracked-signing-key",
      () =>
        evaluatorSigningKey(path.join(ROOT, "package.json"), trackedAuthority),
      "H2_FINALIZATION_KEY_TRACKED",
    );
    const earlyReceipt = structuredClone(receipt);
    earlyReceipt.scored_at = authority.private_envelope_sealed_at;
    await reject("receipt", "receipt-score-equal-envelope-seal", () =>
      validatePrivateScoreReceiptValue(earlyReceipt, passDir, authority),
    );
    const normalizedAnswer = {
      ...envelope.expected,
      civic_number: `000${envelope.expected.civic_number}`,
      street: envelope.expected.street
        .toLocaleUpperCase("fr-CA")
        .replace(/^RUE\s+/u, "ST. "),
      place: envelope.expected.place
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLocaleUpperCase("fr-CA"),
      official_url: `${envelope.expected.official_url}#public-record`,
    };
    const normalizedDir = path.join(root, "normalized-answer");
    const normalizedPaths = makeSyntheticSearchWorkspace(
      normalizedDir,
      authority,
      capability,
      normalizedAnswer,
    );
    const normalizedScore = scorePrivateSourceSearch(
      normalizedDir,
      normalizedPaths.envelopeFile,
      normalizedPaths.detailFile,
      normalizedPaths.receiptFile,
      authority,
      capability,
      "2026-07-15T00:00:09.000Z",
    );
    await accept(
      "private_score",
      "generic-normalization-equivalent-answer-passes",
      () =>
        assert(
          normalizedScore.status === "private_source_search_score_passed",
          "normalized equivalent answer should pass",
        ),
    );
    const wrongAnswer = {
      ...envelope.expected,
      civic_number: `${envelope.expected.civic_number}9`,
      street: "Wrong Street",
      place: "Wrong Place",
    };
    const wrongDir = path.join(root, "wrong-answer");
    const wrongPaths = makeSyntheticSearchWorkspace(
      wrongDir,
      authority,
      capability,
      wrongAnswer,
    );
    const wrongScore = scorePrivateSourceSearch(
      wrongDir,
      wrongPaths.envelopeFile,
      wrongPaths.detailFile,
      wrongPaths.receiptFile,
      authority,
      capability,
      "2026-07-15T00:00:09.000Z",
    );
    await accept("private_score", "wrong-civic-street-place-fails", () =>
      assert(
        wrongScore.status === "private_source_search_score_failed" &&
          wrongScore.failure_codes.includes("MISMATCH_CIVIC_NUMBER") &&
          wrongScore.failure_codes.includes("MISMATCH_STREET") &&
          wrongScore.failure_codes.includes("MISMATCH_PLACE"),
        "wrong answer failure codes",
      ),
    );
    await reject("private_score", "failed-receipt-cannot-close", () =>
      validatePrivateScoreReceiptValue(
        load(wrongPaths.receiptFile),
        wrongDir,
        authority,
      ),
    );
    const unrelatedAnswer = {
      ...envelope.expected,
      official_url: `${RPCQ_ORIGIN}/rpcq/unrelated-record`,
    };
    const unrelatedDir = path.join(root, "unrelated-source");
    const unrelatedPaths = makeSyntheticSearchWorkspace(
      unrelatedDir,
      authority,
      capability,
      unrelatedAnswer,
    );
    const unrelatedScore = scorePrivateSourceSearch(
      unrelatedDir,
      unrelatedPaths.envelopeFile,
      unrelatedPaths.detailFile,
      unrelatedPaths.receiptFile,
      authority,
      capability,
      "2026-07-15T00:00:09.000Z",
    );
    await accept(
      "private_score",
      "unrelated-rpcq-url-fails-private-score",
      () =>
        assert(
          unrelatedScore.status === "private_source_search_score_failed" &&
            unrelatedScore.failure_codes.includes("MISMATCH_OFFICIAL_URL"),
          "unrelated official URL failure code",
        ),
    );
    for (const [label, mutate] of [
      [
        "receipt-boolean-only",
        (x: J) => {
          for (const key of [
            "source_task",
            "public_bundle",
            "prediction",
            "source_search_freeze",
            "private_detail",
            "expected_commitment",
            "evaluator_authority",
          ])
            delete x[key];
        },
      ],
      [
        "receipt-freeze-substitution",
        (x: J) => {
          x.source_search_freeze.sha256 = "0".repeat(64);
        },
      ],
      [
        "receipt-commitment-substitution",
        (x: J) => {
          x.expected_commitment.value = "0".repeat(64);
        },
      ],
      [
        "receipt-evaluator-substitution",
        (x: J) => {
          x.evaluator_authority.principal = authority.predictor.principal;
        },
      ],
      [
        "receipt-salt-leak",
        (x: J) => {
          x.salt_hex = envelope.salt_hex;
        },
      ],
      [
        "receipt-plaintext-leak",
        (x: J) => {
          x.expected = structuredClone(envelope.expected);
        },
      ],
    ] as [string, (x: J) => void][]) {
      const bad = structuredClone(receipt);
      mutate(bad);
      await reject("receipt", label, () =>
        validatePrivateScoreReceiptValue(bad, passDir, authority),
      );
    }
    const receiptLeak = structuredClone(receipt);
    receiptLeak.private_leak = "secret";
    await reject("receipt", "top-level-private-leak", () =>
      validatePrivateScoreReceiptValue(receiptLeak, passDir, authority),
    );
    const coherentForgery = structuredClone(receipt);
    coherentForgery.private_detail.sha256 = "a".repeat(64);
    coherentForgery.private_envelope.sha256 = "b".repeat(64);
    coherentForgery.scored_at = "2026-07-15T00:00:09.100Z";
    await reject(
      "receipt",
      "coherent-public-forgery",
      () =>
        validatePrivateScoreReceiptValue(coherentForgery, passDir, authority),
      "H2_RETENTION_EXACT_BYTES",
    );
    const substitutedPrivateHash = structuredClone(receipt);
    substitutedPrivateHash.private_detail.bytes += 1;
    await reject(
      "receipt",
      "substituted-private-detail-hash-bytes",
      () =>
        validatePrivateScoreReceiptValue(
          substitutedPrivateHash,
          passDir,
          authority,
        ),
      "H2_RETENTION_EXACT_BYTES",
    );
    const missingFinalization = structuredClone(receipt);
    delete missingFinalization.finalization_signature;
    await reject(
      "receipt",
      "missing-private-finalization",
      () =>
        validatePrivateScoreReceiptValue(
          missingFinalization,
          passDir,
          authority,
        ),
      "H2_FINALIZATION_MISSING",
    );
    const missingRetention = structuredClone(receipt);
    delete missingRetention.private_retention;
    await reject("receipt", "missing-private-retention", () => validatePrivateScoreReceiptValue(missingRetention, passDir, authority), "H2_RETENTION_MISSING");
    const wrongRetentionSignature = structuredClone(receipt);
    wrongRetentionSignature.private_retention.signature.signature_base64 = Buffer.alloc(64, 3).toString("base64");
    await reject("receipt", "wrong-retention-signature", () => validatePrivateScoreReceiptValue(wrongRetentionSignature, passDir, authority), "H2_RETENTION_SIGNATURE");
    const failedRetentionReadback = structuredClone(receipt);
    failedRetentionReadback.private_retention.objects[0].readback_verified = false;
    await reject("receipt", "failed-retention-readback", () => validatePrivateScoreReceiptValue(failedRetentionReadback, passDir, authority), "H2_RETENTION_READBACK");
    const publicRetentionAcl = structuredClone(receipt);
    publicRetentionAcl.private_retention.objects[0].no_public_acl = false;
    await reject("receipt", "public-retention-acl", () => validatePrivateScoreReceiptValue(publicRetentionAcl, passDir, authority), "H2_RETENTION_PUBLIC_ACL");
    const wrongKeyAuthority = structuredClone(authority);
    const wrongKeys = crypto.generateKeyPairSync("ed25519");
    wrongKeyAuthority.private_evaluator.signing_public_key_pem =
      wrongKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
    await reject(
      "receipt",
      "wrong-evaluator-public-key",
      () =>
        validatePrivateScoreReceiptValue(receipt, passDir, wrongKeyAuthority),
      "H2_RETENTION_SIGNER",
    );
    const wrongSignature = structuredClone(receipt);
    wrongSignature.finalization_signature.signature_base64 = Buffer.alloc(
      64,
      7,
    ).toString("base64");
    await reject(
      "receipt",
      "wrong-evaluator-signature",
      () =>
        validatePrivateScoreReceiptValue(wrongSignature, passDir, authority),
      "H2_FINALIZATION_SIGNATURE",
    );

    const finalDir = path.join(root, "final");
    fs.cpSync(passDir, finalDir, { recursive: true });
    const visualPrediction = syntheticCompletedPrediction(
      authority.bundle_tree_sha256,
    );
    const visualGold = syntheticGoldV21(authority.bundle_tree_sha256);
    for (const id of IMAGE_OPAQUE)
      visualPrediction.outputs.find(
        (row: J) => row.opaque_id === id,
      ).image_mode = visualGold.reviews.find(
        (row: J) => row.opaque_id === id,
      ).image_mode;
    for (const id of OCR_OPAQUE)
      visualPrediction.outputs.find((row: J) => row.opaque_id === id).ocr =
        visualGold.reviews.find(
          (row: J) => row.opaque_id === id,
        ).ocr_normalized;
    for (const id of SCENE_OPAQUE) {
      const p = visualPrediction.outputs.find((row: J) => row.opaque_id === id);
      const g = visualGold.reviews.find((row: J) => row.opaque_id === id);
      p.entities = g.entities.map((entity: J) => ({
        entity_id: entity.entity_id,
        surface: entity.surface,
        bbox: entity.bbox,
        type: entity.type,
        identity_decision: entity.identity_decision,
        identity: entity.supported_identity,
      }));
    }
    for (const id of AERIAL_OPAQUE) {
      const g = visualGold.reviews.find((row: J) => row.opaque_id === id);
      visualPrediction.outputs.find(
        (row: J) => row.opaque_id === id,
      ).aerial_labels = g.aerial_reviewable ? [...g.aerial_labels] : [];
    }
    const answered = visualPrediction.outputs.find(
      (row: J) => row.opaque_id === ABSTENTION_OPAQUE[0],
    );
    answered.abstention = { abstained: false, reason: null };
    writeJson(
      path.join(finalDir, "prediction-output-v2.json"),
      visualPrediction,
    );
    writeJson(path.join(finalDir, "gold-review-v2.json"), visualGold);
    freezePrediction(
      path.join(finalDir, "prediction-output-v2.json"),
      path.join(finalDir, "prediction-freeze-v2.json"),
      authority,
      capability,
      () => new Date(authority.freeze_at),
    );
    const visualFreeze = load(path.join(finalDir, "prediction-freeze-v2.json"));
    const rawVisualPrediction = fs.readFileSync(
      path.join(finalDir, "prediction-output-v2.json"),
    );
    const wrongVisualFreeze = structuredClone(visualFreeze);
    wrongVisualFreeze.prediction.sha256 = "0".repeat(64);
    await reject("prediction", "visual-freeze-substitution", () =>
      validateFreezeValue(
        wrongVisualFreeze,
        rawVisualPrediction,
        visualPrediction,
        authority,
      ),
    );
    const wrongVisualAuthorityFreeze = structuredClone(visualFreeze);
    wrongVisualAuthorityFreeze.principal = authority.search_predictor.principal;
    await reject("prediction", "visual-freeze-principal-substitution", () =>
      validateFreezeValue(
        wrongVisualAuthorityFreeze,
        rawVisualPrediction,
        visualPrediction,
        authority,
      ),
    );
    const goldAtSourceFreeze = structuredClone(visualGold);
    goldAtSourceFreeze.reviewer.reviewed_at = authority.source_search_freeze_at;
    await reject("final_chain", "gold-equal-source-search-freeze", () =>
      validateIndependentChronology(
        visualPrediction,
        goldAtSourceFreeze,
        visualFreeze,
        authority,
      ),
    );
    const goldBeforeSourceFreeze = structuredClone(visualGold);
    goldBeforeSourceFreeze.reviewer.reviewed_at = "2026-07-15T00:00:07.999Z";
    await reject("final_chain", "gold-before-source-search-freeze", () =>
      validateIndependentChronology(
        visualPrediction,
        goldBeforeSourceFreeze,
        visualFreeze,
        authority,
      ),
    );
    const finalReceipt = load(path.join(finalDir, PRIVATE_SCORE_RECEIPT_FILE));
    const resultEvidence = {
      execution_authorization: pin(
        path.join(finalDir, "execution-authorization-v2.json"),
        "execution-authorization-v2.json",
      ),
      prediction: pin(
        path.join(finalDir, "prediction-output-v2.json"),
        "prediction-output-v2.json",
      ),
      prediction_freeze: pin(
        path.join(finalDir, "prediction-freeze-v2.json"),
        "prediction-freeze-v2.json",
      ),
      gold_review: pin(
        path.join(finalDir, "gold-review-v2.json"),
        "gold-review-v2.json",
      ),
      source_task: pin(
        path.join(finalDir, SOURCE_SEARCH_TASK_FILE),
        SOURCE_SEARCH_TASK_FILE,
      ),
      private_score_receipt: pin(
        path.join(finalDir, PRIVATE_SCORE_RECEIPT_FILE),
        PRIVATE_SCORE_RECEIPT_FILE,
      ),
    };
    const finalTask = load(path.join(finalDir, SOURCE_SEARCH_TASK_FILE));
    const metrics = deriveMetrics(
      visualPrediction,
      visualGold,
      finalReceipt,
      authority,
      finalTask,
    );
    const results = {
      schema_version: "reviewed_metrics_results_v2.0.0",
      status: "completed",
      candidate_id: CANDIDATE_ID,
      evidence: resultEvidence,
      scoring: {
        algorithm: "reviewed-metrics-v2-deterministic-derivation-v1",
        scored_at: "2026-07-15T00:00:09.500Z",
      },
      metrics,
      criterion_matrix: {
        required_rows: FINAL_CRITERION_IDS.length,
        satisfied_rows: FINAL_CRITERION_IDS.length,
      },
      limitations: [],
    };
    writeJson(path.join(finalDir, "reviewed-metrics-v2.json"), results);
    await accept("final_chain", "receipt-derived-metrics", () =>
      validateResultsValue(results, finalDir, authority),
    );
    const metric = (rows: J[], id: string) =>
      rows.find((row: J) => row.metric_id === id);
    assert(
      metrics
        .filter((m: J) => m.metric_id.startsWith("place_link_"))
        .every((m: J) => canon(m.fixed_universe_ids) === canon([ISSUE_97_TASK_ID])),
      "place metrics require the exact source-only official-search task",
    );
    assert(
      metric(metrics, "place_link_precision").value === 1 &&
        metric(metrics, "place_link_coverage").value === 1,
      "signed source-task place baseline",
    );
    assert(
      metric(metrics, "aerial_exact_set_accuracy").included_ids.length === 12 &&
        metric(metrics, "aerial_exact_set_accuracy").excluded.length === 4,
      "aerial reviewed support partition",
    );
    assert(
      metric(metrics, "mask_iou").included_ids.length === 0 &&
        metric(metrics, "mask_iou").excluded.length === IMAGE_OPAQUE.length,
      "mask prerequisite exclusion partition",
    );
    await accept("final_chain", "metric-all-63-independent-full-row-hand-checks", () => { const expected = independentSyntheticMetricExpectations(); exactSet(metrics.map((row: J) => row.metric_id), [...expected.keys()], "independent 63-row metric fixture IDs"); for (const row of metrics) codedAssert(canon(row) === canon(expected.get(row.metric_id)), "H2_TEST_METRIC_FIXTURE", `independent full-row hand check failed for ${row.metric_id}`); });
    await accept("final_chain", "metric-ocr-normalization-hand-check", () => {
      const normalized = normalizePublicText("  École---du\nPORT!  ");
      codedAssert(
        normalized === "ecole du port",
        "H2_TEST_OCR_HAND_CHECK",
        "OCR normalization hand check",
      );
      codedAssert(
        levenshtein(Array.from("abc"), Array.from("adc")) === 1 &&
          levenshtein(["one", "two"], ["one", "too"]) === 1,
        "H2_TEST_OCR_HAND_CHECK",
        "CER/WER edit hand check",
      );
    });
    await accept("final_chain", "metric-ocr-empty-sequence-hand-check", () => { codedAssert(levenshtein(Array.from(""), Array.from("")) === 0 && levenshtein(Array.from("abc"), Array.from("")) === 3 && levenshtein([], ["one", "two"]) === 2, "H2_TEST_OCR_HAND_CHECK", "OCR empty sequence edit cases"); const undefinedCer = metricRow("ocr_cer", { character_edits: 0, gold_characters: 0 }, 0, 0, ["synthetic-hand-check"]); codedAssert(undefinedCer.status === "observed_undefined_zero_support" && undefinedCer.value === null && undefinedCer.denominator === 0, "H2_TEST_OCR_HAND_CHECK", "empty gold OCR denominator must remain zero and undefined"); });
    for (const [label, mutate, code] of [
      ["prediction-whitespace-surface", (x: J) => { x.outputs.find((row: J) => row.opaque_id === SCENE_OPAQUE[0]).entities[0].surface = "   "; }, "H2_ENTITY_PSEUDO_MENTION"],
      ["prediction-zero-area-box", (x: J) => { x.outputs.find((row: J) => row.opaque_id === SCENE_OPAQUE[0]).entities[0].bbox = [0, 0, 0, 1]; }, "H2_ENTITY_BBOX"],
      ["prediction-reversed-box", (x: J) => { x.outputs.find((row: J) => row.opaque_id === SCENE_OPAQUE[0]).entities[0].bbox = [0.8, 0, 0.2, 1]; }, "H2_ENTITY_BBOX"],
      ["prediction-duplicate-canonical-mention", (x: J) => { const row = x.outputs.find((item: J) => item.opaque_id === SCENE_OPAQUE[0]); const duplicate = structuredClone(row.entities[0]); duplicate.entity_id = "different-id"; row.entities.push(duplicate); }, "H2_ENTITY_DUPLICATE_MENTION"],
    ] as [string, (x: J) => void, string][]) { const bad = structuredClone(visualPrediction); mutate(bad); await reject("final_chain", label, () => validatePredictionValue(bad), code); }
    const mismatchedOcrGold = structuredClone(visualGold); mismatchedOcrGold.reviews.find((row: J) => row.opaque_id === OCR_OPAQUE[0]).ocr_normalized = "authored mismatch"; await reject("final_chain", "gold-authored-ocr-normalized-mismatch", () => validateGoldValue(mismatchedOcrGold), "H2_OCR_NORMALIZED_MISMATCH");
    const duplicateGoldMention = structuredClone(visualGold); { const row = duplicateGoldMention.reviews.find((item: J) => item.opaque_id === SCENE_OPAQUE[0]); const duplicate = structuredClone(row.entities[0]); duplicate.entity_id = "different-gold-id"; row.entities.push(duplicate); } await reject("final_chain", "gold-duplicate-canonical-mention", () => validateGoldValue(duplicateGoldMention), "H2_ENTITY_DUPLICATE_MENTION");
    const epsilonDuplicate = structuredClone(visualPrediction); { const row = epsilonDuplicate.outputs.find((item: J) => item.opaque_id === SCENE_OPAQUE[0]); const duplicate = structuredClone(row.entities[0]); duplicate.entity_id = "epsilon-duplicate"; duplicate.bbox = [0, 0, 0.999999, 1]; row.entities.push(duplicate); } await reject("final_chain", "prediction-epsilon-duplicate-mention", () => validatePredictionValue(epsilonDuplicate), "H2_ENTITY_DUPLICATE_MENTION");
    const oversizedMentions = structuredClone(visualPrediction); { const row = oversizedMentions.outputs.find((item: J) => item.opaque_id === SCENE_OPAQUE[0]); row.entities = Array.from({ length: 13 }, (_, index) => ({ ...structuredClone(row.entities[0]), entity_id: `oversized-${index}`, surface: `surface-${index}`, bbox: [index / 20, 0, (index + 1) / 20, 1] })); } await reject("final_chain", "prediction-entity-size-cap", () => validatePredictionValue(oversizedMentions), "H2_ENTITY_SIZE_CAP");
    const pseudoPlaceGold = structuredClone(visualGold); pseudoPlaceGold.reviews.find((row: J) => row.opaque_id === SCENE_OPAQUE[1]).place_opportunities = [{ opportunity_id: "arbitrary-scene-attachment" }]; await reject("final_chain", "gold-arbitrary-scene-attachment", () => validateGoldValue(pseudoPlaceGold), "H2_PLACE_VISUAL_ATTACHMENT");
    const pixelIdentityPrediction = structuredClone(visualPrediction); pixelIdentityPrediction.outputs.find((row: J) => row.opaque_id === SCENE_OPAQUE[2]).place_links = [{ opportunity_id: ISSUE_97_TASK_ID, civic_number: "1", street: "pixel-derived", place: "Montreal", official_url: RPCQ_ORIGIN, abstained: false }]; await reject("final_chain", "prediction-pixel-identity-place-attachment", () => validatePredictionValue(pixelIdentityPrediction), "H2_PLACE_VISUAL_ATTACHMENT");
    await accept(
      "final_chain",
      "metric-entity-maximum-matching-hand-check",
      () => {
        const predicted = [
          { surface: "A", type: "place", bbox: [0, 0, 0.7, 1] },
          { surface: "A", type: "place", bbox: [0.3, 0, 1, 1] },
        ];
        const reviewed = [
          { surface: "A", type: "place", bbox: [0, 0, 0.6, 1] },
          { surface: "A", type: "place", bbox: [0.4, 0, 1, 1] },
        ];
        const matches = maximumMentionMatching(predicted, reviewed);
        codedAssert(
          matches.length === 2 &&
            canon(matches.map(({ prediction, gold }) => [prediction, gold])) ===
              canon([
                [0, 0],
                [1, 1],
              ]),
          "H2_TEST_ENTITY_MATCHING",
          "ambiguous boxes require deterministic maximum matching",
        );
      },
    );
    await accept("final_chain", "metric-entity-12x12-polynomial-bound", () => {
      const predicted = Array.from({ length: 12 }, (_, index) => ({ surface: "A", type: "place", bbox: [0, 0, 1, 1], index }));
      const reviewed = Array.from({ length: 12 }, (_, index) => ({ surface: "A", type: "place", bbox: [0, 0, 1, 1], index }));
      const started = performance.now(); const matches = maximumMentionMatching(predicted, reviewed); const elapsed = performance.now() - started;
      codedAssert(matches.length === 12 && elapsed < 1_000, "H2_TEST_ENTITY_MATCHING", `12x12 assignment must complete within 1000ms, took ${elapsed}ms`);
      codedAssert(canon(matches.map(({ prediction, gold }) => [prediction, gold])) === canon(Array.from({ length: 12 }, (_, index) => [index, index])), "H2_TEST_ENTITY_MATCHING", "12x12 deterministic tie must select stable diagonal assignment");
    });
    await accept("final_chain", "metric-identity-is-mention-local", () => {
      const changedPrediction = structuredClone(visualPrediction);
      const changedGold = structuredClone(visualGold);
      const sceneId = SCENE_OPAQUE[0];
      const p = changedPrediction.outputs.find(
        (row: J) => row.opaque_id === sceneId,
      );
      const g = changedGold.reviews.find((row: J) => row.opaque_id === sceneId);
      p.entities = [
        {
          entity_id: "p-left",
          surface: "Bank",
          bbox: [0, 0, 0.4, 0.4],
          type: "organization",
          identity_decision: "linked",
          identity: "Right Bank",
        },
        {
          entity_id: "p-right",
          surface: "Bank",
          bbox: [0.6, 0.6, 1, 1],
          type: "organization",
          identity_decision: "linked",
          identity: "Left Bank",
        },
      ];
      g.entities = [
        {
          entity_id: "g-left",
          surface: "Bank",
          bbox: [0, 0, 0.4, 0.4],
          type: "organization",
          identity_decision: "linked",
          supported_identity: "Left Bank",
        },
        {
          entity_id: "g-right",
          surface: "Bank",
          bbox: [0.6, 0.6, 1, 1],
          type: "organization",
          identity_decision: "linked",
          supported_identity: "Right Bank",
        },
      ];
      const changed = deriveMetrics(
        changedPrediction,
        changedGold,
        finalReceipt,
        authority,
        finalTask,
      );
      const identity = metric(changed, "entity_false_identity_rate");
      codedAssert(
        identity.raw_counts.false_identities === 2 &&
          identity.raw_counts.linked_identity_predictions === 2 &&
          identity.value === 1,
        "H2_TEST_IDENTITY_LOCAL",
        "swapped identities must both be unsafe false identities",
      );
    });
    await accept(
      "final_chain",
      "metric-place-precision-coverage-diverge",
      () => {
        const changedReceipt = structuredClone(finalReceipt);
        changedReceipt.source_task_outcome.correct_supported_source_tasks = false;
        const changed = deriveMetrics(
          visualPrediction,
          visualGold,
          changedReceipt,
          authority,
          finalTask,
        );
        codedAssert(
          metric(changed, "place_link_precision").value === 0 &&
            metric(changed, "place_link_coverage").value === 1,
          "H2_TEST_PLACE_SEMANTICS",
          "wrong attempted link must reduce precision while preserving opportunity coverage",
        );
      },
    );
    const metricMutation = async (
      label: string,
      mutate: (prediction: J, gold: J) => void,
      metricId: string,
    ) => {
      const changedPrediction = structuredClone(visualPrediction);
      const changedGold = structuredClone(visualGold);
      mutate(changedPrediction, changedGold);
      const changed = deriveMetrics(
        changedPrediction,
        changedGold,
        finalReceipt,
        authority,
        finalTask,
      );
      await accept("final_chain", label, () =>
        codedAssert(
          canon(metric(changed, metricId)) !== canon(metric(metrics, metricId)),
          "H2_TEST_METRIC_NOT_RECOMPUTED",
          `${metricId} did not change from raw evidence`,
        ),
      );
    };
    await metricMutation(
      "metric-ocr-raw-recompute",
      (prediction) => {
        prediction.outputs.find(
          (row: J) => row.opaque_id === OCR_OPAQUE[0],
        ).ocr = "different OCR";
      },
      "ocr_cer",
    );
    await metricMutation(
      "metric-entity-raw-recompute",
      (prediction) => {
        prediction.outputs.find(
          (row: J) => row.opaque_id === SCENE_OPAQUE[0],
        ).entities = [];
      },
      "entity_recall",
    );
    await accept("final_chain", "metric-place-source-outcome-recompute", () => {
      const changedReceipt = structuredClone(finalReceipt);
      changedReceipt.source_task_outcome.correct_supported_source_tasks = false;
      const changed = deriveMetrics(visualPrediction, visualGold, changedReceipt, authority, finalTask);
      codedAssert(metric(changed, "place_link_precision").value === 0 && metric(changed, "place_link_coverage").value === 1, "H2_TEST_PLACE_SEMANTICS", "source-task precision and coverage derive from signed finalization outcome");
    });
    await metricMutation(
      "metric-image-mode-raw-recompute",
      (prediction) => {
        const row = prediction.outputs.find(
          (item: J) => item.opaque_id === IMAGE_OPAQUE[0],
        );
        row.image_mode = IMAGE_MODE_CLASSES.find(
          (name) => name !== row.image_mode,
        );
      },
      "image_mode_macro_f1",
    );
    await metricMutation(
      "metric-aerial-raw-recompute",
      (prediction) => {
        prediction.outputs.find(
          (row: J) => row.opaque_id === AERIAL_OPAQUE[0],
        ).aerial_labels = [];
      },
      "aerial_micro_f1",
    );
    await metricMutation(
      "metric-abstention-raw-recompute",
      (prediction) => {
        const row = prediction.outputs.find(
          (item: J) => item.opaque_id === ABSTENTION_OPAQUE[0],
        );
        row.abstention = { abstained: true, reason: "synthetic mutation" };
      },
      "abstention_coverage",
    );
    await accept("final_chain", "metric-timing-and-cost-evidence", () => {
      codedAssert(
        metric(metrics, "operation_timing_seconds").value === 2,
        "H2_TEST_TIMING_EVIDENCE",
        "actual session timing not derived",
      );
      codedAssert(
        metric(metrics, "model_tool_cost").status ===
          "unavailable_no_real_usage_receipt" &&
          metric(metrics, "model_tool_cost").raw_counts.real_usage_receipts ===
            0,
        "H2_TEST_COST_EVIDENCE",
        "cost unavailable evidence not explicit",
      );
    });
    const equalPrivateScore = structuredClone(results);
    equalPrivateScore.scoring.scored_at = finalReceipt.scored_at;
    await reject(
      "final_chain",
      "results-equal-private-score",
      () => validateResultsValue(equalPrivateScore, finalDir, authority),
      "H2_RESULTS_BEFORE_PRIVATE_SCORE",
    );
    const beforePrivateScore = structuredClone(results);
    beforePrivateScore.scoring.scored_at = "2026-07-15T00:00:08.800Z";
    await reject(
      "final_chain",
      "results-before-private-score",
      () => validateResultsValue(beforePrivateScore, finalDir, authority),
      "H2_RESULTS_BEFORE_PRIVATE_SCORE",
    );
    const task = load(path.join(finalDir, SOURCE_SEARCH_TASK_FILE));
    const dossierPins = {
      promotion_ledger: task.internal_provenance.promotion_ledger,
      review_receipt: task.internal_provenance.review_receipt,
      source_representation: task.internal_provenance.source_representation,
      source_acquisition: task.internal_provenance.source_acquisition,
    };
    const taskReview = {
      schema_version: "reviewed_metrics_search_task_review_v2.0.0",
      status: "completed",
      candidate_id: CANDIDATE_ID,
      task_pin: pin(
        path.join(finalDir, SOURCE_SEARCH_TASK_FILE),
        SOURCE_SEARCH_TASK_FILE,
      ),
      source_search_freeze_pin: pin(
        path.join(finalDir, SOURCE_SEARCH_FREEZE_FILE),
        SOURCE_SEARCH_FREEZE_FILE,
      ),
      public_score_receipt_pin: pin(
        path.join(finalDir, PRIVATE_SCORE_RECEIPT_FILE),
        PRIVATE_SCORE_RECEIPT_FILE,
      ),
      private_score_detail: finalReceipt.private_detail,
      expected_commitment: finalReceipt.expected_commitment,
      source_dossier_pins: dossierPins,
      authority_pins: {
        execution_authorization: pin(
          path.join(finalDir, "execution-authorization-v2.json"),
          "execution-authorization-v2.json",
        ),
        search_predictor: identityPin(authority.search_predictor),
        private_evaluator: identityPin(authority.private_evaluator),
        task_reviewer: identityPin(authority.task_reviewer),
      },
      reviewer: {
        identity: authority.task_reviewer.principal,
        session_id: authority.task_reviewer.session_id,
        model: authority.task_reviewer.model,
        reasoning_effort: authority.task_reviewer.reasoning_effort,
        reviewed_at: "2026-07-15T00:00:10.000Z",
        independent: true,
      },
      checks: {
        source_dossier_approved: true,
        accepted_source_claim: true,
        rights_passed: true,
        no_leak_passed: true,
        component_split_pinned: true,
        separate_reviewer: true,
      },
      disposition: "accepted",
      rationale:
        "Synthetic contract-only review derived from the exact passing receipt.",
    };
    writeJson(path.join(finalDir, "search-task-review-v2.json"), taskReview);
    await accept("final_chain", "task-review-derived-pass", () =>
      validateTaskReviewValue(taskReview, finalDir, authority),
    );
    assert(
      !("private_score_passed" in taskReview.checks),
      "private_score_passed must not be authored trust",
    );
    for (const [label, mutate] of [
      [
        "task-review-freeze-substitution",
        (x: J) => {
          x.source_search_freeze_pin.sha256 = "0".repeat(64);
        },
      ],
      [
        "task-review-detail-substitution",
        (x: J) => {
          x.private_score_detail.bytes += 1;
        },
      ],
      [
        "task-review-commitment-substitution",
        (x: J) => {
          x.expected_commitment.value = "0".repeat(64);
        },
      ],
      [
        "task-review-dossier-substitution",
        (x: J) => {
          x.source_dossier_pins.review_receipt.sha256 = "0".repeat(64);
        },
      ],
      [
        "task-review-authority-substitution",
        (x: J) => {
          x.authority_pins.private_evaluator.principal =
            authority.predictor.principal;
        },
      ],
      [
        "task-review-authored-boolean",
        (x: J) => {
          x.checks.private_score_passed = true;
        },
      ],
    ] as [string, (x: J) => void][]) {
      const bad = structuredClone(taskReview);
      mutate(bad);
      await reject("final_chain", label, () =>
        validateTaskReviewValue(bad, finalDir, authority),
      );
    }
    fs.copyFileSync(
      path.join(FIXTURE, "input-authority-v2.json"),
      path.join(finalDir, "input-authority-v2.json"),
    );
    fs.copyFileSync(
      path.join(FIXTURE, "candidate-descriptor-v2.json"),
      path.join(finalDir, "candidate-descriptor-v2.json"),
    );
    const rolePins: Record<string, J> = {};
    for (const [role, filename] of Object.entries(FINAL_EVIDENCE_PATHS))
      rolePins[role] = {
        ...pin(resolveEvidencePath(filename, finalDir), filename),
        role,
      };
    const finalRows = FINAL_CRITERION_IDS.map((criterion_id) => {
      const requirement = FINAL_MATRIX_REQUIREMENTS[criterion_id];
      return {
        criterion_id,
        required: true,
        verdict: "satisfied",
        result_ids: requirement.results,
        evidence: requirement.roles.map((role) =>
          structuredClone(rolePins[role]),
        ),
        limitations: [],
      };
    });
    const matrix = {
      schema_version: "reviewed_metrics_final_criterion_matrix_v2.0.0",
      status: "final",
      candidate_id: CANDIDATE_ID,
      rows: finalRows,
      issue_92_complete: true,
      issue_69_complete: true,
    };
    writeJson(path.join(finalDir, "final-criterion-matrix-v2.json"), matrix);
    await accept("final_chain", "final-matrix-exact-chain", () =>
      validateMatrixValue(matrix, finalDir, authority),
    );
    const remappedAuthorityMatrix = structuredClone(matrix);
    const remappedInput = remappedAuthorityMatrix.rows
      .flatMap((row: J) => row.evidence)
      .find((item: J) => item.role === "input_authority");
    remappedInput.path = "input-authority-v2.json";
    remappedInput.sha256 = pin(
      path.join(finalDir, "input-authority-v2.json"),
      "input-authority-v2.json",
    ).sha256;
    await reject("final_chain", "matrix-canonical-input-authority-remap", () =>
      validateMatrixValue(remappedAuthorityMatrix, finalDir, authority),
    );
    for (const role of [
      "source_search_bundle",
      "source_search_prediction",
      "source_search_freeze",
      "private_score_receipt",
      "search_task",
      "task_review",
    ]) {
      const bad = structuredClone(matrix);
      const evidence = bad.rows
        .flatMap((row: J) => row.evidence)
        .find((item: J) => item.role === role);
      evidence.sha256 = "0".repeat(64);
      await reject("final_chain", `matrix-${role}-substitution`, () =>
        validateMatrixValue(bad, finalDir, authority),
      );
    }
    const memberPins = tree(finalDir).members;
    const dynamic = Object.fromEntries(
      Object.entries(PUBLICATION_DYNAMIC_PREDECESSORS).map(
        ([role, filename]) => [
          role,
          pin(path.join(finalDir, filename), filename),
        ],
      ),
    );
    const publication = {
      schema_version: "reviewed_metrics_publication_descriptor_v2.0.0",
      artifact_id: PUBLICATION_ID,
      status: "published",
      created_at: "2026-07-15T00:00:11.000Z",
      implementation_base_commit: IMPLEMENTATION_BASE_COMMIT,
      candidate_commit: authority.candidate_commit,
      members_before_descriptor: memberPins,
      tree_before_descriptor_sha256: tree(finalDir).sha256,
      counts: {
        files_before_descriptor: memberPins.length,
        bytes_before_descriptor: memberPins.reduce(
          (sum: number, member: J) => sum + member.bytes,
          0,
        ),
        unique_sources: 44,
        task_memberships: 78,
        published_members: memberPins.length + 1,
      },
      predecessors: { ...predecessorPins(), ...dynamic },
      completion: {
        candidate_complete: true,
        issue_92_complete: true,
        issue_69_complete: true,
        publication_exists: true,
      },
      mutations: {
        production: false,
        search_index: false,
        private_object_store_write: false,
        paid_gpu: false,
      },
      required_publication_members: PUBLICATION_MEMBER_PATHS,
      publisher: {
        principal: authority.publisher.principal,
        session_id: authority.publisher.session_id,
        model: authority.publisher.model,
        role: authority.publisher.role,
        published_at: "2026-07-15T00:00:11.000Z",
      },
    };
    await accept("final_chain", "publication-exact-chain", () =>
      validatePublicationValue(publication, finalDir, authority),
    );
    const repinPublicationArithmetic = (candidate: J) => {
      candidate.members_before_descriptor.sort((a: J, b: J) =>
        a.path.localeCompare(b.path),
      );
      candidate.tree_before_descriptor_sha256 = hash(
        `${candidate.members_before_descriptor.map((x: J) => `${x.path}\t${x.sha256}\t${x.bytes}`).join("\n")}\n`,
      );
      candidate.counts.files_before_descriptor =
        candidate.members_before_descriptor.length;
      candidate.counts.bytes_before_descriptor =
        candidate.members_before_descriptor.reduce(
          (sum: number, member: J) => sum + member.bytes,
          0,
        );
      candidate.counts.published_members =
        candidate.members_before_descriptor.length + 1;
    };
    const missingMemberPublication = structuredClone(publication);
    missingMemberPublication.members_before_descriptor.pop();
    repinPublicationArithmetic(missingMemberPublication);
    await reject(
      "final_chain",
      "publication-member-universe-missing",
      () =>
        validatePublicationValue(missingMemberPublication, finalDir, authority),
      "H2_PUBLICATION_EXACT_UNIVERSE",
    );
    const duplicateMemberPublication = structuredClone(publication);
    duplicateMemberPublication.members_before_descriptor.push(
      structuredClone(duplicateMemberPublication.members_before_descriptor[0]),
    );
    repinPublicationArithmetic(duplicateMemberPublication);
    await reject(
      "final_chain",
      "publication-member-universe-duplicate",
      () =>
        validatePublicationValue(
          duplicateMemberPublication,
          finalDir,
          authority,
        ),
      "H2_PUBLICATION_EXACT_UNIVERSE",
    );
    for (const role of [
      "source_search_bundle",
      "source_search_prediction",
      "source_search_freeze",
      "private_score_receipt",
      "search_task",
      "task_review",
    ]) {
      const bad = structuredClone(publication);
      bad.predecessors[role].sha256 = "0".repeat(64);
      await reject("final_chain", `publication-${role}-substitution`, () =>
        validatePublicationValue(bad, finalDir, authority),
      );
    }
    const publicationMarker = path.join(
      finalDir,
      "publication-descriptor-v2.json",
    );
    writeJson(publicationMarker, publication);
    await accept("final_chain", "publication-commit-marker-exact-bytes", () =>
      validatePublicationValue(publication, finalDir, authority),
    );
    fs.appendFileSync(publicationMarker, " ");
    await reject("final_chain", "publication-commit-marker-byte-mutation", () =>
      validatePublicationValue(publication, finalDir, authority),
    );
    return {
      status: "source_search_self_test_passed",
      cases,
      adversarial_rejections: rejections,
      accepted_foundations: cases - rejections,
      case_groups: groups,
      rejection_codes: rejectionCodes,
      synthetic_only_private_score: true,
      real_authority_created: false,
      private_envelope_committed: false,
      production_mutation: false,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function selfTest(): Promise<J> {
  const baseline = await baselineContractSelfTest();
  const sourceSearch = await sourceSearchSelfTest();
  return {
    status: "self_test_passed",
    executed_tests: {
      current_final_chain: baseline.executed_test_ids,
      source_search: sourceSearch.case_groups,
    },
    rejection_codes: sourceSearch.rejection_codes,
    synthetic_only_private_score: true,
    real_authority_created: false,
    private_envelope_committed: false,
    production_mutation: false,
  };
}
async function integrationTest(): Promise<J> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmv2-int-"));
  try {
    const candidate = path.join(root, "candidate");
    await build(candidate);
    const authority = load(path.join(candidate, "input-authority-v2.json"));
    const capability: InternalSyntheticCapability = {
      [INTERNAL_SYNTHETIC_CAPABILITY]: true,
    };
    const one = path.join(root, "bundle-a");
    const two = path.join(root, "bundle-b");
    const a = await buildBlindBundle(one);
    const b = await buildBlindBundle(two, authority, capability);
    const normalized = (dir: string) =>
      tree(dir).members.map((x: J) => ({ ...x, path: x.path }));
    same(normalized(one), normalized(two), "blind deterministic replay");
    assert(a.tree_sha256 === b.tree_sha256, "blind tree nondeterminism");
    const publicOne = path.join(root, "public-source-a");
    const publicTwo = path.join(root, "public-source-b");
    const publicA = buildSourceSearchBundle(publicOne);
    const publicB = buildSourceSearchBundle(publicTwo);
    assert(
      publicA.tree_sha256 === publicB.tree_sha256,
      "public source-search bundle nondeterminism",
    );
    same(
      normalized(publicOne),
      normalized(publicTwo),
      "public source-search bundle exact replay",
    );
    const templateP = path.join(
      candidate,
      "prediction-output.template-v2.json",
    );
    const templateG = path.join(candidate, "gold-review.template-v2.json");
    const score = path.join(root, "synthetic-score.json");
    scoreSynthetic(templateP, templateG, score, {
      [INTERNAL_SYNTHETIC_CAPABILITY]: true,
    });
    const unified = syntheticAuthorityV21(
      load(path.join(one, "blind-bundle-descriptor-v2.json")).media_tree.sha256,
    );
    const sourceDir = path.join(root, "source-chain");
    const sourcePaths = makeSyntheticSearchWorkspace(
      sourceDir,
      unified,
      capability,
    );
    const privateScore = scorePrivateSourceSearch(
      sourceDir,
      sourcePaths.envelopeFile,
      sourcePaths.detailFile,
      sourcePaths.receiptFile,
      unified,
      capability,
      "2026-07-15T00:00:09.000Z",
    );
    assert(
      privateScore.status === "private_source_search_score_passed",
      "synthetic source-search integration score",
    );
    return {
      status: "integration_test_passed",
      deterministic_bundle_tree_sha256: a.tree_sha256,
      public_source_search_bundle_tree_sha256: publicA.tree_sha256,
      public_source_search_bundle_schema_sha256: publicA.output_schema_sha256,
      media_members: 44,
      synthetic_visual_contract_only: true,
      synthetic_source_search_chain: "passed_via_internal_capability",
      source_search_private_detail_persisted: false,
      real_authority_created: false,
      normal_score_cli_requires_committed_unified_authority_and_both_freezes: true,
      normal_score_cli_available_in_current_candidate: false,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function syntheticCompletedPrediction(bundle: string): J {
  let aerialSeen = 0;
  return {
    schema_version: "reviewed_metrics_prediction_output_v2.0.0",
    status: "completed",
    candidate_id: CANDIDATE_ID,
    bundle_tree_sha256: bundle,
    session: {
      principal: "synthetic-predictor",
      session_id: "synthetic-prediction-session",
      model: "synthetic-model",
      reasoning_effort: "synthetic",
      route: actor("predictor").route,
      started_at: "2026-07-15T00:00:02.000Z",
      ended_at: "2026-07-15T00:00:03.000Z",
    },
    outputs: FIXED_OPAQUE_IDS.map((opaque_id, index) => {
      const scene = SCENE_OPAQUE.includes(opaque_id);
      const aerial = AERIAL_OPAQUE.includes(opaque_id);
      const aerialReviewable = aerial && aerialSeen++ < 12;
      const answerable = index % 2 === 0;
      return {
        opaque_id,
        image_mode: IMAGE_OPAQUE.includes(opaque_id)
          ? IMAGE_MODE_CLASSES[index % IMAGE_MODE_CLASSES.length]
          : null,
        ocr: OCR_OPAQUE.includes(opaque_id) ? `synthetic ocr ${index}` : null,
        entities: scene
          ? [
              {
                entity_id: `entity-${index}`,
                surface: "Synthetic",
                bbox: [0, 0, 1, 1],
                type: "place",
                identity_decision: "surface_only",
                identity: null,
              },
            ]
          : [],
        place_links: [],
        aerial_labels: aerialReviewable ? ["mixed_urban"] : [],
        abstention: {
          abstained: ABSTENTION_OPAQUE.includes(opaque_id)
            ? !answerable
            : false,
          reason:
            ABSTENTION_OPAQUE.includes(opaque_id) && !answerable
              ? "synthetic unanswerable"
              : null,
        },
      };
    }),
    required_opaque_ids: FIXED_OPAQUE_IDS,
    attestations: {
      no_gold_received: true,
      no_expected_answers_received: true,
      no_repo_access: true,
      one_run_only: true,
    },
  };
}
function syntheticCompletedGold(bundle: string): J {
  let aerialSeen = 0;
  return {
    schema_version: "reviewed_metrics_gold_review_authority_v2.0.0",
    status: "completed",
    candidate_id: CANDIDATE_ID,
    bundle_tree_sha256: bundle,
    reviewer: {
      identity: "synthetic-gold-reviewer",
      session_id: "synthetic-gold-session",
      model: "synthetic-gold-model",
      reasoning_effort: "synthetic",
      reviewed_at: "2026-07-15T00:00:08.600Z",
      independence: {
        prediction_blind: true,
        no_implementation_overlap: true,
        no_predictor_overlap: true,
        distinct_session: true,
      },
    },
    reviews: FIXED_OPAQUE_IDS.map((opaque_id, index) => {
      const aerial = AERIAL_OPAQUE.includes(opaque_id);
      const reviewable = aerial && aerialSeen++ < 12;
      const scene = SCENE_OPAQUE.includes(opaque_id);
      return {
        opaque_id,
        image_mode: IMAGE_OPAQUE.includes(opaque_id)
          ? IMAGE_MODE_CLASSES[index % IMAGE_MODE_CLASSES.length]
          : null,
        ocr_raw: OCR_OPAQUE.includes(opaque_id)
          ? `Synthetic OCR ${index}`
          : null,
        ocr_normalized: OCR_OPAQUE.includes(opaque_id)
          ? `synthetic ocr ${index}`
          : null,
        entities: scene
          ? [
              {
                entity_id: `entity-${index}`,
                surface: "Synthetic",
                bbox: [0, 0, 1, 1],
                type: "place",
                identity_decision: "surface_only",
                supported_identity: null,
              },
            ]
          : [],
        place_opportunities: [],
        aerial_reviewable: aerial ? reviewable : null,
        aerial_labels: aerial
          ? reviewable
            ? ["mixed_urban"]
            : ["unreviewable"]
          : [],
        answerable: ABSTENTION_OPAQUE.includes(opaque_id)
          ? index % 2 === 0
          : null,
        exclusion: null,
      };
    }),
    required_opaque_ids: FIXED_OPAQUE_IDS,
    reviewed_exclusions: [],
  };
}
function syntheticSurfaceInventory(role: string): J {
  return { kind: "local_host", stable_host_uuid: `synthetic-host-uuid-${hash(role).slice(0, 32)}` };
}
function actor(role: string): J {
  const requested = `/synthetic-isolation/${role}`;
  const physical = nearestExistingPhysicalRoot(requested);
  const inventory = syntheticSurfaceInventory(role);
  return {
    principal: `synthetic-${role}`,
    session_id: `synthetic-${role}-session`,
    model: `synthetic-${role}-model`,
    reasoning_effort: "synthetic",
    route: physical.canonicalRoot,
    surface_id: trustedSurfaceId(inventory),
    surface_inventory_digest: trustedInventoryDigest(inventory),
    route_nonce: hash(`synthetic-one-shot-nonce:${role}`).slice(0, 32),
    canonical_root: physical.canonicalRoot,
    role,
  };
}
function sealSyntheticAuthority(authority: J): J {
  const coordinatorPem = SYNTHETIC_COORDINATOR_KEYS.publicKey.export({ type: "spki", format: "pem" }).toString();
  authority.coordinator_trust = { public_key_pem: coordinatorPem, public_key_sha256: hash(coordinatorPem) };
  const roles = ["implementation", "predictor", "search_predictor", "private_evaluator", "gold_reviewer", "task_reviewer", "publisher"];
  authority.trusted_surface_inventory = roles.map(syntheticSurfaceInventory);
  const authorityHash = authorityBindingHash(authority);
  roles.forEach((role, index) => {
    const actorValue = authority[role];
    const physical = nearestExistingPhysicalRoot(actorValue.route);
    const receipt: J = {
      schema_version: "reviewed_metrics_coordinator_route_receipt_v2.0.0",
      surface_id: actorValue.surface_id,
      surface_inventory_digest: actorValue.surface_inventory_digest,
      candidate_commit: authority.candidate_commit,
      authority_hash: authorityHash,
      nonce: actorValue.route_nonce,
      role,
      requested_root: actorValue.route,
      canonical_root: physical.canonicalRoot,
      existing_ancestor: physical.existingAncestor,
      ancestor_device: physical.stat.dev,
      ancestor_inode: physical.stat.ino,
      issued_at: `2026-07-15T00:00:0${index + 1}.100Z`,
      expires_at: `2026-07-15T00:05:0${index + 1}.100Z`,
      signature_base64: "",
    };
    receipt.signature_base64 = crypto.sign(null, routeReceiptPayload(receipt), SYNTHETIC_COORDINATOR_KEYS.privateKey).toString("base64");
    actorValue.route_receipt = receipt;
  });
  return authority;
}
function syntheticExecutionAuthority(bundle: string): J {
  const v1 = load(path.join(V1, "independent-task-review-v1.json")).reviewer;
  const gateE = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json",
    ),
  ).reviewer;
  const gateF = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json",
    ),
  ).reviewer;
  const gateG = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/verified-dossiers-publication-v1/independent-dossier-review-v1.json",
    ),
  ).reviewer;
  return sealSyntheticAuthority({
    schema_version: "reviewed_metrics_execution_authorization_v2.2.0",
    status: "activated_exact_one_shot",
    candidate_id: CANDIDATE_ID,
    implementation_base_commit: IMPLEMENTATION_BASE_COMMIT,
    candidate_commit: SYNTHETIC_CANDIDATE_COMMIT,
    bundle_tree_sha256: bundle,
    implementation: actor("implementation"),
    predictor: {
      ...actor("predictor"),
      principal: "synthetic-predictor",
      session_id: "synthetic-prediction-session",
      model: "synthetic-model",
    },
    gold_reviewer: {
      ...actor("gold_reviewer"),
      principal: "synthetic-gold-reviewer",
      session_id: "synthetic-gold-session",
      model: "synthetic-gold-model",
    },
    task_reviewer: actor("task_reviewer"),
    publisher: actor("publisher"),
    search_predictor: {
      ...actor("search_predictor"), principal: "synthetic-search-predictor", session_id: "synthetic-search-prediction-session", model: "synthetic-search-model",
    },
    private_evaluator: {
      ...actor("private_evaluator"), principal: "synthetic-private-evaluator", session_id: "synthetic-private-evaluator-session", model: "synthetic-private-evaluator-model",
      signing_public_key_pem: SYNTHETIC_EVALUATOR_KEYS.publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    forbidden_prior_reviewers: [
      {
        principal: v1.identity,
        session_id: v1.session_id,
        model: v1.model,
        role: "forbidden_prior_reviewer",
      },
      {
        principal: gateE.identity,
        session_id: gateE.review_session_id,
        model: gateE.model_route,
        role: "forbidden_prior_reviewer",
      },
      {
        principal: gateF.reviewer_id,
        session_id: gateF.session_id,
        model: gateF.model,
        role: "forbidden_prior_reviewer",
      },
      {
        principal: gateG.reviewer_id,
        session_id: gateG.session_id,
        model: gateG.model,
        role: "forbidden_prior_reviewer",
      },
    ],
    authorized_at: "2026-07-15T00:00:01.000Z",
    started_at: "2026-07-15T00:00:02.000Z",
    ended_at: "2026-07-15T00:00:03.000Z",
    freeze_at: "2026-07-15T00:00:04.000Z",
    source_search_started_at: "2026-07-15T00:00:06.000Z",
    source_search_ended_at: "2026-07-15T00:00:07.000Z",
    source_search_freeze_at: "2026-07-15T00:00:08.000Z",
    source_dossier_authored_at: "2026-07-15T00:00:08.200Z",
    private_envelope_sealed_at: "2026-07-15T00:00:08.400Z",
    expires_at: "2026-07-15T00:20:00.000Z",
  });
}
function syntheticCompletedResults(
  prediction: J,
  gold: J,
  evidence: J,
  privateReceipt: J,
  authority: J,
  sourceTask: J,
): J {
  const metrics = deriveMetrics(
    prediction,
    gold,
    privateReceipt,
    authority,
    sourceTask,
  );
  const complete = exactMetricCompletion(metrics);
  return {
    schema_version: "reviewed_metrics_results_v2.0.0",
    status: "completed",
    candidate_id: CANDIDATE_ID,
    evidence,
    scoring: {
      algorithm: "reviewed-metrics-v2-deterministic-derivation-v1",
      scored_at: "2026-07-15T00:00:09.500Z",
    },
    metrics,
    criterion_matrix: {
      required_rows: FINAL_CRITERION_IDS.length,
      satisfied_rows: complete
        ? FINAL_CRITERION_IDS.length
        : FINAL_CRITERION_IDS.length - 1,
    },
    limitations: complete ? [] : ["Exact metric universe incomplete."],
  };
}
async function main(): Promise<void> {
  const command = process.argv[2] ?? "verify";
  const parsed = parseArgs({
    args: process.argv.slice(3),
    options: {
      output: { type: "string" },
      input: { type: "string" },
      gold: { type: "string" },
      freeze: { type: "string" },
      bundle: { type: "string" },
      envelope: { type: "string" },
      detail: { type: "string" },
      workspace: { type: "string" },
      "signing-key": { type: "string" },
      "retention-receipt": { type: "string" },
    },
    allowPositionals: false,
  });
  const o = parsed.values;
  let result: J;
  if (command === "build")
    result = await build(o.output ? path.resolve(o.output) : FIXTURE);
  else if (command === "build-blind-bundle")
    result = await buildBlindBundle(
      path.resolve(assertString(o.output, "--output required")),
    );
  else if (command === "build-source-search-bundle")
    result = buildSourceSearchBundle(
      path.resolve(assertString(o.output, "--output required")),
    );
  else if (command === "verify")
    result = await verifyCandidate(o.output ? path.resolve(o.output) : FIXTURE);
  else if (command === "verify-tracked")
    result = {
      status: "tracked_candidates_verified",
      v1: verifyV1Tracked(),
      v2: await verifyCandidate(FIXTURE, true),
      publication: {
        artifact_id: PUBLICATION_ID,
        exists: false,
        verified: false,
        required_for_issue_close: true,
      },
    };
  else if (command === "validate-prediction")
    result = validatePrediction(assertString(o.input, "--input required"));
  else if (command === "freeze-prediction")
    result = freezePrediction(
      path.resolve(assertString(o.input, "--input required")),
      path.resolve(assertString(o.output, "--output required")),
    );
  else if (command === "validate-source-search-prediction") {
    const file = path.resolve(assertString(o.input, "--input required"));
    validateSourceSearchPredictionValue(load(file), path.dirname(file));
    result = { status: "source_search_prediction_valid" };
  } else if (command === "freeze-source-search-prediction")
    result = freezeSourceSearchPrediction(
      path.resolve(assertString(o.input, "--input required")),
      path.resolve(assertString(o.bundle, "--bundle required")),
      path.resolve(assertString(o.output, "--output required")),
    );
  else if (command === "validate-private-expected-envelope") {
    validatePrivateExpectedEnvelopeValue(
      load(path.resolve(assertString(o.input, "--input required"))),
      undefined,
      executionAuthority(),
    );
    result = { status: "private_expected_envelope_valid" };
  } else if (command === "score-source-search")
    result = scorePrivateSourceSearch(
      path.resolve(assertString(o.workspace, "--workspace required")),
      path.resolve(assertString(o.envelope, "--envelope required")),
      path.resolve(assertString(o.detail, "--detail required")),
      path.resolve(assertString(o.output, "--output required")),
      undefined,
      undefined,
      undefined,
      path.resolve(assertString(o["signing-key"], "--signing-key required")),
      undefined,
      o["retention-receipt"] ? path.resolve(o["retention-receipt"]) : undefined,
    );
  else if (command === "validate-gold")
    result = validateGold(assertString(o.input, "--input required"));
  else if (command === "score")
    result = scoreCompleted(
      path.resolve(assertString(o.input, "--input prediction required")),
      path.resolve(assertString(o.freeze, "--freeze required")),
      path.resolve(assertString(o.gold, "--gold required")),
      path.resolve(assertString(o.output, "--output required")),
    );
  else if (command === "validate-task-review") {
    const file = path.resolve(assertString(o.input, "--input required"));
    const value = load(file);
    if (value.status === "completed")
      validateTaskReviewValue(value, path.dirname(file), executionAuthority());
    else validateTaskReviewValue(value, path.dirname(file));
    result = {
      status:
        value.status === "completed"
          ? "task_review_completed_valid"
          : "task_review_placeholder_valid",
    };
  } else if (command === "publish")
    throw new Error(
      "v2 publication is issue #97 scope and requires completed external authorities",
    );
  else if (command === "self-test") result = await selfTest();
  else if (command === "integration-test") result = await integrationTest();
  else throw new Error(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
function assertString(value: string | undefined, message: string): string { assert(value, message); return value; }
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
