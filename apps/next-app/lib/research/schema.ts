import { z } from "zod";
export const recordId = z
  .string()
  .regex(/^mtl_archives_metadata_\d+(?:\.json)?$/);
export const searchInput = z.object({
  query: z
    .string()
    .min(2)
    .max(240)
    .describe(
      "A complete standalone archive search, preserving relevant constraints from the conversation.",
    ),
  visualCriteria: z
    .string()
    .max(240)
    .nullable()
    .describe(
      "Visible objects and spatial relationships to check in candidate images. Use for multi-object requests; null for general browsing.",
    ),
  beforeYear: z
    .number()
    .int()
    .min(1800)
    .max(2100)
    .nullable()
    .describe(
      "Null unless the user explicitly asks for an upper date bound. Never invent a default.",
    ),
  afterYear: z
    .number()
    .int()
    .min(1800)
    .max(2100)
    .nullable()
    .describe(
      "Null unless the user explicitly asks for a lower date bound. Never invent a default.",
    ),
});
export type ArchivePhoto = {
  id: string;
  title: string | null;
  date: string | null;
  description: string | null;
  reference: string | null;
  sourceUrl: string | null;
  archiveUrl: string;
  imageUrl: string;
  caption: string | null;
  credits: string | null;
  visualCheck: {
    status: "match" | "uncertain" | "not_checked";
    observation: string;
  };
};
export type ArchiveCollection = {
  query: string;
  criteria: string | null;
  photos: ArchivePhoto[];
  searched: number;
  checked: number;
  excluded: number;
  degraded: boolean;
  note: string;
};
export function dateMatches(
  value: string | null,
  after: number | null,
  before: number | null,
) {
  if (after === null && before === null) return true;
  const years = value?.match(/\b(?:18|19|20)\d{2}(?=\b|s\b)/g)?.map(Number);
  if (!years?.length) return false;
  const min = Math.min(...years);
  let max = Math.max(...years);
  if (/(?:\d{3}0s\b|années\s+\d{3}0\b)/i.test(value ?? "")) max += 9;
  return (after === null || min >= after) && (before === null || max <= before);
}

export function hasRequestedDates(text: string) {
  return /\b(?:18|19|20)\d{2}(?=\b|s\b)|\b(?:century|siècle)\b/i.test(text);
}
