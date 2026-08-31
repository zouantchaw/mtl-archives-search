import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, cpSync, existsSync, fstatSync, linkSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { admitOciOutput } from "./admit-oci-output.mjs";
import { publishAdmittedCapability } from "./publish-oci-output.mjs";
import { configureVerifiedHelpers } from "./run-verified-helper.mjs";
import { createDurableDirectory } from "./secure-files.mjs";
import { tarBytes } from "./test-tar-fixture.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const crate = dirname(scripts);
const helperTarget = mkdtempSync(join(tmpdir(), "gate-h2-admission-helper-build-"));
const helperDirectory = mkdtempSync(join(tmpdir(), "gate-h2-admission-helpers-"));
const build = spawnSync("cargo", ["build", "--manifest-path", join(crate, "Cargo.toml"), "--locked", "--offline", "--features", "test-fault-injection", "--target-dir", helperTarget, "--bin", "gate-h2-secure-candidate-read", "--bin", "gate-h2-publish-noreplace"], { encoding: "utf8" });
if (build.status !== 0) throw new Error(`secure candidate reader build failed: ${build.stderr}`);
const secureReader = join(helperTarget, "debug", "gate-h2-secure-candidate-read");
const inner = join(scripts, "build-stage-oci-inner.sh");
const root = mkdtempSync(join(tmpdir(), "gate-h2-admission-test-"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value, newline = false) => Buffer.from(`${JSON.stringify(value)}${newline ? "\n" : ""}`);
const writeJson = (path, value) => writeFileSync(path, json(value, true));
const source = { schema_version: "gate_h2_sanitized_source_export_v1.0.0", source_commit: "d".repeat(40), source_tree: "e".repeat(40), source_allowlist_sha256: "9".repeat(64), source_archive_sha256: "f".repeat(64), source_manifest_sha256: "1".repeat(64), source_file_count: 12, source_byte_count: 3456 };
const sourcePath = join(root, "source.json"); writeJson(sourcePath, source);
const helperEntries = ["gate-h2-publish-noreplace", "gate-h2-secure-candidate-read"].map((name) => {
  const built = join(helperTarget, "debug", name), installed = join(helperDirectory, name); cpSync(built, installed); chmodSync(installed, 0o555);
  const bytes = readFileSync(installed), digest = sha256(bytes);
  for (const pass of ["pass-1", "pass-2"]) { const path = join(helperDirectory, `${name}.${pass}`); cpSync(built, path); chmodSync(path, 0o444); }
  return { name, bytes: bytes.length, mode: 0o555, pass_1_sha256: digest, pass_2_sha256: digest, sha256: digest };
});
const helperManifest = join(helperDirectory, "helper-manifest.v1.json");
writeJson(helperManifest, { schema_version: "gate_h2_host_helper_manifest_v1.0.0", source_manifest_sha256: source.source_manifest_sha256, builder_image_digest: "c".repeat(64), helpers: helperEntries });
chmodSync(helperManifest, 0o444);
configureVerifiedHelpers(helperDirectory, helperManifest, sha256(readFileSync(helperManifest)), source.source_manifest_sha256, "c".repeat(64));
if (process.platform === "linux" && helperEntries.some(({ name }) => existsSync(join(helperDirectory, name)))) throw new Error("verified Linux helper pathname remained replaceable");
const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { type: "application", name: "gate-h2-stage-runtime", version: "0.1.0" } }, components: [
  { type: "application", name: "gate-h2-broker", version: "0.1.0", licenses: [{ expression: "MIT" }], purl: "pkg:cargo/gate-h2-broker@0.1.0" },
  { type: "library", name: "sha2", version: "0.10.9", licenses: [{ expression: "MIT OR Apache-2.0" }], purl: "pkg:cargo/sha2@0.10.9" },
] };
const expectedSbomPath = join(root, "expected-sbom.json"); writeJson(expectedSbomPath, sbom);
let trustDigest;
const run = (candidate, output, env = {}, operations = {}) => {
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    const capability = admitOciOutput(candidate, output, sourcePath, expectedSbomPath, "a".repeat(64), "2".repeat(64), trustDigest, `builder.invalid/image@sha256:${"c".repeat(64)}`, "c".repeat(64), { ...operations, ...(process.platform === "linux" ? {} : { testOnlyRetainedDirectory: output }) });
    return { status: 0, stderr: "", capability };
  } catch (error) {
    return { status: 1, stderr: `${error?.message ?? error}` };
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
};
const runReader = (candidate, env = {}) => spawnSync(secureReader, [candidate], { maxBuffer: 257 * 1024 * 1024, env: { ...process.env, ...env } });

