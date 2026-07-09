import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryFixedNowIso, datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_TAXONOMY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl',
);
const DEFAULT_QUALITY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
);
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl',
);
const DEFAULT_COLLECTIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
);
const DEFAULT_SCHEMA = path.resolve(MONOREPO_ROOT, 'docs/dataset-factory/label-schema.v0.json');
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_review_packets',
);
const DEFAULT_PUBLIC_R2_DOMAIN = 'pub-6a29793ea7664738880d1cc5afb21b87.r2.dev';
const DEFAULT_SEED = 'dataset-factory-v0-2026-06-28';
const RIGHTS_CHECKED_AT = '2026-06-28';
const LICENSE_ID = 'cc-by-4.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

type VlmMetadata = {
  caption?: string;
  scene_type?: string;
  visual_subjects?: string[];
  setting?: string;
  season?: string;
  aerial_ground_document?: string;
  search_terms?: string[];
  social_hook?: string;
  print_quality?: string;
  quality_notes?: string;
};

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  description?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  credits?: string;
  cote?: string;
  portal_match?: boolean;
  portal_record?: Record<string, unknown>;
  aerial_matches?: Array<{ dataset?: string; record?: Record<string, unknown> }>;
  metadata_quality?: { quality_flags?: string[]; description_source?: string };
  vlm_caption?: string | null;
  vlm_error?: string | null;
  vlm_metadata?: VlmMetadata | null;
  vlm_metadata_valid?: boolean;
  vlm_metadata_error?: string | null;
};

type TaxonomyRow = {
  id?: string;
  title?: string;
  date?: string;
  imageUrl?: string;
  imagePath?: string;
  primaryCategory?: string;
  primaryConfidence?: number;
  vantage?: string;
  mediaType?: string;
  themes?: string[];
  searchFacets?: string[];
  socialTags?: string[];
  productTags?: string[];
  reviewRequired?: boolean;
  excludeFromDefaultVisualSearch?: boolean;
};

type QualityRow = {
  id?: string;
  title?: string;
  date?: string;
  imageUrl?: string;
  imagePath?: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
  confidence?: number;
  notes?: string[];
};

type CandidateRow = {
  candidate_type?: string;
  rank?: number;
  id?: string;
  title?: string;
  date?: string;
  cote?: string;
  imageUrl?: string;
  imagePath?: string;
  score?: number;
  reasons?: string[];
  vlmCaption?: string | null;
  socialHook?: string | null;
};

type CollectionRow = {
  collection_id?: string;
  collection_title?: string;
  collection_type?: string;
  rank?: number;
  id?: string;
  score?: number;
  matchReasons?: string[];
};

type SourceRights = {
  source_system: 'montreal_open_data_ckan' | 'archives_montreal_atom' | 'r2_derivative' | 'unknown';
  package_slug: string | null;
  resource_id: string | null;
  source_url: string | null;
  license_id: string;
  license_url: string | null;
  credit_line: string;
  commercial_use_allowed: boolean;
  rights_checked_at: string;
  rights_notes: string;
};

type PacketRecord = {
  packet_id: string;
  seed: string;
  selected_at: string;
  strata: string[];
  selection_reasons: string[];
  label_schema_version: 'dataset_factory_label_v0';
  record: {
    id: string;
    title: string;
    description: string;
    date: string;
    cote: string;
    image_url: string;
    image_path: string;
    source_url: string;
    source: SourceRights;
  };
  source_metadata: {
    portal_match: boolean;
    portal_record: Record<string, unknown>;
    aerial_matches: ArchiveRecord['aerial_matches'];
    metadata_quality_flags: string[];
  };
  vlm: {
    caption: string;
    metadata: VlmMetadata | null;
    valid: boolean;
    error: string;
  };
  taxonomy: TaxonomyRow | null;
  quality: QualityRow | null;
  candidates: CandidateRow[];
  collections: CollectionRow[];
  evidence_placeholders: {
    observed: string[];
    metadata: string[];
    inferred: string[];
    verified: string[];
  };
  label_task: {
    instructions: string[];
    required_fields: string[];
  };
};

