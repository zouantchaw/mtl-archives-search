import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [lockPath, imageReference, imageDigest] = process.argv.slice(2);
if (!lockPath) throw new Error("toolchain lock path is required");
const lockBytes = readFileSync(lockPath);
const lock = JSON.parse(lockBytes);
const expectedTools = [
  "bash", "cargo", "cmp", "coreutils", "findutils", "git", "grep", "musl-gcc", "node",
  "rustc", "rustup-target-x86_64-unknown-linux-musl", "tar", "readelf",
  "vendored-cargo-registry",
];
if (
  lock.schema_version !== "gate_h2_hermetic_builder_lock_v2.0.0" ||
  lock.target !== "x86_64-unknown-linux-musl" ||
  lock.identity_basis !== "single_reviewed_digest_pinned_builder_image" ||
  lock.builder_image?.reference_requirement !== "name@sha256:<64-lowercase-hex>" ||
  lock.builder_image?.digest_algorithm !== "sha256" ||
  lock.builder_image?.digest_authority !== "required_external_issue_101_review_input" ||
  JSON.stringify(lock.builder_image?.supplies_all_output_affecting_tools) !== JSON.stringify(expectedTools) ||
  lock.host_boundary !== "linux_container_engine_only_no_output_assembly" ||
  lock.oci_assembly !== "deterministic_uncompressed_layer_oci_layout_v1"
) throw new Error("invalid hermetic builder lock");

if (imageReference !== undefined || imageDigest !== undefined) {
  if (!/^[a-f0-9]{64}$/.test(imageDigest ?? "")) throw new Error("reviewed builder digest must be 64 lowercase hex characters");
  if (!imageReference || imageReference !== `${imageReference.split("@sha256:")[0]}@sha256:${imageDigest}` || imageReference.split("@sha256:").length !== 2) {
    throw new Error("builder image reference must be pinned to the separately supplied reviewed digest");
  }
}
process.stdout.write(`${createHash("sha256").update(lockBytes).digest("hex")}\n`);
