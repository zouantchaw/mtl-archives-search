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

