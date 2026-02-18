# Mobile Filter Crash Incident (Feb 18, 2026)

Scope: P0 incident "mobile filter white-screen crash" reported on iPhone (Arc browser) after repeated filter taps.

## User Report

- Device: iPhone (reported as iPhone 17 Pro)
- Browser: Arc (mobile)
- Route: home/search page
- Trigger: tapping 4-5 discovery filters in sequence
- Symptom: full white screen

## Objective

Establish a repeatable repro protocol and collect consistent evidence before implementing fixes.

## Repro Protocol (Manual, Real Device)

1. Open `https://www.mtlarchives.com/` in the target browser.
2. Ensure no existing query param (`q`) is present.
3. Tap 5-10 different discovery filters quickly (1-2s between taps).
4. After each tap, record:
   - timestamp
   - filter label
   - URL (`q`, `mode`, `lang`)
   - whether grid updates or blanks
5. If white screen occurs:
   - capture screenshot
   - capture screen recording if possible
   - note whether browser tab reload recovers

## Repro Protocol (Automation/Dev Support)

Use `agent-browser` to run controlled filter tap sequences with checkpoints:
- pre-run: clear console and page errors
- per-step: click one filter, wait 1-2s, capture URL + snapshot summary
- post-run: capture console + page errors

Note: `agent-browser` runs were intermittently unstable during chained click scripts, so real-device repro is currently the source of truth.

## Evidence Checklist

- [ ] Device + OS version
- [ ] Browser + version
- [ ] Exact filter sequence
- [ ] Time-to-failure
- [ ] Last successful URL state
- [ ] Console/runtime error text (if available)
- [ ] Network behavior near failure (pending requests, large responses)
- [ ] Recovery behavior (reload required, tab kill, or auto-recover)

## Initial Technical Hypothesis

Likely memory pressure on mobile WebKit during rapid filter-driven searches:
- Mobile image-size capping is applied for shuffled `/api/photos` fetches.
- Filter taps drive search requests (`/api/search`) and may return many image URLs without equivalent mobile-safe constraints.
- Repeated search result swaps can increase decode/repaint pressure and trigger browser-level white-screen behavior.

This is a hypothesis, not yet a confirmed root cause.

## Immediate Next Steps

1. Gather at least 3 reproducible real-device traces using this protocol.
2. Add lightweight telemetry around filter tap sequence length and runtime errors.
3. Implement containment changes behind this incident task:
   - mobile-safe search image/result caps
   - lower concurrent image decode pressure
   - guard against rapid filter-triggered render churn

