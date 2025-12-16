# Memory Management Plan (Production)

## What the HAR shows
- The embedding payloads are fetched twice on `localhost`:
  - `embeddings/embeddings_2d.json` (~3.9MB)
  - `embeddings/embeddings_ids.json` (~0.5MB)
  - `embeddings/embeddings_512d.bin` (~30MB)
- Hover/preview image fetches can be extremely large (example in the HAR: `mtl_archives_image_9153.jpg` ~46MB). Even a few full‑resolution decodes can exhaust browser/GPU memory and crash the tab or machine.

The duplicate embedding downloads are expected in React 18 dev mode with `React.StrictMode` (effects mount/unmount/remount). The large hover images are the real production risk.

## Strategy
### 1) Never load full images for previews
- Serve thumbnails for hover tooltips and result list items (small dimensions, compressed format).
- Only open the original image on explicit user intent (click/double‑click).

Implementation:
- API adds `GET /api/thumb?src=<url>&w=320&h=160&fit=cover&format=auto&q=70` (resizes via Cloudflare image resizing and sets caching headers).
- Web UI uses `/api/thumb` for tooltip + results thumbnails.
- Configure web→API routing in production:
  - Same-origin deploy: keep `/api/*` routed to the Worker, or
  - Set `VITE_API_BASE_URL=https://<your-worker-host>` at build time.

### 2) Reduce hover churn
- Debounce/delay preview loads (only fetch a thumbnail if the user pauses on a point).
- Avoid re-rendering on every mousemove; update tooltip position via `requestAnimationFrame`.

### 3) Cancel work on unmount/navigation
- Abort in-flight embedding fetches on component unmount (prevents double-downloads completing in dev, and avoids wasted memory on navigation).

### 4) Cache aggressively (bandwidth + latency)
- `/api/thumb` responses: cache at the edge (TTL ~1 day).
- Embedding artifacts in R2: set `Cache-Control` metadata (and ideally version filenames) so the browser/CDN can reuse them across sessions.

## How to verify
- Network: hover around; you should see `/api/thumb` requests (small, fast) instead of multi‑MB `.jpg` downloads.
- Memory: use Chrome DevTools → Performance (Memory) or Task Manager; repeated hover should not produce unbounded growth.

