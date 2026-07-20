import { chmodSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(script, "..");
const verifier = join(script, "verify-source-descriptor.mjs");
const descriptor = resolve(script, "../../../docs/dataset-factory/fixtures/podman-supervisor-v1/source-descriptor-v2.json");
const target = join(sourceRoot, ".gitignore");
const originalMode = statSync(target).mode & 0o7777;

try {
  chmodSync(target, originalMode | 0o111);
  const result = spawnSync(process.execPath, [verifier, descriptor], { encoding: "utf8" });
  if (result.status === 0 || !result.stderr.includes("member metadata is stale")) {
    throw new Error("source descriptor verifier accepted mode-only Git drift");
  }
} finally {
  chmodSync(target, originalMode);
}

process.stdout.write("source descriptor mode-only drift rejected\n");
