import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { colors } from "../lib/brand";
import { figtree, ibmPlexMono } from "../lib/fonts";
import { WallMockup } from "../components/WallMockup";
import type { RoomBackground, ProductStyle } from "../lib/print-config";

type Props = {
  imageUrl: string;
  room: RoomBackground;
  productStyle: ProductStyle;
  /** Print size scale (0.4, 0.7, 1.0) */
  sizeScale?: number;
  /** Product label shown in corner badge */
  productLabel?: string;
};

/**
 * WallScene — shows the print composited on a room wall.
 *
 * The photo materializes onto the wall with a spring animation,
 * and a subtle product type badge appears in the corner.
 */
export const WallScene: React.FC<Props> = ({
  imageUrl,
  room,
  productStyle,
  sizeScale = 0.85,
  productLabel,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Room background fades in instantly, photo on wall springs in
  const photoSpring = spring({
    frame,
    fps,
    delay: 5,
    config: { damping: 200 },
  });
  const photoOpacity = interpolate(photoSpring, [0, 1], [0, 1]);
  const photoScale = interpolate(photoSpring, [0, 1], [0.92, 1]);

  // Room name badge — fades in after photo
  const badgeSpring = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 200 },
  });
  const badgeOpacity = interpolate(badgeSpring, [0, 1], [0, 1]);

  // Product badge
  const prodSpring = spring({
    frame,
    fps,
    delay: Math.round(0.7 * fps),
    config: { damping: 200 },
  });
  const prodOpacity = interpolate(prodSpring, [0, 1], [0, 1]);

  return (
    <AbsoluteFill>
      {/* Full-bleed room with photo composited */}
      <AbsoluteFill style={{ opacity: photoOpacity, transform: `scale(${photoScale})` }}>
        <WallMockup
          imageUrl={imageUrl}
          room={room}
          productStyle={productStyle}
          sizeScale={sizeScale}
          width={width}
          height={height}
        />
      </AbsoluteFill>

      {/* Room name badge — bottom-left */}
      <div
        style={{
          position: "absolute",
          bottom: 28,
          left: 28,
          backgroundColor: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(8px)",
          borderRadius: 12,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 14,
          paddingRight: 14,
          opacity: badgeOpacity,
        }}
      >
        <span
          style={{
            fontFamily: figtree.fontFamily,
            fontSize: 13,
            fontWeight: 500,
            color: "white",
          }}
        >
          {room.name}
        </span>
      </div>

      {/* Product type badge — bottom-right */}
      {productLabel && (
        <div
          style={{
            position: "absolute",
            bottom: 28,
            right: 28,
            backgroundColor: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: 12,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 14,
            paddingRight: 14,
            opacity: prodOpacity,
          }}
        >
          <span
            style={{
              fontFamily: ibmPlexMono.fontFamily,
              fontSize: 11,
              fontWeight: 500,
              color: colors.charcoal,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
            }}
          >
            {productLabel}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
