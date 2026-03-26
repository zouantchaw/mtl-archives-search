import React from "react";
import { Composition, Folder } from "remotion";
import {
  DailyGameStory,
  DailyGameStorySchema,
  type DailyGameStoryProps,
} from "./DailyGameStory";
import {
  STORY_WIDTH,
  STORY_HEIGHT,
  FPS,
  TOTAL_DURATION,
} from "./lib/brand";

export const RemotionRoot: React.FC = () => {
  return (
    <Folder name="Stories">
      <Composition
        id="DailyGameStory"
        component={DailyGameStory}
        schema={DailyGameStorySchema}
        durationInFrames={TOTAL_DURATION}
        fps={FPS}
        width={STORY_WIDTH}
        height={STORY_HEIGHT}
        defaultProps={
          {
            imageUrl:
              "https://res.cloudinary.com/demo/image/upload/sample.jpg",
            title: "Rue Sainte-Catherine, vue vers l'est",
            date: "vers 1930",
          } satisfies DailyGameStoryProps
        }
      />
    </Folder>
  );
};
