import React from "react";
import { Img, staticFile } from "remotion";
import type { ImageRotation } from "../lib/orientation";

/**
 * OrientedImg — wraps Remotion's <Img> with orientation correction.
 *
 * The render scripts strip EXIF from archive images and place them
 * in public/cached/. If `src` doesn't start with "http", it's
 * treated as a staticFile key.
 *
 * The `rotation` prop comes from either DB rotationDegrees or
 * Gemini vision detection.
 */
type Props = {
  src: string;
  rotation: ImageRotation;
  style?: React.CSSProperties;
};

export const OrientedImg: React.FC<Props> = ({ src, rotation, style }) => {
  const needsSwap = rotation === 90 || rotation === 270;
  // If src is a local static key (not a URL), resolve via staticFile
  const resolvedSrc = src.startsWith("http") ? src : staticFile(src);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      <Img
        src={resolvedSrc}
        style={{
          ...(needsSwap
            ? {
                position: "absolute",
                top: "50%",
                left: "50%",
                width: "auto",
                height: "100%",
                minWidth: "100%",
                objectFit: "cover",
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }
            : {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform:
                  rotation === 0 ? undefined : `rotate(${rotation}deg)`,
              }),
        }}
      />
    </div>
  );
};
