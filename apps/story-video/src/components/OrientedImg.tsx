import React from "react";
import { Img } from "remotion";
import type { ImageRotation } from "../lib/orientation";

/**
 * OrientedImg — wraps Remotion's <Img> with explicit orientation control.
 *
 * The render scripts resolve the final rotation (from DB rotationDegrees
 * or EXIF Orientation tag) into a single 0/90/180/270 value before
 * passing it here.
 *
 * We set `image-orientation: none` to DISABLE the browser's automatic
 * EXIF rotation, then apply our own CSS transform. This avoids double-
 * rotation (browser EXIF + our transform both firing).
 */
type Props = {
  src: string;
  rotation: ImageRotation;
  style?: React.CSSProperties;
};

export const OrientedImg: React.FC<Props> = ({ src, rotation, style }) => {
  const needsSwap = rotation === 90 || rotation === 270;

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
        src={src}
        style={{
          // Disable browser EXIF auto-rotation — we handle it ourselves
          imageOrientation: "none" as React.CSSProperties["imageOrientation"],
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
