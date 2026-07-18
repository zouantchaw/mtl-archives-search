import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exactFields, parseStrictJson } from "./strict-json.mjs";
import { createDurableDirectory as createDurableDirectoryDefault, syncDirectory as syncDirectoryDefault } from "./secure-files.mjs";
import { parseStrictTar, requireEntrySet } from "./strict-tar.mjs";
import { runVerifiedHelper } from "./run-verified-helper.mjs";

const provenanceFields = ["schema_version", "source_date_epoch", "source_commit", "source_tree", "source_allowlist_sha256", "source_archive_sha256", "source_manifest_sha256", "source_file_count", "source_byte_count", "target", "toolchain_lock_sha256", "builder_image", "builder_image_digest", "cargo_lock_sha256", "trust_roots_sha256", "broker_binary_sha256", "stage_binary_sha256", "rootfs_sha256", "oci_archive_sha256", "oci_image_id", "sbom_sha256", "network_policy", "reproducibility_status", "production_authority_activated"];
const orderedFields = (value, fields) => Object.fromEntries(fields.map((field) => [field, value[field]]));
const canonicalJsonBytes = (value, finalNewline) => Buffer.from(`${JSON.stringify(value)}${finalNewline ? "\n" : ""}`, "utf8");
const requireCanonicalJson = (actual, canonical, label, finalNewline) => {
  const expected = canonicalJsonBytes(canonical, finalNewline);
  if (!actual.equals(expected)) throw new Error(`${label} is not canonical JSON`);
};
const canonicalProvenance = (value) => orderedFields(value, provenanceFields);
const canonicalLayout = (value) => ({ imageLayoutVersion: value.imageLayoutVersion });
const canonicalIndex = (value) => ({
  schemaVersion: value.schemaVersion,
  mediaType: value.mediaType,
  manifests: value.manifests.map((descriptor) => ({
    mediaType: descriptor.mediaType,
    digest: descriptor.digest,
    size: descriptor.size,
    platform: { architecture: descriptor.platform.architecture, os: descriptor.platform.os },
  })),
});
const canonicalManifest = (value) => ({
  schemaVersion: value.schemaVersion,
  mediaType: value.mediaType,
  config: { mediaType: value.config.mediaType, digest: value.config.digest, size: value.config.size },
  layers: value.layers.map((descriptor) => ({ mediaType: descriptor.mediaType, digest: descriptor.digest, size: descriptor.size })),
});
const canonicalConfig = (value) => ({
  architecture: value.architecture,
  os: value.os,
  config: { User: value.config.User, Entrypoint: value.config.Entrypoint },
  rootfs: { type: value.rootfs.type, diff_ids: value.rootfs.diff_ids },
  history: value.history.map((entry) => ({ created_by: entry.created_by })),
});
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const writeAll = (fd, bytes, write) => {
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const progress = write(fd, bytes, offset, remaining, offset);
    if (!Number.isSafeInteger(progress) || progress <= 0 || progress > remaining) throw new Error(`admission descriptor write made invalid progress: ${String(progress)} for ${remaining} remaining bytes`);
    offset += progress;
  }
};

