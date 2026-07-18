import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_CANDIDATE_FILE_BYTES = 256 * 1024 * 1024;

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
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.geteuid() || (before.mode & 0o7777) !== expectedMode || before.size > cap) {
    throw new Error(`unsafe contained regular file: ${path}`);
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== process.geteuid() || (opened.mode & 0o7777) !== expectedMode || opened.size !== before.size || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > cap) {
      throw new Error(`candidate member changed or escaped containment: ${path}`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error(`short read: ${path}`);
      offset += count;
    }
    const after = fstatSync(fd);
    if (after.size !== opened.size || after.ino !== opened.ino || after.dev !== opened.dev) throw new Error(`candidate member changed while reading: ${path}`);
    return bytes;
  } finally { closeSync(fd); }
}
