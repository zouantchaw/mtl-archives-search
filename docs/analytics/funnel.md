# MTL Archives Funnel (Draft)

This document defines the current engagement → conversion funnel and which analytics events map to each stage.

**Primary goal:** validate profit potential by moving visitors from discovery to print orders.

---

## Funnel Stages

**1) Reach (Off‑site)**
- IG/FB reach, views, interactions (Meta exports)
- Not directly tracked in Vercel; used for campaign analysis

**2) Click‑through to Site (Off‑site → On‑site)**
- Vercel referrers: `l.instagram.com`, `m.facebook.com`, `l.facebook.com`
- UTM parameters where available

**3) Landing & First Interaction (On‑site)**
Events:
- `page_loaded`
- `page_first_interaction` (search, scroll, shuffle, photo click)
- `instagram_visitor_landed`, `facebook_visitor_landed`

**4) Core Engagement**
Events:
- Search: `search_committed`, `search_result_clicked`, `search_no_results`
- Discovery: `gallery_shuffle`, `neighborhood_shortcut`
- Content: `photo_viewed`, `photo_dwelled`, `photo_zoomed`
- Game: `game_landed`, `game_pin_placed`, `game_guess_submitted`, `game_guess_result`

**5) Purchase Intent**
Events:
- `print_cta_clicked`
- `game_print_cta_clicked`
- `order_mode_entered`
- `print_size_selected`, `print_frame_selected`
- `cart_item_added`, `cart_opened`, `checkout_clicked`

**6) Conversion**
Events:
- `order_completed`
- `order_failed`

**7) Advocacy / Sharing**
Events:
- `game_share_prompt_shown`, `game_share_clicked`, `game_share_completed`
- `photo_shared`

---

## Current Bottlenecks (Jan 2026)

- **Game sharing is near zero** (≈1% of landed). We need to lift this with stronger CTA and sharing ergonomics.
- **Print conversion is still zero** — order mode entries are not turning into cart adds or checkouts yet.
- **Social link click reporting (Meta) doesn’t match Vercel referrers**, so on‑site attribution should rely on Vercel until reconciled.

---

## Actionable Metrics (Baseline Targets)

- Search CTR (search_result_clicked / search_committed): **>70%**
- Game completion (guess_result / game_landed): **>50%**
- Game share rate (game_share_completed / game_landed): **>5%**
- Print CTA → cart add rate: **>10%**
- Cart add → checkout click rate: **>30%**

---

## Next Measurement Additions

- ✅ Track `print_cta_clicked` and `game_share_prompt_shown`.
- ✅ Reduce `search_refined` noise to reflect real refinements (only on committed searches).
- ✅ Exclude `/api/*` from Vercel analytics to remove noise.

---

## Attribution Notes

- Vercel referrers are the most reliable source for source attribution right now.
- Meta’s “link clicks” export undercounts actual clicks vs. Vercel referrers.
- Game share links now include UTMs (`utm_source=game`, `utm_medium=share`, `utm_campaign=game_share`).
