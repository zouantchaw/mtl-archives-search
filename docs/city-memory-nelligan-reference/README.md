# City Memory × Hôtel Nelligan reference concept

This package is a self-initiated reference concept for a possible City Memory
engagement with Hôtel Nelligan. The property is the subject of the study, not a
confirmed client or affiliate.

## The Street Within

Hôtel Nelligan occupies four connected former commercial buildings on rue
Saint-Paul. **The Street Within** uses that structure to organize four guest
encounters with reviewed archival views of Old Montréal:

1. **Meet the Street:** arrival begins with a sourced public-space record.
2. **Cross the Layers:** four records are distributed through a conceptual
   atrium at different levels and reading distances.
3. **Stay Among Traces:** one room application gives a record quiet attention
   without claiming it as an actual hotel sightline.
4. **Continue the Walk:** a concierge encounter turns the final record into an
   invitation to notice present-day Montréal outside.

The idea is not to reproduce a historical street indoors. The hotel acts as a
threshold through which the guest reads the living city.

## Run and verify

```bash
npm run dev --workspace=@mtl-archives/city-memory
npm run typecheck --workspace=@mtl-archives/city-memory
npm run validate:client --workspace=@mtl-archives/city-memory
npm run build --workspace=@mtl-archives/city-memory
```

The interactive artifact lives under `apps/city-memory`. The visually reviewed
ten-page PDF handoff lives at
`output/pdf/city-memory-hotel-nelligan-reference-concept-v1.pdf`.

## Construction of the application images

Each architectural application has two separate parts:

- a blank, original conceptual setting
- one or more reviewed MTL Archives image files placed by the web application

The architectural settings contain no fabricated historical photographs. The
cutaway and atrium use records 11, 17, 54, and 88. The room uses record 54. The
concierge encounter uses record 88. The component responsible for those layers
is `apps/city-memory/src/SourceVisual.tsx`.

## Evidence boundary

The four records passed full image decode and match the reviewed dossier hashes.
Their captured dataset authority is CC BY 4.0 with attribution to Ville de
Montréal / Archives de la Ville de Montréal. Titles, dates, cotes, and locations
remain archive-reported rather than independently corroborated.

Production still requires full-resolution masters, crop approval, creator and
moral-rights review, signage and trademark review where relevant, and property
approval.

## Spatial-study boundary

The Three.js scene is an original conceptual section built from simple geometry.
It tests sequence, levels, sightlines, and the placement of four exact archive
textures. It is not a survey, virtual tour, digital twin, floor plan, or account
of current construction conditions.

A commissioned study would replace this diagram with site photography, current
plans, measured surfaces, attachment constraints, lighting tests, and approved
image uses. Image-derived depth studies may support internal exploration, but
they must not be represented as measured property geometry.

## Property sources

- [Québec heritage register, former William-Cormack store-warehouse](https://www.patrimoine-culturel.gouv.qc.ca/rpcq/detail.do?id=115108&methode=consulter&type=bien)
- [Hôtel Nelligan, Our Storied Past](https://hotelnelligan.com/hotel/our-story/)
- [Hôtel Nelligan, A New Chapter](https://hotelnelligan.com/nelligan-reopening/)
- [Atelier Zébulon Perron, Mama C](https://zebulonperron.com/en/mama-c-nelligan-hotel)

## Fixed reference offer

- City Memory Concept Study: five weeks, $38,000 CAD
- Payment: 40% at start, 40% at direction approval, 20% at final handoff
- Included: site walk, measured surfaces, guest journey and sightline map,
  rights-reviewed image shortlist, three resolved applications, material and
  light tests, cost class, and production roadmap
- Excluded: final licensing, engineering, permits, fabrication, installation,
  licensed survey work, taxes, third-party costs, and ongoing operations

This is a reference scope for controlled review. It is not a sent proposal or
evidence of hotel approval.
