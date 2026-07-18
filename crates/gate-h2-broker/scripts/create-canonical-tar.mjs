import { closeSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK = 512;
function walk(entries, path, relative = "") {
  for (const name of readdirSync(path).sort()) {
    const child = join(path, name); const childRelative = relative ? `${relative}/${name}` : name; const metadata = lstatSync(child);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) throw new Error(`canonical tar rejects non-regular member: ${childRelative}`);
    entries.push({ name: `./${childRelative}${metadata.isDirectory() ? "/" : ""}`, path: child, directory: metadata.isDirectory() });
    if (metadata.isDirectory()) walk(entries, child, childRelative);
  }
}
const putOctal = (header, offset, length, value) => header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");

export function writeAll(fd, buffer, offset, length, write = writeSync) {
  let completed = 0;
  while (completed < length) {
    const remaining = length - completed;
    const progress = write(fd, buffer, offset + completed, remaining);
    if (!Number.isSafeInteger(progress) || progress <= 0 || progress > remaining) {
      throw new Error(`canonical tar write made invalid progress: ${String(progress)} for ${remaining} remaining bytes`);
    }
    completed += progress;
  }
  return completed;
}

export function createCanonicalTar(source, output, write = writeSync) {
  const entries = [{ name: "./", path: source, directory: true }];
  walk(entries, source);
  const fd = openSync(output, "wx", 0o444);
  let failure;
  let written = 0;
  try {
    for (const entry of entries) {
      if (Buffer.byteLength(entry.name) >= 100) throw new Error(`canonical tar name is too long: ${entry.name}`);
      const metadata = lstatSync(entry.path); const bytes = entry.directory ? Buffer.alloc(0) : readFileSync(entry.path); const header = Buffer.alloc(BLOCK);
      header.write(entry.name, 0, 100, "ascii"); putOctal(header, 100, 8, metadata.mode & 0o7777); putOctal(header, 108, 8, 0); putOctal(header, 116, 8, 0); putOctal(header, 124, 12, bytes.length); putOctal(header, 136, 12, 0);
      header.fill(0x20, 148, 156); header[156] = entry.directory ? 0x35 : 0x30; header.write("ustar\0", 257, 6, "latin1"); header.write("00", 263, 2, "ascii"); putOctal(header, 329, 8, 0); putOctal(header, 337, 8, 0);
      let checksum = 0; for (const byte of header) checksum += byte; header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "latin1");
      written += writeAll(fd, header, 0, header.length, write);
      if (bytes.length) {
        written += writeAll(fd, bytes, 0, bytes.length, write);
        const padding = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
        if (padding) written += writeAll(fd, Buffer.alloc(padding), 0, padding, write);
      }
    }
    written += writeAll(fd, Buffer.alloc(BLOCK * 2), 0, BLOCK * 2, write);
    const recordPadding = (10240 - (written % 10240)) % 10240;
    if (recordPadding) written += writeAll(fd, Buffer.alloc(recordPadding), 0, recordPadding, write);
  } catch (error) {
    failure = error;
  }
  try {
    closeSync(fd);
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], "canonical tar generation and close failed") : error;
  }
  if (failure) {
    try {
      unlinkSync(output);
    } catch (error) {
      failure = new AggregateError([failure, error], "canonical tar generation and cleanup failed");
    }
    throw failure;
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error("canonical tar source and output are required");
  createCanonicalTar(source, output);
}
