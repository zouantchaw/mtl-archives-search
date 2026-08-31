import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const arguments_ = process.argv.slice(2);
const separator = arguments_.indexOf("--");
if (separator < 8 || arguments_.slice(0, separator).length !== 8 || separator === arguments_.length - 1) throw new Error("usage: verify-source-proof-core.mjs <source> <descriptor> <archive> <bundle> <snapshot> <git> <tar> <setpriv> -- <inner> [args...]");
const [sourceArgument, descriptorArgument, archiveArgument, bundleArgument, snapshotArgument, git, tar, setpriv] = arguments_.slice(0, separator);
const inner = arguments_.slice(separator + 1);
for (const [label, executable] of [["Git", git], ["tar", tar], ["setpriv", setpriv]]) {
  const metadata = lstatSync(executable, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111n) === 0n || !resolve(executable).startsWith("/")) throw new Error(`${label} executable is not a regular absolute executable`);
}
const sourceRoot = resolve(sourceArgument), descriptorPath = resolve(descriptorArgument), archivePath = resolve(archiveArgument), bundlePath = resolve(bundleArgument), snapshotRoot = resolve(snapshotArgument);
const fail = (message) => { throw new Error(message); };
const gitEnvironment = { PATH: "/opt/gate-h2/bin", HOME: "/nonexistent", LC_ALL: "C", TZ: "UTC", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedDescriptorSha256 = process.env.GATE_H2_SOURCE_DESCRIPTOR_SHA256;
if (!/^[a-f0-9]{64}$/.test(expectedDescriptorSha256 ?? "")) fail("expected source-descriptor digest is missing or malformed");
const MAX_FILES = 256, MAX_FILE_BYTES = 16 * 1024 * 1024, MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const exactFields = (value, fields, label) => {
  if (!value || Array.isArray(value) || typeof value !== "object" || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(`${label} fields differ`);
};
const parseStrictJson = (bytes) => {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail("JSON BOM forbidden");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); let index = 0;
  const ws = () => { while (/[\t\n\r ]/.test(source[index] ?? "")) index += 1; };
  const string = () => { const start = index++; let escaped = false; while (index < source.length) { const code = source.charCodeAt(index); if (!escaped && code === 0x22) { index += 1; return JSON.parse(source.slice(start, index)); } if (!escaped && code < 0x20) fail("unescaped JSON control"); escaped = !escaped && code === 0x5c; index += 1; } fail("unterminated JSON string"); };
  const value = () => { ws(); if (source[index] === "{") { index += 1; const output = Object.create(null), keys = new Set(); ws(); if (source[index] === "}") { index += 1; return output; } while (true) { ws(); if (source[index] !== '"') fail("JSON object key required"); const key = string(); if (keys.has(key)) fail(`duplicate JSON field: ${key}`); keys.add(key); ws(); if (source[index++] !== ":") fail("JSON colon required"); output[key] = value(); ws(); const delimiter = source[index++]; if (delimiter === "}") return output; if (delimiter !== ",") fail("JSON object delimiter required"); } } if (source[index] === "[") { index += 1; const output = []; ws(); if (source[index] === "]") { index += 1; return output; } while (true) { output.push(value()); ws(); const delimiter = source[index++]; if (delimiter === "]") return output; if (delimiter !== ",") fail("JSON array delimiter required"); } } if (source[index] === '"') return string(); for (const [token, output] of [["true", true], ["false", false], ["null", null]]) if (source.startsWith(token, index)) { index += token.length; return output; } const match = /^-?(?:0|[1-9][0-9]*)/.exec(source.slice(index)); if (!match || /[.eE]/.test(source[index + match[0].length] ?? "")) fail("invalid JSON number"); index += match[0].length; const output = Number(match[0]); if (!Number.isSafeInteger(output) || Object.is(output, -0)) fail("unsafe JSON integer"); return output; };
  const output = value(); ws(); if (index !== source.length) fail("trailing JSON content"); return output;
};
const regular = (file, label) => { const metadata = lstatSync(file, { bigint: true }); if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) fail(`${label} must be a single-link regular file`); return metadata; };
const boundedRead = (file, expectedSize, label) => {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_FILE_BYTES) fail(`${label} exceeds bound`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true }); if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expectedSize)) fail(`${label} changed before read`);
    const bytes = Buffer.alloc(expectedSize); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) fail(`${label} short read`); offset += count; }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) fail(`${label} grew during read`);
    const after = fstatSync(fd, { bigint: true }); for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) if (before[key] !== after[key]) fail(`${label} changed during read`);
    return bytes;
  } finally { closeSync(fd); }
};
const enumerate = (root) => {
  const output = []; const visit = (directory) => {
    const metadata = lstatSync(directory); if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("source tree contains an unsafe directory");
    for (const entry of readdirSync(directory, { withFileTypes: true })) { const absolute = join(directory, entry.name), metadata = lstatSync(absolute); if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) fail("source tree contains a non-regular member"); if (metadata.isDirectory()) visit(absolute); else output.push(relative(root, absolute).split(sep).join("/")); }
  }; visit(root); return output.sort();
};
const descriptorMetadata = regular(descriptorPath, "source descriptor");
const descriptorBytes = boundedRead(descriptorPath, Number(descriptorMetadata.size), "source descriptor");
if (sha256(descriptorBytes) !== expectedDescriptorSha256) fail("mounted source descriptor differs from retained staging receipt");
const descriptor = parseStrictJson(descriptorBytes);
exactFields(descriptor, ["schema_version", "source_commit", "source_tree", "source_allowlist_sha256", "source_archive_sha256", "source_manifest_sha256", "source_file_count", "source_byte_count"], "source descriptor");
if (descriptor.schema_version !== "gate_h2_sanitized_source_export_v1.0.0" || !/^[a-f0-9]{40}$/.test(descriptor.source_commit) || !/^[a-f0-9]{40}$/.test(descriptor.source_tree) || !/^[a-f0-9]{64}$/.test(descriptor.source_allowlist_sha256) || !/^[a-f0-9]{64}$/.test(descriptor.source_archive_sha256) || !/^[a-f0-9]{64}$/.test(descriptor.source_manifest_sha256) || !Number.isSafeInteger(descriptor.source_file_count) || !Number.isSafeInteger(descriptor.source_byte_count) || descriptor.source_file_count < 1 || descriptor.source_byte_count < 1) fail("invalid source descriptor proof claims");
for (const [path, label] of [[sourceRoot, "mounted source"], [archivePath, "source archive"], [bundlePath, "source Git bundle"]]) if ((label === "mounted source" ? !lstatSync(path).isDirectory() : !regular(path, label))) fail(`${label} is unsafe`);
if (lstatSync(sourceRoot).isSymbolicLink() || lstatSync(snapshotRoot, { throwIfNoEntry: false })) fail("mounted source must be real and snapshot must not pre-exist");
const temporary = mkdtempSync("/tmp/gate-h2-source-proof-");
let childResult;
try {
  const repository = join(temporary, "repository"), allowlistPath = join(temporary, "source-allowlist.v1.txt"), archiveRoot = join(temporary, "archive-source");
  execFileSync(git, ["clone", "--no-checkout", bundlePath, repository], { stdio: "ignore", env: gitEnvironment });
  if (execFileSync(git, ["-C", repository, "rev-parse", `${descriptor.source_commit}^{commit}`], { encoding: "utf8", env: gitEnvironment }).trim() !== descriptor.source_commit) fail("source commit is not proven by supplied Git bundle");
  if (execFileSync(git, ["-C", repository, "rev-parse", `${descriptor.source_commit}^{tree}`], { encoding: "utf8", env: gitEnvironment }).trim() !== descriptor.source_tree) fail("source tree is not proven by supplied Git bundle");
  writeFileSync(allowlistPath, execFileSync(git, ["-C", repository, "cat-file", "blob", `${descriptor.source_commit}:crates/gate-h2-broker/oci/source-allowlist.v1.txt`], { env: gitEnvironment }));
  const entries = readFileSync(allowlistPath, "utf8").trimEnd().split("\n").map((line) => { const match = /^(100644|100755) ([A-Za-z0-9._/-]+)$/.exec(line); if (!match || match[2].startsWith("/") || match[2].includes("..") || match[2].includes("//")) fail("proven source allowlist is invalid"); return { mode: Number.parseInt(match[1].slice(-3), 8), path: match[2] }; });
  if (!entries.length || entries.some((entry, index) => index && entries[index - 1].path >= entry.path)) fail("proven source allowlist is unsorted");
  if (sha256(boundedRead(archivePath, Number(regular(archivePath, "source archive").size), "source archive")) !== descriptor.source_archive_sha256) fail("source archive digest differs from descriptor");
  mkdirSync(archiveRoot, { mode: 0o700 }); execFileSync(tar, ["-xf", archivePath, "-C", archiveRoot]);
  if (JSON.stringify(enumerate(sourceRoot)) !== JSON.stringify(entries.map(({ path }) => path)) || JSON.stringify(enumerate(archiveRoot)) !== JSON.stringify(entries.map(({ path }) => path))) fail("source member set differs from proven allowlist");
  const allowlist = join(sourceRoot, "crates/gate-h2-broker/oci/source-allowlist.v1.txt");
  if (sha256(boundedRead(allowlist, Number(regular(allowlist, "mounted allowlist").size), "mounted allowlist")) !== descriptor.source_allowlist_sha256) fail("mounted allowlist digest mismatch");
  let bytes = 0, manifest = ""; const measured = [];
  for (const entry of entries) {
    const treeEntry = execFileSync(git, ["-C", repository, "ls-tree", descriptor.source_commit, "--", entry.path], { encoding: "utf8", env: gitEnvironment }).trimEnd();
    const gitMode = entry.mode === 0o755 ? "100755" : "100644";
    const expectedTreeEntry = new RegExp(`^${gitMode} blob [a-f0-9]{40}\\t${entry.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    if (!expectedTreeEntry.test(treeEntry)) fail(`exact Git tree mode or type differs: ${entry.path}`);
    const blobBytes = execFileSync(git, ["-C", repository, "cat-file", "blob", `${descriptor.source_commit}:${entry.path}`], { maxBuffer: MAX_FILE_BYTES + 1, env: gitEnvironment });
    if (blobBytes.length > MAX_FILE_BYTES) fail(`exact Git blob exceeds bound: ${entry.path}`);
    const member = join(sourceRoot, entry.path), metadata = regular(member, `mounted source member ${entry.path}`), mode = Number(metadata.mode & 0o7777n), size = Number(metadata.size), memberBytes = boundedRead(member, size, `mounted source member ${entry.path}`), archiveMember = join(archiveRoot, entry.path), archiveMetadata = regular(archiveMember, `source archive member ${entry.path}`), archiveMemberBytes = boundedRead(archiveMember, Number(archiveMetadata.size), `source archive member ${entry.path}`);
    if (mode !== entry.mode || Number(archiveMetadata.mode & 0o7777n) !== entry.mode || !memberBytes.equals(blobBytes) || !archiveMemberBytes.equals(blobBytes)) fail(`mounted or archived source differs from exact Git blob: ${entry.path}`);
    bytes += size; if (bytes > MAX_SOURCE_BYTES) fail("source aggregate bound exceeded"); const digest = sha256(memberBytes); manifest += `${entry.path}\t${mode.toString(8).padStart(3, "0")}\t${size}\t${digest}\n`; measured.push({ ...entry, bytes: memberBytes });
  }
  if (descriptor.source_file_count !== entries.length || descriptor.source_byte_count !== bytes || descriptor.source_manifest_sha256 !== sha256(Buffer.from(manifest))) fail("mounted source descriptor mismatch");
  const sealMode = (mode) => mode === 0o755 ? 0o555 : 0o444;
  const remeasureSnapshot = () => {
    const verifyDirectories = (directory) => { const metadata = lstatSync(directory); if (!metadata.isDirectory() || metadata.isSymbolicLink() || Number(metadata.mode & 0o7777) !== 0o555) fail(`snapshot directory seal mode changed: ${directory}`); for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) verifyDirectories(join(directory, entry.name)); };
    verifyDirectories(snapshotRoot);
    if (JSON.stringify(enumerate(snapshotRoot)) !== JSON.stringify(entries.map(({ path }) => path))) fail("measured snapshot member set changed");
    let snapshotManifest = "";
    for (const entry of entries) {
      const member = join(snapshotRoot, entry.path), metadata = regular(member, `snapshot member ${entry.path}`), mode = Number(metadata.mode & 0o7777n), size = Number(metadata.size), memberBytes = boundedRead(member, size, `snapshot member ${entry.path}`);
      if (mode !== sealMode(entry.mode)) fail(`snapshot member seal mode changed: ${entry.path}`);
      snapshotManifest += `${entry.path}\t${entry.mode.toString(8).padStart(3, "0")}\t${size}\t${sha256(memberBytes)}\n`;
    }
    if (snapshotManifest !== manifest) fail("measured snapshot differs from original source manifest");
  };
  const lockDirectories = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) lockDirectories(join(directory, entry.name)); chmodSync(directory, 0o555); };
  mkdirSync(snapshotRoot, { mode: 0o700 }); for (const entry of measured) { const output = join(snapshotRoot, entry.path); mkdirSync(resolve(output, ".."), { recursive: true, mode: 0o700 }); writeFileSync(output, entry.bytes, { flag: "wx", mode: entry.mode }); chmodSync(output, sealMode(entry.mode)); }
  lockDirectories(snapshotRoot); remeasureSnapshot();
  const environment = { ...process.env, GATE_H2_MEASURED_SOURCE: snapshotRoot, GATE_H2_MEASURED_SOURCE_MANIFEST_SHA256: descriptor.source_manifest_sha256, GATE_H2_SOURCE_COMMIT: descriptor.source_commit, GATE_H2_SOURCE_TREE: descriptor.source_tree, GATE_H2_SOURCE_ALLOWLIST_SHA256: descriptor.source_allowlist_sha256, GATE_H2_SOURCE_ARCHIVE_SHA256: descriptor.source_archive_sha256, GATE_H2_SOURCE_FILE_COUNT: String(descriptor.source_file_count), GATE_H2_SOURCE_BYTE_COUNT: String(descriptor.source_byte_count) };
  childResult = spawnSync(setpriv, ["--reuid", "65532", "--regid", "65532", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", inner[0], ...inner.slice(1)], { stdio: "inherit", env: environment });
  if (childResult.error) throw childResult.error;
  // This catches persistent mutation; the reviewed image remains trusted against a root child restoring exact bytes and modes before exit.
  if (childResult.status === 0) remeasureSnapshot();
} finally { rmSync(temporary, { recursive: true, force: true }); }
if (childResult?.signal) process.kill(process.pid, childResult.signal);
process.exit(childResult?.status ?? 1);
