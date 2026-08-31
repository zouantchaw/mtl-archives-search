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
  --start 2026-01-01 --end 2026-07-31
```

`--product-events` is optional, but when supplied every row is validated and
written to `<output-prefix>-product-signals.csv`. The post CSV carries the
same provenance fields. Missing, duplicate, or inconsistent joins fail before
any output is written.

Daily and monthly aggregate rows carry the same schema version, capture time,
source platform, Toronto timezone, observation window, source class, and
`reward_not_fact` boundary. Vercel rows explicitly carry
`platform: web` and `join_scope: month_aggregate`; they do not claim
post-level attribution. `content-aggregate-schema.v1.json` is intentionally an
envelope-only schema: emitted rows add row-type-specific metric payloads, so
callers project the eight envelope fields before applying that schema. The
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

When a normalized Meta daily row and a raw export row share a key, the raw
export is selected only when the values agree; conflicting values are rejected.
Normalized website monthly visitor/page-view totals intentionally supersede
raw Top Pages totals because route visitors repeat, and this is a documented
source-specific precedence rather than an undetected overwrite.

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

This is partial instrumentation scaffolding for #72, not completion of #72. It
does not claim a real product-event cohort, 100 explicit human judgments,
causal attribution, or RL readiness. Those require real exports, review
collection, production event instrumentation, and independent verification.
