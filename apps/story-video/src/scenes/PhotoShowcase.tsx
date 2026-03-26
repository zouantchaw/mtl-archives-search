import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Img,
} from "remotion";
import { colors } from "../lib/brand";
import { spectral, ibmPlexMono } from "../lib/fonts";
import { ProductFrame } from "../components/ProductFrame";

type Props = {
  imageUrl: string;
  title: string;
  date: string;
  /** Whether this is a story (vertical) or square format */
  isStory?: boolean;
};

/**
 * PhotoShowcase — full editorial presentation of the print.
 *
 * Clean paper background, the photo presented as a poster print
 * with Ken Burns effect, title and date in editorial typography.
 */
export const PhotoShowcase: React.FC<Props> = ({
  imageUrl,
  title,
  date,
  isStory = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // Photo entrance — springs up
  const photoSpring = spring({ frame, fps, config: { damping: 200 } });
  const photoY = interpolate(photoSpring, [0, 1], [50, 0]);
  const photoOpacity = interpolate(photoSpring, [0, 1], [0, 1]);

  // Ken Burns — gentle zoom
  const kenBurnsScale = interpolate(
    frame,
    [0, durationInFrames],
    [1, 1.06],
    { extrapolateRight: "clamp" }
  );

  // Title
  const titleSpring = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 200 },
  });
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);
  const titleY = interpolate(titleSpring, [0, 1], [25, 0]);

  // Date
  const dateSpring = spring({
    frame,
    fps,
    delay: Math.round(0.7 * fps),
    config: { damping: 200 },
  });
  const dateOpacity = interpolate(dateSpring, [0, 1], [0, 1]);

  const photoW = isStory ? width - 100 : width - 120;
  const photoH = isStory
    ? Math.round(photoW * (4 / 3))
    : Math.round((height - 220) * 0.72);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paper,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Photo with poster frame treatment */}
      <div
        style={{
          opacity: photoOpacity,
          transform: `translateY(${photoY}px)`,
        }}
      >
        <ProductFrame style="poster">
          <div
            style={{
              width: photoW,
              height: photoH,
              overflow: "hidden",
            }}
          >
            <Img
              src={imageUrl}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${kenBurnsScale})`,
              }}
            />
          </div>
        </ProductFrame>
      </div>

      {/* Title + date below */}
      <div
        style={{
          marginTop: 32,
          paddingLeft: 48,
          paddingRight: 48,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: ibmPlexMono.fontFamily,
            fontSize: 13,
            fontWeight: 500,
            color: colors.copper,
            letterSpacing: "0.12em",
            textTransform: "uppercase" as const,
            opacity: dateOpacity,
            marginBottom: 10,
          }}
        >
          {date}
        </div>
        <div
          style={{
            fontFamily: spectral.fontFamily,
            fontSize: isStory ? 30 : 28,
            fontWeight: 600,
            color: colors.charcoal,
            letterSpacing: "-0.02em",
            lineHeight: 1.3,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};
