import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { parseStrictJson } from "./strict-json.mjs";
import { readContainedRegular } from "./secure-files.mjs";
import { deriveSourceMappings, parseAndValidateInputLock, REVIEWED_BUILDER_IMAGE_REPOSITORY } from "./verify-external-input-lock.mjs";
import { verifyBuilderImageReceipt } from "./verify-builder-image-receipt.mjs";
import {
  assertRetainedCapability,
  cleanupFiles,
  closeRetainedCapability,
  retainDirectory,
  retainParent,
  retainedPath,
  writeImmutableBufferAt,
} from "./packet-3c-retained-files.mjs";

const TAR_BLOCK_BYTES = 512;
const TAR_RECORD_BYTES = 10_240;
const MAX_RUNTIME_BYTES = 1024 * 1024 * 1024;
const MAX_TAR_ENTRIES = 65_537;
const OUTPUT_NAMES = ["runtime-manifest.json", "rootfs.tar", "layer.tar", "config.json", "manifest.json", "index.json"];
const MEDIA = { runtime_manifest: "application/vnd.gate-h2.runtime-manifest.v1+json", rootfs: "application/vnd.gate-h2.rootfs.v1", layer: "application/vnd.oci.image.layer.v1.tar", config: "application/vnd.oci.image.config.v1+json", manifest: "application/vnd.oci.image.manifest.v1+json", index: "application/vnd.oci.image.index.v1+json" };
const fail = (code, message, cause) => { const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause }); error.code = code; throw error; };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
const ascii = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function sanitizeOfflineEnvironment() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, { HOME: "/nonexistent", PATH: "", LANG: "C", LC_ALL: "C", TZ: "UTC", NO_PROXY: "*", http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", all_proxy: "" });
  process.umask(0o077);
}

function putOctal(header, offset, length, value) {
  const text = `${value.toString(8).padStart(length - 1, "0")}\0`;
  if (text.length !== length) fail("E_OFFLINE_ROOTFS", "canonical tar field overflow");
  header.write(text, offset, length, "ascii");
}

function tarHeader(name, mode, bytes, directory) {
  if (!/^[\x20-\x7e]+$/.test(name) || Buffer.byteLength(name, "ascii") >= 100) fail("E_OFFLINE_ROOTFS", `canonical tar name is invalid: ${name}`);
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  header.write(name, 0, 100, "ascii"); putOctal(header, 100, 8, mode); putOctal(header, 108, 8, 0); putOctal(header, 116, 8, 0); putOctal(header, 124, 12, bytes); putOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156); header[156] = directory ? 0x35 : 0x30; header.write("ustar\0", 257, 6, "latin1"); header.write("00", 263, 2, "ascii"); putOctal(header, 329, 8, 0); putOctal(header, 337, 8, 0);
  let checksum = 0; for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "latin1");
  return header;
}

