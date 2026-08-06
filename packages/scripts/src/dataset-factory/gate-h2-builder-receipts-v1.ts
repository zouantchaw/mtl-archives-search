import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";

type J = null | boolean | number | string | J[] | { [key: string]: J };
type O = { [key: string]: J };
class E extends Error { constructor(readonly code: string, message: string) { super(`${code}: ${message}`); } }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
  FIX = path.join(ROOT, "docs/dataset-factory/fixtures/gate-h2-builder-receipts-v1"),
  SC = path.join(ROOT, "docs/dataset-factory/schemas/reviewed-metrics-v2"),
  REG = path.join(ROOT, "docs/dataset-factory/artifact-registry.v0.jsonl"),
  ID = "dfv0_gate_h2_builder_receipts_v1_20260806", DEP = "dfv0_gate_h2_linux_conformance_v1_20260806",
  FROZEN_COMMIT = "4ddf00e812610e3e029059f25ad3d951577f667d",
  FROZEN_TREE = "c628d05c38e5595026fb4122ec8e71018a220647",
  DESCRIPTOR_PATH = "docs/dataset-factory/fixtures/podman-supervisor-v1/source-descriptor-v2.json",
  H = /^[a-f0-9]{64}$/, D = /^sha256:([a-f0-9]{64})$/,
  N = [
    "gate-h2-broker",
    "gate-h2-stage-runtime",
    "gate-h2-publish-noreplace",
    "gate-h2-secure-candidate-read",
    "gate-h2-podman-supervisor",
    "gate-h2-post-begin-handoff",
    "rootfs.tar",
    "gate-h2-stage.oci.tar",
    "provenance.json",
    "sbom.cdx.json",
  ],
  RS = path.join(SC, "gate-h2-hermetic-builder-recipe.schema.v1.json"),
  XS = path.join(SC, "gate-h2-two-clean-build-receipt.schema.v1.json"),
  ZS = path.join(SC, "gate-h2-build-receipt-comparison.schema.v1.json");
const EXPECTED_CASE_IDS = [
  "schema/recipe-extra",
  "schema/policy-network",
  "schema/pending-nonproduction",
  "schema/pending-tool-artifact",
  "semantic/recipe-hash",
  "source/git-tree",
  "source/descriptor-hash",
  "source/descriptor-tree",
  "source/descriptor-count",
  "source/descriptor-bytes",
  "commitment/cargo_lock_sha256",
  "commitment/toolchain_lock_sha256",
  "commitment/source_allowlist_sha256",
  "commitment/source_export_script_sha256",
  "commitment/build_script_sha256",
  "commitment/oci_assembly_script_sha256",
  "commitment/repeated",
  "approved/image-reference",
  "approved/image-digest",
  "approved/vendor-placeholder",
  "approved/vendor-snapshot",
  "approved/periodic-snapshot",
  "approved/trust-root",
  "approved/tool-artifact",
  "schema/receipt-extra",
  "schema/admitted",
  "schema/published",
  "schema/production-authority",
  "semantic/receipt-hash",
  "policy/receipt-network",
  "rootless/false",
  "platform/not-linux",
  "platform/not-x86",
  "tool/rustc-mismatch",
  "tool/podman-identity",
  "cross/source_commit",
  "cross/source_git_tree",
  "cross/source_tree_sha256",
  "cross/descriptor_sha256",
  "cross/cargo_lock_sha256",
  "cross/toolchain_lock_sha256",
  "cross/source_allowlist_sha256",
  "cross/source_export_script_sha256",
  "cross/build_script_sha256",
  "cross/oci_assembly_script_sha256",
  "cross/recipe_sha256",
  "cross/trust_roots_sha256",
  "cross/vendor_tree_sha256",
  "schema/descriptor-path",
  "builder/reference-cross",
  "builder/digest-cross",
  "derived/manifest-placeholder",
  "schema/derived-archive-count",
  "commands/placeholder",
  "commands/repeated",
  "outputs/order",
  "outputs/oci-placeholder",
  "outputs/repeated-evidence",
  "passes/mismatch",
  "status/observed-pending",
  "comparison/mode",
  "comparison/run-identity",
  "identity/duplicate-surface_id",
  "identity/duplicate-independence_group",
  "identity/duplicate-principal",
  "identity/cross-role-a-principal-b-run",
  "identity/same-receipt-run-principal",
  "comparison/comparator-identity",
  "identity/comparator-principal",
  "identity/comparator-run-equals-principal",
  "identity/comparator-vs-surface",
  "identity/comparator-vs-group",
  "secure-read/leaf-symlink",
  "secure-read/ancestor-symlink",
  "secure-read/nonregular",
  "secure-read/root",
  "noncanonical/json",
  "external/byte-identical",
  "registry/canonical-row",
  "packet1/dependency-exact",
  "packet1/run-evidence-not-receipt",
] as const;
function fail(code: string, message: string): never { throw new E(code, message); }
function ok(value: unknown, code: string, message: string): asserts value { if (!value) fail(code, message); }
const sha = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const testHash = (name: string) => sha(`issue-101-packet-2-test-only:${name}`);
const canonical = (value: J): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
const asObject = (value: J, code: string): O => { ok(value !== null && typeof value === "object" && !Array.isArray(value), code, "object required"); return value as O; };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const recipeDigest = (value: O) => { const x = { ...value }; delete x.recipe_sha256; return sha(canonical(x)); };
const receiptDigest = (value: O) => { const x = { ...value }; delete x.receipt_sha256; return sha(canonical(x)); };

/**
 * Ancestor-path and in-place leaf-content observations remain non-atomic and
 * observational despite these checks. Frozen source authority comes from Git
 * objects; this residual applies only to fixture/schema/registry/CLI reads.
 */
