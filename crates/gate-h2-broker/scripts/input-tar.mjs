const BLOCK_BYTES = 512;
const ZERO_BLOCKS_BYTES = BLOCK_BYTES * 2;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export const MAX_INPUT_TAR_ENTRIES = 131_072;
export const MAX_INPUT_TAR_EXTENSION_BYTES = 16 * 1024 * 1024;
export const MAX_INPUT_TAR_SINGLE_EXTENSION_BYTES = 1024 * 1024;

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function isZeroBlock(bytes, offset) {
  for (let index = offset; index < offset + BLOCK_BYTES; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function decodeUtf8(bytes, label) {
  try {
    return UTF8.decode(bytes);
  } catch {
    fail(label, "field is not valid UTF-8");
  }
}

function readTextField(header, offset, length, label) {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  const end = nul === -1 ? field.length : nul;
  if (nul !== -1) {
    for (let index = nul + 1; index < field.length; index += 1) {
      if (field[index] !== 0) fail(label, "contains nonzero bytes after its NUL terminator");
    }
  }
  return decodeUtf8(field.subarray(0, end), label);
}

function parseBase256(field, label, maximum) {
  if ((field[0] & 0x40) !== 0) fail(label, "negative base-256 values are not supported");
  let value = BigInt(field[0] & 0x3f);
  for (let index = 1; index < field.length; index += 1) {
    value = (value << 8n) | BigInt(field[index]);
  }
  if (value > MAX_SAFE_INTEGER_BIGINT || value > BigInt(maximum)) {
    fail(label, `value exceeds ${maximum}`);
  }
  return Number(value);
}

function parseTarNumber(field, label, maximum = Number.MAX_SAFE_INTEGER) {
  if ((field[0] & 0x80) !== 0) return parseBase256(field, label, maximum);

  let start = 0;
  while (start < field.length && (field[start] === 0 || field[start] === 0x20)) start += 1;
  let end = field.length;
  while (end > start && (field[end - 1] === 0 || field[end - 1] === 0x20)) end -= 1;
  if (start === end) return 0;

  let value = 0;
  for (let index = start; index < end; index += 1) {
    const byte = field[index];
    if (byte < 0x30 || byte > 0x37) fail(label, "is not a valid nonnegative octal value");
    value = value * 8 + (byte - 0x30);
    if (!Number.isSafeInteger(value) || value > maximum) fail(label, `value exceeds ${maximum}`);
  }
  return value;
}

function verifyHeaderChecksum(header, label) {
  const recorded = parseTarNumber(header.subarray(148, 156), `${label} checksum`, 512 * 0xff);
  let computed = 0;
  for (let index = 0; index < header.length; index += 1) {
    computed += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (recorded !== computed) fail(label, `checksum mismatch: expected ${recorded}, computed ${computed}`);
}

function verifyFormat(header, label) {
  const magic = header.subarray(257, 263);
  const version = header.subarray(263, 265);
  const posix = magic.equals(Buffer.from("ustar\0", "ascii")) && version.equals(Buffer.from("00", "ascii"));
  const gnu = magic.equals(Buffer.from("ustar ", "ascii")) && version.equals(Buffer.from([0x20, 0]));
  if (!posix && !gnu) fail(label, "is not a supported POSIX ustar, GNU tar, or PAX header");
}

function normalizeMemberPath(value, type, label) {
  if (!value || value.includes("\0")) fail(label, "member name is empty or contains NUL");
  if (value.includes("\\")) fail(label, "member name contains a backslash");
  if (value.startsWith("/")) fail(label, "member name is absolute");
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) fail(label, "member name contains a control character");
  }

  let normalized = value;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (type === "directory") normalized = normalized.replace(/\/+$/u, "");
  else if (normalized.endsWith("/")) fail(label, "non-directory member name ends with a slash");

  if (normalized === "" && type === "directory") return "";
  const components = normalized.split("/");
  if (components.some((component) => component === "" || component === "." || component === "..")) {
    fail(label, "member name contains an empty, dot, or traversal component");
  }
  return components.join("/");
}

function parseDecimal(value, label, maximum) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail(label, "is not a canonical nonnegative decimal integer");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed > BigInt(maximum)) fail(label, `exceeds ${maximum}`);
  return Number(parsed);
}

