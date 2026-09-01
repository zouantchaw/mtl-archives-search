# Hôtel Nelligan reference concept — fidelity and release review

Review date: 2026-09-01

This ledger compares the implemented client artifact with the three art-directed
design references in `design-reference/`. It records intentional departures as
well as defects corrected during the final Agent Browser pass.

## Fidelity ledger

| Area | Reference intent | Implemented result | Release judgment |
| --- | --- | --- | --- |
| Opening composition | Editorial mineral-paper cover, oversized serif title, architectural cutaway, camera rail, compact hotel identity | Preserves the palette, typographic hierarchy, cutaway, rail, primary action, and restrained header; adapts the 16:10 board into a responsive first chapter | Faithful adaptation |
| Spatial chapter | Dark, immersive atrium view with camera positions and an evidence panel | Original interactive Three.js conceptual massing, four camera presets, orbit control, visible record controls, evidence drawer, reduced-motion behavior, and non-WebGL fallback | Functionally exceeds the static reference; geometry is intentionally schematic |
| Evidence | A work should reveal source, rights, visible/reported distinction, and production uncertainty | Four independently reviewed records open a modal drawer with cote, narrative role, evidence boundary, rights state, unresolved fields, and source link | Faithful and more explicit |
| Production studies | Three resolved applications with room imagery and production criteria | Atrium Ledger, Room as Citation, and Listening Vault each have an original application image plus location, scale, substrate, light, maintenance, and rights fields | Faithful responsive expansion |
| Provenance | Clear chain from source through fabrication | Five-step source, review, interpretation, approval, and fabrication chapter tied to the client-facing Provenance boundary | Faithful |
| Close | Decisive paid next phase without implying contact or commission | Measured 4–6 week study scope; action records only an in-session review state and states that no message was sent | Faithful and release-safe |
| Responsive behavior | Desktop presentation board | Responsive long-form presentation at 390 px with no horizontal page overflow, touch-friendly record rails, and stacked production data | Intentional delivery expansion |

## Intentional departures

- The implementation uses four reviewed archive works rather than the twelve
  illustrative positions in the spatial design reference. Unreviewed filler
  would weaken the concept's evidence promise.
- The Three.js model is conceptual massing, not a photoreal replica or measured
  digital twin. It exists to test sequence, vertical reading, interaction, and
  evidence access until a paid site study supplies plans and measurements.
- No current hotel photography, floor plan, or scraped virtual-tour media is
  bundled. Original visualizations carry the atmosphere without implying
  property permission or undocumented existing conditions.
- The reference boards use a slide-like 16:10 composition. The delivered HTML
  is a responsive editorial sequence so a reviewer can read details, inspect
  records, and use the 3D scene without shrinking all content into one viewport.

## Corrected during release review

- Replaced root-absolute media URLs with `BASE_URL`-aware relative URLs and
  verified the production build beneath `/dist/`.
- Deferred the Three.js chunk until the spatial chapter approaches the viewport
  and suspended its render loop when offscreen or when the document is hidden.
- Added a complete WebGL teardown path, context-loss fallback, bounded pixel
  ratio, reduced-motion camera changes, and pointer-drag click protection.
- Added keyboard-accessible archive controls, meaningful non-canvas labels, a
  modal focus trap, Escape close, focus return, and a non-interactive backdrop
  in the accessibility tree.
- Added the uncommissioned/non-affiliation language to page metadata, opening
  release metadata, and the closing chapter.
- Disabled production source maps and preserved local font/media bundling.

## Verification

The final local release pass completed:

```text
npm run typecheck --workspace=@mtl-archives/city-memory
npm run validate:client --workspace=@mtl-archives/city-memory
npm run build --workspace=@mtl-archives/city-memory
```

Agent Browser verified:

- 1600 × 1000 opening, spatial, evidence, production, and closing chapters;
- all four 3D camera controls and the accessible record controls;
- modal focus entry, Escape close, and focus return to the invoking record;
- closing action status with no external message or navigation;
- 390 × 844 mobile opening with page width equal to viewport width;
- production assets and reviewed record assets from a nested production path;
- a dedicated 10-page letter-landscape PDF rendered to PNG at 120 dpi, with no
  blank pages, clipping, overlap, broken glyphs, or unreadable appendix fields;
- no page or JavaScript errors in the final browser pass.

## Remaining release gates

The artifact is ready for owner review, but issue #126 should remain open until
the owner approves the final package and chooses its access-controlled hosted or
PDF handoff. `noindex` does not provide privacy. A real recipient, outreach
message, channel, sender, and follow-up
boundary remain separate #127 decisions. A commissioned property study still
requires property-approved photography, current plans, measurements,
attachment and life-safety review, crop-specific reproduction review, and
fabrication samples.
