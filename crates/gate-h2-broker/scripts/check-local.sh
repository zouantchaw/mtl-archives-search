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
node --check "$ROOT/scripts/publish-oci-output.mjs"
node --check "$ROOT/scripts/admit-and-publish-oci-output.mjs"
node --check "$ROOT/scripts/run-verified-helper.mjs"
node --check "$ROOT/scripts/test-verified-helper-modes.mjs"
node --check "$ROOT/scripts/test-oci-publication.mjs"
node --check "$ROOT/scripts/admit-oci-output.mjs"
node --check "$ROOT/scripts/test-oci-admission.mjs"
node --check "$ROOT/scripts/generate-trusted-sbom.mjs"
node --check "$ROOT/scripts/prepare-trusted-build-inputs.mjs"
node --check "$ROOT/scripts/durable-mkdir.mjs"
node --check "$ROOT/scripts/secure-files.mjs"
node --check "$ROOT/scripts/strict-tar.mjs"
node --check "$ROOT/scripts/create-canonical-tar.mjs"
node --check "$ROOT/scripts/test-tar-fixture.mjs"
node --check "$ROOT/scripts/describe-exported-source.mjs"
node --check "$ROOT/scripts/strict-json.mjs"
node --check "$ROOT/scripts/verify-source-descriptor.mjs"
node --check "$ROOT/scripts/test-source-descriptor-modes.mjs"
if grep -R -l --include='*.mjs' --exclude='test-*.mjs' 'GATE_H2_TEST_' "$ROOT/scripts" >/dev/null; then
  echo "production JavaScript helper contains an activatable test branch" >&2
  exit 1
fi
node "$ROOT/scripts/test-tar-fixture.mjs"
node "$ROOT/scripts/verify-source-descriptor.mjs" >/dev/null
node "$ROOT/scripts/test-source-descriptor-modes.mjs" >/dev/null
node "$ROOT/scripts/verify-toolchain-lock.mjs" "$ROOT/oci/toolchain-lock.v1.json" >/dev/null
if node "$ROOT/scripts/verify-toolchain-lock.mjs" "$ROOT/oci/toolchain-lock.v1.json" \
  'builder.invalid/not-digest-pinned' 'not-a-sha256' >/dev/null 2>&1; then
  echo "hermetic builder lock accepted an invalid image/digest input" >&2
  exit 1
fi
bash -n "$ROOT/scripts/build-stage-oci.sh"
bash -n "$ROOT/scripts/build-stage-oci-inner.sh"
bash -n "$ROOT/scripts/export-tracked-source.sh"
grep -q 'git .* archive' "$ROOT/scripts/export-tracked-source.sh"
! grep -q 'GATE_H2_IN_HERMETIC_BUILDER' "$ROOT/scripts/build-stage-oci.sh"
! grep -q 'git ' "$ROOT/scripts/build-stage-oci-inner.sh"
! grep -Fq -- '-v "$REPO_ROOT:/workspace:ro"' "$ROOT/scripts/build-stage-oci.sh"
! grep -Fq -- 'OUT_PARENT:/gate-h2' "$ROOT/scripts/build-stage-oci.sh"
grep -q 'readelf -lW' "$ROOT/scripts/build-stage-oci-inner.sh"
grep -q 'cmp .*stage-1.oci.tar.*stage-2.oci.tar' "$ROOT/scripts/build-stage-oci-inner.sh"
grep -Fq -- '--tmpfs /tmp:rw,noexec,nosuid,nodev,mode=1777' "$ROOT/scripts/build-stage-oci.sh"
grep -Fq -- '--tmpfs /gate-h2-build:rw,exec,nosuid,nodev,mode=0700,uid=0,gid=0' "$ROOT/scripts/build-stage-oci.sh"
grep -Fq -- 'TMP="$(mktemp -d /gate-h2-build/work.XXXXXX)"' "$ROOT/scripts/build-stage-oci-inner.sh"
! grep -Eq 'CARGO_TARGET_DIR="?/tmp|mktemp -d\)' "$ROOT/scripts/build-stage-oci-inner.sh"
! grep -q 'spawnSync("cargo"' "$ROOT/scripts/run-verified-helper.mjs"
grep -q 'pass_1_sha256.*pass_2_sha256' "$ROOT/scripts/build-stage-oci-inner.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$ROOT/scripts/test-build-orchestration.mjs"
node "$ROOT/scripts/test-verified-helper-modes.mjs"
node "$ROOT/scripts/test-oci-publication.mjs"
node "$ROOT/scripts/test-oci-admission.mjs"
printf 'deterministic layer fixture\n' > "$TMP/layer.tar"
(umask 077; node "$ROOT/scripts/assemble-oci.mjs" "$TMP/layer.tar" "$TMP/layout-077" "$TMP/archive-077.tar" > "$TMP/digest-077")
(umask 002; node "$ROOT/scripts/assemble-oci.mjs" "$TMP/layer.tar" "$TMP/layout-002" "$TMP/archive-002.tar" > "$TMP/digest-002")
diff -r "$TMP/layout-077" "$TMP/layout-002"
cmp "$TMP/digest-077" "$TMP/digest-002"
cmp "$TMP/archive-077.tar" "$TMP/archive-002.tar"
node -e 'const fs=require("fs"),p=require("path"),c=require("crypto"); const scan=(root,dir=root)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const q=p.join(dir,e.name),s=fs.statSync(q),r=p.relative(root,q); return e.isDirectory()?[`${r}/\t${(s.mode&0o7777).toString(8)}`,...scan(root,q)]:[`${r}\t${(s.mode&0o7777).toString(8)}\t${c.createHash("sha256").update(fs.readFileSync(q)).digest("hex")}`]}).sort().join("\n"); if(scan(process.argv[1])!==scan(process.argv[2])) process.exit(1)' "$TMP/layout-077" "$TMP/layout-002"
DESCRIPTOR="$ROOT/../../docs/dataset-factory/fixtures/https-broker-runtime-v1/source-descriptor-v1.json"
for mutation in member member_mode member_hash member_bytes hash file_count byte_count; do
  node - "$DESCRIPTOR" "$TMP/source-descriptor-$mutation.json" "$mutation" <<'NODE'
const fs = require("fs");
const [input, output, mutation] = process.argv.slice(2);
const descriptor = JSON.parse(fs.readFileSync(input));
if (mutation === "member") descriptor.source_tree.members.pop();
if (mutation === "member_mode") descriptor.source_tree.members[0].git_mode = descriptor.source_tree.members[0].git_mode === "100644" ? "100755" : "100644";
if (mutation === "member_hash") descriptor.source_tree.members[0].sha256 = "0".repeat(64);
if (mutation === "member_bytes") descriptor.source_tree.members[0].bytes += 1;
if (mutation === "hash") descriptor.source_tree.sha256 = "0".repeat(64);
if (mutation === "file_count") descriptor.source_tree.file_count += 1;
if (mutation === "byte_count") descriptor.source_tree.byte_count += 1;
fs.writeFileSync(output, `${JSON.stringify(descriptor)}\n`);
NODE
  if node "$ROOT/scripts/verify-source-descriptor.mjs" "$TMP/source-descriptor-$mutation.json" >/dev/null 2>&1; then
    echo "source descriptor accepted stale $mutation metadata" >&2
    exit 1
  fi
done
