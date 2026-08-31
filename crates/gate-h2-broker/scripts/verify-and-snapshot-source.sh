#!/opt/gate-h2/bin/bash
set -euo pipefail
umask 077

# Installed by the reviewed builder image. This shell owns no source logic and
# never reads a checkout helper: the image-owned Node core receives only
# canonical tool paths and mounted data.
NODE=/opt/gate-h2/bin/node
CORE=/opt/gate-h2/libexec/verify-source-proof-core.mjs
GIT=/opt/gate-h2/bin/git
TAR=/opt/gate-h2/bin/tar
STAT=/opt/gate-h2/bin/stat
SETPRIV=/opt/gate-h2/bin/setpriv
for tool in "$NODE" "$GIT" "$TAR" "$STAT" "$SETPRIV"; do
  [[ -f "$tool" && ! -L "$tool" && -x "$tool" ]] || { echo "image source verifier runtime member missing: $tool" >&2; exit 78; }
done
[[ -f "$CORE" && ! -L "$CORE" && ! -x "$CORE" && "$("$STAT" -c '%u:%g:%a' "$CORE")" == 0:0:444 ]] || { echo "image source proof core must be a root-owned 0444 data file" >&2; exit 78; }
exec "$NODE" "$CORE" "$1" "$2" "$3" "$4" "$5" "$GIT" "$TAR" "$SETPRIV" -- "${@:6}"
