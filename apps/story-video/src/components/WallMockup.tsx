import React from "react";
import { Img, staticFile } from "remotion";
import type { RoomBackground, ProductStyle } from "../lib/print-config";
import { ProductFrame } from "./ProductFrame";

/**
 * WallMockup — composites a photo onto a room wall background.
 * Mirrors: WallPreview.tsx RoomSlide in apps/next-app.
 *
 * Positions the photo at the room's configured wall center point
 * using percentage-based absolute positioning.
 */
type Props = {
  imageUrl: string;
  room: RoomBackground;
  productStyle: ProductStyle;
  /** Scale factor: 0.4 (8×10"), 0.7 (18×24"), 1.0 (24×36") */
  sizeScale?: number;
  /** Container width in px */
  width: number;
  /** Container height in px */
  height: number;
};

export const WallMockup: React.FC<Props> = ({
  imageUrl,
  room,
  productStyle,
  sizeScale = 1.0,
  width,
  height,
}) => {
  const photoWidthPct = room.wall.maxWidth * sizeScale;

  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        borderRadius: 0,
      }}
    >
      {/* Room background */}
      <Img
        src={staticFile(room.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Photo on wall */}
      <div
        style={{
          position: "absolute",
          left: `${room.wall.centerX}%`,
          top: `${room.wall.centerY}%`,
          transform: "translate(-50%, -50%)",
          width: `${photoWidthPct}%`,
        }}
      >
        <ProductFrame style={productStyle} inRoom>
          <Img
            src={imageUrl}
            style={{
              width: "100%",
              display: "block",
            }}
          />
        </ProductFrame>
      </div>
    </div>
  );
};
