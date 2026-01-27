# Runtime Scale + Memory Design

**Status:** Proposed (pending implementation)  
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

1) Cache API for `/api/photos`, `/api/map`, `/api/sitemap`.
2) Replace `ORDER BY RANDOM()` + `COUNT(*)`.
3) FTS5 or reduced text mode.
4) Stable public R2 URLs + thumb caching.
5) Client unmount strategy + responsive sizing.
6) Optional virtualization if memory still spikes.

---

## Success Metrics

- D1 rows read/day < 250k (at current traffic).
- Mobile sessions no longer crash after repeated searches.
- Time‑to‑first‑photo on mobile < 2s (p95).

