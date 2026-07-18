import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { exactFields, parseStrictJson } from "./strict-json.mjs";

const HELPER_NAMES = ["gate-h2-publish-noreplace", "gate-h2-secure-candidate-read"];
const MANIFEST_CAP = 16 * 1024;
const helpers = new Map();
let configured = false;

const allowedEnvironment = () => ({ LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" });

function readExactCapped(path, cap) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  try {
    const metadata = fstatSync(fd, { bigint: true });
    if (!metadata.isFile() || metadata.uid !== BigInt(process.geteuid()) || metadata.nlink !== 1n || (metadata.mode & 0o7777n) !== 0o444n || metadata.size < 1n || metadata.size > BigInt(cap)) throw new Error("helper manifest metadata/size rejected before read");
    const bytes = Buffer.alloc(Number(metadata.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("helper manifest short read");
      offset += count;
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function digestFd(fd, size) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (count === 0) throw new Error("reviewed helper short read");
    hash.update(buffer.subarray(0, count));
    offset += count;
  }
  return hash.digest("hex");
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function sameObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && left.mtimeNs === right.mtimeNs;
}

export function configureVerifiedHelpers(directory, manifestPath, expectedManifestSha256, expectedSourceManifestSha256, expectedBuilderImageDigest) {
  if (configured) throw new Error("verified helpers already configured");
  if (![expectedManifestSha256, expectedSourceManifestSha256, expectedBuilderImageDigest].every((value) => /^[a-f0-9]{64}$/.test(value ?? ""))) throw new Error("invalid independently expected helper identity");
  const directoryMetadata = lstatSync(directory, { bigint: true });
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink() || directoryMetadata.uid !== BigInt(process.geteuid()) || (directoryMetadata.mode & 0o7777n) !== 0o700n) throw new Error("unsafe host-helper directory");
  const expectedMembers = ["helper-manifest.v1.json", ...HELPER_NAMES.flatMap((name) => [name, `${name}.pass-1`, `${name}.pass-2`])].sort();
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expectedMembers)) throw new Error("host-helper directory member set mismatch");
  const manifestBytes = readExactCapped(manifestPath, MANIFEST_CAP);
  if (createHash("sha256").update(manifestBytes).digest("hex") !== expectedManifestSha256) throw new Error("host helper manifest digest mismatch");
  const manifest = parseStrictJson(manifestBytes);
  exactFields(manifest, ["schema_version", "source_manifest_sha256", "builder_image_digest", "helpers"], "host helper manifest");
  if (manifest.schema_version !== "gate_h2_host_helper_manifest_v1.0.0" || manifest.source_manifest_sha256 !== expectedSourceManifestSha256 || manifest.builder_image_digest !== expectedBuilderImageDigest || !Array.isArray(manifest.helpers) || manifest.helpers.length !== HELPER_NAMES.length) throw new Error("host helper manifest authority mismatch");
  for (const [index, name] of HELPER_NAMES.entries()) {
    const entry = manifest.helpers[index];
    exactFields(entry, ["name", "bytes", "mode", "pass_1_sha256", "pass_2_sha256", "sha256"], `host helper ${index}`);
    if (entry.name !== name || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.mode !== 0o555 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "") || entry.pass_1_sha256 !== entry.sha256 || entry.pass_2_sha256 !== entry.sha256) throw new Error("host helper independent-build identity mismatch");
    for (const [pass, expected] of [["pass-1", entry.pass_1_sha256], ["pass-2", entry.pass_2_sha256]]) {
      const passFd = openSync(join(directory, `${name}.${pass}`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
      try {
        const passMetadata = fstatSync(passFd, { bigint: true });
        if (!passMetadata.isFile() || passMetadata.uid !== BigInt(process.geteuid()) || passMetadata.nlink !== 1n || (passMetadata.mode & 0o7777n) !== 0o444n || passMetadata.size !== BigInt(entry.bytes) || digestFd(passFd, entry.bytes) !== expected) throw new Error("independent helper build artifact mismatch");
      } finally {
        closeSync(passFd);
      }
    }
    const path = join(directory, name);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
    try {
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.uid !== BigInt(process.geteuid()) || before.nlink !== 1n || (before.mode & 0o7777n) !== 0o555n || before.size !== BigInt(entry.bytes) || digestFd(fd, entry.bytes) !== entry.sha256) throw new Error("reviewed helper ownership/type/link/mode/digest verification failed");
      const after = fstatSync(fd, { bigint: true });
      if (!sameIdentity(before, after)) throw new Error("reviewed helper changed during verification");
      let retained = after;
      if (process.platform === "linux") {
        unlinkSync(path);
        retained = fstatSync(fd, { bigint: true });
        if (!sameObject(after, retained) || retained.nlink !== 0n || (retained.mode & 0o7777n) !== 0o555n || digestFd(fd, entry.bytes) !== entry.sha256) throw new Error("reviewed helper unlink transition changed verified content");
      }
      helpers.set(name, { fd, identity: retained, sha256: entry.sha256, linux: process.platform === "linux", path });
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  configured = true;
}

function checkedHelper(binary) {
  const helper = helpers.get(binary);
  if (!configured || !helper) throw new Error("reviewed helper manifest was not configured");
  const before = fstatSync(helper.fd, { bigint: true });
  const links = helper.linux ? 0n : 1n;
  if (!sameIdentity(before, helper.identity) || before.nlink !== links || !before.isFile() || before.uid !== BigInt(process.geteuid()) || (before.mode & 0o7777n) !== 0o555n || digestFd(helper.fd, Number(before.size)) !== helper.sha256) throw new Error("retained reviewed helper verification failed");
  return helper;
}

process.once("exit", () => {
  for (const helper of helpers.values()) closeSync(helper.fd);
  helpers.clear();
});

export function runVerifiedHelper(binary, args, { maxBuffer = 1024 * 1024, inheritedFds = [] } = {}) {
  if (!HELPER_NAMES.includes(binary)) throw new Error("unreviewed helper requested");
  const helper = checkedHelper(binary);
  const executable = helper.linux ? "/proc/self/fd/3" : helper.path;
  const stdio = helper.linux ? ["ignore", "pipe", "pipe", helper.fd, ...inheritedFds] : ["ignore", "pipe", "pipe", "ignore", ...inheritedFds];
  const result = spawnSync(executable, args, { env: allowedEnvironment(), stdio, maxBuffer });
  checkedHelper(binary);
  if (result.status !== 0) throw new Error(`verified helper ${helper.sha256} failed: ${result.error?.message ?? result.stderr?.toString().trim() ?? "unknown execution error"}`);
  return { stdout: result.stdout, stderr: result.stderr, sha256: helper.sha256 };
}
