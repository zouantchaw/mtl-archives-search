import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [exportedSource] = process.argv.slice(2);
if (!exportedSource) throw new Error("exported source is required");
const crate = join(exportedSource, "crates", "gate-h2-broker");
const lock = join(crate, "Cargo.lock");
for (const path of [crate, join(crate, "Cargo.toml"), lock]) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error(`trusted build input must not be a symlink: ${path}`);
}
if (!lstatSync(crate).isDirectory() || !lstatSync(join(crate, "Cargo.toml")).isFile() || !lstatSync(lock).isFile()) {
  throw new Error("exported gate-h2 crate or its exact Cargo.lock is missing");
}
process.stdout.write(`${createHash("sha256").update(readFileSync(lock)).digest("hex")}\n`);
