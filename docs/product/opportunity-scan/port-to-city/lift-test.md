# Port-to-City baseline lift test

## Decision

Proceed with the internal evidence core and a controlled research pilot. Do
not yet claim that MTL Archives has superior multimodal retrieval or reviewed
historical insight.

The current system found a directly relevant top-ten result for six of eight
frozen queries. Its clearest advantage is stable identity, source linkage, and
report-sequence organization. The official City archive already has strong
metadata, while SDC Vieux-Montréal already has strong public activation.

## Frozen query set

1. `Old Port industrial waterfront`
2. `rue de la Commune 1936 Catholic Sailor Club`
3. `King Edward Quay grain silo`
4. `Montreal port aerial 1965 Jacques Cartier quay`
5. `Bonsecours port waterfront historical`
6. `railway warehouses port Montreal`
7. `port cold storage warehouse`
8. `industrial to public space Old Port change`

## Result summary

| Query | MTL Archives result | Judgment |
|---|---|---|
| Old Port industrial waterfront | 1930/1969 port and 1925 port/rail records | Relevant, broad |
| Rue de la Commune 1936 Catholic Sailor Club | Record 88, Cote VM94,SY,SS1,SSS17,D166 | Strong exact hit |
| King Edward Quay grain silo | No exact target in top ten | Miss |
| Montreal port aerial 1965 Jacques Cartier quay | Records 147, 141, 12129 and related aerials | Strong hit |
| Bonsecours port waterfront historical | Blank or uninterpretable result | Miss |
| Railway warehouses port Montreal | Records 90, 132, 140, 147, 160 | Relevant, broad |
| Port cold storage warehouse | Port material and VM94-B018 report | Partial hit |
| Industrial to public space Old Port change | 1969 port, 1980 hangars, 1925 industrial port | Useful sequence |

Conservative target recall is `6/8`, or 75 percent. This is a manual
decision-support test, not a statistically powered benchmark.

## What is genuinely better

- A known Cote or canonical ID resolves to a stable record and source URL.
- Ground records, aerial records, and report-level sequences can share one
  evidence package.
- Archive-reported wording can remain separate from visible evidence and
  unresolved questions.
- The 1965 VM94 reports preserve connections between cold storage, silo no. 2,
  Pont de la Concorde, and the Alexandra, King Edward, and Jacques-Cartier
  quays across contiguous image ranges.

## What is not better yet

- Official City datasets can be richer than the live MTL Archives API for an
  exact report lookup.
- CLIP results can lack interpretable identity and metadata.
- VLM, OCR, taxonomy, image-quality, and family fields are not sufficiently
  exposed in the live buyer-facing contract.
- SDC Vieux-Montréal already demonstrates editorial and public-programming
  strength. The opportunity is to supply a reusable source layer, not replace
  its storytelling work.

## External release gates

- At least seven of eight target queries relevant in the top ten.
- No blank metadata records in buyer-facing results.
- Every selected record has canonical identity, source, credit, claim
  boundary, uncertainty, and review state.
- At least three independently reviewed source families across two periods and
  two spatial scales.
- No unreviewed OCR, entity, or geolocation claims.
- Family and report relationships visible to the end user.
