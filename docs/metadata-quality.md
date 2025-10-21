# Metadata Quality Playbook

## Overview

Reliable semantic search hinges on descriptive, bilingual-friendly text. This playbook captures the process for cleaning, enriching, and auditing the Montréal archives manifest before it is ingested into D1, Vectorize, or the Worker runtime.

## Workflow Summary

- **Clean**: `npm run metadata:clean` — normalizes fields, expands abbreviations (e.g., `S/O`), synthesizes context-driven copy when descriptions are thin, and annotates description sources.
- **Export**: `npm run metadata:export` — flattens the cleaned manifest into NDJSON/Parquet for SQL generation and Vectorize ingestion.
- **Audit**: `npm run metadata:audit` — emits JSON/Markdown/CSV reports plus per-record issue samples to support triage.
- **Pipeline**: `npm run pipeline` — executes the full chain (clean → export → SQL → audit → seed) in one pass.

## Interpreting Reports

- `metadata_quality_report.md`: human-readable snapshot with coverage percentages, length stats, language distribution, and issue counts.
- `metadata_quality_report.json`: machine-readable payload for dashboards or alerting.
- `metadata_quality_issues.ndjson`: sampled records per issue type (`missing_description`, `short_description`, `duplicate_description`, etc.). The file is git-ignored so reviewers can iterate locally without polluting commits.
- `manifest_clean_summary.json`: counts of description sources (`original`, `portal`, `synthetic`) and accumulated quality flags.

## Quality Standards

- Description coverage should remain above **95%**, with average length over **50 characters**.
- Newly generated synthetic descriptions must include structured context (name, date, cote) and append the fallback notice when the text still falls short.
- Duplicate descriptions should be reviewed; when duplicates are expected (e.g., intentionally blank records), annotate them in the source data or adjust cleaning heuristics accordingly.

## Troubleshooting

- Missing optional libraries (`langdetect`, `pandas`, `pyarrow`) simply trigger slower fallback paths. Install them via `pip install langdetect pandas pyarrow` to unlock faster execution and more accurate language tagging.
- If the audit flags sustained gaps after cleaning, inspect the per-issue samples in `reports/metadata_quality_issues.ndjson` and update the upstream data exports or the cleaning rules.
- Keep an eye on Worker logs for `metadata_quality_*` warnings; these signal records that reach the API with weak metadata and should eventually disappear as the dataset improves.

## Next Steps

- Extend `clean_metadata.py` with dataset-specific enrichment (e.g., location gazetteer lookups or AI-generated narratives) and gate new heuristics behind flags so they can be tested safely.
- Feed audit metrics into monitoring (Issue #4) once the baseline stabilizes, providing trend charts for completeness and description length.
