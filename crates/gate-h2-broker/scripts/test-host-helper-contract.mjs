import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scripts = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "gate-h2-host-helper-contract-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runner = `import { configureVerifiedHelpers } from ${JSON.stringify(pathToFileURL(join(scripts, "run-verified-helper.mjs")).href)};\nconst [directory, manifest, digest] = process.argv.slice(1); configureVerifiedHelpers(directory, manifest, digest, "a".repeat(64), "b".repeat(64));\n`;
const fixture = (label, mutate = () => {}) => {
  const directory = join(root, label); mkdirSync(directory, { mode: 0o700 });
  const helpers = ["gate-h2-publish-noreplace", "gate-h2-secure-candidate-read"].map((name) => {
    const bytes = Buffer.from(`${name}\n`), digest = sha(bytes); writeFileSync(join(directory, name), bytes, { mode: 0o555 }); chmodSync(join(directory, name), 0o555);
    for (const pass of ["pass-1", "pass-2"]) { writeFileSync(join(directory, `${name}.${pass}`), bytes, { mode: 0o444 }); chmodSync(join(directory, `${name}.${pass}`), 0o444); }
    return { name, bytes: bytes.length, mode: 0o555, pass_1_sha256: digest, pass_2_sha256: digest, sha256: digest };
  });
  const manifest = join(directory, "helper-manifest.v1.json"); const manifestBytes = Buffer.from(`${JSON.stringify({ schema_version: "gate_h2_host_helper_manifest_v1.0.0", source_manifest_sha256: "a".repeat(64), builder_image_digest: "b".repeat(64), helpers })}\n`); writeFileSync(manifest, manifestBytes, { mode: 0o444 }); chmodSync(manifest, 0o444);
  mutate(directory); return { directory, manifest, digest: sha(manifestBytes) };
};
try {
  for (const [label, mutate, expected] of [
    ["exact", () => {}, true],
    ["extra", (directory) => { writeFileSync(join(directory, "gate-h2-podman-supervisor"), "extra\n"); }, false],
    ["missing", (directory) => { rmSync(join(directory, "gate-h2-secure-candidate-read.pass-2")); }, false],
  ]) {
    const input = fixture(label, mutate); const result = spawnSync(process.execPath, ["--input-type=module", "-e", runner, input.directory, input.manifest, input.digest], { encoding: "utf8" });
    if ((result.status === 0) !== expected) throw new Error(`producer-shaped host helper contract ${label} result was unexpected: ${result.stderr}`);
  }
} finally { rmSync(root, { recursive: true, force: true }); }
process.stdout.write("host helper producer/consumer contract verified\n");
