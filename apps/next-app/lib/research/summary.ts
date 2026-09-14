import type { ArchiveCollection } from "./schema";
/** Display only claims supported by the tool result, never an LLM's recap. */
export function collectionSummary(
  collection: ArchiveCollection,
  lang: "en" | "fr",
) {
  const { photos, checked, criteria, searched } = collection;
  if (!criteria)
    return lang === "en"
      ? `Here are ${photos.length} candidate photographs for “${collection.query}”. They have not been visually checked.`
      : `Voici ${photos.length} photographies candidates pour « ${collection.query} ». Elles n’ont pas été vérifiées visuellement.`;
  const matches = photos.flatMap((p, i) =>
    p.visualCheck.status === "match" ? [i + 1] : [],
  );
  const failed = photos.filter((p) => p.visualCheck.status === "failed").length;
  const uncertain = photos.filter(
    (p) => p.visualCheck.status === "uncertain",
  ).length;
  const citations = matches
    .slice(0, 3)
    .map((n) => `[${n}]`)
    .join(", ");
  if (!checked || collection.degraded)
    return lang === "en"
      ? `No visual checks could be completed for these ${searched} search candidates. Treat the displayed photographs as unverified.`
      : `Aucune vérification visuelle n’a pu être menée parmi ces ${searched} résultats. Les photographies affichées restent à vérifier.`;
  if (lang === "en")
    return `${checked} candidate photographs were visually checked. ${matches.length ? `${matches.length} appear to match your description ${citations}.` : "None could be identified as a clear match."}${uncertain ? ` ${uncertain} displayed ${uncertain === 1 ? "photo needs" : "photos need"} a closer look.` : ""}${failed ? ` ${failed} check${failed === 1 ? "" : "s"} failed technically and ${failed === 1 ? "is" : "are"} not counted as ${failed === 1 ? "a match" : "matches"}.` : ""} This is an AI assessment of a small candidate set.`;
  return `${checked} photographies candidates ont été examinées visuellement. ${matches.length ? `${matches.length} semblent correspondre à votre description ${citations}.` : "Aucune correspondance claire n’a été identifiée."}${uncertain ? ` ${uncertain} photographie${uncertain > 1 ? "s" : ""} affichée${uncertain > 1 ? "s" : ""} reste${uncertain > 1 ? "nt" : ""} à examiner.` : ""}${failed ? ` ${failed} vérification${failed > 1 ? "s" : ""} a${failed > 1 ? "ont" : ""} échoué${failed > 1 ? "s" : ""} et n’est pas comptée comme correspondance.` : ""} Il s’agit d’une appréciation par IA sur un petit échantillon.`;
}

export function limitsSummary(reason: string, lang: "en" | "fr") {
  if (reason === "historical_change")
    return lang === "en"
      ? "These photographs can help locate visible details, but they cannot establish what changed over time or why. That would require dated photographs of the same places and historical sources documenting the change. Try a narrower search, such as streets with visible tram tracks."
      : "Ces photographies permettent de retrouver des détails visibles, mais ne suffisent pas à établir ce qui a changé ni pourquoi. Il faudrait des vues datées des mêmes lieux et des sources historiques documentant ce changement. Essayez une recherche plus précise, par exemple des rues avec des rails de tramway visibles.";
  return lang === "en"
    ? "I can find archive photographs, refine a search by visible details or documented dates, and examine a selected photograph. Try describing a subject, then open a photo to explore its archival record and AI visual observations."
    : "Je peux retrouver des photographies, affiner une recherche par détails visibles ou dates documentées, et examiner une photo sélectionnée. Décrivez un sujet, puis ouvrez une photo pour consulter sa notice et les observations visuelles par IA.";
}
