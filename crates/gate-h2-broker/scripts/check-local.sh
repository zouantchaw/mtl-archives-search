#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cargo fmt --manifest-path "$ROOT/Cargo.toml" -- --check
cargo clippy --manifest-path "$ROOT/Cargo.toml" --locked --offline --all-targets -- -D warnings
GATE_H2_RUN_TS_ORACLE=1 cargo test --manifest-path "$ROOT/Cargo.toml" --locked --offline --all-targets
node --check "$ROOT/scripts/generate-metadata.mjs"
bash -n "$ROOT/scripts/build-stage-oci.sh"
grep -q 'git .* archive' "$ROOT/scripts/build-stage-oci.sh"
grep -q 'readelf -lW' "$ROOT/scripts/build-stage-oci.sh"
grep -q 'cmp .*stage-1.oci.tar.*stage-2.oci.tar' "$ROOT/scripts/build-stage-oci.sh"
