# Dataset Factory Label Ontology v0

Issue: GitHub #46

Status: v0 contract for Codex-assisted, human, and model-generated labels. This is additive to the existing ETL/autoresearch outputs; it does not replace source metadata, taxonomy labels, quality labels, VLM captions, or search-eval judgments.

## Purpose

The Dataset Factory needs labels that are useful for product, ML, and provenance work without blurring what was actually seen in an image versus what was copied from metadata or inferred by a model.

Every label row must answer four questions:

1. What can be seen directly in the image?
2. What does the source metadata claim?
3. What did the reviewer infer, and how confident is that inference?
4. What commercial, search, story, or ML use is this record fit for?

The canonical machine contract is `label-schema.v0.json`. Example rows live in `label-examples.v0.jsonl`.

## Output Shape

Each JSONL row is one label decision for one archive record:

```json
{
  "schema_version": "dataset_factory_label_v0",
  "record_id": "mtl_archives_metadata_0.json",
  "image_filename": "mtl_archives_image_0.jpg",
  "source": {},
  "review": {},
  "labels": {},
  "evidence": {},
  "confidence": {},
  "pairwise_preferences": []
}
```

The row is JSONL/D1/Hugging Face compatible by design:

- no nested binary payloads
- stable `record_id` join key
- bounded enum values
- arrays for multi-label fields
- evidence notes as short strings
- pairwise preferences stored as explicit objects, not implicit ranking order

## Source And Rights Fields

Rights must travel with every label row because Dataset Factory artifacts may become commercial datasets, training data, product feeds, or partner exports.

Required source fields:

- `source_system`: `montreal_open_data_ckan`, `archives_montreal_atom`, `r2_derivative`, or `unknown`
- `package_slug`: CKAN package slug when available
- `resource_id`: CKAN resource ID when available
- `source_url`: original image or source record URL
- `license_id`: SPDX-style short value when possible, e.g. `cc-by-4.0`
- `license_url`: canonical license URL
- `credit_line`: display attribution required for the record
- `commercial_use_allowed`: boolean
- `rights_checked_at`: ISO date when rights were checked
- `rights_notes`: short caveat when attribution, non-commercial use, or share-alike rules need attention

For the current CKAN/Open Data corpus, use:

- `license_id`: `cc-by-4.0`
- `license_url`: `https://creativecommons.org/licenses/by/4.0/`
- `commercial_use_allowed`: `true`
- default `credit_line`: `Archives de la Ville de Montréal`

For oblique aerial rows, preserve the source credit requirement:

- `credit_line`: `Cote. Nom du photographe. Archives de la Ville de Montréal`
- add `attribution_detail_missing` if cote or photographer is unavailable in the current row

Do not mix AtoM rows into commercial exports unless their rights fields are explicitly compatible.

## Label Fields

### `human_legible`

How quickly a normal viewer can understand what the image shows.

Allowed values:

- `high`: a viewer can understand the subject in 1-2 seconds
- `medium`: understandable after inspection, but dense, aerial, technical, or partially unclear
- `low`: subject is hard to understand without metadata or expert context
- `unusable`: too degraded, blank, broken, or visually incoherent for normal use

### `story_value`

Whether the image can anchor a public-facing story.

Allowed values:

- `high`: strong narrative hook, people/place/change/signage/event, or obvious local memory
- `medium`: useful with context, but not instantly compelling
- `low`: context may exist, but the image is visually generic or thin
- `none`: no clear story use

### `print_value`

Whether the image could plausibly sell as a print or premium visual object.

Allowed values:

- `high`: strong composition, visually striking, suitable as wall object
- `medium`: interesting but niche, technical, or needs restoration/crop
- `low`: archival value but weak as a visual product
- `none`: not viable for print

### `partner_fit`

Multi-label field for institutional or B2B relevance.

Allowed values:

- `museum_archive`
- `urbanism_planning`
- `art_design`
- `education`
- `tourism_local`
- `real_estate_development`
- `civic_infrastructure`
- `environmental`
- `none`

### `search_value`

How much the record should matter in browse/search/eval surfaces.

Allowed values:

- `priority`: strong candidate for default discovery, benchmark queries, or curated surfaces
- `high`: useful and clear result for at least one important query family
- `medium`: useful in filtered or long-tail search
- `low`: keep searchable but do not prioritize
- `exclude`: hide from default search until repaired or rights-cleared

### `quality_action`

Array of recommended visual/data actions.

Allowed values:

- `no_action`
- `rotate`
- `crop`
- `border_trim`
- `tone_normalize`
- `retry_fetch`
- `exclude`
- `review`
- `preserve_original`