function parsePaxRecords(bytes, label) {
  if (bytes.length > MAX_INPUT_TAR_SINGLE_EXTENSION_BYTES) {
    fail(label, `PAX body exceeds ${MAX_INPUT_TAR_SINGLE_EXTENSION_BYTES} bytes`);
  }
  const records = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) fail(label, "PAX record has no length separator");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(lengthText)) fail(label, "PAX record length is malformed");
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length <= space - offset + 2) fail(label, "PAX record length is invalid");
    const end = offset + length;
    if (end > bytes.length || bytes[end - 1] !== 0x0a) fail(label, "PAX record length or terminator is invalid");
    const payload = bytes.subarray(space + 1, end - 1);
    const equals = payload.indexOf(0x3d);
    if (equals <= 0) fail(label, "PAX record has no key/value separator");
    const key = payload.subarray(0, equals).toString("ascii");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(key)) fail(label, `PAX key ${JSON.stringify(key)} is invalid`);
    if (records.has(key)) fail(label, `PAX key ${JSON.stringify(key)} is duplicated`);
    const value = decodeUtf8(payload.subarray(equals + 1), `${label} ${key}`);
    if (value.includes("\0")) fail(label, `PAX value ${JSON.stringify(key)} contains NUL`);
    if (key.startsWith("GNU.sparse.")) fail(label, "GNU sparse PAX records are not supported");
    records.set(key, value);
    offset = end;
  }
  return records;
}

function parseGnuLongValue(bytes, label) {
  if (bytes.length === 0 || bytes.length > MAX_INPUT_TAR_SINGLE_EXTENSION_BYTES) {
    fail(label, "GNU long-name body has an invalid length");
  }
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x0a)) end -= 1;
  if (end === bytes.length) fail(label, "GNU long-name body has no terminator");
  for (let index = 0; index < end; index += 1) {
    if (bytes[index] === 0 || bytes[index] === 0x0a) fail(label, "GNU long-name body has an ambiguous embedded terminator");
  }
  for (let index = end; index < bytes.length; index += 1) {
    if (bytes[index] !== 0 && bytes[index] !== 0x0a) fail(label, "GNU long-name body has ambiguous trailing bytes");
  }
  return decodeUtf8(bytes.subarray(0, end), label);
}

function classifyType(typeFlag, label) {
  if (typeFlag === 0 || typeFlag === 0x30) return "file";
  const types = new Map([
    [0x31, "hardlink"],
    [0x32, "symlink"],
    [0x33, "character"],
    [0x34, "block"],
    [0x35, "directory"],
    [0x36, "fifo"],
    [0x37, "contiguous"],
  ]);
  const type = types.get(typeFlag);
  if (!type) fail(label, `unsupported tar typeflag 0x${typeFlag.toString(16).padStart(2, "0")}`);
  return type;
}

function effectiveEntrySize(headerSize, pax, label, maximum) {
  if (!pax?.has("size")) return headerSize;
  return parseDecimal(pax.get("size"), `${label} PAX size`, maximum);
}

function extensionStatePresent(state) {
  return state.pax !== null || state.longName !== null || state.longLink !== null;
}

