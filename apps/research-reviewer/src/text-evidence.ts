// Shared inspection plan: normalized coordinates in the EXIF-normalized scan.
// Overlap protects writing that straddles a tile boundary. No image-specific ROI.
export const textRegions = [
  ["Top left", 0, 0],
  ["Top", 3150, 0],
  ["Top right", 6300, 0],
  ["Left", 0, 3150],
  ["Center", 3150, 3150],
  ["Right", 6300, 3150],
  ["Bottom left", 0, 6300],
  ["Bottom", 3150, 6300],
  ["Bottom right", 6300, 6300],
].map(([label, x, y]) => ({
  label: String(label),
  rect: { x: Number(x), y: Number(y), w: 3700, h: 3700 },
}));
export type TextEvidence = {
  status: "text_candidates" | "unclear" | "none_detected";
  candidates: {
    text: string;
    location: string;
    kind: "scene" | "annotation" | "watermark" | "unknown";
    uncertain: boolean;
  }[];
};
export const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const SECOND_READER = "@cf/qwen/qwen3.8-27b";
export const TEXT_PROMPT_VERSION = "mtl-text-regions-v1";
export const TEXT_PROMPT =
  'Inspect this region of a historical scan for visible words, handwritten numbers, marginal annotations and watermarks. Writing can run sideways or upside down. Return JSON only: {"status":"text_candidates"|"unclear"|"none_detected","candidates":[{"text":"literal characters, ? for unreadable parts","location":"position within this region","kind":"scene"|"annotation"|"watermark"|"unknown","uncertain":true|false}]}. At most 4 candidates. Do not infer place names, dates or unseen characters. An empty result means only nothing was detected in this region, not proof there is no text. Do not describe the landscape.';
export function parseTextEvidence(answer: string): TextEvidence {
  const x = JSON.parse(
    answer
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  if (
    !x ||
    !["text_candidates", "unclear", "none_detected"].includes(x.status) ||
    !Array.isArray(x.candidates) ||
    x.candidates.length > 4
  )
    throw Error("MODEL_OUTPUT_UNRELIABLE");
  for (const c of x.candidates) {
    if (
      !c ||
      typeof c.text !== "string" ||
      !c.text.trim() ||
      c.text.length > 300 ||
      typeof c.location !== "string" ||
      c.location.length > 180 ||
      !["scene", "annotation", "watermark", "unknown"].includes(c.kind) ||
      typeof c.uncertain !== "boolean"
    )
      throw Error("MODEL_OUTPUT_UNRELIABLE");
  }
  if ((x.status === "text_candidates") !== x.candidates.length > 0)
    throw Error("MODEL_OUTPUT_UNRELIABLE");
  return x;
}
