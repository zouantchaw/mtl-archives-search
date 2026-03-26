import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { colors } from "../lib/brand";
import { spectral, ibmPlexMono, manrope } from "../lib/fonts";

export const BrandIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // "mtl archives" brand text — springs up from below
  const brandSpring = spring({ frame, fps, config: { damping: 200 } });
  const brandY = interpolate(brandSpring, [0, 1], [40, 0]);
  const brandOpacity = interpolate(brandSpring, [0, 1], [0, 1]);

  // "JEU QUOTIDIEN" label — fades in after brand text
  const labelSpring = spring({
    frame,
    fps,
    delay: Math.round(0.4 * fps),
    config: { damping: 200 },
  });
  const labelOpacity = interpolate(labelSpring, [0, 1], [0, 1]);
  const labelY = interpolate(labelSpring, [0, 1], [20, 0]);

  // Decorative line — grows from center
  const lineSpring = spring({
    frame,
    fps,
    delay: Math.round(0.25 * fps),
    config: { damping: 200 },
  });
  const lineWidth = interpolate(lineSpring, [0, 1], [0, 120]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.dark,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Brand name */}
      <div
        style={{
          fontFamily: manrope.fontFamily,
          fontSize: 52,
          fontWeight: 700,
          color: colors.paper,
          letterSpacing: "0.04em",
          transform: `translateY(${brandY}px)`,
          opacity: brandOpacity,
        }}
      >
        mtl archives
      </div>

      {/* Decorative line */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          backgroundColor: colors.copper,
          marginTop: 24,
          marginBottom: 24,
          borderRadius: 1,
        }}
      />

      {/* Daily game label */}
      <div
        style={{
          fontFamily: ibmPlexMono.fontFamily,
          fontSize: 16,
          fontWeight: 500,
          color: colors.copper,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity: labelOpacity,
          transform: `translateY(${labelY}px)`,
        }}
      >
        jeu quotidien
      </div>
    </AbsoluteFill>
  );
};
