#!/usr/bin/env bash
set -euo pipefail
umask 077

# Git is a convenience source-export front end. It creates the exact HEAD
# archive and proof bundle consumed by the image-owned verifier.
CRATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$CRATE_ROOT" rev-parse --show-toplevel)"
OUT="${1:-$CRATE_ROOT/dist}"
[[ "$(uname -s)" == Linux ]] || { echo "gate H2 OCI proof requires Linux; retain as issue #101 evidence gate" >&2; exit 78; }
[[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || { echo "source worktree must be clean" >&2; exit 65; }
[[ ! -e "$OUT" && ! -L "$OUT" ]] || { echo "publication destination already exists" >&2; exit 65; }
OUT_PARENT="$(dirname "$OUT")"
[[ -d "$OUT_PARENT" && ! -L "$OUT_PARENT" ]] || { echo "publication parent must already be a real directory" >&2; exit 66; }
OUT_PARENT="$(cd "$OUT_PARENT" && pwd -P)"
OUT="$OUT_PARENT/$(basename "$OUT")"
SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse 'HEAD^{tree}')"
HOST_TMP="$(mktemp -d "$OUT_PARENT/.gate-h2-export-XXXXXX")"
chmod 0700 "$HOST_TMP"
trap 'rm -rf "$HOST_TMP"' EXIT
node "$CRATE_ROOT/scripts/durable-mkdir.mjs" "$HOST_TMP/source" 0700
bash "$CRATE_ROOT/scripts/export-tracked-source.sh" "$REPO_ROOT" "$HOST_TMP/source" \
  "$HOST_TMP/source-export.json" "$SOURCE_COMMIT" "$SOURCE_TREE"
git -C "$REPO_ROOT" bundle create "$HOST_TMP/source-proof.bundle" HEAD
# The source-only front end performs the mandatory rootless boundary preflight
# before its separate compilation run.
GATE_H2_SOURCE_ARCHIVE="$HOST_TMP/source.git-archive.tar" \
GATE_H2_SOURCE_GIT_BUNDLE="$HOST_TMP/source-proof.bundle" \
  exec "$CRATE_ROOT/scripts/build-stage-oci-from-export.sh" "$HOST_TMP/source" "$HOST_TMP/source-export.json" "$OUT"