type SelectionState = {
  record: ArchiveRecord;
  strata: Set<string>;
  reasons: Set<string>;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filePath}:${index + 1}: ${message}`);
      }
    });
}

function writeJsonl<T>(filePath: string, rows: T[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function recordId(record: ArchiveRecord): string {
  return cleanText(record.metadata_filename);
}

function imagePath(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function imageUrl(record: ArchiveRecord, publicR2Domain: string, candidateRows: CandidateRow[], taxonomy?: TaxonomyRow): string {
  const candidateUrl = cleanText(candidateRows.find((row) => row.imageUrl)?.imageUrl);
  if (candidateUrl) return candidateUrl;
  if (publicR2Domain && imagePath(record)) {
    return `https://${publicR2Domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(imagePath(record))}`;
  }
  return cleanText(taxonomy?.imageUrl) || cleanText(record.external_url);
}

function sourceUrl(record: ArchiveRecord): string {
  return cleanText(record.external_url);
}

function attr(record: ArchiveRecord, key: string): string {
  return cleanText(record.attributes_map?.[key]);
}

function titleValue(record: ArchiveRecord, taxonomy?: TaxonomyRow, candidateRows: CandidateRow[] = []): string {
  return cleanText(record.name)
    || cleanText(taxonomy?.title)
    || cleanText(candidateRows.find((row) => row.title)?.title)
    || recordId(record);
}

function dateValue(record: ArchiveRecord, taxonomy?: TaxonomyRow, candidateRows: CandidateRow[] = []): string {
  return attr(record, 'Date')
    || cleanText(taxonomy?.date)
    || cleanText(candidateRows.find((row) => row.date)?.date);
}

function coteValue(record: ArchiveRecord, candidateRows: CandidateRow[] = []): string {
  const aerial = record.aerial_matches?.[0]?.record;
  return cleanText(record.cote)
    || attr(record, 'Cote')
    || cleanText(record.portal_record?.Cote)
    || cleanText(aerial?.['Cote/Titre'])
    || cleanText(aerial?.['Cote (reportage)'])
    || cleanText(candidateRows.find((row) => row.cote)?.cote);
}

function metadataQualityFlags(record: ArchiveRecord): string[] {
  return Array.isArray(record.metadata_quality?.quality_flags) ? record.metadata_quality.quality_flags.map(cleanText).filter(Boolean) : [];
}

function sourceCredit(record: ArchiveRecord): string {
  const aerialCredit = cleanText(record.aerial_matches?.[0]?.record?.['Mention de crédits']);
  return cleanText(record.credits) || attr(record, 'Credits') || aerialCredit || 'Archives de la Ville de Montréal';
}

function sourceDataset(record: ArchiveRecord): string {
  return cleanText(record.aerial_matches?.[0]?.dataset);
}

