# Caption contract and review rubric v2

A visual description should state camera viewpoint, main subjects and distinctive visible relationships accurately enough to help someone distinguish and retrieve the image. Fluency, length and historical atmosphere are not quality measures.

## Separate outputs

1. **Visual description:** concise pixel-grounded prose. Identify the camera viewpoint first when it matters. Describe main subjects, spatial relationships and distinguishing visible details. No arbitrary required length: an empty-water image can need one sentence; a complex city view can need more.
2. **Structured visual features:** viewpoint (ground/aerial/interior/unknown), aerial perspective (oblique/nadir/unknown where applicable), medium, main objects and relationships. Preserve unknowns. Each field must carry model/prompt/input version, evidence basis and review state. These are candidate feature contracts for #138/#139, not production schema changes in #136.
3. **Source context:** documented names, dates, locations and attribution, linked to the original record or reviewed source. Do not silently turn supplied metadata into a visual observation. Architectural style does not date the photograph.

OCR is a separate evidence source. Include sign wording only when legible and verified; retain uncertain transcription rather than inventing names. Do not claim specific people, clothing, activity or fine objects when the inspected resolution cannot establish them. Avoid boilerplate such as “a historical photograph,” “captures a moment in time,” or “bustling with activity” unless it adds supported information relevant to the image.

## Review dimensions

The versioned machine-readable rubric is `caption-rubric-v2.json`:

- **Accuracy:** supported, visibly contradicted, unsupported, or uncertain/requires source review.
- **Coverage:** sufficient main scene and viewpoint, missing viewpoint, missing subjects/relationships, both missing, or uncertain.
- **Retrieval usefulness:** distinctive, generic, misleading, or uncertain. This is a reviewer judgment; actual search performance is separately measured.

Do not average these into a single score. An accurate but generic caption needs different work from one that invents a clock tower. A correct source-supplied date should not be labelled visually proven; when evidence is not provided, reviewers may abstain rather than label it false.

## Example: record 18173 / A01

Draft visual description: “Oblique aerial colour photograph looking down across dense city blocks. A large domed stone building and an ornate building with green roofs stand near the centre, surrounded by taller office buildings, streets and parking lots. A broad roadway crosses behind them, while railway tracks and construction areas run along the lower edge.”

This is an assistant-authored example, not a replacement production caption or independent gold label. Building names and photograph date remain source-context work. The example was discussed with the owner before v2 review, so subsequent A01 caption judgments are assisted calibration, not blind independent evidence. The earlier owner's viewpoint selection predates that discussion and retains its original provenance. Do not show this candidate or assistant judgments on the remaining review cards.

## Replacement pilot before scale

Use the representative sample to compare the legacy captions against a versioned candidate generation process. Keep source context and image-only outputs separate; retain raw output, schema failures and abstentions. Normalize image orientation and document derivative resolution. Compare factual error/uncertainty, viewpoint coverage and discriminative detail by slice, then compare downstream search against frozen queries. Include missing/low-information and difficult scenes; do not select only attractive successful examples.

Prefer validated offline features for routine filtering; do not require a live vision call merely to determine whether a photograph is aerial. Expand generation only after reviewed sample quality and held-out retrieval justify it. Preserve old captions and indexes for comparison and rollback. This issue does not run a model bake-off or bulk recaptioning; those executions are tracked in #139.

## Migration and completion

Original baseline scores and `protocol.json` remain immutable. V2 answers use distinct keys and are never inferred from old overall assessments. Preserve all saved and browser-draft values, including notes and legacy assessments. The review page exposes every question and permits partial saves. An unanswered dimension is missing evidence, never approval.

All twelve owner viewpoint answers and 36 caption dimension answers are complete under the clarified rubric. See owner-review-summary.json for validated results and discrepancy dispositions. A01 assisted calibration remains separate from the eleven independently assessed captions.
