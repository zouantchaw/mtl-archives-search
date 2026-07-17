#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cargo fmt --manifest-path "$ROOT/Cargo.toml" -- --check
cargo clippy --manifest-path "$ROOT/Cargo.toml" --locked --offline --all-targets -- -D warnings
cargo test --manifest-path "$ROOT/Cargo.toml" --locked --offline
node --check "$ROOT/scripts/generate-metadata.mjs"