function sourceRights(record: ArchiveRecord): SourceRights {
  const url = sourceUrl(record);
  const dataset = sourceDataset(record);
  const date = dateValue(record);
  const lowerUrl = url.toLowerCase();
  let packageSlug: string | null = null;
  let resourceId: string | null = null;
  let notes = 'CKAN package is CC BY 4.0; package notes require Archives de la Ville de Montréal credit.';

  if (lowerUrl.includes('phototheque-archives')) {
    packageSlug = 'phototheque-archives';
    resourceId = '41f0cec9-2110-452e-a93d-8f29190ee2ae';
  } else if (lowerUrl.includes('vues-aeriennes-archives') || dataset === 'aerial_1947_1949') {
    packageSlug = 'vues-aeriennes-archives';
    resourceId = '09a0893e-3142-4950-8c54-1250540bde13';
  } else if (lowerUrl.includes('vues-aeriennes-obliques') || dataset === 'aerial_obliques_1960_1992') {
    packageSlug = 'vues-aeriennes-obliques-de-l-ile-de-montreal-1960-1992';
    resourceId = '0ef12a2f-da90-49fb-8c46-89024edece54';
    notes = 'CKAN package is CC BY 4.0; oblique rows may require cote and photographer in the credit line when available.';
  } else if (lowerUrl.includes('vues-aeriennes-1958') || date === '1958') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = '9ab0c8c1-f4f3-4ea9-b6d5-d10018cebda2';
  } else if (lowerUrl.includes('vues-aeriennes-1962') || date === '1962') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = 'eff33c42-bad4-4d8c-9059-28e4b425b7e2';
  } else if (lowerUrl.includes('vues-aeriennes-1964') || date === '1964') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = 'c6e12ed5-8a9d-4559-a96c-f50689a41c44';
  } else if (lowerUrl.includes('vues-aeriennes-1966') || date === '1966') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = '379921f4-1991-4a08-b900-0a72453ae28a';
  } else if (lowerUrl.includes('vues-aeriennes-1969') || date === '1969') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = 'd3206ff5-4e40-4713-abda-0fd498bbffb3';
  } else if (lowerUrl.includes('vues-aeriennes-1971') || date === '1971') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = 'd259d85d-a7ac-4ebd-8843-2ac6fd611017';
  } else if (lowerUrl.includes('vues-aeriennes-1973') || date === '1973') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = '78395826-e67e-467b-a017-29b03a156aa8';
  } else if (lowerUrl.includes('vues-aeriennes-1975') || date === '1975') {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    resourceId = '2df16f9d-663c-48a2-9f53-5a58be1d85b5';
  }

  return {
    source_system: packageSlug ? 'montreal_open_data_ckan' : 'unknown',
    package_slug: packageSlug,
    resource_id: resourceId,
    source_url: url || null,
    license_id: packageSlug ? LICENSE_ID : 'unknown',
    license_url: packageSlug ? LICENSE_URL : null,
    credit_line: sourceCredit(record),
    commercial_use_allowed: Boolean(packageSlug),
    rights_checked_at: RIGHTS_CHECKED_AT,
    rights_notes: packageSlug ? notes : 'Source package not recognized by Dataset Factory v0 rights mapper.',
  };
}

