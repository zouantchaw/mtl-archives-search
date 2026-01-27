# Runtime Scale + Memory Design

**Status:** Implemented (Jan 27, 2026)
**Scope:** Cloudflare Worker + Next.js client for MTL Archives
**Goal:** Reduce D1 row reads and eliminate browser memory crashes on mobile.

---

## Current Constraints

- D1 reads are high (multi‑million rows/day) even with low traffic.
- ~13.5k images; some are large and can overwhelm mobile memory.
- Client can load many images per session (search + shuffle + photo view).

---

## Primary Cost Drivers (D1 Reads)

1) **Shuffle mode**  
   `ORDER BY RANDOM()` + `COUNT(*)` per request → full table scan.

2) **Text search**  
   `LIKE '%q%'` on multiple columns → full table scan.

3) **Map + sitemap**  
   `/api/map` and `/api/sitemap` read all rows → full table scan.

4) **No Worker cache**  
   Read‑heavy endpoints are not cached with Cache API.

---

## Target Architecture (Runtime)

### Caching Layer (Worker)
- Add Cache API read‑through for:
  - `/api/photos` (shuffle + pagination)
  - `/api/map`
  - `/api/sitemap`
- Normalize cache keys (sorted params) and use TTLs:
  - photos shuffle: 1–6 hours
  - map: 12–24 hours
  - sitemap: 24 hours

### Shuffle Without `ORDER BY RANDOM()`
Options:
1) **Daily shuffled ID list**  
   Precompute a shuffled list of `metadata_filename` once/day; serve slices.
2) **Random offset sampling**  
   Pick a random offset and fetch `LIMIT N`. Use cached total count.

### Count Without `COUNT(*)`
- Maintain a `manifest_total` value (updated on seed load / admin script).
- Serve total from cache or config, not by querying D1.

### Text Search Without Full Scan
Options:
1) **FTS5** on `name`, `description`, `portal_title`, `portal_description`.
2) **De‑emphasize text mode** in UI; rely on semantic/visual.

---

## Image Delivery Strategy

### Stable Image URLs
Prefer **public R2 domain** to avoid signed URL churn and improve caching.

### Thumbnail Endpoint
`/api/thumb` should:
- Strip query params on public R2 URLs.
- Apply `cacheEverything` with long TTL.

---

## Client Memory Strategy

### Avoid Double Rendering
Photo page currently keeps **viewing + ordering** modes mounted.
Goal: unmount the inactive tree to release decoded image memory.

### Responsive Image Sizing
Use mobile‑specific sizes (avoid fixed 1000px on phones).

### Grid Virtualization
Options:
- `content-visibility: auto` for tiles below the fold.
- Use a windowed grid (e.g., react‑window / react‑virtual).

### Defer Low‑Priority Tiles
Lower fetch priority and defer images beyond first rows.

---

## Implementation Plan (Summary)

1) Cache API for `/api/photos`, `/api/map`, `/api/sitemap`. ✅
2) Replace `ORDER BY RANDOM()` + `COUNT(*)`. ✅ Random offset sampling + cached count (Map keyed by WHERE clause).
3) FTS5 or reduced text mode. ✅ Deprecated text LIKE → semantic fallback with cote fast-path.
4) Stable public R2 URLs + thumb caching. ✅ Replaced `/api/thumb` proxy with Vercel Image Optimization (Pro plan). Worker thumb endpoint was passing through full 45MB originals unresized (cf.image requires Image Resizing enabled on zone; workers.dev doesn't have it).
5) Client unmount strategy + responsive sizing. ✅ Conditional rendering, content-visibility, fetchPriority.
6) Optional virtualization if memory still spikes. → Deferred; content-visibility approach chosen instead.

### Additional Changes (discovered during implementation)
7) Shuffle bypasses Cache API — each click needs fresh random results. Offset sampling is cheap enough without caching.
8) Static photo count — "13,000+ photos" string replaces per-request `COUNT(*)` for display. Eliminates one D1 query per shuffle.
9) 20MB image size cap in base WHERE clause — aerial dataset photos (45MB+) exceed Vercel's 50MB source optimization limit. `image_size_bytes IS NULL OR image_size_bytes <= 20000000`.
10) Migrated from Seline analytics to Vercel Analytics (exceeded Seline free tier).
11) Desktop shuffle also sends `maxSize=20000000` to match worker-side cap.

---

## Success Metrics

- D1 rows read/day < 250k (at current traffic). → Monitoring post-deploy.
- Mobile sessions no longer crash after repeated searches. → Conditional rendering + content-visibility + 20MB cap deployed.
- Time‑to‑first‑photo on mobile < 2s (p95). → Vercel Image Optimization serves resized WebP/AVIF at edge.

