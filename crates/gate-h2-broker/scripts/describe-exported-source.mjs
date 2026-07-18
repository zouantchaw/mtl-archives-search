import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [root, archive, output, commit, tree, allowlistPath] = process.argv.slice(2);
if (!root || !archive || !output || !allowlistPath || !/^[a-f0-9]{40}$/.test(commit ?? "") || !/^[a-f0-9]{40}$/.test(tree ?? "")) {
  throw new Error("invalid exported-source descriptor arguments");
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allowlistBytes = readFileSync(allowlistPath);
const allowlist = allowlistBytes.toString("utf8").trimEnd().split("\n").map((line) => {
  const match = /^(100644|100755) ([A-Za-z0-9._/-]+)$/.exec(line);
  if (!match) throw new Error("invalid source allowlist");
  return { mode: Number.parseInt(match[1].slice(-3), 8), path: match[2] };
});
if (!readFileSync(join(root, "crates/gate-h2-broker/oci/source-allowlist.v1.txt")).equals(allowlistBytes)) {
  throw new Error("exported source allowlist bytes differ from export authority");
}
const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error("sanitized source contains a non-regular member");
    }
    if (metadata.isDirectory()) visit(path);
    else files.push(relative(root, path));
  }
};
visit(root);
files.sort();
if (JSON.stringify(files) !== JSON.stringify(allowlist.map(({ path }) => path))) {
  throw new Error("exported source does not exactly match allowlist");
}
let byteCount = 0;
let manifest = "";
for (const [index, member] of files.entries()) {
  const metadata = lstatSync(join(root, member));
  const mode = metadata.mode & 0o7777;
  if (mode !== allowlist[index].mode) throw new Error(`exported source mode mismatch: ${member}`);
  const bytes = readFileSync(join(root, member));
  byteCount += bytes.length;
  manifest += `${member}\t${mode.toString(8).padStart(3, "0")}\t${bytes.length}\t${sha256(bytes)}\n`;
}
const descriptor = {
  schema_version: "gate_h2_sanitized_source_export_v1.0.0",
  source_commit: commit,
  source_tree: tree,
  source_allowlist_sha256: sha256(allowlistBytes),
  source_archive_sha256: sha256(readFileSync(archive)),
  source_manifest_sha256: sha256(Buffer.from(manifest)),
  source_file_count: files.length,
  source_byte_count: byteCount,
};
writeFileSync(output, `${JSON.stringify(descriptor)}\n`, { flag: "wx", mode: 0o400 });
