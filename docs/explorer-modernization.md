# Explorer modernization

The explorer (`apps/web`) is a research view of one published snapshot. It is not the main site. Search, the game, prints, stories, newsletters, and `/research` stay in `apps/next-app` and `apps/api`.

Proximity on the map is model similarity. It is not Montreal geography and it is not historical certainty.

## Architecture

| Module | Responsibility |
|---|---|
| `apps/web/src/explorer/artifacts.ts` | Load a versioned manifest or the legacy R2 files |
| `packages/scripts/src/explorer/artifact-contract.ts` | Schema, checksum, ID, and embedding checks |
| `apps/web/src/explorer/search.ts` | Shared `/api/search` client, cancellation, normalization |
| `apps/web/src/explorer/projection.ts` | Map positions. Records without a projection stay in the list and get no coordinates |
| `apps/web/src/explorer/renderer.ts` | Three.js lifecycle, container sizing, disposal |
| `apps/web/src/explorer/locale.ts` | English and French interface copy |
| `apps/web/src/explorer/Shell.tsx` | Brand, return link, search, 2D/3D, theme, language |
| `apps/web/src/explorer/ResultsPanel.tsx`, `DetailsPanel.tsx` | Result list and selected photograph |
| `apps/web/src/explorer/ResearchControls.tsx` | Color, lines, geometric date check, decade emphasis, export |

Default search is `GET /api/search?mode=smart&limit=50`. The worker clamps `limit` to 100 and each Vectorize branch uses at most 50 neighbors. The UI shows the returned count separately from the loaded snapshot count. Visual research uses `mode=visual` on the same API. It does not load a browser CLIP model and it does not send snapshot vectors to the live index.

The selected-record link is `https://www.mtlarchives.com/photo/{id}` with `.json` removed. English adds `?lang=en`. French omits `lang`, matching the main site. `externalUrl` is used only when it is an `http` or `https` URL.

`deck.gl` and `@xenova/transformers` were removed from `apps/web` after the only browser CLIP import was retired. React in this workspace is 19.2.3, the same version as `apps/next-app`. Vite remains 5 and Tailwind remains 3. A Vite 6/7 or Tailwind 4 migration would change the explorer toolchain without fixing the snapshot or search behavior, so it is deferred. This worktree's Node was v22.22.0; `.nvmrc` and the root engine ask for Node 23.5.0, which was not installed here.

## Artifact contract

Schema version 1. A version folder contains `points.json`, `ids.json`, `embeddings.bin`, then `manifest.json` written last.

The manifest records:

- `schemaVersion`, `generatedAt`, `legacy`
- `modelId` and `indexId` (`null` when unknown; never inferred from dimensions)
- `embeddingDimension`, `count`, `seed`
- UMAP settings (`nNeighbors`, `minDist`, `spread`, `nComponents: 2`)
- artifact `path`, `sha256`, and `bytes`

`embeddings.bin` is little-endian: `uint32` count, `uint32` dimensions, then `float32` rows. Byte length must be `8 + count * dimensions * 4`. Published folders require the point IDs and embedding IDs in the same order. Validation fails if a requested model id differs from the manifest, including when the manifest model is unknown.

The public prefix `https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings/` currently has no `manifest.json` (HTTP 404). Only that 404 uses the legacy adapter. A present manifest that fails schema, checksum, byte length, or ID order is rejected and does not fall back. The legacy adapter reads `embeddings_2d.json`, `embeddings_ids.json`, and the 8-byte header of `embeddings_512d.bin`. The full vector file is checked against the manifest hash only when a similarity comparison asks for it. A read on 2026-09-23 showed 14,715 points and a header of 14,715 × 512. That count is whatever the files contain, not a claim about the live corpus. Legacy model, index, seed, and generation time stay unknown. Embedding IDs with no point are reported and are not given coordinates.

## Commands

```bash
npm install
npm run test --workspace=apps/web
npm run typecheck --workspace=apps/web
npm run build --workspace=apps/web
npm run test --workspace=@mtl-archives/scripts
npm run dev --workspace=apps/web
```

Do not use the root `npm run deploy` script. That deploys the Worker.

Dry-run a local vector file (no Vectorize, R2, or D1 calls):

```bash
npm run explorer:export --workspace=@mtl-archives/scripts -- \
  --input vectors.json \
  --out ./tmp/explorer-artifacts \
  --model-id MODEL \
  --index-id INDEX \
  --seed 42 \
  --dry-run
```

Omit `--dry-run` to write `./tmp/explorer-artifacts/v1/<timestamp>/`. `vectors.json` is `{ "ids": [], "vectors": [], "records": {} }`. IDs must be unique and each vector the same finite dimension.

