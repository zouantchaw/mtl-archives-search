# Research Enrichment v0

Research Enrichment v0 creates evidence-aware provenance packets for high-signal archive records. It is meant to feed Provenance/City Memory demos without turning model guesses into unsupported facts.

Run:

```bash
npm run dataset-factory:research-enrichment-v0
```

Outputs:

- `data/mtl_archives/reports/research_enrichment_v0/research-enrichment-packets-v0.jsonl`
- `data/mtl_archives/reports/research_enrichment_v0/research-enrichment-deep-queue-v0.jsonl`
- `data/mtl_archives/reports/research_enrichment_v0/research-enrichment-v0-report.json`
- `data/mtl_archives/reports/research_enrichment_v0/research-enrichment-v0-report.md`
- `data/mtl_archives/reports/research_enrichment_v0/research-enrichment-v0-review-sheet.html`

## Evidence Boundaries

Each packet separates:

- `observed_visual_facts`: VLM/taxonomy observations; not human verified
- `metadata_claims`: title, date, cote, description, and source metadata
- `inferences`: entity, place, family, and product/story candidates that need checking
- `verified`: source URL presence and rights/source baseline only
- `unresolved_questions`: the questions a human/Codex research pass should answer before publication

The generator intentionally does not perform broad external web search. It creates source-backed research packets and suggested queries. Exact locations, identities, brands, and event context must remain unresolved unless supported by metadata or later source checks.

## Demo Use

Use the top deep-research queue for Provenance/City Memory demos. A packet is ready for a demo only after:

- source URL and rights are checked
- entity claims are verified or demoted
- exact location claims are either supported or generalized
- short source notes are stored without copying long copyrighted text
