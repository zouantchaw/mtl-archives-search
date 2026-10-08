# MTL Archives research reviewer

Private production app: **https://reviewer.mtlarchives.com**

Cloudflare Worker + React + new D1, with owner-only Access and selected images
from the existing private research R2 buckets. Isolated Images, Workers AI,
Queues, AI Gateway and assistance R2 power private, on-demand text inspection. Images →
related families → human-authored French/English development
queries, with browser drafts, explicit saves and immutable revision history.

Use **Photograph** for scene and quality review, and **Text check** for nine
overlapping regions, enlarged pixels and independent detail rotation. Optional
**Check all regions with AI** queues nine Gemma text checks; **Read this region**
checks a chosen close-up. **Ask a second reader** uses Qwen. Candidate wording
is always unverified; edit it and explicitly check it against pixels before
**Add verified note**. Readable writing, numbers, marginal annotations and
watermarks count as text. Empty detections never fill the No answer.

Shadcn/Base UI provides the form, segmented choices, tabs, controls and Guide
dialog, with keyboard access and responsive desktop/phone layouts. Human region
checks are stored separately from model detections. A new No text decision
requires an explicit human pixel inspection confirmation. Historical reviews
and earlier Moondream outputs remain available unchanged. Assisted preparation
is tracked in export v2 and stays pending quality review.

Full operations, study identities, export integration and verification:
[Reviewer runbook](../../docs/research-platform-v1/reviewer-app.md).

```bash
npm ci --workspaces=false
npm run typecheck
npm test
npm run test:import
npm run build
cf deploy --prebuilt
```

Run these inside this directory. The deployment builder fixes the isolated
resource boundary; do not reuse the migration or bindings for the serving app.
The loopback-only synthetic QA server is documented in the runbook and excluded
from the production entry point. Human quality review remains required before
these decisions become research references.
