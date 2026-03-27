import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Img,
  staticFile,
  Easing,
} from "remotion";
import { colors } from "../lib/brand";
import { figtree, ibmPlexMono } from "../lib/fonts";
import { ProductFrame } from "../components/ProductFrame";
import { OrientedImg } from "../components/OrientedImg";
import type { RoomBackground, ProductStyle } from "../lib/print-config";
import type { ImageRotation } from "../lib/orientation";

type RoomStop = {
  room: RoomBackground;
  productStyle: ProductStyle;
  productLabel: string;
};

type Props = {
  imageUrl: string;
  rotation?: ImageRotation;
  stops: RoomStop[];
  sizeScale?: number;
};

/**
 * WallCarousel — the print stays in place while room backgrounds
 * crossfade behind it. Creates a "same art, different spaces" feel.
 *
 * Each stop gets an equal share of the scene duration with a smooth
 * crossfade transition between rooms. The print fades in once at the
 * start and the room/product badges update per stop.
 */
export const WallCarousel: React.FC<Props> = ({
  imageUrl,
  rotation = 0,
  stops,
  sizeScale = 0.85,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const count = stops.length;

  // Time per room stop (with overlap for crossfade)
  const crossfadeDur = Math.round(0.6 * fps); // 18 frames
  const stopDur = Math.floor(
    (durationInFrames + crossfadeDur * (count - 1)) / count
  );

  // Print entrance — once at the start
  const printSpring = spring({
    frame,
    fps,
    delay: 3,
    config: { damping: 200 },
  });
  const printOpacity = interpolate(printSpring, [0, 1], [0, 1]);
  const printScale = interpolate(printSpring, [0, 1], [0.94, 1]);

  // Determine which stop is active and compute crossfade opacities
  const getStopOpacity = (i: number): number => {
    const startFrame = i * (stopDur - crossfadeDur);
    const endFrame = startFrame + stopDur;

    // Fade in
    const fadeIn =
      i === 0
        ? 1
        : interpolate(frame, [startFrame, startFrame + crossfadeDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.quad),
          });

    // Fade out
    const fadeOut =
      i === count - 1
        ? 1
        : interpolate(
            frame,
            [endFrame - crossfadeDur, endFrame],
            [1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.inOut(Easing.quad),
            }
          );

    return fadeIn * fadeOut;
  };

  // Find current active stop for badge display
  const activeIdx = stops.findIndex((_, i) => {
    const startFrame = i * (stopDur - crossfadeDur);
    const endFrame = startFrame + stopDur;
    const mid = (startFrame + endFrame) / 2;
    return frame < mid + (stopDur - crossfadeDur) / 2;
  });
  const currentStop = stops[Math.max(0, activeIdx === -1 ? count - 1 : activeIdx)];

  // Badge animation — re-triggers on stop change
  const badgeSpring = spring({
    frame: frame % (stopDur - crossfadeDur),
    fps,
    delay: Math.round(0.3 * fps),
    config: { damping: 200 },
  });
  const badgeOpacity = interpolate(badgeSpring, [0, 1], [0, 1]);

  // Use the first room's wall position for the print anchor
  // (all rooms position similarly enough for a pleasing effect)
  const anchor = stops[0].room.wall;
  const photoWidthPct = anchor.maxWidth * sizeScale;

  return (
    <AbsoluteFill>
      {/* Room background layers — stacked with crossfade */}
      {stops.map((stop, i) => {
        const opacity = getStopOpacity(i);
        if (opacity <= 0) return null;
        return (
          <AbsoluteFill key={stop.room.id} style={{ opacity }}>
            <Img
              src={staticFile(stop.room.src)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </AbsoluteFill>
        );
      })}

      {/* Print anchored on wall — stays in place during room transitions */}
      <div
        style={{
          position: "absolute",
          left: `${anchor.centerX}%`,
          top: `${anchor.centerY}%`,
          transform: `translate(-50%, -50%) scale(${printScale})`,
          width: `${photoWidthPct}%`,
          opacity: printOpacity,
        }}
      >
        <ProductFrame style={currentStop.productStyle} inRoom>
          <OrientedImg src={imageUrl} rotation={rotation} />
        </ProductFrame>
      </div>

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
          opacity: printOpacity * badgeOpacity,
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
          {currentStop.room.name}
        </span>
      </div>

      {/* Product type badge — bottom-right */}
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
          opacity: printOpacity * badgeOpacity,
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
          {currentStop.productLabel}
        </span>
      </div>
    </AbsoluteFill>
  );
};
