import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { parseInputTar } from "./input-tar.mjs";
import { exactFields, parseStrictJson } from "./strict-json.mjs";
import { readContainedRegular, visitSecureTree } from "./secure-files.mjs";

const REQUIRED_CATEGORIES = new Set(["oci_manifest", "oci_config", "oci_layer", "rust_distribution", "rust_musl_target", "node_distribution", "native_package", "cargo_vendor", "cargo_config", "ca_pem"]);
const ARTIFACT_CATEGORIES = REQUIRED_CATEGORIES;
const ARCHIVE_SOURCES = new Set(["oci_layer", "rust_distribution", "rust_musl_target", "node_distribution", "native_package", "cargo_vendor"]);
const BLOB_SOURCES = new Set(["cargo_config", "ca_pem"]);
const MATERIALIZABLE_SOURCES = new Set([...ARCHIVE_SOURCES, ...BLOB_SOURCES]);
const OCI_LAYER_MEDIA_TYPES = new Set(["application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip"]);
const OCI_CONFIG_FIELDS = new Set(["architecture", "os", "rootfs", "created", "author", "config", "history", "variant", "os.version", "os.features"]);
const ARCHIVE_FORMATS = new Set(["tar", "tar_gzip"]);
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_ACQUIRED_BYTES = 1536 * 1024 * 1024;
const MAX_RUNTIME_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = MAX_ARTIFACT_BYTES;
const MAX_OCI_METADATA_BYTES = 1024 * 1024;
export const MAX_ACQUIRED_WORKING_BUFFER_BYTES = MAX_ARTIFACT_BYTES;
export const MAX_ARTIFACT_COUNT = 64;
export const MAX_OCI_IMAGE_COUNT = 4;
export const MAX_RUNTIME_MAPPING_COUNT = 32_768;
export const MAX_RUNTIME_DESTINATION_DEPTH = 12;
export const MAX_RUNTIME_DIRECTORY_COUNT = 32_768;
export const MAX_INPUT_LOCK_BYTES = 32 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
// Keep the local output namespace separate from any upstream/source image.
// A real repository is a later, independently reviewed packet input.
export const REVIEWED_BUILDER_IMAGE_REPOSITORY = "localhost/gate-h2-builder";
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isCommit = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

