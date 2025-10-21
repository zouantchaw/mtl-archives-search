# Montréal Archives Data Toolkit

This directory contains the raw dataset, enrichment artifacts, and helper scripts that feed the Cloudflare Worker and D1 database. The new metadata quality workflow adds repeatable cleaning and auditing steps so semantic search can rely on consistent text inputs.

## Prerequisites

- Python 3.10+
- Optional libraries (auto-detected): [`langdetect`](https://pypi.org/project/langdetect/), `pandas`, `pyarrow`
- Source manifests under `manifest_enriched.jsonl` (from `build_manifest.py` or upstream ingestion)

## Key Scripts

- `clean_metadata.py`: normalizes string fields, expands abbreviations (`S/O` → “Sans objet …”), synthesizes fallback descriptions from structured context, and emits `manifest_clean.jsonl` plus `manifest_clean_summary.json`.
- `export_manifest.py`: flattens the cleaned manifest into NDJSON/Parquet for SQL generation. It prefers `manifest_clean.jsonl` but falls back to `manifest_enriched.jsonl` if the cleaned file is missing.
- `audit_metadata_quality.py`: scans the latest manifest (cleaned when available) and generates JSON, Markdown, CSV, and NDJSON reports under `reports/`.

## Typical Workflow

1. Run `npm run metadata:clean` to produce `manifest_clean.jsonl` and capture quality flags.
2. Run `npm run metadata:export` to refresh `data/mtl_archives/export/manifest_enriched.ndjson` and related summary files.
3. Run `npm run generate:sql` (or `npm run d1:seed`) to regenerate `cloudflare/d1/seed_manifest.sql`.
4. Optionally run `npm run metadata:audit` to produce coverage and issue reports in `data/mtl_archives/reports/`.

The umbrella command `npm run pipeline` now chains all of the above (clean → export → SQL → audit → seed) for convenience.

## Outputs

- `manifest_clean.jsonl`: canonical manifest consumed by downstream tooling.
- `manifest_clean_summary.json`: roll-up counts for description sources and quality flags.
- `reports/metadata_quality_report.json|.md|.csv`: machine- and human-readable coverage metrics.
- `reports/metadata_quality_issues.ndjson`: sample issues for manual review (git-ignored via `reports/.gitignore`).

## Notes

- Scripts stream records to avoid excessive memory usage; processing the full dataset (~15k rows) completes within seconds on a modern laptop.
- If optional dependencies are absent the scripts gracefully fall back to pure-Python code paths (e.g., heuristic language detection when `langdetect` is unavailable).
- Keep the reports directory out of version control—only the `.gitignore` file is tracked.
