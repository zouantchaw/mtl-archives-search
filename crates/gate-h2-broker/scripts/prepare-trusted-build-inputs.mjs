import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [exportedSource, expectedSbom] = process.argv.slice(2);
if (!exportedSource || !expectedSbom) throw new Error("exported source and expected SBOM output are required");
const crate = join(exportedSource, "crates", "gate-h2-broker");
const lock = join(crate, "Cargo.lock");
for (const path of [crate, join(crate, "Cargo.toml"), lock]) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error(`trusted build input must not be a symlink: ${path}`);
}
if (!lstatSync(crate).isDirectory() || !lstatSync(join(crate, "Cargo.toml")).isFile() || !lstatSync(lock).isFile()) {
  throw new Error("exported gate-h2 crate or its exact Cargo.lock is missing");
}
const scripts = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(scripts, "generate-trusted-sbom.mjs"), crate, expectedSbom], { stdio: ["ignore", "inherit", "inherit"] });
process.stdout.write(`${createHash("sha256").update(readFileSync(lock)).digest("hex")}\n`);