export function safeMemberPath(path) { return typeof path === "string" && path.length > 0 && path.length <= 240 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "." && part !== ".."); }
function exact(value, fields, label, code) { try { exactFields(value, fields, label); } catch (error) { fail(code, error.message); } }
function validateIdentity(value, code) { exact(value, ["sha256", "bytes", "file_type", "mode"], "runtime output identity", code); if (!isDigest(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_RUNTIME_BYTES || value.file_type !== "regular" || ![0o444, 0o555].includes(value.mode)) fail(code, "runtime output identity is invalid"); }
function validateTrustedContext(lock, trusted) {
  if (!trusted || !isCommit(trusted.source_commit) || !isDigest(trusted.source_tree_sha256)) fail("E_LOCK_TRUST_CONTEXT", "acquired verification requires exact trusted materializer commit and tree");
  if (lock.materializer.source_commit !== trusted.source_commit || lock.materializer.source_tree_sha256 !== trusted.source_tree_sha256) fail("E_LOCK_TRUST_JOIN", "lock materializer does not join the trusted source proof");
}
function validateSource(source, artifact) {
  exact(source, ["authority", "kind", "locator"], "artifact source", "E_LOCK_SOURCE_FIELDS");
  if (typeof source.authority !== "string" || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(source.authority) || !["https", "oci"].includes(source.kind) || typeof source.locator !== "string" || source.locator.length > 2048 || /(?:^|[/@._-])(?:latest|stable)(?:$|[/@._-])/i.test(source.locator)) fail("E_LOCK_SOURCE_MUTABLE", "source is mutable or unapproved");
  if (source.kind === "https") {
    let url; try { url = new URL(source.locator); } catch { fail("E_LOCK_SOURCE_URL", "HTTPS source URL is invalid"); }
    const version = /(?:^|[/_.-])v?[0-9]+\.[0-9]+\.[0-9]+(?:$|[/_.-])/.test(url.pathname), date = /(?:^|\/)20[0-9]{2}-[01][0-9]-[0-3][0-9](?:\/|$)/.test(url.pathname), digest = /(?:sha256[-_/=]|[a-f0-9]{64})/i.test(url.pathname);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.hostname !== source.authority || url.port || !url.pathname.startsWith("/") || !(version || date || digest)) fail("E_LOCK_SOURCE_URL", "HTTPS locator lacks bound immutable version, date, or digest evidence");
    if (["rust_distribution", "rust_musl_target"].includes(artifact.category) && !(date && /(?:^|[-_/])1\.85\.0(?:[-_/]|$)/.test(url.pathname))) fail("E_LOCK_SOURCE_URL", "Rust distribution locator requires explicit dated 1.85.0 evidence");
  } else {
    const match = /^oci:\/\/([^/@\s]+)(?:\/[^@\s]+)*@sha256:([a-f0-9]{64})$/.exec(source.locator);
    if (!match || match[1] !== source.authority || match[2] !== artifact.sha256) fail("E_LOCK_SOURCE_OCI", "OCI authority or digest does not bind the exact artifact");
  }
}
function artifactByPath(lock) { return new Map(lock.artifacts.map((artifact) => [artifact.member_path, artifact])); }
export function validateLockCardinality(lock) {
  if (!Array.isArray(lock.artifacts) || lock.artifacts.length > MAX_ARTIFACT_COUNT || !Array.isArray(lock.oci_images) || lock.oci_images.length > MAX_OCI_IMAGE_COUNT || !Array.isArray(lock.runtime_mapping) || lock.runtime_mapping.length > MAX_RUNTIME_MAPPING_COUNT) fail("E_LOCK_CARDINALITY", "lock collection exceeds the bounded Packet 3B closure");
}
function runtimeDestination(value) {
  if (typeof value !== "string" || value.length > 98 || !value.startsWith("/opt/gate-h2/") || value.includes("\\") || value.includes("\0") || value.includes("//")) return false;
  const parts = value.slice("/opt/gate-h2/".length).split("/");
  return parts.length > 0 && parts.length <= MAX_RUNTIME_DESTINATION_DEPTH && parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) && value === `/opt/gate-h2/${parts.join("/")}`;
}

function registerRuntimeDirectories(destination, directories) {
  const parts = destination.slice(1).split("/");
  parts.pop();
  let current = "./";
  for (const part of parts) {
    current += `${part}/`;
    directories.add(current);
    if (directories.size > MAX_RUNTIME_DIRECTORY_COUNT) fail("E_LOCK_GRAPH", `runtime graph exceeds ${MAX_RUNTIME_DIRECTORY_COUNT} unique directories`);
  }
}