export function parseInputTar(bytes, label = "input tar", options = {}) {
  if (!Buffer.isBuffer(bytes)) fail(label, "input is not a Buffer");
  const maximumBytes = options.maximumBytes ?? Number.MAX_SAFE_INTEGER;
  const maximumEntries = options.maximumEntries ?? MAX_INPUT_TAR_ENTRIES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < ZERO_BLOCKS_BYTES) fail(label, "maximumBytes is invalid");
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > MAX_INPUT_TAR_ENTRIES) {
    fail(label, `maximumEntries must be between 1 and ${MAX_INPUT_TAR_ENTRIES}`);
  }
  if (bytes.length > maximumBytes) fail(label, `archive exceeds ${maximumBytes} bytes`);
  if (bytes.length < ZERO_BLOCKS_BYTES || bytes.length % BLOCK_BYTES !== 0) {
    fail(label, "archive length is not a complete tar block sequence");
  }

  const entries = [];
  const resolvedNames = new Set();
  const globalPax = new Map();
  const state = { pax: null, longName: null, longLink: null };
  let extensionBytes = 0;
  let headerCount = 0;
  let offset = 0;
  let terminated = false;

  while (offset < bytes.length) {
    if (isZeroBlock(bytes, offset)) {
      if (offset + ZERO_BLOCKS_BYTES > bytes.length || !isZeroBlock(bytes, offset + BLOCK_BYTES)) {
        fail(label, "archive has an incomplete two-block terminator");
      }
      if (extensionStatePresent(state)) fail(label, "archive terminates with an unconsumed PAX/GNU extension");
      for (let index = offset + ZERO_BLOCKS_BYTES; index < bytes.length; index += 1) {
        if (bytes[index] !== 0) fail(label, "archive contains nonzero data after its terminator");
      }
      terminated = true;
      break;
    }

    headerCount += 1;
    if (headerCount > maximumEntries) fail(label, `archive exceeds ${maximumEntries} headers`);
    const headerLabel = `${label} header ${headerCount}`;
    const header = bytes.subarray(offset, offset + BLOCK_BYTES);
    verifyHeaderChecksum(header, headerLabel);
    verifyFormat(header, headerLabel);

    const headerName = readTextField(header, 0, 100, `${headerLabel} name`);
    const prefix = readTextField(header, 345, 155, `${headerLabel} prefix`);
    const linkName = readTextField(header, 157, 100, `${headerLabel} linkname`);
    parseTarNumber(header.subarray(100, 108), `${headerLabel} mode`);
    parseTarNumber(header.subarray(108, 116), `${headerLabel} uid`);
    parseTarNumber(header.subarray(116, 124), `${headerLabel} gid`);
    const headerSize = parseTarNumber(header.subarray(124, 136), `${headerLabel} size`, maximumBytes);
    parseTarNumber(header.subarray(136, 148), `${headerLabel} mtime`);
    parseTarNumber(header.subarray(329, 337), `${headerLabel} device major`);
    parseTarNumber(header.subarray(337, 345), `${headerLabel} device minor`);

    const typeFlag = header[156];
    const extensionType = typeFlag === 0x78 || typeFlag === 0x67 || typeFlag === 0x4c || typeFlag === 0x4b;
    if ((typeFlag === 0x78 && state.pax !== null) || (typeFlag === 0x4c && state.longName !== null) || (typeFlag === 0x4b && state.longLink !== null) || (typeFlag === 0x67 && extensionStatePresent(state))) {
      fail(headerLabel, "PAX/GNU extension state is duplicated or ambiguous");
    }

    const paxForEntry = extensionType ? null : state.pax;
    const size = extensionType ? headerSize : effectiveEntrySize(headerSize, paxForEntry, headerLabel, maximumBytes);
    const dataOffset = offset + BLOCK_BYTES;
    const dataEnd = dataOffset + size;
    const paddedEnd = dataOffset + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
    if (!Number.isSafeInteger(dataEnd) || paddedEnd > bytes.length) fail(headerLabel, "member body exceeds archive bounds");
    for (let index = dataEnd; index < paddedEnd; index += 1) {
      if (bytes[index] !== 0) fail(headerLabel, "member padding is not zero-filled");
    }
    const body = bytes.subarray(dataOffset, dataEnd);

    if (extensionType) {
      extensionBytes += size;
      if (extensionBytes > MAX_INPUT_TAR_EXTENSION_BYTES) {
        fail(label, `extension bodies exceed ${MAX_INPUT_TAR_EXTENSION_BYTES} bytes`);
      }
      if (typeFlag === 0x78) state.pax = parsePaxRecords(body, `${headerLabel} PAX`);
      else if (typeFlag === 0x67) {
        const records = parsePaxRecords(body, `${headerLabel} global PAX`);
        if (records.has("path") || records.has("linkpath") || records.has("size")) {
          fail(headerLabel, "global PAX path, linkpath, and size records are ambiguous and unsupported");
        }
        for (const [key, value] of records) globalPax.set(key, value);
      } else if (typeFlag === 0x4c) state.longName = parseGnuLongValue(body, `${headerLabel} GNU long name`);
      else state.longLink = parseGnuLongValue(body, `${headerLabel} GNU long link`);
      offset = paddedEnd;
      continue;
    }

    const paxPath = state.pax?.get("path") ?? null;
    const paxLink = state.pax?.get("linkpath") ?? null;
    if (paxPath !== null && state.longName !== null) fail(headerLabel, "PAX and GNU both override the member path");
    if (paxLink !== null && state.longLink !== null) fail(headerLabel, "PAX and GNU both override the link path");
    for (const [key, value] of globalPax) {
      if (state.pax?.has(key)) continue;
      if (key === "path" || key === "linkpath" || key === "size") fail(headerLabel, "ambiguous global PAX path state");
      void value;
    }

    const type = classifyType(typeFlag, headerLabel);
    const joinedHeaderName = prefix ? `${prefix}/${headerName}` : headerName;
    const resolvedName = normalizeMemberPath(paxPath ?? state.longName ?? joinedHeaderName, type, `${headerLabel} resolved name`);
    const resolvedLink = paxLink ?? state.longLink ?? linkName;
    if (type !== "file" && type !== "contiguous" && size !== 0) {
      fail(headerLabel, `${type} member has a nonzero body`);
    }
    if (["hardlink", "symlink"].includes(type)) {
      if (!resolvedLink || resolvedLink.includes("\0")) fail(headerLabel, `${type} member has no unambiguous link target`);
    } else if (resolvedLink !== "") {
      fail(headerLabel, `${type} member unexpectedly declares a link target`);
    }
    if (resolvedNames.has(resolvedName)) fail(headerLabel, `duplicate resolved member ${JSON.stringify(resolvedName)}`);
    resolvedNames.add(resolvedName);
    entries.push({
      name: resolvedName,
      type,
      size,
      bytes: body,
      linkname: resolvedLink,
    });

    state.pax = null;
    state.longName = null;
    state.longLink = null;
    offset = paddedEnd;
  }

  if (!terminated) fail(label, "archive has no two-block terminator");
  return entries;
}
