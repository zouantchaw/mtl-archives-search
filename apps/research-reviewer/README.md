# MTL Archives research reviewer

Private production app: **https://mtl-archives-research-reviewer.wiel.workers.dev**

Cloudflare Worker + React + new D1, with owner-only Access and selected images
from the existing private research R2 buckets. Isolated Images, Workers AI,
Queues, AI Gateway and assistance R2 power on-demand Moondream help. Images →
related families → human-authored French/English development
queries, with browser drafts, explicit saves and immutable revision history.

Use **Guide** for rules, examples and practice. Select an area or edge to inspect
small text, rotate the detail, then optionally request help. Suggestions enter
Notes only when accepted; labels remain explicit human decisions. Assisted
preparation is tracked in export v2 and stays pending quality review.

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
