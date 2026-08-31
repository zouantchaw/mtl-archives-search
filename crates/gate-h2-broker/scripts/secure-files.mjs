import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, chmodSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const MAX_CANDIDATE_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_SECURE_TREE_DIRECTORY_DEPTH = 16;
export const MAX_SECURE_TREE_OPEN_DESCRIPTORS = MAX_SECURE_TREE_DIRECTORY_DEPTH + 2;
const OPEN_DIRECTORY = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0) | (constants.O_CLOEXEC ?? 0);
const OPEN_FILE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_CLOEXEC ?? 0);

function descriptorPath(fd) {
  if (process.platform === "linux") return `/proc/self/fd/${fd}`;
  throw new Error("descriptor-anchored traversal is unsupported on this host");
}

function metadataIdentity(metadata) { return [metadata.dev, metadata.ino, metadata.mode, metadata.uid, metadata.gid, metadata.nlink, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(":"); }

function sameMetadata(left, right) { return metadataIdentity(left) === metadataIdentity(right); }

function safeComponent(name) { return typeof name === "string" && name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") && !name.includes("\0"); }

function anchoredPath(directoryFd, name) { return join(descriptorPath(directoryFd), name); }

function checkedDirectory(directoryFd, path, expectedMode, label, requireOwner = true) {
  const metadata = fstatSync(directoryFd, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (requireOwner && metadata.uid !== BigInt(process.geteuid())) || (expectedMode !== undefined && Number(metadata.mode & 0o7777n) !== expectedMode)) throw new Error(`unsafe ${label}: ${path}`);
  return metadata;
}

function openDirectory(directory, name, expectedMode, label, requireOwner = true) {
  const candidate = anchoredPath(directory.fd, name);
  const before = lstatSync(candidate, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error(`unsafe ${label}: ${name}`);
  const fd = openSync(candidate, OPEN_DIRECTORY);
  try {
    const opened = checkedDirectory(fd, candidate, expectedMode, label, requireOwner);
    if (!sameMetadata(before, opened)) throw new Error(`directory binding changed: ${name}`);
    return { fd, path: join(directory.path, name), parent: directory, name, identity: opened };
  } catch (error) { closeSync(fd); throw error; }
}

function openFile(directory, name, expectedMode, expectedBytes, cap) {
  const candidate = anchoredPath(directory.fd, name);
  const before = lstatSync(candidate, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== BigInt(process.geteuid()) || (expectedMode !== undefined && Number(before.mode & 0o7777n) !== expectedMode) || (expectedBytes !== undefined && before.size !== BigInt(expectedBytes)) || before.size > BigInt(cap)) { const error = new Error(`unsafe contained regular file: ${candidate}`); if (expectedBytes !== undefined && before.size !== BigInt(expectedBytes)) error.code = "E_TREE_SIZE"; throw error; }
  const fd = openSync(candidate, OPEN_FILE);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.isSymbolicLink() || opened.nlink !== 1n || opened.uid !== BigInt(process.geteuid()) || (expectedMode !== undefined && Number(opened.mode & 0o7777n) !== expectedMode) || (expectedBytes !== undefined && opened.size !== BigInt(expectedBytes)) || !sameMetadata(before, opened) || opened.size > BigInt(cap)) throw new Error(`candidate member changed or escaped containment: ${candidate}`);
    return { fd, path: candidate, parent: directory, name, identity: opened, cap };
  } catch (error) { closeSync(fd); throw error; }
}

function readDescriptor(file) {
  const bytes = Buffer.alloc(Number(file.identity.size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(file.fd, bytes, offset, bytes.length - offset, offset);
    if (count === 0) throw new Error(`short read: ${file.path}`);
    offset += count;
  }
  return bytes;
}

function digestDescriptor(file) {
  const hash = createHash("sha256"), chunk = Buffer.alloc(Math.min(1024 * 1024, Number(file.identity.size)) || 1);
  let offset = 0;
  while (offset < Number(file.identity.size)) {
    const wanted = Math.min(chunk.length, Number(file.identity.size) - offset);
    const count = readSync(file.fd, chunk, 0, wanted, offset);
    if (count === 0) throw new Error(`short read: ${file.path}`);
    hash.update(chunk.subarray(0, count));
    offset += count;
  }
  return { bytes: Number(file.identity.size), sha256: hash.digest("hex") };
}

function assertFileBinding(file) {
  const before = fstatSync(file.fd, { bigint: true });
  const pathname = lstatSync(anchoredPath(file.parent.fd, file.name), { bigint: true });
  if (!sameMetadata(before, file.identity) || !sameMetadata(pathname, file.identity)) throw new Error(`candidate member changed while reading: ${file.path}`);
}

function assertDirectoryBinding(directory) {
  const current = fstatSync(directory.fd, { bigint: true });
  if (!sameMetadata(current, directory.identity)) throw new Error(`directory changed while reading: ${directory.path}`);
  if (directory.parent) {
    const pathname = lstatSync(anchoredPath(directory.parent.fd, directory.name), { bigint: true });
    if (!sameMetadata(pathname, directory.identity)) throw new Error(`directory binding changed: ${directory.path}`);
  }
}

export function requireSecureTreePlatform(platform = process.platform) {
  if (platform === "linux") return;
  const error = new Error("descriptor-anchored tree verification requires Linux /proc");
  error.code = "E_TREE_UNSUPPORTED";
  throw error;
}

function openAbsoluteDirectory(path, expectedMode) {
  requireSecureTreePlatform();
  const absolute = resolve(path);
  const components = absolute.split("/").filter(Boolean);
  if (components.length === 0) throw new Error("tree root may not be the filesystem root");
  const rootFd = openSync("/", OPEN_DIRECTORY);
  let current = { fd: rootFd, path: "/", parent: null, name: null, identity: checkedDirectory(rootFd, "/", undefined, "filesystem root", false) };
  const chain = [{ name: null, path: "/", identity: current.identity }];
  try {
    for (const [index, name] of components.entries()) {
      if (!safeComponent(name)) throw new Error(`unsafe absolute path component: ${name}`);
      const target = index === components.length - 1;
      const child = openDirectory(current, name, target ? expectedMode : undefined, target ? "tree root" : "tree ancestor", target);
      chain.push({ name, path: child.path, identity: child.identity });
      closeSync(current.fd);
      child.parent = null;
      current = child;
    }
    return { root: current, chain };
  } catch (error) {
    closeSync(current.fd);
    throw error;
  }
}

function verifyAbsoluteDirectoryChain(chain, retainedRoot, expectedMode) {
  let current = { fd: openSync("/", OPEN_DIRECTORY), path: "/", parent: null, name: null };
  try {
    current.identity = checkedDirectory(current.fd, "/", undefined, "filesystem root", false);
    if (!sameMetadata(current.identity, chain[0].identity)) throw new Error("filesystem root changed while reading secure tree");
    for (let index = 1; index < chain.length; index += 1) {
      const expected = chain[index], target = index === chain.length - 1;
      const child = openDirectory(current, expected.name, target ? expectedMode : undefined, target ? "tree root" : "tree ancestor", target);
      if (!sameMetadata(child.identity, expected.identity)) { closeSync(child.fd); throw new Error(`absolute directory changed while reading: ${expected.path}`); }
      closeSync(current.fd);
      child.parent = null;
      current = child;
    }
    if (!sameMetadata(current.identity, retainedRoot.identity) || !sameMetadata(fstatSync(retainedRoot.fd, { bigint: true }), retainedRoot.identity)) throw new Error(`tree root changed while reading: ${retainedRoot.path}`);
  } finally { closeSync(current.fd); }
}

function expectedDirectorySet(expectedFiles) {
  const directories = new Set(["."]);
  for (const member of expectedFiles.keys()) {
    if (typeof member !== "string" || member.startsWith("/") || member.includes("\\") || member.includes("\0")) { const error = new Error(`unsafe expected tree member: ${member}`); error.code = "E_TREE_PATH"; throw error; }
    const parts = member.split("/");
    if (parts.length === 0 || !parts.every(safeComponent)) { const error = new Error(`unsafe expected tree member: ${member}`); error.code = "E_TREE_PATH"; throw error; }
    const directoryDepth = parts.length - 1;
    if (directoryDepth > MAX_SECURE_TREE_DIRECTORY_DEPTH) { const error = new Error(`secure tree member exceeds ${MAX_SECURE_TREE_DIRECTORY_DEPTH} parent directories: ${member}`); error.code = "E_TREE_FD_BUDGET"; throw error; }
    parts.pop();
    while (parts.length) { directories.add(parts.join("/")); parts.pop(); }
  }
  return directories;
}

function scanSecureTree(rootDirectory, expectedFiles, expectedDirectories, directoryMode) {
  const directories = new Map([[".", rootDirectory.identity]]), files = new Map();
  const visit = (directory, relativePath) => {
    assertDirectoryBinding(directory);
    const entries = readdirSync(descriptorPath(directory.fd), { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (!safeComponent(entry.name)) throw new Error(`unsafe directory entry: ${relativePath}`);
      const member = relativePath === "." ? entry.name : `${relativePath}/${entry.name}`;
      const status = lstatSync(anchoredPath(directory.fd, entry.name), { bigint: true });
      if (status.isDirectory()) {
        if (!expectedDirectories.has(member)) { const error = new Error(`contained tree has an extra directory: ${member}`); error.code = "E_TREE_EXTRA"; throw error; }
        const child = openDirectory(directory, entry.name, directoryMode, "contained directory");
        directories.set(member, child.identity);
        try { visit(child, member); } finally { closeSync(child.fd); }
      } else {
        if (!expectedFiles.has(member)) { const error = new Error(`contained tree has an extra file: ${member}`); error.code = "E_TREE_EXTRA"; throw error; }
        files.set(member, status);
      }
    }
    assertDirectoryBinding(directory);
  };
  visit(rootDirectory, ".");
  if ([...expectedDirectories].some((member) => !directories.has(member))) { const error = new Error("contained tree directory is missing"); error.code = "E_TREE_MISSING"; throw error; }
  if (directories.size !== expectedDirectories.size) { const error = new Error("contained tree has an extra directory"); error.code = "E_TREE_EXTRA"; throw error; }
  if ([...expectedFiles.keys()].some((member) => !files.has(member))) { const error = new Error("contained tree file is missing"); error.code = "E_TREE_MISSING"; throw error; }
  if (files.size !== expectedFiles.size) { const error = new Error("contained tree has an extra file"); error.code = "E_TREE_EXTRA"; throw error; }
  return { directories, files };
}

function compareTreeSnapshots(before, after) {
  for (const [member, identity] of before.directories) if (!sameMetadata(identity, after.directories.get(member))) throw new Error(`contained directory changed while reading: ${member}`);
  for (const [member, identity] of before.files) if (!sameMetadata(identity, after.files.get(member))) throw new Error(`contained file changed while reading: ${member}`);
}

function openRecordedParent(rootDirectory, member, directoryIdentities, directoryMode) {
  const parts = member.split("/"), name = parts.pop(), opened = [];
  let current = rootDirectory, relativePath = "";
  try {
    for (const part of parts) {
      relativePath = relativePath ? `${relativePath}/${part}` : part;
      const child = openDirectory(current, part, directoryMode, "contained directory");
      if (!sameMetadata(child.identity, directoryIdentities.get(relativePath))) { closeSync(child.fd); throw new Error(`contained directory changed before reading: ${relativePath}`); }
      opened.push(child);
      current = child;
    }
    return { directory: current, name, opened };
  } catch (error) {
    for (const directory of opened.reverse()) closeSync(directory.fd);
    throw error;
  }
}

export function visitSecureTree(rootPath, expectedFiles, visitor, { rootMode, directoryMode = 0o755 } = {}) {
  requireSecureTreePlatform();
  if (!(expectedFiles instanceof Map) || typeof visitor !== "function") throw new Error("secure tree visitor requires expected files and a callback");
  const expectedDirectories = expectedDirectorySet(expectedFiles);
  const { root: rootDirectory, chain } = openAbsoluteDirectory(rootPath, rootMode);
  try {
    const initial = scanSecureTree(rootDirectory, expectedFiles, expectedDirectories, directoryMode);
    verifyAbsoluteDirectoryChain(chain, rootDirectory, rootMode);
    const members = [...expectedFiles.keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    for (const member of members) {
      const expected = expectedFiles.get(member), location = openRecordedParent(rootDirectory, member, initial.directories, directoryMode);
      let file;
      try {
        file = openFile(location.directory, location.name, expected.mode, expected.bytes, expected.cap ?? expected.bytes);
        if (!sameMetadata(initial.files.get(member), file.identity)) throw new Error(`candidate member changed before reading: ${member}`);
        const result = expected.readMode === "digest" ? { ...digestDescriptor(file), buffer: null } : (() => { const buffer = readDescriptor(file); return { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), buffer }; })();
        assertFileBinding(file);
        if (result.bytes !== expected.bytes) { const error = new Error(`contained file size differs: ${member}`); error.code = "E_TREE_SIZE"; throw error; }
        const returned = visitor(member, result, expected);
        if (returned && typeof returned.then === "function") throw new Error("secure tree visitor must be synchronous");
        assertFileBinding(file);
        assertDirectoryBinding(location.directory);
        for (const directory of [...location.opened].reverse()) assertDirectoryBinding(directory);
        assertDirectoryBinding(rootDirectory);
      } finally {
        if (file) closeSync(file.fd);
        for (const directory of location.opened.reverse()) closeSync(directory.fd);
      }
    }
    const final = scanSecureTree(rootDirectory, expectedFiles, expectedDirectories, directoryMode);
    compareTreeSnapshots(initial, final);
    verifyAbsoluteDirectoryChain(chain, rootDirectory, rootMode);
    return { file_count: initial.files.size, directory_count: initial.directories.size };
  } finally { closeSync(rootDirectory.fd); }
}

export function readSecureTree(rootPath, expectedFiles, options) {
  const bytes = new Map();
  visitSecureTree(rootPath, expectedFiles, (member, result) => bytes.set(member, result.buffer), options);
  return bytes;
}

export function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function validateOwnedDirectory(path, mode) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.geteuid() || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o7777) !== mode) {
    throw new Error(`unsafe directory: ${path}`);
  }
}

