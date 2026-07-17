import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const lockPath = process.argv[2];
if (!lockPath) throw new Error("toolchain lock path is required");
const lockBytes = readFileSync(lockPath);
const lock = JSON.parse(lockBytes);
if (lock.schema_version !== "gate_h2_build_toolchain_lock_v1.0.0" || lock.target !== "x86_64-unknown-linux-musl" || lock.identity_basis !== "exact_normalized_version_output_sha256" || !Array.isArray(lock.tools)) throw new Error("invalid toolchain lock");
if (lock.tools.length !== 13 || new Set(lock.tools.map(({ name }) => name)).size !== lock.tools.length) throw new Error("toolchain lock inventory mismatch");
for (const entry of lock.tools) {
  if (!entry.name || !entry.identity || !/^[a-f0-9]{64}$/.test(entry.identity_sha256) || createHash("sha256").update(entry.identity).digest("hex") !== entry.identity_sha256) throw new Error(`invalid toolchain identity pin: ${entry.name ?? "unknown"}`);
}
const lockSha256 = createHash("sha256").update(lockBytes).digest("hex");
if (process.argv[3] === "--schema-only") {
  process.stdout.write(`${lockSha256}\n`);
  process.exit(0);
}

const firstLine = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n")[0];
const observed = new Map([
  ["rustc", firstLine("rustc", ["--version"])],
  ["cargo", firstLine("cargo", ["--version"])],
  ["rustup", firstLine("rustup", ["--version"])],
  ["x86_64-linux-musl-gcc", `x86_64-linux-musl-gcc|target=${firstLine("x86_64-linux-musl-gcc", ["-dumpmachine"])}|version=${firstLine("x86_64-linux-musl-gcc", ["-dumpfullversion", "-dumpversion"])}`],
  ["podman", firstLine("podman", ["--version"])],
  ["tar", firstLine("tar", ["--version"])],
  ["readelf", firstLine("readelf", ["--version"])],
  ["sha256sum", firstLine("sha256sum", ["--version"])],
  ["git", firstLine("git", ["--version"])],
  ["node", firstLine("node", ["--version"])],
  ["find", firstLine("find", ["--version"])],
  ["cmp", firstLine("cmp", ["--version"])],
  ["bash", firstLine("bash", ["--version"])],
]);

if (lock.tools.length !== observed.size) throw new Error("toolchain lock inventory mismatch");
for (const entry of lock.tools) {
  const value = observed.get(entry.name);
  if (!value || value !== entry.identity || createHash("sha256").update(value).digest("hex") !== entry.identity_sha256) throw new Error(`toolchain identity mismatch: ${entry.name}`);
}
process.stdout.write(`${lockSha256}\n`);
