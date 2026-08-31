# Content Signal v1

Issue: GitHub #72

The local cross-platform analytics command now requires an explicit declared
identity join before writing a report. A post ID is not an archive identity: the
`--identity-map` input must connect each `(platform, platform_post_id)` to a
canonical record, visual family, content package, and source asset. The
`--canonical-manifest` input verifies that the canonical record and source
asset exist. Package and visual-family values are explicitly declared identity
joins and are not independently verified by this local slice. Generated rows
carry `identity_basis: declared_identity` and
`package_family_verification: not_independently_verified`. Fuzzy caption/date
matching is intentionally unsupported.

## Signal boundary

The contract keeps these classes distinct:

- factual archive truth;
- hypotheses;
- synthetic/model acquisition signals;
- explicit human/Codex/stakeholder preferences;
- product behavior;
- social behavior.

Social metrics remain descriptive outcomes and are not archive facts. Product
events are emitted as `product_behavior` with `ground_truth_boundary` set to
`reward_not_fact`. No event with an experiment assignment is accepted without
`propensity` in `(0, 1]` and a `safety_budget_id`.

## Command

```bash
npm run social:analyze-cross-platform -- \
  --posts-input data/social/2026-03-19-refresh/combined_posts.json \
  --meta-root /path/to/meta-export \
  --vercel-root /path/to/vercel-export \
  --identity-map /path/to/content-identity.jsonl \
  --canonical-manifest data/mtl_archives/export/manifest_enriched.ndjson \
  --product-events /path/to/product-signals.jsonl \
  --evidence-kind real_export \
  --start 2026-01-01 --end 2026-07-31
```

`--product-events` is optional, but when supplied every row is validated and
written to `<output-prefix>-product-signals.csv`. The post CSV carries the
same provenance fields. Missing, duplicate, or inconsistent joins fail before
any output is written. `--evidence-kind` is mandatory: use `real_export` only
for an identified external export and `synthetic_fixture` for tests. Product
events must carry the same value, so a fixture cannot masquerade as production
evidence. A `no_personal_data` event must contain null `query` and
`candidate_set`; raw search text and candidate lists require a more explicit
consent level and remain in the local output only.

Daily and monthly aggregate rows carry the same schema version, capture time,
capture-time basis, evidence kind, source platform, Toronto timezone,
observation window, source class, and `reward_not_fact` boundary. Aggregate
`captured_at` is the report-generation time because these exports do not carry
a trustworthy source-capture timestamp; it is marked
`capture_time_basis: report_generation` and must not be read as an in-window
source observation. Vercel rows explicitly carry
`platform: web` and `join_scope: month_aggregate`; they do not claim
post-level attribution. `content-aggregate-schema.v1.json` is intentionally an
 envelope-only schema: emitted rows add row-type-specific metric payloads, so
 callers project the ten envelope fields before applying that schema. The
report does not claim a single full-row schema across social, Meta, and website
aggregate shapes.

## Duplicate and precedence policy

The report fails closed when an input can silently change the result:

- duplicate social posts with the same `(network, id)` are rejected;
- duplicate raw or normalized Meta daily rows with the same
  `(platform, metric, date)` are rejected;
- duplicate Meta monthly fallback rows for a month are rejected;
- duplicate website `Top Pages` or `Top Events` tables for a month are
  rejected, as are repeated recognized event names within a table; and
- duplicate normalized website summary rows for a month are rejected.
- published identity joins and their post snapshots must both carry the exact
  platform permalink; missing or mismatched permalinks are rejected.

When a normalized Meta daily row and a raw export row share a key, the raw
export is selected only when the values agree; conflicting values are rejected.
Normalized website monthly visitor/page-view totals intentionally supersede
raw Top Pages totals because route visitors repeat, and this is a documented
source-specific precedence rather than an undetected overwrite.
Raw Top Pages and Top Events visitor columns are not summed across routes or
event names because those counts can repeat the same visitor; without a
normalized monthly total, the corresponding visitor field remains unknown.

Run the offline contract tests with:

```bash
npm run social:analyze-cross-platform:self-test
```

The integration check demonstrates that an out-of-window product event,
negative post metric, duplicate social post, duplicate Meta daily row, and
duplicate website table fail before any output is created:

```bash
npm run social:analyze-cross-platform:integration-test
```

When a requested window starts or ends mid-month, the corresponding monthly
aggregate is marked with a partial-month caveat and must not be compared
directly with a full month.

Product `event_id` values are unique within one supplied export and are
validated before output. Product event `captured_at` is source metadata and is
marked `capture_time_basis: source_event`; it is distinct from aggregate
report-generation capture time. Durable global deduplication across exports requires
an event-ingestion store with an idempotency key and retention policy; this
local command does not claim that infrastructure or production instrumentation.

This is partial instrumentation scaffolding for #72, not completion of #72. It
does not claim a real product-event cohort, 100 explicit human judgments,
causal attribution, or RL readiness. Those require real exports, review
collection, production event instrumentation, and independent verification.
