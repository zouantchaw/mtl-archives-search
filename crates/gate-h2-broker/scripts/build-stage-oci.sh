#!/usr/bin/env bash
set -euo pipefail
umask 022

CRATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$CRATE_ROOT" rev-parse --show-toplevel)"
TARGET=x86_64-unknown-linux-musl
OUT="${1:-$CRATE_ROOT/dist}"
TOOLCHAIN_LOCK="$CRATE_ROOT/oci/toolchain-lock.v1.json"

if [[ "${GATE_H2_IN_HERMETIC_BUILDER:-}" != 1 ]]; then
  [[ "$(uname -s)" == Linux ]] || { echo "gate H2 OCI proof requires Linux; retain as issue #101 evidence gate" >&2; exit 78; }
  command -v podman >/dev/null || { echo "podman is required only to execute the hermetic builder" >&2; exit 78; }
  : "${GATE_H2_BUILDER_IMAGE:?set GATE_H2_BUILDER_IMAGE to the reviewed name@sha256:digest builder input}"
  : "${GATE_H2_BUILDER_IMAGE_DIGEST:?set GATE_H2_BUILDER_IMAGE_DIGEST to its separately reviewed 64-hex digest}"
  : "${GATE_H2_TRUST_ROOTS:?set GATE_H2_TRUST_ROOTS to reviewed PEM bytes}"
  : "${GATE_H2_TRUST_ROOTS_SHA256:?set GATE_H2_TRUST_ROOTS_SHA256 to their reviewed SHA-256}"
  [[ "$GATE_H2_BUILDER_IMAGE_DIGEST" =~ ^[a-f0-9]{64}$ && "$GATE_H2_BUILDER_IMAGE" == *@sha256:"$GATE_H2_BUILDER_IMAGE_DIGEST" ]] || { echo "builder image reference/digest mismatch" >&2; exit 65; }
  [[ -f "$GATE_H2_TRUST_ROOTS" ]] || { echo "trust-root file missing" >&2; exit 66; }
  mkdir -p "$OUT"
  OUT="$(cd "$OUT" && pwd)"
  podman run --rm --pull=never --network=none --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,mode=1777 \
    -e GATE_H2_IN_HERMETIC_BUILDER=1 \
    -e GATE_H2_BUILDER_IMAGE \
    -e GATE_H2_BUILDER_IMAGE_DIGEST \
    -e GATE_H2_TRUST_ROOTS=/gate-h2-inputs/ca-certificates.crt \
    -e GATE_H2_TRUST_ROOTS_SHA256 \
    -v "$REPO_ROOT:/workspace:ro" \
    -v "$GATE_H2_TRUST_ROOTS:/gate-h2-inputs/ca-certificates.crt:ro" \
    -v "$OUT:/gate-h2-output:rw" \
    -w /workspace \
    "$GATE_H2_BUILDER_IMAGE" \
    /workspace/crates/gate-h2-broker/scripts/build-stage-oci.sh /gate-h2-output
  exit $?
fi

for command in bash cargo cmp cp cut find git grep install mkdir mktemp node readelf rm rustc sha256sum sort tar touch x86_64-linux-musl-gcc; do
  command -v "$command" >/dev/null || { echo "hermetic builder omits required tool: $command" >&2; exit 78; }