function secureRead(file: string): Buffer {
  ok(path.isAbsolute(file), "H2P2_PATH", "absolute path required");
  const resolved = path.resolve(file), root = path.parse(resolved).root, parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  ok(parts.length > 0, "H2P2_REGULAR_FILE", "root is not a regular leaf");
  let current = root;
  const before: fs.BigIntStats[] = [];
  for (const part of parts) {
    current = path.join(current, part);
    let stat: fs.BigIntStats = {} as fs.BigIntStats;
    try { stat = fs.lstatSync(current, { bigint: true }); } catch { fail("H2P2_INPUT_MISSING", "input component unavailable"); }
    ok(!stat.isSymbolicLink(), "H2P2_SYMLINK", "symlink input rejected");
    before.push(stat);
  }
  const leaf = before[before.length - 1]!;
  ok(leaf.isFile(), "H2P2_REGULAR_FILE", "regular leaf required");
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd = -1;
  try { fd = fs.openSync(resolved, flags); } catch { fail("H2P2_NOFOLLOW", "O_NOFOLLOW leaf open rejected"); }
  try {
    const fdBefore = fs.fstatSync(fd, { bigint: true });
    ok(fdBefore.isFile(), "H2P2_REGULAR_FILE", "opened leaf is not regular");
    ok(sameStat(leaf, fdBefore), "H2P2_INPUT_RACE", "opened FD does not match observed leaf");
    const bytes = fs.readFileSync(fd);
    const fdAfter = fs.fstatSync(fd, { bigint: true });
    ok(sameStat(fdBefore, fdAfter), "H2P2_INPUT_RACE", "retained FD changed while read");
    for (let index = 0; index < before.length; index++) {
      const observed = before[index]!;
      const again = fs.lstatSync(path.join(root, ...parts.slice(0, index + 1)), { bigint: true });
      ok(!again.isSymbolicLink(), "H2P2_SYMLINK", "symlink introduced while read");
      ok(sameStat(observed, again), index === before.length - 1 ? "H2P2_INPUT_RACE" : "H2P2_ANCESTOR_RACE", "path identity changed while read");
      if (index === before.length - 1) {
        ok(sameStat(fdAfter, again), "H2P2_INPUT_RACE", "retained FD no longer matches final leaf");
      }
    }
    return bytes;
  } finally { fs.closeSync(fd!); }
}
function sameStat(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}
function read(file: string): O {
  const bytes = secureRead(file); let value: J;
  try { value = JSON.parse(bytes.toString("utf8")) as J; } catch { fail("H2P2_JSON", "invalid JSON"); }
  const object = asObject(value!, "H2P2_JSON");
  ok(bytes.equals(Buffer.from(canonical(object) + "\n")), "H2P2_NONCANONICAL", "canonical UTF-8 JSON required");
  return object;
}
function schema(file: string): O { return asObject(JSON.parse(secureRead(file).toString("utf8")) as J, "H2P2_SCHEMA_JSON"); }
function validate(value: O, file: string, code: string): void {
  const Ajv = Ajv2020Import as unknown as new (options: object) => { compile(schema: object): ((value: object) => boolean) & { errors?: unknown }; };
  const checker = new Ajv({ allErrors: true, strict: true }).compile(schema(file));
  ok(checker(value), code, JSON.stringify(checker.errors));
}
function pin(value: unknown, code: string): string {
  ok(typeof value === "string" && H.test(value), code, "64-character lowercase SHA-256 required");
  for (let n = 1; n <= 32; n++) if (64 % n === 0 && value === value.slice(0, n).repeat(64 / n)) fail(code, "periodic placeholder digest");
  return value;
}
function distinct(values: unknown[], code: string, label: string): string[] {
  const pins = values.map((value) => pin(value, code));
  ok(new Set(pins).size === pins.length, code, `${label} must be distinct`);
  return pins;
}
function digest(value: unknown, code: string): string { ok(typeof value === "string" && D.test(value), code, "sha256 digest required"); return pin((value as string).slice(7), code); }
function exactVersion(value: unknown, code: string): string { ok(typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value) && value !== "0.0.0", code, "exact non-placeholder semver required"); return value as string; }
function versionAtLeast(actual: string, minimum: string): boolean { const left = actual.split(".").map(Number), right = minimum.split(".").map(Number); return left[0]! > right[0]! || left[0] === right[0]! && (left[1]! > right[1]! || left[1] === right[1]! && left[2]! >= right[2]!); }
function same(left: unknown, right: unknown, code: string, label: string): void { ok(canonical(left as J) === canonical(right as J), code, `${label} mismatch`); }
function policy(value: O, code: string): void { same(value, { network: "none", pull: "never", read_only_rootfs: true, offline_cargo: true }, code, "hermetic policy"); }
function members(value: unknown, code: string): O[] {
  ok(Array.isArray(value), code, "member array required"); const entries = value.map((entry) => asObject(entry as J, code));
  ok(entries.length === N.length && entries.every((entry, index) => entry.path === N[index]), "H2P2_MEMBER_ORDER", "exact ordered output members required");
  entries.forEach((entry) => {
    pin(entry.sha256, code);
    ok(Number.isInteger(entry.bytes) && Number(entry.bytes) > 0, code, "positive member bytes required");
  });
  distinct(entries.map((entry) => entry.sha256), code, "member hashes");
  return entries;
}
function gitBlob(commit: string, relative: string): Buffer {
  try {
    return execFileSync("git", ["cat-file", "blob", `${commit}:${relative}`], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    fail("H2P2_GIT_OBJECT", `frozen Git object unavailable: ${relative}`);
  }
}
function sourceCommitments(recipe: O): void {
  const source = asObject(recipe.source as J, "H2P2_SOURCE");
  const commitments = asObject(recipe.commitments as J, "H2P2_COMMITMENTS");
  same(source.commit, FROZEN_COMMIT, "H2P2_SOURCE", "source commit");
  same(source.git_tree, FROZEN_TREE, "H2P2_SOURCE", "source Git tree");
  same(source.descriptor_path, DESCRIPTOR_PATH, "H2P2_SOURCE", "descriptor path");
  const descriptor = gitBlob(FROZEN_COMMIT, DESCRIPTOR_PATH);
  const descriptorObject = asObject(JSON.parse(descriptor.toString("utf8")) as J, "H2P2_SOURCE");
  const tree = asObject(descriptorObject.source_tree as J, "H2P2_SOURCE");
  same(source.descriptor_sha256, sha(descriptor), "H2P2_SOURCE", "descriptor hash");
  same(source.descriptor_tree_sha256, tree.sha256, "H2P2_SOURCE", "descriptor tree hash");
  same(source.descriptor_file_count, tree.file_count, "H2P2_SOURCE", "descriptor file count");
  same(source.descriptor_byte_count, tree.byte_count, "H2P2_SOURCE", "H2P2_SOURCE descriptor byte count");
  const gitTree = execFileSync("git", ["rev-parse", `${FROZEN_COMMIT}^{tree}`], { cwd: ROOT, encoding: "utf8" }).trim();
  same(source.git_tree, gitTree, "H2P2_SOURCE", "commit Git tree");
  const tracked: Record<string, string> = {
    cargo_lock_sha256: "crates/gate-h2-broker/Cargo.lock",
    toolchain_lock_sha256: "crates/gate-h2-broker/oci/toolchain-lock.v1.json",
    source_allowlist_sha256: "crates/gate-h2-broker/oci/source-allowlist.v1.txt",
    source_export_script_sha256: "crates/gate-h2-broker/scripts/export-tracked-source.sh",
    build_script_sha256: "crates/gate-h2-broker/scripts/build-stage-oci.sh",
    oci_assembly_script_sha256: "crates/gate-h2-broker/scripts/assemble-oci.mjs",
  };
  Object.entries(tracked).forEach(([key, relative]) => {
    same(commitments[key], sha(gitBlob(FROZEN_COMMIT, relative)), "H2P2_COMMITMENTS", key);
  });
  distinct(Object.values(commitments), "H2P2_COMMITMENTS", "tracked commitments");
}
function tools(recipe: O, approved: boolean): void {
  const required = asObject(recipe.tool_requirements as J, "H2P2_TOOLS");
  ["cargo", "rustc", "musl", "node", "podman"].forEach((name) => {
    const tool = asObject(required[name] as J, "H2P2_TOOLS"); exactVersion(tool.version, "H2P2_TOOLS");
    if (approved && name !== "podman") pin(tool.artifact_sha256, "H2P2_TOOLS");
    else ok(tool.artifact_sha256 === null, "H2P2_TOOLS", "unreviewed or host-only artifact pin must be null");
  });
}
function recipe(value: O): void {
  validate(value, RS, "H2P2_RECIPE_SCHEMA"); same(value.recipe_sha256, recipeDigest(value), "H2P2_RECIPE_HASH", "recipe self hash");
  const p = asObject(value.policy as J, "H2P2_POLICY"); policy({ network: p.network!, pull: p.pull!, read_only_rootfs: p.read_only_rootfs!, offline_cargo: p.offline_cargo! }, "H2P2_POLICY");
  ok(p.host_cache_fallback === false && p.package_manager_mutation === false, "H2P2_POLICY", "host cache and package mutation forbidden"); sourceCommitments(value);
  const approved = value.approval_status === "approved_immutable_inputs"; tools(value, approved);
  if (!approved) { ok(value.approval_status === "pending_external_base_digest_review" && value.nonproduction === true && value.base_image === null && value.vendor_tree === null && value.trust_roots === null, "H2P2_PENDING_BOUNDARY", "pending recipe must not claim external immutable inputs"); return; }
  ok(value.nonproduction === false, "H2P2_APPROVED_BOUNDARY", "approved recipe cannot be nonproduction");
  const image = asObject(value.base_image as J, "H2P2_IMAGE");
  const baseDigest = digest(image.digest, "H2P2_IMAGE");
  ok(String(image.reference).endsWith(`@${image.digest}`) && !/:latest(?:@|$)/.test(String(image.reference)), "H2P2_IMAGE", "exact immutable base reference required");
  const vendor = asObject(value.vendor_tree as J, "H2P2_VENDOR");
  const vendorDigest = pin(vendor.sha256, "H2P2_VENDOR");
  const configDigest = pin(vendor.source_replacement_config_sha256, "H2P2_VENDOR");
  ok(Number.isInteger(vendor.file_count) && Number(vendor.file_count) > 0 && Number.isInteger(vendor.byte_count) && Number(vendor.byte_count) > 0, "H2P2_VENDOR", "vendor counts required");
  ok(Array.isArray(vendor.repository_snapshots) && vendor.repository_snapshots.length > 0, "H2P2_VENDOR", "repository snapshots required");
  const snapshots = vendor.repository_snapshots.map((snapshot) => {
    ok(typeof snapshot === "string" && /@sha256:[a-f0-9]{64}$/.test(snapshot) && !/:latest/.test(snapshot), "H2P2_VENDOR", "immutable snapshot required");
    return pin(snapshot.slice(-64), "H2P2_VENDOR");
  });
  const trustRoots = pin(value.trust_roots, "H2P2_TRUST_ROOTS");
  const required = asObject(value.tool_requirements as J, "H2P2_TOOLS");
  const innerTools = ["cargo", "rustc", "musl", "node"].map((name) => pin(asObject(required[name] as J, "H2P2_TOOLS").artifact_sha256, "H2P2_TOOLS"));
  distinct([baseDigest, vendorDigest, configDigest, trustRoots, ...snapshots, ...innerTools], "H2P2_EXTERNAL_IDENTITIES", "approved external identities");
}
function cross(recipeValue: O, inputs: O): void {
  const source = asObject(recipeValue.source as J, "H2P2_CROSS_BINDING"), c = asObject(recipeValue.commitments as J, "H2P2_CROSS_BINDING"), image = asObject(recipeValue.base_image as J, "H2P2_CROSS_BINDING"), vendor = asObject(recipeValue.vendor_tree as J, "H2P2_CROSS_BINDING");
  const pairs: [string, unknown][] = [
    ["target", recipeValue.target],
    ["source_commit", source.commit],
    ["source_git_tree", source.git_tree],
    ["source_tree_sha256", source.descriptor_tree_sha256],
    ["descriptor_path", source.descriptor_path],
    ["descriptor_sha256", source.descriptor_sha256],
    ["cargo_lock_sha256", c.cargo_lock_sha256],
    ["toolchain_lock_sha256", c.toolchain_lock_sha256],
    ["source_allowlist_sha256", c.source_allowlist_sha256],
    ["source_export_script_sha256", c.source_export_script_sha256],
    ["build_script_sha256", c.build_script_sha256],
    ["oci_assembly_script_sha256", c.oci_assembly_script_sha256],
    ["recipe_sha256", recipeValue.recipe_sha256],
    ["trust_roots_sha256", recipeValue.trust_roots],
    ["builder_image_reference", image.reference],
    ["builder_image_digest", image.digest],
    ["vendor_tree_sha256", vendor.sha256],
    ["vendor_file_count", vendor.file_count],
    ["vendor_byte_count", vendor.byte_count],
    ["vendor_config_sha256", vendor.source_replacement_config_sha256],
    ["repository_snapshots", vendor.repository_snapshots],
  ];
  pairs.forEach(([key, expected]) => same(inputs[key], expected, "H2P2_CROSS_BINDING", key));
  ["source_export_manifest_sha256", "source_archive_sha256"].forEach((key) => pin(inputs[key], "H2P2_DERIVED_SOURCE"));
  ["source_export_file_count", "source_export_byte_count", "source_archive_byte_count"].forEach((key) => ok(Number.isInteger(inputs[key]) && Number(inputs[key]) > 0, "H2P2_DERIVED_SOURCE", `${key} required`));
}
function receipt(value: O, recipeValue: O): void {
  validate(value, XS, "H2P2_RECEIPT_SCHEMA"); same(value.receipt_sha256, receiptDigest(value), "H2P2_RECEIPT_HASH", "receipt self hash");
  ok(value.claim_scope === "issue_101_packet_2_build_reproducibility_only" && value.production_authority_activated === false, "H2P2_PRODUCTION_CLAIM", "production authority forbidden");
  const execution = asObject(value.execution as J, "H2P2_EXECUTION"), podman = asObject(execution.podman as J, "H2P2_PODMAN"), identities = asObject(execution.tool_identities as J, "H2P2_TOOLS"), inputs = asObject(value.inputs as J, "H2P2_INPUTS");
  policy(asObject(execution.policy as J, "H2P2_POLICY"), "H2P2_POLICY"); ok(podman.rootless === true, "H2P2_ROOTLESS", "rootless Podman required"); exactVersion(podman.version, "H2P2_PODMAN"); pin(podman.artifact_sha256, "H2P2_PODMAN");
  ["cargo", "rustc", "musl", "node", "podman"].forEach((name) => {
    const identity = asObject(identities[name] as J, "H2P2_TOOLS");
    exactVersion(identity.version, "H2P2_TOOLS");
    pin(identity.artifact_sha256, "H2P2_TOOLS");
  });
  const commands = asObject(value.commands as J, "H2P2_COMMANDS");
  distinct(Object.values(commands), "H2P2_COMMANDS", "command hashes");
  const output = asObject(value.outputs as J, "H2P2_OUTPUTS"), resultMembers = members(output.members, "H2P2_OUTPUTS"), passes = asObject(value.intra_run as J, "H2P2_INTRA_RUN"), first = members(passes.pass_1, "H2P2_INTRA_RUN"), second = members(passes.pass_2, "H2P2_INTRA_RUN");
  const evidence = [
    ...resultMembers.map((member) => member.sha256),
    output.rootfs_inventory_sha256,
    output.static_linkage_sha256,
    output.readelf_sha256,
    digest(output.oci_image_id, "H2P2_OUTPUTS"),
  ];
  distinct(evidence, "H2P2_OUTPUTS", "output and evidence hashes");
  ok(passes.equal === true && canonical(resultMembers) === canonical(first) && canonical(first) === canonical(second), "H2P2_PASS_MISMATCH", "two clean passes must be identical");
  if (value.status === "synthetic_contract_fixture") { ok(recipeValue.approval_status === "pending_external_base_digest_review" && execution.platform === "synthetic", "H2P2_SYNTHETIC_BOUNDARY", "synthetic receipt requires pending recipe and synthetic platform"); return; }
  ok(value.status === "observed_linux_build_candidate", "H2P2_STATUS", "unknown receipt status"); ok(recipeValue.approval_status === "approved_immutable_inputs", "H2P2_PENDING_RECIPE", "observed receipt requires approved recipe"); ok(execution.platform === "linux" && execution.architecture === "x86_64", "H2P2_OBSERVED_PLATFORM", "observed receipt must be Linux x86_64"); cross(recipeValue, inputs);
  const req = asObject(recipeValue.tool_requirements as J, "H2P2_TOOLS"); ["cargo", "rustc", "musl", "node"].forEach((name) => same(identities[name], req[name], "H2P2_TOOL_CROSS_BINDING", name));
  same(identities.podman, { version: podman.version!, artifact_sha256: podman.artifact_sha256! }, "H2P2_PODMAN", "runtime podman identity"); const pReq = asObject(req.podman as J, "H2P2_TOOLS"); ok(versionAtLeast(String(podman.version), String(pReq.version)), "H2P2_PODMAN", "Podman runtime below approved minimum");
}
function comparison(recipeValue: O, a: O, b: O, mode: "synthetic" | "observed", run: string, principal: string): O {
  recipe(recipeValue);
  receipt(a, recipeValue);
  receipt(b, recipeValue);
  const observed = mode === "observed";
  ok(
    observed
      ? a.status === "observed_linux_build_candidate" && b.status === "observed_linux_build_candidate" && recipeValue.approval_status === "approved_immutable_inputs"
      : a.status === "synthetic_contract_fixture" && b.status === "synthetic_contract_fixture" && recipeValue.approval_status === "pending_external_base_digest_review",
    "H2P2_COMPARISON_MODE",
    "comparison mode/status/recipe mismatch",
  );
  if (observed) {
    const identities: [string, string][] = [
      ["receipt_a.run_id", String(a.run_id)],
      ["receipt_a.principal", String(a.principal)],
      ["receipt_a.surface_id", String(a.surface_id)],
      ["receipt_a.independence_group", String(a.independence_group)],
      ["receipt_b.run_id", String(b.run_id)],
      ["receipt_b.principal", String(b.principal)],
      ["receipt_b.surface_id", String(b.surface_id)],
      ["receipt_b.independence_group", String(b.independence_group)],
      ["comparator.run_id", run],
      ["comparator.principal", principal],
    ];
    const seen = new Map<string, string>();
    identities.forEach(([label, identity]) => {
      const previous = seen.get(identity);
      if (previous !== undefined) {
        const code = label.startsWith("comparator.") || previous.startsWith("comparator.")
          ? "H2P2_COMPARATOR_IDENTITY"
          : "H2P2_INDEPENDENCE";
        fail(code, `${label} collides with ${previous}`);
      }
      seen.set(identity, label);
    });
  }
  const comparable = (receiptValue: O): O => {
    const x = clone(receiptValue);
    delete x.receipt_sha256;
    delete x.run_id;
    delete x.principal;
    delete x.surface_id;
    delete x.independence_group;
    const execution = asObject(x.execution as J, "H2P2_EXECUTION");
    delete execution.kernel_release;
    delete execution.podman;
    delete asObject(execution.tool_identities as J, "H2P2_TOOLS").podman;
    return x;
  };
  const result = canonical(comparable(a)) === canonical(comparable(b)) ? "candidate_reproducibility_match" : "candidate_reproducibility_mismatch";
  const value: O = {
    schema_version: "gate_h2_build_receipt_comparison_v1",
    status: observed ? "observed_linux_build_candidate" : "synthetic_contract_fixture",
    comparator_run_id: run,
    comparator_principal: principal,
    mode,
    result,
    receipt_a_sha256: a.receipt_sha256!,
    receipt_b_sha256: b.receipt_sha256!,
    recipe_sha256: recipeValue.recipe_sha256!,
  };
  validate(value, ZS, "H2P2_COMPARISON_SCHEMA");
  return value;
}
function tree(root: string) {
  const files: string[] = [];
  const walk = (directory: string): void => {
    fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(child);
          return;
        }
        ok(entry.isFile(), "H2P2_FIXTURE_FILE", "fixture must only contain regular files");
        files.push(path.relative(root, child).split(path.sep).join("/"));
      });
  };
  walk(root);
  let bytes = 0;
  const rows = files.map((file) => {
    const body = secureRead(path.join(root, file));
    bytes += body.length;
    return `${file}\t${sha(body)}\t${body.length}\n`;
  });
  return { sha256: sha(rows.join("")), file_count: files.length, byte_count: bytes };
}
function expectedRegistry(t: { sha256: string; file_count: number; byte_count: number }): O {
  return {
    stable_id: ID,
    schema_version: "dataset_factory_artifact_registry_v0",
    artifact_schema_version: "gate_h2_builder_receipts_v1.0.0",
    artifact_kind: "directory",
    content_digest: { algorithm: "sha256", value: t.sha256, scope: "sorted_tree_manifest" },
    counts: { file_count: t.file_count, byte_count: t.byte_count },
    source_lineage: {
      description: "Issue #101 Packet 2 local, no-secrets hermetic-builder recipe and synthetic receipt comparator contract.",
      source_artifact_ids: [DEP],
      source_urls: ["https://github.com/zouantchaw/mtl-archives-search/issues/101"],
    },
    storage: { storage_class: "tracked_repository", path_class: "tracked_fixture", locator: "docs/dataset-factory/fixtures/gate-h2-builder-receipts-v1" },
    generation: {
      method: "automated",
      command: "npm run gate-h2:builder-receipts-fixture-verify && npm run gate-h2:builder-receipts-self-test",
      code_ref: "codex/101-linux-builder-receipts",
      human_input_ids: [],
    },
    dependency_ids: [DEP],
    required_by: ["issue #101 immutable external builder review and independent observed Linux receipts"],
    rights_boundary: {
      license_id: "MIT",
      attribution: "MTL Archives contributors",
      commercial_use_allowed: true,
      notes: "Synthetic, local, no-secrets, nonproduction contract fixture only. It cannot activate production authority or constitute observed Linux build evidence.",
    },
    created_at: "2026-08-06T00:00:00.000Z",
    creation_time_basis: "report_metadata",
  };
}
function verify(root = FIX, registry = REG): O {
  ok(path.isAbsolute(root), "H2P2_PATH", "absolute fixture root required");
  const names = ["pending-builder-recipe.json", "synthetic-receipt-a.json", "synthetic-receipt-b.json", "synthetic-comparison.json"];
  same(fs.readdirSync(root).sort(), [...names].sort(), "H2P2_FIXTURE_SET", "exact four-file fixture");
  const r = read(path.join(root, names[0]!));
  const a = read(path.join(root, names[1]!));
  const b = read(path.join(root, names[2]!));
  const z = read(path.join(root, names[3]!));
  recipe(r);
  receipt(a, r);
  receipt(b, r);
  ok(r.approval_status === "pending_external_base_digest_review", "H2P2_FIXTURE_BOUNDARY", "tracked fixture must be pending");
  same(z, comparison(r, a, b, "synthetic", "fixture-comparator", "fixture-comparator-principal"), "H2P2_COMPARISON_FIXTURE", "fixture comparison");
  if (path.resolve(root) !== FIX) {
    names.forEach((name) => {
      ok(secureRead(path.join(root, name)).equals(secureRead(path.join(FIX, name))), "H2P2_EXTERNAL_FIXTURE", "external fixture must be byte-identical");
    });
  }
  const t = tree(root);
  const rows = secureRead(registry).toString("utf8").trim().split("\n").map((line) => asObject(JSON.parse(line) as J, "H2P2_REGISTRY"));
  const matches = rows.filter((row) => row.stable_id === ID);
  ok(matches.length === 1, "H2P2_REGISTRY", "exactly one registry row required");
  same(matches[0], expectedRegistry(t), "H2P2_REGISTRY", "canonical complete registry row");
  return { artifact_id: ID, ...t };
}
// These deterministic approved records are test-only and are never written to the tracked fixture.
function approvedObjects(): { r: O; a: O; b: O } {
  const r = clone(read(path.join(FIX, "pending-builder-recipe.json")));
  r.approval_status = "approved_immutable_inputs";
  r.nonproduction = false;
  r.base_image = {
    reference: `registry.test/builder@sha256:${testHash("base")}`,
    digest: `sha256:${testHash("base")}`,
  };
  r.vendor_tree = {
    sha256: testHash("vendor"),
    file_count: 7,
    byte_count: 701,
    source_replacement_config_sha256: testHash("vendor-config"),
    repository_snapshots: [`registry.test/vendor@sha256:${testHash("snapshot")}`],
  };
  r.trust_roots = testHash("trust-roots");
  const requirements = asObject(r.tool_requirements as J, "H2P2_TOOLS");
  ["cargo", "rustc", "musl", "node"].forEach((name) => {
    asObject(requirements[name] as J, "H2P2_TOOLS").artifact_sha256 = testHash(`tool-${name}`);
  });
  r.recipe_sha256 = recipeDigest(r);

  const outputMembers = N.map((name, index) => ({
    path: name,
    bytes: index + 100,
    sha256: testHash(`output-${name}`),
  }));
  const commitments = asObject(r.commitments as J, "H2P2_COMMITMENTS");
  const source = asObject(r.source as J, "H2P2_SOURCE");
  const image = asObject(r.base_image as J, "H2P2_IMAGE");
  const vendor = asObject(r.vendor_tree as J, "H2P2_VENDOR");

  const make = (suffix: string, podmanHash: string): O => {
    const tools = asObject(r.tool_requirements as J, "H2P2_TOOLS");
    const identities: O = {
      cargo: { ...asObject(tools.cargo as J, "H2P2_TOOLS") },
      rustc: { ...asObject(tools.rustc as J, "H2P2_TOOLS") },
      musl: { ...asObject(tools.musl as J, "H2P2_TOOLS") },
      node: { ...asObject(tools.node as J, "H2P2_TOOLS") },
      podman: { version: "5.2.3", artifact_sha256: podmanHash },
    };
    const value: O = {
      schema_version: "gate_h2_two_clean_build_receipt_v1",
      status: "observed_linux_build_candidate",
      claim_scope: "issue_101_packet_2_build_reproducibility_only",
      production_authority_activated: false,
      run_id: `observed-run-${suffix}`,
      principal: `observed-principal-${suffix}`,
      surface_id: `observed-surface-${suffix}`,
      independence_group: `observed-group-${suffix}`,
      execution: {
        platform: "linux",
        kernel_release: `test-kernel-${suffix}`,
        architecture: "x86_64",
        podman: { ...asObject(identities.podman as J, "H2P2_TOOLS"), rootless: true },
        tool_identities: identities,
        policy: { network: "none", pull: "never", read_only_rootfs: true, offline_cargo: true },
      },
      inputs: {
        target: r.target!,
        source_commit: source.commit!,
        source_git_tree: source.git_tree!,
        source_tree_sha256: source.descriptor_tree_sha256!,
        descriptor_path: source.descriptor_path!,
        descriptor_sha256: source.descriptor_sha256!,
        cargo_lock_sha256: commitments.cargo_lock_sha256!,
        toolchain_lock_sha256: commitments.toolchain_lock_sha256!,
        source_allowlist_sha256: commitments.source_allowlist_sha256!,
        source_export_script_sha256: commitments.source_export_script_sha256!,
        build_script_sha256: commitments.build_script_sha256!,
        oci_assembly_script_sha256: commitments.oci_assembly_script_sha256!,
        source_export_manifest_sha256: testHash("derived-manifest"),
        source_export_file_count: 13,
        source_export_byte_count: 1300,
        source_archive_sha256: testHash("derived-archive"),
        source_archive_byte_count: 1400,
        recipe_sha256: r.recipe_sha256!,
        trust_roots_sha256: r.trust_roots!,
        builder_image_reference: image.reference!,
        builder_image_digest: image.digest!,
        vendor_tree_sha256: vendor.sha256!,
        vendor_file_count: vendor.file_count!,
        vendor_byte_count: vendor.byte_count!,
        vendor_config_sha256: vendor.source_replacement_config_sha256!,
        repository_snapshots: vendor.repository_snapshots!,
      },
      commands: {
        source_export_sha256: testHash("cmd-export"),
        builder_invocation_sha256: testHash("cmd-builder"),
        cargo_build_sha256: testHash("cmd-cargo"),
        oci_assembly_sha256: testHash("cmd-oci"),
      },
      outputs: {
        members: outputMembers,
        oci_image_id: `sha256:${testHash("oci")}`,
        rootfs_inventory_sha256: testHash("rootfs"),
        static_linkage_sha256: testHash("static"),
        readelf_sha256: testHash("readelf"),
      },
      intra_run: { pass_1: outputMembers, pass_2: outputMembers, equal: true },
      receipt_sha256: "",
    };
    value.receipt_sha256 = receiptDigest(value);
    return value;
  };

  return { r, a: make("a", testHash("podman-a")), b: make("b", testHash("podman-b")) };
}
function rejected(caseId: string, code: string, fn: () => void, caseIds: string[]): void {
  try {
    fn();
    fail("H2P2_SELFTEST", `accepted ${caseId}`);
  } catch (error) {
    if (!(error instanceof E) || error.code !== code) {
      fail("H2P2_SELFTEST", `${caseId} expected ${code}, got ${error instanceof E ? error.code : String(error)}`);
    }
  }
  caseIds.push(caseId);
}
function verifyNpmWiring(): void {
  const rootPackage = asObject(JSON.parse(secureRead(path.join(ROOT, "package.json")).toString("utf8")) as J, "H2P2_SELFTEST");
  const workspacePackage = asObject(JSON.parse(secureRead(path.join(ROOT, "packages/scripts/package.json")).toString("utf8")) as J, "H2P2_SELFTEST");
  const rootScripts = asObject(rootPackage.scripts as J, "H2P2_SELFTEST");
  const workspaceScripts = asObject(workspacePackage.scripts as J, "H2P2_SELFTEST");
  same(
    {
      generic: rootScripts["gate-h2:builder-receipts"]!,
      fixture_verify: rootScripts["gate-h2:builder-receipts-fixture-verify"]!,
      self_test: rootScripts["gate-h2:builder-receipts-self-test"]!,
    },
    {
      generic: "npm run dataset-factory:gate-h2-builder-receipts-v1 --workspace=@mtl-archives/scripts --",
      fixture_verify: "npm run dataset-factory:gate-h2-builder-receipts-verify-v1 --workspace=@mtl-archives/scripts --",
      self_test: "npm run dataset-factory:gate-h2-builder-receipts-self-test-v1 --workspace=@mtl-archives/scripts --",
    },
    "H2P2_SELFTEST",
    "exact root npm forwarding wiring",
  );
  same(
    {
      generic: workspaceScripts["dataset-factory:gate-h2-builder-receipts-v1"]!,
      fixture_verify: workspaceScripts["dataset-factory:gate-h2-builder-receipts-verify-v1"]!,
      self_test: workspaceScripts["dataset-factory:gate-h2-builder-receipts-self-test-v1"]!,
    },
    {
      generic: "tsx src/dataset-factory/gate-h2-builder-receipts-v1.ts",
      fixture_verify: "tsx src/dataset-factory/gate-h2-builder-receipts-v1.ts verify",
      self_test: "tsx src/dataset-factory/gate-h2-builder-receipts-v1.ts self-test",
    },
    "H2P2_SELFTEST",
    "exact workspace npm forwarding wiring",
  );
}
function selfTest(): O {
  verifyNpmWiring();
  const { r, a, b } = approvedObjects();
  recipe(r);
  receipt(a, r);
  receipt(b, r);
  const observed = comparison(r, a, b, "observed", "observer-run", "observer-principal");
  ok(observed.result === "candidate_reproducibility_match", "H2P2_SELFTEST", "kernel and Podman runtime differences must match");
  const differentManifest = clone(b);
  asObject(differentManifest.inputs as J, "H2P2_INPUTS").source_export_manifest_sha256 = testHash("different-manifest");
  differentManifest.receipt_sha256 = receiptDigest(differentManifest);
  ok(comparison(r, a, differentManifest, "observed", "manifest-run", "manifest-principal").result === "candidate_reproducibility_mismatch", "H2P2_SELFTEST", "derived source difference must mismatch");
  const differentOutput = clone(b);
  const changedHash = testHash("different-output");
  [
    asObject(differentOutput.outputs as J, "H2P2_OUTPUTS").members as O[],
    asObject(differentOutput.intra_run as J, "H2P2_INTRA_RUN").pass_1 as O[],
    asObject(differentOutput.intra_run as J, "H2P2_INTRA_RUN").pass_2 as O[],
  ].forEach((members) => { members[0]!.sha256 = changedHash; });
  differentOutput.receipt_sha256 = receiptDigest(differentOutput);
  ok(comparison(r, a, differentOutput, "observed", "output-run", "output-principal").result === "candidate_reproducibility_mismatch", "H2P2_SELFTEST", "output difference must mismatch");
  verify();
  const pending = read(path.join(FIX, "pending-builder-recipe.json"));
  const synthetic = read(path.join(FIX, "synthetic-receipt-a.json"));
  const cases: string[] = [];
  const rr = (id: string, code: string, mutate: (x: O) => void) => {
    rejected(id, code, () => {
      const x = clone(r);
      mutate(x);
      x.recipe_sha256 = recipeDigest(x);
      recipe(x);
    }, cases);
  };
  const rx = (id: string, code: string, mutate: (x: O) => void) => {
    rejected(id, code, () => {
      const x = clone(a);
      mutate(x);
      x.receipt_sha256 = receiptDigest(x);
      receipt(x, r);
    }, cases);
  };
  rr("schema/recipe-extra", "H2P2_RECIPE_SCHEMA", (x) => { (x as unknown as Record<string, J>).extra = true; });
  rr("schema/policy-network", "H2P2_RECIPE_SCHEMA", (x) => { (asObject(x.policy as J, "x")).network = "bridge"; });
  rr("schema/pending-nonproduction", "H2P2_RECIPE_SCHEMA", (x) => { x.approval_status = "pending_external_base_digest_review"; x.nonproduction = false; x.base_image = null; x.vendor_tree = null; x.trust_roots = null; });
  rr("schema/pending-tool-artifact", "H2P2_RECIPE_SCHEMA", (x) => { x.approval_status = "pending_external_base_digest_review"; x.nonproduction = true; x.base_image = null; x.vendor_tree = null; x.trust_roots = null; (asObject(asObject(x.tool_requirements as J, "x").cargo as J, "x")).artifact_sha256 = testHash("unapproved"); });
  rejected("semantic/recipe-hash", "H2P2_RECIPE_HASH", () => { const x = clone(r); x.recipe_sha256 = testHash("wrong-recipe"); recipe(x); }, cases);
  rr("source/git-tree", "H2P2_SOURCE", (x) => { asObject(x.source as J, "x").git_tree = "a".repeat(40); });
  rr("source/descriptor-hash", "H2P2_SOURCE", (x) => { asObject(x.source as J, "x").descriptor_sha256 = testHash("descriptor-sub"); });
  rr("source/descriptor-tree", "H2P2_SOURCE", (x) => { asObject(x.source as J, "x").descriptor_tree_sha256 = testHash("tree-sub"); });
  rr("source/descriptor-count", "H2P2_RECIPE_SCHEMA", (x) => { asObject(x.source as J, "x").descriptor_file_count = 56; });
  rr("source/descriptor-bytes", "H2P2_RECIPE_SCHEMA", (x) => { asObject(x.source as J, "x").descriptor_byte_count = 1; });
  ["cargo_lock_sha256", "toolchain_lock_sha256", "source_allowlist_sha256", "source_export_script_sha256", "build_script_sha256", "oci_assembly_script_sha256"].forEach((key) => rr(`commitment/${key}`, "H2P2_COMMITMENTS", (x) => { asObject(x.commitments as J, "x")[key] = testHash(`sub-${key}`); }));
  rr("commitment/repeated", "H2P2_COMMITMENTS", (x) => { const c = asObject(x.commitments as J, "x"); c.toolchain_lock_sha256 = c.cargo_lock_sha256!; });
  rr("approved/image-reference", "H2P2_IMAGE", (x) => { asObject(x.base_image as J, "x").reference = `registry.test/builder:latest@sha256:${testHash("base")}`; });
  rr("approved/image-digest", "H2P2_IMAGE", (x) => { asObject(x.base_image as J, "x").digest = `sha256:${testHash("other-base")}`; });
  rr("approved/vendor-placeholder", "H2P2_VENDOR", (x) => { asObject(x.vendor_tree as J, "x").sha256 = "a".repeat(64); });
  rr("approved/vendor-snapshot", "H2P2_VENDOR", (x) => { asObject(x.vendor_tree as J, "x").repository_snapshots = [`registry.test/vendor:latest@sha256:${testHash("latest-snapshot")}`]; });
  rr("approved/periodic-snapshot", "H2P2_VENDOR", (x) => { asObject(x.vendor_tree as J, "x").repository_snapshots = [`registry.test/vendor@sha256:${"ab".repeat(32)}`]; });
  rr("approved/trust-root", "H2P2_TRUST_ROOTS", (x) => { x.trust_roots = "a".repeat(64); });
  rr("approved/tool-artifact", "H2P2_TOOLS", (x) => { asObject(asObject(x.tool_requirements as J, "x").rustc as J, "x").artifact_sha256 = "a".repeat(64); });
  rx("schema/receipt-extra", "H2P2_RECEIPT_SCHEMA", (x) => { (x as unknown as Record<string, J>).extra = true; });
  rx("schema/admitted", "H2P2_RECEIPT_SCHEMA", (x) => { (x as unknown as Record<string, J>).admitted = true; });
  rx("schema/published", "H2P2_RECEIPT_SCHEMA", (x) => { (x as unknown as Record<string, J>).published = true; });
  rx("schema/production-authority", "H2P2_RECEIPT_SCHEMA", (x) => { x.production_authority_activated = true; });
  rejected("semantic/receipt-hash", "H2P2_RECEIPT_HASH", () => { const x = clone(a); x.receipt_sha256 = testHash("wrong-receipt"); receipt(x, r); }, cases);
  rx("policy/receipt-network", "H2P2_RECEIPT_SCHEMA", (x) => { asObject(asObject(x.execution as J, "x").policy as J, "x").network = "bridge"; });
  rx("rootless/false", "H2P2_ROOTLESS", (x) => { asObject(asObject(x.execution as J, "x").podman as J, "x").rootless = false; });
  rx("platform/not-linux", "H2P2_OBSERVED_PLATFORM", (x) => { asObject(x.execution as J, "x").platform = "darwin"; });
  rx("platform/not-x86", "H2P2_OBSERVED_PLATFORM", (x) => { asObject(x.execution as J, "x").architecture = "arm64"; });
  rx("tool/rustc-mismatch", "H2P2_TOOL_CROSS_BINDING", (x) => { asObject(asObject(asObject(x.execution as J, "x").tool_identities as J, "x").rustc as J, "x").artifact_sha256 = testHash("other-rustc"); });
  rx("tool/podman-identity", "H2P2_PODMAN", (x) => { asObject(asObject(asObject(x.execution as J, "x").tool_identities as J, "x").podman as J, "x").artifact_sha256 = testHash("other-podman"); });
  [
    "source_commit",
    "source_git_tree",
    "source_tree_sha256",
    "descriptor_sha256",
    "cargo_lock_sha256",
    "toolchain_lock_sha256",
    "source_allowlist_sha256",
    "source_export_script_sha256",
    "build_script_sha256",
    "oci_assembly_script_sha256",
    "recipe_sha256",
    "trust_roots_sha256",
    "vendor_tree_sha256",
  ].forEach((key) => rx(`cross/${key}`, "H2P2_CROSS_BINDING", (x) => {
    const inputs = asObject(x.inputs as J, "x");
    inputs[key] = key === "source_commit" || key === "source_git_tree"
      ? "a".repeat(40)
      : testHash(`other-${key}`);
  }));
  rx("schema/descriptor-path", "H2P2_RECEIPT_SCHEMA", (x) => { asObject(x.inputs as J, "x").descriptor_path = "docs/other.json"; });
  rx("builder/reference-cross", "H2P2_CROSS_BINDING", (x) => { asObject(x.inputs as J, "x").builder_image_reference = `registry.test/other@sha256:${testHash("other-image")}`; });
  rx("builder/digest-cross", "H2P2_CROSS_BINDING", (x) => { asObject(x.inputs as J, "x").builder_image_digest = `sha256:${testHash("other-image")}`; });
  rx("derived/manifest-placeholder", "H2P2_DERIVED_SOURCE", (x) => { asObject(x.inputs as J, "x").source_export_manifest_sha256 = "a".repeat(64); });
  rx("schema/derived-archive-count", "H2P2_RECEIPT_SCHEMA", (x) => { asObject(x.inputs as J, "x").source_archive_byte_count = 0; });
  rx("commands/placeholder", "H2P2_COMMANDS", (x) => { asObject(x.commands as J, "x").cargo_build_sha256 = "a".repeat(64); });
  rx("commands/repeated", "H2P2_COMMANDS", (x) => { const commands = asObject(x.commands as J, "x"); commands.cargo_build_sha256 = commands.source_export_sha256!; });
  rx("outputs/order", "H2P2_MEMBER_ORDER", (x) => { (asObject(x.outputs as J, "x").members as O[]).reverse(); });
  rx("outputs/oci-placeholder", "H2P2_OUTPUTS", (x) => { asObject(x.outputs as J, "x").oci_image_id = `sha256:${"a".repeat(64)}`; });
  rx("outputs/repeated-evidence", "H2P2_OUTPUTS", (x) => { const members = asObject(x.outputs as J, "x").members as O[]; members[1]!.sha256 = members[0]!.sha256; });
  rx("passes/mismatch", "H2P2_PASS_MISMATCH", (x) => { (asObject(x.intra_run as J, "x").pass_2 as O[])[0]!.bytes = 999; });
  rejected("status/observed-pending", "H2P2_PENDING_RECIPE", () => { const x = clone(synthetic); x.status = "observed_linux_build_candidate"; const e = asObject(x.execution as J, "x"); e.platform = "linux"; e.architecture = "x86_64"; x.receipt_sha256 = receiptDigest(x); receipt(x, pending); }, cases);
  rejected("comparison/mode", "H2P2_COMPARISON_MODE", () => comparison(r, a, b, "synthetic", "c", "p"), cases);
  rejected("comparison/run-identity", "H2P2_INDEPENDENCE", () => { const q = clone(b); q.run_id = a.run_id; q.receipt_sha256 = receiptDigest(q); comparison(r, a, q, "observed", "c", "p"); }, cases);
  ["surface_id", "independence_group", "principal"].forEach((key) => rejected(`identity/duplicate-${key}`, "H2P2_INDEPENDENCE", () => { const q = clone(b); q[key] = a[key]!; q.receipt_sha256 = receiptDigest(q); comparison(r, a, q, "observed", "c", "p"); }, cases));
  rejected("identity/cross-role-a-principal-b-run", "H2P2_INDEPENDENCE", () => { const q = clone(b); q.run_id = a.principal!; q.receipt_sha256 = receiptDigest(q); comparison(r, a, q, "observed", "c", "p"); }, cases);
  rejected("identity/same-receipt-run-principal", "H2P2_INDEPENDENCE", () => { const q = clone(b); q.principal = q.run_id!; q.receipt_sha256 = receiptDigest(q); comparison(r, a, q, "observed", "c", "p"); }, cases);
  rejected("comparison/comparator-identity", "H2P2_COMPARATOR_IDENTITY", () => comparison(r, a, b, "observed", a.run_id as string, "c"), cases);
  rejected("identity/comparator-principal", "H2P2_COMPARATOR_IDENTITY", () => comparison(r, a, b, "observed", "fresh-run", a.principal as string), cases);
  rejected("identity/comparator-run-equals-principal", "H2P2_COMPARATOR_IDENTITY", () => comparison(r, a, b, "observed", "same", "same"), cases);
  rejected("identity/comparator-vs-surface", "H2P2_COMPARATOR_IDENTITY", () => comparison(r, a, b, "observed", String(a.surface_id), "fresh-principal"), cases);
  rejected("identity/comparator-vs-group", "H2P2_COMPARATOR_IDENTITY", () => comparison(r, a, b, "observed", "fresh-run", String(b.independence_group)), cases);
  const temporary = fs.mkdtempSync(path.join(ROOT, ".h2p2-"));
  try {
    const plain = path.join(temporary, "plain.json");
    const link = path.join(temporary, "link.json");
    const directory = path.join(temporary, "directory");
    const targetDirectory = path.join(temporary, "target-directory");
    const ancestorLink = path.join(temporary, "ancestor-link");
    fs.writeFileSync(plain, canonical(pending) + "\n");
    fs.symlinkSync(plain, link);
    fs.mkdirSync(directory);
    fs.mkdirSync(targetDirectory);
    fs.writeFileSync(path.join(targetDirectory, "child.json"), canonical(pending) + "\n");
    fs.symlinkSync(targetDirectory, ancestorLink);
    rejected("secure-read/leaf-symlink", "H2P2_SYMLINK", () => read(link), cases);
    rejected("secure-read/ancestor-symlink", "H2P2_SYMLINK", () => read(path.join(ancestorLink, "child.json")), cases);
    rejected("secure-read/nonregular", "H2P2_REGULAR_FILE", () => read(directory), cases);
    rejected("secure-read/root", "H2P2_REGULAR_FILE", () => secureRead(path.parse(ROOT).root), cases);
    fs.writeFileSync(plain, JSON.stringify(pending));
    rejected("noncanonical/json", "H2P2_NONCANONICAL", () => read(plain), cases);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const external = fs.mkdtempSync(path.join(ROOT, ".h2p2-external-"));
  try {
    ["pending-builder-recipe.json", "synthetic-receipt-a.json", "synthetic-receipt-b.json", "synthetic-comparison.json"].forEach((name) => {
      fs.copyFileSync(path.join(FIX, name), path.join(external, name));
    });
    const externalReceipt = read(path.join(external, "synthetic-receipt-a.json"));
    externalReceipt.run_id = "external-drift";
    externalReceipt.receipt_sha256 = receiptDigest(externalReceipt);
    const externalComparison = read(path.join(external, "synthetic-comparison.json"));
    externalComparison.receipt_a_sha256 = externalReceipt.receipt_sha256;
    fs.writeFileSync(path.join(external, "synthetic-receipt-a.json"), canonical(externalReceipt) + "\n");
    fs.writeFileSync(path.join(external, "synthetic-comparison.json"), canonical(externalComparison) + "\n");
    rejected("external/byte-identical", "H2P2_EXTERNAL_FIXTURE", () => verify(external), cases);
  } finally {
    fs.rmSync(external, { recursive: true, force: true });
  }
  const registryTemp = path.join(ROOT, `.h2p2-registry-${process.pid}.jsonl`);
  try {
    const registryRows = secureRead(REG).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    registryRows.find((entry) => entry.stable_id === ID).content_digest.value = testHash("registry-drift");
    fs.writeFileSync(registryTemp, registryRows.map(canonical).join("\n") + "\n");
    rejected("registry/canonical-row", "H2P2_REGISTRY", () => verify(FIX, registryTemp), cases);
  } finally {
    fs.rmSync(registryTemp, { force: true });
  }
  const packetRegistry = path.join(ROOT, `.h2p2-packet1-${process.pid}.jsonl`);
  try {
    const registryRows = secureRead(REG).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    registryRows.find((entry) => entry.stable_id === ID).dependency_ids = [];
    fs.writeFileSync(packetRegistry, registryRows.map(canonical).join("\n") + "\n");
    rejected("packet1/dependency-exact", "H2P2_REGISTRY", () => verify(FIX, packetRegistry), cases);
  } finally {
    fs.rmSync(packetRegistry, { force: true });
  }
  const packetOne = asObject(
    JSON.parse(
      secureRead(path.join(ROOT, "docs/dataset-factory/fixtures/gate-h2-linux-conformance-v1/run-evidence.json")).toString("utf8"),
    ) as J,
    "H2P2_JSON",
  );
  rejected("packet1/run-evidence-not-receipt", "H2P2_RECEIPT_SCHEMA", () => receipt(packetOne, r), cases);
  same(cases, [...EXPECTED_CASE_IDS], "H2P2_SELFTEST", "exact ordered adversarial case set");
  const category_counts = cases.reduce<Record<string, number>>((result, id) => {
    const category = id.split("/")[0]!;
    result[category] = (result[category] ?? 0) + 1;
    return result;
  }, {});
  return { passed: true, case_ids: [...EXPECTED_CASE_IDS], category_counts };
}
function main(): void { const [command = "verify", ...args] = process.argv.slice(2); if (command === "verify") console.log(canonical(verify(args[0] ?? FIX))); else if (command === "self-test") console.log(canonical(selfTest())); else if (command === "validate-recipe") { ok(args.length === 1, "H2P2_ARGS", "one recipe path required"); recipe(read(args[0]!)); console.log("ok"); } else if (command === "validate-receipt") { ok(args.length === 2, "H2P2_ARGS", "recipe and receipt paths required"); const r = read(args[0]!); recipe(r); receipt(read(args[1]!), r); console.log("ok"); } else if (command === "compare") { ok(args.length === 6 && (args[3] === "synthetic" || args[3] === "observed"), "H2P2_ARGS", "recipe a b mode run principal required"); console.log(canonical(comparison(read(args[0]!), read(args[1]!), read(args[2]!), args[3]! as "synthetic" | "observed", args[4]!, args[5]!))); } else fail("H2P2_COMMAND", "invalid command"); }
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
