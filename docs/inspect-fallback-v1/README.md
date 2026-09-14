# Query-time inspect fallback

Reading-room `/research` still checks candidates with Mistral Small 3.1. GPT-5.4 runs only for that inspect, through the existing Worker AI binding and AI Gateway Unified Billing. Production captions and indexes are unchanged.

Escalate after the cheap check when **any** of these is true:

- the cheap check failed technically
- the cheap verdict is `uncertain`
- the record is in the reviewed flag list (A44 sideways, F12 document)

Do **not** escalate a confident cheap `no_match` or `match` on an ordinary photograph. Missing EXIF is not a trigger. A25 stays on the cheap model.

At most eight candidate images are inspected per search, and at most eight GPT-5.4 fallbacks per turn. Fallback does not consume an extra inspect slot. If GPT-5.4 fails, the cheap result is kept.

Reviewed flags are copied from [fallback-v1/review.json](../fallback-v1/review.json):

| Record | Flag |
|---|---|
| `mtl_archives_metadata_12519.json` (A44) | `reviewed_sideways` |
| `mtl_archives_metadata_15507.json` (F12) | `kind_document` |