Use `preserve_original` when a fix should create a derivative while retaining the archival source unchanged.

### `geo_time_extractable`

Object with responsible location/date extraction levels.

`geo` allowed values:

- `none`
- `broad_area`
- `specific_place`
- `exact_point`

`time` allowed values:

- `none`
- `year_range`
- `year`
- `date`

Also include:

- `public_safe_exact_location`: boolean
- `notes`: short string

Exact location/date cannot come from visual guesswork alone. It requires source metadata or external verification.

### `provenance_depth`

The strongest evidence level supporting the useful claims in the row.

Allowed values:

- `observed_only`: visual facts only
- `metadata_supported`: source metadata supports the claim
- `inferred`: reviewer/model inference without external confirmation
- `externally_verified`: checked against a separate outside source
- `uncertain`: evidence is contradictory or too weak

### `commercial_surface`

Multi-label field describing where this image could be used.

Allowed values:

- `print`
- `reel`
- `deck`
- `installation`
- `partner_brief`
- `newsletter`
- `search_feature`
- `dataset_eval`
- `none`

### Optional Intelligence Fields

Batch rows may also include richer ML fields. These are optional in v0 so older example labels remain valid, but Batch 001 should populate them whenever the evidence supports it.

#### `image_mode`

The visual mode of the record, independent of source dataset names.

Allowed values:

- `ground_street`
- `ground_interior`
- `ground_object`
- `aerial_vertical`
- `aerial_oblique`
- `document_map`
- `low_information`
- `unknown`

Use `aerial_vertical` for top-down survey frames, `aerial_oblique` for high-angle skyline/city views, and `low_information` for blank water, cloud, unusable scan, or mostly featureless frames even if they came from an aerial package.

#### `scene_text`

Detected or metadata-supported visible text in the image.

Each text item should include:

- `text`: the raw visible or OCR text
- `text_type`: `billboard`, `storefront`, `street_sign`, `poster`, `vehicle`, `document`, `inscription`, `caption_or_overlay`, or `unknown`
- `normalized_text`: lowercase normalized form for matching/search
- `location_hint`: short visual location such as `left billboard`, `building roof`, or `street sign`
- `confidence`
- `evidence_refs`
- `review_flags`

Use this for cases like `Magic Baking Powder`, `The Gazette`, store names, street signs, tram route text, and poster titles. If text comes from source metadata but is not directly readable in the current image, put the claim in `entities` and `evidence.metadata`, not `scene_text`.

#### `entities`

Named things that make the image searchable or linkable.

Allowed `entity_type` values:

- `brand`
- `business`
- `street`
- `landmark`
- `institution`
- `transit`
- `neighborhood`
- `person`
- `event`
- `natural_feature`
- `unknown`

Each entity must state whether it came from `observed_text`, `observed_visual`, `source_metadata`, `external_verified`, or `inferred`.

Examples:

- `Magic Baking Powder` as `brand` from `source_metadata` or `observed_text`
- `The Gazette` as `business` / `institution`
- `Rue Saint-Antoine` as `street` from source metadata
- `Parc Lafontaine` as `landmark`

#### `aerial_land_use`

The aerial-specific layer. Use it only when the image is aerial, oblique aerial, map-like, or low-information from an aerial source.

Fields:

- `dominant_land_use`: one of `farmland`, `residential`, `industrial`, `commercial`, `waterfront`, `rail`, `road_infrastructure`, `park_green_space`, `institutional`, `water`, `forest`, `mixed_urban`, `low_information`, or `unknown`
- `land_use_mix`: approximate visual proportions when safe; use `null` for `approx_share` if a number would be fake precision
- `urbanization_stage`: `rural`, `transitional`, `suburbanizing`, `urban`, `industrial`, or `unknown`
- `segmentation_candidate`: whether roads/fields/buildings/water could be segmented usefully
- `georeference_candidate`: whether the image has enough anchors for location estimation
- `notes`

Do not claim measured acreage from pixels until the image has scale/georeferencing evidence.

#### `geo_hypotheses`

Candidate locations with uncertainty. This field can hold multiple competing hypotheses.

Allowed precision:

- `none`
- `city`
- `neighborhood`
- `corridor`
- `specific_place`
- `exact_point`

Allowed methods:

- `source_metadata`
- `geocoded_text`
- `visual_place_recognition`
- `aerial_georeference`
- `external_verified`
- `human_inference`

Exact points require source metadata or external verification; visual guessing alone is not enough.

#### `search_expectations`

Explicit eval cases the search stack should satisfy.

Examples:

- query `Magic baking powder`, mode `ocr_lexical`, expected `top_1`
- query `farmland Montreal aerial 1947`, mode `semantic`, expected `top_10`
- query `The Gazette building`, mode `reranked`, expected `top_3`

