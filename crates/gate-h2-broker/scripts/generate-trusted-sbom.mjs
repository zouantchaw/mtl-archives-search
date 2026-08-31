import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, output, target = "x86_64-unknown-linux-musl", cargo] = process.argv.slice(2);
if (!root || !output || !cargo || !cargo.startsWith("/")) throw new Error("source root, expected SBOM output, and canonical cargo path are required");
const metadata = JSON.parse(execFileSync(cargo, ["metadata", "--manifest-path", join(root, "Cargo.toml"), "--locked", "--offline", "--filter-platform", target, "--format-version", "1"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
if (!metadata.resolve?.root || !Array.isArray(metadata.resolve.nodes) || !Array.isArray(metadata.packages)) throw new Error("Cargo metadata resolve graph is required");
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
const reachable = new Set();
const visit = (id) => {
  if (reachable.has(id)) return;
  const node = nodes.get(id); if (!node) throw new Error(`resolve node missing: ${id}`);
  reachable.add(id);
  for (const dependency of node.deps ?? []) if ((dependency.dep_kinds ?? []).some(({ kind }) => kind === null)) visit(dependency.pkg);
};
visit(metadata.resolve.root);
const byPurl = new Map();
for (const id of reachable) {
  const pkg = packages.get(id); if (!pkg) throw new Error(`resolve package missing: ${id}`);
  const { name, version, license = "" } = pkg;
  const purl = `pkg:cargo/${name}@${version}`;
  if (byPurl.has(purl)) continue;
  byPurl.set(purl, { type: name === "gate-h2-broker" ? "application" : "library", name, version, licenses: license ? [{ expression: license.replace(/ \(\*\)$/, "") }] : [], purl });
}
const components = [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl));
const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { type: "application", name: "gate-h2-stage-runtime", version: "0.1.0" } }, components };
writeFileSync(output, `${JSON.stringify(sbom)}\n`, { mode: 0o444, flag: "wx" });
