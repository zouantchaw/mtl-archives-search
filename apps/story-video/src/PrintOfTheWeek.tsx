import React from "react";
import { z } from "zod";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { ROOMS, PRODUCTS } from "./lib/print-config";
import { PrintIntro } from "./scenes/PrintIntro";
import { PhotoShowcase } from "./scenes/PhotoShowcase";
import { WallScene } from "./scenes/WallScene";
import { PricingCta } from "./scenes/PricingCta";

export const PrintOfTheWeekSchema = z.object({
  imageUrl: z.string(),
  title: z.string(),
  date: z.string(),
});

export type PrintOfTheWeekProps = z.infer<typeof PrintOfTheWeekSchema>;

// ── Scene durations (frames @ 30fps) ──────────────────────────────────

const T = 12; // transition overlap

const SQUARE_SCENES = {
  intro: 55,
  showcase: 80,
  wall1: 75,
  wall2: 75,
  pricing: 60,
} as const;

export const SQUARE_DURATION =
  SQUARE_SCENES.intro +
  SQUARE_SCENES.showcase +
  SQUARE_SCENES.wall1 +
  SQUARE_SCENES.wall2 +
  SQUARE_SCENES.pricing -
  T * 4;

const STORY_SCENES = {
  intro: 55,
  showcase: 90,
  wall1: 80,
  wall2: 80,
  pricing: 60,
} as const;

export const STORY_DURATION =
  STORY_SCENES.intro +
  STORY_SCENES.showcase +
  STORY_SCENES.wall1 +
  STORY_SCENES.wall2 +
  STORY_SCENES.pricing -
  T * 4;

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

        <TransitionSeries.Sequence durationInFrames={SQUARE_SCENES.wall1}>
          <WallScene
            imageUrl={imageUrl}
            room={ROOMS[0]} // plateau
            productStyle="framed"
            sizeScale={0.85}
            productLabel="Canvas encadré"
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={SQUARE_SCENES.wall2}>
          <WallScene
            imageUrl={imageUrl}
            room={ROOMS[2]} // cozy
            productStyle="hanger"
            sizeScale={0.8}
            productLabel="Cintre"
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

        <TransitionSeries.Sequence durationInFrames={STORY_SCENES.wall1}>
          <WallScene
            imageUrl={imageUrl}
            room={ROOMS[0]} // plateau
            productStyle="framed"
            sizeScale={0.85}
            productLabel="Canvas encadré"
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={timing} />

        <TransitionSeries.Sequence durationInFrames={STORY_SCENES.wall2}>
          <WallScene
            imageUrl={imageUrl}
            room={ROOMS[3]} // coffee shop
            productStyle="poster"
            sizeScale={0.9}
            productLabel="Affiche Fine Art"
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
