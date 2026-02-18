# Mobile Touch QA Checklist (P0)

Date: Feb 18, 2026
Owner: Engineering + product QA
Scope: Verify touch interactions and stability on real mobile browsers (with focus on social/in-app traffic paths).

## Objective

Validate that key touch interactions remain stable on mobile and do not produce white screens, frozen UI, or broken navigation.

## Target Environments

Required:
- iPhone Safari (latest iOS)
- iPhone Arc (latest available)
- Android Chrome

High-priority in-app/webview:
- Facebook in-app browser (iOS)
- Instagram in-app browser (iOS)

Optional:
- Chrome iOS
- Samsung Browser (Android)

## Routes Under Test

- Home/search: `https://www.mtlarchives.com/?ab=home`
- Photo detail: open any image from home
- Game: `https://www.mtlarchives.com/game`

## Core Test Matrix

### A) Home/Search Touch Reliability

1. Open home route from a fresh tab.
2. Tap one discovery filter, then 8-10 rapid filter taps.
3. Scroll the grid continuously for 20-30 seconds.
4. Tap search field, type a query, clear query, then tap another discovery pill.
5. Tap one photo card to open detail; return back to home.

Pass criteria:
- No white screen.
- No full UI freeze (>2s unresponsive).
- Grid remains visible and interactive.
- Back navigation returns to usable state.

### B) Photo Detail Zoom + Gestures

1. Open photo detail from home.
2. Perform pinch-to-zoom in and out on the image.
3. Pan while zoomed; verify image remains responsive.
4. Toggle order/view mode if applicable.
5. Use browser back and forward.

Pass criteria:
- Pinch and pan feel responsive.
- No accidental stuck zoom state.
- No crash/white screen while zooming or returning.

### C) Game Map Touch Interactions

1. Open game route.
2. Pan map, pinch zoom map, place marker, reposition marker.
3. Submit one guess (daily/practice as available).
4. Navigate back to home; return to game.

Pass criteria:
- Map gestures are smooth and accurate.
- Marker placement is reliable.
- No white screen or app reset.

### D) In-App Browser Sanity (FB/IG)

1. Open site from an in-app link.
2. Repeat section A steps quickly.
3. Open one photo detail and return.

Pass criteria:
- Same stability as Safari baseline.
- No persistent blank/gray viewport.

## Capture Requirements (for each run)

- Device model + OS version
- Browser/app + version
- Network (Wi-Fi/LTE)
- Route tested
- Exact failure step (if any)
- Screenshot/screen recording path

## Run Log Template

### Trace ID

- Trace ID: `TOUCH-YYYYMMDD-##`
- Date/time:
- Tester:

### Environment

- Device:
- OS:
- Browser/App:
- Browser/App version:
- Network:

### Results

| Section | Result (PASS/FAIL) | Notes |
|---|---|---|
| A Home/Search |  |  |
| B Photo Zoom |  |  |
| C Game Map |  |  |
| D In-App |  |  |

### Failure Details (if any)

- Symptom:
- Step that failed:
- Recovery:
- Artifact path/link:

### Final Status

- Overall: PASS / FAIL
- Follow-up action:

## Initial Runs (Known)

### TOUCH-20260218-01

- Device: iPhone (user report)
- Browser/App: Arc
- Result: FAIL
- Symptom: white/gray viewport after filter interaction on home.
- Artifact: `/Users/wiel/Downloads/ScreenRecording_02-18-2026 14-46-32_1.MP4`

### TOUCH-20260218-02

- Device: iPhone (user report)
- Browser/App: Safari
- Result: PASS (initial sanity)
- Notes: multiple filter taps with no crash reported.

## Decision Rule

- If Safari + Android Chrome + FB/IG in-app pass, proceed with roadmap.
- Treat Arc-only failures as low-priority unless Arc traffic share increases or failure appears in Safari/in-app browsers.
