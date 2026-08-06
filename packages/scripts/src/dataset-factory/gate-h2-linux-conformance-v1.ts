import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Case = {
  id: string;
  category: string;
  evidence_kind: string;
  required_for_production: boolean;
};
type Pin = {
  path: string;
  sha256: string;
  bytes: number;
  media_type: string;
  kind: string;
  schema_version: "v1";
};
type Result = {
  case_id: string;
  outcome: "pass" | "fail" | "skipped";
  evidence: Pin;
};
type FilePin = { path: string; sha256: string; bytes: number };
type Predecessor = {
  artifact_id: string;
  sorted_tree_sha256: string;
  commit: string;
  pins: {
    podman_descriptor: FilePin;
    https_broker_descriptor: FilePin;
    source_allowlist: FilePin;
  };
  schema_commitments: {
    podman_descriptor_schema_version: string;
    https_broker_descriptor_schema_version: string;
    inherited_descriptor_sha256: string;
  };
};
type Universe = {
  schema_version: string;
  version: string;
  predecessor: Predecessor;
  cases: Case[];
  universe_sha256: string;
};
type Metadata = {
  predecessor: Predecessor;
  source: { commit: string; tree: string; source_manifest_sha256: string };
  builder_image: { reference: string; digest: string };
  admitted_oci_image: { reference: string; digest: string };
  podman: {
    executable_pin: { path: string; sha256: string; bytes: number };
    version: string;
    rootless: boolean;
    rootless_uid: number;
  };
  host: { platform: string; kernel_release: string; architecture: string };
  producer: { principal: string; run_id: string };
};
type Bundle = {
  schema_version: string;
  status: "synthetic_local_fixture" | "observed_real_linux_conformance";
  synthetic: boolean;
  production_eligible: boolean;
  metadata: Metadata;
  metadata_sha256: string;
  universe_sha256: string;
  results: Result[];
};
type Options = { bundleRoot: string; evidenceRoot: string; strict: boolean };
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const SELF_TEST_ROOT = path.join(ROOT, ".gate-h2-linux-conformance-self-test");
const FIXTURE = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/gate-h2-linux-conformance-v1",
);
const SCHEMAS = path.join(
  ROOT,
  "docs/dataset-factory/schemas/reviewed-metrics-v2",
);
const UNIVERSE_SCHEMA = path.join(
  SCHEMAS,
  "gate-h2-linux-conformance-universe.schema.v1.json",
);
const BUNDLE_SCHEMA = path.join(
  SCHEMAS,
  "gate-h2-linux-conformance-run-evidence.schema.v1.json",
);
const ARTIFACT_REGISTRY = path.join(
  ROOT,
  "docs/dataset-factory/artifact-registry.v0.jsonl",
);
const PREDECESSOR_FIXTURE = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/podman-supervisor-v1",
);
const PREDECESSOR_FIXTURE_FILES = [
  "adversarial-contract-cases-v1.json",
  "canonical-json-utf8-golden-v1.json",
  "nested-directory-tree-hash-v1.json",
  "source-descriptor-v2.json",
  "synthetic-config-v1.json",
] as const;
const LINUX_CONFORMANCE_ARTIFACT_ID =
  "dfv0_gate_h2_linux_conformance_v1_20260806";
const LINUX_CONFORMANCE_DEPENDENCY_IDS = [
  "dfv0_gate_h2_podman_supervisor_v1_20260718",
] as const;
const LINUX_CONFORMANCE_REGISTRY_BINDING = {
  locator: "docs/dataset-factory/fixtures/gate-h2-linux-conformance-v1",
  digest: {
    algorithm: "sha256",
    scope: "sorted_tree_manifest",
    value: "35f9fce74cde23ab961b789259a6ad950d32bdee5ef1ff4c6ad67a378e8fa571",
  },
  counts: { file_count: 71, byte_count: 44881 },
} as const;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:([a-f0-9]{64})$/;
const OCI_REFERENCE = /^[a-z0-9][a-z0-9./:_-]*@sha256:([a-f0-9]{64})$/;
const PLACEHOLDER = /^(.)\1{39,63}$/;
const PREDECESSOR: Predecessor = {
  artifact_id: "dfv0_gate_h2_podman_supervisor_v1_20260718",
  sorted_tree_sha256:
    "a0f88c5d297596ae25e826b6ea1a7e89e3749ec20b7ffecc094eabad8bfadda9",
  commit: "74e6f5af17b82ea116d1d0c51b6320959fd5c637",
  pins: {
    podman_descriptor: {
      path: "docs/dataset-factory/fixtures/podman-supervisor-v1/source-descriptor-v2.json",
      sha256:
        "418d111218b9bcd72c233ddb3dcc85fbe84e9a6235378c35f3bf307b56009534",
      bytes: 12045,
    },
    https_broker_descriptor: {
      path: "docs/dataset-factory/fixtures/https-broker-runtime-v1/source-descriptor-v1.json",
      sha256:
        "288e99faf97e01250df1ebf6d91a9eb63a5a6c81ed3a92295ae5b29b024af095",
      bytes: 12237,
    },
    source_allowlist: {
      path: "crates/gate-h2-broker/oci/source-allowlist.v1.txt",
      sha256:
        "5d2f26027590ac3663cb1b751d929b90d78859dd79e4d0b5d87766036bb7377c",
      bytes: 1525,
    },
  },
  schema_commitments: {
    podman_descriptor_schema_version:
      "gate_h2_broker_runtime_source_descriptor_v2.0.0",
    https_broker_descriptor_schema_version:
      "gate_h2_broker_runtime_source_descriptor_v1.0.0",
    inherited_descriptor_sha256:
      "288e99faf97e01250df1ebf6d91a9eb63a5a6c81ed3a92295ae5b29b024af095",
  },
};

class ConformanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
function fail(code: string, message: string): never {
  throw new ConformanceError(code, message);
}
function assert(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) fail(code, message);
}
function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(utf8Compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
    .join(",")}}`;
}
function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
const groups: ReadonlyArray<[string, string, string]> = [
  ["canonical_program_success", "executor_semantics", "executor_case"],
  ["program_substitution", "executor_semantics", "executor_case"],
  ["schema_substitution", "executor_semantics", "executor_case"],
  ["executor_substitution", "executor_semantics", "executor_case"],
  ["undeclared_dependency_rejected", "executor_semantics", "executor_case"],
  ["module_loader_absent", "executor_semantics", "executor_case"],
  ["native_loader_absent", "executor_semantics", "executor_case"],
  ["output_never_readable", "executor_semantics", "executor_case"],
  ["undeclared_write_rejected", "executor_semantics", "executor_case"],
  ["network_escape_rejected", "executor_semantics", "executor_case"],
  ["postspawn_source_replacement", "executor_semantics", "executor_case"],
  ["cleanup_precedes_completion", "executor_semantics", "executor_case"],
  ["exact_https_program_success", "broker_protocol", "broker_case"],
  ["legacy_action_rejected", "broker_protocol", "broker_case"],
  ["uds_socket_role_substitution", "broker_protocol", "broker_case"],
  ["run_token_role_substitution", "broker_protocol", "broker_case"],
  ["opaque_handle_gap_or_reorder", "broker_protocol", "broker_case"],
  ["transcript_commit_substitution", "broker_protocol", "broker_case"],
  ["static_elf_linkage", "build_identity", "build_receipt"],
  ["kernel_architecture_identity", "build_identity", "build_receipt"],
  ["two_clean_binary_identity", "build_identity", "build_receipt"],
  ["two_clean_rootfs_identity", "build_identity", "build_receipt"],
  ["two_clean_oci_identity", "build_identity", "build_receipt"],
  ["source_commit_tree_identity", "build_identity", "build_receipt"],
  ["builder_image_identity", "build_identity", "build_receipt"],
  ["admitted_oci_image_identity", "build_identity", "build_receipt"],
  ["rootless_non_root_identity", "podman_confinement", "runtime_observation"],
  ["read_only_rootfs", "podman_confinement", "runtime_observation"],
  ["cap_drop_no_new_privileges", "podman_confinement", "runtime_observation"],
  ["seccomp_policy", "podman_confinement", "runtime_observation"],
  ["pid_namespace_isolation", "podman_confinement", "runtime_observation"],
  ["ipc_namespace_isolation", "podman_confinement", "runtime_observation"],
  ["uts_namespace_isolation", "podman_confinement", "runtime_observation"],
  ["exact_mounts", "podman_confinement", "runtime_observation"],
  ["writable_confinement", "podman_confinement", "runtime_observation"],
  ["fd_closure", "podman_confinement", "runtime_observation"],
  ["sealed_memfd_input", "podman_confinement", "runtime_observation"],
  ["retained_fd_execution", "podman_confinement", "runtime_observation"],
  ["atomic_no_replace_output", "podman_confinement", "runtime_observation"],
  ["raw_tcp_denied", "network_confinement", "network_probe"],
  ["raw_udp_denied", "network_confinement", "network_probe"],
  ["dns_denied", "network_confinement", "network_probe"],
  ["uds_only_exchange", "network_confinement", "network_probe"],
  ["so_peercred_binding", "broker_binding", "broker_case"],
  ["session_token_attempt_container_binding", "broker_binding", "broker_case"],
  ["dns_rebinding_denied", "broker_adversarial", "broker_case"],
  ["forbidden_address_denied", "broker_adversarial", "broker_case"],
  ["tls_sni_certificate_validation", "broker_adversarial", "broker_case"],
  ["redirect_denied", "broker_adversarial", "broker_case"],
  ["response_size_denied", "broker_adversarial", "broker_case"],
  ["timeout_enforced", "broker_adversarial", "broker_case"],
  ["malformed_framing_denied", "broker_adversarial", "broker_case"],
  ["replay_order_denied", "broker_adversarial", "broker_case"],
  ["supervisor_death_cleanup", "lifecycle_cleanup", "lifecycle_receipt"],
  ["term_kill_reap", "lifecycle_cleanup", "lifecycle_receipt"],
  ["cidfile_ownership", "lifecycle_cleanup", "lifecycle_receipt"],
  ["container_removal", "lifecycle_cleanup", "lifecycle_receipt"],
  ["run_tree_cleanup", "lifecycle_cleanup", "lifecycle_receipt"],
  ["twelve_stage_exact_universe", "stage_chronology", "stage_receipt"],
  ["twelve_stage_success", "stage_chronology", "stage_receipt"],
  ["twelve_stage_failure_no_completion", "stage_chronology", "stage_receipt"],
  ["twelve_stage_report_join", "stage_chronology", "stage_receipt"],
  ["d1_begin", "d1_chronology", "d1_receipt"],
  ["d1_unique_claim", "d1_chronology", "d1_receipt"],
  ["d1_completion_chronology", "d1_chronology", "d1_receipt"],
  ["d1_crash_without_completion", "d1_chronology", "d1_receipt"],
  ["d1_retry_chronology", "d1_chronology", "d1_receipt"],
  ["d1_append_only_mutation_denial", "d1_chronology", "d1_receipt"],
  [
    "transcript_output_authority_exact_joins",
    "authority_joins",
    "authority_receipt",
  ],
];
const CASES: readonly Case[] = groups.map(([id, category, evidence_kind]) => ({
  id,
  category,
  evidence_kind,
  required_for_production: true,
}));
function expectedUniverse(): Case[] {
  return CASES.map((entry) => ({ ...entry }));
}
function lstat(file: string, code: string): fs.Stats {
  try {
    return fs.lstatSync(file);
  } catch {
    fail(code, `missing ${file}`);
  }
}
function assertCleanPath(
  root: string,
  relative = "",
  code = "H2_LINUX_CONFORMANCE_PATH",
): void {
  assert(path.isAbsolute(root), code, "root must be absolute");
  const resolvedRoot = path.resolve(root);
  const filesystemRoot = path.parse(resolvedRoot).root;
  let current = filesystemRoot;
  for (const part of path
    .relative(filesystemRoot, resolvedRoot)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const stat = lstat(current, code);
    assert(
      !stat.isSymbolicLink() && stat.isDirectory(),
      code,
      `symlink or non-directory ancestor refused: ${current}`,
    );
  }
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = lstat(current, code);
    assert(!stat.isSymbolicLink(), code, `symlink refused: ${current}`);
    assert(
      current === path.resolve(resolvedRoot, relative)
        ? stat.isFile() || stat.isDirectory()
        : stat.isDirectory(),
      code,
      `non-directory path ancestor: ${current}`,
    );
  }
}
type AncestorIdentity = {
  file: string;
  isDirectory: boolean;
  dev: number;
  ino: number;
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
};
const ANCESTOR_REPLACED = "H2_LINUX_CONFORMANCE_ANCESTOR_REPLACED";
function captureAncestorChain(root: string, relative: string): AncestorIdentity[] {
  const resolvedRoot = path.resolve(root);
  const filesystemRoot = path.parse(resolvedRoot).root;
  const directories = [filesystemRoot];
  let current = filesystemRoot;
  for (const part of path
    .relative(filesystemRoot, resolvedRoot)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    directories.push(current);
  }
  for (const part of relative.split(path.sep).filter(Boolean).slice(0, -1)) {
    current = path.join(current, part);
    directories.push(current);
  }
  return directories.map((directory) => {
    const stat = lstat(directory, ANCESTOR_REPLACED);
    assert(
      !stat.isSymbolicLink() && stat.isDirectory(),
      ANCESTOR_REPLACED,
      `unsafe retained-read ancestor: ${directory}`,
    );
    return {
      file: directory,
      isDirectory: stat.isDirectory(),
      dev: stat.dev,
      ino: stat.ino,
      uid: stat.uid,
      gid: stat.gid,
      mode: stat.mode,
      nlink: stat.nlink,
    };
  });
}
function assertAncestorChain(ancestors: readonly AncestorIdentity[]): void {
  for (const ancestor of ancestors) {
    const stat = lstat(ancestor.file, ANCESTOR_REPLACED);
    assert(
      !stat.isSymbolicLink() &&
        stat.isDirectory() === ancestor.isDirectory &&
        stat.dev === ancestor.dev &&
        stat.ino === ancestor.ino &&
        stat.uid === ancestor.uid &&
        stat.gid === ancestor.gid &&
        stat.mode === ancestor.mode &&
        stat.nlink === ancestor.nlink,
      ANCESTOR_REPLACED,
      `retained-read ancestor changed or became unsafe: ${ancestor.file}`,
    );
  }
}
function retainedRead(
  file: string,
  maxBytes: number,
  root = path.dirname(file),
  beforeOpen?: () => void,
  afterOpen?: () => void,
  ownerUid?: number,
): Buffer {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  assert(
    relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    "H2_LINUX_CONFORMANCE_PATH",
    "file escaped retained-read root",
  );
  assertCleanPath(root, relative);
  const ancestors = captureAncestorChain(root, relative);
  const before = lstat(file, "H2_LINUX_CONFORMANCE_PATH");
  assert(
    !before.isSymbolicLink() && before.isFile(),
    "H2_LINUX_CONFORMANCE_FILE_TYPE",
    `not a regular file: ${file}`,
  );
  beforeOpen?.();
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const first = fs.fstatSync(fd);
    assert(
      before.dev === first.dev &&
        before.ino === first.ino &&
        before.size === first.size &&
        before.isFile() === first.isFile(),
      "H2_LINUX_CONFORMANCE_PREOPEN_REPLACED",
      `path changed between lstat and open: ${file}`,
    );
    assertAncestorChain(ancestors);
    const euid =
      ownerUid ??
      (typeof process.geteuid === "function" ? process.geteuid() : undefined);
    assert(
      first.isFile() &&
        first.nlink === 1 &&
        (first.mode & 0o022) === 0 &&
        (euid === undefined || first.uid === euid),
      "H2_LINUX_CONFORMANCE_FILE_SAFETY",
      `unsafe owner/mode/link count: ${file}`,
    );
    assert(
      first.size >= 0 && first.size <= maxBytes,
      "H2_LINUX_CONFORMANCE_FILE_SIZE",
      `file outside retained-read bound: ${file}`,
    );
    afterOpen?.();
    const output = Buffer.alloc(first.size);
    let offset = 0;
    while (offset < output.length) {
      const read = fs.readSync(
        fd,
        output,
        offset,
        output.length - offset,
        offset,
      );
      assert(
        read > 0,
        "H2_LINUX_CONFORMANCE_READ",
        `short retained read: ${file}`,
      );
      offset += read;
    }
    const after = fs.fstatSync(fd);
    const current = lstat(file, "H2_LINUX_CONFORMANCE_PATH");
    assert(
      after.dev === first.dev &&
        after.ino === first.ino &&
        after.size === first.size &&
        current.dev === first.dev &&
        current.ino === first.ino &&
        current.size === first.size,
      "H2_LINUX_CONFORMANCE_REPLACED_PATH",
      `path changed during retained read: ${file}`,
    );
    assertAncestorChain(ancestors);
    return output;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function readJson<T>(file: string): T {
  try {
    return JSON.parse(
      retainedRead(file, 2 * 1024 * 1024).toString("utf8"),
    ) as T;
  } catch (error) {
    if (error instanceof ConformanceError) throw error;
    fail("H2_LINUX_CONFORMANCE_JSON", `invalid JSON: ${file}`);
  }
}
function parseCli(args: string[]): Options {
  let bundleRoot: string | undefined;
  let evidenceRoot: string | undefined;
  let strict = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--strict-production") {
      assert(
        !strict,
        "H2_LINUX_CONFORMANCE_CLI",
        "duplicate --strict-production",
      );
      strict = true;
      continue;
    }
    assert(
      arg === "--bundle-root" || arg === "--evidence-root",
      "H2_LINUX_CONFORMANCE_CLI",
      `unknown argument ${arg}`,
    );
    const value = args[++index];
    assert(
      value && path.isAbsolute(value),
      "H2_LINUX_CONFORMANCE_CLI",
      `${arg} requires one absolute path`,
    );
    if (arg === "--bundle-root") {
      assert(
        bundleRoot === undefined,
        "H2_LINUX_CONFORMANCE_CLI",
        "duplicate --bundle-root",
      );
      bundleRoot = path.resolve(value);
    } else {
      assert(
        evidenceRoot === undefined,
        "H2_LINUX_CONFORMANCE_CLI",
        "duplicate --evidence-root",
      );
      evidenceRoot = path.resolve(value);
    }
  }
  const resolvedBundle = bundleRoot ?? FIXTURE;
  return {
    bundleRoot: resolvedBundle,
    evidenceRoot: evidenceRoot ?? path.join(resolvedBundle, "evidence"),
    strict,
  };
}
function validateSchemas(universe: Universe, bundle: Bundle): void {
  const Ajv2020 = Ajv2020Import.default ?? Ajv2020Import;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const universeValidator = ajv.compile(readJson<object>(UNIVERSE_SCHEMA));
  assert(
    universeValidator(universe),
    "H2_LINUX_CONFORMANCE_SCHEMA",
    ajv.errorsText(universeValidator.errors),
  );
  const bundleValidator = ajv.compile(readJson<object>(BUNDLE_SCHEMA));
  assert(
    bundleValidator(bundle),
    "H2_LINUX_CONFORMANCE_SCHEMA",
    ajv.errorsText(bundleValidator.errors),
  );
}
function verifyPin(pin: FilePin): Buffer {
  const file = path.join(ROOT, pin.path);
  const bytes = retainedRead(file, 2 * 1024 * 1024, ROOT);
  assert(
    bytes.length === pin.bytes && sha256(bytes) === pin.sha256,
    "H2_LINUX_CONFORMANCE_PREDECESSOR_PIN",
    `predecessor pin drifted: ${pin.path}`,
  );
  return bytes;
}
function verifyPredecessorFixtureTree(): void {
  const observedFiles = walkEvidence(PREDECESSOR_FIXTURE).sort(utf8Compare);
  const expectedFiles = [...PREDECESSOR_FIXTURE_FILES].sort(utf8Compare);
  assert(
    canonical(observedFiles as unknown as Json) ===
      canonical(expectedFiles as unknown as Json),
    "H2_LINUX_CONFORMANCE_PREDECESSOR_TREE",
    "#100 fixture file set drifted",
  );
  let byteCount = 0;
  const manifest = expectedFiles
    .map((relative) => {
      const bytes = retainedRead(
        path.join(PREDECESSOR_FIXTURE, relative),
        2 * 1024 * 1024,
        PREDECESSOR_FIXTURE,
      );
      byteCount += bytes.length;
      return `${relative}\t${sha256(bytes)}\t${bytes.length}\n`;
    })
    .join("");
  assert(
    expectedFiles.length === 5 &&
      byteCount === 24049 &&
      sha256(manifest) === PREDECESSOR.sorted_tree_sha256,
    "H2_LINUX_CONFORMANCE_PREDECESSOR_TREE",
    "#100 fixture sorted-tree digest, file count, or byte count drifted",
  );
}
function registryRows(): Record<string, unknown>[] {
  const registry = retainedRead(ARTIFACT_REGISTRY, 4 * 1024 * 1024, ROOT)
    .toString("utf8")
    .trim()
    .split("\n");
  try {
    return registry.map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    fail(
      "H2_LINUX_CONFORMANCE_PREDECESSOR_REGISTRY",
      "artifact registry contains invalid JSONL",
    );
  }
}
function verifyPredecessorRegistryRows(rows: Record<string, unknown>[]): void {
  const predecessorRows = rows.filter(
    (row) => row.stable_id === PREDECESSOR.artifact_id,
  );
  assert(
    predecessorRows.length === 1,
    "H2_LINUX_CONFORMANCE_PREDECESSOR_REGISTRY",
    "artifact registry must contain exactly one #100 predecessor row",
  );
  const predecessor = predecessorRows[0]!;
  const contentDigest = predecessor.content_digest as Record<string, unknown>;
  const counts = predecessor.counts as Record<string, unknown>;
  const storage = predecessor.storage as Record<string, unknown>;
  assert(
    storage?.locator === "docs/dataset-factory/fixtures/podman-supervisor-v1" &&
      contentDigest?.algorithm === "sha256" &&
      contentDigest?.scope === "sorted_tree_manifest" &&
      contentDigest?.value === PREDECESSOR.sorted_tree_sha256 &&
      counts?.file_count === 5 &&
      counts?.byte_count === 24049,
    "H2_LINUX_CONFORMANCE_PREDECESSOR_REGISTRY",
    "#100 registry row does not bind its exact fixture tree",
  );
  const currentRows = rows.filter(
    (row) => row.stable_id === LINUX_CONFORMANCE_ARTIFACT_ID,
  );
  const current = currentRows[0];
  const dependencies = current?.dependency_ids;
  assert(
    currentRows.length === 1 &&
      Array.isArray(dependencies) &&
      canonical(dependencies as Json) ===
        canonical(LINUX_CONFORMANCE_DEPENDENCY_IDS as unknown as Json),
    "H2_LINUX_CONFORMANCE_CURRENT_REGISTRY",
    "#101 artifact registry row must have exactly the #100 dependency vector",
  );
  const currentDigest = current?.content_digest as Record<string, unknown>;
  const currentCounts = current?.counts as Record<string, unknown>;
  const currentStorage = current?.storage as Record<string, unknown>;
  assert(
    currentStorage?.locator === LINUX_CONFORMANCE_REGISTRY_BINDING.locator &&
      currentDigest?.algorithm ===
        LINUX_CONFORMANCE_REGISTRY_BINDING.digest.algorithm &&
      currentDigest?.scope ===
        LINUX_CONFORMANCE_REGISTRY_BINDING.digest.scope &&
      currentDigest?.value === LINUX_CONFORMANCE_REGISTRY_BINDING.digest.value &&
      currentCounts?.file_count ===
        LINUX_CONFORMANCE_REGISTRY_BINDING.counts.file_count &&
      currentCounts?.byte_count ===
        LINUX_CONFORMANCE_REGISTRY_BINDING.counts.byte_count,
    "H2_LINUX_CONFORMANCE_CURRENT_REGISTRY",
    "#101 registry row does not bind its exact fixture tree",
  );
}
function verifyPredecessorRegistry(): void {
  verifyPredecessorRegistryRows(registryRows());
}
function verifyPredecessor(predecessor: Predecessor): void {
  assert(
    canonical(predecessor as unknown as Json) ===
      canonical(PREDECESSOR as unknown as Json),
    "H2_LINUX_CONFORMANCE_PREDECESSOR",
    "predecessor stable ID, digest, commit, or pin drifted",
  );
  const podman = JSON.parse(
    verifyPin(predecessor.pins.podman_descriptor).toString("utf8"),
  );
  const https = JSON.parse(
    verifyPin(predecessor.pins.https_broker_descriptor).toString("utf8"),
  );
  verifyPin(predecessor.pins.source_allowlist);
  assert(
    podman.schema_version ===
      predecessor.schema_commitments.podman_descriptor_schema_version &&
      https.schema_version ===
        predecessor.schema_commitments.https_broker_descriptor_schema_version &&
      podman.predecessor?.sha256 ===
        predecessor.schema_commitments.inherited_descriptor_sha256,
    "H2_LINUX_CONFORMANCE_PREDECESSOR_SCHEMA",
    "predecessor descriptor commitments drifted",
  );
  const allowlist = podman.source_tree?.members?.find(
    (entry: { path: string }) => entry.path === "oci/source-allowlist.v1.txt",
  );
  assert(
    canonical(allowlist as Json) ===
      canonical({
        path: "oci/source-allowlist.v1.txt",
        git_mode: "100644",
        sha256: predecessor.pins.source_allowlist.sha256,
        bytes: predecessor.pins.source_allowlist.bytes,
      }),
    "H2_LINUX_CONFORMANCE_PREDECESSOR_ALLOWLIST",
    "predecessor allowlist commitment drifted",
  );
  verifyPredecessorFixtureTree();
  verifyPredecessorRegistry();
}
function verifyUniverse(universe: Universe): void {
  assert(
    canonical(universe.predecessor as unknown as Json) ===
      canonical(PREDECESSOR as unknown as Json),
    "H2_LINUX_CONFORMANCE_PREDECESSOR",
    "universe predecessor drifted",
  );
  assert(
    canonical(universe.cases as unknown as Json) ===
      canonical(expectedUniverse() as unknown as Json),
    "H2_LINUX_CONFORMANCE_UNIVERSE",
    "case universe or ordering drifted",
  );
  assert(
    universe.universe_sha256 ===
      sha256(
        canonical({
          schema_version: universe.schema_version,
          version: universe.version,
          predecessor: universe.predecessor,
          cases: universe.cases,
        }),
      ),
    "H2_LINUX_CONFORMANCE_UNIVERSE_HASH",
    "universe hash drifted",
  );
}
function verifyMetadata(bundle: Bundle, strict: boolean): void {
  assert(
    bundle.metadata_sha256 ===
      sha256(canonical(bundle.metadata as unknown as Json)),
    "H2_LINUX_CONFORMANCE_METADATA_HASH",
    "metadata hash drifted",
  );
  assert(
    canonical(bundle.metadata.predecessor as unknown as Json) ===
      canonical(PREDECESSOR as unknown as Json),
    "H2_LINUX_CONFORMANCE_PREDECESSOR",
    "run predecessor drifted",
  );
  if (!strict) {
    assert(
      bundle.status === "synthetic_local_fixture" &&
        bundle.synthetic === true &&
        bundle.production_eligible === false,
      "H2_LINUX_CONFORMANCE_MODE",
      "default mode accepts only the exact synthetic triad",
    );
    return;
  }
  const meta = bundle.metadata;
  assert(
    bundle.synthetic === false &&
      bundle.production_eligible === true &&
      bundle.status === "observed_real_linux_conformance",
    "H2_LINUX_CONFORMANCE_STRICT_SYNTHETIC",
    "strict mode rejects synthetic or ineligible evidence",
  );
  assert(
    GIT_OBJECT.test(meta.source.commit) &&
      !PLACEHOLDER.test(meta.source.commit) &&
      GIT_OBJECT.test(meta.source.tree) &&
      !PLACEHOLDER.test(meta.source.tree) &&
      SHA256.test(meta.source.source_manifest_sha256) &&
      !PLACEHOLDER.test(meta.source.source_manifest_sha256),
    "H2_LINUX_CONFORMANCE_SOURCE_IDENTITY",
    "strict mode requires non-placeholder source commit, Git tree, and source-manifest digest",
  );
  for (const [label, image] of [
    ["builder", meta.builder_image],
    ["admitted OCI", meta.admitted_oci_image],
  ] as const) {
    const reference = image.reference.match(OCI_REFERENCE);
    const digest = image.digest.match(DIGEST);
    assert(
      reference && digest && reference[1] === digest[1],
      "H2_LINUX_CONFORMANCE_IMAGE_IDENTITY",
      `${label} image must be name@sha256 digest matched to its digest field`,
    );
  }
  const executable = meta.podman.executable_pin;
  assert(
    path.isAbsolute(executable.path) &&
      SHA256.test(executable.sha256) &&
      !PLACEHOLDER.test(executable.sha256) &&
      Number.isSafeInteger(executable.bytes) &&
      executable.bytes > 0 &&
      meta.podman.version.length > 0 &&
      meta.podman.rootless === true &&
      Number.isInteger(meta.podman.rootless_uid) &&
      meta.podman.rootless_uid >= 0,
    "H2_LINUX_CONFORMANCE_PODMAN",
    "strict mode requires hash-pinned rootless Podman executable identity",
  );
  let executableBytes: Buffer;
  try {
    executableBytes = retainedRead(
      executable.path,
      64 * 1024 * 1024,
      path.parse(executable.path).root,
      undefined,
      undefined,
      0,
    );
  } catch {
    fail(
      "H2_LINUX_CONFORMANCE_PODMAN",
      "strict mode could not retained-read the pinned Podman executable",
    );
  }
  assert(
    executableBytes.length === executable.bytes &&
      sha256(executableBytes) === executable.sha256,
    "H2_LINUX_CONFORMANCE_PODMAN",
    "strict mode Podman executable hash or byte count drifted",
  );
  assert(
    meta.host.platform === "linux" &&
      meta.host.kernel_release.length > 0 &&
      meta.host.architecture.length > 0,
    "H2_LINUX_CONFORMANCE_PLATFORM",
    "strict mode requires Linux kernel and architecture",
  );
  assert(
    meta.producer.principal.length > 0 && meta.producer.run_id.length > 0,
    "H2_LINUX_CONFORMANCE_PRODUCER",
    "strict mode requires producer/run identity",
  );
}
function verifyStrictGitDescendant(commit: string, expectedTree: string): void {
  const git = "/usr/bin/git";
  const stat = lstat(git, "H2_LINUX_CONFORMANCE_GIT");
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === 0 &&
      (stat.mode & 0o022) === 0,
    "H2_LINUX_CONFORMANCE_GIT",
    "trusted Git executable must be root-owned and non-writable",
  );
  const run = (...args: string[]) => {
    try {
      return execFileSync(git, ["-C", ROOT, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      fail(
        "H2_LINUX_CONFORMANCE_GIT_DESCENDANT",
        "claimed source commit is unavailable or not a strict #100 descendant",
      );
    }
  };
  run("cat-file", "-e", `${commit}^{commit}`);
  assert(
    run("rev-parse", `${commit}^{tree}`) === expectedTree,
    "H2_LINUX_CONFORMANCE_GIT_TREE",
    "claimed source tree does not match the claimed source commit",
  );
  assert(
    commit !== PREDECESSOR.commit,
    "H2_LINUX_CONFORMANCE_GIT_DESCENDANT",
    "claimed source commit must strictly descend from #100",
  );
  run("merge-base", "--is-ancestor", PREDECESSOR.commit, commit);
}
function walkEvidence(root: string): string[] {
  assertCleanPath(root, "", "H2_LINUX_CONFORMANCE_PATH");
  const visit = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      const stat = lstat(file, "H2_LINUX_CONFORMANCE_PATH");
      assert(
        !stat.isSymbolicLink(),
        "H2_LINUX_CONFORMANCE_PATH",
        `symlink refused: ${file}`,
      );
      if (stat.isDirectory()) return visit(file);
      assert(
        stat.isFile(),
        "H2_LINUX_CONFORMANCE_FILE_TYPE",
        `non-regular evidence entry: ${file}`,
      );
      return [path.relative(root, file)];
    });
  return visit(root);
}
type TreeMeasurement = {
  files: number;
  bytes: number;
  sorted_tree_sha256: string;
};
function measureRetainedReadTree(root: string): TreeMeasurement {
  const files = walkEvidence(root)
    .map((relative) => {
      const lexical = relative.split(path.sep).join("/");
      assert(
        lexical.length > 0 && !/[\t\r\n]/.test(lexical),
        "H2_LINUX_CONFORMANCE_PATH",
        `tree path cannot be represented in a manifest: ${relative}`,
      );
      return lexical;
    })
    .sort(utf8Compare);
  let bytes = 0;
  const manifest = files
    .map((relative) => {
      const content = retainedRead(
        path.join(root, ...relative.split("/")),
        16 * 1024 * 1024,
        root,
      );
      bytes += content.length;
      return `${relative}\t${sha256(content)}\t${content.length}\n`;
    })
    .join("");
  return { files: files.length, bytes, sorted_tree_sha256: sha256(manifest) };
}
function verifyTrackedFixtureTree(): void {
  const measured = measureRetainedReadTree(FIXTURE);
  assert(
    measured.files === LINUX_CONFORMANCE_REGISTRY_BINDING.counts.file_count &&
      measured.bytes === LINUX_CONFORMANCE_REGISTRY_BINDING.counts.byte_count &&
      measured.sorted_tree_sha256 ===
        LINUX_CONFORMANCE_REGISTRY_BINDING.digest.value,
    "H2_LINUX_CONFORMANCE_SYNTHETIC_FIXTURE",
    "tracked #101 fixture sorted-tree digest, file count, or byte count drifted",
  );
}
function verifyExactSyntheticFixtureTree(
  bundleRoot: string,
  evidenceRoot: string,
): void {
  assert(
    path.resolve(evidenceRoot) === path.join(path.resolve(bundleRoot), "evidence"),
    "H2_LINUX_CONFORMANCE_SYNTHETIC_FIXTURE",
    "default mode requires evidence beneath the exact synthetic fixture root",
  );
  const measured = measureRetainedReadTree(bundleRoot);
  assert(
    measured.files === LINUX_CONFORMANCE_REGISTRY_BINDING.counts.file_count &&
      measured.bytes === LINUX_CONFORMANCE_REGISTRY_BINDING.counts.byte_count &&
      measured.sorted_tree_sha256 ===
        LINUX_CONFORMANCE_REGISTRY_BINDING.digest.value,
    "H2_LINUX_CONFORMANCE_SYNTHETIC_FIXTURE",
    "default mode accepts only an exact copy of the registered synthetic fixture",
  );
}
function evidenceFile(root: string, pin: Pin): Buffer {
  assert(
    !path.isAbsolute(pin.path) &&
      !pin.path.split(/[\\/]/).includes("..") &&
      pin.path.length > 0,
    "H2_LINUX_CONFORMANCE_EVIDENCE_PATH",
    "evidence path must be a safe relative path",
  );
  const file = path.resolve(root, pin.path);
  assert(
    path.relative(root, file) !== "" &&
      !path.relative(root, file).startsWith(`..${path.sep}`),
    "H2_LINUX_CONFORMANCE_EVIDENCE_PATH",
    "evidence path escaped root",
  );
  return retainedRead(file, 16 * 1024 * 1024, root);
}
function verifyBundle(
  universe: Universe,
  bundle: Bundle,
  evidenceRoot: string,
  strict: boolean,
): void {
  validateSchemas(universe, bundle);
  verifyUniverse(universe);
  verifyPredecessor(universe.predecessor);
  assert(
    bundle.universe_sha256 === universe.universe_sha256,
    "H2_LINUX_CONFORMANCE_UNIVERSE_HASH",
    "bundle does not pin exact universe",
  );
  verifyMetadata(bundle, strict);
  const expected = universe.cases.map((entry) => entry.id);
  const actual = bundle.results.map((entry) => entry.case_id);
  assert(
    canonical(actual as unknown as Json) ===
      canonical(expected as unknown as Json),
    "H2_LINUX_CONFORMANCE_CASE_ORDER",
    "results missing, duplicate, extra, or reordered",
  );
  const pins = new Set<string>();
  for (let index = 0; index < bundle.results.length; index++) {
    const result = bundle.results[index]!;
    const expectedCase = universe.cases[index]!;
    assert(
      result.outcome === "pass",
      "H2_LINUX_CONFORMANCE_CASE_OUTCOME",
      `${result.case_id} is ${result.outcome}`,
    );
    assert(
      result.evidence.kind === expectedCase.evidence_kind &&
        result.evidence.schema_version === "v1",
      "H2_LINUX_CONFORMANCE_EVIDENCE_KIND",
      `${result.case_id} has wrong evidence kind or schema`,
    );
    assert(
      SHA256.test(result.evidence.sha256) &&
        !PLACEHOLDER.test(result.evidence.sha256) &&
        Number.isSafeInteger(result.evidence.bytes) &&
        result.evidence.bytes > 0,
      "H2_LINUX_CONFORMANCE_EVIDENCE_PIN",
      `${result.case_id} has invalid evidence pin`,
    );
    assert(
      !pins.has(result.evidence.path),
      "H2_LINUX_CONFORMANCE_EVIDENCE_DUPLICATE",
      `duplicate evidence path ${result.evidence.path}`,
    );
    pins.add(result.evidence.path);
    const bytes = evidenceFile(evidenceRoot, result.evidence);
    assert(
      bytes.length === result.evidence.bytes &&
        sha256(bytes) === result.evidence.sha256,
      "H2_LINUX_CONFORMANCE_EVIDENCE_DRIFT",
      `${result.case_id} evidence hash or size drifted`,
    );
  }
  assert(
    canonical([...pins].sort(utf8Compare) as unknown as Json) ===
      canonical(
        walkEvidence(evidenceRoot).sort(utf8Compare) as unknown as Json,
      ),
    "H2_LINUX_CONFORMANCE_EVIDENCE_EXTRA",
    "unexpected or unpinned evidence file",
  );
  if (strict) {
    verifyStrictGitDescendant(
      bundle.metadata.source.commit,
      bundle.metadata.source.tree,
    );
    fail(
      "H2_LINUX_CONFORMANCE_STRICT_SEMANTICS",
      "packet 1 has no per-case semantic validators; strict production admission remains ineligible",
    );
  }
}
function verify(options: Options): {
  status: string;
  cases: number;
  mode: string;
} {
  assertCleanPath(options.bundleRoot, "", "H2_LINUX_CONFORMANCE_PATH");
  verifyTrackedFixtureTree();
  const universe = readJson<Universe>(
    path.join(options.bundleRoot, "universe.json"),
  );
  const bundle = readJson<Bundle>(
    path.join(options.bundleRoot, "run-evidence.json"),
  );
  verifyBundle(universe, bundle, options.evidenceRoot, options.strict);
  if (!options.strict)
    verifyExactSyntheticFixtureTree(options.bundleRoot, options.evidenceRoot);
  return {
    status: "gate_h2_linux_conformance_verified",
    cases: universe.cases.length,
    mode: "synthetic_nonproduction",
  };
}
function expectCode(code: string, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    if (error instanceof ConformanceError && error.code === code) return;
    throw new Error(
      `H2_LINUX_CONFORMANCE_SELF_TEST_WRONG_CODE: expected ${code}, got ${String(error)}`,
    );
  }
  throw new Error(
    `H2_LINUX_CONFORMANCE_SELF_TEST_MISSING_REJECTION: expected ${code}`,
  );
}
function temporary(prefix: string): string {
  fs.mkdirSync(SELF_TEST_ROOT, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(SELF_TEST_ROOT, prefix));
}
function mutation(
  edit: (root: string, bundle: Bundle, universe: Universe) => void,
  expectedCode: string,
): void {
  const root = temporary("mutation-");
  fs.cpSync(FIXTURE, root, { recursive: true });
  try {
    const universe = readJson<Universe>(path.join(root, "universe.json"));
    const bundle = readJson<Bundle>(path.join(root, "run-evidence.json"));
    edit(root, bundle, universe);
    fs.writeFileSync(
      path.join(root, "universe.json"),
      `${JSON.stringify(universe, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(root, "run-evidence.json"),
      `${JSON.stringify(bundle, null, 2)}\n`,
      { mode: 0o600 },
    );
    expectCode(expectedCode, () =>
      verify({
        bundleRoot: root,
        evidenceRoot: path.join(root, "evidence"),
        strict: false,
      }),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function runSelfTest(): {
  status: string;
  cases: number;
  adversarial_rejections: number;
} {
  verify(parseCli([]));
  let n = 0;
  const test = (
    code: string,
    edit: (root: string, bundle: Bundle, universe: Universe) => void,
  ) => {
    mutation(edit, code);
    n++;
  };
  expectCode("H2_LINUX_CONFORMANCE_CLI", () => parseCli(["--unknown"]));
  expectCode("H2_LINUX_CONFORMANCE_CLI", () =>
    parseCli(["--bundle-root", FIXTURE, "--bundle-root", FIXTURE]),
  );
  n += 2;
  const external = temporary("external-");
  fs.cpSync(FIXTURE, external, { recursive: true });
  try {
    verify(
      parseCli([
        "--bundle-root",
        external,
        "--evidence-root",
        path.join(external, "evidence"),
      ]),
    );
  } finally {
    fs.rmSync(external, { recursive: true, force: true });
  }
  const measuredCopy = temporary("measured-copy-");
  fs.cpSync(FIXTURE, measuredCopy, { recursive: true });
  try {
    fs.appendFileSync(path.join(measuredCopy, "universe.json"), " ");
    expectCode("H2_LINUX_CONFORMANCE_SYNTHETIC_FIXTURE", () =>
      verifyExactSyntheticFixtureTree(
        measuredCopy,
        path.join(measuredCopy, "evidence"),
      ),
    );
    n++;
  } finally {
    fs.rmSync(measuredCopy, { recursive: true, force: true });
  }
  test("H2_LINUX_CONFORMANCE_SCHEMA", (_root, bundle) => {
    bundle.results.pop();
  });
  test("H2_LINUX_CONFORMANCE_SCHEMA", (_root, bundle) => {
    bundle.results.push(structuredClone(bundle.results[0]!));
  });
  test("H2_LINUX_CONFORMANCE_CASE_ORDER", (_root, bundle) => {
    [bundle.results[0], bundle.results[1]] = [
      bundle.results[1]!,
      bundle.results[0]!,
    ];
  });
  test("H2_LINUX_CONFORMANCE_UNIVERSE_HASH", (_root, _bundle, universe) => {
    universe.universe_sha256 = "1".repeat(64);
  });
  test("H2_LINUX_CONFORMANCE_EVIDENCE_PIN", (_root, bundle) => {
    bundle.results[0]!.evidence.sha256 = "a".repeat(64);
  });
  test("H2_LINUX_CONFORMANCE_EVIDENCE_KIND", (_root, bundle) => {
    bundle.results[0]!.evidence.kind = "wrong";
  });
  test("H2_LINUX_CONFORMANCE_CASE_OUTCOME", (_root, bundle) => {
    bundle.results[0]!.outcome = "fail";
  });
  test("H2_LINUX_CONFORMANCE_EVIDENCE_EXTRA", (root) => {
    fs.writeFileSync(path.join(root, "evidence", "extra.txt"), "extra\n");
  });
  test("H2_LINUX_CONFORMANCE_METADATA_HASH", (_root, bundle) => {
    bundle.metadata.producer.principal = "metadata-drift";
  });
  test("H2_LINUX_CONFORMANCE_EVIDENCE_DRIFT", (root, bundle) => {
    fs.writeFileSync(
      path.join(root, "evidence", bundle.results[0]!.evidence.path),
      "evidence bytes changed\n",
    );
  });
  test("H2_LINUX_CONFORMANCE_SYNTHETIC_FIXTURE", (root, bundle) => {
    const evidence = bundle.results[0]!.evidence;
    const replacement = Buffer.from("coordinated alternate evidence\n", "utf8");
    fs.writeFileSync(path.join(root, "evidence", evidence.path), replacement, {
      mode: 0o600,
    });
    evidence.sha256 = sha256(replacement);
    evidence.bytes = replacement.length;
  });
  test("H2_LINUX_CONFORMANCE_FILE_SAFETY", (root, bundle) => {
    fs.chmodSync(
      path.join(root, "evidence", bundle.results[0]!.evidence.path),
      0o666,
    );
  });
  test("H2_LINUX_CONFORMANCE_MODE", (_root, bundle) => {
    bundle.synthetic = false;
    bundle.production_eligible = true;
    bundle.status = "observed_real_linux_conformance";
  });
  test("H2_LINUX_CONFORMANCE_PREDECESSOR", (_root, _bundle, universe) => {
    universe.predecessor.sorted_tree_sha256 = "b".repeat(64);
  });
  test("H2_LINUX_CONFORMANCE_SCHEMA", (_root, _bundle, universe) => {
    universe.predecessor.artifact_id = "dfv0_gate_h2_podman_supervisor_v1_bad";
  });
  test("H2_LINUX_CONFORMANCE_PREDECESSOR", (_root, _bundle, universe) => {
    universe.predecessor.pins.podman_descriptor.sha256 = "c".repeat(64);
  });
  const registryTest = (edit: (rows: Record<string, unknown>[]) => void) => {
    const rows = structuredClone(registryRows());
    edit(rows);
    expectCode("H2_LINUX_CONFORMANCE_CURRENT_REGISTRY", () =>
      verifyPredecessorRegistryRows(rows),
    );
    n++;
  };
  registryTest((rows) => {
    const current = rows.find(
      (row) => row.stable_id === LINUX_CONFORMANCE_ARTIFACT_ID,
    )!;
    (current.storage as Record<string, unknown>).locator = "locator-drift";
  });
  registryTest((rows) => {
    const current = rows.find(
      (row) => row.stable_id === LINUX_CONFORMANCE_ARTIFACT_ID,
    )!;
    (current.content_digest as Record<string, unknown>).value = "d".repeat(64);
  });
  registryTest((rows) => {
    const current = rows.find(
      (row) => row.stable_id === LINUX_CONFORMANCE_ARTIFACT_ID,
    )!;
    (current.counts as Record<string, unknown>).file_count = 70;
  });
  registryTest((rows) => {
    const current = rows.find(
      (row) => row.stable_id === LINUX_CONFORMANCE_ARTIFACT_ID,
    )!;
    (current.counts as Record<string, unknown>).byte_count = 44880;
  });
  registryTest((rows) => {
    const current = rows.find(
      (row) => row.stable_id === LINUX_CONFORMANCE_ARTIFACT_ID,
    )!;
    current.dependency_ids = [
      PREDECESSOR.artifact_id,
      "dfv0_unexpected_dependency_v1",
    ];
  });
  const symlink = temporary("symlink-");
  try {
    const link = `${symlink}-link`;
    fs.symlinkSync(symlink, link);
    expectCode("H2_LINUX_CONFORMANCE_PATH", () =>
      verify(parseCli(["--bundle-root", link])),
    );
    n++;
    fs.unlinkSync(link);
  } finally {
    fs.rmSync(symlink, { recursive: true, force: true });
  }
  const ancestor = temporary("ancestor-");
  fs.cpSync(FIXTURE, ancestor, { recursive: true });
  try {
    fs.rmSync(path.join(ancestor, "evidence", "cases"), { recursive: true });
    fs.symlinkSync("/etc", path.join(ancestor, "evidence", "cases"));
    expectCode("H2_LINUX_CONFORMANCE_PATH", () =>
      verify({
        bundleRoot: ancestor,
        evidenceRoot: path.join(ancestor, "evidence"),
        strict: false,
      }),
    );
    n++;
  } finally {
    fs.rmSync(ancestor, { recursive: true, force: true });
  }
  const lexical = temporary("lexical-");
  try {
    const realParent = path.join(lexical, "real-parent"),
      realBundle = path.join(realParent, "bundle"),
      linkedParent = path.join(lexical, "linked-parent");
    fs.mkdirSync(realParent);
    fs.cpSync(FIXTURE, realBundle, { recursive: true });
    fs.symlinkSync(realParent, linkedParent);
    expectCode("H2_LINUX_CONFORMANCE_PATH", () =>
      verify({
        bundleRoot: path.join(linkedParent, "bundle"),
        evidenceRoot: path.join(linkedParent, "bundle", "evidence"),
        strict: false,
      }),
    );
    n++;
  } finally {
    fs.rmSync(lexical, { recursive: true, force: true });
  }
  const preopen = temporary("preopen-");
  try {
    const file = path.join(preopen, "evidence.txt"),
      replacement = path.join(preopen, "replacement.txt");
    fs.writeFileSync(file, "original\n", { mode: 0o600 });
    fs.writeFileSync(replacement, "replacement\n", { mode: 0o600 });
    expectCode("H2_LINUX_CONFORMANCE_PREOPEN_REPLACED", () =>
      retainedRead(file, 1024, preopen, () => fs.renameSync(replacement, file)),
    );
    n++;
  } finally {
    fs.rmSync(preopen, { recursive: true, force: true });
  }
  const ancestorSwap = temporary("ancestor-swap-");
  try {
    const inside = path.join(ancestorSwap, "inside");
    const originalDirectory = path.join(inside, "cases");
    const parkedDirectory = path.join(ancestorSwap, "parked-cases");
    const file = path.join(originalDirectory, "evidence.txt");
    fs.mkdirSync(originalDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, "original\n", { mode: 0o600 });
    expectCode(ANCESTOR_REPLACED, () =>
      retainedRead(file, 1024, ancestorSwap, undefined, () => {
        fs.renameSync(originalDirectory, parkedDirectory);
        fs.symlinkSync(parkedDirectory, originalDirectory);
      }),
    );
    n++;
  } finally {
    const originalDirectory = path.join(ancestorSwap, "inside", "cases");
    const parkedDirectory = path.join(ancestorSwap, "parked-cases");
    if (
      fs.existsSync(originalDirectory) &&
      fs.lstatSync(originalDirectory).isSymbolicLink()
    )
      fs.unlinkSync(originalDirectory);
    if (fs.existsSync(parkedDirectory))
      fs.renameSync(parkedDirectory, originalDirectory);
    fs.rmSync(ancestorSwap, { recursive: true, force: true });
  }
  const race = temporary("race-");
  try {
    const file = path.join(race, "evidence.txt"),
      replacement = path.join(race, "replacement.txt");
    fs.writeFileSync(file, "original\n", { mode: 0o600 });
    fs.writeFileSync(replacement, "replacement\n", { mode: 0o600 });
    expectCode("H2_LINUX_CONFORMANCE_REPLACED_PATH", () =>
      retainedRead(file, 1024, race, undefined, () =>
        fs.renameSync(replacement, file),
      ),
    );
    n++;
  } finally {
    fs.rmSync(race, { recursive: true, force: true });
  }
  expectCode("H2_LINUX_CONFORMANCE_STRICT_SYNTHETIC", () =>
    verify({
      bundleRoot: FIXTURE,
      evidenceRoot: path.join(FIXTURE, "evidence"),
      strict: true,
    }),
  );
  n++;
  const strictRoot = temporary("strict-");
  fs.cpSync(FIXTURE, strictRoot, { recursive: true });
  try {
    const bundle = readJson<Bundle>(path.join(strictRoot, "run-evidence.json"));
    const safeExecutablePath = "/usr/bin/true";
    const safeExecutable = retainedRead(
      safeExecutablePath,
      64 * 1024 * 1024,
      path.parse(safeExecutablePath).root,
      undefined,
      undefined,
      0,
    );
    const writeStrict = () => {
      bundle.metadata_sha256 = sha256(
        canonical(bundle.metadata as unknown as Json),
      );
      fs.writeFileSync(
        path.join(strictRoot, "run-evidence.json"),
        `${JSON.stringify(bundle, null, 2)}\n`,
        { mode: 0o600 },
      );
    };
    bundle.synthetic = false;
    bundle.production_eligible = true;
    bundle.status = "observed_real_linux_conformance";
    bundle.metadata.host.platform = "linux";
    bundle.metadata.source = {
      commit: "1".repeat(40),
      tree: "1".repeat(40),
      source_manifest_sha256: "1".repeat(64),
    };
    bundle.metadata.builder_image = {
      reference: "registry.example/builder@sha256:" + "2".repeat(64),
      digest: "sha256:" + "2".repeat(64),
    };
    bundle.metadata.admitted_oci_image = {
      reference: "registry.example/stage@sha256:" + "3".repeat(64),
      digest: "sha256:" + "3".repeat(64),
    };
    bundle.metadata.podman = {
      executable_pin: {
        path: safeExecutablePath,
        sha256: sha256(safeExecutable),
        bytes: safeExecutable.length,
      },
      version: "5.0",
      rootless: true,
      rootless_uid: 1000,
    };
    bundle.metadata.producer = { principal: "test", run_id: "run" };
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_SOURCE_IDENTITY", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.source = {
      commit: "0123456789abcdef0123456789abcdef01234567",
      tree: "89abcdef0123456789abcdef0123456789abcdef",
      source_manifest_sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    bundle.metadata.podman.executable_pin.sha256 =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_PODMAN", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.podman.executable_pin.sha256 = sha256(safeExecutable);
    bundle.metadata.host.platform = "darwin";
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_PLATFORM", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.host.platform = "linux";
    bundle.metadata.builder_image.digest = "sha256:" + "5".repeat(64);
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_IMAGE_IDENTITY", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.builder_image.digest = "sha256:" + "2".repeat(64);
    bundle.metadata.admitted_oci_image.reference =
      "registry.example/stage:latest";
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_IMAGE_IDENTITY", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.admitted_oci_image.reference =
      "registry.example/stage@sha256:" + "3".repeat(64);
    bundle.metadata.source.commit = PREDECESSOR.commit;
    bundle.metadata.source.tree = execFileSync(
      "/usr/bin/git",
      ["-C", ROOT, "rev-parse", `${PREDECESSOR.commit}^{tree}`],
      { encoding: "utf8" },
    ).trim();
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_GIT_DESCENDANT", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.source.commit = execFileSync(
      "/usr/bin/git",
      ["-C", ROOT, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    bundle.metadata.source.tree = "0123456789abcdef0123456789abcdef01234567";
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_GIT_TREE", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    bundle.metadata.source.tree = execFileSync(
      "/usr/bin/git",
      ["-C", ROOT, "rev-parse", "HEAD^{tree}"],
      { encoding: "utf8" },
    ).trim();
    writeStrict();
    expectCode("H2_LINUX_CONFORMANCE_STRICT_SEMANTICS", () =>
      verify({
        bundleRoot: strictRoot,
        evidenceRoot: path.join(strictRoot, "evidence"),
        strict: true,
      }),
    );
    n += 8;
  } finally {
    fs.rmSync(strictRoot, { recursive: true, force: true });
  }
  return {
    status: "gate_h2_linux_conformance_self_test_passed",
    cases: CASES.length,
    adversarial_rejections: n,
  };
}
function selfTest(): {
  status: string;
  cases: number;
  adversarial_rejections: number;
} {
  fs.rmSync(SELF_TEST_ROOT, { recursive: true, force: true });
  try {
    return runSelfTest();
  } finally {
    fs.rmSync(SELF_TEST_ROOT, { recursive: true, force: true });
  }
}
function main(): void {
  const [command = "verify", ...args] = process.argv.slice(2);
  const options = parseCli(args);
  if (command === "verify")
    process.stdout.write(`${JSON.stringify(verify(options))}\n`);
  else if (command === "self-test")
    process.stdout.write(`${JSON.stringify(selfTest())}\n`);
  else fail("H2_LINUX_CONFORMANCE_CLI", `unknown command ${command}`);
}
main();
