import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { colors } from "../lib/brand";
import { spectral, figtree, ibmPlexMono } from "../lib/fonts";
import { AccuracyBlocks } from "../components/AccuracyBlocks";
import { GuessPin, ActualPin } from "../components/GamePin";

/**
 * Score colors — matches GameClient.tsx getScoreColor()
 */
const getScoreColor = (score: number): string => {
  if (score >= 900) return "#22c55e"; // emerald-500
  if (score >= 700) return "#84cc16"; // lime-500
  if (score >= 500) return "#f59e0b"; // amber-500
  if (score >= 300) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
};

/**
 * ScoreReveal scene — simulates the game's results overlay.
 *
 * Shows:
 * - Large score number (spring animation)
 * - Accuracy blocks (staggered fill)
 * - Distance text
 * - Mini map preview with both pins + distance line
 * - "Votre score?" challenge text
 */
export const ScoreReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const SCORE = 847;
  const DISTANCE = 523;
  const scoreColor = getScoreColor(SCORE);

  // Score number — dramatic spring entrance
  const scoreSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const scoreScale = interpolate(scoreSpring, [0, 1], [0.3, 1]);
  const scoreOpacity = interpolate(scoreSpring, [0, 1], [0, 1]);

  // "points" label — fades in after score
  const pointsSpring = spring({
    frame,
    fps,
    delay: Math.round(0.3 * fps),
    config: { damping: 200 },
  });
  const pointsOpacity = interpolate(pointsSpring, [0, 1], [0, 1]);

  // Distance text
  const distSpring = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 200 },
  });
  const distOpacity = interpolate(distSpring, [0, 1], [0, 1]);

  // Mini map with pins — slides up
  const mapSpring = spring({
    frame,
    fps,
    delay: Math.round(0.7 * fps),
    config: { damping: 200 },
  });
  const mapOpacity = interpolate(mapSpring, [0, 1], [0, 1]);
  const mapY = interpolate(mapSpring, [0, 1], [30, 0]);

  // Challenge text — fades in last
  const challengeSpring = spring({
    frame,
    fps,
    delay: Math.round(1.2 * fps),
    config: { damping: 200 },
  });
  const challengeOpacity = interpolate(challengeSpring, [0, 1], [0, 1]);
  const challengeY = interpolate(challengeSpring, [0, 1], [20, 0]);

  // Distance line grows between the two pins in the mini map
  const lineProgress = interpolate(mapSpring, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paper,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Score number */}
      <div
        style={{
          fontFamily: spectral.fontFamily,
          fontSize: 160,
          fontWeight: 600,
          color: scoreColor,
          lineHeight: 1,
          letterSpacing: "-0.06em",
          opacity: scoreOpacity,
          transform: `scale(${scoreScale})`,
        }}
      >
        {SCORE}
      </div>

      {/* Points + distance line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 8,
          opacity: pointsOpacity,
        }}
      >
        <span
          style={{
            fontFamily: figtree.fontFamily,
            fontSize: 20,
            color: colors.charcoal,
            opacity: 0.5,
          }}
        >
          points
        </span>
        <span
          style={{
            fontFamily: figtree.fontFamily,
            fontSize: 20,
            color: colors.charcoal,
            opacity: 0.3,
          }}
        >
          ·
        </span>
        <span
          style={{
            fontFamily: ibmPlexMono.fontFamily,
            fontSize: 18,
            fontWeight: 500,
            color: colors.charcoal,
            opacity: distOpacity * 0.6,
          }}
        >
          {DISTANCE}m
        </span>
      </div>

      {/* Accuracy blocks */}
      <div style={{ marginTop: 40 }}>
        <AccuracyBlocks score={SCORE} delay={Math.round(0.4 * fps)} />
      </div>

      {/* Mini map preview — shows both pins with distance line */}
      <div
        style={{
          marginTop: 48,
          opacity: mapOpacity,
          transform: `translateY(${mapY}px)`,
        }}
      >
        <div
          style={{
            width: 320,
            height: 160,
            borderRadius: 20,
            backgroundColor: "#e8e4df",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            border: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          {/* Faint grid */}
          {[0.25, 0.5, 0.75].map((pos, i) => (
            <React.Fragment key={i}>
              <div
                style={{
                  position: "absolute",
                  top: `${pos * 100}%`,
                  left: 0,
                  right: 0,
                  height: 1,
                  backgroundColor: "rgba(255,255,255,0.5)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `${pos * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  backgroundColor: "rgba(255,255,255,0.5)",
                }}
              />
            </React.Fragment>
          ))}

          {/* Distance line (red dashed) — matches game's polyline */}
          <svg
            style={{ position: "absolute", inset: 0 }}
            viewBox="0 0 320 160"
          >
            <line
              x1="100"
              y1="90"
              x2={100 + 130 * lineProgress}
              y2={90 - 40 * lineProgress}
              stroke="#ef4444"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
          </svg>

          {/* Guess pin */}
          <div
            style={{
              position: "absolute",
              left: 100 - 16,
              top: 90 - 16,
            }}
          >
            <GuessPin size={32} />
          </div>

          {/* Actual pin */}
          <div
            style={{
              position: "absolute",
              left: 230 - 16,
              top: 50 - 16,
              opacity: mapOpacity,
            }}
          >
            <ActualPin size={32} />
          </div>
        </div>
      </div>

      {/* Challenge text */}
      <div
        style={{
          marginTop: 56,
          opacity: challengeOpacity,
          transform: `translateY(${challengeY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: spectral.fontFamily,
            fontSize: 34,
            fontWeight: 600,
            color: colors.charcoal,
            letterSpacing: "-0.02em",
          }}
        >
          Pouvez-vous faire mieux?
        </div>
      </div>
    </AbsoluteFill>
  );
};
