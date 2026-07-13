# Real Pilot Intelligence v1

The successor Gate B artifact `ground-authoritative-research-v1` adds authoritative-source capture and claim drafting for the six ground records. It does not change or promote these intelligence packets: all external/historical/entity/place claims remain pending separate review, and dossier/task counts remain zero.

This tracked Issue #69 slice builds deterministic intelligence packets for the fixed 12 selected records. It consumes only the four hash-bound predecessor descriptors, the tracked source-acquisition snapshots, fixed merged visual decisions, and tracked 256x256 inspection derivatives. It performs no network or production reads. Every packet binds its exact record-image ledger sample and collection page. Ground packets also bind an exact CSV row. All packets bind the captured Montreal license page and canonical CC BY 4.0 page through explicit rights fields.

The JSON packet is authoritative. HTML dossiers and PNG overlays/contact sheets are deterministic renderings. Archive metadata reports are not independent verification; visual observations are limited to byte-bound and decoded `derivative_256` pixels; inference and rejected claims have separate collections. Record 105 has normalized OCR regions whose exact source-pixel rectangles are tested. Other records use explicit whole-image regions with null geometry. Independent-review rows remain pending and contain no copied primary decision. Consequently this slice has zero fully verified dossiers and zero benchmark tasks.

```bash
npm run dataset-factory:real-pilot-intelligence-v1
npm run dataset-factory:real-pilot-intelligence-verify-v1
npm run dataset-factory:real-pilot-intelligence-self-test-v1
npm run dataset-factory:real-pilot-intelligence-integration-test-v1
```

The verifier first validates the existing tracked fixture without writing: strict schemas, exact packet contents, source/image bytes, decoded dimensions, manifest, descriptor members, counts, and tree. It then regenerates only into a temporary directory and compares complete byte sets. Tamper tests cover packets, dossiers, overlays, reports, manifests, and descriptors, including traversal/duplicate members and fabricated metrics. Exact locations and measurements require structured georeference/scale evidence; benchmark tasks require independently corroborated adjudicated gold and component-safe assignment. Stable source URLs may not contain query strings, fragments, or secrets.