export function admitOciOutput(candidate, output, sourceDescriptorPath, expectedSbomPath, toolchainLockSha256, cargoLockSha256, trustRootsSha256, builderImage, builderImageDigest, operations = {}) {
  if (!candidate || !output || !sourceDescriptorPath || !expectedSbomPath) throw new Error("admission inputs are required");
const createDurableDirectory = operations.createDurableDirectory ?? createDurableDirectoryDefault;
const syncDirectory = operations.syncDirectory ?? syncDirectoryDefault;
const retainPublicationCapability = operations.retainPublicationCapability === true;
const publicationParent = operations.publicationParent ?? dirname(output);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const candidateModes = { "INNER-CANDIDATE": 0o444, "gate-h2-broker": 0o555, "gate-h2-stage.oci.tar": 0o444, "provenance.json": 0o444, "rootfs.tar": 0o444, "sbom.cdx.json": 0o444 };
const candidateMembers = Object.keys(candidateModes).sort();
const snapshot = runVerifiedHelper("gate-h2-secure-candidate-read", [candidate], { maxBuffer: 257 * 1024 * 1024 }).stdout;
let cursor = Buffer.byteLength("GATEH2SNAP1\n");
if (!snapshot.subarray(0, cursor).equals(Buffer.from("GATEH2SNAP1\n"))) throw new Error("invalid secure candidate snapshot protocol");
const artifacts = {};
while (cursor < snapshot.length) {
  if (cursor + 2 > snapshot.length) throw new Error("truncated secure candidate snapshot name");
  const nameLength = snapshot.readUInt16BE(cursor); cursor += 2;
  if (cursor + nameLength + 8 > snapshot.length) throw new Error("truncated secure candidate snapshot header");
  const name = snapshot.subarray(cursor, cursor + nameLength).toString("utf8"); cursor += nameLength;
  const size = Number(snapshot.readBigUInt64BE(cursor)); cursor += 8;
  if (!Number.isSafeInteger(size) || cursor + size > snapshot.length || Object.hasOwn(artifacts, name)) throw new Error("invalid secure candidate snapshot member");
  artifacts[name] = snapshot.subarray(cursor, cursor + size); cursor += size;
}
if (JSON.stringify(Object.keys(artifacts).sort()) !== JSON.stringify(candidateMembers)) throw new Error("secure candidate snapshot member set mismatch");
if (!artifacts["INNER-CANDIDATE"].equals(Buffer.from("candidate_only=true\n"))) throw new Error("candidate marker is invalid");
const digestFile = (name) => sha256(artifacts[name]);

const source = parseStrictJson(operations.sourceDescriptorBytes ?? readFileSync(sourceDescriptorPath));
exactFields(source, ["schema_version", "source_commit", "source_tree", "source_allowlist_sha256", "source_archive_sha256", "source_manifest_sha256", "source_file_count", "source_byte_count"], "source descriptor");
if (source.schema_version !== "gate_h2_sanitized_source_export_v1.0.0") throw new Error("source descriptor schema mismatch");
const provenance = parseStrictJson(artifacts["provenance.json"]);
exactFields(provenance, provenanceFields, "candidate provenance");
const expected = {
  source_commit: source.source_commit, source_tree: source.source_tree, source_allowlist_sha256: source.source_allowlist_sha256,
  source_archive_sha256: source.source_archive_sha256, source_manifest_sha256: source.source_manifest_sha256,
  source_file_count: source.source_file_count, source_byte_count: source.source_byte_count,
  toolchain_lock_sha256: toolchainLockSha256, cargo_lock_sha256: cargoLockSha256, trust_roots_sha256: trustRootsSha256, builder_image: builderImage, builder_image_digest: builderImageDigest,
};
for (const [field, value] of Object.entries(expected)) if (provenance[field] !== value) throw new Error(`${field} does not match trusted host input`);
if (provenance.schema_version !== "gate_h2_stage_build_provenance_v1.0.0" || provenance.source_date_epoch !== 0 || provenance.target !== "x86_64-unknown-linux-musl" || provenance.production_authority_activated !== false || provenance.network_policy !== "inner_candidate_requires_trusted_host_admission" || provenance.reproducibility_status !== "unadmitted_two_build_candidate") throw new Error("candidate provenance constants are invalid");
for (const field of provenanceFields.filter((field) => field.endsWith("sha256") || field.endsWith("digest"))) if (!/^[a-f0-9]{64}$/.test(String(provenance[field]))) throw new Error(`invalid digest field: ${field}`);
if (!/^sha256:[a-f0-9]{64}$/.test(provenance.oci_image_id)) throw new Error("invalid OCI image ID");
if (provenance.broker_binary_sha256 !== digestFile("gate-h2-broker") || provenance.rootfs_sha256 !== digestFile("rootfs.tar") || provenance.oci_archive_sha256 !== digestFile("gate-h2-stage.oci.tar") || provenance.sbom_sha256 !== digestFile("sbom.cdx.json")) throw new Error("candidate artifact digest mismatch");
requireCanonicalJson(artifacts["provenance.json"], canonicalProvenance(provenance), "candidate provenance", true);

const sbom = parseStrictJson(artifacts["sbom.cdx.json"]); validateSbom(sbom, "candidate SBOM");
const expectedSbomBytes = operations.expectedSbomBytes ?? readFileSync(expectedSbomPath); const expectedSbom = parseStrictJson(expectedSbomBytes); validateSbom(expectedSbom, "trusted expected SBOM");
if (!artifacts["sbom.cdx.json"].equals(expectedSbomBytes)) throw new Error("candidate SBOM does not exactly match trusted host dependency derivation");

const rootfsEntries = parseStrictTar(artifacts["rootfs.tar"], "rootfs", 80 * 1024 * 1024);
const expectedRootfs = ["./", "./etc/", "./etc/ssl/", "./etc/ssl/certs/", "./etc/ssl/certs/ca-certificates.crt", "./usr/", "./usr/local/", "./usr/local/bin/", "./usr/local/bin/gate-h2-stage-runtime"];
requireEntrySet(rootfsEntries, expectedRootfs, "rootfs");
const rootfsByName = new Map(rootfsEntries.map((entry) => [entry.name, entry]));
for (const name of expectedRootfs) {
  const entry = rootfsByName.get(name);
  const isFile = name.endsWith("ca-certificates.crt") || name.endsWith("gate-h2-stage-runtime");
  const mode = name.endsWith("gate-h2-stage-runtime") ? 0o555 : isFile ? 0o444 : 0o755;
  if (entry.type !== (isFile ? "file" : "directory") || entry.mode !== mode || entry.uname !== "" || entry.gname !== "") throw new Error(`rootfs structure mismatch: ${name}`);
}
const stageBytes = rootfsByName.get("./usr/local/bin/gate-h2-stage-runtime").bytes;
const trustBytes = rootfsByName.get("./etc/ssl/certs/ca-certificates.crt").bytes;
if (sha256(stageBytes) !== provenance.stage_binary_sha256 || sha256(trustBytes) !== trustRootsSha256) throw new Error("rootfs binary/trust-root join mismatch");

const ociEntries = parseStrictTar(artifacts["gate-h2-stage.oci.tar"], "OCI archive", 160 * 1024 * 1024);
const ociByName = new Map(ociEntries.map((entry) => [entry.name, entry]));
for (const entry of ociEntries) {
  if (entry.name.startsWith("/") || entry.name.includes("..") || !/^\.\/(?:|blobs\/|blobs\/sha256\/|blobs\/sha256\/[a-f0-9]{64}|index\.json|oci-layout)$/.test(entry.name)) throw new Error(`unsafe OCI member: ${entry.name}`);
  const expectedType = entry.name.endsWith("/") ? "directory" : "file";
  const expectedMode = expectedType === "directory" ? 0o755 : 0o444;
  if (entry.type !== expectedType || entry.mode !== expectedMode || entry.uname !== "" || entry.gname !== "") throw new Error(`OCI member structure mismatch: ${entry.name}`);
}
const jsonEntry = (name) => { const entry = ociByName.get(name); if (!entry) throw new Error(`missing OCI member: ${name}`); return parseStrictJson(entry.bytes); };
const layout = jsonEntry("./oci-layout");
exactFields(layout, ["imageLayoutVersion"], "OCI layout");
if (layout.imageLayoutVersion !== "1.0.0") throw new Error("OCI layout version mismatch");
requireCanonicalJson(ociByName.get("./oci-layout").bytes, canonicalLayout(layout), "OCI layout", true);
const index = jsonEntry("./index.json");
exactFields(index, ["schemaVersion", "mediaType", "manifests"], "OCI index");
if (index.schemaVersion !== 2 || index.mediaType !== "application/vnd.oci.image.index.v1+json" || !Array.isArray(index.manifests) || index.manifests.length !== 1) throw new Error("OCI index constants mismatch");
const indexDescriptor = index.manifests[0];
exactFields(indexDescriptor, ["mediaType", "digest", "size", "platform"], "OCI index manifest descriptor");
exactFields(indexDescriptor.platform, ["architecture", "os"], "OCI index platform");
if (indexDescriptor.mediaType !== "application/vnd.oci.image.manifest.v1+json" || indexDescriptor.digest !== provenance.oci_image_id || !Number.isSafeInteger(indexDescriptor.size) || indexDescriptor.size < 1 || indexDescriptor.platform.architecture !== "amd64" || indexDescriptor.platform.os !== "linux") throw new Error("OCI index descriptor mismatch");
requireCanonicalJson(ociByName.get("./index.json").bytes, canonicalIndex(index), "OCI index", true);
const manifestDigest = indexDescriptor.digest.slice(7);
const manifestEntry = ociByName.get(`./blobs/sha256/${manifestDigest}`);
if (!manifestEntry || sha256(manifestEntry.bytes) !== manifestDigest || manifestEntry.size !== indexDescriptor.size) throw new Error("OCI manifest descriptor/blob mismatch");
const manifest = parseStrictJson(manifestEntry.bytes);
exactFields(manifest, ["schemaVersion", "mediaType", "config", "layers"], "OCI manifest");
if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || !Array.isArray(manifest.layers) || manifest.layers.length !== 1) throw new Error("OCI manifest constants mismatch");
exactFields(manifest.config, ["mediaType", "digest", "size"], "OCI config descriptor");
exactFields(manifest.layers[0], ["mediaType", "digest", "size"], "OCI layer descriptor");
const configDescriptor = manifest.config; const layerDescriptor = manifest.layers[0];
if (configDescriptor.mediaType !== "application/vnd.oci.image.config.v1+json" || !/^sha256:[a-f0-9]{64}$/.test(configDescriptor.digest) || !Number.isSafeInteger(configDescriptor.size) || configDescriptor.size < 1) throw new Error("OCI config descriptor mismatch");
if (layerDescriptor.mediaType !== "application/vnd.oci.image.layer.v1.tar" || layerDescriptor.digest !== `sha256:${provenance.rootfs_sha256}` || layerDescriptor.size !== artifacts["rootfs.tar"].length) throw new Error("OCI layer descriptor mismatch");
requireCanonicalJson(manifestEntry.bytes, canonicalManifest(manifest), "OCI manifest", false);
const layerEntry = ociByName.get(`./blobs/sha256/${layerDescriptor.digest.slice(7)}`);
if (!layerEntry || layerEntry.size !== layerDescriptor.size || sha256(layerEntry.bytes) !== layerDescriptor.digest.slice(7) || !layerEntry.bytes.equals(artifacts["rootfs.tar"])) throw new Error("OCI layer bytes do not exactly join rootfs.tar");
const configEntry = ociByName.get(`./blobs/sha256/${configDescriptor.digest.slice(7)}`);
if (!configEntry || configEntry.size !== configDescriptor.size || sha256(configEntry.bytes) !== configDescriptor.digest.slice(7)) throw new Error("OCI config descriptor/blob mismatch");
const config = parseStrictJson(configEntry.bytes);
exactFields(config, ["architecture", "os", "config", "rootfs", "history"], "OCI config");
exactFields(config.config, ["User", "Entrypoint"], "OCI runtime config");
exactFields(config.rootfs, ["type", "diff_ids"], "OCI rootfs config");
if (!Array.isArray(config.history) || config.history.length !== 1) throw new Error("OCI history mismatch");
exactFields(config.history[0], ["created_by"], "OCI history entry");
if (config.architecture !== "amd64" || config.os !== "linux" || config.config.User !== "65532:65532" || JSON.stringify(config.config.Entrypoint) !== JSON.stringify(["/usr/local/bin/gate-h2-stage-runtime"]) || config.rootfs.type !== "layers" || JSON.stringify(config.rootfs.diff_ids) !== JSON.stringify([layerDescriptor.digest]) || config.history[0].created_by !== "gate-h2-hermetic-builder-v2") throw new Error("OCI config values mismatch");
requireCanonicalJson(configEntry.bytes, canonicalConfig(config), "OCI config", false);
const blobDigests = [manifestDigest, configDescriptor.digest.slice(7), layerDescriptor.digest.slice(7)].sort();
requireEntrySet(ociEntries, ["./", "./blobs/", "./blobs/sha256/", ...blobDigests.map((digest) => `./blobs/sha256/${digest}`), "./index.json", "./oci-layout"], "OCI archive");

