#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cargo fmt --manifest-path "$ROOT/Cargo.toml" -- --check
cargo clippy --manifest-path "$ROOT/Cargo.toml" --locked --offline --all-targets -- -D warnings
GATE_H2_RUN_TS_ORACLE=1 cargo test --manifest-path "$ROOT/Cargo.toml" --locked --offline --all-targets
node --check "$ROOT/scripts/generate-metadata.mjs"
node --check "$ROOT/scripts/assemble-oci.mjs"
node --check "$ROOT/scripts/verify-toolchain-lock.mjs"
node --check "$ROOT/scripts/validate-uds-response.mjs"
node "$ROOT/scripts/verify-toolchain-lock.mjs" "$ROOT/oci/toolchain-lock.v1.json" >/dev/null
if node "$ROOT/scripts/verify-toolchain-lock.mjs" "$ROOT/oci/toolchain-lock.v1.json" \
  'builder.invalid/not-digest-pinned' 'not-a-sha256' >/dev/null 2>&1; then
  echo "hermetic builder lock accepted an invalid image/digest input" >&2
  exit 1
fi
bash -n "$ROOT/scripts/build-stage-oci.sh"
grep -q 'git .* archive' "$ROOT/scripts/build-stage-oci.sh"
grep -q 'readelf -lW' "$ROOT/scripts/build-stage-oci.sh"
grep -q 'cmp .*stage-1.oci.tar.*stage-2.oci.tar' "$ROOT/scripts/build-stage-oci.sh"
