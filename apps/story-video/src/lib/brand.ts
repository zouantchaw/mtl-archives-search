/**
 * Brand tokens extracted from apps/next-app/app/globals.css
 * Using oklch values directly — Remotion renders in Chromium which supports oklch.
 */

export const colors = {
  paper: "oklch(0.96 0.009 85.5)",
  charcoal: "oklch(0.17 0.013 272)",
  steel: "oklch(0.84 0.016 257)",
  blue: "oklch(0.51 0.145 252.5)",
  copper: "oklch(0.62 0.145 48)",
  green: "oklch(0.74 0.179 149)",
  yellow: "oklch(0.89 0.182 96)",
  orange: "oklch(0.77 0.185 64)",
  dark: "oklch(0.12 0.014 272)",
} as const;

// Story dimensions (9:16 for IG/FB stories)
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const FPS = 30;

// Scene durations in frames
export const SCENES = {
  brandIntro: 50, // ~1.7s
  photoReveal: 120, // 4s
  mapChallenge: 90, // 3s
  scoreReveal: 80, // ~2.7s
  cta: 50, // ~1.7s
  transition: 12, // 0.4s crossfade
} as const;

export const TOTAL_DURATION =
  SCENES.brandIntro +
  SCENES.photoReveal +
  SCENES.mapChallenge +
  SCENES.scoreReveal +
  SCENES.cta -
  SCENES.transition * 4; // 4 transitions between 5 scenes