function textForRecord(record: ArchiveRecord, taxonomy?: TaxonomyRow): string {
  const metadata = record.vlm_metadata;
  return normalize([
    record.name,
    record.description,
    record.vlm_caption,
    metadata?.caption,
    metadata?.scene_type,
    metadata?.setting,
    metadata?.season,
    metadata?.aerial_ground_document,
    metadata?.quality_notes,
    taxonomy?.primaryCategory,
    taxonomy?.vantage,
    taxonomy?.mediaType,
    ...(metadata?.visual_subjects ?? []),
    ...(metadata?.search_terms ?? []),
    ...(taxonomy?.themes ?? []),
    ...(taxonomy?.socialTags ?? []),
    ...(taxonomy?.productTags ?? []),
  ].filter(Boolean).join(' '));
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function hasGroundOrHumanLegibleSignal(record: ArchiveRecord, taxonomy?: TaxonomyRow): boolean {
  const text = textForRecord(record, taxonomy);
  const category = normalize(taxonomy?.primaryCategory);
  const vantage = normalize(taxonomy?.vantage);
  const mediaType = normalize(taxonomy?.mediaType);
  if (vantage && vantage !== 'aerial' && vantage !== 'unknown') return true;
  if (mediaType === 'document') return false;
  if (['ground_photo', 'street_commercial', 'people_event', 'civic_institutional', 'ground_transit'].includes(category)) return true;
  return matchesAny(text, [
    'street',
    'store',
    'shop',
    'market',
    'people',
    'children',
    'classroom',
    'school',
    'church',
    'hospital',
    'building facade',
    'interior',
    'tram',
    'streetcar',
    'sign',
    'advertisement',
    'commerce',
  ]);
}

function isHardCase(record: ArchiveRecord, taxonomy?: TaxonomyRow, quality?: QualityRow): boolean {
  const qualityLabels = quality?.labels ?? [];
  const metadataFlags = metadataQualityFlags(record);
  return Boolean(
    qualityLabels.length > 0
      || cleanText(quality?.recommendedAction) && cleanText(quality?.recommendedAction) !== 'none'
      || ['medium', 'high'].includes(cleanText(quality?.severity))
      || taxonomy?.reviewRequired
      || (taxonomy?.primaryConfidence ?? 1) < 0.45
      || normalize(taxonomy?.primaryCategory) === 'uncertain'
      || cleanText(record.vlm_error)
      || cleanText(record.vlm_metadata_error)
      || metadataFlags.some((flag) => ['synthetic-description', 'missing-description', 'code-like-title'].includes(flag)),
  );
}

function activeLearningScore(record: ArchiveRecord, taxonomy?: TaxonomyRow, quality?: QualityRow, candidates: CandidateRow[] = []): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const confidence = taxonomy?.primaryConfidence ?? 0.5;
  if (confidence < 0.35) {
    score += 4;
    reasons.push(`low taxonomy confidence ${confidence.toFixed(2)}`);
  } else if (confidence < 0.6) {
    score += 2;
    reasons.push(`medium taxonomy confidence ${confidence.toFixed(2)}`);
  }
  if (taxonomy?.reviewRequired) {
    score += 3;
    reasons.push('taxonomy review required');
  }
  if (quality?.labels?.length) {
    score += 2;
    reasons.push(`quality labels: ${quality.labels.join(', ')}`);
  }
  if (cleanText(quality?.recommendedAction) && cleanText(quality?.recommendedAction) !== 'none') {
    score += 2;
    reasons.push(`quality action ${quality?.recommendedAction}`);
  }
  if (cleanText(record.vlm_error) || cleanText(record.vlm_metadata_error)) {
    score += 1.5;
    reasons.push('VLM error present');
  }
  const metadataFlags = metadataQualityFlags(record);
  if (metadataFlags.length) {
    score += Math.min(2, metadataFlags.length * 0.5);
    reasons.push(`metadata flags: ${metadataFlags.join(', ')}`);
  }
  if (candidates.length) {
    score += 1;
    reasons.push(`candidate overlap: ${Array.from(new Set(candidates.map((row) => row.candidate_type).filter(Boolean))).join(', ')}`);
  }
  return { score, reasons };
}

function appendSelection(
  selections: Map<string, SelectionState>,
  record: ArchiveRecord,
  stratum: string,
  reason: string,
): void {
  const id = recordId(record);
  if (!id) return;
  const existing = selections.get(id) ?? { record, strata: new Set<string>(), reasons: new Set<string>() };
  existing.strata.add(stratum);
  existing.reasons.add(reason);
  selections.set(id, existing);
}

function byId<T extends { id?: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = cleanText(row.id);
    if (id) map.set(id, row);
  }
  return map;
}

function groupById<T extends { id?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = cleanText(row.id);
    if (!id) continue;
    const current = map.get(id) ?? [];
    current.push(row);
    map.set(id, current);
  }
  return map;
}

function sortedById(records: ArchiveRecord[]): ArchiveRecord[] {
  return [...records].sort((a, b) => recordId(a).localeCompare(recordId(b)));
}

function takeRandom(records: ArchiveRecord[], limit: number, rng: () => number): ArchiveRecord[] {
  return shuffled(sortedById(records), rng).slice(0, limit);
}

function takeCandidateSample(candidateRows: CandidateRow[], recordMap: Map<string, ArchiveRecord>, limitPerType: number): Array<{ record: ArchiveRecord; reason: string }> {
  const byType = new Map<string, CandidateRow[]>();
  for (const row of candidateRows) {
    const type = cleanText(row.candidate_type) || 'candidate';
    const group = byType.get(type) ?? [];
    group.push(row);
    byType.set(type, group);
  }
  const selected: Array<{ record: ArchiveRecord; reason: string }> = [];
  for (const [type, rows] of Array.from(byType.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...rows].sort((a, b) => (a.rank ?? 999999) - (b.rank ?? 999999)).slice(0, limitPerType);
    for (const row of ranked) {
      const record = recordMap.get(cleanText(row.id));
      if (record) selected.push({ record, reason: `${type} candidate rank ${row.rank ?? 'n/a'}` });
    }
  }
  return selected;
}

