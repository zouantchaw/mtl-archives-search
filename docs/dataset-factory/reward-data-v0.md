# Reward Data v0

Issue: GitHub #57

Status: schema, search-preference artifact, and dataset-factory model-gap reward artifact ready.

## Purpose

Reward Data v0 captures what is useful, preferred, clicked, bought, published, rejected, or selected without confusing those signals with factual ground truth.

This distinction matters:

- A factual label says what is true or evidence-supported.
- A reward signal says what performed better for a goal, audience, surface, or query.
- A social hit is not automatically an archive truth.
- A stakeholder pick is not automatically visually or historically complete.
- A Codex pairwise judgment is useful training data only when its source task and evidence boundary stay attached.

The canonical machine contract is `reward-schema.v0.json`.

## Build

After running Search Reranker v0:

```bash
npm run dataset-factory:reward-data-v0
```

Default input:

- `data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/search_reranker_v0_prod/search_pairwise_preferences.jsonl`
- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl`

Default outputs:

- `data/mtl_archives/reports/reward_data_v0/reward-signals-v0.jsonl`
- `data/mtl_archives/reports/reward_data_v0/reward-data-v0-report.json`
- `data/mtl_archives/reports/reward_data_v0/reward-data-v0-report.md`

Generated reward reports are local data artifacts. Commit the schema, builder, and docs.

## Current v0 Artifact

Current reward sources:

- Source: Search Reranker v0 pairwise hard negatives.
  - Rows: `293`
  - Surface: `search`
  - Target: `search_relevance`
  - Boundary: `reward_not_fact`
- Source: Active Learning v0 model-baseline-gap review rows.
  - Rows: `1519`
  - Surface: `dataset_factory`
  - Targets: `quality_repair`, `trust_provenance`, `search_relevance`, `story_value`, `print_value`, `partner_fit`
  - Boundary: `reward_not_fact`

Each row says:

> For query Q, reviewed-positive image A is preferred over retrieved hard-negative image B for search relevance.

That is reward data. It does not claim that B is historically wrong, visually bad, or commercially useless.

The dataset-factory rows say:

> This record was selected as useful review material for a measured model-baseline gap.

That is also reward data. It does not claim the target label is true before review.

## Schema Fields

Required top-level fields:

- `schema_version`: `mtl_reward_signal_v0`
- `signal_id`: stable row id
- `signal_type`: pairwise preference, rating, product behavior, social performance, stakeholder decision, or Codex review
- `source_type`: Codex, human, product analytics, social platform, stakeholder, or model
- `captured_at`: ISO timestamp
- `surface`: search, dataset factory, social, print, partner, newsletter, game, or unknown
- `reward_target`: search relevance, story value, print value, social engagement, partner fit, trust/provenance, or quality repair
- `reward_value`: normalized -1 to 1
- `confidence`: 0 to 1
- `ground_truth_boundary`: `reward_not_fact`, `factual_label`, `mixed`, or `unknown`
- `record_ids`: affected archive records
- `context`: benchmark, label version, ranking version, audience, platform, image family, and notes

## Instrumentation Map

| Source | Example Signal | Reward Target | Boundary | Use |
|---|---|---|---|---|
| Codex benchmark | A preferred over B for query Q | search_relevance | reward_not_fact | reranker training |
| Human/stakeholder review | curator picks one image for a story | story_value or partner_fit | reward_not_fact | partner/demo ranking |
| Product analytics | search result click, detail view, order-mode entry | search_relevance or print_value | reward_not_fact | bandit/ranking features |
| Checkout | print purchase or checkout start | print_value | reward_not_fact | commercial ranking |
| Newsletter | click on image/story | story_value | reward_not_fact | editorial ranking |
| Social | post saves, shares, follows, profile visits | social_engagement | reward_not_fact | distribution ranking only |
| Quality review | repaired image preferred over original derivative | quality_repair | mixed | repair policy evaluation |

## Guardrails

- Keep reward rows separate from Dataset Factory factual labels.
- Do not optimize archive search only for social engagement.
- Do not train on purchase/social behavior without keeping audience, date, platform, and source context.
- Do not use private contact/payment identifiers as reward context.
- Do not store raw private messages or email bodies in reward artifacts.
- Treat all automated/Codex reward rows as reviewable until larger human/stakeholder checks exist.

## Next Steps

1. Backfill product analytics into this schema once event exports are stable.
2. Convert social correlation outputs into aggregate reward rows, not raw platform dumps.
3. Add stakeholder review packets that generate pairwise story/partner/print preferences.
4. Feed Reward Data v0 into Model Baseline v0 only after the benchmark query set expands beyond the current 26 retrieval tasks.