function canonicalRootfs(runtimeBytesByDestination, runtimeManifest) {
  const files = new Map([...runtimeBytesByDestination.entries()].map(([path, value]) => [`.${path}`, value]));
  files.set("./opt/gate-h2/runtime-manifest.v1.json", { bytes: runtimeManifest, mode: 0o444 });
  const directories = new Set(["./"]);
  for (const name of files.keys()) {
    const parts = name.slice(2).split("/"); parts.pop(); let current = "./";
    for (const part of parts) { current += `${part}/`; directories.add(current); }
  }
  if (directories.size + files.size > MAX_TAR_ENTRIES) fail("E_OFFLINE_ROOTFS", "canonical rootfs entry count exceeds its bound");
  const chunks = [];
  for (const name of [...directories, ...files.keys()].sort(ascii)) {
    const directory = directories.has(name), value = files.get(name), bytes = directory ? Buffer.alloc(0) : value.bytes;
    chunks.push(tarHeader(name, directory ? 0o755 : value.mode, bytes.length, directory));
    if (bytes.length > 0) {
      chunks.push(bytes);
      const padding = (TAR_BLOCK_BYTES - (bytes.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2));
  const bytesBeforeRecordPadding = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const recordPadding = (TAR_RECORD_BYTES - (bytesBeforeRecordPadding % TAR_RECORD_BYTES)) % TAR_RECORD_BYTES;
  if (recordPadding > 0) chunks.push(Buffer.alloc(recordPadding));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  // The receipt schema caps the serialized rootfs itself at 1 GiB; the
  // runtime-byte aggregate is a separate (slightly weaker) input bound.
  if (total > MAX_RUNTIME_BYTES) fail("E_OFFLINE_ROOTFS", "canonical rootfs exceeds its serialized byte bound");
  return Buffer.concat(chunks, total);
}

function identity(bytes, media_type) { return { sha256: sha256(bytes), bytes: bytes.length, media_type }; }

function materializableBytes(lock, acquiredDirectory) {
  const byPath = new Map(lock.artifacts.map((artifact) => [artifact.member_path, artifact]));
  const grouped = new Map();
  for (const mapping of lock.runtime_mapping) { const list = grouped.get(mapping.source_member_path) ?? []; list.push(mapping); grouped.set(mapping.source_member_path, list); }
  const outputs = new Map();
  for (const [sourcePath, mappings] of [...grouped.entries()].sort(([left], [right]) => ascii(left, right))) {
    const source = byPath.get(sourcePath), sourceBytes = readContainedRegular(`${acquiredDirectory}/${source.member_path}`, 0o444, source.bytes), result = deriveSourceMappings(source, sourceBytes, mappings);
    for (const mapping of mappings) outputs.set(mapping.destination, { bytes: result.derived.get(mapping.destination), mode: mapping.output.mode });
  }
  return outputs;
}

function outputGraph(lock, lockSha256, runtimeBytes, rootfsBytes) {
  const configBytes = jsonBytes({ architecture: "amd64", os: "linux", rootfs: { type: "layers", diff_ids: [`sha256:${sha256(rootfsBytes)}`] } });
  const config = identity(configBytes, MEDIA.config), layer = identity(rootfsBytes, MEDIA.layer);
  const manifestBytes = jsonBytes({ schemaVersion: 2, mediaType: MEDIA.manifest, config: { mediaType: config.media_type, digest: `sha256:${config.sha256}`, size: config.bytes }, layers: [{ mediaType: layer.media_type, digest: `sha256:${layer.sha256}`, size: layer.bytes }] });
  const manifest = identity(manifestBytes, MEDIA.manifest);
  const indexBytes = jsonBytes({ schemaVersion: 2, mediaType: MEDIA.index, manifests: [{ mediaType: manifest.media_type, digest: `sha256:${manifest.sha256}`, size: manifest.bytes, platform: { os: "linux", architecture: "amd64" } }] });
  const index = identity(indexBytes, MEDIA.index);
  return {
    bytes: { "runtime-manifest.json": runtimeBytes, "rootfs.tar": rootfsBytes, "layer.tar": rootfsBytes, "config.json": configBytes, "manifest.json": manifestBytes, "index.json": indexBytes },
    receipt: { schema_version: "gate_h2_builder_image_receipt_v1.0.0", platform: { os: "linux", architecture: "amd64" }, input_lock_sha256: lockSha256, runtime_manifest: identity(runtimeBytes, MEDIA.runtime_manifest), rootfs: identity(rootfsBytes, MEDIA.rootfs), layer, config, manifest, index, final_image_reference: `${REVIEWED_BUILDER_IMAGE_REPOSITORY}@sha256:${manifest.sha256}`, materializer: lock.materializer },
  };
}

function receiptLocation(receiptPath, outputDirectory) {
  const receipt = resolve(receiptPath), output = resolve(outputDirectory);
  if (receipt === output || relative(output, receipt).split(sep)[0] !== "..") fail("E_OFFLINE_RECEIPT", "receipt must be outside the six-file output directory");
  const retained = retainParent(receipt, { label: "receipt parent" });
  try {
    lstatSync(retainedPath(retained.parent, retained.name), { bigint: true });
    fail("E_OFFLINE_RECEIPT", "receipt path already exists and cannot be replaced");
  } catch (error) {
    if (error.code !== "ENOENT") { closeRetainedCapability(retained.parent); throw error; }
  }
  return { ...retained, path: receipt };
}

export async function writeImmutableFile(path, bytes, mode = 0o444, options = {}) {
  const retained = retainParent(resolve(path), { label: "immutable file parent" });
  try {
    // Publication is intentionally create-only. Check the retained parent
    // before opening a temporary inode so callers get the stable offline
    // boundary code and an existing destination is never touched.
    try { lstatSync(retainedPath(retained.parent, retained.name), { bigint: true }); fail("E_OFFLINE_OUTPUT", `immutable destination already exists: ${path}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return await writeImmutableBufferAt(retained.parent, retained.name, bytes, { ...options, mode });
  }
  finally { closeRetainedCapability(retained.parent); }
}

export async function materializeOffline(lockPath, acquiredDirectory, outputDirectory, receiptPath, trustedContext, { fault, observe } = {}) {
  sanitizeOfflineEnvironment();
  if (process.platform !== "linux") fail("E_OFFLINE_PLATFORM", "offline materialization admission requires Linux retained-directory capabilities");
  const output = resolve(outputDirectory), acquired = resolve(acquiredDirectory);
  let outputCapability;
  try { outputCapability = retainDirectory(output, { label: "materialization output", mode: 0o700, empty: true, secureParent: true }); }
  catch (error) {
    // Keep the materializer's public boundary distinct from the retained-file
    // helper's implementation errors, while preserving all other failures.
    if (error.code === "E_RETAINED_PARENT") fail("E_OFFLINE_PARENT", error.message, error);
    if (["E_RETAINED_NOT_EMPTY", "E_RETAINED_MODE", "E_RETAINED_OWNER", "E_RETAINED_DIRECTORY"].includes(error.code)) fail("E_OFFLINE_OUTPUT", error.message, error);
    throw error;
  }
  let receipt;
  try { receipt = receiptLocation(receiptPath, output); }
  catch (error) { closeRetainedCapability(outputCapability); throw error; }
  const outputRecords = [], receiptRecords = [];
  try {
    const parsed = parseAndValidateInputLock(lockPath, acquired, trustedContext), runtimeBytesByDestination = materializableBytes(parsed.lock, acquired);
    const runtimeEntries = [...parsed.lock.runtime_mapping].sort((left, right) => ascii(left.destination, right.destination)).map((mapping) => ({ path: mapping.destination, mode: mapping.output.mode, bytes: mapping.output.bytes, sha256: mapping.output.sha256 }));
    const runtimeManifest = jsonBytes({ schema_version: "gate_h2_builder_runtime_inventory_v1.0.0", target: parsed.lock.runtime_contract.target, entries: runtimeEntries });
    const rootfsBytes = canonicalRootfs(runtimeBytesByDestination, runtimeManifest), graph = outputGraph(parsed.lock, parsed.sha256, runtimeManifest, rootfsBytes);
    for (const name of OUTPUT_NAMES) {
      const result = await writeImmutableBufferAt(outputCapability, name, graph.bytes[name], { mode: 0o444, fault, observe });
      outputRecords.push({ parent: outputCapability, name, identity: result.identity });
    }
    const receiptBytes = jsonBytes(graph.receipt), receiptResult = await writeImmutableBufferAt(receipt.parent, receipt.name, receiptBytes, { mode: 0o444, fault, observe });
    receiptRecords.push({ parent: receipt.parent, name: receipt.name, identity: receiptResult.identity });
    assertRetainedCapability(outputCapability); assertRetainedCapability(receipt.parent);
    const parsedReceipt = parseStrictJson(readContainedRegular(receipt.path, 0o444, 1024 * 1024));
    verifyBuilderImageReceipt(parsedReceipt, { lockBytes: parsed.bytes, acquiredDirectory: acquired, outputDirectory: output, trustedContext });
    assertRetainedCapability(outputCapability); assertRetainedCapability(receipt.parent);
    closeRetainedCapability(receipt.parent); closeRetainedCapability(outputCapability);
    return { receipt: parsedReceipt, receiptPath: receipt.path, outputDirectory: output };
  } catch (error) {
    const cleanupErrors = [...(error.cleanupErrors ?? []), ...cleanupFiles(receiptRecords, fault), ...cleanupFiles(outputRecords, fault)];
    closeRetainedCapability(receipt.parent); closeRetainedCapability(outputCapability);
    if (cleanupErrors.length > 0) error.cleanupErrors = cleanupErrors;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const [lockPath, acquiredDirectory, outputDirectory, receiptPath, sourceCommit, sourceTree] = process.argv.slice(2);
  if (!lockPath || !acquiredDirectory || !outputDirectory || !receiptPath || !sourceCommit || !sourceTree) fail("E_USAGE", "lock, acquired directory, output directory, receipt path, and trusted materializer commit/tree are required");
  materializeOffline(lockPath, acquiredDirectory, outputDirectory, receiptPath, { source_commit: sourceCommit, source_tree_sha256: sourceTree }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
