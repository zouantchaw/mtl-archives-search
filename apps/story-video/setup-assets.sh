#!/bin/bash
# Copy room background images from next-app into the Remotion public folder.
# Run this once after a fresh clone, or whenever background images change.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/../next-app/public/images"
DEST="$SCRIPT_DIR/public/images"

mkdir -p "$DEST/backgrounds" "$DEST/items"

for f in \
  montreal_bright_airy_plateau_living_room.png \
  montrea_loft_living_room.png \
  montreal_cozy_living_room.png \
  montreal_cozy_coffee_store.png; do
  cp "$SRC/backgrounds/$f" "$DEST/backgrounds/"
done

cp "$SRC/items/wooden-hanger-rail.png" "$DEST/items/"

echo "Assets copied to $DEST"
