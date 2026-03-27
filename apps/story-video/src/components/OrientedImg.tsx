import React from "react";
import { Img } from "remotion";
import type { ImageRotation } from "../lib/orientation";

/**
 * OrientedImg — wraps Remotion's <Img> with rotation correction.
 *
 * Archive scans often have incorrect EXIF Orientation tags, so we
 * set `image-orientation: none` to ignore EXIF entirely. The only
 * rotation we trust is the DB `rotationDegrees` field, which is
 * manually verified.
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
          // Ignore EXIF — archive scans have unreliable orientation tags
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
