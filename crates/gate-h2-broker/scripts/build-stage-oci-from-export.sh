#!/usr/bin/env bash
set -euo pipefail
umask 077

# This clean-host entrypoint requires a pre-exported source tree, its
# descriptor, matching Git archive and bundle proof, reviewed trust PEM, and
# reviewed builder identity. The image-owned verifier performs Git proof.
CRATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:?pre-exported exact source directory required}"
SOURCE_DESCRIPTOR="${2:?source descriptor required}"
OUT="${3:?empty publication destination required}"

: "${GATE_H2_BUILDER_IMAGE:?set the reviewed name@sha256:digest builder input}"
: "${GATE_H2_BUILDER_IMAGE_DIGEST:?set its separately reviewed 64-hex digest}"
: "${GATE_H2_TRUST_ROOTS:?set the reviewed trust-root file}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?set its reviewed SHA-256}"
: "${GATE_H2_SOURCE_ARCHIVE:?set the exact source archive that the descriptor claims}"
: "${GATE_H2_SOURCE_GIT_BUNDLE:?set the Git bundle proving descriptor commit/tree claims}"
[[ -d "$SOURCE" && ! -L "$SOURCE" && ! -e "$SOURCE/.git" ]] || { echo "source export must be a real Git-free directory" >&2; exit 66; }
[[ ! -e "$SOURCE/.cargo" ]] || { echo "source export must not contain Cargo configuration" >&2; exit 65; }
[[ -z "$(find "$SOURCE" -type l -print -quit)" ]] || { echo "source export must not contain symlinks" >&2; exit 65; }
[[ -f "$SOURCE_DESCRIPTOR" && ! -L "$SOURCE_DESCRIPTOR" ]] || { echo "source descriptor must be a regular non-symlink file" >&2; exit 66; }
[[ -f "$GATE_H2_TRUST_ROOTS" && ! -L "$GATE_H2_TRUST_ROOTS" ]] || { echo "trust-root input must be a regular non-symlink file" >&2; exit 66; }
[[ -f "$GATE_H2_SOURCE_ARCHIVE" && ! -L "$GATE_H2_SOURCE_ARCHIVE" ]] || { echo "source archive must be a regular non-symlink file" >&2; exit 66; }
[[ -f "$GATE_H2_SOURCE_GIT_BUNDLE" && ! -L "$GATE_H2_SOURCE_GIT_BUNDLE" ]] || { echo "source Git bundle must be a regular non-symlink file" >&2; exit 66; }
[[ "$GATE_H2_BUILDER_IMAGE_DIGEST" =~ ^[a-f0-9]{64}$ && "$GATE_H2_BUILDER_IMAGE" == *@sha256:"$GATE_H2_BUILDER_IMAGE_DIGEST" ]] || { echo "builder image reference/digest mismatch" >&2; exit 65; }
[[ "$GATE_H2_TRUST_ROOTS_SHA256" =~ ^[a-f0-9]{64}$ && "$(sha256sum "$GATE_H2_TRUST_ROOTS" | cut -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }
[[ ! -e "$OUT" && ! -L "$OUT" ]] || { echo "publication destination must be empty and not pre-existing" >&2; exit 65; }
[[ "$(uname -s)" == Linux ]] || { echo "gate H2 OCI proof requires Linux; retain as issue #101 evidence gate" >&2; exit 78; }
OUT_PARENT="$(dirname "$OUT")"
[[ -d "$OUT_PARENT" && ! -L "$OUT_PARENT" ]] || { echo "publication parent must already be a real directory" >&2; exit 66; }
OUT_PARENT="$(cd "$OUT_PARENT" && pwd -P)"
OUT="$OUT_PARENT/$(basename "$OUT")"
command -v podman >/dev/null || { echo "podman is required only to execute the hermetic builder" >&2; exit 78; }

HOST_TMP="$(mktemp -d "$OUT_PARENT/.gate-h2-host-XXXXXX")"
chmod 0711 "$HOST_TMP"
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP" 0711 --existing
trap 'rm -rf "$HOST_TMP"' EXIT
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP/builder-output" 0700
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP/expected-sbom" 0700
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP/host-helpers" 0700
STAGING_RECEIPT="$(node "$CRATE_ROOT/scripts/stage-rootless-build-inputs.mjs" "$SOURCE" "$SOURCE_DESCRIPTOR" "$GATE_H2_SOURCE_ARCHIVE" "$GATE_H2_SOURCE_GIT_BUNDLE" "$GATE_H2_TRUST_ROOTS" "$HOST_TMP/inputs")"
[[ "$STAGING_RECEIPT" =~ ^GATEH2_STAGED_INPUTS_V1\ source_descriptor_sha256=([a-f0-9]{64})$ ]] || { echo "invalid retained staging receipt" >&2; exit 65; }
SOURCE_DESCRIPTOR_SHA256="${BASH_REMATCH[1]}"
STAGED_SOURCE="$HOST_TMP/inputs/source"
STAGED_DESCRIPTOR="$HOST_TMP/inputs/source-export.json"
STAGED_ARCHIVE="$HOST_TMP/inputs/source-export.tar"
STAGED_BUNDLE="$HOST_TMP/inputs/source-proof.bundle"
STAGED_TRUST_ROOTS="$HOST_TMP/inputs/ca-certificates.crt"

# keep-id maps host-owned output binds to uid/gid 65532. --user 0:0 is still
# required: keep-id otherwise makes the image init user the mapped host user.
# The root supervisor receives only SETUID, SETGID, and SETPCAP so its exact
# setpriv transition can clear all child capabilities without DAC authority.
PODMAN_ROOTLESS="$(podman info --format '{{.Host.Security.Rootless}}')"
[[ "$PODMAN_ROOTLESS" == true ]] || { echo "gate H2 requires rootless Podman" >&2; exit 78; }
printf 'GATEH2_PODMAN_ROOTLESS=true\n' >&2
declare -a PODMAN_RUN=(run --rm --pull=never --network=none --read-only -i
  --userns=keep-id:uid=65532,gid=65532 --user 0:0 --entrypoint /opt/gate-h2/bin/env
  --cap-drop=all --cap-add=SETUID --cap-add=SETGID --cap-add=SETPCAP
  --security-opt=no-new-privileges
  --tmpfs /tmp:rw,noexec,nosuid,nodev,mode=0700,uid=0,gid=0
  --tmpfs /gate-h2-build:rw,exec,nosuid,nodev,mode=0700,uid=0,gid=0
  --tmpfs /gate-h2-work:rw,exec,nosuid,nodev,mode=0700,uid=65532,gid=65532
  -v "$STAGED_SOURCE:/workspace:ro"
  -v "$STAGED_DESCRIPTOR:/gate-h2-inputs/source-export.json:ro"
  -v "$STAGED_ARCHIVE:/gate-h2-inputs/source-export.tar:ro"
  -v "$STAGED_BUNDLE:/gate-h2-inputs/source-proof.bundle:ro"
  -v "$STAGED_TRUST_ROOTS:/gate-h2-inputs/ca-certificates.crt:ro"
  -v "$HOST_TMP/builder-output:/gate-h2-output:rw"
  -v "$HOST_TMP/expected-sbom:/gate-h2-expected-sbom:rw"
  -v "$HOST_TMP/host-helpers:/gate-h2-host-helpers:rw"
  -w /workspace "$GATE_H2_BUILDER_IMAGE" -i
  PATH=/opt/gate-h2/bin HOME=/nonexistent CARGO_HOME=/opt/gate-h2/cargo-home TMPDIR=/tmp LC_ALL=C TZ=UTC SOURCE_DATE_EPOCH=0 CARGO_NET_OFFLINE=true GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  GATE_H2_BUILDER_IMAGE="$GATE_H2_BUILDER_IMAGE" GATE_H2_BUILDER_IMAGE_DIGEST="$GATE_H2_BUILDER_IMAGE_DIGEST"
  GATE_H2_TRUST_ROOTS=/gate-h2-inputs/ca-certificates.crt GATE_H2_TRUST_ROOTS_SHA256="$GATE_H2_TRUST_ROOTS_SHA256"
  GATE_H2_SOURCE_DESCRIPTOR_SHA256="$SOURCE_DESCRIPTOR_SHA256")
BOUNDARY_RECEIPT="$(podman "${PODMAN_RUN[@]}" /opt/gate-h2/bin/node /opt/gate-h2/libexec/verify-rootless-boundary.mjs)"
EXPECTED_BOUNDARY_RECEIPT='GATEH2_ROOTLESS_BOUNDARY_V1 supervisor=0:0 supervisor_nnp=true supervisor_caps=setgid,setuid,setpcap supervisor_inputs=ro child=65532:65532 child_nnp=true child_caps=none child_inputs=ro outputs=rw work=rw tmp=root-only snapshot=ro'
[[ "$BOUNDARY_RECEIPT" == "$EXPECTED_BOUNDARY_RECEIPT" ]] || { echo "rootless Podman boundary preflight failed" >&2; exit 78; }
printf '%s\n' "$BOUNDARY_RECEIPT" >&2
for directory in "$HOST_TMP/builder-output" "$HOST_TMP/expected-sbom" "$HOST_TMP/host-helpers"; do
  [[ -z "$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "rootless boundary preflight left mutable output state" >&2; exit 65; }
done

BUILDER_RECEIPT="$(podman "${PODMAN_RUN[@]}" \
  /opt/gate-h2/libexec/verify-and-snapshot-source.sh /workspace /gate-h2-inputs/source-export.json /gate-h2-inputs/source-export.tar /gate-h2-inputs/source-proof.bundle /gate-h2-build/measured-source \
  /gate-h2-build/measured-source/crates/gate-h2-broker/scripts/build-stage-oci-inner.sh \
  /gate-h2-output /gate-h2-host-helpers /gate-h2-expected-sbom)"
mapfile -t BUILDER_RECEIPT_LINES <<< "$BUILDER_RECEIPT"
[[ "${#BUILDER_RECEIPT_LINES[@]}" -eq 3 && "${BUILDER_RECEIPT_LINES[0]}" =~ ^GATEH2_HELPER_MANIFEST_SHA256=([a-f0-9]{64})$ ]] || { echo "invalid pinned-builder helper receipt" >&2; exit 65; }
HELPER_MANIFEST_SHA256="${BASH_REMATCH[1]}"
[[ "${BUILDER_RECEIPT_LINES[1]}" =~ ^GATEH2_TOOLCHAIN_LOCK_SHA256=([a-f0-9]{64})$ ]] || { echo "invalid pinned-builder toolchain receipt" >&2; exit 65; }
TOOLCHAIN_LOCK_SHA256="${BASH_REMATCH[1]}"
[[ "${BUILDER_RECEIPT_LINES[2]}" =~ ^GATEH2_CARGO_LOCK_SHA256=([a-f0-9]{64})$ ]] || { echo "invalid pinned-builder Cargo receipt" >&2; exit 65; }
CARGO_LOCK_SHA256="${BASH_REMATCH[1]}"
EXPECTED_SBOM="$HOST_TMP/expected-sbom/expected-sbom.cdx.json"
[[ -f "$EXPECTED_SBOM" && ! -L "$EXPECTED_SBOM" && "$(find "$HOST_TMP/expected-sbom" -mindepth 1 -maxdepth 1 -printf '%f\n')" == expected-sbom.cdx.json ]] || { echo "builder did not emit exactly one expected SBOM" >&2; exit 65; }
EXPECTED_SBOM_SHA256="$(sha256sum "$EXPECTED_SBOM" | cut -d' ' -f1)"

# Trusted host admission re-measures every candidate and joins it to the
# builder-generated, in-container cross-checked SBOM. The inner entrypoint cannot publish.
node "$CRATE_ROOT/scripts/admit-and-publish-oci-output.mjs" "$HOST_TMP/host-helpers" "$HELPER_MANIFEST_SHA256" "$HOST_TMP/builder-output" \
  "$HOST_TMP/admitted" "$OUT" "$STAGED_DESCRIPTOR" "$SOURCE_DESCRIPTOR_SHA256" "$EXPECTED_SBOM" "$EXPECTED_SBOM_SHA256" "$TOOLCHAIN_LOCK_SHA256" \
  "$CARGO_LOCK_SHA256" "$GATE_H2_TRUST_ROOTS_SHA256" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST"
