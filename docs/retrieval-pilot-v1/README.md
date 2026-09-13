# Retrieval and enrichment pilot — issue #139

Status: measured candidate, **not production-promotable**. The implementation improves the reviewed street-search cases, but does not complete production rollout or prove broad recaptioning. #139 must remain open until its remaining quality and promotion requirements are met.

## Decision

Keep canonical records, legacy captions and both production indexes. Keep concrete query expansion and filtering as a candidate for #137 integration. Reject bulk promotion of the first Mistral caption pass: coarse viewpoint agreement conceals subtype, object and text errors. No training, GPU provisioning, or full-corpus regeneration is justified by this run.

## What was built

- A resumable, bounded hosted enrichment runner with distinct visual description, explicit viewpoint, present/absent/unknown features, source context, image/prompt hashes, model, usage, latency and generation provenance. Cached input changes are rejected. Provider rate limits stop subsequent scheduled calls; no unlimited retries.
- A CPU lexical baseline and separate immutable local BGE-M3 candidate index for the same 50 records. Legacy and candidate documents retain the same source-context fields. This is a sample index, not a replacement Vectorize deployment.
- A bounded bilingual CPU planner, preserving the original request, plus a measured hosted planner alternative. Unsupported subjects/relationships/names/dates/causal questions abstain from matching; exploratory candidates retain the original request. Follow-up constraints merge explicitly; conflicts require clarification.
- Deduplicated reciprocal-rank fusion and candidate diversification before feature filtering. Unknown or missing features cannot pass a hard filter. Eligibility is provisional, not human verification or a claim that every semantic constraint was checked.
- Frozen query evaluation with CPU ranking times, API timing distributions, model-token estimates, explicit unknown costs, and a promotion receipt that blocks missing gates.

No canonical record IDs, collection names or ID ranges appear in the planner or filtering rules. Fixed IDs appear only in evaluation artifacts.

## Results

