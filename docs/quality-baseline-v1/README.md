# Archive quality baseline v1 — issue #136

Status: audit complete, including the submitted owner review. No production changes or model promotion. This operational audit does not lock Benchmark v1 or complete deferred research gates.

## Decision

Preserve the canonical identities, original assets, verified recovery bundles and pipeline validation machinery. Repair serving and retrieval; evaluate replacement captions and features on a controlled sample before scaling. A wholesale restart would discard useful, reproducible work.

### Verified inventory

- Fresh read-only production snapshot: 13,499 unique records and image keys, each with source URL and caption.
- Enumerated both active Vectorize indexes: 13,499 unique IDs each; zero missing/orphan IDs relative to D1. This establishes membership, not correctness of every vector value or image-to-vector association.
- Recovered the 300-record Gold Batch 002 archive from its registered R2 key: bundle hash and all 1,548 member hashes/byte counts match.
- Recovered the canonical-image/family successor archive: bundle hash and all 267 members match. Its 18,462-record family map covers all 13,499 live canonical IDs. All live source URLs match graph source URLs after URL decoding; two raw spelling differences were escaped spaces/accents.
- Gold completion validator passes: 281 promoted, 9 held, 2 unresolved and 8 rejected; 50 audit rows; 49 search dispositions (32 reviewed, 15 stress, 2 rejected). Only 266 of the 300 IDs are directly present in live D1. Any reuse of the other 34 requires documented alias/source reconciliation.
- Historical reviewers/adjudicators are agents. Preserve the original artifact's status vocabulary, but do not equate its `reviewed_gold` label with human-reviewed truth.
- Historical taxonomy has 14,822 rows, only 9,859 directly matching live IDs. It contains 14,175 aerial, 85 ground, 110 document/map and 452 unknown vantage assignments. These are unverified features, not ready-to-copy production truth.
- Live OCR and primary taxonomy fields are empty. Generated historical artifacts exist separately. Empty-array defaults are excluded from meaningful coverage counts; boolean defaults do not prove review.
- 184 live caption rows record a model; 13,315 do not. All captions remain unreviewed or unreviewed-conflict. Historical LLaVA run documentation exists, but does not establish row-specific lineage for every caption.

The original working checkout is at 240b92b with uncommitted production repairs; this audit uses a separate checkout based on main 455342c. No inference that Git main exactly matches production is made.

## Visual audit

Frozen initial sample: 24 deterministic random records (SHA-256 ordering with seed `issue136-v1`) and 24 targeted regression/category candidates. Selection and assistant judgments are separate artifacts. This is a small diagnostic sample, not a powered estimate for every collection or subgroup.

| Lane | Selected | Visually inspected | Wrong or unsupported caption details | Missing aerial viewpoint |
|---|---:|---:|---:|---:|
| Random | 24 | 20 | 15/20 | 18/20 inspected records |
| Targeted | 24 | 24 | 15/24 | 4/24 inspected records |

Unsupported means not established by the inspected pixels/resolution; it does not mean every claim was independently disproven. Metadata dates and names require source checks, not visual guessing. Camera-ambiguous cases abstain. Rates from these two lanes must not be pooled into a corpus-wide headline.

Four random images were unavailable through the research image endpoint: IDs 9322, 9452, 10313, 10260. D1 reports 17.8–54.6 MB originals, exceeding the reading-room 12 MB limit. Alternate public reads returned 403. They remain missing visual observations, not asserted missing R2 objects or replaced with easier samples. Current evidence does not certify full asset integrity.

An additional diagnostic reviewed all five historical `ground_interior` labels. Records 46 (room with adults/babies) and 53 (classroom) support interior. Record 47 is an exposed building under demolition, requiring a boundary decision. Records 13090 and 13102 show open stadium fields and require re-adjudication of the interior label. The supplement is not part of the random-rate denominator. These examples show why sealed review artifacts still need semantic spot checks.

The 12-image owner packet collected viewpoints before caption assessments. The completed v2 review and A01 assisted-calibration exception are documented below; no owner answer was fabricated or inferred from silence.

## Retrieval and speed baseline

20 cases, 72 live API requests, all HTTP 200. Fourteen diagnostic cases include French/English, conjunctions, exclusions, the September failures, corrected standalone phrasing, and an absent target. Six historical test queries remain report-only. Three modes are compared: smart, semantic and visual; six smart queries receive two repeat reads. Query/artifact hashes were frozen before this run. No candidate tuning occurred.

`metrics.json` reports each query's known-positive recall within the reviewed pool, judged precision at six, and judgment coverage. Unjudged results are never converted into negatives or positives. Missing positives yield null recall, not a claim that nothing relevant exists. In particular the church-interior and purple-elephant cases cannot establish exhaustive absence.

Examples from smart search:

