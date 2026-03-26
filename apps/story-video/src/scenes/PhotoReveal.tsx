import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Img,
} from "remotion";
import { colors, STORY_WIDTH } from "../lib/brand";
import { spectral, ibmPlexMono } from "../lib/fonts";
import { GameHeader } from "../components/GameHeader";

type Props = {
  imageUrl: string;
  title: string;
  date: string;
};

export const PhotoReveal: React.FC<Props> = ({ imageUrl, title, date }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Photo entrance — slides up with spring
  const photoSpring = spring({ frame, fps, config: { damping: 200 } });
  const photoY = interpolate(photoSpring, [0, 1], [60, 0]);
  const photoOpacity = interpolate(photoSpring, [0, 1], [0, 1]);

  // Ken Burns — slow zoom + slight upward drift
  const kenBurnsScale = interpolate(
    frame,
    [0, durationInFrames],
    [1, 1.08],
    { extrapolateRight: "clamp" }
  );
  const kenBurnsDrift = interpolate(
    frame,
    [0, durationInFrames],
    [0, -12],
    { extrapolateRight: "clamp" }
  );

  // Title text — springs in after photo
  const titleSpring = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 200 },
  });
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);
  const titleY = interpolate(titleSpring, [0, 1], [30, 0]);

  // Date label
  const dateSpring = spring({
    frame,
    fps,
    delay: Math.round(0.7 * fps),
    config: { damping: 200 },
  });
  const dateOpacity = interpolate(dateSpring, [0, 1], [0, 1]);

  // "Indice" label — matches game's desktop panel "CLUE" label
  const clueSpring = spring({
    frame,
    fps,
    delay: Math.round(0.9 * fps),
    config: { damping: 200 },
  });
  const clueOpacity = interpolate(clueSpring, [0, 1], [0, 1]);

  const photoWidth = STORY_WIDTH - 80;
  const photoHeight = Math.round(photoWidth * (4 / 3));

  return (
    <AbsoluteFill style={{ backgroundColor: colors.dark }}>
      {/* Game header */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <GameHeader />
      </div>

      {/* Main content area — matches desktop side panel layout */}
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 40,
          paddingLeft: 40,
          paddingRight: 40,
        }}
      >
        {/* Photo container — matches game's desktop panel preview */}
        <div
          style={{
            width: photoWidth,
            height: photoHeight,
            borderRadius: 24,
            overflow: "hidden",
            opacity: photoOpacity,
            transform: `translateY(${photoY}px)`,
            backgroundColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Img
            src={imageUrl}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${kenBurnsScale}) translateY(${kenBurnsDrift}px)`,
            }}
          />
        </div>

        {/* Metadata — matches game desktop panel text layout */}
        <div
          style={{
            marginTop: 32,
            paddingLeft: 16,
            paddingRight: 16,
            width: "100%",
          }}
        >
          {/* "INDICE" label — mono-metric like the game */}
          <div
            style={{
              fontFamily: ibmPlexMono.fontFamily,
              fontSize: 11,
              fontWeight: 500,
              color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              opacity: clueOpacity,
            }}
          >
            indice
          </div>

          {/* Date + title — matches game's white/90 text */}
          <div
            style={{
              marginTop: 16,
              fontFamily: spectral.fontFamily,
              fontSize: 32,
              fontWeight: 400,
              color: "rgba(255,255,255,0.9)",
              lineHeight: 1.5,
              letterSpacing: "-0.01em",
              opacity: titleOpacity,
              transform: `translateY(${titleY}px)`,
            }}
          >
            <span
              style={{
                fontFamily: ibmPlexMono.fontFamily,
                fontSize: 16,
                fontWeight: 500,
                color: colors.copper,
                letterSpacing: "0.1em",
                opacity: dateOpacity,
              }}
            >
              {date}
            </span>
            {title ? (
              <span style={{ color: "rgba(255,255,255,0.4)" }}>
                {" · "}
              </span>
            ) : null}
            {title}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