export function validateExternalInputLock(lock) {
  exact(lock, ["schema_version", "platform", "runtime_contract", "materializer", "artifacts", "oci_images", "runtime_mapping"], "external input lock", "E_LOCK_FIELDS");
  validateLockCardinality(lock);
  if (lock.schema_version !== "gate_h2_builder_external_input_lock_v1.0.0") fail("E_LOCK_VERSION", "unsupported input lock schema");
  exact(lock.platform, ["os", "architecture"], "lock platform", "E_LOCK_PLATFORM"); if (lock.platform.os !== "linux" || lock.platform.architecture !== "amd64") fail("E_LOCK_PLATFORM", "only linux/amd64 is approved");
  exact(lock.runtime_contract, ["runtime_root", "rust", "cargo", "node", "target", "output_image_repository"], "runtime contract", "E_LOCK_RUNTIME"); if (lock.runtime_contract.runtime_root !== "/opt/gate-h2" || lock.runtime_contract.rust !== "1.85.0" || lock.runtime_contract.cargo !== "1.85.0" || lock.runtime_contract.node !== "22.22.0" || lock.runtime_contract.target !== "x86_64-unknown-linux-musl" || lock.runtime_contract.output_image_repository !== REVIEWED_BUILDER_IMAGE_REPOSITORY) fail("E_LOCK_RUNTIME", "runtime contract differs from Packet 3A or reviewed local builder namespace");
  exact(lock.materializer, ["id", "source_commit", "source_tree_sha256", "entrypoint"], "materializer", "E_LOCK_MATERIALIZER"); if (typeof lock.materializer.id !== "string" || lock.materializer.id.length === 0 || !isCommit(lock.materializer.source_commit) || !isDigest(lock.materializer.source_tree_sha256) || lock.materializer.entrypoint !== "crates/gate-h2-broker/scripts/materialize-builder-offline.mjs") fail("E_LOCK_MATERIALIZER", "materializer identity is invalid");
  if (!Array.isArray(lock.artifacts) || lock.artifacts.length === 0) fail("E_LOCK_ARTIFACTS", "artifact list is empty");
  const paths = new Set(), digests = new Set(), categories = new Set(); let acquiredBytes = 0;
  for (const artifact of lock.artifacts) { exact(artifact, ["member_path", "sha256", "bytes", "file_type", "mode", "category", "architecture", "media_type", "archive_format", "source"], "external artifact", "E_LOCK_ARTIFACT_FIELDS"); if (!safeMemberPath(artifact.member_path)) fail("E_LOCK_MEMBER_PATH", "artifact member path is unsafe"); if (paths.has(artifact.member_path) || digests.has(artifact.sha256)) fail("E_LOCK_DUPLICATE", "duplicate artifact path or identity"); if (!isDigest(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > MAX_ARTIFACT_BYTES || (["oci_manifest", "oci_config"].includes(artifact.category) && artifact.bytes > MAX_OCI_METADATA_BYTES) || artifact.file_type !== "regular" || artifact.mode !== 0o444 || !ARTIFACT_CATEGORIES.has(artifact.category) || artifact.architecture !== "amd64" || typeof artifact.media_type !== "string" || artifact.media_type.length === 0) fail("E_LOCK_ARTIFACT", "artifact metadata is invalid"); const archiveCategory = ARCHIVE_SOURCES.has(artifact.category); if ((archiveCategory && !ARCHIVE_FORMATS.has(artifact.archive_format)) || (!archiveCategory && artifact.archive_format !== null)) fail("E_LOCK_ARCHIVE_FORMAT", "archive format is not closed for this artifact category"); if ((artifact.category === "oci_layer" && ((artifact.media_type.endsWith("+gzip") && artifact.archive_format !== "tar_gzip") || (!artifact.media_type.endsWith("+gzip") && artifact.archive_format !== "tar")))) fail("E_LOCK_ARCHIVE_FORMAT", "OCI layer media type and archive format differ"); acquiredBytes += artifact.bytes; if (!Number.isSafeInteger(acquiredBytes) || acquiredBytes > MAX_ACQUIRED_BYTES) fail("E_LOCK_ARTIFACT", "acquired artifact aggregate exceeds the cap"); if ((artifact.category === "oci_manifest" && artifact.media_type !== "application/vnd.oci.image.manifest.v1+json") || (artifact.category === "oci_config" && artifact.media_type !== "application/vnd.oci.image.config.v1+json") || (artifact.category === "oci_layer" && !OCI_LAYER_MEDIA_TYPES.has(artifact.media_type))) fail("E_LOCK_ARTIFACT", "OCI artifact media type is invalid"); validateSource(artifact.source, artifact); paths.add(artifact.member_path); digests.add(artifact.sha256); categories.add(artifact.category); }
  for (const category of REQUIRED_CATEGORIES) if (!categories.has(category)) fail("E_LOCK_REQUIRED_CATEGORY", `missing required category: ${category}`);
  if (!Array.isArray(lock.oci_images) || lock.oci_images.length === 0) fail("E_LOCK_OCI", "OCI image list is empty");
  const byPath = artifactByPath(lock), imageReferences = new Set(), ociPaths = new Set();
  for (const image of lock.oci_images) { exact(image, ["reference", "manifest_member_path", "config_member_path", "layer_member_paths"], "OCI image", "E_LOCK_OCI_FIELDS"); const reference = /^([^/@\s]+)(?:\/[^@\s]+)*@sha256:([a-f0-9]{64})$/.exec(image.reference); if (!reference || imageReferences.has(image.reference) || !safeMemberPath(image.manifest_member_path) || !safeMemberPath(image.config_member_path) || !Array.isArray(image.layer_member_paths) || image.layer_member_paths.length === 0) fail("E_LOCK_OCI", "OCI image identity or layer cardinality is invalid"); const manifest = byPath.get(image.manifest_member_path), config = byPath.get(image.config_member_path); if (!manifest || !config || manifest.category !== "oci_manifest" || config.category !== "oci_config" || manifest.source.kind !== "oci" || config.source.kind !== "oci" || manifest.source.authority !== reference[1] || config.source.authority !== reference[1] || reference[2] !== manifest.sha256) fail("E_LOCK_OCI", "OCI manifest/config binding is invalid"); const layerPaths = new Set(image.layer_member_paths); if (layerPaths.size !== image.layer_member_paths.length || layerPaths.has(image.manifest_member_path) || layerPaths.has(image.config_member_path)) fail("E_LOCK_LAYER_ORDER", "OCI layers are duplicate or collide with metadata"); for (const layerPath of image.layer_member_paths) { const layer = byPath.get(layerPath); if (!safeMemberPath(layerPath) || !layer || layer.category !== "oci_layer" || layer.source.kind !== "oci" || layer.source.authority !== reference[1] || ociPaths.has(layerPath)) fail("E_LOCK_LAYER_ORDER", "OCI layer sequence is invalid"); ociPaths.add(layerPath); } if (ociPaths.has(image.manifest_member_path) || ociPaths.has(image.config_member_path)) fail("E_LOCK_OCI", "OCI metadata path is duplicated"); ociPaths.add(image.manifest_member_path); ociPaths.add(image.config_member_path); imageReferences.add(image.reference); }
  for (const artifact of lock.artifacts) if (["oci_manifest", "oci_config", "oci_layer"].includes(artifact.category) && !ociPaths.has(artifact.member_path)) fail(artifact.category === "oci_layer" ? "E_LOCK_LAYER_ORDER" : "E_LOCK_OCI", "OCI artifact is not bound into one ordered image");
  if (!Array.isArray(lock.runtime_mapping) || lock.runtime_mapping.length === 0) fail("E_LOCK_MAPPING", "runtime mapping is empty");
  const destinations = new Set(), sourceMappings = new Set(), runtimeDirectories = new Set(["./"]); let runtimeBytes = 0;
  registerRuntimeDirectories("/opt/gate-h2/runtime-manifest.v1.json", runtimeDirectories);
  for (const mapping of lock.runtime_mapping) { exact(mapping, ["destination", "source_member_path", "operation", "archive_member_path", "output"], "runtime mapping", "E_LOCK_MAPPING_FIELDS"); if (!runtimeDestination(mapping.destination) || mapping.destination === "/opt/gate-h2/runtime-manifest.v1.json" || destinations.has(mapping.destination) || !safeMemberPath(mapping.source_member_path)) fail("E_LOCK_MAPPING", "runtime destination or source is unsafe, reserved, duplicate, or too deep"); const source = byPath.get(mapping.source_member_path); if (!source || !MATERIALIZABLE_SOURCES.has(source.category) || !["archive_member", "whole_file"].includes(mapping.operation) || (mapping.operation === "archive_member" && (!safeMemberPath(mapping.archive_member_path) || !ARCHIVE_SOURCES.has(source.category))) || (mapping.operation === "whole_file" && (mapping.archive_member_path !== null || !BLOB_SOURCES.has(source.category)))) fail("E_LOCK_MAPPING", "runtime mapping must derive from an approved archive member or whole blob"); validateIdentity(mapping.output, "E_LOCK_MAPPING"); runtimeBytes += mapping.output.bytes; if (!Number.isSafeInteger(runtimeBytes) || runtimeBytes > MAX_RUNTIME_BYTES) fail("E_LOCK_MAPPING", "runtime output aggregate exceeds the builder rootfs cap"); registerRuntimeDirectories(mapping.destination, runtimeDirectories); destinations.add(mapping.destination); sourceMappings.add(mapping.source_member_path); }
  for (const artifact of lock.artifacts) if (MATERIALIZABLE_SOURCES.has(artifact.category) && !sourceMappings.has(artifact.member_path)) fail("E_LOCK_MAPPING", "materializable source artifact is not accounted for by a derived destination");
  return lock;
}

function gzipCStringEnd(bytes, offset, label) { const end = bytes.indexOf(0, offset); if (end === -1) throw new Error(`${label}: unterminated gzip string field`); return end + 1; }
export function gunzipSingleMember(bytes, label, maximumOutputBytes = MAX_ARCHIVE_EXPANDED_BYTES) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || (bytes[3] & 0xe0) !== 0) throw new Error(`${label}: invalid gzip header`);
  const flags = bytes[3]; let offset = 10;
  if ((flags & 0x04) !== 0) { if (offset + 2 > bytes.length) throw new Error(`${label}: truncated gzip extra length`); const length = bytes.readUInt16LE(offset); offset += 2; if (offset + length > bytes.length) throw new Error(`${label}: truncated gzip extra field`); offset += length; }
  if ((flags & 0x08) !== 0) offset = gzipCStringEnd(bytes, offset, label);
  if ((flags & 0x10) !== 0) offset = gzipCStringEnd(bytes, offset, label);
  if ((flags & 0x02) !== 0) { if (offset + 2 > bytes.length || (crc32(bytes.subarray(0, offset)) & 0xffff) !== bytes.readUInt16LE(offset)) throw new Error(`${label}: gzip header CRC differs`); offset += 2; }
  let inflated;
  try { inflated = inflateRawSync(bytes.subarray(offset), { info: true, maxOutputLength: maximumOutputBytes }); }
  catch { throw new Error(`${label}: gzip DEFLATE stream is invalid or exceeds ${maximumOutputBytes} bytes`); }
  const trailerOffset = offset + inflated.engine.bytesWritten;
  if (trailerOffset + 8 !== bytes.length) throw new Error(`${label}: concatenated gzip members and trailing suffix bytes are forbidden`);
  const output = inflated.buffer;
  if (bytes.readUInt32LE(trailerOffset) !== crc32(output) || bytes.readUInt32LE(trailerOffset + 4) !== (output.length >>> 0)) throw new Error(`${label}: gzip trailer CRC or size differs`);
  return output;
}

