# First experiment: caption feedback for archival image search

Prepared October 2, 2026. **Stage: preparation.** This is a paper implementation
plan and a proposed MTL experiment. No archive captions, benchmark judgments or
retrieval results have been produced by this work.

## In simple terms

The first question is:

> Over a fixed set of Montréal archive images, does one round of feedback from
> fresh, pixels-only image descriptions improve French and English visual search
> over the same image encoder without feedback?

We search once, read the cached descriptions of the first five results, adjust
the search vector, and search the same images again. We compare that with ordinary
image search, feedback from image vectors, inherited captions, and a simple
image/caption score average. Every method sees the same images and queries.

This is a narrow child study of the existing bilingual historical retrieval
question. OCR and evidence separation remain subsequent experiments. This first
study concerns visible concepts; it cannot establish correct archival dates,
street names, geolocation or a benefit to the current production search stack.

## Paper and implementation anchor

**Bulat Khaertdinov, Mirela Popa and Nava Tintarev. _A Little More Like This:
Text-to-Image Retrieval with Vision-Language Models Using Relevance Feedback_.
WACV 2026, pp. 3825–3834.**

- [Proceedings and bibliography](https://openaccess.thecvf.com/content/WACV2026/html/Khaertdinov_A_Little_More_Like_This_Text-to-Image_Retrieval_with_Vision-Language_Models_WACV_2026_paper.html)
- [Final paper](https://openaccess.thecvf.com/content/WACV2026/papers/Khaertdinov_A_Little_More_Like_This_Text-to-Image_Retrieval_with_Vision-Language_Models_WACV_2026_paper.pdf)
- [Versioned preprint, including appendices](https://arxiv.org/html/2511.17255v1)
- [Author implementation pinned at 50b4a66999f067fe811f4d1e70071fd05aa497a5](https://github.com/bulatkh/vlm_retrieval_relevance_feedback/tree/50b4a66999f067fe811f4d1e70071fd05aa497a5)

The selected branch is **generative relevance feedback (GRF)**. The paper uses
cached synthetic captions and Rocchio vector updates (§§3.1–3.2, Eqs. 1–2), with
K=5, temperature=0.05 and weights 0.8/0.1/0.1 (§5.1). Its evaluation uses
Flickr30k/COCO, a known matching image per query, and Hits/MRR (§4.1). MTL needs
independent graded relevance for multiple possible matches. The learned AFS
branch requires training and is outside this first experiment. The paper reports
query drift with repeated GRF (§5.2); we use one update. These are reasons to test
the method locally, not evidence of an MTL gain.

The final PDF was downloaded and its method page visually checked against the
preprint. Download hashes, model metadata and audited code-file hashes are in
the companion Lab `source-manifest.json`; it is evidence of inspected versions,
not a claim that the original benchmark has been reproduced.

### Why this paper first

| Candidate | Fit for the first question | Decision |
| --- | --- | --- |
| A Little More Like This, WACV 2026 | Text-to-image retrieval; an inference method with a small vector update and explicit no-feedback/PRF controls | Implement GRF first |
| [Patch Matters, CVPR 2025](https://arxiv.org/abs/2504.06666), [author code](https://github.com/GeWu-Lab/Patch-Matters) | A possible later caption generator; region selection and aggregation add several components before retrieval utility is known | Retain for a later caption-quality comparison |
| [VisRet, ACL 2026](https://aclanthology.org/2026.acl-long.1192/), [author code](https://github.com/xiaowu0162/Visualize-then-Retrieve) | Addresses knowledge-intensive queries with generated visual representations | Retain for a different study |

This follows the two October 2 PKM notes: narrow the problem, pick a published
method and code, use the LLM to trace the implementation, build a minimal
baseline, then retain an empirical result. The notes do not identify a specific
paper or establish an exact method used by the conference speakers.

## Equations mapped to code

All vectors must come from **one encoder and revision in one shared space**.
Let q be a unit query vector, v_i a unit image vector and c_i a unit caption
vector. The initial result set T is the five images with largest q·v_i.

For GRF, the inspected code computes:

```text
w_i = softmax_i((q · c_i) / 0.05), for i in T
p   = Σ_i w_i c_i
n   = Σ_i (1 - w_i) c_i
q'  = unit(0.8 q + 0.1 p - 0.1 n)
rank every original corpus image by q' · v_i
```

The complement weights sum to K−1, not 1. Do not replace n with a weighted
mean or normalize it in the GRF branch. The final query is normalized.

| Paper pointer | Pinned author code | Detail to preserve |
| --- | --- | --- |
| §3, initial cosine ranking | `src/retrieval_pipeline.py:254–281, 568–583` | First retrieve using image vectors; final ranking searches the full corpus |
| §3.1, Eq. 1 | `softmax_weighted_aggregation`, lines 324–346 | Similarities are computed from the vectors being aggregated; GRF uses caption/query similarities |
| §3.1, Eq. 2 | `rocchio_update`, lines 217–251 | Normalize the final updated query |
| §3.2, GRF | lines 718–746 | Retrieve caption vectors for the initial top five; do not normalize aggregate positive/negative vectors |
| §4.5, PRF | lines 651–681 | Author PRF normalizes positive and negative aggregate vectors; GRF does not |
| §4.2; preprint App. B, Table 7 | `src/captioning_pipeline.py:133–179`; `src/models/llava.py` | Two generation steps, LLaVA-1.5-7B, second-step brevity request |
| §4.1, metrics | `src/utils/metrics.py:31–93` | Author evaluator assumes query/candidate label correspondence; replace for independent MTL queries |

Code findings requiring explicit decisions:

- The PRF/GRF aggregate-normalization difference is absent from the printed
  Eq. 2. Retain a code-faithful PRF control and a second image-feedback control
  with GRF's normalization policy to isolate the feedback modality.
- The paper describes random prompt selection. The code assigns templates by
  position within each batch. A strict code comparison must record batch/order;
  the MTL adaptation will assign templates deterministically from record ID and
  seed so batching cannot change the prompt. This is a declared adaptation.
- `--max_new_tokens` is parsed by the caption script but not forwarded to the
  wrapper; the wrapper defaults to 100. Our future runner must forward and record
  actual generation parameters and both raw responses. An under-ten-word request
  is not an enforced length guarantee.
- The repository does not pin model revisions. The companion metadata pins
  CLIP to `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268` and LLaVA to
  `b234b804b114d9e37bb655e11cbbb5f5e971b7a9`. These are candidate revisions,
  not reconstructed weights from the authors' original runs.
- No license file was present in the inspected repository. The local reference
  copy is retained for inspection; this checkout contains an attributed numerical
  reimplementation, not a wholesale copy of the author pipeline.

The numerical kernel below validates this interpretation with analytical
fixtures. It has not been compared numerically against the authors' PyTorch
execution, and it is not a Flickr30k/COCO reproduction. That parity check is a
gate before the archive inference run.

## Experiment arms and claims

| Arm | Ranking | Purpose |
| --- | --- | --- |
| A | q·image | Primary baseline, no captions |
| B | Image-vector feedback, author PRF normalization | Paper-code baseline |
| Bm | Image-vector feedback, GRF normalization | Controls normalization when comparing modalities |
| C | GRF from inherited captions | Replacement baseline; inherited lineage remains unknown |
| D | GRF from fresh pixels-only captions | Predeclared primary candidate |
| E | 0.5(q·image) + 0.5(q·fresh-caption) | Simple alternative; checks whether the feedback machinery is useful |

**Primary hypothesis:** D improves mean paired-intent nDCG@10 over A on protected
new visual queries. **Mechanism checks:** D versus Bm tests the value of textual
feedback under equal aggregation rules; D versus C tests the complete fresh
recipe's replacement value. C may have received historical metadata unavailable
to D, so that contrast cannot identify caption-model quality alone.

Only D−A is the confirmatory comparison. Other arms are diagnostic and must not
be selected after seeing heldout results. A frozen caption-to-image permutation
control can diagnose whether correspondence matters; it does not supply a
human answer key or another promotion candidate.

Freeze K, weights and temperature at the paper defaults. No multi-turn feedback,
AFS training, OCR, source titles/dates, language-model query rewriting or encoder
swaps enter this first comparison. Failures remain outcomes. If a top-five item
lacks a valid caption, the planned corpus runner returns the baseline ranking
for that query, marks the fallback and includes it in the primary analysis;
never silently drop unsuccessful images/queries. The numerical kernel currently
raises on missing vectors so the future runner must implement this declared rule.

## Inputs and multilingual scope

1. Use the completed, hash-addressed **legacy delivery phase** as the input
   release, even while master acquisition is incomplete. Its manifest SHA is
   `ddd2617e8728ea46ec30b459363f5b4eff67ca1c63418d175308d4736be4a4ba`.
   It accounts for 13,478 decoded images and 21 explicit failures. Verify private
   manifest/shard bytes, import version and eligibility before selection. This is
   fresh processing over preserved delivery pixels, not a master-image study.
2. Target a **100-image development corpus**, with the actual count determined
   by whole-family grouping and verified availability. Inspect archive series,
   aerial/ground-level/document image types, text/legibility and resolution before
   freezing selection quotas. Record any deliberate oversampling; no current
   claim of representativeness. The existing 30-record release is an engineering
   convenience sample and remains excluded from performance claims.
3. Keep exact duplicates and reviewed photographic families together. The
   current CLI freezes whole groups, so target count is not guaranteed. Define
   deterministic family representatives before generating vectors or scoring:
   choose one reviewed record per family, record the selection and use its pixels,
   captions and relevance in every arm. The source snapshot still preserves whole
   groups. This prevents duplicate reward and avoids crediting a poorly matching
   family member for another member's relevance. This corpus adapter is pending.
4. Use one shared image corpus, **12 development query intents**, each worded in
   French and English. Protect new heldout intents and semantically related
   paraphrases from development. Forty heldout intents is a planning target;
   exact count must be chosen from development variance, family dependence and
   reviewer capacity before protocol lock. If adequate precision is infeasible,
   report a screening pilot and create a later larger study.
5. Fresh captions receive rendered image pixels and a fixed visual prompt only.
   Preserve input/render hashes, orientation/color/resize/crop recipe, prompt
   assignment, weights/processor revision, both raw generation steps, precision,
   device, timing, usage and per-item failures. All arms share the same image
   encoder input and processing. Compare masters/resolution in a separate study.

Use `openai/clip-vit-base-patch32` first to establish paper-method parity. Its
[model card](https://huggingface.co/openai/clip-vit-base-patch32) identifies
English-language limitations; it is not established as the eventual bilingual
production encoder. Run both native French and English queries through this
fixed model and publish both results. English improvement with French loss does
not support bilingual adoption. Failure here cannot establish that captions are
ineffective under a stronger multilingual encoder. A subsequent encoder study
must rerun all arms in its own shared space. Never mix current 1024-dimensional
BGE vectors with 512-dimensional CLIP vectors, or substitute human English
translations into the native French score.

## Human reference: what gets labeled

Humans judge **whether each image satisfies a search intent**, viewing the exact
study pixels. They do not assess whether the generated prose sounds convincing.

- Query author: independently writes visual intents such as visible transport,
  building forms, water, industrial structures or aerial layouts. These are
  categories to review, not claims that particular example images exist. Query
  wording must not be derived from candidate captions or inspected rankings.
- Bilingual reviewer: checks that both wordings ask for the same visual evidence.
- Relevance reviewers: grade each intent/image 0 (irrelevant), 1 (partly relevant)
  or 2 (clearly relevant), with uncertain/unjudgeable flags. Exhaustive judgments
  over the small corpus permit a valid ideal ranking. A pooled top-k judgment set
  alone cannot be treated as complete nDCG ground truth.
- Have two reviewers independently label the heldout primary benchmark, then
  adjudicate disagreements with reasons. Freeze raw versions, agreement,
  exclusions and adjudicated reference. Current imported labels remain
  `pending_quality_review`; the CLI does not make them gold automatically.
- Hide captions, source metadata and method names during visual relevance review.
  An optional separate caption review labels concrete claims as visible,
  unsupported or uncertain. Those judgments diagnose hallucination; they do not
  replace relevance labels. Exact place/date tests later need source evidence.

With a 100-image corpus, 12 development intents require about 1,200 distinct
intent/image judgments. Forty heldout intents require about 4,000 per reviewer,
before disagreement review; French/English wording checks are additional work.
These are workload estimates, not reviewed examples or a power calculation.

## Analysis and proposed interpretation rule

For each intent, compute nDCG@10 in each language, then average the two. Use gains
2^grade−1 and log2(rank+1) discount; calculate the ideal ranking from complete
adjudicated family relevance. The primary estimand is the mean paired difference
D−A. Resample **intent clusters** with paired language observations kept together;
related intents must share a cluster. Freeze the cluster map, 10,000 bootstrap
draws, seed and percentile 95% interval before accessing heldout outcomes. Treat
language and image-type slices as predeclared diagnostic guardrails.

Proposed practical gate, to lock before running:

- Primary mean improvement at least **0.05 absolute nDCG@10**, with a 95% interval
  excluding zero. This is a proposed product-value threshold, not an expected gain
  inferred from the paper.
- Neither native language has mean decline worse than **0.03**. Report intervals;
  a lower confidence bound below −0.03 leaves that language's guardrail unresolved.
- Report coverage, fallbacks, encoder/caption time and attributable cost. Freeze
  a latency/cost ceiling once runtime profiling provides real numbers.

**Supported:** primary gate passes, language guardrails clear and reference/input
quality gates pass. **Practical failure:** the upper primary interval is below
0.05, or a material language regression is established. **Inconclusive:** intervals
cross the practical threshold, references are inadequate or a guardrail is
unresolved. Do not call an inconclusive small pilot a success or a falsification.
Zero-relevance intents have undefined nDCG; retain them as a separately reported
negative-control slice with no fabricated zero/one nDCG and no claims of calibrated
abstention. Hard negatives and weak initial top-five results must be retained.

## Execution gates and concrete next work

| Gate | Deliverable | Current status |
| --- | --- | --- |
| 0: reconstruct the method | Versioned paper/code audit, kernel and analytical checks | Prepared here; PyTorch parity still pending |
| 1: know the pilot | Verified completed-phase import, coverage inspection, reviewed family corpus and paired development intents | Pending |
| 2: pin the fresh recipe | Render code, weights/processors, prompt assignment, generation settings and exact runtime | Candidate model revisions recorded; runtime/render unresolved |
| 3: profile a tiny run | Five development images, at most ten generation steps; inspect actual render/output and measure throughput/cost | Pending; no inference started |
| 4: freeze the evaluation | Human reference, new intents, analysis, sample adequacy, wall/spend ceilings and failure policy | Pending |
| 5: run the bounded comparison | At most two caption-generation steps per image; cached embeddings; all six arms and retained traces | Pending |
| 6: decide and retain | Results including failures, then a larger independent study or separate serving candidate | Pending |

The registered preparation budget is **zero model calls and zero model spend**.
This work has no GPU purchase, weight download or full-corpus generation. A future
100-image recipe has a proposed ceiling of 200 generation steps, including its
five-image profiling subset; retries must count against that ceiling. Dollar,
wall-time, hardware, precision and concurrency limits are unresolved and block
transition to a frozen executable protocol. Captioning is offline; query-time
vector ranking makes no generative model calls.

Run the independent numerical checks from the isolated research checkout:

```bash
.venv-bulk/bin/python -m unittest discover \
  -s pipelines/caption_feedback_pilot -p 'test_*.py' -v

.venv-bulk/bin/python pipelines/caption_feedback_pilot/kernel.py \
  --fixture pipelines/caption_feedback_pilot/synthetic-fixture.json \
  --output /absolute/private/path/kernel-smoke.json
```

The CLI accepts only an explicitly synthetic fixture. It produces vector/rank
traces, not archive search metrics. A corpus inference/evaluation runner is still
required. A new study definition lives in
`pipelines/research_platform/examples/caption-feedback-study.json`; the existing
broad study and previously published versions are preserved.

The local Lab output contains the brief, source manifest, numerical report,
study publication/recovery receipts and acquisition recovery evidence. Only
preparation metadata is published to the existing research study D1/private R2
boundary. Live app Workers, indexes, bindings and serving rows are unchanged.

After this experiment, test OCR's incremental benefit with the winning fixed
retrieval configuration. Then test separated evidence channels using independent
place/date judgments. New source imports create new versions and study snapshots;
they do not change the corpus underneath a running or completed experiment.
