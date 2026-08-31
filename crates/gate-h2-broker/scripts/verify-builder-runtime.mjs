import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { exactFields, parseStrictJson } from "./strict-json.mjs";
import { validateImageOwnedRuntimeMembers, validateMuslRuntimeContract, validateRuntimeClosure, validateRuntimeDirectory } from "./runtime-closure-core.mjs";

const [manifestPath, runtimeRoot, target, ...requiredPaths] = process.argv.slice(2);
if (!manifestPath || !runtimeRoot || target !== "x86_64-unknown-linux-musl" || requiredPaths.length === 0) throw new Error("runtime manifest, root, target, and required paths are required");
const root = resolve(runtimeRoot);
if (root !== "/opt/gate-h2" || resolve(manifestPath) !== "/opt/gate-h2/runtime-manifest.v1.json") throw new Error("runtime inventory must be the canonical builder inventory");
const regular = (file, label) => {
  const metadata = lstatSync(file, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.uid !== 0n || metadata.gid !== 0n) throw new Error(`${label} must be a root-owned single-link regular file`);
  return metadata;
};
const manifestMetadata = regular(manifestPath, "runtime manifest");
if (Number(manifestMetadata.mode & 0o7777n) !== 0o444) throw new Error("runtime manifest mode must be 0444");
const manifest = parseStrictJson(readFileSync(manifestPath));
exactFields(manifest, ["schema_version", "target", "entries"], "runtime manifest");
if (manifest.schema_version !== "gate_h2_builder_runtime_inventory_v1.0.0" || manifest.target !== target || !Array.isArray(manifest.entries) || manifest.entries.length === 0) throw new Error("invalid runtime manifest");
const declared = new Map();
for (const entry of manifest.entries) {
  exactFields(entry, ["path", "mode", "bytes", "sha256"], "runtime inventory entry");
  if (typeof entry.path !== "string" || !entry.path.startsWith(`${root}/`) || entry.path === manifestPath || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || ![0o444, 0o555].includes(entry.mode) || declared.has(entry.path)) throw new Error("invalid runtime inventory entry");
  declared.set(entry.path, entry);
}
const actual = [];
const visit = (directory) => {
  const metadata = lstatSync(directory, { bigint: true });
  validateRuntimeDirectory(root, directory, metadata);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else {
      if (file === manifestPath) continue;
      const fileMetadata = regular(file, `runtime entry ${file}`);
      actual.push(file);
      const declaredEntry = declared.get(file);
      if (!declaredEntry || Number(fileMetadata.mode & 0o7777n) !== declaredEntry.mode || Number(fileMetadata.size) !== declaredEntry.bytes || createHash("sha256").update(readFileSync(file)).digest("hex") !== declaredEntry.sha256) throw new Error(`runtime inventory mismatch: ${file}`);
    }
  }
};
visit(root);
if (JSON.stringify(actual.sort()) !== JSON.stringify([...declared.keys()].sort())) throw new Error("runtime inventory does not exactly enumerate /opt/gate-h2");
for (const required of requiredPaths) if (!declared.has(required)) throw new Error(`runtime inventory omits required path: ${required}`);
const ldd = "/opt/gate-h2/bin/ldd";
if (!declared.has(ldd)) throw new Error("runtime inventory omits canonical ldd");
validateImageOwnedRuntimeMembers(root, declared);
validateMuslRuntimeContract(root, declared);
validateRuntimeClosure(root, declared, ldd);
const targetMarker = "/rustlib/x86_64-unknown-linux-musl/";
if (![...declared.keys()].some((file) => file.includes(targetMarker))) throw new Error("runtime inventory omits the target sysroot");
process.stdout.write(`${createHash("sha256").update(readFileSync(manifestPath)).digest("hex")}\n`);