All 50 images produced valid Mistral records. Median generation latency was 5.97 seconds, p95 8.00 seconds; estimated successful-generation token charges were $0.02698. This excludes embeddings, failed attempts, query planning, infrastructure and API search costs. Prices are from [Cloudflare's published table](https://developers.cloudflare.com/workers-ai/platform/pricing/); estimates are not invoices.

The final 20-query run issued 102 API requests, all successful, across concurrency 1/2/2 repetitions. Median individual request latency was 151 ms, p95 271 ms. These are a scripted mix with unknown cache state, not production load or end-to-end reading-room latency. The CPU planner median was 0.015 ms. Query embedding and network time are not included in CPU-only ranking timings.

| Stress case | Original known-positive recall@36 | Variant pool + pilot feature filter | Returned / reviewed precision |
|---|---:|---:|---:|
| Original street wording | 0/4 | 4/4 | 4 / 100% |
| Concrete storefront wording | 4/4 | 4/4 | 4 / 100% |
| Long French street request | 0/4 | 4/4 | 4 / 100% |
| Short French street request | 4/4 | 4/4 | 4 / 100% |
| Ground-level correction | 0/4 | 4/4 | 4 / 100% |
| Ground church exterior | 2/3 | 3/3 | 3 / 100% |

These are **selected reviewed pools**, not corpus-wide precision or recall. Filtering only has features for the 50 pilot records, so unknown out-of-sample candidates abstain. Do not present the four returned street images as evidence of full-corpus coverage. No result IDs are forced into search.

Caption replacement alone is inconsistent: the original street wording still has reviewed sample P@6 of 1/6 under both legacy and new BGE descriptions; the corrected wording's sample recall drops from 4/4 to 3/4. See `results.json` for every case and alternative, including CPU lexical baselines and the six historical report-only cases. Historical test judgments contain known positives, not exhaustive negatives; precision is therefore inadequately covered and cannot pass a shipping gate.

## Visual QA and uncertainty

Candidate coarse aerial/ground viewpoints agree with the owner's 11/12 records. A44, a sideways photograph of a helicopter taken from the ground, is wrongly called aerial. This denominator does not validate aerial nadir/oblique distinctions, OCR, objects or caption accuracy. The original owner's caption scores apply to legacy captions, not these replacements.

Independent assistant visual inspection of the retained contact sheets and full A25/A44 images found further failures:

- A25 misreads the rooftop sign as “The Kitzel” (the visible sign reads “The Gazette”) and calls the street snow-covered without reliable evidence.
- A40 describes a river through the image where a road runs between buildings.
- A45/A46 describe water reflections where the rotated images show bare trees and their shadows on the ground.
- A04/A34 use nadir language despite visibly oblique building perspectives.
- A06 adds an unestablished ship/pier interpretation; A16 adds unsupported hill/staircase detail; A20 adds unsupported disrepair.

These are provisional assistant findings, not human gold or an exhaustive error rate. They are sufficient to reject automatic caption promotion. Source orientation and ambiguity need explicit handling. A more fluent paragraph is not a quality gate.

## Failed alternatives and recovery

Initial hosted planner runs emitted extra query fields despite schema guidance, then invalid enum values, omitted constraints and ungrounded evidence. The parser accepts an echoed original only when exactly equal; other failures abstain. The last hosted pass validated 8/20 plans. Raw failures are preserved privately; no successful-planner claim is inferred from HTTP 200.

The first CPU grammar incorrectly matched `eau` inside `niveau`. A regression test now requires word-boundary matching. Filtering was also moved after the bounded candidate union so fusion truncation cannot discard useful candidates prematurely. Stress cases informed those changes; historical test cases remain report-only. Repeated reporting does not create a fresh independent holdout.

A second hosted model probe (`gemini-2.5-flash`, identical prompt) was rate-limited: the initial two-image probe produced one output and one 429; the subsequent sequential sample was rate-limited. It is not a valid comparative baseline. The runner now stops scheduling further provider calls on 429. No quota purchases or GPU runs occurred.

Initial Python search requests were rejected with 403; identifying the client and using the baseline's 12 MB asset limit produced valid responses. Failed network runs remain separate and are not included in successful-run latency statistics.

During the pilot, the #136 merge was found to have triggered a production deployment from `main`, omitting the uncommitted reading-room code previously deployed directly. Production was rolled back to `dpl_9YCpZVsxbQw8yxRTw7ymtLza7krx`; `/research` and `/api/research/image` both returned 200 afterward. Do not merge/deploy this pilot until the production/source drift is reconciled or a verified deployment guard is in place. The earlier working checkout is untouched.

## Promotion and remaining work

`results.json` explicitly records `promotable: false`. Missing/failed gates include caption review, constraint correctness, representative held-out precision/recall, end-to-end research latency, total request cost, worst-slice regression and full-corpus feature coverage. The pure promotion contract requires all named gates, never a caller-provided partial list.

Before closing #139:

1. Produce and independently validate a caption/feature candidate that handles the identified errors, including rotation and text uncertainty. Retain legacy versions and source lineage.
2. Evaluate the candidate over a representative corpus and a newly protected judgment set; label enough negatives to measure precision. Repeated diagnostics are not new held-out evidence.
3. Integrate through #137's runtime correctness work and #138's artifact/versioning contract; reconcile the live/source deployment mismatch first.
4. Measure end-to-end traffic and attributable cost, pass the frozen targets, test rollback of the actual candidate implementation, and add runtime regression monitoring before any switch.

The current helper tests establish contracts, not a completed production rollout.

## Reproduction

Python 3 standard library; no local accelerator dependencies. Raw images, captions, provider replies and vectors stay in the private generated-output directory. Public summaries and `evidence-manifest.json` identify their hashes.

```sh
python3 packages/scripts/src/retrieval-pilot-v1/run.py --baseline "$BASELINE" --output "$PILOT" --env-file "$LOCAL_ENV"
python3 packages/scripts/src/retrieval-pilot-v1/evaluate.py --baseline "$BASELINE" --output "$PILOT" --env-file "$LOCAL_ENV" --planner cpu
python3 packages/scripts/src/retrieval-pilot-v1/report.py --output "$PILOT" --publish docs/retrieval-pilot-v1
python3 -m unittest discover -s packages/scripts/src/retrieval-pilot-v1 -v
```

Use a fresh run directory when a manifest changes. Failed/cached runs are not new measurements. Held-out source names remain separately sourced; visual descriptions do not invent dates, building identities, or historical explanations. Unsupported requests include exact sign transcription, gender, unknown objects, altar-facing orientation, causal history, and date/location constraints without verified metadata support.
