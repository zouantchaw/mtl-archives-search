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
2. Run `npm run smoke:filters:prod` to catch obvious regressions after deploy.
3. Validate on real iOS/Android devices and attach traces.

## Mitigations Implemented (Feb 18, 2026)

- Discovery filter taps now use canonical filter query strings (instead of localized labels), reducing unstable search churn.
- Rapid filter interaction is guarded while a search is already in flight.
- Mobile search cap lowered (`MOBILE_MAX_IMAGES` 36 -> 24).
- Mobile search requests now send `maxSize=1000000` and Worker search handlers enforce the same max-size filter for smart/semantic/visual search paths.
- Mobile first-paint image priority reduced (from first 9 to first 3 tiles on mobile).
- Added client telemetry events for:
  - runtime JS errors
  - unhandled promise rejections
  - rapid filter burst detection
  - mobile render anomaly (search results returned but no grid tiles rendered)
- Added rapid filter smoke test script:
  - `npm run smoke:filters`
  - `npm run smoke:filters:prod`
  - `npm run smoke:filters:mobile`
  - `npm run smoke:filters:mobile:prod`

## Automation Note

- Mobile emulation smoke uses Playwright device presets (`iPhone 14`, `Pixel 7`) to stress discovery-filter taps on mobile viewport/touch profiles.
- This is a fast regression gate, but it does not replace final real-device validation for iOS memory-pressure behavior.

## Run Log Template

Use one entry per repro run.

### Trace ID

- Trace ID: `TRACE-YYYYMMDD-##`
- Date/time (local): 
- Tester: 

### Environment

- Device model:
- iOS / OS version:
- Browser:
- Browser version:
- Network:

### Starting State

- URL:
- Language:
- Existing query params:
- Session state (fresh tab / reused tab):

### Filter Sequence

| Step | Timestamp | Filter tapped | URL after tap | Grid status | Notes |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |
| 5 |  |  |  |  |  |
| 6 |  |  |  |  |  |
| 7 |  |  |  |  |  |
| 8 |  |  |  |  |  |
| 9 |  |  |  |  |  |
| 10 |  |  |  |  |  |

### Failure Details

- White screen observed: yes/no
- Time-to-failure:
- Last successful step:
- Recovery behavior (reload/close tab/etc.):
- Screenshot path/link:
- Screen recording path/link:
- Console/runtime error text (if captured):
- Network notes:

### Summary

- Repro outcome:
- Confidence:
- Follow-up action:

## Run Log (Started)

### TRACE-20260218-01

- Date/time (local): Feb 18, 2026
- Tester: user report
- Device model: iPhone (reported as iPhone 17 Pro)
- Browser: Arc (mobile)
- Route: home/search page
- Trigger: tapping ~4-5 discovery filters
- Observed result: white screen
- Recovery behavior: not yet documented
- Artifacts: pending

Status: `reported / pending structured trace capture`
