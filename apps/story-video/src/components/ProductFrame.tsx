import React from "react";
import { Img, staticFile } from "remotion";
import type { ProductStyle } from "../lib/print-config";

/**
 * ProductFrame — renders the photo with the appropriate frame treatment.
 * Mirrors: WallPreview.tsx ProductFrame in apps/next-app.
 *
 * - poster: subtle shadow only
 * - framed: black frame border with inset canvas shadow
 * - hanger: wooden rails + cord SVG
 */
type Props = {
  children: React.ReactNode;
  style: ProductStyle;
  /** Whether this is displayed inside a room (smaller frame details) */
  inRoom?: boolean;
};

export const ProductFrame: React.FC<Props> = ({
  children,
  style,
  inRoom = false,
}) => {
  const intensity = style === "framed" ? 0.3 : style === "hanger" ? 0.2 : 0.15;
  const framePx = inRoom ? 4 : 6;
  const gapPx = inRoom ? 2 : 3;
  const railH = inRoom ? 8 : 12;
  const cordH = inRoom ? 12 : 18;

  if (style === "framed") {
    return (
      <div
        style={{
          padding: framePx,
          backgroundColor: "#0a0a1a",
          boxShadow: `0 2px 4px rgba(0,0,0,${intensity * 0.3}), 0 8px 20px rgba(0,0,0,${intensity * 0.5}), 0 20px 40px rgba(0,0,0,${intensity * 0.3})`,
        }}
      >
        <div style={{ padding: gapPx, backgroundColor: "#0a0a1a" }}>
          <div
            style={{
              position: "relative",
              boxShadow: `inset 0 1px 3px rgba(0,0,0,0.3)`,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  if (style === "hanger") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Cord */}
        <svg
          width="50"
          height={cordH}
          viewBox="0 0 50 18"
          style={{ marginBottom: -1 }}
        >
          <path
            d="M10 18 L25 4 L40 18"
            stroke="black"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
        {/* Top rail */}
        <Img
          src={staticFile("images/items/wooden-hanger-rail.png")}
          style={{
            width: "106%",
            height: railH,
            objectFit: "cover",
            marginLeft: "-3%",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))",
          }}
        />
        {/* Photo */}
        <div
          style={{
            boxShadow: `0 4px 12px rgba(0,0,0,${intensity}), 0 12px 32px rgba(0,0,0,${intensity * 0.5})`,
          }}
        >
          {children}
        </div>
        {/* Bottom rail */}
        <Img
          src={staticFile("images/items/wooden-hanger-rail.png")}
          style={{
            width: "106%",
            height: railH,
            objectFit: "cover",
            marginLeft: "-3%",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))",
          }}
        />
      </div>
    );
  }

  // poster — shadow only
  return (
    <div
      style={{
        boxShadow: `0 1px 2px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.04), 0 12px 24px rgba(0,0,0,${intensity})`,
      }}
    >
      {children}
    </div>
  );
};
