import React from "react";
import { Img } from "remotion";
import type { ImageRotation } from "../lib/orientation";

/**
 * OrientedImg — wraps Remotion's <Img> with rotation correction.
 *
 * For 0° or 180°, the image keeps its natural aspect ratio.
 * For 90° or 270°, the image is rotated and the container is
 * adjusted so the rotated result fills the same bounding box.
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
          // When rotated 90/270, the image's natural w/h swap.
          // We render it larger then crop via the overflow:hidden parent.
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
