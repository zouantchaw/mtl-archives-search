import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { colors } from "../lib/brand";
import { spectral, figtree, ibmPlexMono, manrope } from "../lib/fonts";
import { PRINT_SIZES } from "../lib/print-config";

type Props = {
  isStory?: boolean;
};

/**
 * PricingCta — pricing display with size options and purchase CTA.
 *
 * Shows starting price prominently, all size/price tiers,
 * and the URL to purchase. Designed to create desire + urgency.
 */
export const PricingCta: React.FC<Props> = ({ isStory = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // "Dès" label
  const desSpring = spring({ frame, fps, config: { damping: 200 } });
  const desOpacity = interpolate(desSpring, [0, 1], [0, 1]);

  // Price number
  const priceSpring = spring({
    frame,
    fps,
    delay: 3,
    config: { damping: 12, stiffness: 120 },
  });
  const priceScale = interpolate(priceSpring, [0, 1], [0.7, 1]);
  const priceOpacity = interpolate(priceSpring, [0, 1], [0, 1]);

  // Size options — staggered
  const sizeSprings = PRINT_SIZES.map((_, i) =>
    spring({
      frame,
      fps,
      delay: Math.round(0.4 * fps) + i * 4,
      config: { damping: 200 },
    })
  );

  // CTA button
  const ctaSpring = spring({
    frame,
    fps,
    delay: Math.round(0.7 * fps),
    config: { damping: 15, stiffness: 150 },
  });
  const ctaScale = interpolate(ctaSpring, [0, 1], [0.85, 1]);
  const ctaOpacity = interpolate(ctaSpring, [0, 1], [0, 1]);

  // URL
  const urlSpring = spring({
    frame,
    fps,
    delay: Math.round(0.9 * fps),
    config: { damping: 200 },
  });
  const urlOpacity = interpolate(urlSpring, [0, 1], [0, 1]);

  // Brand
  const brandSpring = spring({
    frame,
    fps,
    delay: Math.round(1.0 * fps),
    config: { damping: 200 },
  });
  const brandOpacity = interpolate(brandSpring, [0, 1], [0, 0.5]);

  // Subtle pulse on CTA
  const pulsePhase = Math.max(0, frame - Math.round(1.0 * fps));
  const pulse = 1 + 0.012 * Math.sin((pulsePhase / fps) * Math.PI * 2);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paper,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* "Dès" label */}
      <div
        style={{
          fontFamily: figtree.fontFamily,
          fontSize: 20,
          fontWeight: 400,
          color: colors.charcoal,
          opacity: desOpacity * 0.5,
          marginBottom: 4,
        }}
      >
        Dès
      </div>

      {/* Main price */}
      <div
        style={{
          fontFamily: spectral.fontFamily,
          fontSize: 96,
          fontWeight: 700,
          color: colors.charcoal,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          opacity: priceOpacity,
          transform: `scale(${priceScale})`,
        }}
      >
        45$
      </div>

      {/* Size options */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 36,
        }}
      >
        {PRINT_SIZES.map((size, i) => {
          const sizeOpacity = interpolate(sizeSprings[i], [0, 1], [0, 1]);
          const sizeY = interpolate(sizeSprings[i], [0, 1], [15, 0]);
          return (
            <div
              key={size.id}
              style={{
                textAlign: "center",
                opacity: sizeOpacity,
                transform: `translateY(${sizeY}px)`,
                backgroundColor:
                  i === 0
                    ? colors.blue
                    : "oklch(0.17 0.013 272 / 0.06)",
                borderRadius: 16,
                paddingTop: 14,
                paddingBottom: 14,
                paddingLeft: 20,
                paddingRight: 20,
              }}
            >
              <div
                style={{
                  fontFamily: ibmPlexMono.fontFamily,
                  fontSize: 13,
                  fontWeight: 500,
                  color: i === 0 ? colors.paper : colors.charcoal,
                  letterSpacing: "0.06em",
                }}
              >
                {size.name}
              </div>
              <div
                style={{
                  fontFamily: figtree.fontFamily,
                  fontSize: 18,
                  fontWeight: 600,
                  color: i === 0 ? colors.paper : colors.charcoal,
                  marginTop: 4,
                }}
              >
                {size.price}$
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA button */}
      <div
        style={{
          marginTop: 44,
          backgroundColor: colors.charcoal,
          paddingTop: 18,
          paddingBottom: 18,
          paddingLeft: 52,
          paddingRight: 52,
          borderRadius: 48,
          opacity: ctaOpacity,
          transform: `scale(${ctaScale * pulse})`,
        }}
      >
        <span
          style={{
            fontFamily: figtree.fontFamily,
            fontSize: 22,
            fontWeight: 600,
            color: colors.paper,
            letterSpacing: "0.02em",
          }}
        >
          Commander
        </span>
      </div>

      {/* URL */}
      <div
        style={{
          fontFamily: ibmPlexMono.fontFamily,
          fontSize: 16,
          fontWeight: 400,
          color: colors.steel,
          letterSpacing: "0.06em",
          marginTop: 22,
          opacity: urlOpacity,
        }}
      >
        mtlarchives.com/print
      </div>

      {/* Brand — bottom */}
      <div
        style={{
          position: "absolute",
          bottom: isStory ? 80 : 36,
          fontFamily: manrope.fontFamily,
          fontSize: 16,
          fontWeight: 700,
          color: colors.charcoal,
          opacity: brandOpacity,
          letterSpacing: "0.04em",
        }}
      >
        mtl archives
      </div>
    </AbsoluteFill>
  );
};