- Original street wording: 0/4 known commercial-ground positives in the first 36 results; 0/3 judged relevant in the top six (3/6 judgment coverage).
- Concrete storefront wording: 4/4 known positives recovered; 4/4 judged relevant in top six (4/6 coverage).
- Verbose French and corrected standalone street query: 0/4 known positives recovered.
- Short French storefront query: 4/4 known positives recovered.
- Six historical test queries each recovered the single recorded positive within 36; this is not exhaustive recall or complete top-six precision.

The historical family split map has complete live-ID coverage. Positive-family overlap audit found zero crossings between this run's stress and historical-test cases. No training split was created, and the six historical queries do not constitute a newly locked benchmark.

| Mode | Requests | Client p50 | Client p95 |
|---|---:|---:|---:|
| Smart | 32 | 273 ms | 4,359 ms |
| Semantic | 20 | 278 ms | 422 ms |
| Visual | 20 | 303 ms | 422 ms |

Nearest-rank percentiles; concurrency three; first and repeated requests mixed. These are client elapsed times, not pure server timing, cold-start isolation or load-test capacity. Smart tail latency misses the proposed 2-second search p95 target.

The earlier September 13 headless-browser run supplies the actual conversational correction and gallery-verification baseline: 37/64 visual checks completed across eight searched cases. Seven newly entered searched turns took approximately 18.5–32.2 seconds including browser instrumentation (p50 25.5 s, nearest-rank p95 32.2 s). The original cached turn is excluded from latency. Street original/correction/French and church-interior galleries contained 0/21 relevant photos in total, across overlapping queries; this is a diagnostic count, not independent corpus sampling. Original street and church each had a demonstrably wrong match badge; the helicopter control also accepted a flying helicopter without a visible adjacent person. Across those three cases (original street, church interior, helicopter), 3 of 6 positive match badges violated the full request in assistant visual review: a 50% diagnostic false-match rate. This selected denominator excludes unreviewed/ambiguous badges and is not an overall rate. Per-case raw evidence hashes are retained.

Attributable dollar cost is unknown: search responses do not expose billed inference usage, and prior browser artifacts do not contain billing receipts. Report 72 search calls, eight prior searched browser turns and 64 attempted prior inspections as workload counts. CPU/local audit and artifact downloads are not claimed free. Cost observability is a prerequisite before evaluating the frozen $0.02/research-request target; this audit launched no GPU or training job.

## Existing benchmark remains blocked

The old preflight was rerun with recovered artifacts. Gold is now available and valid, but its graph pin expects a different hash from the verified recovery successor. Its retrieval input still has only 26 reviewed predecessor tasks versus the 100-task requirement. The 49 later dispositions are not silently merged. Canonical predecessor is descriptor-only, independent benchmark review is absent, and benchmark lock remains false. Update explicit lineage/contracts in later evaluation work; do not modify a hash just to make the preflight green.

## Keep / repair / regenerate

| Layer | Decision | Evidence and next action |
|---|---|---|
| Canonical IDs, source links | Keep | Live uniqueness, index membership and decoded graph-source joins pass. |
| Originals and derivatives | Keep originals; repair serving coverage | Four sampled large originals cannot be visually checked in this surface; carry explicit exclusions and inspect via a suitable derivative path. Full byte-level asset audit remains outside this sample. |
| Family graph and recovery | Keep verified successor | Full live-ID coverage; preserve provenance and unknown relationships. Historical predecessor pins need explicit reconciliation. |
| Agent-reviewed labels | Keep evidence, repair selected labels | Hash integrity and validator pass; stadium-interior counterexamples require re-adjudication, not blind training or public claims. |
| Legacy captions | Evaluate replacement generation | Missing perspective and unsupported detail recur in random and targeted samples. Preserve old versions; benchmark a replacement on representative images before any bulk run. |
| Historical taxonomy | Keep as candidate features; reconcile IDs and evaluate | Only 9,859 direct live matches, heavy aerial skew, no automatic production authority. |
| OCR | Keep tooling; evaluate an offline pilot | Live coverage zero; usefulness for signs requires measured transcription/retrieval evaluation. |
| CLIP/BGE embeddings | Keep baseline; rebuild affected derived indexes only after measured improvements | Membership is correct, semantic retrieval is wording-sensitive. This audit does not prove vector/image pairing or model superiority. |
| Planner / visual checking / gallery | Repair in #137 | Lost constraints, malformed output, unchecked gallery cards and false-positive checks are reproduced. |
| Import/versioning/observability | Build in #138/#139 | Durable bundles are recoverable but scattered, and production differs from tracked/offline artifacts. |

## Promotion targets

