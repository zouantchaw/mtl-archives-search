#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=x86_64-unknown-linux-musl
OUT="${1:-$ROOT/dist}"

[[ "$(uname -s)" == Linux ]] || { echo "gate H2 OCI verification requires Linux; retain as issue #101 gate" >&2; exit 78; }
command -v podman >/dev/null || { echo "podman is required" >&2; exit 78; }
rustup target list --installed | grep -qx "$TARGET" || { echo "$TARGET is not installed" >&2; exit 78; }
: "${GATE_H2_TRUST_ROOTS:?set GATE_H2_TRUST_ROOTS to reviewed PEM bytes}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?set GATE_H2_TRUST_ROOTS_SHA256 to their reviewed SHA-256}"
[[ -f "$GATE_H2_TRUST_ROOTS" ]] || { echo "trust-root file missing" >&2; exit 66; }
[[ "$(sha256sum "$GATE_H2_TRUST_ROOTS" | cut -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export SOURCE_DATE_EPOCH=0 CARGO_NET_OFFLINE=true RUSTFLAGS="-C target-feature=+crt-static -C link-arg=-Wl,--build-id=none"
for pass in 1 2; do
  CARGO_TARGET_DIR="$TMP/target-$pass" cargo build --manifest-path "$ROOT/Cargo.toml" --locked --offline --release --target "$TARGET" --bin gate-h2-stage-runtime
  install -D -m 0555 "$TMP/target-$pass/$TARGET/release/gate-h2-stage-runtime" "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  install -D -m 0444 "$GATE_H2_TRUST_ROOTS" "$TMP/rootfs-$pass/etc/ssl/certs/ca-certificates.crt"
  find "$TMP/rootfs-$pass" -type f -exec touch -h -d @0 {} +
  (cd "$TMP/rootfs-$pass" && find . -type f -printf '/%P %m\n' | sort) > "$TMP/rootfs-$pass.inventory"
  cmp "$ROOT/oci/rootfs-inventory.expected.txt" "$TMP/rootfs-$pass.inventory"
  (cd "$TMP/rootfs-$pass" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$TMP/rootfs-$pass.sha256"
done
cmp "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" "$TMP/target-2/$TARGET/release/gate-h2-stage-runtime"
cmp "$TMP/rootfs-1.sha256" "$TMP/rootfs-2.sha256"

mkdir -p "$OUT"
rm -rf "$ROOT/oci/rootfs"
cp -a "$TMP/rootfs-1" "$ROOT/oci/rootfs"
node "$ROOT/scripts/generate-metadata.mjs" "$ROOT" "$OUT" "$TARGET" "$GATE_H2_TRUST_ROOTS_SHA256"
for pass in 1 2; do
  podman build --network=none --no-cache --timestamp 0 --format oci --iidfile "$TMP/image-$pass.id" -f "$ROOT/oci/Containerfile" "$ROOT/oci"
  podman save --format oci-archive -o "$TMP/stage-$pass.oci.tar" "$(cat "$TMP/image-$pass.id")"
done
cmp "$TMP/image-1.id" "$TMP/image-2.id"
install -m 0444 "$TMP/stage-1.oci.tar" "$OUT/gate-h2-stage.oci.tar"
cp "$TMP/rootfs-1.sha256" "$OUT/rootfs.sha256"
printf '%s\n' "binary_sha256=$(sha256sum "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" | cut -d' ' -f1)" "oci_image_id=$(cat "$TMP/image-1.id")" > "$OUT/reproducibility.env"
rm -rf "$ROOT/oci/rootfs"
