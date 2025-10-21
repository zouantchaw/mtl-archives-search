## Issue #6 – Metadata Quality Improvement Plan

### Objectives
- Establish a repeatable audit of metadata completeness and consistency across the full manifest.
- Build cleaning and normalization routines so semantic search consumes high-quality text fields.
- Produce clear quality benchmarks and documentation that keep metadata maintenance sustainable.

### Workstreams
1. **Baseline Audit & Instrumentation**
   - Add `data/mtl_archives/audit_metadata_quality.py` to scan the latest manifest (enriched if available) and compute field-level coverage for `name`, `description`, `portal_description`, `portal_title`, `portal_date`, and other candidate fields.
   - Emit metrics to both JSON (machine-readable) and Markdown/CSV (human-readable) reports, capturing counts, percentages, character-length distributions, and null/blank tallies.
   - Integrate the audit into `npm run pipeline` (or a new `npm run metadata:audit`) so it runs after manifest generation and before SQL export.

2. **Issue Classification & Diagnostics**
   - Extend the audit script to flag: empty strings vs. missing keys, duplicated descriptions, overly short (<25 chars) or long (>512 chars) entries, and inconsistent casing/punctuation.
   - Leverage lightweight language detection (e.g., `langdetect` or spaCy language component) to quantify English vs. French vs. unknown content, logging per-record anomalies for triage.
   - Persist exemplar record IDs for each issue type to a newline-delimited JSON file to support manual review and follow-up cleaning.

3. **Cleaning & Normalization Pipeline**
   - Create `data/mtl_archives/clean_metadata.py` that loads the manifest, applies deterministic transformations (trim whitespace, collapse multiple spaces, normalize quotes/dashes, harmonize encoded characters), and outputs a cleaned manifest (`manifest_clean.jsonl`).
   - Implement field-specific logic: fall back to `portal_description` when `description` is empty, expand common abbreviations, and ensure bilingual content is separated or tagged.
   - Wire the cleaning step between data ingestion and SQL generation so downstream processes (Vectorize ingestion, Worker queries) rely on the cleaned manifest.

4. **Enrichment Strategies**
   - Compose richer descriptions by concatenating structured fields (e.g., `name`, `cote`, `date_value`, location attributes) when native descriptions are weak.
   - Explore deterministic templating for synthetic descriptions where both `description` and `portal_description` are missing, ensuring templates remain human-readable and >50 characters.
   - Optionally prototype lightweight AI-assisted enrichment gated behind a feature flag, using pre-generated prompts stored in `data/mtl_archives/export/` for manual review before inclusion.

5. **Validation & Integration**
   - Update `scripts/export_manifest.ts` (or equivalent TypeScript helpers) to expect the cleaned manifest schema, adding TypeScript types that surface nullable vs. required fields explicitly.
   - Add guardrails in `src/worker.ts` to assert key metadata fields are populated before embedding, logging structured warnings for records that still fail quality checks.
   - Run semantic search spot checks (via `npm run dev` and sample queries) before and after cleaning to verify qualitative improvements.

6. **Reporting & Documentation**
   - Store audit outputs in `data/mtl_archives/reports/` (git-ignored if large) and surface the headline metrics in the project README (e.g., overall completeness, average description length).
   - Document the new scripts, required Python dependencies, and expected datasets within `data/mtl_archives/README.md` (or create it) plus `docs/metadata-quality.md` for deeper guidance.
   - Provide a cookbook entry summarizing how to re-run audits, interpret reports, and escalate problematic records.

### Deliverables
- Automated audit script with JSON + Markdown/CSV reports committed.
- Cleaning pipeline that exports a manifest ready for SQL/vector pipelines.
- Updated worker/types that depend on reliable metadata fields.
- Documentation outlining quality standards, procedures, and success metrics.

### Risks & Mitigations
- **Large file processing**: Use streaming/iterative processing to avoid loading all 14k+ records into memory; chunk outputs if necessary.
- **Language detection dependencies**: Evaluate size/performance of detectors; fall back to heuristic detection if heavy dependencies are unsuitable for our environment.
- **Downstream schema drift**: Version the manifest schema (e.g., add `metadata_schema_version`) so worker logic can guard against mismatched inputs.

### Next Steps
1. Scaffold the audit script and run it on the current manifest to gather baseline metrics.
2. Prioritize the highest-impact issues (missing descriptions, duplicates) and design cleaning rules.
3. Iterate on enrichment templates and validate with qualitative search tests before rolling out broadly.