`protocol.json` freezes proposed engineering gates before candidate tuning: zero confirmed viewpoint/exclusion violations, zero failed checks counted as matches, preserved follow-up constraints, reviewed-pool P@6 and recall@36 at least 0.80, visual completion at least 0.98, search p95 at most 2 s, research p95 at most 10 s, estimated research request cost at most $0.02, and no worst-slice precision drop above 0.05. Incomplete judgments/cost observations cannot pass a gate. These are initial targets, not current performance or shipping authorization; owner review is recorded separately below.

## Reproduction and artifacts

Use an external private output directory. Do not commit raw snapshots, credentials, review identities, archive bundles or image pixels.

1. `AUDIT_ENV_FILE=/absolute/path/to/local.env node packages/scripts/src/quality-baseline-v1/collect.mjs "$AUDIT_OUTPUT"` collects fixed SELECT-only D1 rows and both active index ID lists.
2. Recover registered gold and issue-77 archives to `recovered-gold` / `recovered-family` under that output, verify bundle hashes, and safely extract only ordinary relative-path archive members. Registered descriptors are under `docs/dataset-factory/fixtures/`.
3. `python3 packages/scripts/src/quality-baseline-v1/inventory.py "$AUDIT_OUTPUT"` checks member hashes/bytes, production coverage and historical overlaps.
4. `node packages/scripts/src/quality-baseline-v1/sample.mjs "$AUDIT_OUTPUT"` selects records and acquires bounded research derivatives. Inspect actual images; assistant-audit.json is a review artifact, not generated ground truth.
5. `node packages/scripts/src/quality-baseline-v1/evaluate.mjs "$AUDIT_OUTPUT"` records baseline API responses. Copy approved/provisional judgments explicitly into the output first; retain their authority. Existing run responses are reused; use a fresh directory for a new measurement.
6. `node packages/scripts/src/quality-baseline-v1/report-metrics.mjs "$AUDIT_OUTPUT"` computes metrics without converting unjudged candidates to negatives.
7. `node --test packages/scripts/src/quality-baseline-v1/metrics.test.mjs` validates metric boundaries and leakage detection.

Inventory and artifact digests are checked in. Raw evidence is retained in the owner's local generated-output area under `mtl-issue136-quality-baseline`; prior browser evidence under `mtl-reading-room-quality-2026-09-13`. Portable historical bundles retain their registered R2 locators. This new baseline's local raw evidence is not yet a remotely archived reproducibility bundle.

## Verification

- Canonical corpus self-test: 72 negative cases passed.
- Family graph self-test: 18 adversarial cases passed; deterministic fixture output hashes recorded.
- Historical benchmark preflight self-test: 14 cases passed.
- Opportunity/crosswalk self-test: 10 cases passed.
- Recovered gold full completion validator: zero blocking issues.
- Operational metric tests: five passed.

Contract tests establish reusable machinery, not corpus-wide semantic accuracy. No production deployment, broad recaptioning, model promotion, or GPU execution occurred.

## Caption review clarification (v2)

The owner requested a clearer definition of caption quality before completing the review. See `caption-contract.md` and `caption-rubric-v2.json`. The review now separates accuracy, essential visual coverage and retrieval usefulness. Saved viewpoint and legacy responses are retained; missing dimensions are not inferred. The A01 discussion is calibration, not blind caption evidence. Original baseline metrics remain unchanged.

Render the updated packet with `python3 packages/scripts/src/quality-baseline-v1/render-review.py "$AUDIT_OUTPUT"`; it writes the private review HTML without assistant judgments. Test answer migration/completion with `node --test packages/scripts/src/quality-baseline-v1/review-state.test.mjs`.

## Completed owner review — 2026-09-13

All 48 required answers (12 viewpoints and 36 caption dimensions) validated against the v2 rubric. The raw submission remains private; `owner-review-summary.json` records its SHA-256, safe labels, provenance and discrepancy dispositions.

Across 12 captions, 7 contain unsupported details, 1 contains a visibly contradicted detail, and 4 are supported. Ten omit important information (5 missing both viewpoint/subjects, 5 missing subjects); 2 have adequate coverage. Eight are generic and 4 misleading; none was rated distinctive. These are judgments on a selected subset, not corpus-wide error rates or measured retrieval scores.

A01 was discussed with the assistant and is assisted caption calibration. The other 11 caption reviews are independent: 6 unsupported, 1 contradicted, 4 supported; 9 missing information; 7 generic and 4 misleading. All 12 earlier viewpoint answers retain independent provenance.

Discrepancies are resolved for audit reporting by retaining both reviewers and using the owner submission as a separate v2 baseline, never overwriting the frozen assistant metrics or claiming consensus. A09 resolves an assistant-uncertain viewpoint to owner-rated aerial. Accuracy judgments differ on A09, A25, A32 and A34; viewpoint-coverage judgments differ on A13, A32 and A44. These records require factual rechecking before training or promotion in #139. The review reinforces a controlled caption replacement pilot, while showing why assistant assessments alone cannot be treated as gold.
