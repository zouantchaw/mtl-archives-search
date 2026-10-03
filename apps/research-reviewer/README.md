# MTL Archives research reviewer

Private production app: **https://mtl-archives-research-reviewer.wiel.workers.dev**

Cloudflare Worker + React + new D1, with owner-only Access and selected images
from the existing private research R2 buckets. No live-product bindings or model
assistance. Images → related families → independent French/English development
queries, with browser drafts, explicit saves and immutable revision history.

Start with **Guide**, then save the first five image reviews for calibration.

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