export function createDurableDirectory(path, mode) {
  const parent = dirname(path);
  validateOwnedDirectory(parent, lstatSync(parent).mode & 0o7777);
  mkdirSync(path, { mode });
  chmodSync(path, mode);
  validateOwnedDirectory(path, mode);
  syncDirectory(parent);
}

export function readContainedRegular(path, expectedMode, cap = MAX_CANDIDATE_FILE_BYTES) {
  const absolute = resolve(path), directory = dirname(absolute), name = absolute.slice(directory.length + 1);
  if (process.platform !== "linux") {
    const before = lstatSync(absolute, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== BigInt(process.geteuid()) || Number(before.mode & 0o7777n) !== expectedMode || before.size > BigInt(cap)) throw new Error(`unsafe contained regular file: ${absolute}`);
    const fd = openSync(absolute, OPEN_FILE);
    try {
      const opened = fstatSync(fd, { bigint: true });
      if (!sameMetadata(before, opened)) throw new Error(`candidate member changed or escaped containment: ${absolute}`);
      const file = { fd, path: absolute, identity: opened };
      const bytes = readDescriptor(file);
      if (!sameMetadata(fstatSync(fd, { bigint: true }), opened) || !sameMetadata(lstatSync(absolute, { bigint: true }), opened)) throw new Error(`candidate member changed while reading: ${absolute}`);
      return bytes;
    } finally { closeSync(fd); }
  }
  const { root: directoryHandle, chain } = openAbsoluteDirectory(directory, undefined);
  let file;
  try {
    file = openFile(directoryHandle, name, expectedMode, undefined, cap);
    const bytes = readDescriptor(file);
    assertFileBinding(file);
    assertDirectoryBinding(directoryHandle);
    verifyAbsoluteDirectoryChain(chain, directoryHandle, undefined);
    return bytes;
  } finally {
    if (file) closeSync(file.fd);
    closeSync(directoryHandle.fd);
  }
}
