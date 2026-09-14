# Operator cutover (#160)

Production job state lives in **D1**, not in an Eve session. The Eve agent is the control surface. Its completions go to `/api/operator/v1/chat/completions`, which always calls Cloudflare AI Gateway Unified Billing (`openai/gpt-5.4`). Tools go to `/api/operator/v1/invoke`.

`publish` flips `operator_index_pointer` only after a stored approval. It does **not** `UPDATE` live captions or Vectorize. Kind/OCR attach on `operator_candidate.candidate_json`. Rollback restores the previous pointer.

```sh
npm run test --workspace=apps/api
# After merge, additive D1 migration:
npx wrangler d1 migrations apply mtl-archives --remote --config apps/api/wrangler.toml
npm run deploy --workspace=apps/api
```
