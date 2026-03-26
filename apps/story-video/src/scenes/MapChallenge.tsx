import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
} from "remotion";
import { colors, STORY_WIDTH, STORY_HEIGHT } from "../lib/brand";
import { figtree } from "../lib/fonts";
import { GameHeader } from "../components/GameHeader";
import { FloatingThumbnail } from "../components/FloatingThumbnail";
import { GuessPin } from "../components/GamePin";
import { CtaPill } from "../components/CtaPill";

type Props = {
  imageUrl: string;
  date: string;
};

/**
 * MapChallenge scene — simulates the game's map view.
 *
 * Shows a stylized map background with:
 * - Game header bar at top
 * - Floating photo thumbnail (top-left, like mobile game)
 * - Animated pin drop
 * - "Placez votre épingle" CTA pill at bottom
 * - A pulsing hint circle before the pin lands
 */
export const MapChallenge: React.FC<Props> = ({ imageUrl, date }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Pin drops in from above with bouncy spring
  const pinDelay = Math.round(0.6 * fps);
  const pinSpring = spring({
    frame,
    fps,
    delay: pinDelay,
    config: { damping: 8, stiffness: 120 },
  });
  const pinY = interpolate(pinSpring, [0, 1], [-300, 0]);
  const pinOpacity = interpolate(
    frame,
    [pinDelay, pinDelay + 2],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Shadow grows as pin lands
  const shadowScale = interpolate(pinSpring, [0, 1], [0.3, 1]);
  const shadowOpacity = interpolate(pinSpring, [0, 1], [0, 0.25]);

  // Pulsing target hint before pin drops
  const pulseOpacity =
    frame < pinDelay
      ? interpolate(
          Math.sin((frame / fps) * Math.PI * 3),
          [-1, 1],
          [0.15, 0.4]
        )
      : interpolate(pinSpring, [0.5, 1], [0.4, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  // Thumbnail entrance
  const thumbSpring = spring({
    frame,
    fps,
    delay: 5,
    config: { damping: 200 },
  });
  const thumbOpacity = interpolate(thumbSpring, [0, 1], [0, 1]);
  const thumbScale = interpolate(thumbSpring, [0, 1], [0.8, 1]);

  // CTA pill slides up from bottom
  const ctaSpring = spring({
    frame,
    fps,
    delay: Math.round(0.3 * fps),
    config: { damping: 200 },
  });
  const ctaY = interpolate(ctaSpring, [0, 1], [60, 0]);
  const ctaOpacity = interpolate(ctaSpring, [0, 1], [0, 1]);

  // Pin placement location (center-ish of the map area)
  const pinX = STORY_WIDTH * 0.52;
  const pinAreaY = STORY_HEIGHT * 0.46;

  return (
    <AbsoluteFill style={{ backgroundColor: "#e8e4df" }}>
      {/* Stylized map background — grid pattern suggesting streets */}
      <AbsoluteFill>
        {/* Major horizontal "streets" */}
        {[0.25, 0.35, 0.45, 0.55, 0.65, 0.75].map((y, i) => (
          <div
            key={`h-${i}`}
            style={{
              position: "absolute",
              top: `${y * 100}%`,
              left: 0,
              right: 0,
              height: i % 2 === 0 ? 3 : 1.5,
              backgroundColor:
                i % 2 === 0
                  ? "rgba(255,255,255,0.7)"
                  : "rgba(255,255,255,0.4)",
            }}
          />
        ))}
        {/* Major vertical "streets" */}
        {[0.15, 0.3, 0.45, 0.55, 0.7, 0.85].map((x, i) => (
          <div
            key={`v-${i}`}
            style={{
              position: "absolute",
              left: `${x * 100}%`,
              top: "15%",
              bottom: "15%",
              width: i % 2 === 0 ? 3 : 1.5,
              backgroundColor:
                i % 2 === 0
                  ? "rgba(255,255,255,0.7)"
                  : "rgba(255,255,255,0.4)",
            }}
          />
        ))}
        {/* Finer grid — secondary streets */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={`sh-${i}`}
            style={{
              position: "absolute",
              top: `${18 + i * 5.5}%`,
              left: "10%",
              right: "10%",
              height: 1,
              backgroundColor: "rgba(255,255,255,0.25)",
            }}
          />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={`sv-${i}`}
            style={{
              position: "absolute",
              left: `${10 + i * 10}%`,
              top: "18%",
              bottom: "18%",
              width: 1,
              backgroundColor: "rgba(255,255,255,0.25)",
            }}
          />
        ))}

        {/* River — curved band at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "14%",
            background:
              "linear-gradient(to top, oklch(0.85 0.04 230 / 0.5), oklch(0.88 0.02 230 / 0.2), transparent)",
          }}
        />

        {/* Parks — subtle green patches */}
        <div
          style={{
            position: "absolute",
            top: "32%",
            left: "38%",
            width: 80,
            height: 60,
            borderRadius: 12,
            backgroundColor: "oklch(0.88 0.06 145 / 0.3)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "52%",
            left: "62%",
            width: 50,
            height: 40,
            borderRadius: 8,
            backgroundColor: "oklch(0.88 0.06 145 / 0.25)",
          }}
        />
      </AbsoluteFill>

      {/* Game header */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <GameHeader />
      </div>

      {/* Floating photo thumbnail — top-left like mobile game */}
      <div
        style={{
          position: "absolute",
          top: 72,
          left: 16,
          opacity: thumbOpacity,
          transform: `scale(${thumbScale})`,
        }}
      >
        <FloatingThumbnail imageUrl={imageUrl} date={date} size={96} />
      </div>

      {/* Pulsing target hint */}
      <div
        style={{
          position: "absolute",
          left: pinX - 40,
          top: pinAreaY - 40,
          width: 80,
          height: 80,
          borderRadius: "50%",
          backgroundColor: colors.blue,
          opacity: pulseOpacity,
        }}
      />

      {/* Pin + shadow */}
      <div
        style={{
          position: "absolute",
          left: pinX - 24,
          top: pinAreaY - 48,
          opacity: pinOpacity,
          transform: `translateY(${pinY}px)`,
        }}
      >
        <GuessPin size={48} />
      </div>
      {/* Pin shadow */}
      <div
        style={{
          position: "absolute",
          left: pinX - 15,
          top: pinAreaY + 4,
          width: 30,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "rgba(0,0,0,0.2)",
          opacity: shadowOpacity,
          transform: `scaleX(${shadowScale})`,
        }}
      />

      {/* CTA pill — bottom center */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: "50%",
          transform: `translateX(-50%) translateY(${ctaY}px)`,
          opacity: ctaOpacity,
        }}
      >
        <CtaPill label="Placez votre épingle" />
      </div>
    </AbsoluteFill>
  );
};
