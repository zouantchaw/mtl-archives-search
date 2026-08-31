#!/opt/gate-h2/bin/bash
set -euo pipefail
umask 077

REPO_ROOT="${GATE_H2_MEASURED_SOURCE:?builder-owned measured source snapshot required}"
CRATE_ROOT="$REPO_ROOT/crates/gate-h2-broker"
OUT="${1:?dedicated empty candidate directory required}"
HELPER_OUT="${2:?dedicated empty host-helper directory required}"
EXPECTED_SBOM_OUT="${3:?dedicated empty expected-SBOM directory required}"
TARGET=x86_64-unknown-linux-musl
TOOLCHAIN_LOCK="$CRATE_ROOT/oci/toolchain-lock.v1.json"

# This closed runtime manifest is an image contract. The future builder-image
# packet must install these paths and the exact versions checked below.
BASH=/opt/gate-h2/bin/bash
CARGO=/opt/gate-h2/bin/cargo
CHMOD=/opt/gate-h2/bin/chmod
CMAKE=/opt/gate-h2/bin/cmake
CMP=/opt/gate-h2/bin/cmp
CUT=/opt/gate-h2/bin/cut
ENV=/opt/gate-h2/bin/env
FIND=/opt/gate-h2/bin/find
GREP=/opt/gate-h2/bin/grep
INSTALL=/opt/gate-h2/bin/install
LDD=/opt/gate-h2/bin/ldd
MKDIR=/opt/gate-h2/bin/mkdir
MKTEMP=/opt/gate-h2/bin/mktemp
NINJA=/opt/gate-h2/bin/ninja
NODE=/opt/gate-h2/bin/node
READELF=/opt/gate-h2/bin/readelf
RM=/opt/gate-h2/bin/rm
RUSTC=/opt/gate-h2/bin/rustc
SHA256SUM=/opt/gate-h2/bin/sha256sum
SORT=/opt/gate-h2/bin/sort
STAT=/opt/gate-h2/bin/stat
TAR=/opt/gate-h2/bin/tar
TOUCH=/opt/gate-h2/bin/touch
MUSL_AR=/opt/gate-h2/bin/x86_64-linux-musl-ar
MUSL_CXX=/opt/gate-h2/bin/x86_64-linux-musl-g++
MUSL_GCC=/opt/gate-h2/bin/x86_64-linux-musl-gcc
MUSL_RANLIB=/opt/gate-h2/bin/x86_64-linux-musl-ranlib
MUSL_LIBC=/opt/gate-h2/x86_64-linux-musl/lib/libc.a
CARGO_HOME=/opt/gate-h2/cargo-home
CARGO_VENDOR=/opt/gate-h2/cargo-home/vendor
RUNTIME_INVENTORY=/opt/gate-h2/runtime-manifest.v1.json
SNAPSHOT_VERIFIER=/opt/gate-h2/libexec/verify-and-snapshot-source.sh
BOUNDARY_VERIFIER=/opt/gate-h2/libexec/verify-rootless-boundary.mjs
ELF_VERIFIER="$CRATE_ROOT/scripts/verify-static-musl-elf.mjs"

for tool in "$BASH" "$CARGO" "$CHMOD" "$CMAKE" "$CMP" "$CUT" "$ENV" "$FIND" "$GREP" "$INSTALL" "$LDD" "$MKDIR" "$MKTEMP" "$NINJA" "$NODE" "$READELF" "$RM" "$RUSTC" "$SHA256SUM" "$SORT" "$STAT" "$TAR" "$TOUCH" "$MUSL_AR" "$MUSL_CXX" "$MUSL_GCC" "$MUSL_RANLIB"; do
  [[ -f "$tool" && ! -L "$tool" && -x "$tool" ]] || { echo "hermetic builder runtime tool missing or non-canonical: $tool" >&2; exit 78; }
