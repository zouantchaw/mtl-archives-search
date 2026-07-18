import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const crate = resolve(scripts, "..");
const root = mkdtempSync(join(tmpdir(), "gate-h2-build-orchestration-"));
try {
  const repository = join(root, "repository");
  const nested = join(repository, "crates", "gate-h2-broker");
  const allowlistPath = join(crate, "oci", "source-allowlist.v1.txt");
  const allowlist = readFileSync(allowlistPath, "utf8").trimEnd().split("\n").map((line) => { const [mode, path] = line.split(" "); return { mode: Number.parseInt(mode.slice(-3), 8), path }; });
  for (const { mode, path } of allowlist) { const output = join(repository, path); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, "allowlisted fixture\n"); chmodSync(output, mode); }
  cpSync(allowlistPath, join(repository, "crates", "gate-h2-broker", "oci", "source-allowlist.v1.txt"));
  for (const name of ["Cargo.toml", "Cargo.lock"]) cpSync(join(crate, name), join(nested, name));
  writeFileSync(join(nested, "src", "lib.rs"), "pub fn fixture() {}\n");
  writeFileSync(join(repository, "Cargo.lock"), "wrong root lock sentinel\n");
  writeFileSync(join(repository, ".gitignore"), "ignored-input\n");
  writeFileSync(join(repository, "unrelated-tracked.txt"), "unrelated tracked sentinel\n");
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "gate-h2@example.invalid"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "gate-h2-fixture"], { cwd: repository });
  execFileSync("git", ["add", "."], { cwd: repository });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repository });
  writeFileSync(join(repository, "ignored-input"), "ignored sentinel\n");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim();
  const exported = join(root, "exported");
  execFileSync("bash", ["-c", 'umask 077; exec "$@"', "gate-h2-export", join(scripts, "export-tracked-source.sh"), repository, exported, join(root, "source.json"), commit, tree]);
  for (const expectedMode of [0o644, 0o755]) {
    const member = allowlist.find(({ mode }) => mode === expectedMode);
    if (!member || (statSync(join(exported, member.path)).mode & 0o7777) !== expectedMode) throw new Error(`source export did not preserve exact ${expectedMode.toString(8)} mode under umask 077`);
  }
  if (existsSync(join(exported, "unrelated-tracked.txt")) || existsSync(join(exported, ".gitignore")) || existsSync(join(exported, "ignored-input"))) throw new Error("non-allowlisted tracked or ignored file leaked into source export");
  const descriptor = JSON.parse(readFileSync(join(root, "source.json")));
  if (descriptor.source_file_count !== allowlist.length || descriptor.source_allowlist_sha256 !== createHash("sha256").update(readFileSync(allowlistPath)).digest("hex")) throw new Error("source export allowlist count/hash mismatch");
  const mutatedMember = join(exported, "crates", "gate-h2-broker", "src", "lib.rs");
  const originalMember = readFileSync(mutatedMember); writeFileSync(mutatedMember, "pub fn mutated_after_descriptor() {}\n");
  const rejectedSnapshot = join(root, "rejected-snapshot");
  if (spawnSync("bash", [join(scripts, "verify-and-snapshot-source.sh"), exported, join(root, "source.json"), rejectedSnapshot], { stdio: "pipe" }).status === 0) throw new Error("exported member mutation after descriptor generation was accepted");
  writeFileSync(mutatedMember, originalMember);
  const regularMember = allowlist.find(({ mode }) => mode === 0o644);
  chmodSync(join(exported, regularMember.path), 0o600);
  if (spawnSync("bash", [join(scripts, "verify-and-snapshot-source.sh"), exported, join(root, "source.json"), join(root, "rejected-mode-snapshot")], { stdio: "pipe" }).status === 0) throw new Error("unexpected exported source mode was accepted");
  chmodSync(join(exported, regularMember.path), regularMember.mode);
  const expected = createHash("sha256").update(readFileSync(join(exported, "crates", "gate-h2-broker", "Cargo.lock"))).digest("hex");
  const digest = execFileSync(process.execPath, [join(scripts, "prepare-trusted-build-inputs.mjs"), exported, join(root, "sbom.json")], { encoding: "utf8" }).trim();
  if (digest !== expected || existsSync(join(exported, "Cargo.lock"))) throw new Error("orchestration did not bind only the allowlisted crate Cargo.lock");
  const metadata = join(root, "metadata"); mkdirSync(metadata);
  const hashes = Array(8).fill("a".repeat(64));
  execFileSync(process.execPath, [join(scripts, "generate-metadata.mjs"), join(exported, "crates", "gate-h2-broker"), metadata, "x86_64-unknown-linux-musl", hashes[0], commit, tree, hashes[1], hashes[2], hashes[3], "4", "5", hashes[4], hashes[5], hashes[6], hashes[7], hashes[0], `sha256:${hashes[1]}`, `builder.invalid/image@sha256:${hashes[2]}`, hashes[2]]);
  const provenance = JSON.parse(readFileSync(join(metadata, "provenance.json")));
  if (provenance.cargo_lock_sha256 !== digest) throw new Error("metadata did not receive the exported crate lock digest");
  const missing = join(root, "missing"); cpSync(exported, missing, { recursive: true }); rmSync(join(missing, "crates", "gate-h2-broker", "Cargo.lock"));
  if (spawnSync(process.execPath, [join(scripts, "prepare-trusted-build-inputs.mjs"), missing, join(root, "missing-sbom.json")]).status === 0) throw new Error("missing crate lock was accepted");
  if (spawnSync(process.execPath, [join(scripts, "prepare-trusted-build-inputs.mjs"), join(exported, "crates", "gate-h2-broker"), join(root, "wrong-root-sbom.json")]).status === 0) throw new Error("crate path was accepted as exported repository root");
  writeFileSync(join(repository, "untracked-input"), "untracked sentinel\n");
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), repository, join(root, "untracked-export"), join(root, "untracked.json"), commit, tree]).status === 0) throw new Error("untracked source input was accepted");
  rmSync(join(repository, "untracked-input"));
  const executable = allowlist.find(({ mode }) => mode === 0o755); chmodSync(join(repository, executable.path), 0o644); execFileSync("git", ["add", executable.path], { cwd: repository }); execFileSync("git", ["commit", "-qm", "mode drift"], { cwd: repository });
  const modeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(); const modeTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim();
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), repository, join(root, "mode-export"), join(root, "mode.json"), modeCommit, modeTree]).status === 0) throw new Error("allowlisted source mode drift was accepted");
  chmodSync(join(repository, executable.path), 0o755); execFileSync("git", ["add", executable.path], { cwd: repository }); execFileSync("git", ["commit", "-qm", "restore mode"], { cwd: repository });
  const missingPath = join(repository, allowlist[0].path); rmSync(missingPath); execFileSync("git", ["add", "-u"], { cwd: repository }); execFileSync("git", ["commit", "-qm", "missing allowlisted input"], { cwd: repository });
  const missingCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(); const missingTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim();
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), repository, join(root, "missing-export"), join(root, "missing.json"), missingCommit, missingTree]).status === 0) throw new Error("missing allowlisted source input was accepted");
} finally {
  rmSync(root, { recursive: true, force: true });
}
