# City Memory × Hôtel Nelligan reference concept

This package is the flagship place-path reference concept for Provenance
Activation. It is a self-initiated, uncommissioned study: Hôtel Nelligan is the
visual subject, not a confirmed client or affiliate.

## Concept

**The Atrium Ledger** makes the hotel's architecture behave like an archive. A
reversible field of suspended, translucent image planes crosses a conceptual
multi-level atrium. From reception the works read as a chronology; from upper
levels an individual record and its source become legible.

The proposal deliberately adds a cultural layer to Atelier Zébulon Perron's
recent interior language rather than proposing an interior redesign. It uses
the property history documented by the Québec heritage register as its factual
anchor and treats current hotel photography as research-only unless permission
is granted.

## Run the concept

```bash
npm run dev --workspace=@mtl-archives/city-memory
npm run typecheck --workspace=@mtl-archives/city-memory
npm run validate:client --workspace=@mtl-archives/city-memory
npm run build --workspace=@mtl-archives/city-memory
```

The app is under `apps/city-memory`. The three generated design references used
for implementation QA are under `design-reference/`.

The client delivery contract is an access-controlled static hosted site or a
ZIP served through a local HTTP server. The Vite build uses relative asset URLs
so it can be hosted under a protected subpath. `noindex` is discovery guidance,
not access control; the selected host must enforce the recipient boundary. The
app is not represented as a single double-clickable HTML file: browsers commonly
block local ES-module loading under `file://`. For an offline review, run
`npm run preview --workspace=@mtl-archives/city-memory` from the unpacked
repository/package and open the printed local URL.

The visually inspected 10-page PDF handoff lives at
`output/pdf/city-memory-hotel-nelligan-reference-concept-v1.pdf`. It is a
dedicated print composition, not an automatic pagination of the scrolling app.
The package validator requires both the interactive artifact and this PDF.

## Evidence boundary

The core archive sequence uses records 11, 17, 54, and 88 from the independently
reviewed publication packet. Their pixels passed full-decode review and their
captured dataset authority is CC BY 4.0 with attribution to Ville de Montréal /
Archives de la Ville de Montréal. Titles, dates, cotes, and locations remain
archive-reported rather than independently corroborated.

The reference concept is suitable for controlled concept review. Production
still requires crop-specific rights review, creator and moral-rights review,
trademark/privacy checks where relevant, full-resolution acquisition, and
property approval.

## 3D and image-to-world decision

The shipped 3D scene is an original conceptual model made from simple Three.js
geometry. It is explicitly not a measured survey or a virtual tour of the
current hotel. This is the right client-facing boundary until a paid site study
provides current plans, photography, measurements, attachment constraints, and
image permission.

An internal image-derived experiment remains useful, but it should be described
as a depth study:

1. Use a permissioned or internal-reference lobby photograph.
2. Run Depth Anything 3 to estimate monocular depth and camera parameters.
3. Convert the output to a depth-displaced point cloud or GLB.
4. Compare sightline, scale impression, and proposed art placement.
5. Never expose inferred hidden geometry as documented property condition.

Tool assessment:

| Tool | What it does | Fit for this project |
| --- | --- | --- |
| [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3) | Single- or multi-view depth, camera, Gaussian, GLB and point-cloud outputs; Apache 2.0 code | Best immediate depth/geometry study; local Apple-silicon feasibility still needs a bounded model test |
| [Diorama](https://github.com/3dlg-hcvc/diorama) | Zero-shot single-view indoor scene decomposition and modelling; MIT code | Promising research path, but current setup assumes CUDA and several large model dependencies |
| [HY-World 2.0](https://github.com/Tencent-Hunyuan/HY-World-2.0) | Image/text to navigable 3D world, 3D Gaussian and mesh outputs | Technically ambitious but operationally too heavy for the client app; custom territorial model license needs separate review |
| [GEN3C](https://github.com/nv-tlabs/GEN3C) | Camera-controlled novel-view video from a single image | Useful for an internal cinematic test, not an editable or survey-grade hotel model |
| [SPAR3D](https://github.com/Stability-AI/stable-point-aware-3d) | Single-image object mesh generation | Object-focused; useful for furniture/artefact studies, not a complete lobby |

The production architecture therefore has three tiers:

- **Tier 1, shipped:** art-directed conceptual Three.js scene with explicit
  confidence labels.
- **Tier 2, internal experiment:** monocular depth/parallax from a permissioned
  property reference.
- **Tier 3, paid study:** measured model built from a site walk, plans, and
  approved photography; advanced reconstruction only if it materially improves
  a client decision.

## Property and practice sources

- [Québec heritage register — former William-Cormack store-warehouse](https://www.patrimoine-culturel.gouv.qc.ca/rpcq/detail.do?id=115108&methode=consulter&type=bien)
- [Hôtel Nelligan — reopening / new chapter](https://hotelnelligan.com/nelligan-reopening/)
- [RIBA Plan of Work 2020](https://www.riba.org/media/sszn5kkt/2020ribaplanofworktemplatepdf.pdf)
- [Artelier — art for hotels](https://www.artelier.com/art-for-hotels)
- [Rockwell Group — Moxy East Village / urban archaeology](https://www.rockwellgroup.com/projects/moxy-east-village)

## Release boundary

- No hotel photography is bundled.
- No floorplan, room count, event capacity, or installation dimension is
  presented as current verified fact.
- The scene says `Conceptual massing · not a measured survey`.
- The closing page says the study is not commissioned by or affiliated with
  Hôtel Nelligan.
- The next paid phase is a measured 4–6 week spatial study, not speculative
  outreach from this repository.

## Fixed reference offer

- City Memory Concept Study: **5 weeks, $38,000 CAD**.
- Payment schedule: 40% at start, 40% at direction approval, 20% at final
  handoff.
- Included: property walk and measured surfaces, guest journey/sightline map,
  rights-reviewed image shortlist, three resolved spatial applications,
  material/light/maintenance tests, cost class, and production roadmap.
- Excluded: final licensing and reproduction fees, engineering, permits,
  fabrication and installation, licensed measured survey, travel outside
  Montréal, taxes, third-party costs, and ongoing software/content operations.
- This is a reference scope for controlled review, not a sent proposal or
  evidence of hotel approval.
