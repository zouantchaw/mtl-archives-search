# Tasks

Source of truth for the v1 launch. Goal: sellable B2B platform for Montreal real estate.

## V1 Launch Checklist

### P0: Demo-Ready (must have for any sales call)

- [x] **Copy caption button** - One-click copy with title, date, description, credits, cote, hashtags
- [x] **Download button** - Actual file download with proper filename
- [x] **Show full metadata** - Display all fields including portal title/description/date
- [ ] **Mobile QA** - Test pinch/zoom, touch interactions on iOS/Android
- [ ] **Deploy Next.js app** - Production URL (Vercel or Cloudflare Pages)

### P1: Polish (before first paid demo)

- [x] **Bilingual UI** - FR/EN toggle with French as primary
- [ ] **Branding placeholder** - "Your Logo Here" mockup area for realtor demos
- [ ] **Share button** - Shareable deep links to search results
- [ ] **Expand geocoding** - More map pins = more visual impact (155 → 400+ records)

### P2: Nice-to-have (after first paying customer)

- [ ] Date range filter
- [ ] Neighborhood/area filter
- [ ] "Find similar" button (use CLIP similarity)
- [ ] Favorites/collection feature
- [ ] Batch export for bulk downloads

---

## Sales Assets (parallel track)

- [ ] **60-90s demo video** (Loom) - "Find a historical photo of your listing in 10 seconds"
- [ ] **One-pager PDF** - "Own Montreal's History" with stats + screenshot + pricing
- [ ] **Transfer guide** - README for handing over R2/D1/code access

---

## Tech Debt (deprioritized)

- [x] ~~VLM structured tags~~ - Paused (uform-500m too small, only 12% usable)
- [x] ~~OCR text extraction~~ - Complete (2.7% high-confidence, mostly city stamps)
- [ ] Re-run VLM with larger model (LLaVA-7B) - **deferred until after v1 sale**
- [ ] Add high-confidence OCR to D1 - **deferred**

---

## Done

- [x] QA sample analysis (50 records + full dataset stats)
- [x] D1 seeded with 13,499 records + trust scores
- [x] BGE text embeddings (13,499 vectors)
- [x] CLIP image embeddings (~13,400 vectors)
- [x] API endpoints: /photos, /search, /thumb, /map
- [x] Three search modes: text, semantic, visual
- [x] Map UI with search + detail panel
- [x] Responsive design (mobile + desktop)
- [x] Store UI with infinite scroll + lazy loading
- [x] FR/EN localization (French primary)
- [x] WebP optimization via Cloudflare /api/thumb
- [x] Copy caption with enriched metadata + hashtags
- [x] Direct download with proper filenames