```bash
npm run explorer:validate --workspace=@mtl-archives/scripts -- \
  --dir ./tmp/explorer-artifacts/v1/<timestamp> \
  --expect-model MODEL
```

`npm run vectorize:export` is a dry run unless `--write` is present. It does not upload.

Vectors for the historical visual index `mtl-archives-clip` are read, not written, with Cloudflare's `get_by_ids` API. Ids come from a local manifest or an `--ids` file. Pass the model that produced those vectors with `--model-id`; if you omit it, the manifest stores null. The default seed is 42.

```bash
npm run vectorize:export --workspace=@mtl-archives/scripts
npm run vectorize:export --workspace=@mtl-archives/scripts -- --input vectors.json --model-id MODEL --write --out ./tmp/explorer-artifacts
npm run vectorize:export --workspace=@mtl-archives/scripts -- --fetch --write --ids ids.txt --model-id MODEL --out ./tmp/explorer-artifacts
```

`--fetch` uses `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (or the existing `CLOUDFLARE_AI_TOKEN` / `CF_AI_TOKEN` aliases). A dry run never calls that API. `--fetch` without `--write` also stays local.

## Regenerate and roll back

1. Export vectors for a known model and index into a local JSON file. Do that with an explicit, reviewed job. This repository command does not fetch Vectorize.
2. Dry-run the export, then write a new version folder.
3. Validate it. `--expect-model` must match the manifest. A null model does not match a named model.
4. Upload the folder to a new immutable R2 prefix. Upload `manifest.json` last. Do not overwrite the live legacy files in place.
5. Point a new explorer deployment at that prefix with `VITE_R2_EMBEDDINGS_BASE_URL`.
6. Rollback is another deployment whose base URL is the previous prefix. The legacy prefix keeps working through the adapter as long as its three files remain.

Region colors and the geometric date check are tied to the legacy layout. A versioned manifest turns them off instead of pretending the old centroids still apply.

## Deployment

The production explorer is [https://explorer.mtlarchives.com/](https://explorer.mtlarchives.com/). `apps/web/vercel.json` only rewrites two kit PDFs. `https://www.mtlarchives.com/` is the Next.js site and does not serve `/explore`. This change set does not deploy, change DNS, or write R2.

In development, Vite proxies `/snapshot` to the fixed R2 prefix `https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings` and forwards Range headers. The dev app requests `/snapshot` unless `VITE_R2_EMBEDDINGS_BASE_URL` is set. Production builds keep the direct R2 URL. The proxy is not an open proxy.

## Research workspace and verification

The explorer uses the main site's SVG mark and a responsive full-height map. Desktop navigation separates search from map controls. Mobile navigation keeps the results in a bottom sheet. Results and the device-local collection have separate tabs and counts; snapshot similarity opens a 20-record neighbor list with a return path to the original search.

Date colors use a discrete decade palette with an undated category and a visible legend. Projection-region coloring remains available for the legacy layout. Zoom, fit-to-view, and decade emphasis are visible controls. Initial/reset camera fitting respects aspect ratio and 3D depth; manual camera movement is preserved. Copy citation includes available title, source date, reference, credits, record URL, and official source. CSV/JSON exports use the active list and contextual counts; CSV neutralizes formula-prefixed text.

Codex browser QA on 2026-09-23 used the in-app browser at `http://127.0.0.1:3021` with 1280×900, 1040×760, 390×844, and 320×740 viewports. Verified:

- Snapshot loads 14,715 points through the fixed-target development proxy.
- Full-height map, responsive navigation, correct wordmark, EN/FR, light/dark, 2D/3D, and resizing.
- Live search returns 50 records, details show photographs and archival source links, and saving a record displays it in the local collection.
- Similarity displays 20 neighbors; collection switches to its own count; returning to search restores the 50 results.
- CSV and JSON downloads each contain the expected 50 records and matching query/count metadata.
- Citation action shows its copied confirmation; mobile About focus enters the dialog and returns to More on Escape.
- Keyboard skip link opens/focuses mobile results. Fresh browser session has no runtime errors or framework overlay.

Automated verification: 19 explorer tests, 11 artifact/export tests, explorer TypeScript, production build, and `git diff --check`. Coverage includes checksum/manifest validation, traversal rejection, search races, date palettes, export escaping, and camera fitting. Hardware WebGL failure, reduced-motion OS emulation, and exhaustive API/network failure combinations were not browser-tested. The existing legacy snapshot does not identify its model or generation date; About retains those limitations. No live vectors or archive bytes were regenerated.
