import React from "react";
import { Composition, Folder } from "remotion";
import {
  DailyGameStory,
  DailyGameStorySchema,
  type DailyGameStoryProps,
} from "./DailyGameStory";
import {
  PrintOfTheWeekSquare,
  PrintOfTheWeekStory,
  PrintOfTheWeekSchema,
  SQUARE_DURATION,
  STORY_DURATION,
  type PrintOfTheWeekProps,
} from "./PrintOfTheWeek";
import { STORY_WIDTH, STORY_HEIGHT, FPS, TOTAL_DURATION } from "./lib/brand";

const SQUARE_SIZE = 1080;

const sampleProps = {
  imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
  title: "Rue Sainte-Catherine, vue vers l'est",
  date: "vers 1930",
  rotation: 0,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Game">
        <Composition
          id="DailyGameStory"
          component={DailyGameStory}
          schema={DailyGameStorySchema}
          durationInFrames={TOTAL_DURATION}
          fps={FPS}
          width={STORY_WIDTH}
          height={STORY_HEIGHT}
          defaultProps={sampleProps satisfies DailyGameStoryProps}
        />
      </Folder>

      <Folder name="Print">
        <Composition
          id="PrintOfTheWeek-Square"
          component={PrintOfTheWeekSquare}
          schema={PrintOfTheWeekSchema}
          durationInFrames={SQUARE_DURATION}
          fps={FPS}
          width={SQUARE_SIZE}
          height={SQUARE_SIZE}
          defaultProps={sampleProps satisfies PrintOfTheWeekProps}
        />
        <Composition
          id="PrintOfTheWeek-Story"
          component={PrintOfTheWeekStory}
          schema={PrintOfTheWeekSchema}
          durationInFrames={STORY_DURATION}
          fps={FPS}
          width={STORY_WIDTH}
          height={STORY_HEIGHT}
          defaultProps={sampleProps satisfies PrintOfTheWeekProps}
        />
      </Folder>
    </>
  );
};