function validateSbom(sbom, label) {
  exactFields(sbom, ["bomFormat", "specVersion", "version", "metadata", "components"], label);
  exactFields(sbom.metadata, ["component"], `${label} metadata`);
  exactFields(sbom.metadata.component, ["type", "name", "version"], `${label} identity`);
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.5" || sbom.version !== 1 || JSON.stringify(sbom.metadata.component) !== JSON.stringify({ type: "application", name: "gate-h2-stage-runtime", version: "0.1.0" }) || !Array.isArray(sbom.components) || sbom.components.length < 1) throw new Error(`${label} constants mismatch`);
  let previous = "";
  for (const [index, component] of sbom.components.entries()) {
    exactFields(component, ["type", "name", "version", "licenses", "purl"], `${label} component ${index}`);
    if (!/^(application|library)$/.test(component.type) || !/^[A-Za-z0-9_.+-]+$/.test(component.name) || typeof component.version !== "string" || !component.version || component.purl !== `pkg:cargo/${component.name}@${component.version}` || !Array.isArray(component.licenses)) throw new Error(`${label} component ${index} values mismatch`);
    for (const [licenseIndex, license] of component.licenses.entries()) { exactFields(license, ["expression"], `${label} component ${index} license ${licenseIndex}`); if (typeof license.expression !== "string" || !license.expression) throw new Error(`${label} empty license expression`); }
    if (component.purl <= previous) throw new Error(`${label} components duplicate or unsorted`);
    previous = component.purl;
  }
}
createDurableDirectory(output, 0o700);
const sourceFd = openSync(output, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
let parentFd = openSync(publicationParent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
const sourceIdentity = fstatSync(sourceFd, { bigint: true });
const parentIdentity = fstatSync(parentFd, { bigint: true });
for (const value of [sourceIdentity.dev, sourceIdentity.ino, parentIdentity.dev, parentIdentity.ino]) if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("publication identity exceeds exact JSON integer range");
operations.afterSourceFdRetained?.();
const retainedDirectory = operations.testOnlyRetainedDirectory ?? (process.platform === "linux" ? `/proc/self/fd/${sourceFd}` : undefined);
if (!retainedDirectory) {
  closeSync(parentFd); closeSync(sourceFd);
  throw new Error("descriptor-relative admitted-directory operations are unavailable on this platform");
}
const memberPath = (member) => join(retainedDirectory, member);
const writeMember = (member, bytes, mode) => {
  const fd = openSync(memberPath(member), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_CLOEXEC, mode);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error(`admitted member short write: ${member}`);
      offset += count;
    }
    fchmodSync(fd, mode);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
const publishModes = { "gate-h2-broker": 0o555, "gate-h2-stage.oci.tar": 0o444, "rootfs.tar": 0o444, "sbom.cdx.json": 0o444 };
for (const [member, mode] of Object.entries(publishModes)) {
  writeMember(member, artifacts[member], mode);
}
const admittedProvenance = canonicalProvenance({
  ...provenance,
  network_policy: "digest_pinned_builder_with_network_none_and_offline_cargo",
  reproducibility_status: "trusted_host_admitted_two_independent_clean_source_builds",
});
const admittedFiles = {
  "provenance.json": canonicalJsonBytes(admittedProvenance, true),
  "reproducibility.env": Buffer.from(`${["source_commit", "source_tree", "source_allowlist_sha256", "source_archive_sha256", "source_manifest_sha256", "source_file_count", "source_byte_count", "builder_image", "builder_image_digest", "toolchain_lock_sha256", "cargo_lock_sha256", "trust_roots_sha256", "broker_binary_sha256", "stage_binary_sha256", "rootfs_sha256", "oci_archive_sha256", "oci_image_id", "sbom_sha256"].map((field) => `${field}=${admittedProvenance[field]}`).join("\n")}\n`),
};
for (const [member, bytes] of Object.entries(admittedFiles)) writeMember(member, bytes, 0o444);
fsyncSync(sourceFd);
const retainedOrder = Object.entries({ "gate-h2-broker": 0o555, "gate-h2-stage.oci.tar": 0o444, "provenance.json": 0o444, "reproducibility.env": 0o444, "rootfs.tar": 0o444, "sbom.cdx.json": 0o444 });
const descriptorMembers = retainedOrder.map(([name, mode]) => {
  const bytes = name === "provenance.json" || name === "reproducibility.env" ? admittedFiles[name] : artifacts[name];
  return { name, mode, bytes: bytes.length, sha256: sha256(bytes) };
});
const admissionDescriptor = `${output}.admission.json`;
const descriptorBytes = Buffer.from(`${JSON.stringify({ schema: "gate_h2_oci_admission_descriptor_v1", source_dev: Number(sourceIdentity.dev), source_ino: Number(sourceIdentity.ino), parent_dev: Number(parentIdentity.dev), parent_ino: Number(parentIdentity.ino), members: descriptorMembers })}\n`);
let descriptorWriteFd;
let descriptorFd;
let descriptorIdentity;
let descriptorSha256;
let memberFds = [];
try {
  descriptorWriteFd = openSync(admissionDescriptor, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_CLOEXEC, 0o400);
  descriptorIdentity = fstatSync(descriptorWriteFd, { bigint: true });
  try {
    writeAll(descriptorWriteFd, descriptorBytes, operations.descriptorWrite ?? writeSync);
    const writtenIdentity = fstatSync(descriptorWriteFd, { bigint: true });
    if (!sameIdentity(descriptorIdentity, writtenIdentity) || !writtenIdentity.isFile() || writtenIdentity.nlink !== 1n || writtenIdentity.size !== BigInt(descriptorBytes.length)) throw new Error("admission descriptor final length mismatch");
    const verifiedBytes = Buffer.alloc(descriptorBytes.length); let offset = 0;
    while (offset < verifiedBytes.length) { const count = readSync(descriptorWriteFd, verifiedBytes, offset, verifiedBytes.length - offset, offset); if (count === 0) throw new Error("admission descriptor verification short read"); offset += count; }
    const verifiedIdentity = fstatSync(descriptorWriteFd, { bigint: true });
    if (!sameIdentity(writtenIdentity, verifiedIdentity) || verifiedIdentity.size !== BigInt(descriptorBytes.length)) throw new Error("admission descriptor changed during verification");
    descriptorSha256 = sha256(verifiedBytes);
    if (descriptorSha256 !== sha256(descriptorBytes)) throw new Error("admission descriptor final SHA-256 mismatch");
    fchmodSync(descriptorWriteFd, 0o444); fsyncSync(descriptorWriteFd);
    descriptorIdentity = fstatSync(descriptorWriteFd, { bigint: true });
    descriptorFd = openSync(`${process.platform === "linux" ? "/proc/self/fd" : "/dev/fd"}/${descriptorWriteFd}`, constants.O_RDONLY | constants.O_CLOEXEC);
    const retainedDescriptorIdentity = fstatSync(descriptorFd, { bigint: true });
    if (!sameIdentity(descriptorIdentity, retainedDescriptorIdentity) || descriptorIdentity.size !== retainedDescriptorIdentity.size) throw new Error("retained descriptor identity mismatch");
  } finally {
    closeSync(descriptorWriteFd); descriptorWriteFd = undefined;
  }
  syncDirectory(dirname(admissionDescriptor));
  if (retainPublicationCapability) {
    for (const member of descriptorMembers) {
      const path = memberPath(member.name);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
      memberFds.push(fd);
      const before = fstatSync(fd, { bigint: true });
      const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
      while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) throw new Error("retained member short read"); offset += count; }
      if (!before.isFile() || before.uid !== BigInt(process.geteuid()) || before.nlink !== 1n || (before.mode & 0o7777n) !== BigInt(member.mode) || before.size !== BigInt(member.bytes) || sha256(bytes) !== member.sha256) throw new Error(`retained member verification failed: ${member.name}`);
      unlinkSync(path);
      const retained = fstatSync(fd, { bigint: true });
      if (retained.dev !== before.dev || retained.ino !== before.ino || retained.uid !== before.uid || retained.gid !== before.gid || retained.mode !== before.mode || retained.size !== before.size || retained.nlink !== 0n) throw new Error(`retained member unlink transition failed: ${member.name}`);
    }
    fsyncSync(sourceFd);
    unlinkSync(admissionDescriptor);
    syncDirectory(dirname(admissionDescriptor));
    const retainedDescriptor = fstatSync(descriptorFd, { bigint: true });
    if (retainedDescriptor.dev !== descriptorIdentity.dev || retainedDescriptor.ino !== descriptorIdentity.ino || retainedDescriptor.mode !== descriptorIdentity.mode || retainedDescriptor.size !== descriptorIdentity.size || retainedDescriptor.nlink !== 0n) throw new Error("retained descriptor unlink transition failed");
    closeSync(sourceFd);
    const capability = { descriptorFd, parentFd, memberFds, descriptorSha256, descriptorPath: admissionDescriptor, sourcePath: output };
    descriptorFd = undefined; parentFd = undefined; memberFds = [];
    return capability;
  }
  closeSync(descriptorFd); descriptorFd = undefined;
  closeSync(parentFd); parentFd = undefined;
  closeSync(sourceFd);
} catch (error) {
  const cleanupErrors = [];
  if (descriptorWriteFd !== undefined) { try { closeSync(descriptorWriteFd); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
  for (const fd of memberFds) { try { closeSync(fd); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
  if (descriptorFd !== undefined) { try { closeSync(descriptorFd); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
  if (descriptorIdentity) {
    try { const linked = lstatSync(admissionDescriptor, { bigint: true }); if (sameIdentity(linked, descriptorIdentity)) unlinkSync(admissionDescriptor); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") cleanupErrors.push(cleanupError); }
  }
  for (const { name } of descriptorMembers) { try { unlinkSync(memberPath(name)); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") cleanupErrors.push(cleanupError); } }
  try { fsyncSync(sourceFd); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
  try { const linked = lstatSync(output, { bigint: true }); if (sameIdentity(linked, sourceIdentity)) rmdirSync(output); } catch (cleanupError) { if (cleanupError.code !== "ENOENT" && cleanupError.code !== "ENOTEMPTY") cleanupErrors.push(cleanupError); }
  if (parentFd !== undefined) { try { closeSync(parentFd); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
  try { closeSync(sourceFd); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
  if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "admission failure and cleanup failed");
  throw error;
}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  admitOciOutput(...process.argv.slice(2));
}
