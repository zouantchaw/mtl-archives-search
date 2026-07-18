import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureVerifiedHelpers } from "./run-verified-helper.mjs";

const HELPER_NAMES = ["gate-h2-publish-noreplace", "gate-h2-secure-candidate-read"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function configure(directory) {
  const manifestPath = join(directory, "helper-manifest.v1.json");
  configureVerifiedHelpers(
    directory,
    manifestPath,
    sha256(readFileSync(manifestPath)),
    "1".repeat(64),
    "2".repeat(64),
  );
}

if (process.argv[2] === "--probe") {
  configure(process.argv[3]);
} else {
  const root = mkdtempSync(join(tmpdir(), "gate-h2-helper-mode-test-"));
  try {
    const base = join(root, "base");
    mkdirSync(base, { mode: 0o700 });
    const helperBytes = Buffer.from("#!/bin/sh\nexit 0\n");
    const digest = sha256(helperBytes);
    for (const name of HELPER_NAMES) {
      writeFileSync(join(base, name), helperBytes, { mode: 0o555 });
      chmodSync(join(base, name), 0o555);
      for (const pass of ["pass-1", "pass-2"]) {
        writeFileSync(join(base, `${name}.${pass}`), helperBytes, { mode: 0o444 });
        chmodSync(join(base, `${name}.${pass}`), 0o444);
      }
    }
    const helpers = HELPER_NAMES.map((name) => ({
      name,
      bytes: helperBytes.length,
      mode: 0o555,
      pass_1_sha256: digest,
      pass_2_sha256: digest,
      sha256: digest,
    }));
    const manifestPath = join(base, "helper-manifest.v1.json");
    writeFileSync(manifestPath, `${JSON.stringify({ schema_version: "gate_h2_host_helper_manifest_v1.0.0", source_manifest_sha256: "1".repeat(64), builder_image_digest: "2".repeat(64), helpers })}\n`);
    chmodSync(manifestPath, 0o444);

    const cases = [
      ["canonical", null, 0, true],
      ...[0o4000, 0o2000, 0o1000].flatMap((special) => [
        [`manifest-${special.toString(8)}`, "helper-manifest.v1.json", 0o444 | special, false],
        [`pass-${special.toString(8)}`, `${HELPER_NAMES[0]}.pass-1`, 0o444 | special, false],
        [`executable-${special.toString(8)}`, HELPER_NAMES[0], 0o555 | special, false],
      ]),
    ];
    for (const [name, member, mode, shouldSucceed] of cases) {
      const fixture = join(root, name);
      cpSync(base, fixture, { recursive: true, preserveTimestamps: true });
      chmodSync(fixture, 0o700);
      if (member) chmodSync(join(fixture, member), mode);
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe", fixture], { encoding: "utf8" });
      if ((result.status === 0) !== shouldSucceed) throw new Error(`${name} mode case had unexpected status ${result.status}: ${result.stderr}`);
      rmSync(fixture, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
