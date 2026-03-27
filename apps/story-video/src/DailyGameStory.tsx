import React from "react";
import { z } from "zod";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { SCENES } from "./lib/brand";
import { BrandIntro } from "./scenes/BrandIntro";
import { PhotoReveal } from "./scenes/PhotoReveal";
import { MapChallenge } from "./scenes/MapChallenge";
import { ScoreReveal } from "./scenes/ScoreReveal";
import { CallToAction } from "./scenes/CallToAction";
import type { ImageRotation } from "./lib/orientation";

export const DailyGameStorySchema = z.object({
  imageUrl: z.string(),
  title: z.string(),
  rotation: z.number().default(0),
  date: z.string(),
});

export type DailyGameStoryProps = z.infer<typeof DailyGameStorySchema>;

export const DailyGameStory: React.FC<DailyGameStoryProps> = ({
  imageUrl,
  title,
  rotation: rawRotation = 0,
  date,
}) => {
  const rotation = (rawRotation as ImageRotation) || 0;
  const transitionTiming = linearTiming({
    durationInFrames: SCENES.transition,
  });

  return (
    <AbsoluteFill>
      <TransitionSeries>
        {/* Scene 1: Brand intro on dark background */}
        <TransitionSeries.Sequence durationInFrames={SCENES.brandIntro}>
          <BrandIntro />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />

        {/* Scene 2: Photo reveal — game desktop panel style */}
        <TransitionSeries.Sequence durationInFrames={SCENES.photoReveal}>
          <PhotoReveal imageUrl={imageUrl} rotation={rotation} title={title} date={date} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />

        {/* Scene 3: Map challenge — pin drop on stylized map */}
        <TransitionSeries.Sequence durationInFrames={SCENES.mapChallenge}>
          <MapChallenge imageUrl={imageUrl} rotation={rotation} date={date} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />

        {/* Scene 4: Score reveal — game results UI */}
        <TransitionSeries.Sequence durationInFrames={SCENES.scoreReveal}>
          <ScoreReveal />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />

        {/* Scene 5: CTA with stats */}
        <TransitionSeries.Sequence durationInFrames={SCENES.cta}>
          <CallToAction />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
