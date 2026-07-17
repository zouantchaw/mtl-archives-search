#!/usr/bin/env bash
set -euo pipefail
umask 022
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
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf 'deterministic layer fixture\n' > "$TMP/layer.tar"
(umask 077; node "$ROOT/scripts/assemble-oci.mjs" "$TMP/layer.tar" "$TMP/layout-077" "$TMP/archive-077.tar" --layout-only > "$TMP/digest-077")
(umask 002; node "$ROOT/scripts/assemble-oci.mjs" "$TMP/layer.tar" "$TMP/layout-002" "$TMP/archive-002.tar" --layout-only > "$TMP/digest-002")
diff -r "$TMP/layout-077" "$TMP/layout-002"
cmp "$TMP/digest-077" "$TMP/digest-002"
node -e 'const fs=require("fs"),p=require("path"),c=require("crypto"); const scan=(root,dir=root)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const q=p.join(dir,e.name),s=fs.statSync(q),r=p.relative(root,q); return e.isDirectory()?[`${r}/\t${(s.mode&0o777).toString(8)}`,...scan(root,q)]:[`${r}\t${(s.mode&0o777).toString(8)}\t${c.createHash("sha256").update(fs.readFileSync(q)).digest("hex")}`]}).sort().join("\n"); if(scan(process.argv[1])!==scan(process.argv[2])) process.exit(1)' "$TMP/layout-077" "$TMP/layout-002"
if ! tar --help 2>&1 | grep -q -- '--sort'; then
  echo "gate H2 full OCI archive cross-umask proof requires the issue #101 GNU-tar Linux builder; canonical layout bytes/modes match locally" >&2
fi
