import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = dirname(fileURLToPath(import.meta.url));
const repository = resolve(script, "../../..");
const descriptorPath = resolve(
  process.argv[2] ?? join(repository, "docs/dataset-factory/fixtures/https-broker-runtime-v1/source-descriptor-v1.json"),
);
const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
if (descriptor.source_tree.algorithm !== "sha256" || descriptor.source_tree.scope !== "sorted_tree_manifest") {
  throw new Error("unsupported source descriptor digest definition");
}
const sourceRoot = resolve(repository, descriptor.source_root);
const listed = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", descriptor.source_root],
  { cwd: repository, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((path) => relative(sourceRoot, resolve(repository, path)))
  .sort();
const members = [...descriptor.source_tree.members].sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
);
if (members.some((member) => {
  const keys = Object.keys(member).sort();
  return keys.join(",") !== "bytes,git_mode,path,sha256"
    || typeof member.path !== "string"
    || !/^(100644|100755)$/.test(member.git_mode)
    || !/^[0-9a-f]{64}$/.test(member.sha256)
    || !Number.isSafeInteger(member.bytes)
    || member.bytes < 0;
})) {
  throw new Error("invalid structured source descriptor member");
}
if (JSON.stringify(members.map(({ path }) => path)) !== JSON.stringify(listed)) {
  throw new Error("source descriptor member set is stale");
}

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

let byteCount = 0;
let manifest = "";
for (const member of members) {
  const absolute = join(sourceRoot, member.path);
  const bytes = readFileSync(absolute);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const mode = gitMode(absolute);
  if (member.git_mode !== mode || member.sha256 !== digest || member.bytes !== bytes.length) {
    throw new Error(`source descriptor member metadata is stale: ${member.path}`);
  }
  byteCount += bytes.length;
  manifest += `${member.path}\t${mode}\t${digest}\t${bytes.length}\n`;
}
const tree = createHash("sha256").update(manifest).digest("hex");
if (descriptor.source_tree.file_count !== listed.length) throw new Error("source descriptor file count is stale");
if (descriptor.source_tree.byte_count !== byteCount) throw new Error("source descriptor byte count is stale");
if (descriptor.source_tree.sha256 !== tree) throw new Error("source descriptor tree hash is stale");
process.stdout.write(`${tree}\n`);