function descriptor(value, identity, label) { exact(value, ["mediaType", "digest", "size"], label, "E_ACQUIRED_OCI_MANIFEST"); if (value.mediaType !== identity.media_type || value.digest !== `sha256:${identity.sha256}` || value.size !== identity.bytes) fail("E_ACQUIRED_OCI_MANIFEST", `${label} differs from the lock`); }
function validateOciConfig(config, diffIds) { if (!config || Array.isArray(config) || typeof config !== "object") fail("E_ACQUIRED_OCI_CONFIG", "OCI config must be an object"); const fields = Object.keys(config); if (!["architecture", "os", "rootfs"].every((field) => fields.includes(field)) || fields.some((field) => !OCI_CONFIG_FIELDS.has(field))) fail("E_ACQUIRED_OCI_CONFIG", "OCI config fields differ"); if (config.architecture !== "amd64" || config.os !== "linux") fail("E_ACQUIRED_OCI_CONFIG", "OCI config platform differs"); exact(config.rootfs, ["type", "diff_ids"], "OCI config rootfs", "E_ACQUIRED_OCI_CONFIG"); if (config.rootfs.type !== "layers" || !Array.isArray(config.rootfs.diff_ids) || JSON.stringify(config.rootfs.diff_ids) !== JSON.stringify(diffIds)) fail("E_ACQUIRED_OCI_CONFIG", "OCI config rootfs diff IDs differ from the ordered uncompressed layers"); }
function validateManifestRecords(lock, metadataByPath, layerDiffIds) { const byPath = artifactByPath(lock); for (const image of lock.oci_images) { const manifest = metadataByPath.get(image.manifest_member_path), config = metadataByPath.get(image.config_member_path); if (!manifest || !config) fail("E_ACQUIRED_OCI_MANIFEST", "OCI manifest or config bytes were not inspected"); exact(manifest, ["schemaVersion", "mediaType", "config", "layers"], "OCI manifest", "E_ACQUIRED_OCI_MANIFEST"); if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || !Array.isArray(manifest.layers) || manifest.layers.length !== image.layer_member_paths.length) fail("E_ACQUIRED_OCI_MANIFEST", "OCI manifest shape or layer cardinality differs"); const configArtifact = byPath.get(image.config_member_path); descriptor(manifest.config, configArtifact, "OCI manifest config"); const diffIds = []; for (const [index, layerPath] of image.layer_member_paths.entries()) { const layer = byPath.get(layerPath); descriptor(manifest.layers[index], layer, `OCI manifest layer ${index}`); const diffId = layerDiffIds.get(layerPath); if (!diffId) fail("E_ACQUIRED_OCI_LAYER", `OCI layer was not inspected: ${layerPath}`); diffIds.push(diffId); } validateOciConfig(config, diffIds); } }