These become retrieval tests for #49 and ranking/reward data for #52/#57.

#### `ml_tasks`

Which downstream task should learn from this record.

Allowed values:

- `ocr_scene_text`
- `entity_linking`
- `landmark_recognition`
- `geo_estimation`
- `aerial_land_use`
- `aerial_segmentation`
- `quality_repair`
- `search_reranking`
- `reward_preference`
- `active_learning`

Use this as routing metadata for active learning and GPU experiments.

## Batch 001 Lanes

Batch 001 is intentionally two-lane:

1. **Ground Text / Entity Intelligence**: street, building, sign, billboard, storefront, institution, landmark, people/event, and transit records. The goal is OCR/entity/search enrichment, not generic captions.
2. **Aerial Land-Use / Geo Intelligence**: vertical and oblique aerial records. The goal is land-use classification, segmentation candidacy, georeference candidacy, and historical change potential.

Keep the lanes separate in reporting. A single label schema covers both lanes, but success metrics differ:

- Ground lane: scene-text recall, entity precision, benchmark retrieval, provenance clarity.
- Aerial lane: image-mode accuracy, land-use class balance, segmentation usefulness, georeference candidate precision, low-information detection.

## Evidence Contract

Every nontrivial label must be explainable through `evidence`.

Evidence buckets:

- `observed`: visible facts from the image itself
- `metadata`: source fields copied or summarized from manifest/CKAN/AtoM
- `inferred`: reviewer/model conclusions that go beyond visible facts or metadata
- `verified`: facts checked against external sources

Each evidence item must include:

- `id`: short stable local ID, e.g. `obs_signage_street`
- `claim`: concise claim text
- `evidence_type`: one of `visual_observation`, `source_metadata`, `vlm_output`, `ocr_text`, `external_source`, `inference`, `human_judgment`
- `source_field`: source field when applicable
- `source_url`: URL when applicable
- `confidence`: 0-1 number
- `review_flags`: array of flags

## Review Flags

Use review flags aggressively. They are not failures; they are routing signals for active learning and human adjudication.

Allowed values:

- `needs_human_review`
- `thin_metadata`
- `synthetic_description`
- `attribution_detail_missing`
- `exact_location_unsafe`
- `date_uncertain`
- `orientation_uncertain`
- `quality_repair_needed`
- `rights_review_needed`
- `model_disagreement`
- `external_verification_needed`
- `none`

If no flag is needed, use an empty array in machine rows. The `none` enum exists for compact tabular exports only.

## Pairwise Preferences

Pairwise preferences are separate from factual labels. They support search ranking, commercial ranking, reward modeling, and later RL-style preference loops.

Each preference object compares the current record to another record for one criterion:

- `pair_id`
- `other_record_id`
- `criterion`: `search_relevance`, `story_value`, `print_value`, `partner_fit`, `human_legibility`, or `commercial_value`
- `query_or_context`: the query, surface, or use case being judged
- `preferred_record_id`: current record, other record, or `tie`
- `rationale`
- `confidence`
- `evidence_refs`

Never treat a pairwise preference as ground-truth metadata. It is a judgment for a context.

## Anti-Hallucination Rules

1. A visual observation can say "street with tram wires and storefronts"; it cannot say the exact intersection unless metadata or verification supports it.
2. A VLM caption is a model output, not a verified fact.
3. A generated description is not source metadata. Mark `synthetic_description` when the manifest says the description was generated.
4. If a row has `Cote. Nom du photographe. Archives de la Ville de Montréal` as its credit pattern but lacks cote/photographer fields, add `attribution_detail_missing`.
5. Do not infer commercial print value from resolution alone. Composition, legibility, repair needs, and rights all matter.
6. Do not collapse `story_value` and `search_value`; an image can be a weak story but a good search/eval item.
7. Do not overwrite source fields during labeling. Labels are downstream annotations.
8. Use `provenance_depth: uncertain` when evidence conflicts.
9. Any externally verified claim needs a URL and date checked.
10. Keep rights fields even for internal examples.

## Relationship To Existing Artifacts

Existing outputs remain useful inputs:

- `taxonomy_downstream.jsonl` can seed `partner_fit`, `search_value`, and review queues.
- `quality_labels.jsonl` can seed `quality_action`.
- VLM structured metadata can seed observed candidates, but must be reclassified as `vlm_output` evidence.
- Candidate files can seed sample packets, but candidate scores are not labels until reviewed.

The next issue, #47, should generate review packets that include this label shell alongside source metadata, current taxonomy, quality labels, VLM captions, image URLs, and rights fields.
