import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalTar, writeAll } from "./create-canonical-tar.mjs";

const BLOCK = 512;
const putString = (header, offset, length, value) => header.write(value, offset, Math.min(length, Buffer.byteLength(value)), "ascii");
const putOctal = (header, offset, length, value) => putString(header, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");

export function tarBytes(entries) {
  const blocks = [];
  for (const item of entries) {
    const bytes = Buffer.from(item.bytes ?? "");
    const header = Buffer.alloc(BLOCK);
    putString(header, 0, 100, item.name);
    putOctal(header, 100, 8, item.mode);
    putOctal(header, 108, 8, item.uid ?? 0);
    putOctal(header, 116, 8, item.gid ?? 0);
    putOctal(header, 124, 12, item.type === "5" ? 0 : bytes.length);
    putOctal(header, 136, 12, item.mtime ?? 0);
    header.fill(0x20, 148, 156);
    header[156] = Buffer.from(item.type ?? "0")[0];
    putString(header, 157, 100, item.linkname ?? "");
    putString(header, 257, 6, "ustar\0");
    putString(header, 263, 2, "00");
    putString(header, 265, 32, item.uname ?? "");
    putString(header, 297, 32, item.gname ?? "");
    putOctal(header, 329, 8, item.devmajor ?? 0);
    putOctal(header, 337, 8, item.devminor ?? 0);
    let checksum = 0; for (const byte of header) checksum += byte;
    putString(header, 148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(header);
    if (item.type !== "5") blocks.push(bytes, Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  const result = Buffer.concat(blocks);
  return Buffer.concat([result, Buffer.alloc((10240 - (result.length % 10240)) % 10240)]);
}

export function writeTar(path, entries) { writeFileSync(path, tarBytes(entries)); }

function shortWriterAt(targetStart, targetEnd) {
  let archiveOffset = 0;
  return (fd, buffer, offset, length) => {
    const inTarget = archiveOffset >= targetStart && archiveOffset < targetEnd;
    const progress = inTarget ? Math.min(7, length) : length;
    const actual = writeSync(fd, buffer, offset, progress);
    archiveOffset += actual;
    return actual;
  };
}

function failingWriterAt(target, progress) {
  let archiveOffset = 0;
  return (fd, buffer, offset, length) => {
    if (archiveOffset === target) return typeof progress === "function" ? progress(length) : progress;
    const actual = writeSync(fd, buffer, offset, length);
    archiveOffset += actual;
    return actual;
  };
}

function runCanonicalWriterTests() {
  const root = mkdtempSync(join(tmpdir(), "gate-h2-canonical-tar-test-"));
  try {
    const source = join(root, "source"); mkdirSync(source, 0o755);
    const body = Buffer.from("repeated short progress\n"); const member = join(source, "member"); writeFileSync(member, body, { mode: 0o644 });
    const normal = join(root, "normal.tar");
    if (createCanonicalTar(source, normal) !== 10240) throw new Error("canonical tar writer reported the wrong archive size");
    const expected = tarBytes([
      { name: "./", type: "5", mode: statSync(source).mode & 0o7777 },
      { name: "./member", type: "0", mode: statSync(member).mode & 0o7777, bytes: body },
    ]);
    const normalBytes = readFileSync(normal);
    if (!normalBytes.equals(expected)) throw new Error("canonical tar writer bytes changed from the canonical fixture");

    const regions = {
      header: [0, BLOCK],
      body: [BLOCK * 2, BLOCK * 2 + body.length],
      "member-padding": [BLOCK * 2 + body.length, BLOCK * 3],
      "final-padding": [BLOCK * 5, expected.length],
    };
    for (const [label, [start, end]] of Object.entries(regions)) {
      const output = join(root, `short-${label}.tar`);
      if (createCanonicalTar(source, output, shortWriterAt(start, end)) !== expected.length) throw new Error(`${label} short writes reported the wrong archive size`);
      if (!readFileSync(output).equals(normalBytes)) throw new Error(`${label} short writes changed canonical bytes`);
    }

    const failures = {
      header: [0, 0],
      body: [BLOCK * 2, -1],
      "member-padding": [BLOCK * 2 + body.length, 1.5],
      "final-padding": [BLOCK * 5, (remaining) => remaining + 1],
    };
    for (const [label, [target, progress]] of Object.entries(failures)) {
      const output = join(root, `failed-${label}.tar`);
      let rejected = false;
      try { createCanonicalTar(source, output, failingWriterAt(target, progress)); } catch (error) { rejected = /invalid progress/.test(error.message); }
      if (!rejected) throw new Error(`${label} invalid write progress was not rejected`);
      try { readFileSync(output); throw new Error(`${label} failure left a successfully named archive`); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }

    for (const progress of [Number.NaN, undefined, null, "1", Number.MAX_SAFE_INTEGER + 1]) {
      let rejected = false;
      try { writeAll(1, Buffer.alloc(1), 0, 1, () => progress); } catch (error) { rejected = /invalid progress/.test(error.message); }
      if (!rejected) throw new Error(`writeAll accepted invalid progress ${String(progress)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write("canonical tar short-write tests passed\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCanonicalWriterTests();