done
for name in $("$ENV" | "$CUT" -d= -f1); do
  case "$name" in
    PATH|HOME|CARGO_HOME|TMPDIR|LC_ALL|TZ|SOURCE_DATE_EPOCH|CARGO_NET_OFFLINE|GIT_CONFIG_NOSYSTEM|GIT_CONFIG_GLOBAL|PWD|SHLVL|_|GATE_H2_BUILDER_IMAGE|GATE_H2_BUILDER_IMAGE_DIGEST|GATE_H2_TRUST_ROOTS|GATE_H2_TRUST_ROOTS_SHA256|GATE_H2_SOURCE_DESCRIPTOR_SHA256|GATE_H2_MEASURED_SOURCE|GATE_H2_MEASURED_SOURCE_MANIFEST_SHA256|GATE_H2_SOURCE_COMMIT|GATE_H2_SOURCE_TREE|GATE_H2_SOURCE_ALLOWLIST_SHA256|GATE_H2_SOURCE_ARCHIVE_SHA256|GATE_H2_SOURCE_FILE_COUNT|GATE_H2_SOURCE_BYTE_COUNT) ;;
    *) echo "unexpected builder environment variable: $name" >&2; exit 65 ;;
  esac
done
[[ "$PATH" == /opt/gate-h2/bin && "$HOME" == /nonexistent && "$CARGO_HOME" == /opt/gate-h2/cargo-home && "$TMPDIR" == /tmp && "$LC_ALL" == C && "$TZ" == UTC && "$SOURCE_DATE_EPOCH" == 0 && "$CARGO_NET_OFFLINE" == true && "$GIT_CONFIG_NOSYSTEM" == 1 && "$GIT_CONFIG_GLOBAL" == /dev/null ]] || { echo "builder clean environment differs from the runtime contract" >&2; exit 65; }
[[ "$OUT" == /gate-h2-output && -d "$OUT" && -z "$("$FIND" "$OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "inner builder only writes its dedicated empty candidate mount" >&2; exit 65; }
[[ "$HELPER_OUT" == /gate-h2-host-helpers && -d "$HELPER_OUT" && -z "$("$FIND" "$HELPER_OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "inner builder requires a dedicated empty helper mount" >&2; exit 65; }
[[ "$EXPECTED_SBOM_OUT" == /gate-h2-expected-sbom && -d "$EXPECTED_SBOM_OUT" && -z "$("$FIND" "$EXPECTED_SBOM_OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "inner builder requires a dedicated empty expected-SBOM mount" >&2; exit 65; }
[[ -d /gate-h2-work && -x /gate-h2-work && "$("$STAT" -c '%u:%g:%a' /gate-h2-work)" == 65532:65532:700 ]] || { echo "unprivileged executable build tmpfs missing" >&2; exit 65; }
for cargo_ancestor in "$CRATE_ROOT" "$REPO_ROOT" /; do [[ ! -e "$cargo_ancestor/.cargo" ]] || { echo "Cargo configuration ancestor is forbidden: $cargo_ancestor/.cargo" >&2; exit 65; }; done
: "${GATE_H2_BUILDER_IMAGE:?missing builder image}"
: "${GATE_H2_BUILDER_IMAGE_DIGEST:?missing builder digest}"
: "${GATE_H2_TRUST_ROOTS:?missing trust roots}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?missing trust-root digest}"
[[ "${GATE_H2_SOURCE_DESCRIPTOR_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || { echo "missing or malformed retained source-descriptor digest" >&2; exit 65; }
[[ "$CARGO_HOME" == /opt/gate-h2/cargo-home && "$CARGO_VENDOR" == "$CARGO_HOME/vendor" ]] || { echo "non-canonical Cargo home rejected" >&2; exit 65; }
[[ -d "$CARGO_HOME" && ! -L "$CARGO_HOME" && "$("$STAT" -c '%u:%g:%a' "$CARGO_HOME")" == 0:0:755 ]] || { echo "builder-owned canonical Cargo home required" >&2; exit 65; }
[[ -f "$CARGO_HOME/config.toml" && ! -L "$CARGO_HOME/config.toml" && "$("$STAT" -c '%u:%g:%a' "$CARGO_HOME/config.toml")" == 0:0:444 ]] || { echo "canonical Cargo config missing" >&2; exit 65; }
[[ -d "$CARGO_VENDOR" && ! -L "$CARGO_VENDOR" && -n "$("$FIND" "$CARGO_VENDOR" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "canonical Cargo vendor tree missing" >&2; exit 65; }
[[ ! -e "$CARGO_HOME/registry" && ! -e "$CARGO_HOME/git" ]] || { echo "Cargo registry or Git cache is forbidden" >&2; exit 65; }
[[ "$("$FIND" "$CARGO_HOME" -mindepth 1 -maxdepth 1 -printf '%f\n' | "$SORT")" == $'config.toml\nvendor' ]] || { echo "Cargo home has mutable or unreviewed members" >&2; exit 65; }

SOURCE_COMMIT="${GATE_H2_SOURCE_COMMIT:?missing measured source commit}"
SOURCE_TREE="${GATE_H2_SOURCE_TREE:?missing measured source tree}"
SOURCE_ALLOWLIST_SHA256="${GATE_H2_SOURCE_ALLOWLIST_SHA256:?missing measured allowlist digest}"
SOURCE_ARCHIVE_SHA256="${GATE_H2_SOURCE_ARCHIVE_SHA256:?missing measured archive digest}"
SOURCE_MANIFEST_SHA256="${GATE_H2_MEASURED_SOURCE_MANIFEST_SHA256:?missing measured source manifest pin}"
SOURCE_FILE_COUNT="${GATE_H2_SOURCE_FILE_COUNT:?missing measured source count}"
SOURCE_BYTE_COUNT="${GATE_H2_SOURCE_BYTE_COUNT:?missing measured source byte count}"
[[ "$SOURCE_MANIFEST_SHA256" == "${GATE_H2_MEASURED_SOURCE_MANIFEST_SHA256:?measured source manifest pin required}" ]] || { echo "measured source manifest does not match descriptor" >&2; exit 65; }
TOOLCHAIN_LOCK_SHA256="$("$NODE" "$CRATE_ROOT/scripts/verify-toolchain-lock.mjs" "$TOOLCHAIN_LOCK" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST")"
"$NODE" "$CRATE_ROOT/scripts/verify-builder-runtime.mjs" "$RUNTIME_INVENTORY" /opt/gate-h2 "$TARGET" "$BASH" "$CARGO" "$CHMOD" "$CMAKE" "$CMP" "$CUT" "$ENV" "$FIND" "$GREP" "$INSTALL" "$LDD" "$MKDIR" "$MKTEMP" "$NINJA" "$NODE" "$READELF" "$RM" "$RUSTC" "$SHA256SUM" "$SORT" "$STAT" "$TAR" "$TOUCH" "$MUSL_AR" "$MUSL_CXX" "$MUSL_GCC" "$MUSL_RANLIB" "$MUSL_LIBC" "$SNAPSHOT_VERIFIER" /opt/gate-h2/libexec/verify-source-proof-core.mjs "$BOUNDARY_VERIFIER" >/dev/null
[[ "$("$SHA256SUM" "$GATE_H2_TRUST_ROOTS" | "$CUT" -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }
[[ "$("$CARGO" --version)" == "cargo 1.85.0 ("*")" ]] || { echo "exact Cargo 1.85.0 is required" >&2; exit 78; }
[[ "$("$RUSTC" --version)" == "rustc 1.85.0 ("*")" ]] || { echo "exact Rust 1.85.0 is required" >&2; exit 78; }
[[ "$("$NODE" --version)" == v22.22.0 ]] || { echo "exact Node 22.22.0 is required" >&2; exit 78; }
[[ "$("$MUSL_GCC" -dumpmachine)" == x86_64-linux-musl && "$("$MUSL_CXX" -dumpmachine)" == x86_64-linux-musl ]] || { echo "exact musl C/C++ compiler target is required" >&2; exit 78; }
[[ "$("$MUSL_GCC" -print-file-name=libc.a)" == "$MUSL_LIBC" && "$("$STAT" -c '%u:%g:%a' "$MUSL_LIBC")" == 0:0:444 ]] || { echo "exact inventoried musl libc.a is required" >&2; exit 78; }
[[ -n "$("$CMAKE" --version)" && -n "$("$NINJA" --version)" ]] || { echo "inventoried CMake/Ninja executor closure is unavailable" >&2; exit 78; }
"$RUSTC" --print target-list | "$GREP" -Fx "$TARGET" >/dev/null || { echo "required Rust target is unavailable" >&2; exit 78; }
[[ -d "$("$RUSTC" --print target-libdir --target "$TARGET")" ]] || { echo "required Rust target libraries are unavailable" >&2; exit 78; }
[[ "$("$RUSTC" --print sysroot)" == /opt/gate-h2/* ]] || { echo "Rust sysroot escapes the closed runtime" >&2; exit 78; }
for compiler_subtool in ar as ld collect2 ranlib; do
  resolved_subtool="$("$MUSL_GCC" "-print-prog-name=$compiler_subtool")"
  [[ "$resolved_subtool" == /opt/gate-h2/* && -f "$resolved_subtool" && ! -L "$resolved_subtool" ]] || { echo "linker subtool escapes the closed runtime: $compiler_subtool" >&2; exit 78; }
  case "$compiler_subtool" in
    ar) [[ "$resolved_subtool" == "$MUSL_AR" ]] || { echo "musl compiler did not resolve the inventoried ar" >&2; exit 78; } ;;
    ranlib) [[ "$resolved_subtool" == "$MUSL_RANLIB" ]] || { echo "musl compiler did not resolve the inventoried ranlib" >&2; exit 78; } ;;
  esac
done

TMP="$("$MKTEMP" -d /gate-h2-work/work.XXXXXX)"; trap '"$RM" -rf "$TMP"' EXIT
export TMPDIR=/gate-h2-work SOURCE_DATE_EPOCH=0 CARGO_NET_OFFLINE=true TZ=UTC LC_ALL=C PATH=/opt/gate-h2/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
for name in $("$ENV" | "$CUT" -d= -f1); do
  case "$name" in
    AR|AR_*|CC|CC_*|CFLAGS|CFLAGS_*|CMAKE|CMAKE_*|CXX|CXX_*|CXXFLAGS|CXXFLAGS_*|CARGO_REGISTRIES_*|CARGO_REGISTRY_INDEX|CARGO_REGISTRY_PROTOCOL|CARGO_HOME|CARGO_TARGET_DIR|CARGO_BUILD_RUSTC|CARGO_BUILD_RUSTC_WRAPPER|PKG_CONFIG|PKG_CONFIG_*|RANLIB|RANLIB_*|RUSTUP_*|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER) unset "$name" ;;
  esac
done
export CARGO_HOME RUSTC="$RUSTC" CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER="$MUSL_GCC"
export CC_x86_64_unknown_linux_musl="$MUSL_GCC" CXX_x86_64_unknown_linux_musl="$MUSL_CXX" AR_x86_64_unknown_linux_musl="$MUSL_AR" RANLIB_x86_64_unknown_linux_musl="$MUSL_RANLIB"
export CMAKE_x86_64_unknown_linux_musl="$CMAKE" CMAKE_GENERATOR_x86_64_unknown_linux_musl=Ninja ZERO_AR_DATE=1
export RUSTFLAGS="-C target-feature=+crt-static -C link-arg=-Wl,--build-id=none"
printf '%s\n' '[source.crates-io]' 'replace-with = "gate-h2-vendor"' '' '[source.gate-h2-vendor]' "directory = \"$CARGO_VENDOR\"" '' '[net]' 'offline = true' 'git-fetch-with-cli = false' > "$TMP/expected-cargo-config.toml"
"$CMP" -s "$TMP/expected-cargo-config.toml" "$CARGO_HOME/config.toml" || { echo "Cargo source replacement config differs from the reviewed builder contract" >&2; exit 65; }
unset GATE_H2_ADMITTED_CODE_ID GATE_H2_LAUNCH_AUTHORITY_TRUST_JSON

declare -a OCI_IMAGE_ID
cd "$CRATE_ROOT"
for pass in 1 2; do
  "$MKDIR" -p "$TMP/target-$pass" "$TMP/rootfs-$pass"
  CARGO_TARGET_DIR="$TMP/target-$pass" "$CARGO" build --manifest-path "$CRATE_ROOT/Cargo.toml" --locked --offline --release --target "$TARGET" --bin gate-h2-broker --bin gate-h2-stage-runtime --bin gate-h2-publish-noreplace --bin gate-h2-secure-candidate-read --bin gate-h2-podman-supervisor --bin gate-h2-post-begin-handoff
  for binary in gate-h2-broker gate-h2-stage-runtime gate-h2-publish-noreplace gate-h2-secure-candidate-read gate-h2-podman-supervisor gate-h2-post-begin-handoff; do
    "$NODE" "$ELF_VERIFIER" "$TMP/target-$pass/$TARGET/release/$binary" "$READELF"
  done
  "$INSTALL" -D -m 0555 "$TMP/target-$pass/$TARGET/release/gate-h2-stage-runtime" "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  "$INSTALL" -D -m 0444 "$GATE_H2_TRUST_ROOTS" "$TMP/rootfs-$pass/etc/ssl/certs/ca-certificates.crt"
  "$FIND" "$TMP/rootfs-$pass" -type d -exec "$CHMOD" 0755 {} +
  "$FIND" "$TMP/rootfs-$pass" -type f -exec "$CHMOD" 0444 {} +
  "$CHMOD" 0555 "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  "$FIND" "$TMP/rootfs-$pass" -exec "$TOUCH" -h -d @0 {} +
  (cd "$TMP/rootfs-$pass" && "$FIND" . -type f -printf '/%P %m\n' | "$SORT") > "$TMP/rootfs-$pass.inventory"
  "$CMP" "$CRATE_ROOT/oci/rootfs-inventory.expected.txt" "$TMP/rootfs-$pass.inventory"
  "$NODE" "$CRATE_ROOT/scripts/create-canonical-tar.mjs" "$TMP/rootfs-$pass" "$TMP/rootfs-$pass.tar"
  OCI_IMAGE_ID[$pass]="$("$NODE" "$CRATE_ROOT/scripts/assemble-oci.mjs" "$TMP/rootfs-$pass.tar" "$TMP/oci-layout-$pass" "$TMP/stage-$pass.oci.tar")"
done
for artifact in gate-h2-broker gate-h2-stage-runtime gate-h2-publish-noreplace gate-h2-secure-candidate-read gate-h2-podman-supervisor gate-h2-post-begin-handoff; do "$CMP" "$TMP/target-1/$TARGET/release/$artifact" "$TMP/target-2/$TARGET/release/$artifact"; done
"$CMP" "$TMP/rootfs-1.tar" "$TMP/rootfs-2.tar"; "$CMP" "$TMP/stage-1.oci.tar" "$TMP/stage-2.oci.tar"
[[ "${OCI_IMAGE_ID[1]}" == "${OCI_IMAGE_ID[2]}" ]] || exit 65
BROKER_SHA256="$("$SHA256SUM" "$TMP/target-1/$TARGET/release/gate-h2-broker" | "$CUT" -d' ' -f1)"
STAGE_SHA256="$("$SHA256SUM" "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" | "$CUT" -d' ' -f1)"
ROOTFS_SHA256="$("$SHA256SUM" "$TMP/rootfs-1.tar" | "$CUT" -d' ' -f1)"; OCI_SHA256="$("$SHA256SUM" "$TMP/stage-1.oci.tar" | "$CUT" -d' ' -f1)"
"$MKDIR" "$TMP/metadata-main"
"$NODE" "$CRATE_ROOT/scripts/generate-metadata.mjs" "$CRATE_ROOT" "$TMP/metadata-main" "$TARGET" "$GATE_H2_TRUST_ROOTS_SHA256" "$SOURCE_COMMIT" "$SOURCE_TREE" "$SOURCE_ALLOWLIST_SHA256" "$SOURCE_ARCHIVE_SHA256" "$SOURCE_MANIFEST_SHA256" "$SOURCE_FILE_COUNT" "$SOURCE_BYTE_COUNT" "$TOOLCHAIN_LOCK_SHA256" "$BROKER_SHA256" "$STAGE_SHA256" "$ROOTFS_SHA256" "$OCI_SHA256" "${OCI_IMAGE_ID[1]}" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST" "$CARGO"
"$NODE" "$CRATE_ROOT/scripts/generate-trusted-sbom.mjs" "$CRATE_ROOT" "$TMP/expected-sbom.cdx.json" "$TARGET" "$CARGO"
"$NODE" "$CRATE_ROOT/scripts/compare-trusted-sbom.mjs" "$TMP/metadata-main/sbom.cdx.json" "$TMP/expected-sbom.cdx.json"
"$INSTALL" -m 0444 "$TMP/expected-sbom.cdx.json" "$EXPECTED_SBOM_OUT/expected-sbom.cdx.json"
"$INSTALL" -m 0555 "$TMP/target-1/$TARGET/release/gate-h2-broker" "$OUT/gate-h2-broker"
"$INSTALL" -m 0444 "$TMP/stage-1.oci.tar" "$OUT/gate-h2-stage.oci.tar"; "$INSTALL" -m 0444 "$TMP/rootfs-1.tar" "$OUT/rootfs.tar"
"$INSTALL" -m 0444 "$TMP/metadata-main/sbom.cdx.json" "$OUT/sbom.cdx.json"; "$INSTALL" -m 0444 "$TMP/metadata-main/provenance.json" "$OUT/provenance.json"
printf '%s\n' "candidate_only=true" > "$OUT/INNER-CANDIDATE"
"$CHMOD" 0444 "$OUT/INNER-CANDIDATE" "$OUT/provenance.json" "$OUT/sbom.cdx.json"
for helper in gate-h2-publish-noreplace gate-h2-secure-candidate-read; do
  "$INSTALL" -m 0555 "$TMP/target-1/$TARGET/release/$helper" "$HELPER_OUT/$helper"
  "$INSTALL" -m 0444 "$TMP/target-1/$TARGET/release/$helper" "$HELPER_OUT/$helper.pass-1"
  "$INSTALL" -m 0444 "$TMP/target-2/$TARGET/release/$helper" "$HELPER_OUT/$helper.pass-2"
done
"$NODE" - "$HELPER_OUT" "$SOURCE_MANIFEST_SHA256" "$GATE_H2_BUILDER_IMAGE_DIGEST" "$TMP/target-1/$TARGET/release" "$TMP/target-2/$TARGET/release" <<'NODE'
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [output, sourceManifest, builderDigest, pass1, pass2] = process.argv.slice(2);
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const helpers = ["gate-h2-publish-noreplace", "gate-h2-secure-candidate-read"].map((name) => {
  const finalPath = path.join(output, name), one = sha(path.join(pass1, name)), two = sha(path.join(pass2, name)), final = sha(finalPath);
  if (one !== two || one !== final) throw new Error("independent host-helper builds differ");
  return { name, bytes: fs.statSync(finalPath).size, mode: 0o555, pass_1_sha256: one, pass_2_sha256: two, sha256: final };
});
fs.writeFileSync(path.join(output, "helper-manifest.v1.json"), `${JSON.stringify({ schema_version: "gate_h2_host_helper_manifest_v1.0.0", source_manifest_sha256: sourceManifest, builder_image_digest: builderDigest, helpers })}\n`, { flag: "wx", mode: 0o444 });
NODE
"$CHMOD" 0444 "$HELPER_OUT/helper-manifest.v1.json" "$HELPER_OUT"/*.pass-1 "$HELPER_OUT"/*.pass-2
printf 'GATEH2_HELPER_MANIFEST_SHA256=%s\n' "$("$SHA256SUM" "$HELPER_OUT/helper-manifest.v1.json" | "$CUT" -d' ' -f1)"
printf 'GATEH2_TOOLCHAIN_LOCK_SHA256=%s\n' "$TOOLCHAIN_LOCK_SHA256"
printf 'GATEH2_CARGO_LOCK_SHA256=%s\n' "$("$SHA256SUM" "$CRATE_ROOT/Cargo.lock" | "$CUT" -d' ' -f1)"