function takeTaxonomySpread(
  records: ArchiveRecord[],
  taxonomyById: Map<string, TaxonomyRow>,
  limit: number,
  rng: () => number,
): Array<{ record: ArchiveRecord; reason: string }> {
  const groups = new Map<string, ArchiveRecord[]>();
  for (const record of records) {
    const taxonomy = taxonomyById.get(recordId(record));
    const category = cleanText(taxonomy?.primaryCategory) || 'missing_taxonomy';
    const group = groups.get(category) ?? [];
    group.push(record);
    groups.set(category, group);
  }
  const categories = Array.from(groups.keys()).sort();
  const perCategory = Math.max(1, Math.ceil(limit / Math.max(1, categories.length)));
  const selected: Array<{ record: ArchiveRecord; reason: string }> = [];
  for (const category of categories) {
    const sample = takeRandom(groups.get(category) ?? [], perCategory, rng);
    for (const record of sample) selected.push({ record, reason: `taxonomy category ${category}` });
  }
  return selected.slice(0, limit);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath: string, rows: PacketRecord[]): void {
  const headers = [
    'packet_id',
    'record_id',
    'strata',
    'title',
    'date',
    'cote',
    'package_slug',
    'license_id',
    'credit_line',
    'commercial_use_allowed',
    'primary_category',
    'primary_confidence',
    'quality_action',
    'quality_labels',
    'candidate_types',
    'review_flags',
    'image_url',
    'source_url',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const candidateTypes = Array.from(new Set(row.candidates.map((candidate) => cleanText(candidate.candidate_type)).filter(Boolean)));
    const reviewFlags = [
      ...row.source_metadata.metadata_quality_flags,
      ...(row.quality?.labels ?? []),
      ...(row.taxonomy?.reviewRequired ? ['taxonomy_review_required'] : []),
    ];
    lines.push([
      row.packet_id,
      row.record.id,
      row.strata.join('|'),
      row.record.title,
      row.record.date,
      row.record.cote,
      row.record.source.package_slug,
      row.record.source.license_id,
      row.record.source.credit_line,
      row.record.source.commercial_use_allowed,
      row.taxonomy?.primaryCategory ?? '',
      row.taxonomy?.primaryConfidence ?? '',
      row.quality?.recommendedAction ?? '',
      (row.quality?.labels ?? []).join('|'),
      candidateTypes.join('|'),
      reviewFlags.join('|'),
      row.record.image_url,
      row.record.source_url,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

function renderContactSheet(rows: PacketRecord[]): string {
  const cards = rows.map((row) => {
    const candidates = Array.from(new Set(row.candidates.map((candidate) => cleanText(candidate.candidate_type)).filter(Boolean))).join(', ');
    const flags = [
      ...row.source_metadata.metadata_quality_flags,
      ...(row.quality?.labels ?? []),
      ...(row.taxonomy?.reviewRequired ? ['taxonomy_review_required'] : []),
    ].filter(Boolean).join(', ');
    return `
      <article class="card">
        <img src="${row.record.image_url}" alt="${escapeHtml(row.record.title)}" loading="lazy">
        <div class="body">
          <div class="id">${escapeHtml(row.record.id)}</div>
          <h2>${escapeHtml(row.record.title || row.record.id)}</h2>
          <p>${escapeHtml(row.record.date || 'undated')} · ${escapeHtml(row.taxonomy?.primaryCategory ?? 'no taxonomy')}</p>
          <p><strong>Strata:</strong> ${escapeHtml(row.strata.join(', '))}</p>
          <p><strong>Quality:</strong> ${escapeHtml(row.quality?.recommendedAction ?? 'n/a')} ${escapeHtml((row.quality?.labels ?? []).join(', '))}</p>
          <p><strong>Candidates:</strong> ${escapeHtml(candidates || 'none')}</p>
          <p><strong>Flags:</strong> ${escapeHtml(flags || 'none')}</p>
          <p class="credit">${escapeHtml(row.record.source.credit_line)}</p>
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MTL Archives Dataset Factory Review Packet</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f4ef; color: #1d1d1b; }
    header { position: sticky; top: 0; z-index: 1; padding: 16px 20px; background: rgba(246,244,239,.94); border-bottom: 1px solid #d8d2c4; backdrop-filter: blur(12px); }
    h1 { margin: 0 0 4px; font-size: 18px; }
    header p { margin: 0; color: #666; font-size: 13px; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 16px; }
    .card { background: #fff; border: 1px solid #ddd7ca; border-radius: 8px; overflow: hidden; }
    img { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: #eee9dd; display: block; }
    .body { padding: 12px; }
    h2 { margin: 4px 0 8px; font-size: 15px; line-height: 1.25; }
    p { margin: 6px 0; font-size: 12px; line-height: 1.35; }
    .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #777; font-size: 11px; }
    .credit { color: #777; border-top: 1px solid #eee; padding-top: 8px; margin-top: 10px; }
  </style>
</head>
<body>
  <header>
    <h1>MTL Archives Dataset Factory Review Packet</h1>
    <p>${rows.length} records · generated for Codex/human review · images load from source/R2 URLs</p>
  </header>
  <main>${cards}</main>
</body>
</html>
`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function artifactInfo(filePath: string): { path: string; exists: boolean; size_bytes: number | null; mtime: string | null } {
  if (!fs.existsSync(filePath)) {
    return { path: path.relative(MONOREPO_ROOT, filePath), exists: false, size_bytes: null, mtime: null };
  }
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(MONOREPO_ROOT, filePath),
    exists: true,
    size_bytes: stat.size,
    mtime: datasetFactoryFixedNowIso() ?? stat.mtime.toISOString(),
  };
}

function toPacketRecord(
  state: SelectionState,
  packetIndex: number,
  seed: string,
  selectedAt: string,
  taxonomyById: Map<string, TaxonomyRow>,
  qualityById: Map<string, QualityRow>,
  candidatesById: Map<string, CandidateRow[]>,
  collectionsById: Map<string, CollectionRow[]>,
  publicR2Domain: string,
): PacketRecord {
  const id = recordId(state.record);
  const taxonomy = taxonomyById.get(id) ?? null;
  const quality = qualityById.get(id) ?? null;
  const candidates = candidatesById.get(id) ?? [];
  const collections = collectionsById.get(id) ?? [];
  const source = sourceRights(state.record);
  const imageUrlValue = imageUrl(state.record, publicR2Domain, candidates, taxonomy ?? undefined);
  const sourceUrlValue = sourceUrl(state.record);
  return {
    packet_id: `dfv0-${String(packetIndex + 1).padStart(4, '0')}`,
    seed,
    selected_at: selectedAt,
    strata: Array.from(state.strata).sort(),
    selection_reasons: Array.from(state.reasons).sort(),
    label_schema_version: 'dataset_factory_label_v0',
    record: {
      id,
      title: titleValue(state.record, taxonomy ?? undefined, candidates),
      description: cleanText(state.record.description),
      date: dateValue(state.record, taxonomy ?? undefined, candidates),
      cote: coteValue(state.record, candidates),
      image_url: imageUrlValue,
      image_path: imagePath(state.record) || cleanText(taxonomy?.imagePath),
      source_url: sourceUrlValue,
      source,
    },
    source_metadata: {
      portal_match: Boolean(state.record.portal_match),
      portal_record: state.record.portal_record ?? {},
      aerial_matches: state.record.aerial_matches ?? [],
      metadata_quality_flags: metadataQualityFlags(state.record),
    },
    vlm: {
      caption: cleanText(state.record.vlm_caption || state.record.vlm_metadata?.caption),
      metadata: state.record.vlm_metadata ?? null,
      valid: Boolean(state.record.vlm_metadata_valid),
      error: cleanText(state.record.vlm_error || state.record.vlm_metadata_error),
    },
    taxonomy,
    quality,
    candidates,
    collections,
    evidence_placeholders: {
      observed: ['Describe only visible image facts. Do not use source metadata in this bucket.'],
      metadata: ['Copy source-backed title/date/cote/credit/location claims here with source_field references.'],
      inferred: ['Add reviewer/model inferences here with confidence and review flags.'],
      verified: ['Only add claims checked against an external URL/source.'],
    },
    label_task: {
      instructions: [
        'Fill labels according to docs/dataset-factory/label-ontology.md.',
        'Keep observed, metadata, inferred, and verified claims separate.',
        'Preserve rights/source fields when writing label rows.',
      ],
      required_fields: [
        'human_legible',
        'story_value',
        'print_value',
        'partner_fit',
        'search_value',
        'quality_action',
        'geo_time_extractable',
        'provenance_depth',
        'commercial_surface',
      ],
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      quality: { type: 'string', default: DEFAULT_QUALITY },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      schema: { type: 'string', default: DEFAULT_SCHEMA },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      seed: { type: 'string', default: DEFAULT_SEED },
      'limit-per-stratum': { type: 'string', default: '12' },
      'candidate-per-type': { type: 'string', default: '8' },
      'taxonomy-spread-limit': { type: 'string', default: '30' },
      'public-r2-domain': { type: 'string', default: DEFAULT_PUBLIC_R2_DOMAIN },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const taxonomyPath = resolveRepoPath(values.taxonomy!);
  const qualityPath = resolveRepoPath(values.quality!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const collectionsPath = resolveRepoPath(values.collections!);
  const schemaPath = resolveRepoPath(values.schema!);
  const outputDir = resolveRepoPath(values.output!);
  const seed = values.seed!;
  const rng = makeRng(seed);
  const limitPerStratum = Math.max(1, Number(values['limit-per-stratum'] ?? 12));
  const candidatePerType = Math.max(1, Number(values['candidate-per-type'] ?? 8));
  const taxonomySpreadLimit = Math.max(1, Number(values['taxonomy-spread-limit'] ?? 30));
  const publicR2Domain = cleanText(values['public-r2-domain']);
  requireArtifacts([
    { path: manifestPath, label: 'VLM structured manifest' },
    { path: taxonomyPath, label: 'taxonomy downstream rows' },
    { path: qualityPath, label: 'image-quality labels' },
    { path: candidatesPath, label: 'candidate downstream rows' },
    { path: collectionsPath, label: 'collection downstream rows' },
    { path: schemaPath, label: 'Dataset Factory label schema' },
  ]);

  const records = readJsonl<ArchiveRecord>(manifestPath).filter((record) => Boolean(recordId(record)));
  const taxonomyRows = readJsonl<TaxonomyRow>(taxonomyPath);
  const qualityRows = readJsonl<QualityRow>(qualityPath);
  const candidateRows = readJsonl<CandidateRow>(candidatesPath);
  const collectionRows = readJsonl<CollectionRow>(collectionsPath);

  const recordMap = new Map(records.map((record) => [recordId(record), record] as const));
  const taxonomyById = byId(taxonomyRows);
  const qualityById = byId(qualityRows);
  const candidatesById = groupById(candidateRows);
  const collectionsById = groupById(collectionRows);
  const selections = new Map<string, SelectionState>();

  for (const record of takeRandom(records, limitPerStratum, rng)) {
    appendSelection(selections, record, 'random', 'deterministic random sample');
  }

  const humanLegible = takeRandom(
    records.filter((record) => hasGroundOrHumanLegibleSignal(record, taxonomyById.get(recordId(record)))),
    limitPerStratum,
    rng,
  );
  for (const record of humanLegible) {
    appendSelection(selections, record, 'human_legible', 'ground/human-legible visual signal');
  }

  const hardCases = takeRandom(
    records.filter((record) => isHardCase(record, taxonomyById.get(recordId(record)), qualityById.get(recordId(record)))),
    limitPerStratum,
    rng,
  );
  for (const record of hardCases) {
    appendSelection(selections, record, 'hard_case', 'quality/taxonomy/VLM uncertainty signal');
  }

  for (const { record, reason } of takeCandidateSample(candidateRows, recordMap, candidatePerType)) {
    appendSelection(selections, record, 'candidate', reason);
  }

  for (const { record, reason } of takeTaxonomySpread(records, taxonomyById, taxonomySpreadLimit, rng)) {
    appendSelection(selections, record, 'taxonomy_spread', reason);
  }

  const activeLearningRanked = records
    .map((record) => {
      const id = recordId(record);
      const scored = activeLearningScore(record, taxonomyById.get(id), qualityById.get(id), candidatesById.get(id) ?? []);
      return { record, ...scored };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || recordId(a.record).localeCompare(recordId(b.record)))
    .slice(0, limitPerStratum);

  for (const row of activeLearningRanked) {
    appendSelection(selections, row.record, 'active_learning_queue', row.reasons.join('; '));
  }

  const selectedAt = datasetFactoryNowIso();
  const packetRows = Array.from(selections.values())
    .sort((a, b) => recordId(a.record).localeCompare(recordId(b.record)))
    .map((state, index) => toPacketRecord(
      state,
      index,
      seed,
      selectedAt,
      taxonomyById,
      qualityById,
      candidatesById,
      collectionsById,
      publicR2Domain,
    ));

  fs.mkdirSync(outputDir, { recursive: true });
  const strataDir = path.join(outputDir, 'strata');
  fs.mkdirSync(strataDir, { recursive: true });

  writeJsonl(path.join(outputDir, 'review_packet.jsonl'), packetRows);
  writeCsv(path.join(outputDir, 'review_packet.csv'), packetRows);
  fs.writeFileSync(path.join(outputDir, 'contact_sheet.html'), renderContactSheet(packetRows), 'utf-8');

  const strata = Array.from(new Set(packetRows.flatMap((row) => row.strata))).sort();
  for (const stratum of strata) {
    writeJsonl(path.join(strataDir, `${stratum}.jsonl`), packetRows.filter((row) => row.strata.includes(stratum)));
  }

  const manifest = {
    generated_at: selectedAt,
    seed,
    limits: {
      limit_per_stratum: limitPerStratum,
      candidate_per_type: candidatePerType,
      taxonomy_spread_limit: taxonomySpreadLimit,
    },
    input_counts: {
      manifest_records: records.length,
      taxonomy_rows: taxonomyRows.length,
      quality_rows: qualityRows.length,
      candidate_rows: candidateRows.length,
      collection_rows: collectionRows.length,
    },
    output_counts: {
      selected_records: packetRows.length,
      by_stratum: Object.fromEntries(strata.map((stratum) => [stratum, packetRows.filter((row) => row.strata.includes(stratum)).length])),
    },
    artifacts: [
      artifactInfo(manifestPath),
      artifactInfo(taxonomyPath),
      artifactInfo(qualityPath),
      artifactInfo(candidatesPath),
      artifactInfo(collectionsPath),
      artifactInfo(schemaPath),
    ],
    outputs: {
      jsonl: path.relative(MONOREPO_ROOT, path.join(outputDir, 'review_packet.jsonl')),
      csv: path.relative(MONOREPO_ROOT, path.join(outputDir, 'review_packet.csv')),
      contact_sheet: path.relative(MONOREPO_ROOT, path.join(outputDir, 'contact_sheet.html')),
      strata_dir: path.relative(MONOREPO_ROOT, strataDir),
    },
  };
  fs.writeFileSync(path.join(outputDir, 'packet_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`Wrote ${packetRows.length} review packet rows to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  for (const [stratum, count] of Object.entries(manifest.output_counts.by_stratum)) {
    console.log(`- ${stratum}: ${count}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
