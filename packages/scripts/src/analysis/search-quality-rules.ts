export type SearchQualityLabel = 'photo_likely' | 'document_likely' | 'unknown';

const DOC_KEYWORDS = [
  'document', 'dossier', 'registre', 'rapport', 'lettre', 'formulaire', 'tableau', 'newspaper', 'journal', 'article',
  'plan', 'blueprint', 'carte', 'map', 'dessin', 'drawing', 'gravure', 'poster', 'affiche', 'acte', 'certificat',
  'invoice', 'facture', 'catalogue', 'index', 'texte', 'typed', 'manuscrit', 'manuscript', 'page', 'texte imprim',
];

const PHOTO_KEYWORDS = [
  'photo', 'photographie', 'vue', 'street', 'rue', 'parc', 'avenue', 'boulevard', 'église', 'church', 'pont', 'bridge',
  'bâtiment', 'building', 'façade', 'aerial', 'tramway', 'car', 'voiture', 'neige', 'hiver', 'neighborhood', 'quartier',
];

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenScore(haystack: string, keywords: string[]) {
  let score = 0;
  for (const word of keywords) {
    if (haystack.includes(word)) score += 1;
  }
  return score;
}

function buildText(record: any) {
  return [
    cleanText(record.name),
    cleanText(record.description),
    cleanText(record.portal_record?.Titre),
    cleanText(record.portal_record?.Description),
    cleanText(record.vlm_caption),
  ].join(' ');
}

export function classifySearchQualityRecord(record: any): {
  label: SearchQualityLabel;
  docScore: number;
  photoScore: number;
} {
  const text = buildText(record);
  const docScore = tokenScore(text, DOC_KEYWORDS);
  const photoScore = tokenScore(text, PHOTO_KEYWORDS);

  if (docScore >= 2 && docScore > photoScore) {
    return { label: 'document_likely', docScore, photoScore };
  }
  if (photoScore >= 1 && photoScore >= docScore) {
    return { label: 'photo_likely', docScore, photoScore };
  }
  return { label: 'unknown', docScore, photoScore };
}
