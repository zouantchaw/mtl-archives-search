import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";

const OPEN_DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0);
const OPEN_FILE_READ = constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0);
const OPEN_FILE_CREATE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0);
const DIRECTORY_IDENTITY = ["dev", "ino", "mode", "uid", "gid"];
const FILE_IDENTITY = ["dev", "ino", "mode", "uid", "gid", "size"];

const fail = (code, message, cause) => {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  throw error;
};

function component(name) {
  if (typeof name !== "string" || name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) fail("E_RETAINED_COMPONENT", "unsafe retained-files path component");
  return name;
}

function splitAbsolute(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.length === 1 || path.endsWith("/") || path.includes("//")) fail("E_RETAINED_PATH", "retained-files paths must be canonical absolute non-root paths");
  return path.slice(1).split("/").map(component);
}

function reference(fd, name) {
  if (process.platform !== "linux") fail("E_RETAINED_PLATFORM", "retained mutation requires Linux /proc/self/fd");
  return `/proc/self/fd/${fd}${name === undefined ? "" : `/${component(name)}`}`;
}

function same(metadata, expected, fields) {
  return fields.every((field) => metadata[field] === expected[field]);
}

function directoryMetadata(fd, label) {
  const metadata = fstatSync(fd, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("E_RETAINED_DIRECTORY", `${label} is not a retained directory`);
  return metadata;
}

function fileMetadata(fd, label) {
  const metadata = fstatSync(fd, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("E_RETAINED_FILE", `${label} is not a retained regular file`);
  return metadata;
}

function closeQuietly(fd, cleanupErrors) {
  if (fd === undefined || fd === null) return;
  try { closeSync(fd); } catch (error) { cleanupErrors?.push(error); }
}

function appendCleanupErrors(primary, cleanupErrors) {
  if (cleanupErrors.length > 0) primary.cleanupErrors = [...(primary.cleanupErrors ?? []), ...cleanupErrors];
  return primary;
}

function invokeFault(fault, point, code) {
  try { fault?.(point); } catch (error) { if (error?.code?.startsWith("E_PACKET3C_")) throw error; fail(code, `injected or underlying failure at ${point}`, error); }
}

function wrap(code, message, operation) {
  try { return operation(); } catch (error) { if (error?.code?.startsWith("E_PACKET3C_") || error?.code?.startsWith("E_RETAINED_")) throw error; fail(code, message, error); }
}

function validateEdge(handle) {
  const retained = directoryMetadata(handle.fd, handle.label);
  if (!same(retained, handle.identity, DIRECTORY_IDENTITY)) fail("E_RETAINED_REPLACED", `${handle.label} retained identity changed`);
  if (handle.parent) {
    let edge;
    try { edge = lstatSync(reference(handle.parent.fd, handle.name), { bigint: true }); } catch (error) { fail("E_RETAINED_REPLACED", `${handle.label} parent/name edge disappeared`, error); }
    if (edge.isSymbolicLink() || !edge.isDirectory() || !same(edge, handle.identity, DIRECTORY_IDENTITY)) fail("E_RETAINED_REPLACED", `${handle.label} parent/name edge changed`);
  }
}

export function assertRetainedCapability(handle) {
  const chain = [];
  for (let current = handle; current; current = current.parent) chain.push(current);
  for (const current of chain.reverse()) validateEdge(current);
}

function openChild(parent, name, label) {
  assertRetainedCapability(parent);
  let before;
  try { before = lstatSync(reference(parent.fd, name), { bigint: true }); } catch (error) { throw error; }
  if (!before.isDirectory() || before.isSymbolicLink()) fail("E_RETAINED_DIRECTORY", `${label} is not a directory`);
  const fd = openSync(reference(parent.fd, name), OPEN_DIRECTORY);
  try {
    const identity = directoryMetadata(fd, label);
    if (!same(before, identity, DIRECTORY_IDENTITY)) fail("E_RETAINED_REPLACED", `${label} changed while it was retained`);
    return { fd, identity, label, parent, name };
  } catch (error) { closeSync(fd); throw error; }
}

export function retainDirectory(path, { label = "retained directory", mode, empty = false, secureParent = false } = {}) {
  if (process.platform !== "linux") fail("E_RETAINED_PLATFORM", "retained mutation requires Linux /proc/self/fd");
  const parts = splitAbsolute(path);
  const rootFd = openSync("/", OPEN_DIRECTORY);
  let current = { fd: rootFd, identity: directoryMetadata(rootFd, "filesystem root"), label: "filesystem root", parent: null, name: null };
  try {
    for (const [index, name] of parts.entries()) current = openChild(current, name, index === parts.length - 1 ? label : `ancestor ${name}`);
    const metadata = current.identity;
    if (metadata.uid !== BigInt(process.geteuid())) fail("E_RETAINED_OWNER", `${label} is not owned by the effective user`);
    if (mode !== undefined && Number(metadata.mode & 0o7777n) !== mode) fail("E_RETAINED_MODE", `${label} mode is not ${mode.toString(8)}`);
    if (secureParent) {
      const parent = current.parent?.identity;
      if (!parent || parent.uid !== BigInt(process.geteuid()) || (parent.mode & 0o022n) !== 0n) fail("E_RETAINED_PARENT", `${label} parent is not owned and non-group/world-writable`);
    }
    if (empty && readdirSync(reference(current.fd)).length !== 0) fail("E_RETAINED_NOT_EMPTY", `${label} is not empty`);
    assertRetainedCapability(current);
    return current;
  } catch (error) { closeRetainedCapability(current); throw error; }
}

export function retainParent(path, { label = "retained parent", secure = true } = {}) {
  const parts = splitAbsolute(path), name = parts.pop();
  const parentPath = `/${parts.join("/")}`;
  const parent = retainDirectory(parentPath, { label, secureParent: false });
  if (secure && (parent.identity.uid !== BigInt(process.geteuid()) || (parent.identity.mode & 0o022n) !== 0n)) { closeRetainedCapability(parent); fail("E_RETAINED_PARENT", `${label} is not owned and non-group/world-writable`); }
  return { parent, name };
}

export function closeRetainedCapability(handle) {
  const seen = new Set();
  for (let current = handle; current && !seen.has(current.fd); current = current.parent) {
    seen.add(current.fd);
    try { closeSync(current.fd); } catch {}
  }
}

export function closeRetainedHandle(handle) {
  if (handle?.fd !== undefined) closeSync(handle.fd);
}

function removeFileIfIdentity(parent, name, identity, cleanupErrors, fault) {
  try { invokeFault(fault, "cleanup", "E_PACKET3C_CLEANUP"); } catch (error) { cleanupErrors.push(error); }
  try {
    assertRetainedCapability(parent);
    const edge = lstatSync(reference(parent.fd, name), { bigint: true });
    if (edge.isSymbolicLink() || !edge.isFile() || !same(edge, identity, FILE_IDENTITY)) fail("E_RETAINED_REPLACED", `refusing to remove replaced file ${name}`);
    unlinkSync(reference(parent.fd, name));
  } catch (error) { if (error.code !== "ENOENT") cleanupErrors.push(error); }
}

export function removeDirectoryIfIdentity(parent, name, identity, cleanupErrors = [], fault) {
  try { invokeFault(fault, "cleanup", "E_PACKET3C_CLEANUP"); } catch (error) { cleanupErrors.push(error); }
  try {
    assertRetainedCapability(parent);
    const edge = lstatSync(reference(parent.fd, name), { bigint: true });
    if (edge.isSymbolicLink() || !edge.isDirectory() || !same(edge, identity, DIRECTORY_IDENTITY)) fail("E_RETAINED_REPLACED", `refusing to remove replaced directory ${name}`);
    rmdirSync(reference(parent.fd, name));
  } catch (error) { if (error.code !== "ENOENT") cleanupErrors.push(error); }
  return cleanupErrors;
}

export function createDirectoryAt(parent, name, mode, { label = name, fault, observe } = {}) {
  assertRetainedCapability(parent);
  invokeFault(fault, "mkdir", "E_PACKET3C_MKDIR");
  wrap("E_PACKET3C_MKDIR", `could not create ${label}`, () => mkdirSync(reference(parent.fd, name), { mode }));
  let child;
  try {
    child = openChild(parent, name, label);
    fchmodSync(child.fd, mode);
    child.identity = directoryMetadata(child.fd, label);
    if (child.identity.uid !== BigInt(process.geteuid()) || Number(child.identity.mode & 0o7777n) !== mode) fail("E_PACKET3C_MKDIR", `${label} ownership or mode differs after creation`);
    observe?.({ phase: "directory-retained", label, capability: child });
    assertRetainedCapability(child);
    invokeFault(fault, "directory_fsync", "E_PACKET3C_DIRECTORY_FSYNC");
    fsyncSync(parent.fd);
    return child;
  } catch (error) {
    const cleanupErrors = [];
    if (child) { removeDirectoryIfIdentity(parent, name, child.identity, cleanupErrors, fault); closeSync(child.fd); }
    else {
      try { rmdirSync(reference(parent.fd, name)); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") cleanupErrors.push(cleanupError); }
    }
    try { fsyncSync(parent.fd); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    throw appendCleanupErrors(error, cleanupErrors);
  }
}

export function openOrCreateDestination(path, mode, { label = "destination", fault, observe } = {}) {
  const { parent, name } = retainParent(path, { label: `${label} parent` });
  try {
    try {
      const existing = openChild(parent, name, label);
      if (existing.identity.uid !== BigInt(process.geteuid()) || Number(existing.identity.mode & 0o7777n) !== mode || readdirSync(reference(existing.fd)).length !== 0) fail("E_PACKET3C_DESTINATION", `${label} must be empty, owned, and mode ${mode.toString(8)}`);
      observe?.({ phase: "destination-retained", label, capability: existing });
      assertRetainedCapability(existing);
      return { directory: existing, created: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const created = createDirectoryAt(parent, name, mode, { label, fault, observe });
    return { directory: created, created: true };
  } catch (error) { closeRetainedCapability(parent); throw error; }
}

export function openOrCreateRelativeDirectory(root, relativePath, mode, { created = [], fault, observe } = {}) {
  const parts = relativePath === "" ? [] : relativePath.split("/").map(component);
  let current = root;
  for (const name of parts) {
    let next;
    try { next = openChild(current, name, `directory ${relativePath}`); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      next = createDirectoryAt(current, name, mode, { label: `directory ${relativePath}`, fault, observe });
      created.push({ parent: current, name, identity: next.identity });
    }
    if (next.identity.uid !== BigInt(process.geteuid()) || Number(next.identity.mode & 0o7777n) !== mode) { closeSync(next.fd); fail("E_PACKET3C_DIRECTORY", `directory ${relativePath} mode or owner differs`); }
    current = next;
  }
  return current;
}

export function openOrCreateChildDirectory(parent, name, mode, { created = [], fault, observe, label = `directory ${name}` } = {}) {
  let child;
  try { child = openChild(parent, name, label); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    child = createDirectoryAt(parent, name, mode, { label, fault, observe });
    created.push({ parent, name, identity: child.identity });
  }
  if (child.identity.uid !== BigInt(process.geteuid()) || Number(child.identity.mode & 0o7777n) !== mode) { closeSync(child.fd); fail("E_PACKET3C_DIRECTORY", `${label} mode or owner differs`); }
  return child;
}

function normalizeChunk(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail("E_PACKET3C_WRITE", "immutable writer received a non-byte chunk");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

async function writeChunks(fd, chunks, maximumBytes, expectedBytes, expectedSha256, fault) {
  const hash = createHash("sha256");
  let written = 0;
  for await (const value of chunks) {
    const chunk = normalizeChunk(value);
    if (written + chunk.length > maximumBytes) fail("E_PACKET3C_SIZE", "immutable write exceeds its byte bound");
    let offset = 0;
    while (offset < chunk.length) {
      invokeFault(fault, "write", "E_PACKET3C_WRITE");
      const count = wrap("E_PACKET3C_WRITE", "immutable write failed", () => writeSync(fd, chunk, offset, chunk.length - offset, written + offset));
      if (!Number.isSafeInteger(count) || count <= 0 || count > chunk.length - offset) fail("E_PACKET3C_WRITE", "immutable write made invalid progress");
      offset += count;
    }
    hash.update(chunk);
    written += chunk.length;
  }
  const digest = hash.digest("hex");
  if (expectedBytes !== undefined && written !== expectedBytes) fail("E_PACKET3C_SIZE", "immutable write byte count differs");
  if (expectedSha256 !== undefined && digest !== expectedSha256) fail("E_PACKET3C_HASH", "immutable write digest differs");
  return { bytes: written, sha256: digest };
}

function oneChunk(bytes) { return { async *[Symbol.asyncIterator]() { yield bytes; } }; }

export async function writeImmutableAt(parent, name, chunks, { mode = 0o444, maximumBytes, expectedBytes, expectedSha256, fault, observe } = {}) {
  assertRetainedCapability(parent);
  const suffix = randomBytes(16).toString("hex"), temporaryName = `.${name}.partial-${suffix}`;
  let fd, temporaryIdentity, publishedIdentity, temporaryPresent = false, published = false;
  try {
    fd = wrap("E_PACKET3C_CREATE", `could not create temporary file for ${name}`, () => openSync(reference(parent.fd, temporaryName), OPEN_FILE_CREATE, 0o600));
    temporaryPresent = true;
    temporaryIdentity = fileMetadata(fd, `temporary ${name}`);
    const result = await writeChunks(fd, chunks, maximumBytes ?? expectedBytes, expectedBytes, expectedSha256, fault);
    invokeFault(fault, "file_fsync", "E_PACKET3C_FILE_FSYNC"); fsyncSync(fd);
    fchmodSync(fd, mode);
    invokeFault(fault, "file_fsync_after_chmod", "E_PACKET3C_FILE_FSYNC"); fsyncSync(fd);
    const ready = fileMetadata(fd, `temporary ${name}`);
    if (ready.uid !== BigInt(process.geteuid()) || Number(ready.mode & 0o7777n) !== mode || ready.size !== BigInt(result.bytes)) fail("E_PACKET3C_FILE_METADATA", `${name} mode, owner, or size differs before publication`);
    temporaryIdentity = ready;
    assertRetainedCapability(parent);
    observe?.({ phase: "before-file-publication", name, parent });
    assertRetainedCapability(parent);
    invokeFault(fault, "publication", "E_PACKET3C_PUBLICATION");
    wrap("E_PACKET3C_PUBLICATION", `no-replace publication failed for ${name}`, () => linkSync(reference(parent.fd, temporaryName), reference(parent.fd, name)));
    published = true;
    publishedIdentity = fileMetadata(fd, `published ${name}`);
    const publishedEdge = lstatSync(reference(parent.fd, name), { bigint: true });
    if (!same(publishedEdge, publishedIdentity, FILE_IDENTITY)) fail("E_PACKET3C_PUBLICATION", `${name} publication edge differs from the retained file`);
    invokeFault(fault, "temp_unlink", "E_PACKET3C_TEMP_UNLINK");
    unlinkSync(reference(parent.fd, temporaryName));
    temporaryPresent = false;
    const final = fileMetadata(fd, `published ${name}`);
    if (final.nlink !== 1n || Number(final.mode & 0o7777n) !== mode) fail("E_PACKET3C_FILE_METADATA", `${name} final link count or mode differs`);
    invokeFault(fault, "destination_fsync", "E_PACKET3C_DESTINATION_FSYNC");
    fsyncSync(parent.fd);
    assertRetainedCapability(parent);
    closeSync(fd); fd = undefined;
    return { ...result, identity: final };
  } catch (error) {
    const cleanupErrors = [];
    if (published && publishedIdentity) removeFileIfIdentity(parent, name, publishedIdentity, cleanupErrors, fault);
    if (temporaryPresent && temporaryIdentity) removeFileIfIdentity(parent, temporaryName, temporaryIdentity, cleanupErrors, fault);
    closeQuietly(fd, cleanupErrors);
    try { fsyncSync(parent.fd); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    throw appendCleanupErrors(error, cleanupErrors);
  }
}

export function writeImmutableBufferAt(parent, name, bytes, options = {}) {
  return writeImmutableAt(parent, name, oneChunk(bytes), { ...options, maximumBytes: options.maximumBytes ?? bytes.length, expectedBytes: options.expectedBytes ?? bytes.length });
}

export function readRetainedFile(parent, name, expected) {
  assertRetainedCapability(parent);
  const fd = openSync(reference(parent.fd, name), OPEN_FILE_READ);
  try {
    const metadata = fileMetadata(fd, name);
    if (expected && !same(metadata, expected, FILE_IDENTITY)) fail("E_RETAINED_REPLACED", `${name} differs from its retained identity`);
    return { fd, metadata, path: reference(parent.fd, name) };
  } catch (error) { closeSync(fd); throw error; }
}

export function cleanupFiles(records, fault) {
  const cleanupErrors = [];
  for (const record of [...records].reverse()) removeFileIfIdentity(record.parent, record.name, record.identity, cleanupErrors, fault);
  for (const parent of new Set(records.map((record) => record.parent))) { try { fsyncSync(parent.fd); } catch (error) { cleanupErrors.push(error); } }
  return cleanupErrors;
}

export function cleanupDirectories(records, fault) {
  const cleanupErrors = [];
  for (const record of [...records].reverse()) removeDirectoryIfIdentity(record.parent, record.name, record.identity, cleanupErrors, fault);
  for (const parent of new Set(records.map((record) => record.parent))) { try { fsyncSync(parent.fd); } catch (error) { cleanupErrors.push(error); } }
  return cleanupErrors;
}

export function retainedPath(handle, name) {
  assertRetainedCapability(handle);
  return reference(handle.fd, name);
}
