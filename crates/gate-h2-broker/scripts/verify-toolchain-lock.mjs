import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { exactFields, parseStrictJson } from "./strict-json.mjs";

const [lockPath, imageReference, imageDigest] = process.argv.slice(2);
if (!lockPath) throw new Error("toolchain lock path is required");
const lockBytes = readFileSync(lockPath);
const lock = parseStrictJson(lockBytes);
exactFields(lock, ["schema_version", "target", "identity_basis", "source_descriptor_continuity", "tool_versions", "runtime_paths", "image_source_snapshot_verifier", "image_source_proof_core", "image_rootless_boundary_verifier", "runtime_inventory", "runtime_directory_policy", "musl_toolchain", "cargo_home", "cargo_vendor", "builder_image", "host_boundary", "cargo_target_mount", "host_helpers", "oci_assembly"], "hermetic builder lock");
exactFields(lock.builder_image, ["reference_requirement", "digest_algorithm", "digest_authority", "supplies_all_output_affecting_tools"], "hermetic builder image");
exactFields(lock.tool_versions, ["cargo", "node", "rustc"], "builder tool versions");
exactFields(lock.musl_toolchain, ["compiler_target", "cc", "cxx", "ar", "ranlib", "cmake", "cmake_generator", "cmake_executor", "libc_archive", "libc_identity"], "musl toolchain");
const runtimePaths = {
  bash: "/opt/gate-h2/bin/bash", cargo: "/opt/gate-h2/bin/cargo", chmod: "/opt/gate-h2/bin/chmod", cmake: "/opt/gate-h2/bin/cmake",
  cmp: "/opt/gate-h2/bin/cmp", cut: "/opt/gate-h2/bin/cut", env: "/opt/gate-h2/bin/env",
  find: "/opt/gate-h2/bin/find", git: "/opt/gate-h2/bin/git", grep: "/opt/gate-h2/bin/grep", install: "/opt/gate-h2/bin/install",
  ldd: "/opt/gate-h2/bin/ldd",
  mkdir: "/opt/gate-h2/bin/mkdir", mktemp: "/opt/gate-h2/bin/mktemp", ninja: "/opt/gate-h2/bin/ninja", node: "/opt/gate-h2/bin/node",
  readelf: "/opt/gate-h2/bin/readelf", rm: "/opt/gate-h2/bin/rm", rustc: "/opt/gate-h2/bin/rustc",
  sha256sum: "/opt/gate-h2/bin/sha256sum", setpriv: "/opt/gate-h2/bin/setpriv", sort: "/opt/gate-h2/bin/sort", stat: "/opt/gate-h2/bin/stat",
  tar: "/opt/gate-h2/bin/tar", touch: "/opt/gate-h2/bin/touch", "x86_64-linux-musl-ar": "/opt/gate-h2/bin/x86_64-linux-musl-ar",
  "x86_64-linux-musl-g++": "/opt/gate-h2/bin/x86_64-linux-musl-g++", "x86_64-linux-musl-ranlib": "/opt/gate-h2/bin/x86_64-linux-musl-ranlib",
  "x86_64-linux-musl-gcc": "/opt/gate-h2/bin/x86_64-linux-musl-gcc",
};
exactFields(lock.runtime_paths, Object.keys(runtimePaths), "builder runtime paths");
const expectedTools = [
  "closed_runtime_manifest", "exact_cargo_home_source_replacement_config", "image_source_proof_core", "image_owned_source_snapshot_verifier", "image_owned_rootless_boundary_verifier", "exact_musl_cc_cxx_ar_ranlib_cmake_ninja_and_libc_inventory", "setpriv_unprivileged_inner_build", "runtime_inventory", "root_owned_exact_0755_runtime_directory_closure",
  "rustup-target-x86_64-unknown-linux-musl", "vendored-cargo-registry",
];
if (
  lock.schema_version !== "gate_h2_hermetic_builder_lock_v2.5.0" ||
  lock.target !== "x86_64-unknown-linux-musl" ||
  lock.identity_basis !== "single_reviewed_digest_pinned_builder_image_plus_exact_source_allowlist" ||
  lock.source_descriptor_continuity !== "retained_fd_sha256_receipt_to_identical_boundary_build_env_image_proof_and_host_admission" ||
  lock.tool_versions?.cargo !== "1.85.0" ||
  lock.tool_versions?.rustc !== "1.85.0" ||
  lock.tool_versions?.node !== "22.22.0" ||
  JSON.stringify(lock.runtime_paths) !== JSON.stringify(runtimePaths) ||
  lock.image_source_snapshot_verifier !== "/opt/gate-h2/libexec/verify-and-snapshot-source.sh" ||
  lock.image_source_proof_core !== "/opt/gate-h2/libexec/verify-source-proof-core.mjs" ||
  lock.image_rootless_boundary_verifier !== "/opt/gate-h2/libexec/verify-rootless-boundary.mjs" ||
  lock.runtime_inventory !== "/opt/gate-h2/runtime-manifest.v1.json" ||
  lock.runtime_directory_policy !== "all_directories_at_or_below_runtime_root_are_root_owned_non_symlink_exact_0755" ||
  lock.musl_toolchain?.compiler_target !== "x86_64-linux-musl" ||
  lock.musl_toolchain?.cc !== "/opt/gate-h2/bin/x86_64-linux-musl-gcc" ||
  lock.musl_toolchain?.cxx !== "/opt/gate-h2/bin/x86_64-linux-musl-g++" ||
  lock.musl_toolchain?.ar !== "/opt/gate-h2/bin/x86_64-linux-musl-ar" ||
  lock.musl_toolchain?.ranlib !== "/opt/gate-h2/bin/x86_64-linux-musl-ranlib" ||
  lock.musl_toolchain?.cmake !== "/opt/gate-h2/bin/cmake" ||
  lock.musl_toolchain?.cmake_generator !== "Ninja" ||
  lock.musl_toolchain?.cmake_executor !== "/opt/gate-h2/bin/ninja" ||
  lock.musl_toolchain?.libc_archive !== "/opt/gate-h2/x86_64-linux-musl/lib/libc.a" ||
  lock.musl_toolchain?.libc_identity !== "exact_runtime_inventory_mode_bytes_sha256" ||
  lock.cargo_home !== "/opt/gate-h2/cargo-home" ||
  lock.cargo_vendor !== "/opt/gate-h2/cargo-home/vendor" ||
  lock.builder_image?.reference_requirement !== "name@sha256:<64-lowercase-hex>" ||
  lock.builder_image?.digest_algorithm !== "sha256" ||
  lock.builder_image?.digest_authority !== "required_external_issue_101_review_input" ||
  JSON.stringify(lock.builder_image?.supplies_all_output_affecting_tools) !== JSON.stringify(expectedTools) ||
  lock.host_boundary !== "linux_rootless_podman_keep_id_65532_root_supervisor_nnp_caps_setuid_setgid_setpcap_plus_host_admission_publication_with_retained_fds" ||
  lock.cargo_target_mount !== "/gate-h2-work executable nosuid nodev mode 0700 uid 65532 gid 65532; root-only /gate-h2-build holds the sealed measured source; root-only /tmp is noexec nosuid nodev mode 0700" ||
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
