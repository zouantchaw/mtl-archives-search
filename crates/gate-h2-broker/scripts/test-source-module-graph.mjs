import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const crate = resolve(scripts, "..");
const repository = resolve(crate, "..", "..");
const allowlist = readFileSync(join(crate, "oci", "source-allowlist.v1.txt"), "utf8").trimEnd().split("\n").map((line) => line.slice(7));
const allowed = new Set(allowlist);
const entries = allowlist.filter((path) => path.endsWith(".mjs"));
const visited = new Set();
const imports = /(?:import|export)\s+(?:[^"']+?\s+from\s+)?["'](\.[^"']+)["']/g;
const visit = (member) => {
  if (visited.has(member)) return;
  visited.add(member);
  const absolute = join(repository, member); const source = readFileSync(absolute, "utf8");
  execFileSync(process.execPath, ["--check", absolute], { stdio: "pipe" });
  for (const match of source.matchAll(imports)) {
    const dependency = normalize(join(dirname(member), match[1]));
    if (!dependency.endsWith(".mjs") || dependency.startsWith("..")) throw new Error(`unsafe relative module import: ${member} -> ${match[1]}`);
    if (!allowed.has(dependency)) throw new Error(`allowlisted module dependency missing: ${member} -> ${dependency}`);
    visit(dependency);
  }
};
for (const entry of entries) visit(entry);
if (visited.size < entries.length) throw new Error("allowlisted module graph traversal was incomplete");
process.stdout.write(`allowlisted module graph verified: ${visited.size} modules\n`);
