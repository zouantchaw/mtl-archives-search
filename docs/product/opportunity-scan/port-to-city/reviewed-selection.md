# Reviewed Port-to-City selection

## Selection rule

The broad builder returned 100 bounded candidates. Manual review then favored
records supported by archive-authored scene metadata or an exact parent-report
range. OCR, CLIP, VLM, taxonomy, and geocoding were discovery signals only.
None of the ten core place claims depends on those model outputs.

Evidence classes:

- `E1`: the archive title or description directly names the scene.
- `E2`: the parent report names the place and image-number range; the child
  image remains a sequence member with incomplete row-level metadata.
- `E3`: model or OCR inference only. Excluded from the reviewed core.

## Ten-record evidence core

| ID | Date | Class | Editorial role | Source basis |
|---|---:|:---:|---|---|
| 132 | 1925 | E1 | Harbour and Place d'Armes in one frame | Scene-level port and Place d'Armes description |
| 165 | 1925 | E1 | City read from the river | Scene-level river, port and city description |
| 141 | 1930 | E1 | Port as an urban system | Scene-level vertical port description |
| 88 | 1936 | E1 | Rue de la Commune at the working edge | Street title, Cote and warehouse/rail description |
| 38 | 1922 | E1 | Bonsecours from the port street | Scene title and Cote; description missing |
| 67 | 1936 | E1 | Civic anchor beyond the quays | Scene title, Cote and Place d'Armes description |
| 11487 | 1962 | E2 | Mid-century port facing the city | VM94-B007 report, image 1 |
| 11606 | 1963 | E2 | Clock Tower quay and working shoreline | VM94-B011 report, images 14–18 |
| 11708 | 1965 | E2 | Quays, movement and city threshold | VM94-B014 report, images 6–11 |
| 16620 | 1980 | E2 | Before the tourist-era Vieux-Port | VM94-B251 report, images 1–95 |

The set spans four source families, street and aerial scales, and the years
1922 to 1980. It contains no relevant plan or document record, so that modality
is not claimed.

## Review notes

- Records 132, 165, 141, 88, 38, 67, 11487, 11606, 11708, and 16620 were
  inspected together as a visual sequence.
- Record 38 has no archive description. The application reports that absence.
- Records 11606 and 11708 inherit place context from exact parent-report
  ranges. Their drawer states that boundary explicitly.
- The tracked WebP files are resized derivatives of the MTL Archives R2 JPEGs.
  No generated, composited, colorized, or content-aware edits were applied.
- Hashes and transform history live in `evidence-core.v1.json` and are checked
  by `validate-port-to-city.mjs`.

## Strong next review blocks

The highest-value second pass is the contiguous B015, B251, B260, and B266
report material. These sequences could strengthen quay-level comparison and
the 1980s transition, but they should not enter buyer copy until each chosen
frame is reviewed at image level.
