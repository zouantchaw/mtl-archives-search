const BLOCK = 512;
const ZERO = Buffer.alloc(BLOCK);

function exactString(block, start, length, label) {
  const raw = block.subarray(start, start + length);
  const nul = raw.indexOf(0);
  if (nul < 0 || raw.subarray(nul).some((byte) => byte !== 0)) throw new Error(`noncanonical tar ${label}`);
  const used = raw.subarray(0, nul);
  if (used.some((byte) => byte < 0x20 || byte > 0x7e)) throw new Error(`invalid tar ${label}`);
  return used.toString("ascii");
}

function exactOctal(block, start, length, label) {
  const raw = block.subarray(start, start + length);
  if (raw[0] & 0x80) throw new Error(`base-256 tar ${label} forbidden`);
  if (raw[length - 1] !== 0 || raw.subarray(0, length - 1).some((byte) => byte < 0x30 || byte > 0x37)) throw new Error(`noncanonical tar ${label}`);
  const value = Number.parseInt(raw.subarray(0, length - 1).toString("ascii"), 8);
  if (!Number.isSafeInteger(value)) throw new Error(`unsafe tar ${label}`);
  return value;
}

function canonicalHeader(block, label) {
  if (!block.subarray(257, 263).equals(Buffer.from("ustar\0")) || !block.subarray(263, 265).equals(Buffer.from("00"))) throw new Error(`${label} requires exact POSIX ustar magic`);
  if (block.subarray(500, 512).some((byte) => byte !== 0)) throw new Error(`${label} has nonzero reserved header bytes`);
  const name = exactString(block, 0, 100, "name");
  if (!name || name.startsWith("/") || name.split("/").includes("..")) throw new Error(`${label} has unsafe member name`);
  const mode = exactOctal(block, 100, 8, "mode");
  const uid = exactOctal(block, 108, 8, "uid");
  const gid = exactOctal(block, 116, 8, "gid");
  const size = exactOctal(block, 124, 12, "size");
  const mtime = exactOctal(block, 136, 12, "mtime");
  const checksumRaw = block.subarray(148, 156);
  if (!/^[0-7]{6}\0 $/.test(checksumRaw.toString("latin1"))) throw new Error(`noncanonical tar checksum encoding`);
  const storedChecksum = Number.parseInt(checksumRaw.subarray(0, 6).toString("ascii"), 8);
  let checksum = 0;
  for (let index = 0; index < BLOCK; index += 1) checksum += index >= 148 && index < 156 ? 0x20 : block[index];
  if (checksum !== storedChecksum) throw new Error(`${label} header checksum mismatch`);
  const typeByte = block[156];
  if (typeByte !== 0x30 && typeByte !== 0x35) throw new Error(`${label} has forbidden or noncanonical entry type ${typeByte}`);
  const type = typeByte === 0x30 ? "file" : "directory";
  const linkname = exactString(block, 157, 100, "linkname");
  const uname = exactString(block, 265, 32, "uname");
  const gname = exactString(block, 297, 32, "gname");
  const devmajor = exactOctal(block, 329, 8, "devmajor");
  const devminor = exactOctal(block, 337, 8, "devminor");
  const prefix = exactString(block, 345, 155, "prefix");
  if (linkname || uname || gname || prefix || uid !== 0 || gid !== 0 || mtime !== 0 || devmajor !== 0 || devminor !== 0 || mode > 0o7777 || (type === "directory" && size !== 0)) throw new Error(`${label} entry metadata mismatch: ${name}`);
  return { name, type, size, mode, uid, gid, mtime, linkname, uname, gname };
}

export function parseStrictTar(bytes, label, cap) {
  if (!Number.isSafeInteger(cap) || cap < 10240 || bytes.length > cap || bytes.length % 10240 !== 0) throw new Error(`${label} size is invalid`);
  const entries = [];
  let offset = 0;
  let ended = false;
  while (offset + BLOCK <= bytes.length) {
    const block = bytes.subarray(offset, offset + BLOCK);
    if (block.equals(ZERO)) {
      if (offset + 2 * BLOCK > bytes.length || !bytes.subarray(offset + BLOCK, offset + 2 * BLOCK).equals(ZERO)) throw new Error(`${label} lacks two zero terminators`);
      const canonicalLength = Math.ceil((offset + 2 * BLOCK) / 10240) * 10240;
      if (bytes.length !== canonicalLength) throw new Error(`${label} has noncanonical trailing blocks`);
      if (bytes.subarray(offset).some((byte) => byte !== 0)) throw new Error(`${label} has data after terminator`);
      ended = true;
      break;
    }
    const entry = canonicalHeader(block, label);
    const dataStart = offset + BLOCK;
    const padded = Math.ceil(entry.size / BLOCK) * BLOCK;
    if (dataStart + padded > bytes.length) throw new Error(`${label} entry exceeds archive: ${entry.name}`);
    entry.bytes = bytes.subarray(dataStart, dataStart + entry.size);
    if (bytes.subarray(dataStart + entry.size, dataStart + padded).some((byte) => byte !== 0)) throw new Error(`${label} has nonzero entry padding: ${entry.name}`);
    entries.push(entry);
    offset = dataStart + padded;
  }
  if (!ended) throw new Error(`${label} is unterminated`);
  const names = entries.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error(`${label} contains duplicate members`);
  return entries;
}

export function requireEntrySet(entries, expected, label) {
  const actual = entries.map(({ name }) => name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} exact member sequence mismatch`);
}
