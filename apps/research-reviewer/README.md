# MTL Archives research reviewer

Private production app: **https://reviewer.mtlarchives.com**

Cloudflare Worker + React + new D1, with owner-only Access and selected images
from the existing private research R2 buckets. Isolated Images, Workers AI,
Queues, AI Gateway and assistance R2 power private, on-demand text inspection. Images →
related families → human-authored French/English development
queries, with browser drafts, explicit saves and immutable revision history.

Each image is one screen: photo on the left, answers on the right, **Save & next**
always visible, and a keyboard path for every answer (**?** lists shortcuts).
Use **Photo** for scene and quality review, and the **Text sweep** (T) to step
through nine overlapping enlarged regions, marking each checked with Space, with
independent detail rotation. Optional
**Pre-scan all 9** queues nine Gemma text checks; **Read this region**
checks a chosen close-up. **Ask a second reader** uses Qwen. Candidate wording
is always unverified; review the inline checklist, edit or drop lines, then
confirm once against the pixels before **Add N to notes**. Notes group kept
lines by writing kind; each kept line retains its own acceptance event. Readable
writing, numbers, marginal annotations and watermarks count as text. Empty detections never fill the No answer.

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
