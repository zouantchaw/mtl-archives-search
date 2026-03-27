import React from "react";
import { Img } from "remotion";
import type { ImageRotation } from "../lib/orientation";

/**
 * OrientedImg — wraps Remotion's <Img> with orientation correction.
 *
 * Two layers of orientation handling:
 *
 * 1. EXIF orientation — most archive JPEGs carry an EXIF Orientation tag
 *    (e.g. tag 6 = rotate 90° CW). We set `image-orientation: from-image`
 *    so the browser auto-applies this. This is the default in modern
 *    browsers but we set it explicitly to be safe in headless Chromium.
 *
 * 2. DB rotationDegrees — some photos have a manual rotation override
 *    stored in the manifest. When non-zero, we apply an additional CSS
 *    transform on top of the EXIF correction.
 *
 * For 90°/270° DB rotations, the image swaps width/height so we
 * center + crop within the parent container.
 */
type Props = {
  src: string;
  rotation: ImageRotation;
  style?: React.CSSProperties;
};

export const OrientedImg: React.FC<Props> = ({ src, rotation, style }) => {
  const needsDbRotation = rotation !== 0;
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
          // Always respect EXIF orientation from the JPEG
          imageOrientation: "from-image" as React.CSSProperties["imageOrientation"],
          // DB rotation override
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
                transform: needsDbRotation
                  ? `rotate(${rotation}deg)`
                  : undefined,
              }),
        }}
      />
    </div>
  );
};