function rootfsEntries(stage, trust, mutate = (entries) => entries) {
  return mutate([
    { name: "./", type: "5", mode: 0o755 }, { name: "./etc/", type: "5", mode: 0o755 }, { name: "./etc/ssl/", type: "5", mode: 0o755 }, { name: "./etc/ssl/certs/", type: "5", mode: 0o755 },
    { name: "./etc/ssl/certs/ca-certificates.crt", type: "0", mode: 0o444, bytes: trust }, { name: "./usr/", type: "5", mode: 0o755 }, { name: "./usr/local/", type: "5", mode: 0o755 }, { name: "./usr/local/bin/", type: "5", mode: 0o755 },
    { name: "./usr/local/bin/gate-h2-stage-runtime", type: "0", mode: 0o555, bytes: stage },
  ]);
}

function buildCandidate(path, options = {}) {
  mkdirSync(path); chmodSync(path, 0o700);
  const broker = options.broker ?? Buffer.from("broker binary fixture\n");
  const stage = options.stage ?? Buffer.from("stage binary fixture\n");
  const trust = options.trust ?? Buffer.from("trust roots fixture\n"); trustDigest = sha256(trust);
  const rootfs = options.rootfsBytes ?? tarBytes(rootfsEntries(stage, trust, options.mutateRootfs));
  const layerBytes = options.layerBytes ?? rootfs;
  let configObject = { architecture: "amd64", os: "linux", config: { User: "65532:65532", Entrypoint: ["/usr/local/bin/gate-h2-stage-runtime"] }, rootfs: { type: "layers", diff_ids: [`sha256:${sha256(layerBytes)}`] }, history: [{ created_by: "gate-h2-hermetic-builder-v2" }] };
  configObject = options.mutateConfig?.(configObject) ?? configObject;
  const blobs = new Map(); const blob = (bytes) => { const digest = sha256(bytes); blobs.set(digest, bytes); return { digest: `sha256:${digest}`, size: bytes.length }; };
  const layer = blob(layerBytes); const config = blob(json(configObject));
  let manifestObject = { schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config }, layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", ...layer }] };
  manifestObject = options.mutateManifest?.(manifestObject) ?? manifestObject;
  const manifest = blob(json(manifestObject));
  let indexObject = { schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{ mediaType: "application/vnd.oci.image.manifest.v1+json", ...manifest, platform: { architecture: "amd64", os: "linux" } }] };
  indexObject = options.mutateIndex?.(indexObject) ?? indexObject;
  const ociEntries = [
    { name: "./", type: "5", mode: 0o755 }, { name: "./blobs/", type: "5", mode: 0o755 }, { name: "./blobs/sha256/", type: "5", mode: 0o755 },
    ...[...blobs].sort(([a], [b]) => a.localeCompare(b)).map(([digest, bytes]) => ({ name: `./blobs/sha256/${digest}`, type: "0", mode: 0o444, bytes })),
    { name: "./index.json", type: "0", mode: 0o444, bytes: json(indexObject, true) }, { name: "./oci-layout", type: "0", mode: 0o444, bytes: options.layoutBytes ?? json({ imageLayoutVersion: "1.0.0" }, true) },
  ];
  const oci = tarBytes(options.mutateOciEntries?.(ociEntries) ?? ociEntries);
  const candidateSbom = options.sbom ?? sbom; const sbomBytes = json(candidateSbom, true);
  const provenance = { schema_version: "gate_h2_stage_build_provenance_v1.0.0", source_date_epoch: 0, source_commit: source.source_commit, source_tree: source.source_tree, source_allowlist_sha256: source.source_allowlist_sha256, source_archive_sha256: source.source_archive_sha256, source_manifest_sha256: source.source_manifest_sha256, source_file_count: source.source_file_count, source_byte_count: source.source_byte_count, target: "x86_64-unknown-linux-musl", toolchain_lock_sha256: "a".repeat(64), builder_image: `builder.invalid/image@sha256:${"c".repeat(64)}`, builder_image_digest: "c".repeat(64), cargo_lock_sha256: "2".repeat(64), trust_roots_sha256: trustDigest, broker_binary_sha256: sha256(broker), stage_binary_sha256: sha256(stage), rootfs_sha256: sha256(rootfs), oci_archive_sha256: sha256(oci), oci_image_id: manifest.digest, sbom_sha256: sha256(sbomBytes), network_policy: "inner_candidate_requires_trusted_host_admission", reproducibility_status: "unadmitted_two_build_candidate", production_authority_activated: false, ...(options.provenance ?? {}) };
  for (const [name, bytes, mode] of [["gate-h2-broker", broker, 0o555], ["rootfs.tar", rootfs, 0o444], ["gate-h2-stage.oci.tar", oci, 0o444], ["sbom.cdx.json", sbomBytes, 0o444], ["provenance.json", json(provenance, true), 0o444], ["INNER-CANDIDATE", Buffer.from("candidate_only=true\n"), 0o444]]) { writeFileSync(join(path, name), bytes); chmodSync(join(path, name), mode); }
  return provenance;
}

