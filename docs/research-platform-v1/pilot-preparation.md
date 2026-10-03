# Caption-feedback pilot preparation — October 3, 2026

The next step is a human review of a fixed image candidate set, followed by
independent French/English development queries. This preparation runs in
`mtl-archives-search-research-data`, on `codex/research-data-contract-v1`.
The live app has no new bindings, deployments or serving-data writes.

## Completed preparation

| Item | Verified outcome |
| --- | --- |
| Completed delivery import | 13,499 accounted records: 13,478 decoded deliveries, 21 retained failures |
| Seeded candidate set | 100 records / 100 provisional byte groups; seed `20261003` |
| Candidate input verification | 100 metadata versions and 200 image blobs, 826,636,681 bytes checked by hash and size |
| Author-code numerical parity | 360 synthetic CPU comparisons passed, float64 and float32 |
| Human labels / independent queries / model calls | 0 / 0 / 0 |

Import: `c102d420bde265d585559cdbce4134f0db6a9bd7527392b6a4520fd0d269ac7b`.
Candidate snapshot: `cfc42de382d5e5a6f7abd0e2f46883cdfba5556113804f76d8617d0d008101f4`.
This snapshot is **engineering preparation**, not a reviewed research corpus.
It requires both verified delivery and thumbnail roles and keeps exact byte
groups together. The candidates have no record overlap with the earlier
30-record engineering release. Review may produce a different, explicitly
versioned corpus; do not edit this selection or silently replace weak images.

Durable local package:

```text
/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-caption-feedback-pilot-preparation-2026-10-03
```

Use the deployed [private review app](reviewer-app.md):
https://mtl-archives-research-reviewer.wiel.workers.dev. Start with Guide and five
saved image reviews for calibration. The preserved `review/index.html` remains
an offline inspection artifact for numbered images and full-resolution links.
Archive titles, dates, OCR and generated captions are hidden. The full-image links and
previews are exact verified cached bytes; contact sheets are presentation copies.
The folder also contains input/import receipts, coverage, parity evidence,
blank CSV worksheets and cloud publication/recovery receipts.

## Review sequence

1. In the app's **Images** step, record image type, usable visual detail,
   visible-text presence and uncertainty; **Save & next** retains the reviewer
   identity and exact input version. The blank CSV remains an offline alternative.
   Inspect full images when thumbnails are unclear. An image decoding successfully does not establish useful content.
2. In **Families**, group related photos and explicitly select a representative.
   Decide whether the first study covers aerial photographs only or includes map/document images as a
   separately reported group. Record image orientation and darkness concerns;
   any rotation or enhancement belongs to a pinned render recipe.
3. Freeze a new corpus from those reviewed decisions. Family review must cover
   its selected membership, with quality checks before research eligibility.
   Do not claim that unreviewed records elsewhere in the full import are reviewed.
4. In **Queries**, write the proposed 12 independent visual intents with paired
   French/English wording and an explicit visible relevance criterion. Have a bilingual reviewer check equivalence and
   related-intent groups. Queries must not be derived from generated captions.
   The app opens query writing after a completed family check as preparation;
   quality review and a research corpus freeze remain separate gates. Export the
   decisions for immutable local registration as described in the reviewer runbook.
5. Pin rendering, processors, weights, runtime and accounting; profile five
   development images. Use that evidence to set wall-time and dollar ceilings
   before the bounded caption experiment. Protected heldout intents, exhaustive
   relevance judgments, second review/adjudication and protocol lock remain
   separate gates in [the experiment brief](first-experiment.md).

Assistant inspection of all five contact sheets found aerial photos, map-like
scans, rotated presentations and some very dark frames (for example candidates
008, 015, 025 and 074). These are preliminary observations, not human labels,
automatic exclusions or a measured estimate of collection composition. Full
delivery images inherit the acquisition's explicit decode status; this preparation
does not revalidate preserved masters or establish OCR accuracy.

## Numerical evidence

`check_reference.py` verifies the pinned author source hash, then extracts only
the three reviewed arithmetic helpers via AST. It executes no author loaders,
network code or model pipeline. CPU Python 3.11.5, PyTorch 2.1.2 and NumPy 1.25.2
match the pinned reference requirements. The check uses seed `20261003`, five
feedback vectors and dimensions 3, 7 and 512.

Both aggregate-normalization policies passed at tolerances `1e-12` for float64
and `5e-6` for float32. All 180 float64 rankings and 176 float32 rankings agreed;
four float32 cases had near ties, so exact ordering was not asserted. This is
numerical parity on synthetic vectors, not reproduction of paper benchmark
results or evidence that archival retrieval improves.

## Reproduction and limits

`prepare.py` consumes an existing immutable preparation study/import. It has a
2 GiB selected-download cap, at most four private fetch workers and a free-disk
check. It writes local review artifacts only and calls no models. Use a new root
for a new attempt; completed receipts and blank templates are immutable.

```bash
.venv-bulk/bin/python pipelines/caption_feedback_pilot/prepare.py \
  --root /absolute/path/to/new/preparation \
  --import-receipt /absolute/path/to/verified/import-receipt.json

/absolute/path/to/reference-parity-env/bin/python \
  pipelines/caption_feedback_pilot/check_reference.py \
  --reference /absolute/path/to/pinned/reference-code \
  --source-manifest /absolute/path/to/audited/source-manifest.json \
  --output /absolute/path/to/new/reference-parity.json
```

The full import's reference index exceeded the private transport's 4 MiB
metadata limit. Publication now splits upstream references into bounded,
hash-addressed shards, records their total count and ordered-list digest, and
checks both during recovery before installing the local ledger. Earlier small
publications remain readable. Archive image bytes remain shared upstream assets;
publication uploads derived metadata only. An oversized root still fails before
remote artifact or D1 writes. The tests cover bounded sharding, replay, fresh
recovery and rejection of incorrect index accounting.

The preparation model budget remains zero. Storage and private transfer usage
are not covered by that model budget. There are no retrieval scores, caption
quality claims or product adoption decisions from this preparation.
