import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { colors } from "../lib/brand";

/**
 * Accuracy blocks — 5 squares that fill based on score.
 * Mirrors: GameClient.tsx accuracy blocks (h-9 w-9 rounded-xl).
 * Each block animates in with a staggered spring.
 */
type Props = {
  score: number;
  blockSize?: number;
  gap?: number;
  /** Frame delay before the first block appears */
  delay?: number;
};

export const AccuracyBlocks: React.FC<Props> = ({
  score,
  blockSize = 52,
  gap = 12,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const filled = Math.round((score / 1000) * 5);

  return (
    <div style={{ display: "flex", gap, justifyContent: "center" }}>
      {Array.from({ length: 5 }).map((_, i) => {
        const blockDelay = delay + i * 3; // 3-frame stagger between blocks
        const blockSpring = spring({
          frame,
          fps,
          delay: blockDelay,
          config: { damping: 12, stiffness: 200 },
        });
        const scale = interpolate(blockSpring, [0, 1], [0, 1]);
        const isFilled = i < filled;

        return (
          <div
            key={i}
            style={{
              width: blockSize,
              height: blockSize,
              borderRadius: blockSize * 0.25,
              backgroundColor: isFilled
                ? colors.green
                : "oklch(0.84 0.016 257 / 0.4)", // brand-steel/40
              transform: `scale(${scale})`,
            }}
          />
        );
      })}
    </div>
  );
};
