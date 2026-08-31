# Dataset Factory / process appendix

This study is a bounded projection of the MTL Archives Dataset Factory. The cultural output leads; the factory supplies a repeatable source, evidence, and review trail.

## What happened

1. Candidate records were selected from the 36-record #91 dossier packet.
2. The independent dossier-review receipt adjudicated 32 records as accepted and held four aerial candidates. The twelve records in this study are all from the accepted set.
3. The final published dossier artifact records each selected record as `published_independently_verified` and `fully_verified=true`.
4. Each selected derivative is linked to a canonical record, source URL, archive metadata, rights authority, image hash, bounded visual claim, uncertainty list, and transform history.
5. This package projects those records into a buyer brief, four curatorial directions, preliminary spatial composition sketches, an interactive evidence room, a concept deck, and a source-safe reel.

## Evidence chain

- Candidate packet: `docs/dataset-factory/fixtures/verified-dossiers-publication-v1/candidate-packets-v1.json`
- Independent review receipt: `docs/dataset-factory/fixtures/verified-dossiers-publication-v1/independent-dossier-review-v1.json`
- Final published dossiers: `docs/dataset-factory/fixtures/verified-dossiers-publication-v1/published-dossiers-v1.json`
- Publication status: `docs/dataset-factory/fixtures/verified-dossiers-publication-v1/publication-status-v1.json`
- Buyer-facing projection: `provenance-ledger.json`

The ledger stores exact SHA-256 bindings for the candidate packet, independent review receipt, final published dossiers, and publication status. The selected image hashes are checked by `node validate-specimen.mjs`.

## Trust boundary

The review supports the selected image mode and the captured rights/attribution authority. Archive titles, dates, cotes, locations, building or brand identities, georeferences, measurements, land use, and historical interpretations remain reported metadata or open uncertainty unless explicitly stated otherwise. Relatedness in this study is editorial; empty family links remain empty.

This appendix does not claim a completed Agentic Archive Operator (#110) run trace, buyer validation, legal opinion, production-resolution clearance, or market validation. Those are separate gates.