function mappingsBySource(lock) { const grouped = new Map(); for (const mapping of lock.runtime_mapping) { const mappings = grouped.get(mapping.source_member_path) ?? []; mappings.push(mapping); grouped.set(mapping.source_member_path, mappings); } return grouped; }
export function deriveSourceMappings(source, sourceBytes, mappings, gzipCode = "E_ACQUIRED_ARCHIVE") {
  let archiveBytes = null;
  if (ARCHIVE_SOURCES.has(source.category)) {
    if (source.archive_format === "tar_gzip") { const expansionBudget = MAX_ACQUIRED_WORKING_BUFFER_BYTES - sourceBytes.length; if (expansionBudget < 1024) fail(gzipCode, `archive ${source.member_path}: compressed bytes leave no bounded expansion budget`); try { archiveBytes = gunzipSingleMember(sourceBytes, `archive ${source.member_path}`, expansionBudget); } catch (error) { fail(gzipCode, error.message); } }
    else archiveBytes = sourceBytes;
  }
  let entriesByName = null;
  if (mappings.some((mapping) => mapping.operation === "archive_member")) {
    let entries; try { entries = parseInputTar(archiveBytes, `archive ${source.member_path}`, { maximumBytes: MAX_ARCHIVE_EXPANDED_BYTES }); } catch (error) { fail("E_ACQUIRED_ARCHIVE", error.message); }
    entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  }
  const results = new Map();
  for (const mapping of mappings) {
    let bytes;
    if (mapping.operation === "whole_file") bytes = sourceBytes;
    else { const entry = entriesByName.get(mapping.archive_member_path); if (!entry || entry.type !== "file") fail("E_ACQUIRED_DERIVATION", `mapped archive member is missing or non-regular: ${mapping.archive_member_path}`); bytes = entry.bytes; }
    if (bytes.length !== mapping.output.bytes || sha256(bytes) !== mapping.output.sha256) fail("E_ACQUIRED_DERIVATION", `derived runtime output differs from the acquired source: ${mapping.destination}`);
    results.set(mapping.destination, bytes);
  }
  return { derived: results, layerDiffId: source.category === "oci_layer" ? `sha256:${sha256(archiveBytes)}` : null };
}

