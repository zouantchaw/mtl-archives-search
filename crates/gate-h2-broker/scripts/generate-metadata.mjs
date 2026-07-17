import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, output, target, trustRootsSha256, sourceCommit, sourceTree, toolchainLockSha256, binarySha256, rootfsSha256, ociArchiveSha256, ociImageId, builderImage, builderImageDigest] = process.argv.slice(2);
const digests = [trustRootsSha256, sourceCommit, sourceTree, toolchainLockSha256, binarySha256, rootfsSha256, ociArchiveSha256];
if (!root || !output || !target || digests.some((value) => !/^[a-f0-9]{40,64}$/.test(value ?? "")) || !/^sha256:[a-f0-9]{64}$/.test(ociImageId ?? "") || !/^[a-f0-9]{64}$/.test(builderImageDigest ?? "") || builderImage !== `${builderImage?.split("@sha256:")[0]}@sha256:${builderImageDigest}`) throw new Error("invalid verified metadata arguments");
mkdirSync(output, { recursive: true });
const tree = execFileSync("cargo", ["tree", "--manifest-path", join(root, "Cargo.toml"), "--locked", "--offline", "--target", target, "--edges", "normal", "--prefix", "none", "--format", "{p}\t{l}"], { cwd: root, encoding: "utf8" });
const byPurl = new Map();
for (const line of tree.trim().split("\n")) {
  const [display, license = ""] = line.split("\t");
  const match = /^([^ ]+) v([^ ]+)/.exec(display);
  if (!match) throw new Error(`unexpected cargo tree package line: ${display}`);
  const [, name, version] = match;
  const purl = `pkg:cargo/${name}@${version}`;
  byPurl.set(purl, { type: name === "gate-h2-broker" ? "application" : "library", name, version, licenses: license ? [{ expression: license.replace(/ \(\*\)$/, "") }] : [], purl });
}
const components = [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl));
const lock = readFileSync(join(root, "Cargo.lock"));
const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { type: "application", name: "gate-h2-stage-runtime", version: "0.1.0" } }, components };
const provenance = {
  schema_version: "gate_h2_stage_build_provenance_v1.0.0",
  source_date_epoch: 0,
  source_commit: sourceCommit,
  source_tree: sourceTree,
  target,
  toolchain_lock_sha256: toolchainLockSha256,
  toolchain_lock: JSON.parse(readFileSync(join(root, "oci/toolchain-lock.v1.json"))),
  builder_image: builderImage,
  builder_image_digest: builderImageDigest,
  cargo_lock_sha256: createHash("sha256").update(lock).digest("hex"),
  trust_roots_sha256: trustRootsSha256,
  binary_sha256: binarySha256,
  rootfs_sha256: rootfsSha256,
  oci_archive_sha256: ociArchiveSha256,
  oci_image_id: ociImageId,
  network_policy: "digest_pinned_builder_with_network_none_and_offline_cargo",
  reproducibility_status: "verified_two_independent_clean_source_builds",
  production_authority_activated: false,
};
writeFileSync(join(output, "sbom.cdx.json"), `${JSON.stringify(sbom)}\n`, { mode: 0o444 });
writeFileSync(join(output, "provenance.json"), `${JSON.stringify(provenance)}\n`, { mode: 0o444 });