done
: "${GATE_H2_BUILDER_IMAGE:?missing propagated builder image reference}"
: "${GATE_H2_BUILDER_IMAGE_DIGEST:?missing propagated builder image digest}"
: "${GATE_H2_TRUST_ROOTS:?missing reviewed trust roots}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?missing reviewed trust-root digest}"
TOOLCHAIN_LOCK_SHA256="$(node "$CRATE_ROOT/scripts/verify-toolchain-lock.mjs" "$TOOLCHAIN_LOCK" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST")"
[[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || { echo "source worktree must be clean" >&2; exit 65; }
[[ "$(sha256sum "$GATE_H2_TRUST_ROOTS" | cut -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse HEAD^{tree})"
export SOURCE_DATE_EPOCH=0 CARGO_NET_OFFLINE=true TZ=UTC LC_ALL=C
export RUSTFLAGS="-C target-feature=+crt-static -C link-arg=-Wl,--build-id=none"
unset GATE_H2_ADMITTED_CODE_ID GATE_H2_LAUNCH_AUTHORITY_TRUST_JSON
declare -a OCI_IMAGE_ID

for pass in 1 2; do
  mkdir -p "$TMP/source-$pass" "$TMP/target-$pass" "$TMP/rootfs-$pass"
  git -C "$REPO_ROOT" archive --format=tar "$SOURCE_COMMIT" | tar -xf - -C "$TMP/source-$pass"
  CARGO_TARGET_DIR="$TMP/target-$pass" cargo build \
    --manifest-path "$TMP/source-$pass/crates/gate-h2-broker/Cargo.toml" \
    --locked --offline --release --target "$TARGET" --bin gate-h2-stage-runtime
  BINARY="$TMP/target-$pass/$TARGET/release/gate-h2-stage-runtime"
  readelf -lW "$BINARY" > "$TMP/readelf-program-$pass"
  readelf -dW "$BINARY" > "$TMP/readelf-dynamic-$pass"
  ! grep -q 'INTERP' "$TMP/readelf-program-$pass" || { echo "ELF interpreter is forbidden" >&2; exit 65; }
  ! grep -q 'NEEDED' "$TMP/readelf-dynamic-$pass" || { echo "dynamic dependency is forbidden" >&2; exit 65; }
  install -D -m 0555 "$BINARY" "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  install -D -m 0444 "$GATE_H2_TRUST_ROOTS" "$TMP/rootfs-$pass/etc/ssl/certs/ca-certificates.crt"
  find "$TMP/rootfs-$pass" -type d -exec chmod 0755 {} +
  find "$TMP/rootfs-$pass" -type f -exec chmod 0444 {} +
  chmod 0555 "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  find "$TMP/rootfs-$pass" -exec touch -h -d @0 {} +
  (cd "$TMP/rootfs-$pass" && find . -type f -printf '/%P %m\n' | sort) > "$TMP/rootfs-$pass.inventory"
  cmp "$CRATE_ROOT/oci/rootfs-inventory.expected.txt" "$TMP/rootfs-$pass.inventory"
  tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$TMP/rootfs-$pass" -cf "$TMP/rootfs-$pass.tar" .
  OCI_IMAGE_ID[$pass]="$(node "$CRATE_ROOT/scripts/assemble-oci.mjs" \
    "$TMP/rootfs-$pass.tar" "$TMP/oci-layout-$pass" "$TMP/stage-$pass.oci.tar")"
done

cmp "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" "$TMP/target-2/$TARGET/release/gate-h2-stage-runtime"
cmp "$TMP/rootfs-1.tar" "$TMP/rootfs-2.tar"
cmp "$TMP/stage-1.oci.tar" "$TMP/stage-2.oci.tar"
[[ "${OCI_IMAGE_ID[1]}" == "${OCI_IMAGE_ID[2]}" ]] || { echo "OCI manifest digest differs" >&2; exit 65; }

BINARY_SHA256="$(sha256sum "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" | cut -d' ' -f1)"
ROOTFS_SHA256="$(sha256sum "$TMP/rootfs-1.tar" | cut -d' ' -f1)"
OCI_ARCHIVE_SHA256="$(sha256sum "$TMP/stage-1.oci.tar" | cut -d' ' -f1)"
mkdir -p "$TMP/output"
node "$CRATE_ROOT/scripts/generate-metadata.mjs" \
  "$TMP/source-1/crates/gate-h2-broker" "$TMP/output" "$TARGET" \
  "$GATE_H2_TRUST_ROOTS_SHA256" "$SOURCE_COMMIT" "$SOURCE_TREE" "$TOOLCHAIN_LOCK_SHA256" \
  "$BINARY_SHA256" "$ROOTFS_SHA256" "$OCI_ARCHIVE_SHA256" "${OCI_IMAGE_ID[1]}" \
  "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST"
install -m 0444 "$TMP/stage-1.oci.tar" "$TMP/output/gate-h2-stage.oci.tar"
install -m 0444 "$TMP/rootfs-1.tar" "$TMP/output/rootfs.tar"
printf '%s\n' \
  "source_commit=$SOURCE_COMMIT" \
  "source_tree=$SOURCE_TREE" \
  "builder_image=$GATE_H2_BUILDER_IMAGE" \
  "builder_image_digest=$GATE_H2_BUILDER_IMAGE_DIGEST" \
  "toolchain_lock_sha256=$TOOLCHAIN_LOCK_SHA256" \
  "binary_sha256=$BINARY_SHA256" \
  "rootfs_sha256=$ROOTFS_SHA256" \
  "oci_archive_sha256=$OCI_ARCHIVE_SHA256" \
  "oci_image_id=${OCI_IMAGE_ID[1]}" > "$TMP/output/reproducibility.env"
cp -a "$TMP/output/." "$OUT/"
