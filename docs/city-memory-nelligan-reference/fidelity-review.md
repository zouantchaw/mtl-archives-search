# Hôtel Nelligan reference concept fidelity review

Review date: 2026-09-01

## Release position

The client concept is titled **The Street Within**. It proposes a four-part guest
sequence through a conceptual Hôtel Nelligan setting:

1. Meet the Street
2. Cross the Layers
3. Stay Among Traces
4. Continue the Walk

The hotel is presented as a threshold to the surrounding district, not as a
reconstruction of Old Montréal. The proposal is self-initiated and has not been
commissioned or approved by Hôtel Nelligan.

## Image integrity

The four historical images are the reviewed local derivatives for records 11,
17, 54, and 88. They appear as full-frame archive objects in the HTML
applications and as direct textures in the Three.js study. The application
chapter contains no simulated room, lobby, or concierge photography.

## Property boundary

The factual anchor is the Québec heritage record for the former William-Cormack
store-warehouse at 106 to 112 rue Saint-Paul Ouest. Public material supports the
description of four connected former commercial buildings and a central atrium.

The following remain inputs to a commissioned study:

- current plans and circulation
- exact atrium dimensions and suspension points
- room categories and sightlines
- structural, fire, and life-safety constraints
- present-day photography approved for use
- full-resolution archive masters and crop approvals

The Three.js chapter is therefore labelled `Conceptual massing · not a measured
survey` and avoids a floor plan, room count, or construction dimensions.

## Visual review criteria

| Area | Required result |
| --- | --- |
| Cover | Property-specific title, restrained editorial hierarchy, and four unaltered archive objects |
| Archive sequence | Four distinct records in the order 11, 17, 54, 88, with archive-reported identity kept separate from visible evidence |
| Spatial study | Four-level conceptual section, four distinct image works, guided camera positions, selected-work response, and fallback behavior |
| Applications | Coded atrium elevation, room-scale archive object, and concierge folio using full-frame reviewed files |
| Provenance | Hotel decision matrix backed by detailed source and rights records |
| Commercial close | A fixed five-week study with inclusions, exclusions, payment schedule, and release boundary |

## Verification record

Before release, run:

```text
npm run typecheck --workspace=@mtl-archives/city-memory
npm run validate:client --workspace=@mtl-archives/city-memory
npm run build --workspace=@mtl-archives/city-memory
```

The final Agent Browser review covered the 1600 by 1000 presentation view, the
390 by 844 mobile view, the four camera positions, the evidence drawer, all
three applications, console errors, and horizontal overflow. The eleven-page PDF
was rendered to images and inspected before it replaced the previous handoff.

## Remaining gates

The reference package can be shared only after owner approval and a named,
controlled recipient decision. A commissioned property study still requires
site access, current plans, measured conditions, property-approved photography,
crop-specific rights review, and fabrication tests.