function reject(name, options, expectedText = "", env = {}) {
  const fixture = join(root, name); buildCandidate(fixture, options); const result = run(fixture, join(root, `out-${name}`), env);
  if (result.status === 0 || (expectedText && !result.stderr.includes(expectedText))) throw new Error(`${name} was not rejected as expected: ${result.stderr}`);
}

try {
  const candidate = join(root, "candidate"); const clean = buildCandidate(candidate);
  const admitted = join(root, "admitted");
  const valid = run(candidate, admitted, { PATH: join(root, "hostile-path"), RUSTC_WRAPPER: join(root, "hostile-wrapper"), CARGO_HOME: join(root, "hostile-cargo-home"), RUSTFLAGS: "hostile-flags" });
  if (valid.status !== 0) throw new Error(`valid admission failed: ${valid.stderr}`);
  if (((await import("node:fs")).statSync(join(admitted, "gate-h2-broker")).mode & 0o7777) !== 0o555) throw new Error("admitted broker lost executable mode");
  const admittedProvenance = { ...clean, network_policy: "digest_pinned_builder_with_network_none_and_offline_cargo", reproducibility_status: "trusted_host_admitted_two_independent_clean_source_builds" };
  if (!readFileSync(join(admitted, "provenance.json")).equals(json(admittedProvenance, true))) throw new Error("admitted provenance did not preserve the frozen field order and final newline");
  for (const retained of [false, true]) {
    const label = retained ? "retained" : "standalone";
    const output = join(root, `descriptor-short-${label}`);
    let descriptorFd;
    const result = run(candidate, output, {}, {
      retainPublicationCapability: retained,
      publicationParent: root,
      descriptorWrite: (fd, bytes, offset, length, position) => { descriptorFd = fd; return writeSync(fd, bytes, offset, Math.min(7, length), position); },
    });
    if (result.status !== 0) throw new Error(`${label} descriptor short writes failed: ${result.stderr}`);
    if (retained) {
      const capabilityBytes = readFileSync(result.capability.descriptorFd);
      if (sha256(capabilityBytes) !== result.capability.descriptorSha256) throw new Error("retained short-write capability returned the wrong descriptor digest");
      for (const fd of result.capability.memberFds) closeSync(fd);
      closeSync(result.capability.descriptorFd); closeSync(result.capability.parentFd);
      if (existsSync(`${output}.admission.json`)) throw new Error("retained short-write admission left a descriptor pathname");
    } else {
      JSON.parse(readFileSync(`${output}.admission.json`, "utf8"));
    }
    try { fstatSync(descriptorFd); throw new Error(`${label} descriptor write FD remained open after success`); } catch (error) { if (error.code !== "EBADF") throw error; }
  }
  const invalidProgress = {
    zero: () => 0,
    negative: () => -1,
    fractional: () => 1.5,
    nan: () => Number.NaN,
    nonnumeric: () => "1",
    unsafe: () => Number.MAX_SAFE_INTEGER + 1,
    oversized: (remaining) => remaining + 1,
  };
  for (const retained of [false, true]) for (const [progressLabel, progress] of Object.entries(invalidProgress)) {
    const label = `${retained ? "retained" : "standalone"}-${progressLabel}`;
    const output = join(root, `descriptor-invalid-${label}`);
    let descriptorFd;
    const result = run(candidate, output, {}, {
      retainPublicationCapability: retained,
      publicationParent: root,
      descriptorWrite: (fd, _bytes, _offset, length) => { descriptorFd = fd; return progress(length); },
    });
    if (result.status === 0 || result.capability || !result.stderr.includes("invalid progress")) throw new Error(`${label} invalid descriptor progress was not rejected: ${result.stderr}`);
    if (existsSync(`${output}.admission.json`) || existsSync(output)) throw new Error(`${label} invalid descriptor progress left admission state`);
    try { fstatSync(descriptorFd); throw new Error(`${label} descriptor write FD remained open after failure`); } catch (error) { if (error.code !== "EBADF") throw error; }
  }
  const retainedCandidate = join(root, "retained-candidate"); buildCandidate(retainedCandidate);
  const retainedSource = join(root, "retained-admitted");
  const capability = admitOciOutput(retainedCandidate, retainedSource, sourcePath, expectedSbomPath, "a".repeat(64), "2".repeat(64), trustDigest, `builder.invalid/image@sha256:${"c".repeat(64)}`, "c".repeat(64), { retainPublicationCapability: true, publicationParent: root, ...(process.platform === "linux" ? {} : { testOnlyRetainedDirectory: retainedSource }) });
  try {
    const movedSource = join(root, "retained-original"); renameSync(retainedSource, movedSource); mkdirSync(retainedSource); chmodSync(retainedSource, 0o700);
    for (const member of ["gate-h2-broker", "gate-h2-stage.oci.tar", "provenance.json", "reproducibility.env", "rootfs.tar", "sbom.cdx.json"]) { writeFileSync(join(retainedSource, member), "forged replacement\n"); chmodSync(join(retainedSource, member), member === "gate-h2-broker" ? 0o555 : 0o444); }
    writeFileSync(join(root, "forged-descriptor.json"), `${JSON.stringify({ schema: "gate_h2_oci_admission_descriptor_v1", source_dev: 0, source_ino: 0, parent_dev: 0, parent_ino: 0, members: [] })}\n`);
    symlinkSync(join(root, "forged-descriptor.json"), capability.descriptorPath);
    const publication = publishAdmittedCapability(capability, "retained-publication");
    if (!JSON.parse(publication.stdout).destination_ino) throw new Error("retained publication receipt missing");
    if (readFileSync(join(root, "retained-publication", "gate-h2-broker")).equals(Buffer.from("forged replacement\n"))) throw new Error("replacement member pathname influenced retained publication");
  } finally {
    for (const fd of capability.memberFds) closeSync(fd);
    closeSync(capability.descriptorFd); closeSync(capability.parentFd);
  }
  const large = join(root, "large"); buildCandidate(large, { stage: Buffer.alloc(2 * 1024 * 1024, 0x5a) }); if (run(large, join(root, "large-out")).status !== 0) throw new Error("valid >1MiB stage runtime was rejected");

  const sizeCheck = (...sizes) => spawnSync(secureReader, ["--check-sizes", ...sizes.map(String)], { encoding: "utf8" });
  if (sizeCheck(64, 32 * 1024 * 1024, 139 * 1024 * 1024, 64 * 1024, 80 * 1024 * 1024, 4 * 1024 * 1024).status !== 0) throw new Error("near-limit aggregate sizes were rejected");
  if (sizeCheck(65, 1, 1, 1, 1, 1).status === 0) throw new Error("marker artifact cap was not enforced");
  if (sizeCheck(64, 32 * 1024 * 1024, 140 * 1024 * 1024, 64 * 1024, 80 * 1024 * 1024, 4 * 1024 * 1024).status === 0) throw new Error("aggregate cap was not enforced");

  for (const [field, value] of [["source_file_count", 13], ["source_byte_count", 3457], ["source_commit", "0".repeat(40)], ["source_tree", "0".repeat(40)], ["source_archive_sha256", "0".repeat(64)], ["source_manifest_sha256", "0".repeat(64)], ["builder_image_digest", "0".repeat(64)], ["toolchain_lock_sha256", "0".repeat(64)], ["cargo_lock_sha256", "0".repeat(64)], ["broker_binary_sha256", "0".repeat(64)], ["stage_binary_sha256", "0".repeat(64)], ["trust_roots_sha256", "0".repeat(64)], ["sbom_sha256", "0".repeat(64)], ["oci_image_id", `sha256:${"0".repeat(64)}`]]) reject(`provenance-${field}`, { provenance: { [field]: value } });
  reject("index-platform", { mutateIndex: (value) => { value.manifests[0].platform.os = "darwin"; return value; } });
  reject("index-media", { mutateIndex: (value) => { value.mediaType = "application/octet-stream"; return value; } });
  reject("index-digest", { mutateIndex: (value) => { value.manifests[0].digest = `sha256:${"0".repeat(64)}`; return value; } });
  reject("index-extra", { mutateIndex: (value) => { value.manifests[0].annotations = {}; return value; } });
  reject("index-size", { mutateIndex: (value) => { value.manifests[0].size += 1; return value; } });
  reject("layout-extra", { layoutBytes: json({ imageLayoutVersion: "1.0.0", extra: true }, true) });
  reject("layout-legal-whitespace", { layoutBytes: Buffer.from('{ "imageLayoutVersion": "1.0.0" }\n') }, "OCI layout is not canonical JSON");
  reject("index-top-level-key-order", { mutateIndex: (value) => ({ mediaType: value.mediaType, schemaVersion: value.schemaVersion, manifests: value.manifests }) }, "OCI index is not canonical JSON");
  reject("manifest-media", { mutateManifest: (value) => { value.layers[0].mediaType = "application/octet-stream"; return value; } });
  reject("manifest-size", { mutateManifest: (value) => { value.layers[0].size += 1; return value; } });
  reject("manifest-config-media", { mutateManifest: (value) => { value.config.mediaType = "application/octet-stream"; return value; } });
  reject("manifest-config-size", { mutateManifest: (value) => { value.config.size += 1; return value; } });
  reject("manifest-extra", { mutateManifest: (value) => { value.extra = true; return value; } });
  reject("config-user", { mutateConfig: (value) => { value.config.User = "0:0"; return value; } });
  reject("config-architecture", { mutateConfig: (value) => { value.architecture = "arm64"; return value; } });
  reject("config-os", { mutateConfig: (value) => { value.os = "darwin"; return value; } });
  reject("config-entrypoint", { mutateConfig: (value) => { value.config.Entrypoint = ["/bin/sh"]; return value; } });
  reject("config-rootfs-type", { mutateConfig: (value) => { value.rootfs.type = "unknown"; return value; } });
  reject("config-diff-id", { mutateConfig: (value) => { value.rootfs.diff_ids = [`sha256:${"0".repeat(64)}`]; return value; } });
  reject("config-history", { mutateConfig: (value) => { value.history[0].created_by = "tampered"; return value; } });
  reject("config-history-count", { mutateConfig: (value) => { value.history.push({ created_by: "extra" }); return value; } });
  reject("config-extra", { mutateConfig: (value) => { value.extra = true; return value; } });
  reject("config-nested-key-order", { mutateConfig: (value) => { value.config = { Entrypoint: value.config.Entrypoint, User: value.config.User }; return value; } }, "OCI config is not canonical JSON");
  reject("layer-bytes", { layerBytes: Buffer.from("different layer") });
  reject("rootfs-mode", { mutateRootfs: (entries) => { entries.at(-1).mode = 0o755; return entries; } });
  reject("rootfs-owner", { mutateRootfs: (entries) => { entries.at(-1).uid = 1; return entries; } });
  reject("rootfs-group", { mutateRootfs: (entries) => { entries.at(-1).gid = 1; return entries; } });
  reject("rootfs-mtime", { mutateRootfs: (entries) => { entries.at(-1).mtime = 1; return entries; } });
  reject("rootfs-name-metadata", { mutateRootfs: (entries) => { entries.at(-1).uname = "root"; return entries; } });
  reject("rootfs-directory-type", { mutateRootfs: (entries) => { entries[1].type = "0"; return entries; } });
  reject("rootfs-file-type", { mutateRootfs: (entries) => { entries.at(-1).type = "5"; return entries; } });
  reject("rootfs-link", { mutateRootfs: (entries) => { entries.at(-1).type = "2"; entries.at(-1).linkname = "/escape"; return entries; } });
  reject("rootfs-pax", { mutateRootfs: (entries) => [{ name: "pax", type: "x", mode: 0o644, bytes: "path=escape\n" }, ...entries] });
  reject("rootfs-duplicate", { mutateRootfs: (entries) => [...entries, { ...entries.at(-1) }] });
  reject("rootfs-reordered-members", { mutateRootfs: (entries) => [entries[0], entries[5], ...entries.slice(1, 5), ...entries.slice(6)] }, "exact member sequence mismatch");
  reject("rootfs-traversal", { mutateRootfs: (entries) => { entries.at(-1).name = "../escape"; return entries; } }, "unsafe member name");
  reject("oci-entry-mode", { mutateOciEntries: (entries) => { entries.find((entry) => entry.name === "./index.json").mode = 0o644; return entries; } });
  reject("oci-entry-owner", { mutateOciEntries: (entries) => { entries.find((entry) => entry.name === "./index.json").uid = 1; return entries; } });
  reject("oci-extension", { mutateOciEntries: (entries) => [{ name: "pax", type: "x", mode: 0o644, bytes: "path=escape\n" }, ...entries] });
  reject("oci-reordered-members", { mutateOciEntries: (entries) => [entries[0], entries.at(-1), ...entries.slice(1, -1)] }, "exact member sequence mismatch");

  const replacedCandidate = join(root, "retained-directory-replacement-candidate"); buildCandidate(replacedCandidate);
  const replacedOutput = join(root, "retained-directory-replacement");
  const originalOutput = join(root, "retained-directory-original");
  const replacementMarker = Buffer.from("replacement must remain untouched\n");
  let replacementCapability;
  let replacementError;
  try {
    replacementCapability = admitOciOutput(replacedCandidate, replacedOutput, sourcePath, expectedSbomPath, "a".repeat(64), "2".repeat(64), trustDigest, `builder.invalid/image@sha256:${"c".repeat(64)}`, "c".repeat(64), {
      retainPublicationCapability: true,
      publicationParent: root,
      afterSourceFdRetained: () => {
        renameSync(replacedOutput, originalOutput);
        mkdirSync(replacedOutput); chmodSync(replacedOutput, 0o700);
        writeFileSync(join(replacedOutput, "replacement-marker"), replacementMarker);
      },
    });
  } catch (error) {
    replacementError = error;
  }
  if (process.platform === "linux") {
    if (!replacementCapability || replacementError) throw new Error(`retained-directory replacement admission failed: ${replacementError?.message ?? "missing capability"}`);
    const originalIdentity = (await import("node:fs")).statSync(originalOutput, { bigint: true });
    const descriptor = JSON.parse(readFileSync(replacementCapability.descriptorFd, "utf8"));
    if (descriptor.source_dev !== Number(originalIdentity.dev) || descriptor.source_ino !== Number(originalIdentity.ino)) throw new Error("retained-directory replacement descriptor claimed the wrong source identity");
    for (const member of ["gate-h2-broker", "gate-h2-stage.oci.tar", "provenance.json", "reproducibility.env", "rootfs.tar", "sbom.cdx.json"]) if (existsSync(join(replacedOutput, member))) throw new Error(`retained-directory replacement was touched: ${member}`);
    for (const fd of replacementCapability.memberFds) closeSync(fd);
    closeSync(replacementCapability.descriptorFd); closeSync(replacementCapability.parentFd);
  } else if (!replacementError?.message.includes("descriptor-relative admitted-directory operations are unavailable")) {
    throw new Error(`unsupported platform did not fail closed after retained-directory replacement: ${replacementError?.message ?? "admission succeeded"}`);
  }
  if (!readFileSync(join(replacedOutput, "replacement-marker")).equals(replacementMarker)) throw new Error("retained-directory replacement marker changed");

  const canonical = tarBytes(rootfsEntries(Buffer.from("stage binary fixture\n"), Buffer.from("trust roots fixture\n")));
  const checksum = (bytes) => { bytes.fill(0x20, 148, 156); let sum = 0; for (const byte of bytes.subarray(0, 512)) sum += byte; bytes.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "latin1"); return bytes; };
  const tarMutation = (name, mutate, reason) => { const bytes = Buffer.from(canonical); mutate(bytes); reject(`tar-${name}`, { rootfsBytes: bytes }, reason); };
  tarMutation("reserved", (bytes) => { bytes[500] = 1; checksum(bytes); }, "reserved header");
  tarMutation("mode-layout", (bytes) => { bytes[100] = 0x20; checksum(bytes); }, "noncanonical tar mode");
  tarMutation("uid-base256", (bytes) => { bytes[108] = 0x80; checksum(bytes); }, "base-256 tar uid");
  tarMutation("gid-layout", (bytes) => { bytes[116] = 0x20; checksum(bytes); }, "noncanonical tar gid");
  tarMutation("size-layout", (bytes) => { bytes[124] = 0x20; checksum(bytes); }, "noncanonical tar size");
  tarMutation("mtime-layout", (bytes) => { bytes[136] = 0x20; checksum(bytes); }, "noncanonical tar mtime");
  tarMutation("checksum-layout", (bytes) => { bytes.fill(0x20, 148, 156); let sum = 0; for (const byte of bytes.subarray(0, 512)) sum += byte; bytes.write(sum.toString(8).padStart(8, "0"), 148, 8, "ascii"); }, "checksum encoding");
  tarMutation("null-regular-type", (bytes) => { bytes[156] = 0; checksum(bytes); }, "noncanonical entry type");
  tarMutation("linkname", (bytes) => { bytes[157] = 0x61; checksum(bytes); }, "metadata mismatch");
  tarMutation("magic", (bytes) => { bytes[257] = 0x78; checksum(bytes); }, "POSIX ustar magic");
  tarMutation("version", (bytes) => { bytes[263] = 0x20; checksum(bytes); }, "POSIX ustar magic");
  tarMutation("uname", (bytes) => { bytes[265] = 0x72; checksum(bytes); }, "metadata mismatch");
  tarMutation("gname", (bytes) => { bytes[297] = 0x72; checksum(bytes); }, "metadata mismatch");
  tarMutation("devmajor", (bytes) => { bytes[335] = 0x31; checksum(bytes); }, "metadata mismatch");
  tarMutation("devminor", (bytes) => { bytes[343] = 0x31; checksum(bytes); }, "metadata mismatch");
  tarMutation("prefix", (bytes) => { bytes[345] = 0x78; checksum(bytes); }, "metadata mismatch");
  tarMutation("name-terminator", (bytes) => { bytes.fill(0x61, 0, 100); checksum(bytes); }, "noncanonical tar name");
  tarMutation("entry-padding", (bytes) => { const header = bytes.indexOf(Buffer.from("./etc/ssl/certs/ca-certificates.crt")); bytes[header + 512 + Buffer.byteLength("trust roots fixture\n")] = 1; }, "entry padding");
  tarMutation("terminator", (bytes) => { bytes[canonical.length - 1] = 1; }, "data after terminator");
  reject("tar-extra-zero-record", { rootfsBytes: Buffer.concat([canonical, Buffer.alloc(10240)]) }, "noncanonical trailing blocks");
  reject("sbom-missing", { sbom: { ...sbom, components: sbom.components.slice(0, 1) } }, "trusted host dependency derivation");
  reject("sbom-field", { sbom: { ...sbom, components: [{ ...sbom.components[0], extra: true }, sbom.components[1]] } });
  reject("sbom-license", { sbom: { ...sbom, components: [{ ...sbom.components[0], licenses: [{ expression: "Apache-2.0" }] }, sbom.components[1]] } }, "trusted host dependency derivation");
  reject("sbom-order", { sbom: { ...sbom, components: [...sbom.components].reverse() } });
  reject("sbom-duplicate", { sbom: { ...sbom, components: [sbom.components[0], sbom.components[0]] } });
  const fsyncFixture = join(root, "output-parent-fsync"); buildCandidate(fsyncFixture); const fsyncOutput = join(root, "out-output-parent-fsync");
  const fsyncResult = run(fsyncFixture, fsyncOutput, {}, { createDurableDirectory: (path, mode) => { createDurableDirectory(path, mode); throw new Error("injected admission output parent fsync failure"); } });
  if (fsyncResult.status === 0 || !fsyncResult.stderr.includes("injected") || !((await import("node:fs")).existsSync(fsyncOutput)) || (await import("node:fs")).existsSync(join(fsyncOutput, "provenance.json"))) throw new Error("admission output parent fsync failure was not fail-sticky before success artifacts");

  const symlink = join(root, "symlink"); cpSync(candidate, symlink, { recursive: true }); rmSync(join(symlink, "gate-h2-broker")); symlinkSync("/etc/passwd", join(symlink, "gate-h2-broker")); if (run(symlink, join(root, "out-symlink")).status === 0) throw new Error("candidate symlink escape accepted");
  const candidateDirectoryLink = join(root, "candidate-directory-link"); symlinkSync(candidate, candidateDirectoryLink); if (run(candidateDirectoryLink, join(root, "out-candidate-directory-link")).status === 0) throw new Error("candidate directory symlink accepted");
  const hardlink = join(root, "hardlink"); cpSync(candidate, hardlink, { recursive: true }); rmSync(join(hardlink, "gate-h2-broker")); linkSync(join(candidate, "gate-h2-broker"), join(hardlink, "gate-h2-broker")); if (run(hardlink, join(root, "out-hardlink")).status === 0) throw new Error("candidate hardlink accepted");
  const badMode = join(root, "bad-mode"); cpSync(candidate, badMode, { recursive: true }); chmodSync(join(badMode, "sbom.cdx.json"), 0o664); if (run(badMode, join(root, "out-bad-mode")).status === 0) throw new Error("candidate writable mode accepted");
  for (const [label, member, mode] of [["setuid-sbom-04444", "sbom.cdx.json", 0o4444], ["setgid-provenance-02444", "provenance.json", 0o2444], ["sticky-rootfs-01444", "rootfs.tar", 0o1444]]) {
    const fixture = join(root, label); cpSync(candidate, fixture, { recursive: true }); chmodSync(join(fixture, member), mode);
    if (run(fixture, join(root, `out-${label}`)).status === 0) throw new Error(`candidate special mode ${mode.toString(8)} accepted for ${member}`);
  }
  const duplicate = join(root, "duplicate"); cpSync(candidate, duplicate, { recursive: true }); chmodSync(join(duplicate, "provenance.json"), 0o644); writeFileSync(join(duplicate, "provenance.json"), `${JSON.stringify(clean).slice(0, -1)},"rootfs_sha256":"${clean.rootfs_sha256}"}\n`); chmodSync(join(duplicate, "provenance.json"), 0o444); if (run(duplicate, join(root, "out-duplicate")).status === 0) throw new Error("duplicate provenance field accepted");
  for (const point of ["directory-open", "enumerated", "before-open-gate-h2-broker", "after-open-gate-h2-broker", "all-open", "final-binding"]) {
    const fixture = join(root, `fault-${point}`); buildCandidate(fixture); if (runReader(fixture, { GATE_H2_TEST_SECURE_READ_FAULT: point }).status === 0) throw new Error(`secure namespace fault ${point} succeeded`);
  }
  for (const point of ["directory-after-open", "directory-after-enumerate"]) {
    const fixture = join(root, `attack-${point}`); buildCandidate(fixture); if (runReader(fixture, { GATE_H2_TEST_SECURE_READ_ATTACK: point }).status !== 0) throw new Error(`pinned directory descriptor did not survive ${point}`);
  }
  for (const point of ["member-before-open-gate-h2-broker", "member-after-open-gate-h2-broker"]) {
    const fixture = join(root, `attack-${point}`); buildCandidate(fixture); if (runReader(fixture, { GATE_H2_TEST_SECURE_READ_ATTACK: point }).status === 0) throw new Error(`member swap ${point} was accepted`);
  }
  for (const index of [0, 3, 8]) { const fixture = join(root, `readdir-${index}`); buildCandidate(fixture); if (runReader(fixture, { GATE_H2_TEST_READDIR_ERROR: String(index) }).status === 0) throw new Error(`candidate readdir error ${index} was treated as EOF`); }
  const bypass = spawnSync("bash", [inner, join(root, "direct-inner-output")], { env: { ...process.env, GATE_H2_IN_HERMETIC_BUILDER: "1" }, encoding: "utf8" }); if (bypass.status === 0) throw new Error("direct inner invocation produced a publishable bundle");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(helperTarget, { recursive: true, force: true });
  rmSync(helperDirectory, { recursive: true, force: true });
}