function inspectSourceArtifact(source, sourceBytes, mappings, gzipCode = "E_ACQUIRED_ARCHIVE") {
  return deriveSourceMappings(source, sourceBytes, mappings, gzipCode).layerDiffId;
}

export function verifyRuntimeDerivations(lock, bytesByPath) { const byPath = artifactByPath(lock); for (const [sourcePath, mappings] of mappingsBySource(lock)) { const source = byPath.get(sourcePath), sourceBytes = bytesByPath.get(sourcePath); if (!source || !sourceBytes) fail("E_ACQUIRED_DERIVATION", `mapped source bytes are missing: ${sourcePath}`); inspectSourceArtifact(source, sourceBytes, mappings); } }

export function verifyAcquiredDirectory(lock, acquiredDirectory, trustedContext) {
  validateExternalInputLock(lock); validateTrustedContext(lock, trustedContext);
  const expected = new Map(lock.artifacts.map((artifact) => [artifact.member_path, { bytes: artifact.bytes, mode: artifact.mode, cap: artifact.bytes }]));
  const byPath = artifactByPath(lock), groupedMappings = mappingsBySource(lock), metadataByPath = new Map(), layerDiffIds = new Map();
  try {
    visitSecureTree(resolve(acquiredDirectory), expected, (member, result) => {
      const artifact = byPath.get(member), bytes = result.buffer;
      if (result.sha256 !== artifact.sha256) fail("E_ACQUIRED_HASH", `digest drift: ${member}`);
      if (["oci_manifest", "oci_config"].includes(artifact.category)) { try { metadataByPath.set(member, parseStrictJson(bytes)); } catch { fail("E_ACQUIRED_OCI_MANIFEST", "OCI manifest or config bytes are not strict JSON"); } }
      const diffId = inspectSourceArtifact(artifact, bytes, groupedMappings.get(member) ?? [], artifact.category === "oci_layer" ? "E_ACQUIRED_OCI_LAYER" : "E_ACQUIRED_ARCHIVE");
      if (diffId) layerDiffIds.set(member, diffId);
    }, { rootMode: 0o755, directoryMode: 0o755 });
  } catch (error) {
    if (typeof error.code === "string" && error.code.startsWith("E_ACQUIRED_")) throw error;
    fail(error.code === "E_TREE_UNSUPPORTED" ? "E_ACQUIRED_PLATFORM_UNSUPPORTED" : error.code === "E_TREE_MISSING" ? "E_ACQUIRED_MISSING" : error.code === "E_TREE_EXTRA" ? "E_ACQUIRED_EXTRA" : error.code === "E_TREE_SIZE" ? "E_ACQUIRED_SIZE" : "E_ACQUIRED_MODE_OR_LINK", error.message);
  }
  validateManifestRecords(lock, metadataByPath, layerDiffIds);
  return { artifact_count: lock.artifacts.length, retained_metadata_count: metadataByPath.size, layer_identity_count: layerDiffIds.size };
}

