import React from "react";
import { Img } from "remotion";

/**
 * Floating photo thumbnail — matches the game's mobile top-left preview.
 * Mirrors: GameClient.tsx floating photo thumbnail (w-20 h-20, rounded-xl, date badge)
 */
type Props = {
  imageUrl: string;
  date: string;
  size?: number;
};

export const FloatingThumbnail: React.FC<Props> = ({
  imageUrl,
  date,
  size = 96,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.16,
      overflow: "hidden",
      boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
      border: "2px solid white",
      position: "relative",
    }}
  >
    <Img
      src={imageUrl}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
    {/* Date badge — matches gradient overlay */}
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        padding: "6px 8px 4px",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: "white",
        }}
      >
        {date}
      </span>
    </div>
  </div>
);
