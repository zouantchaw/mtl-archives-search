# Mobile Load Diagnosis (Feb 17, 2026)

Scope: P0 task "Diagnose mobile load time" for IG/FB-style mobile visitors.

Method:
- Used `agent-browser` with iPhone emulation (`set device "iPhone 14"`).
- Measured production pages with cache-busting query params.
- Captured browser `PerformanceNavigationTiming` and paint entries.

Note:
- This is a synthetic browser run, not real Instagram/Facebook in-app webview telemetry.
- Results are directional and useful for prioritization.

## Pages Tested

1. Home: `https://www.mtlarchives.com/?cb=<ts>`
2. Photo detail: `https://www.mtlarchives.com/photo/mtl_archives_metadata_30?cb=<ts>`
3. Game: `https://www.mtlarchives.com/game?cb=<ts>`

## Key Results

Home:
- TTFB: ~4 ms
- DOM interactive: ~73 ms
- FCP: ~92 ms
- Load: ~209 ms

Photo detail:
- TTFB: ~58 ms
- DOM interactive: ~690 ms
- FCP: ~768 ms
- Load: ~762 ms

Game:
- TTFB: ~20 ms
- DOM interactive: ~188 ms
- FCP: ~500 ms
- Load: ~274 ms

## Findings

1. Primary bottleneck is client-side work on route-specific pages (photo/game), not backend TTFB.
2. Photo page has the slowest first contentful paint among tested routes.
3. Clerk resources are present on public routes and add additional fetch/script work in the critical path.

## Recommended Next Optimizations

1. Defer or route-scope Clerk loading on fully public surfaces (home/photo) where auth UI is not needed immediately.
2. Reduce initial script pressure on photo page (prioritize only route-critical code and defer non-critical features).
3. Re-run this same script after changes and compare FCP/DOM-interactive deltas.

## Post-Change Validation (Feb 17, 2026)

Implemented change:
- Clerk provider moved from global root layout to route-scoped layouts for `/game`, `/sign-in`, and `/sign-up`.

Validation run (same style, iPhone emulation, cache-busted URLs):

Home:
- TTFB: ~5 ms
- DOM interactive: ~203 ms
- FCP: ~248 ms
- Load: ~228 ms
- Scripts: 25
- Clerk requests: 0

Photo detail:
- TTFB: ~19 ms
- DOM interactive: ~134 ms
- FCP: ~312 ms
- Load: ~211 ms
- Scripts: 38
- Clerk requests: 0

Game:
- TTFB: ~88 ms
- DOM interactive: ~120 ms
- FCP: ~312 ms
- Load: ~273 ms
- Scripts: 32
- Clerk requests: 3

Interpretation:
- Public routes (`/`, `/photo/*`) no longer fetch Clerk resources.
- Photo route improved materially vs baseline in this synthetic run.
- Game remains auth-enabled and still loads Clerk as expected.

Follow-up:
- Run 5-10 samples and compare medians (single-run values can be noisy).
- Add real-user web-vitals slices for social in-app browser traffic if possible.
