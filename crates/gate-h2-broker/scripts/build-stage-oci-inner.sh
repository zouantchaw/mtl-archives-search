#!/usr/bin/env bash
set -euo pipefail
umask 077

REPO_ROOT="${GATE_H2_MEASURED_SOURCE:?builder-owned measured source snapshot required}"
CRATE_ROOT="$REPO_ROOT/crates/gate-h2-broker"
OUT="${1:?dedicated empty candidate directory required}"
HELPER_OUT="${2:?dedicated empty host-helper directory required}"
TARGET=x86_64-unknown-linux-musl
TOOLCHAIN_LOCK="$CRATE_ROOT/oci/toolchain-lock.v1.json"
[[ "$OUT" == /gate-h2-output && -d "$OUT" && -z "$(find "$OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "inner builder only writes its dedicated empty candidate mount" >&2; exit 65; }
[[ "$HELPER_OUT" == /gate-h2-host-helpers && -d "$HELPER_OUT" && -z "$(find "$HELPER_OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "inner builder requires a dedicated empty helper mount" >&2; exit 65; }
[[ -d /gate-h2-build && -x /gate-h2-build ]] || { echo "dedicated executable build tmpfs missing" >&2; exit 65; }
[[ ! -e "$REPO_ROOT/.git" ]] || { echo "sanitized source unexpectedly contains .git" >&2; exit 65; }
for command in bash cargo cmp cp cut find grep install mkdir mktemp node readelf sha256sum sort tar touch x86_64-linux-musl-gcc; do
  command -v "$command" >/dev/null || { echo "hermetic builder omits required tool: $command" >&2; exit 78; }
done
: "${GATE_H2_BUILDER_IMAGE:?missing builder image}"
: "${GATE_H2_BUILDER_IMAGE_DIGEST:?missing builder digest}"
: "${GATE_H2_TRUST_ROOTS:?missing trust roots}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?missing trust-root digest}"
: "${GATE_H2_SOURCE_DESCRIPTOR:?missing host source descriptor}"
SOURCE_JSON="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])); for(const k of ["source_commit","source_tree","source_allowlist_sha256","source_archive_sha256","source_manifest_sha256","source_file_count","source_byte_count"]) process.stdout.write(`${d[k]}\n`)' "$GATE_H2_SOURCE_DESCRIPTOR")"
mapfile -t SOURCE_FIELDS <<< "$SOURCE_JSON"
SOURCE_COMMIT="${SOURCE_FIELDS[0]}"; SOURCE_TREE="${SOURCE_FIELDS[1]}"; SOURCE_ALLOWLIST_SHA256="${SOURCE_FIELDS[2]}"; SOURCE_ARCHIVE_SHA256="${SOURCE_FIELDS[3]}"; SOURCE_MANIFEST_SHA256="${SOURCE_FIELDS[4]}"; SOURCE_FILE_COUNT="${SOURCE_FIELDS[5]}"; SOURCE_BYTE_COUNT="${SOURCE_FIELDS[6]}"
[[ "$SOURCE_MANIFEST_SHA256" == "${GATE_H2_MEASURED_SOURCE_MANIFEST_SHA256:?measured source manifest pin required}" ]] || { echo "measured source manifest does not match descriptor" >&2; exit 65; }
TOOLCHAIN_LOCK_SHA256="$(node "$CRATE_ROOT/scripts/verify-toolchain-lock.mjs" "$TOOLCHAIN_LOCK" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST")"
[[ "$(sha256sum "$GATE_H2_TRUST_ROOTS" | cut -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }

TMP="$(mktemp -d /gate-h2-build/work.XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
export TMPDIR=/gate-h2-build SOURCE_DATE_EPOCH=0 CARGO_NET_OFFLINE=true TZ=UTC LC_ALL=C
export RUSTFLAGS="-C target-feature=+crt-static -C link-arg=-Wl,--build-id=none"
unset GATE_H2_ADMITTED_CODE_ID GATE_H2_LAUNCH_AUTHORITY_TRUST_JSON
declare -a OCI_IMAGE_ID
for pass in 1 2; do
  mkdir -p "$TMP/target-$pass" "$TMP/rootfs-$pass"
  CARGO_TARGET_DIR="$TMP/target-$pass" cargo build --manifest-path "$CRATE_ROOT/Cargo.toml" --locked --offline --release --target "$TARGET" --bin gate-h2-broker --bin gate-h2-stage-runtime --bin gate-h2-publish-noreplace --bin gate-h2-secure-candidate-read
  for binary in gate-h2-broker gate-h2-stage-runtime gate-h2-publish-noreplace gate-h2-secure-candidate-read; do
    readelf -lW "$TMP/target-$pass/$TARGET/release/$binary" > "$TMP/$binary-program-$pass"
    readelf -dW "$TMP/target-$pass/$TARGET/release/$binary" > "$TMP/$binary-dynamic-$pass"
    ! grep -q INTERP "$TMP/$binary-program-$pass" || { echo "ELF interpreter is forbidden" >&2; exit 65; }
    ! grep -q NEEDED "$TMP/$binary-dynamic-$pass" || { echo "dynamic dependency is forbidden" >&2; exit 65; }
  done
  install -D -m 0555 "$TMP/target-$pass/$TARGET/release/gate-h2-stage-runtime" "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  install -D -m 0444 "$GATE_H2_TRUST_ROOTS" "$TMP/rootfs-$pass/etc/ssl/certs/ca-certificates.crt"
  find "$TMP/rootfs-$pass" -type d -exec chmod 0755 {} +
  find "$TMP/rootfs-$pass" -type f -exec chmod 0444 {} +
  chmod 0555 "$TMP/rootfs-$pass/usr/local/bin/gate-h2-stage-runtime"
  find "$TMP/rootfs-$pass" -exec touch -h -d @0 {} +
  (cd "$TMP/rootfs-$pass" && find . -type f -printf '/%P %m\n' | sort) > "$TMP/rootfs-$pass.inventory"
  cmp "$CRATE_ROOT/oci/rootfs-inventory.expected.txt" "$TMP/rootfs-$pass.inventory"
  node "$CRATE_ROOT/scripts/create-canonical-tar.mjs" "$TMP/rootfs-$pass" "$TMP/rootfs-$pass.tar"
  OCI_IMAGE_ID[$pass]="$(node "$CRATE_ROOT/scripts/assemble-oci.mjs" "$TMP/rootfs-$pass.tar" "$TMP/oci-layout-$pass" "$TMP/stage-$pass.oci.tar")"
done
for artifact in gate-h2-broker gate-h2-stage-runtime gate-h2-publish-noreplace gate-h2-secure-candidate-read; do cmp "$TMP/target-1/$TARGET/release/$artifact" "$TMP/target-2/$TARGET/release/$artifact"; done
cmp "$TMP/rootfs-1.tar" "$TMP/rootfs-2.tar"; cmp "$TMP/stage-1.oci.tar" "$TMP/stage-2.oci.tar"
[[ "${OCI_IMAGE_ID[1]}" == "${OCI_IMAGE_ID[2]}" ]] || exit 65
BROKER_SHA256="$(sha256sum "$TMP/target-1/$TARGET/release/gate-h2-broker" | cut -d' ' -f1)"
STAGE_SHA256="$(sha256sum "$TMP/target-1/$TARGET/release/gate-h2-stage-runtime" | cut -d' ' -f1)"
ROOTFS_SHA256="$(sha256sum "$TMP/rootfs-1.tar" | cut -d' ' -f1)"; OCI_SHA256="$(sha256sum "$TMP/stage-1.oci.tar" | cut -d' ' -f1)"
node "$CRATE_ROOT/scripts/generate-metadata.mjs" "$CRATE_ROOT" "$OUT" "$TARGET" "$GATE_H2_TRUST_ROOTS_SHA256" "$SOURCE_COMMIT" "$SOURCE_TREE" "$SOURCE_ALLOWLIST_SHA256" "$SOURCE_ARCHIVE_SHA256" "$SOURCE_MANIFEST_SHA256" "$SOURCE_FILE_COUNT" "$SOURCE_BYTE_COUNT" "$TOOLCHAIN_LOCK_SHA256" "$BROKER_SHA256" "$STAGE_SHA256" "$ROOTFS_SHA256" "$OCI_SHA256" "${OCI_IMAGE_ID[1]}" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST"
install -m 0555 "$TMP/target-1/$TARGET/release/gate-h2-broker" "$OUT/gate-h2-broker"
install -m 0444 "$TMP/stage-1.oci.tar" "$OUT/gate-h2-stage.oci.tar"; install -m 0444 "$TMP/rootfs-1.tar" "$OUT/rootfs.tar"
printf '%s\n' "candidate_only=true" > "$OUT/INNER-CANDIDATE"
chmod 0444 "$OUT/INNER-CANDIDATE" "$OUT/provenance.json" "$OUT/sbom.cdx.json"
for helper in gate-h2-publish-noreplace gate-h2-secure-candidate-read; do
  install -m 0555 "$TMP/target-1/$TARGET/release/$helper" "$HELPER_OUT/$helper"
  install -m 0444 "$TMP/target-1/$TARGET/release/$helper" "$HELPER_OUT/$helper.pass-1"
  install -m 0444 "$TMP/target-2/$TARGET/release/$helper" "$HELPER_OUT/$helper.pass-2"
done
node - "$HELPER_OUT" "$SOURCE_MANIFEST_SHA256" "$GATE_H2_BUILDER_IMAGE_DIGEST" "$TMP/target-1/$TARGET/release" "$TMP/target-2/$TARGET/release" <<'NODE'
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
chmod 0444 "$HELPER_OUT/helper-manifest.v1.json" "$HELPER_OUT"/*.pass-1 "$HELPER_OUT"/*.pass-2
printf 'GATEH2_HELPER_MANIFEST_SHA256=%s\n' "$(sha256sum "$HELPER_OUT/helper-manifest.v1.json" | cut -d' ' -f1)"