export function parseAndValidateInputLock(lockPath, acquiredDirectory, trustedContext) { let bytes; try { bytes = readContainedRegular(lockPath, 0o444, MAX_INPUT_LOCK_BYTES); } catch (error) { fail("E_LOCK_FILE", error.message); } let lock; try { lock = parseStrictJson(bytes); } catch (error) { fail("E_LOCK_JSON", error.message); } validateExternalInputLock(lock); if (acquiredDirectory !== undefined) verifyAcquiredDirectory(lock, acquiredDirectory, trustedContext); return { lock, bytes, sha256: sha256(bytes) }; }

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) { const [mode, lockPath, acquiredDirectory, sourceCommit, sourceTree] = process.argv.slice(2); if (mode !== "--structure" && mode !== "--acquired") fail("E_USAGE", "use --structure LOCK or --acquired LOCK DIRECTORY COMMIT TREE"); if (!lockPath || (mode === "--acquired" && (!acquiredDirectory || !sourceCommit || !sourceTree))) fail("E_USAGE", "lock and acquired trusted context are required"); process.stdout.write(`${parseAndValidateInputLock(lockPath, mode === "--acquired" ? acquiredDirectory : undefined, mode === "--acquired" ? { source_commit: sourceCommit, source_tree_sha256: sourceTree } : undefined).sha256}\n`); }
