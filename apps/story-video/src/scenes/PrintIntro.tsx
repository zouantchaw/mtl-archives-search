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
import { spectral, ibmPlexMono, manrope } from "../lib/fonts";

type Props = {
  imageUrl: string;
};

/**
 * PrintIntro — editorial "Print of the Week" opening.
 *
 * Dark background with a soft vignette, "ESTAMPE DE LA SEMAINE" label
 * appears in mono metric, copper accent line grows, and a small
 * preview thumbnail of the print fades in.
 */
export const PrintIntro: React.FC<Props> = ({ imageUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Label — mono metric text fades in
  const labelSpring = spring({ frame, fps, config: { damping: 200 } });
  const labelOpacity = interpolate(labelSpring, [0, 1], [0, 1]);
  const labelY = interpolate(labelSpring, [0, 1], [20, 0]);

  // Copper accent line grows
  const lineSpring = spring({
    frame,
    fps,
    delay: Math.round(0.2 * fps),
    config: { damping: 200 },
  });
  const lineWidth = interpolate(lineSpring, [0, 1], [0, 80]);

  // Brand name
  const brandSpring = spring({
    frame,
    fps,
    delay: Math.round(0.35 * fps),
    config: { damping: 200 },
  });
  const brandOpacity = interpolate(brandSpring, [0, 1], [0, 0.5]);

  // Thumbnail preview
  const thumbSpring = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 15, stiffness: 120 },
  });
  const thumbScale = interpolate(thumbSpring, [0, 1], [0.85, 1]);
  const thumbOpacity = interpolate(thumbSpring, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.dark,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Subtle radial vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.4) 100%)",
        }}
      />

      {/* Small print preview thumbnail */}
      <div
        style={{
          width: 200,
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          opacity: thumbOpacity,
          transform: `scale(${thumbScale})`,
          marginBottom: 48,
        }}
      >
        <Img
          src={imageUrl}
          style={{ width: "100%", display: "block" }}
        />
      </div>

      {/* "ESTAMPE DE LA SEMAINE" label */}
      <div
        style={{
          fontFamily: ibmPlexMono.fontFamily,
          fontSize: 14,
          fontWeight: 500,
          color: colors.copper,
          letterSpacing: "0.16em",
          textTransform: "uppercase" as const,
          opacity: labelOpacity,
          transform: `translateY(${labelY}px)`,
        }}
      >
        estampe de la semaine
      </div>

      {/* Copper accent line */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          backgroundColor: colors.copper,
          marginTop: 20,
          marginBottom: 20,
          borderRadius: 1,
        }}
      />

      {/* Brand name */}
      <div
        style={{
          fontFamily: manrope.fontFamily,
          fontSize: 16,
          fontWeight: 700,
          color: colors.paper,
          letterSpacing: "0.04em",
          opacity: brandOpacity,
        }}
      >
        mtl archives
      </div>
    </AbsoluteFill>
  );
};
