#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${1:?repository path required}"
DESTINATION="${2:?destination path required}"
DESCRIPTOR="${3:?descriptor path required}"
EXPECTED_COMMIT="${4:?expected commit required}"
EXPECTED_TREE="${5:?expected tree required}"
ALLOWLIST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/oci/source-allowlist.v1.txt"
[[ -z "$(git -C "$REPOSITORY" status --porcelain=v1 --untracked-files=all)" ]] || {
  echo "source worktree must be clean" >&2
  exit 65
}
[[ "$(git -C "$REPOSITORY" rev-parse HEAD)" == "$EXPECTED_COMMIT" ]] || { echo "source commit changed during export" >&2; exit 65; }
[[ "$(git -C "$REPOSITORY" rev-parse HEAD^{tree})" == "$EXPECTED_TREE" ]] || { echo "source tree changed during export" >&2; exit 65; }
node "$(dirname "${BASH_SOURCE[0]}")/durable-mkdir.mjs" "$DESTINATION" 0700
ARCHIVE="${DESTINATION}.git-archive.tar"
[[ -f "$ALLOWLIST" && ! -L "$ALLOWLIST" ]] || { echo "source allowlist must be a regular file" >&2; exit 66; }
ALLOWLIST_LINES=()
while IFS= read -r entry || [[ -n "$entry" ]]; do ALLOWLIST_LINES+=("$entry"); done < "$ALLOWLIST"
[[ "${#ALLOWLIST_LINES[@]}" -gt 0 ]] || { echo "source allowlist is empty" >&2; exit 65; }
declare -a PATHS=()
previous=""
for entry in "${ALLOWLIST_LINES[@]}"; do
  [[ "$entry" =~ ^(100644|100755)\ ([A-Za-z0-9._/-]+)$ ]] || { echo "invalid source allowlist entry" >&2; exit 65; }
  mode="${BASH_REMATCH[1]}"; path="${BASH_REMATCH[2]}"
  [[ "$path" != /* && "$path" != *".."* && "$path" != *"//"* ]] || { echo "unsafe source allowlist path" >&2; exit 65; }
  [[ -z "$previous" || "$previous" < "$path" ]] || { echo "source allowlist paths must be sorted and unique" >&2; exit 65; }
  previous="$path"
  actual="$(git -C "$REPOSITORY" ls-tree "$EXPECTED_COMMIT" -- "$path")"
  [[ "$actual" =~ ^$mode\ blob\ [a-f0-9]{40}\	$path$ ]] || { echo "source allowlist mode/path drift: $path" >&2; exit 65; }
  PATHS+=("$path")
done
git -C "$REPOSITORY" archive --format=tar "$EXPECTED_COMMIT" -- "${PATHS[@]}" > "$ARCHIVE"
(umask 077; tar -xf "$ARCHIVE" -C "$DESTINATION")
node - "$DESTINATION" "$ALLOWLIST" <<'NODE'
const fs = require("fs");
const path = require("path");

const [rootArgument, allowlistPath] = process.argv.slice(2);
const root = path.resolve(rootArgument);
const rootMetadata = fs.lstatSync(root);
if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("source export root must be a real directory");

const entries = fs.readFileSync(allowlistPath, "utf8").trimEnd().split("\n").map((line) => {
  const match = /^(100644|100755) ([A-Za-z0-9._/-]+)$/.exec(line);
  if (!match) throw new Error("invalid source allowlist");
  return { mode: Number.parseInt(match[1].slice(-3), 8), member: match[2] };
});

for (const { mode, member } of entries) {
  const absolute = path.resolve(root, member);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`source member escapes export root: ${member}`);
  let parent = path.dirname(absolute);
  while (parent !== root) {
    const metadata = fs.lstatSync(parent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`source member parent is not a real directory: ${member}`);
    parent = path.dirname(parent);
  }
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const metadata = fs.fstatSync(fd, { bigint: true });
    if (!metadata.isFile() || metadata.nlink !== 1n) throw new Error(`source member must be a single-link regular file: ${member}`);
    fs.fchmodSync(fd, mode);
    if (Number(fs.fstatSync(fd, { bigint: true }).mode & 0o7777n) !== mode) throw new Error(`failed to set exact source member mode: ${member}`);
  } finally {
    fs.closeSync(fd);
  }
}
NODE
node "$(dirname "${BASH_SOURCE[0]}")/describe-exported-source.mjs" \
  "$DESTINATION" "$ARCHIVE" "$DESCRIPTOR" "$EXPECTED_COMMIT" "$EXPECTED_TREE" "$ALLOWLIST"
