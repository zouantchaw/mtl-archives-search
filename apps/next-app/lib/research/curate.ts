import type { PhotoRecord } from "../types";

const USE_CONTEXT =
  /\b(hang|hung|hanged|wall|walls|frame|framed|print|prints|poster|décor|decor|decorative|look good|would look|high[-\s]?end|luxury|living room|above the (?:sofa|bed)|accrocher|accroché|mur|murs|cadre|tirage|décor|luxe|salon)\b/i;

const VENUE =
  /\b(hotel|hôtel|hotels|hôtels|lobby|lobbies|hall d['’]?hôtel)\b/i;

const DOCUMENT_KIND =
  /\b(document|map|plan|index|sheet|form|carte|documentaire)\b/i;

export const CURATE_QUERY =
  "Montreal streets architecture waterfront parks buildings";

/** Taste, print, or interior-use requests are not visible-object checks. */
export function isCuratorialIntent(text: string) {
  const t = text.trim();
  if (!t) return false;
  if (USE_CONTEXT.test(t)) return true;
  return VENUE.test(t) && /\b(good|wall|hang|décor|decor|luxe|mur|accroch)/i.test(t);
}

/** Hotel-as-venue must not become a search for hotel lobbies. */
export function curateSearchQuery(query: string, conversation = "") {
  const source = `${conversation} ${query}`;
  if (!isCuratorialIntent(source)) return query.trim();
  let next = query
    .replace(USE_CONTEXT, " ")
    .replace(VENUE, " ")
    .replace(/\b(photographs?|photos?|images?|photograph(?:ie)?s?)\b/gi, " ")
    .replace(/\b(that would be|good to|on the|in a|dans|sur|pour)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!next || next.length < 8 || VENUE.test(next)) return CURATE_QUERY;
  if (/^montreal$/i.test(next)) return CURATE_QUERY;
  return next;
}

export function shouldInspectVisualCriteria(
  visualCriteria: string | null,
  conversation: string,
  query: string,
) {
  if (!visualCriteria?.trim()) return false;
  return !isCuratorialIntent(`${conversation} ${query} ${visualCriteria}`);
}

export function isPrintUnsuitable(record: PhotoRecord) {
  const meta = record.searchMetadata;
  if (meta?.excludeFromDefaultVisualSearch) return true;
  if (meta?.qualityAction === "exclude_until_fixed") return true;
  const kind = [meta?.primaryCategory, ...(meta?.themes ?? []), ...(meta?.searchFacets ?? [])]
    .filter(Boolean)
    .join(" ");
  return DOCUMENT_KIND.test(kind);
}

/** Prefer ordinary photographs over maps/forms. Keep aerials; they can work as prints. */
export function curateRecords(records: PhotoRecord[], limit = 12) {
  const suitable = records.filter((r) => !isPrintUnsuitable(r));
  const pool = suitable.length ? suitable : records;
  return pool.slice(0, limit);
}
