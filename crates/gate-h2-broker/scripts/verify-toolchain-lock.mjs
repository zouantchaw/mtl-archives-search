import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { exactFields, parseStrictJson } from "./strict-json.mjs";

const [lockPath, imageReference, imageDigest] = process.argv.slice(2);
if (!lockPath) throw new Error("toolchain lock path is required");
const lockBytes = readFileSync(lockPath);
const lock = parseStrictJson(lockBytes);
exactFields(lock, ["schema_version", "target", "identity_basis", "builder_image", "host_boundary", "cargo_target_mount", "host_helpers", "oci_assembly"], "hermetic builder lock");
exactFields(lock.builder_image, ["reference_requirement", "digest_algorithm", "digest_authority", "supplies_all_output_affecting_tools"], "hermetic builder image");
const expectedTools = [
  "bash", "cargo", "cmp", "coreutils", "findutils", "grep", "musl-gcc", "node",
  "rustc", "rustup-target-x86_64-unknown-linux-musl", "tar", "readelf",
  "vendored-cargo-registry",
];
if (
  lock.schema_version !== "gate_h2_hermetic_builder_lock_v2.0.0" ||
  lock.target !== "x86_64-unknown-linux-musl" ||
  lock.identity_basis !== "single_reviewed_digest_pinned_builder_image_plus_exact_source_allowlist" ||
  lock.builder_image?.reference_requirement !== "name@sha256:<64-lowercase-hex>" ||
  lock.builder_image?.digest_algorithm !== "sha256" ||
  lock.builder_image?.digest_authority !== "required_external_issue_101_review_input" ||
  JSON.stringify(lock.builder_image?.supplies_all_output_affecting_tools) !== JSON.stringify(expectedTools) ||
  lock.host_boundary !== "linux_container_engine_plus_host_admission_publication_with_retained_fds" ||
  lock.cargo_target_mount !== "/gate-h2-build executable nosuid nodev mode 0700 uid 0 gid 0; /tmp remains noexec nosuid nodev" ||
  lock.host_helpers !== "two independent static musl builds plus exact manifest and builder-stdout manifest digest; host compares and executes only retained verified fds" ||
  lock.oci_assembly !== "deterministic_uncompressed_layer_oci_layout_v1"
) throw new Error("invalid hermetic builder lock");

if (imageReference !== undefined || imageDigest !== undefined) {
  if (!/^[a-f0-9]{64}$/.test(imageDigest ?? "")) throw new Error("reviewed builder digest must be 64 lowercase hex characters");
  if (!imageReference || imageReference !== `${imageReference.split("@sha256:")[0]}@sha256:${imageDigest}` || imageReference.split("@sha256:").length !== 2) {
    throw new Error("builder image reference must be pinned to the separately supplied reviewed digest");
  }
}
process.stdout.write(`${createHash("sha256").update(lockBytes).digest("hex")}\n`);
