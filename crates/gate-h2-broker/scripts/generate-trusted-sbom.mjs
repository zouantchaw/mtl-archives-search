import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, output, target = "x86_64-unknown-linux-musl"] = process.argv.slice(2);
if (!root || !output) throw new Error("source root and expected SBOM output are required");
const tree = execFileSync("cargo", ["tree", "--manifest-path", join(root, "Cargo.toml"), "--locked", "--offline", "--target", target, "--edges", "normal", "--prefix", "none", "--format", "{p}\t{l}"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const byPurl = new Map();
for (const line of tree.trim().split("\n")) {
  const [display, license = ""] = line.split("\t");
  const match = /^([^ ]+) v([^ ]+)/.exec(display);
  if (!match) throw new Error(`unexpected cargo tree package line: ${display}`);
  const [, name, version] = match;
  const purl = `pkg:cargo/${name}@${version}`;
  if (byPurl.has(purl)) continue;
  byPurl.set(purl, { type: name === "gate-h2-broker" ? "application" : "library", name, version, licenses: license ? [{ expression: license.replace(/ \(\*\)$/, "") }] : [], purl });
}
const components = [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl));
const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { type: "application", name: "gate-h2-stage-runtime", version: "0.1.0" } }, components };
writeFileSync(output, `${JSON.stringify(sbom)}\n`, { mode: 0o444, flag: "wx" });
