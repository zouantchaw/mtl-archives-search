import React from "react";
import { z } from "zod";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { ROOMS } from "./lib/print-config";
import { PrintIntro } from "./scenes/PrintIntro";
import { PhotoShowcase } from "./scenes/PhotoShowcase";
import { WallCarousel } from "./scenes/WallCarousel";
import { PricingCta } from "./scenes/PricingCta";

export const PrintOfTheWeekSchema = z.object({
  imageUrl: z.string(),
  title: z.string(),
  date: z.string(),
});

export type PrintOfTheWeekProps = z.infer<typeof PrintOfTheWeekSchema>;

// ── Scene durations (frames @ 30fps) ──────────────────────────────────

const T = 12; // transition overlap

// Single wall carousel replaces two separate wall scenes —
// the print stays anchored while 3 rooms crossfade behind it.
const SQUARE_SCENES = {
  intro: 55,
  showcase: 80,
  wallCarousel: 165, // ~5.5s for 3 rooms
  pricing: 60,
} as const;

export const SQUARE_DURATION =
  SQUARE_SCENES.intro +
  SQUARE_SCENES.showcase +
  SQUARE_SCENES.wallCarousel +
  SQUARE_SCENES.pricing -
  T * 3;

const STORY_SCENES = {
  intro: 55,
  showcase: 90,
  wallCarousel: 180, // 6s for 3 rooms
  pricing: 60,
} as const;

export const STORY_DURATION =
  STORY_SCENES.intro +
  STORY_SCENES.showcase +
  STORY_SCENES.wallCarousel +
  STORY_SCENES.pricing -
  T * 3;

// Room rotation: plateau → cozy → coffee (3 distinct vibes)
const WALL_STOPS = [
  { room: ROOMS[0], productStyle: "framed" as const, productLabel: "Canvas encadré" },
  { room: ROOMS[2], productStyle: "poster" as const, productLabel: "Affiche Fine Art" },
  { room: ROOMS[3], productStyle: "hanger" as const, productLabel: "Cintre en bois" },
];

// ── Square composition (1080 × 1080) ────────────────────────────────

export const PrintOfTheWeekSquare: React.FC<PrintOfTheWeekProps> = ({
  imageUrl,
  title,
  date,
}) => {
  const timing = linearTiming({ durationInFrames: T });

  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SQUARE_SCENES.intro}>
          <PrintIntro imageUrl={imageUrl} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={SQUARE_SCENES.showcase}>
          <PhotoShowcase imageUrl={imageUrl} title={title} date={date} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={SQUARE_SCENES.wallCarousel}>
          <WallCarousel
            imageUrl={imageUrl}
            stops={WALL_STOPS}
            sizeScale={0.85}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={SQUARE_SCENES.pricing}>
          <PricingCta />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

// ── Story composition (1080 × 1920) ─────────────────────────────────

export const PrintOfTheWeekStory: React.FC<PrintOfTheWeekProps> = ({
  imageUrl,
  title,
  date,
}) => {
  const timing = linearTiming({ durationInFrames: T });

  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={STORY_SCENES.intro}>
          <PrintIntro imageUrl={imageUrl} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={STORY_SCENES.showcase}>
          <PhotoShowcase
            imageUrl={imageUrl}
            title={title}
            date={date}
            isStory
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={STORY_SCENES.wallCarousel}>
          <WallCarousel
            imageUrl={imageUrl}
            stops={WALL_STOPS}
            sizeScale={0.85}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={STORY_SCENES.pricing}>
          <PricingCta isStory />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
