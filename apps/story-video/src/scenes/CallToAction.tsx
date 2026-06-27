import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { colors } from "../lib/brand";
import { figtree, ibmPlexMono, manrope } from "../lib/fonts";

export const CallToAction: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // CTA button — springs in with slight bounce
  const btnSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 150 },
  });
  const btnScale = interpolate(btnSpring, [0, 1], [0.8, 1]);
  const btnOpacity = interpolate(btnSpring, [0, 1], [0, 1]);

  // Stats text — fades in after button
  const statsSpring = spring({
    frame,
    fps,
    delay: Math.round(0.25 * fps),
    config: { damping: 200 },
  });
  const statsOpacity = interpolate(statsSpring, [0, 1], [0, 1]);

  // URL text — fades in after stats
  const urlSpring = spring({
    frame,
    fps,
    delay: Math.round(0.4 * fps),
    config: { damping: 200 },
  });
  const urlOpacity = interpolate(urlSpring, [0, 1], [0, 1]);

  // Brand text at bottom — fades in
  const brandSpring = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 200 },
  });
  const brandOpacity = interpolate(brandSpring, [0, 1], [0, 0.6]);

  // Subtle pulse on the CTA button after it lands
  const pulsePhase = Math.max(0, frame - Math.round(0.8 * fps));
  const pulse = 1 + 0.015 * Math.sin((pulsePhase / fps) * Math.PI * 2);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.dark,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* "Nouveau défi chaque jour" tagline */}
      <div
        style={{
          fontFamily: ibmPlexMono.fontFamily,
          fontSize: 14,
          fontWeight: 500,
          color: colors.copper,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          marginBottom: 40,
          opacity: statsOpacity,
        }}
      >
        nouveau défi chaque jour
      </div>

      {/* CTA button */}
      <div
        style={{
          backgroundColor: colors.blue,
          paddingTop: 22,
          paddingBottom: 22,
          paddingLeft: 64,
          paddingRight: 64,
          borderRadius: 52,
          opacity: btnOpacity,
          transform: `scale(${btnScale * pulse})`,
        }}
      >
        <div
          style={{
            fontFamily: figtree.fontFamily,
            fontSize: 26,
            fontWeight: 600,
            color: colors.paper,
            letterSpacing: "0.02em",
          }}
        >
          Jouez maintenant
        </div>
      </div>

      {/* URL */}
      <div
        style={{
          fontFamily: ibmPlexMono.fontFamily,
          fontSize: 18,
          fontWeight: 400,
          color: colors.steel,
          letterSpacing: "0.06em",
          marginTop: 28,
          opacity: urlOpacity,
        }}
      >
        mtlarchives.com/game
      </div>

      {/* Stats line */}
      <div
        style={{
          display: "flex",
          gap: 32,
          marginTop: 48,
          opacity: statsOpacity,
        }}
      >
        {[
          { value: "13 000+", label: "photos" },
          { value: "100+", label: "ans d'histoire" },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{ textAlign: "center" }}
          >
            <div
              style={{
                fontFamily: figtree.fontFamily,
                fontSize: 28,
                fontWeight: 700,
                color: colors.paper,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontFamily: ibmPlexMono.fontFamily,
                fontSize: 11,
                fontWeight: 500,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.1em",
                textTransform: "uppercase" as const,
                marginTop: 4,
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Brand at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          fontFamily: manrope.fontFamily,
          fontSize: 18,
          fontWeight: 700,
          color: colors.paper,
          opacity: brandOpacity,
          letterSpacing: "0.04em",
        }}
      >
        mtl archives
      </div>
    </AbsoluteFill>
  );
};
