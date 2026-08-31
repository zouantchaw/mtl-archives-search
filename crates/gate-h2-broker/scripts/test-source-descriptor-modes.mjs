import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const script = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(script, "..");
const verifier = join(script, "verify-source-descriptor.mjs");
const descriptor = resolve(script, "../../../docs/dataset-factory/fixtures/podman-supervisor-v1/source-descriptor-v2.json");
const historicalCommit = "74e6f5af17b82ea116d1d0c51b6320959fd5c637";
const target = join(sourceRoot, ".gitignore");
const originalMode = statSync(target).mode & 0o7777;
const root = mkdtempSync(join(tmpdir(), "gate-h2-source-descriptor-modes-"));

try {
  chmodSync(target, originalMode | 0o111);
  const result = spawnSync(process.execPath, [verifier, descriptor], { encoding: "utf8" });
  if (result.status === 0 || !/(member metadata is stale|member set is stale)/.test(result.stderr)) {
    throw new Error("source descriptor verifier accepted mutable checkout drift");
  }
  const historical = spawnSync(process.execPath, [verifier, descriptor, "--git-commit", historicalCommit], { encoding: "utf8" });
  if (historical.status !== 0 || historical.stdout.trim() !== "6e69a6363cf7c6f35dbeca877856892b2f1057e539035a3a997e5823179a8630") {
    throw new Error(`historical descriptor verification read mutable checkout state: ${historical.stderr}`);
  }
  for (const arguments_ of [
    [descriptor, "--git-commit"],
    [descriptor, "--git-commit", "not-a-commit"],
    [descriptor, "--git-commit", "0".repeat(40)],
    [descriptor, "--git-commit", historicalCommit, "--git-commit", historicalCommit],
    [descriptor, "--unknown", historicalCommit],
  ]) {
    if (spawnSync(process.execPath, [verifier, ...arguments_], { stdio: "pipe" }).status === 0) {
      throw new Error(`historical descriptor verifier accepted invalid arguments: ${arguments_.join(" ")}`);
    }
  }
  const duplicate = join(root, "duplicate-key.json");
  const source = readFileSync(descriptor, "utf8");
  writeFileSync(duplicate, source.replace("\n}", ',\n  "source_root": "crates/gate-h2-broker"\n}'));
  if (spawnSync(process.execPath, [verifier, duplicate, "--git-commit", historicalCommit], { stdio: "pipe" }).status === 0) {
    throw new Error("historical descriptor verifier accepted a duplicate JSON key");
  }
} finally {
  chmodSync(target, originalMode);
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write("source descriptor checkout and historical modes verified\n");
