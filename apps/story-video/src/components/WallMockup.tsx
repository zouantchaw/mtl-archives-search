import React from "react";
import { Img, staticFile } from "remotion";
import type { RoomBackground, ProductStyle } from "../lib/print-config";
import type { ImageRotation } from "../lib/orientation";
import { ProductFrame } from "./ProductFrame";
import { OrientedImg } from "./OrientedImg";

/**
 * WallMockup — composites a photo onto a room wall background.
 * Mirrors: WallPreview.tsx RoomSlide in apps/next-app.
 */
type Props = {
  imageUrl: string;
  rotation?: ImageRotation;
  room: RoomBackground;
  productStyle: ProductStyle;
  sizeScale?: number;
  width: number;
  height: number;
};

export const WallMockup: React.FC<Props> = ({
  imageUrl,
  rotation = 0,
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
          <OrientedImg src={imageUrl} rotation={rotation} />
        </ProductFrame>
      </div>
    </div>
  );
};
