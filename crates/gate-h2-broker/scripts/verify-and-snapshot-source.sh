#!/usr/bin/env bash
set -euo pipefail
umask 077

SOURCE_ROOT="${1:?mounted source root required}"
DESCRIPTOR="${2:?source descriptor required}"
SNAPSHOT="${3:?empty measured snapshot required}"
shift 3
if [[ ! -e "$SNAPSHOT" && ! -L "$SNAPSHOT" ]]; then
  mkdir -m 0700 "$SNAPSHOT"
fi

MEASURED_SOURCE_MANIFEST_SHA256="$(node - "$SOURCE_ROOT" "$DESCRIPTOR" "$SNAPSHOT" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const [sourceRoot, descriptorPath, snapshotRoot] = process.argv.slice(2).map(path.resolve);
const ALLOWLIST = "crates/gate-h2-broker/oci/source-allowlist.v1.txt";
const MAX_FILES = 256;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };
const regularNoFollow = (file, label) => {
  const metadata = fs.lstatSync(file, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) fail(`${label} must be a single-link regular file`);
  return metadata;
};
const boundedRead = (file, expectedSize, label) => {
  if (expectedSize < 0 || expectedSize > MAX_FILE_BYTES) fail(`${label} exceeds the per-file bound`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expectedSize)) fail(`${label} identity/size changed before read`);
    const bytes = Buffer.alloc(expectedSize); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) fail(`${label} short read`); offset += count; }
    const extra = Buffer.alloc(1); if (fs.readSync(fd, extra, 0, 1, offset) !== 0) fail(`${label} grew during read`);
    const after = fs.fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) if (before[key] !== after[key]) fail(`${label} identity changed during read`);
    return bytes;
  } finally { fs.closeSync(fd); }
};
const enumerate = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name); const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) fail("source tree contains a non-regular member");
      if (metadata.isDirectory()) visit(absolute); else files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  visit(root); return files.sort();
};
for (const [directory, label] of [[sourceRoot, "mounted source"], [snapshotRoot, "snapshot"]]) {
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`${label} must be a real directory`);
}
if (fs.readdirSync(snapshotRoot).length !== 0) fail("snapshot directory must be empty");
regularNoFollow(descriptorPath, "source descriptor");
const descriptorBytes = boundedRead(descriptorPath, Number(fs.lstatSync(descriptorPath).size), "source descriptor");
const descriptor = JSON.parse(descriptorBytes);
if (descriptor.schema_version !== "gate_h2_sanitized_source_export_v1.0.0") fail("unsupported source descriptor");
const allowlistPath = path.join(sourceRoot, ALLOWLIST);
const allowlistMetadata = regularNoFollow(allowlistPath, "mounted allowlist");
const allowlistBytes = boundedRead(allowlistPath, Number(allowlistMetadata.size), "mounted allowlist");
if (sha256(allowlistBytes) !== descriptor.source_allowlist_sha256) fail("mounted allowlist digest mismatch");
const entries = allowlistBytes.toString("utf8").trimEnd().split("\n").map((line) => {
  const match = /^(100644|100755) ([A-Za-z0-9._/-]+)$/.exec(line);
  if (!match || match[2].startsWith("/") || match[2].includes("..") || match[2].includes("//")) fail("invalid mounted allowlist entry");
  return { mode: Number.parseInt(match[1].slice(-3), 8), path: match[2] };
});
if (entries.length < 1 || entries.length > MAX_FILES || entries.some((entry, index) => index > 0 && entries[index - 1].path >= entry.path)) fail("mounted allowlist must be sorted and bounded");
if (JSON.stringify(enumerate(sourceRoot)) !== JSON.stringify(entries.map(({ path }) => path))) fail("mounted source does not exactly match allowlist");
let byteCount = 0; let manifest = ""; const measured = [];
for (const entry of entries) {
  const absolute = path.join(sourceRoot, entry.path); const metadata = regularNoFollow(absolute, `mounted source member ${entry.path}`);
  const mode = Number(metadata.mode & 0o7777n); const size = Number(metadata.size);
  if (mode !== entry.mode) fail(`mounted source member mode mismatch: ${entry.path}`);
  byteCount += size; if (byteCount > MAX_SOURCE_BYTES) fail("mounted source aggregate bound exceeded");
  const bytes = boundedRead(absolute, size, `mounted source member ${entry.path}`); const digest = sha256(bytes);
  manifest += `${entry.path}\t${mode.toString(8).padStart(3, "0")}\t${size}\t${digest}\n`;
  measured.push({ ...entry, bytes });
}
if (descriptor.source_file_count !== entries.length || descriptor.source_byte_count !== byteCount || descriptor.source_manifest_sha256 !== sha256(Buffer.from(manifest))) fail("mounted source descriptor mismatch");
for (const entry of measured) {
  const output = path.join(snapshotRoot, entry.path); fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, entry.bytes, { flag: "wx", mode: entry.mode }); fs.chmodSync(output, entry.mode);
}
if (JSON.stringify(enumerate(snapshotRoot)) !== JSON.stringify(entries.map(({ path }) => path))) fail("measured snapshot member mismatch");
let snapshotManifest = "";
for (const entry of entries) {
  const absolute = path.join(snapshotRoot, entry.path); const metadata = regularNoFollow(absolute, `snapshot member ${entry.path}`);
  const mode = Number(metadata.mode & 0o7777n); const size = Number(metadata.size); const bytes = boundedRead(absolute, size, `snapshot member ${entry.path}`);
  snapshotManifest += `${entry.path}\t${mode.toString(8).padStart(3, "0")}\t${size}\t${sha256(bytes)}\n`;
}
if (snapshotManifest !== manifest) fail("measured snapshot differs from mounted source");
const lockDirectories = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) lockDirectories(path.join(directory, entry.name)); fs.chmodSync(directory, 0o555); };
lockDirectories(snapshotRoot);
process.stdout.write(`${descriptor.source_manifest_sha256}\n`);
NODE
)"

[[ "$#" -gt 0 ]] || exit 0
export GATE_H2_MEASURED_SOURCE="$SNAPSHOT"
export GATE_H2_MEASURED_SOURCE_MANIFEST_SHA256="$MEASURED_SOURCE_MANIFEST_SHA256"
exec "$@"
