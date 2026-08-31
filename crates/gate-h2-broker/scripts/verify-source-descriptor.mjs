import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrictJson } from "./strict-json.mjs";

const script = dirname(fileURLToPath(import.meta.url));
const repository = resolve(script, "../../..");
const defaultDescriptor = join(repository, "docs/dataset-factory/fixtures/https-broker-runtime-v1/source-descriptor-v1.json");
const arguments_ = process.argv.slice(2);
let descriptorPath = defaultDescriptor;
let historicalCommit;

if (arguments_.length === 1 && !arguments_[0].startsWith("--")) {
  descriptorPath = resolve(arguments_[0]);
} else if (arguments_.length === 3 && !arguments_[0].startsWith("--") && arguments_[1] === "--git-commit" && /^[a-f0-9]{40}$/.test(arguments_[2])) {
  descriptorPath = resolve(arguments_[0]);
  historicalCommit = arguments_[2];
} else if (arguments_.length !== 0) {
  throw new Error("usage: verify-source-descriptor.mjs [<descriptor> | <descriptor> --git-commit <40-lowercase-hex>]");
}

const descriptor = parseStrictJson(readFileSync(descriptorPath));
if (descriptor.source_tree.algorithm !== "sha256" || descriptor.source_tree.scope !== "sorted_tree_manifest") {
  throw new Error("unsupported source descriptor digest definition");
}
if (typeof descriptor.source_root !== "string" || !/^[A-Za-z0-9._/-]+$/.test(descriptor.source_root) || descriptor.source_root.startsWith("/") || descriptor.source_root.includes("..") || descriptor.source_root.includes("//")) {
  throw new Error("unsafe source descriptor root");
}
const sourceRoot = descriptor.source_root.replace(/\/$/, "");
if (!sourceRoot) throw new Error("empty source descriptor root");

const members = [...descriptor.source_tree.members].sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
);
if (members.some((member, index) => {
  const keys = Object.keys(member).sort();
  return keys.join(",") !== "bytes,git_mode,path,sha256"
    || typeof member.path !== "string"
    || !/^[A-Za-z0-9._/-]+$/.test(member.path)
    || member.path.startsWith("/")
    || member.path.includes("..")
    || member.path.includes("//")
    || (index > 0 && members[index - 1].path === member.path)
    || !/^(100644|100755)$/.test(member.git_mode)
    || !/^[0-9a-f]{64}$/.test(member.sha256)
    || !Number.isSafeInteger(member.bytes)
    || member.bytes < 0;
})) {
  throw new Error("invalid structured source descriptor member");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedPaths = members.map(({ path }) => path);

function verifyMeasured(measured) {
  if (JSON.stringify(measured.map(({ path }) => path)) !== JSON.stringify(expectedPaths)) {
    throw new Error("source descriptor member set is stale");
  }
  let byteCount = 0;
  let manifest = "";
  for (const [index, entry] of measured.entries()) {
    const member = members[index];
    if (member.git_mode !== entry.gitMode || member.sha256 !== entry.sha256 || member.bytes !== entry.bytes) {
      throw new Error(`source descriptor member metadata is stale: ${member.path}`);
    }
    byteCount += entry.bytes;
    manifest += `${entry.path}\t${entry.gitMode}\t${entry.sha256}\t${entry.bytes}\n`;
  }
  const tree = sha256(Buffer.from(manifest));
  if (descriptor.source_tree.file_count !== measured.length) throw new Error("source descriptor file count is stale");
  if (descriptor.source_tree.byte_count !== byteCount) throw new Error("source descriptor byte count is stale");
  if (descriptor.source_tree.sha256 !== tree) throw new Error("source descriptor tree hash is stale");
  return tree;
}

function checkoutMembers() {
  const sourceRootAbsolute = resolve(repository, sourceRoot);
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", sourceRoot],
    { cwd: repository, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((path) => relative(sourceRootAbsolute, resolve(repository, path)).split("\\").join("/"))
    .sort();

  function gitMode(absolute) {
    const result = spawnSync(
      "git",
      ["diff", "--no-index", "--raw", "-z", "--", "/dev/null", absolute],
      { cwd: repository, encoding: "buffer" },
    );
    if (result.error || result.status !== 1 || result.stderr.length !== 0) {
      throw result.error ?? new Error(`could not read Git metadata for ${absolute}`);
    }
    const header = result.stdout.subarray(0, result.stdout.indexOf(0)).toString("ascii");
    const match = /^:000000 (100644|100755) [0-9a-f]+ [0-9a-f]+ A$/.exec(header);
    if (!match) throw new Error(`unsupported Git file metadata for ${absolute}`);
    return match[1];
  }

  return listed.map((path) => {
    const absolute = join(sourceRootAbsolute, path);
    const bytes = readFileSync(absolute);
    return { path, gitMode: gitMode(absolute), bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function historicalMembers(commit) {
  const resolved = execFileSync("git", ["rev-parse", "--verify", `${commit}^{commit}`], { cwd: repository, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(resolved) || resolved !== commit) throw new Error("historical commit did not resolve exactly");
  const entries = execFileSync("git", ["ls-tree", "-r", "-z", commit, "--", sourceRoot], { cwd: repository, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match) throw new Error("historical tree has an unsupported member");
      const [, gitMode, object, fullPath] = match;
      const path = posix.relative(sourceRoot, fullPath);
      if (!path || path.startsWith("../") || path.includes("..") || path.includes("//")) throw new Error("historical tree member escapes source root");
      const bytes = execFileSync("git", ["cat-file", "blob", object], { cwd: repository, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
      return { path, gitMode, bytes: bytes.length, sha256: sha256(bytes) };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (entries.some((entry, index) => index > 0 && entries[index - 1].path === entry.path)) throw new Error("historical tree has duplicate members");
  return entries;
}

process.stdout.write(`${verifyMeasured(historicalCommit ? historicalMembers(historicalCommit) : checkoutMembers())}\n`);
