#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/canonical-image-recovery-v1-<sha256>.tar.gz" >&2
  exit 2
fi

bundle=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

npm run dataset-factory:canonical-image-recovery-bundle-v1 -- --mode restore --bundle "$bundle"
DATASET_FACTORY_FIXED_NOW=2026-07-11T13:00:00.000Z npm run dataset-factory:canonical-image-recovery-v1 -- --max-response-bytes 134217728
npm run dataset-factory:visual-family-check-v1 -- --recovery-root data/mtl_archives/reports/canonical_image_recovery_v1

evaluation=$(mktemp -d)
trap 'rm -rf "$evaluation"' EXIT
DATASET_FACTORY_FIXED_NOW=2026-07-11T13:00:00.000Z npm run dataset-factory:visual-family-search-eval-v1 -- \
  --candidates data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl \
  --map data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/record-leakage-map-v1.jsonl \
  --output "$evaluation"
cmp "$evaluation/search-duplicate-task-metrics-v1.jsonl" \
  data/mtl_archives/reports/canonical_image_recovery_v1/search-evaluation/search-duplicate-task-metrics-v1.jsonl
test -s data/mtl_archives/reports/canonical_image_recovery_v1/graph-impact-report-v1.json
npm run dataset-factory:canonical-image-recovery-self-test-v1
npm run dataset-factory:visual-family-self-test-v1
npm run dataset-factory:artifacts:check -- \
  --require ccv1_recovery_reproducibility_bundle_terminal_20260711,ccv1_visual_family_graph_recovery_terminal_20260711

echo "canonical image recovery v1 clean-checkout reproduction: ok"
