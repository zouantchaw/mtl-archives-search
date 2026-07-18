#!/usr/bin/env bash
set -euo pipefail
umask 077

CRATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$CRATE_ROOT" rev-parse --show-toplevel)"
OUT="${1:-$CRATE_ROOT/dist}"
TOOLCHAIN_LOCK="$CRATE_ROOT/oci/toolchain-lock.v1.json"

[[ "$(uname -s)" == Linux ]] || { echo "gate H2 OCI proof requires Linux; retain as issue #101 evidence gate" >&2; exit 78; }
command -v podman >/dev/null || { echo "podman is required only to execute the hermetic builder" >&2; exit 78; }
: "${GATE_H2_BUILDER_IMAGE:?set the reviewed name@sha256:digest builder input}"
: "${GATE_H2_BUILDER_IMAGE_DIGEST:?set its separately reviewed 64-hex digest}"
: "${GATE_H2_TRUST_ROOTS:?set the reviewed trust-root file}"
: "${GATE_H2_TRUST_ROOTS_SHA256:?set its reviewed SHA-256}"
[[ "$GATE_H2_BUILDER_IMAGE_DIGEST" =~ ^[a-f0-9]{64}$ && "$GATE_H2_BUILDER_IMAGE" == *@sha256:"$GATE_H2_BUILDER_IMAGE_DIGEST" ]] || { echo "builder image reference/digest mismatch" >&2; exit 65; }
[[ -f "$GATE_H2_TRUST_ROOTS" && ! -L "$GATE_H2_TRUST_ROOTS" ]] || { echo "trust-root input must be a regular non-symlink file" >&2; exit 66; }
[[ "$(sha256sum "$GATE_H2_TRUST_ROOTS" | cut -d' ' -f1)" == "$GATE_H2_TRUST_ROOTS_SHA256" ]] || { echo "trust-root pin mismatch" >&2; exit 65; }
[[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || { echo "source worktree must be clean" >&2; exit 65; }
[[ ! -e "$OUT" && ! -L "$OUT" ]] || { echo "publication destination already exists" >&2; exit 65; }

SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse 'HEAD^{tree}')"
OUT_PARENT="$(dirname "$OUT")"
[[ -d "$OUT_PARENT" && ! -L "$OUT_PARENT" ]] || { echo "publication parent must already be a real directory" >&2; exit 66; }
OUT_PARENT="$(cd "$OUT_PARENT" && pwd -P)"
OUT="$OUT_PARENT/$(basename "$OUT")"
HOST_TMP="$(mktemp -d "$OUT_PARENT/.gate-h2-host-XXXXXX")"
chmod 0700 "$HOST_TMP"
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP" 0700 --existing
trap 'rm -rf "$HOST_TMP"' EXIT
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP/builder-output" 0700
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP/host-helpers" 0700
install -m 0500 "$CRATE_ROOT/scripts/verify-and-snapshot-source.sh" "$HOST_TMP/verify-and-snapshot-source.sh"
bash "$CRATE_ROOT/scripts/export-tracked-source.sh" "$REPO_ROOT" "$HOST_TMP/source" \
  "$HOST_TMP/source-export.json" "$SOURCE_COMMIT" "$SOURCE_TREE"
TOOLCHAIN_LOCK_SHA256="$(node "$CRATE_ROOT/scripts/verify-toolchain-lock.mjs" "$TOOLCHAIN_LOCK" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST")"
CARGO_LOCK_SHA256="$(node "$CRATE_ROOT/scripts/prepare-trusted-build-inputs.mjs" \
  "$HOST_TMP/source" "$HOST_TMP/expected-sbom.cdx.json")"
SOURCE_DESCRIPTOR_SHA256="$(sha256sum "$HOST_TMP/source-export.json" | cut -d' ' -f1)"
EXPECTED_SBOM_SHA256="$(sha256sum "$HOST_TMP/expected-sbom.cdx.json" | cut -d' ' -f1)"

BUILDER_RECEIPT="$(podman run --rm --pull=never --network=none --read-only -i \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,mode=1777 \
  --tmpfs /gate-h2-build:rw,exec,nosuid,nodev,mode=0700,uid=0,gid=0 \
  -e GATE_H2_BUILDER_IMAGE -e GATE_H2_BUILDER_IMAGE_DIGEST \
  -e GATE_H2_TRUST_ROOTS=/gate-h2-inputs/ca-certificates.crt \
  -e GATE_H2_TRUST_ROOTS_SHA256 -e GATE_H2_SOURCE_DESCRIPTOR=/gate-h2-inputs/source-export.json \
  -v "$HOST_TMP/source:/workspace:ro" \
  -v "$HOST_TMP/source-export.json:/gate-h2-inputs/source-export.json:ro" \
  -v "$GATE_H2_TRUST_ROOTS:/gate-h2-inputs/ca-certificates.crt:ro" \
  -v "$HOST_TMP/builder-output:/gate-h2-output:rw" \
  -v "$HOST_TMP/host-helpers:/gate-h2-host-helpers:rw" \
  -w /workspace "$GATE_H2_BUILDER_IMAGE" \
  bash -s -- /workspace /gate-h2-inputs/source-export.json /gate-h2-build/measured-source \
  /gate-h2-build/measured-source/crates/gate-h2-broker/scripts/build-stage-oci-inner.sh \
  /gate-h2-output /gate-h2-host-helpers < "$HOST_TMP/verify-and-snapshot-source.sh")"
[[ "$BUILDER_RECEIPT" =~ ^GATEH2_HELPER_MANIFEST_SHA256=([a-f0-9]{64})$ ]] || { echo "invalid pinned-builder receipt" >&2; exit 65; }
HELPER_MANIFEST_SHA256="${BASH_REMATCH[1]}"

# Trusted host admission re-measures every candidate and joins it to inputs that
# were computed outside the container. The inner entrypoint cannot publish.
node "$CRATE_ROOT/scripts/admit-and-publish-oci-output.mjs" "$HOST_TMP/host-helpers" "$HELPER_MANIFEST_SHA256" "$HOST_TMP/builder-output" \
  "$HOST_TMP/admitted" "$OUT" "$HOST_TMP/source-export.json" "$SOURCE_DESCRIPTOR_SHA256" "$HOST_TMP/expected-sbom.cdx.json" "$EXPECTED_SBOM_SHA256" "$TOOLCHAIN_LOCK_SHA256" \
  "$CARGO_LOCK_SHA256" "$GATE_H2_TRUST_ROOTS_SHA256" "$GATE_H2_BUILDER_IMAGE" "$GATE_H2_BUILDER_IMAGE_DIGEST"
