/** Query-time inspect fallback. Does not recaption or write indexes. */

export type InspectVerdict = "match" | "no_match" | "uncertain";

export type InspectResult = {
  verdict: InspectVerdict;
  observation: string;
  checked: boolean;
};

export const RESEARCH_CHEAP_MODEL =
  "@cf/mistralai/mistral-small-3.1-24b-instruct";
export const RESEARCH_FALLBACK_MODEL = "openai/gpt-5.4";

/** Reviewed flags from docs/fallback-v1/review.json. Missing EXIF is not a flag. */
export const REVIEWED_INSPECT_FLAGS: Record<
  string,
  { sideways?: true; imageKind?: "document" | "map" }
> = {
  "mtl_archives_metadata_12519.json": { sideways: true },
  "mtl_archives_metadata_15507.json": { imageKind: "document" },
};

export function canonicalRecordId(id: string) {
  const name = id.trim();
  return name.endsWith(".json") ? name : `${name}.json`;
}

export function inspectFlagReasons(recordId: string) {
  const flags = REVIEWED_INSPECT_FLAGS[canonicalRecordId(recordId)];
  if (!flags) return [];
  const reasons: string[] = [];
  if (flags.sideways) reasons.push("reviewed_sideways");
  if (flags.imageKind === "document") reasons.push("kind_document");
  if (flags.imageKind === "map") reasons.push("kind_map");
  return reasons;
}

export function inspectEscalationReasons(
  cheap: InspectResult,
  recordId: string,
) {
  const reasons = inspectFlagReasons(recordId);
  if (!cheap.checked) reasons.push("cheap_failed");
  else if (cheap.verdict === "uncertain") reasons.push("cheap_uncertain");
  return reasons;
}

export function shouldEscalateInspect(cheap: InspectResult, recordId: string) {
  return inspectEscalationReasons(cheap, recordId).length > 0;
}

export function resolveInspectResult(
  cheap: InspectResult,
  fallback: InspectResult | null,
): InspectResult {
  if (fallback?.checked) return fallback;
  return cheap;
}
