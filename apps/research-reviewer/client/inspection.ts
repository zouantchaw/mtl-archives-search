import type { Rect } from "../src/assistance";
export type { Rect };
export const whole: Rect = { x: 0, y: 0, w: 10000, h: 10000 };
export const areas: Record<string, Rect> = {
  "Whole image": whole,
  "Top edge": { x: 0, y: 0, w: 10000, h: 1800 },
  "Bottom edge": { x: 0, y: 8200, w: 10000, h: 1800 },
  "Left edge": { x: 0, y: 0, w: 1800, h: 10000 },
  "Right edge": { x: 8200, y: 0, w: 1800, h: 10000 },
  "Bottom left": { x: 0, y: 7500, w: 2500, h: 2500 },
  "Bottom right": { x: 7500, y: 7500, w: 2500, h: 2500 },
};
export function pointInImage(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
) {
  const a = (-rotation * Math.PI) / 180;
  return {
    x: (x * Math.cos(a) - y * Math.sin(a)) / w + 0.5,
    y: (x * Math.sin(a) + y * Math.cos(a)) / h + 0.5,
  };
}
export function rectBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  const clamp = (v: number) =>
    Math.max(0, Math.min(10000, Math.round(v * 10000)));
  const x = clamp(Math.min(a.x, b.x)),
    y = clamp(Math.min(a.y, b.y));
  return {
    x,
    y,
    w: clamp(Math.max(a.x, b.x)) - x,
    h: clamp(Math.max(a.y, b.y)) - y,
  };
}
export function inspectionUrl(id: string, rect: Rect, rotation: number) {
  return (
    `/api/inspection/${id}?` +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(rect).map(([k, v]) => [k, String(v)]),
      ),
      rotation: String(rotation),
    })
  );
}
