#!/usr/bin/env bash
set -euo pipefail

CRATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$CRATE_ROOT" rev-parse --show-toplevel)"
TARGET=x86_64-unknown-linux-musl
OUT="${1:-$CRATE_ROOT/dist}"

[[ "$(uname -s)" == Linux ]] || { echo "gate H2 OCI proof requires Linux; retain as issue #101 evidence gate" >&2; exit 78; }
for command in bash cargo cmp find git node podman readelf rustc rustup sha256sum tar x86_64-linux-musl-gcc; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 78; }
done
TOOLCHAIN_LOCK="$CRATE_ROOT/oci/toolchain-lock.v1.json"
TOOLCHAIN_LOCK_SHA256="$(node "$CRATE_ROOT/scripts/verify-toolchain-lock.mjs" "$TOOLCHAIN_LOCK")"
[[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || { echo "source worktree must be clean" >&2; exit 65; }
rustup target list --installed | grep -qx "$TARGET" || { echo "$TARGET is not installed" >&2; exit 78; }
: "${GATE_H2_TRUST_ROOTS:?set GATE_H2_TRUST_ROOTS to reviewed PEM bytes}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?set GATE_H2_TRUST_ROOTS_SHA256 to their reviewed SHA-256}"
[[ -f "$GATE_H2_TRUST_ROOTS" ]] || { echo "trust-root file missing" >&2; exit 66; }
[[ "$(sha256sum "$GATE_H2_TRUST_ROOTS" | cut -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse HEAD^{tree})"
export SOURCE_DATE_EPOCH=0 CARGO_NET_OFFLINE=true TZ=UTC LC_ALL=C
export RUSTFLAGS="-C target-feature=+crt-static -C link-arg=-Wl,--build-id=none"
unset GATE_H2_ADMITTED_CODE_ID

for pass in 1 2; do
  mkdir -p "$TMP/source-$pass" "$TMP/cargo-home-$pass" "$TMP/target-$pass" "$TMP/rootfs-$pass"
  git -C "$REPO_ROOT" archive --format=tar "$SOURCE_COMMIT" | tar -xf - -C "$TMP/source-$pass"
  cp -a "${CARGO_HOME:-$HOME/.cargo}/registry" "$TMP/cargo-home-$pass/registry"
  if [[ -d "${CARGO_HOME:-$HOME/.cargo}/git" ]]; then
    cp -a "${CARGO_HOME:-$HOME/.cargo}/git" "$TMP/cargo-home-$pass/git"
  fi
  CARGO_HOME="$TMP/cargo-home-$pass" CARGO_TARGET_DIR="$TMP/target-$pass" \
    cargo build --manifest-path "$TMP/source-$pass/crates/gate-h2-broker/Cargo.toml" \
      --locked --offline --release --target "$TARGET" --bin gate-h2-stage-runtime
  BINARY="$TMP/target-$pass/$TARGET/release/gate-h2-stage-runtime"
  readelf -lW "$BINARY" > "$TMP/readelf-program-$pass"
  readelf -dW "$BINARY" > "$TMP/readelf-dynamic-$pass"
  ! grep -q 'INTERP' "$TMP/readelf-program-$pass" || { echo "ELF interpreter is forbidden" >&2; exit 65; }
  ! grep -q 'NEEDED' "$TMP/readelf-dynamic-$pass" || { echo "dynamic dependency is forbidden" >&2; exit 65; }
  install -D -m 0555 "$BINARY" "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  install -D -m 0444 "$GATE_H2_TRUST_ROOTS" "$TMP/rootfs-$pass/etc/ssl/certs/ca-certificates.crt"
  find "$TMP/rootfs-$pass" -exec touch -h -d @0 {} +
  (cd "$TMP/rootfs-$pass" && find . -type f -printf '/%P %m\n' | sort) > "$TMP/rootfs-$pass.inventory"
  cmp "$CRATE_ROOT/oci/rootfs-inventory.expected.txt" "$TMP/rootfs-$pass.inventory"
  tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$TMP/rootfs-$pass" -cf "$TMP/rootfs-$pass.tar" .
  mkdir -p "$TMP/source-$pass/crates/gate-h2-broker/oci/rootfs"
  cp -a "$TMP/rootfs-$pass/." "$TMP/source-$pass/crates/gate-h2-broker/oci/rootfs/"
  podman build --network=none --no-cache --timestamp 0 --format oci \
    --iidfile "$TMP/image-$pass.id" \
    -f "$TMP/source-$pass/crates/gate-h2-broker/oci/Containerfile" \
    "$TMP/source-$pass/crates/gate-h2-broker/oci"
  podman save --format oci-archive -o "$TMP/stage-$pass.oci.tar" "$(cat "$TMP/image-$pass.id")"
done

cmp "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" "$TMP/target-2/$TARGET/release/gate-h2-stage-runtime"
cmp "$TMP/rootfs-1.tar" "$TMP/rootfs-2.tar"
cmp "$TMP/image-1.id" "$TMP/image-2.id"
cmp "$TMP/stage-1.oci.tar" "$TMP/stage-2.oci.tar"

BINARY_SHA256="$(sha256sum "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" | cut -d' ' -f1)"
ROOTFS_SHA256="$(sha256sum "$TMP/rootfs-1.tar" | cut -d' ' -f1)"
OCI_ARCHIVE_SHA256="$(sha256sum "$TMP/stage-1.oci.tar" | cut -d' ' -f1)"
mkdir -p "$TMP/output"
CARGO_HOME="$TMP/cargo-home-1" node "$CRATE_ROOT/scripts/generate-metadata.mjs" \
  "$TMP/source-1/crates/gate-h2-broker" "$TMP/output" "$TARGET" \
  "$GATE_H2_TRUST_ROOTS_SHA256" "$SOURCE_COMMIT" "$SOURCE_TREE" "$TOOLCHAIN_LOCK_SHA256" \
  "$BINARY_SHA256" "$ROOTFS_SHA256" "$OCI_ARCHIVE_SHA256" "$(cat "$TMP/image-1.id")"
install -m 0444 "$TMP/stage-1.oci.tar" "$TMP/output/gate-h2-stage.oci.tar"
install -m 0444 "$TMP/rootfs-1.tar" "$TMP/output/rootfs.tar"
printf '%s\n' \
  "source_commit=$SOURCE_COMMIT" \
  "source_tree=$SOURCE_TREE" \
  "toolchain_lock_sha256=$TOOLCHAIN_LOCK_SHA256" \
  "binary_sha256=$BINARY_SHA256" \
  "rootfs_sha256=$ROOTFS_SHA256" \
  "oci_archive_sha256=$OCI_ARCHIVE_SHA256" \
  "oci_image_id=$(cat "$TMP/image-1.id")" > "$TMP/output/reproducibility.env"
mkdir -p "$OUT"
cp -a "$TMP/output/." "$OUT/"
