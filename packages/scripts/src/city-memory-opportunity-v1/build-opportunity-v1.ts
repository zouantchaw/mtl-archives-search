import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DEFAULT_VOCABULARY,
  asStringArray,
  clean,
  first,
  firstNumber,
  nested,
  normalized,
  readJsonLines,
  writeCsv,
  writeJson,
  writeJsonl,
  type CandidatePoolRow,
  type GenericRow,
  type GrainName,
  type GrainSummary,
  type InputPaths,
  type JoinReceipt,
  type OpportunityBuildResult,
  type OpportunityCrosswalkRow,
  type PlaceEvidence,
  type PlaceVocabulary,
} from './model.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../../');
const DEFAULT_DATA_ROOT = path.join(REPO_ROOT, 'data/mtl_archives');
const GRAIN_NAMES: GrainName[] = ['canonical_scored', 'vlm', 'taxonomy', 'geocode', 'ocr', 'date', 'aerial', 'visual_family'];

const RELATIVE_DEFAULTS: Record<GrainName, string[]> = {
  canonical_scored: ['manifest_scored.jsonl', 'manifest_scored.jsonl.gz', 'manifest_enriched.ndjson', 'export/manifest_enriched.ndjson', 'manifest_clean.jsonl.gz'],
  vlm: ['reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl', 'manifest_vlm_complete.jsonl', 'reports/autoresearch_vlm_full/manifest_vlm_complete.jsonl', 'manifest_enriched.ndjson', 'export/manifest_enriched.ndjson'],
  taxonomy: ['reports/autoresearch_taxonomy/taxonomy_labels.jsonl', 'reports/autoresearch_taxonomy/taxonomy_downstream.jsonl', 'taxonomy_labels.jsonl'],
  geocode: ['manifest_geocoded.jsonl', 'manifest_geocoded.jsonl.gz'],
  ocr: ['manifest_ocr.jsonl', 'manifest_ocr.jsonl.gz'],
  date: ['manifest_dated.jsonl', 'manifest_dated.jsonl.gz'],
  aerial: ['manifest_aerial.jsonl', 'manifest_aerial.jsonl.gz'],
  visual_family: ['reports/visual_family_graph_v1/record-family-map-v1.jsonl', 'reports/visual_family_graph_v1/record-leakage-map-v1.jsonl', 'reports/visual_family_graph_v0/visual-family-graph-v0-record-family-map.jsonl'],
};

const ID_KEYS = ['metadata_filename', 'record_id', 'recordId', 'record_link_id', 'identity', 'source_record_id', 'sourceRecordId', 'id'];

function resolvePath(dataRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(dataRoot, value);
}

function existingFirst(dataRoot: string, candidates: string[], excluded: string[] = []): string | null {
  const blocked = new Set(excluded.map((file) => path.resolve(file)));
  for (const candidate of candidates) {
    const resolved = resolvePath(dataRoot, candidate);
    if (fs.existsSync(resolved) && !blocked.has(resolved)) return resolved;
  }
  return null;
}

export function resolveInputPaths(dataRoot: string, overrides: Partial<Record<GrainName, string>> = {}): InputPaths {
  const paths: InputPaths = { dataRoot: path.resolve(dataRoot) };
  for (const grain of GRAIN_NAMES) {
    const override = overrides[grain];
    if (override) paths[grain] = resolvePath(paths.dataRoot, override);
  }
  for (const grain of GRAIN_NAMES) {
    if (!paths[grain]) {
      const canonical = paths.canonical_scored;
      const excluded = grain === 'canonical_scored' ? [] : canonical ? [canonical] : [];
      paths[grain] = existingFirst(paths.dataRoot, RELATIVE_DEFAULTS[grain], excluded) ?? undefined;
    }
  }
  return paths;
}

function pathLabel(filePath: string | undefined): string | null {
  return filePath ? filePath.split(path.sep).join('/') : null;
}

function aliasFromFilename(value: unknown): string | null {
  const text = clean(value).split(/[?#]/)[0];
  const base = text.slice(text.lastIndexOf('/') + 1).toLowerCase();
  return base || null;
}

function metadataId(value: unknown): string | null {
  const text = clean(value);
  if (/^mtl_archives_metadata_[^/]+\.json$/i.test(text)) return text;
  const base = aliasFromFilename(text);
  return base && /^mtl_archives_metadata_[^/]+\.json$/i.test(base) ? base : null;
}

function sourceUrl(row: GenericRow): string | null {
  const portal = nested(row, 'portal_record');
  const value = first(row, ['external_url', 'source_url', 'original_url', 'image_url', 'url']) ?? first(portal, ['Fichier jpg - 200 dpi', 'Fichier tif - 300 dpi']);
  return clean(value) || null;
}

export function aliases(row: GenericRow): Array<{ alias: string; method: JoinReceipt['method'] }> {
  const output: Array<{ alias: string; method: JoinReceipt['method'] }> = [];
  const push = (value: unknown, method: JoinReceipt['method']): void => { const text = clean(value); if (text) output.push({ alias: text.toLowerCase(), method }); };
  for (const key of ID_KEYS) {
    const value = first(row, [key]);
    const id = metadataId(value);
    if (value !== undefined && value !== null) push(id ?? value, key === 'metadata_filename' ? 'metadata_filename' : key.includes('record') || key === 'identity' ? 'record_id' : 'source_record_id');
  }
  const portal = nested(row, 'portal_record');
  const portalId = first(portal, ['_id', 'id']);
  if (portalId !== undefined) push(`portal:${clean(portalId)}`, 'source_record_id');
  const cote = first(row, ['cote', 'Cote']) ?? first(portal, ['Cote']);
  if (cote) push(`cote:${normalized(cote)}`, 'cote');
  const image = first(row, ['image_filename', 'resolved_image_filename', 'image_key', 'imagePath']);
  const imageBase = aliasFromFilename(image);
  if (imageBase) push(`image:${imageBase}`, 'image_filename');
  const url = sourceUrl(row);
  const urlBase = aliasFromFilename(url);
  if (urlBase) push(`url:${urlBase}`, 'source_url');
  return output;
}

type IndexedRow = { row: GenericRow; index: number };

function indexRows(rows: GenericRow[]): Map<string, IndexedRow[]> {
  const index = new Map<string, IndexedRow[]>();
  rows.forEach((row, rowIndex) => {
    for (const entry of aliases(row)) {
      const list = index.get(entry.alias) ?? [];
      if (!list.some((candidate) => candidate.index === rowIndex)) list.push({ row, index: rowIndex });
      index.set(entry.alias, list);
    }
  });
  return index;
}

function joinRow(base: GenericRow, index: Map<string, IndexedRow[]>): { row?: GenericRow; receipt: JoinReceipt } {
  for (const entry of aliases(base)) {
    const candidates = index.get(entry.alias) ?? [];
    if (candidates.length === 1) return { row: candidates[0].row, receipt: { status: 'matched', method: entry.method, alias: entry.alias, candidates: 1 } };
    if (candidates.length > 1) return { receipt: { status: 'ambiguous', method: entry.method, alias: entry.alias, candidates: candidates.length } };
  }
  return { receipt: { status: 'missing', method: null, alias: null, candidates: 0 } };
}

function objectValue(row: GenericRow | undefined, keys: string[]): GenericRow | undefined {
  for (const key of keys) {
    const value = row?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as GenericRow;
  }
  return undefined;
}

function sourceText(row: GenericRow | undefined): string | null {
  if (!row) return null;
  const portal = nested(row, 'portal_record');
  const value = first(row, ['name', 'title', 'portal_title']) ?? first(portal, ['Titre', 'title']);
  return clean(value) || null;
}

function sourceDescription(row: GenericRow | undefined): string | null {
  if (!row) return null;
  const portal = nested(row, 'portal_record');
  const value = first(row, ['raw_description', 'description', 'portal_description']) ?? first(portal, ['Description', 'description']);
  return clean(value) || null;
}

function dateValue(row: GenericRow | undefined): { value: string | null; period: string | null } {
  if (!row) return { value: null, period: null };
  const portal = nested(row, 'portal_record');
  const attributes = nested(row, 'attributes_map');
  const value = clean(first(row, ['date_value', 'date_raw', 'date', 'year']) ?? first(attributes, ['Date', 'date']) ?? first(portal, ['Date', 'date']));
  const year = value.match(/(?:18|19|20)\d{2}/)?.[0] ?? null;
  const decade = value.match(/(?:18|19|20)\d0/)?.[0] ?? null;
  return { value: value || null, period: decade ? `${decade}s` : year };
}

function title(row: GenericRow | undefined): string | null { return sourceText(row); }

function numeric(row: GenericRow | undefined, keys: string[]): number | null {
  return firstNumber(row, keys);
}

function boolean(row: GenericRow | undefined, keys: string[]): boolean | null {
  if (!row) return null;
  const value = first(row, keys);
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalizedValue = normalized(value);
  return normalizedValue === 'true' || normalizedValue === 'yes' || normalizedValue === '1' ? true : normalizedValue === 'false' || normalizedValue === 'no' || normalizedValue === '0' ? false : null;
}

function extractAerial(row: GenericRow | undefined): { datasets: string[]; matches: unknown[] } {
  if (!row) return { datasets: [], matches: [] };
  const nestedAerial = objectValue(row, ['aerial', 'aerial_metadata']);
  const matches = first(row, ['aerial_matches', 'aerialMatches']) ?? nestedAerial?.matches;
  const datasets = first(row, ['aerial_datasets', 'aerialDatasets']) ?? nestedAerial?.datasets;
  const matchArray = Array.isArray(matches) ? matches : [];
  const datasetNames = [...asStringArray(datasets), ...matchArray.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as GenericRow;
    return [clean(first(item, ['dataset', 'dataset_name', 'source', 'key']))].filter(Boolean);
  })];
  return { datasets: Array.from(new Set(datasetNames)).sort(), matches: matchArray };
}

function extractOcr(row: GenericRow | undefined): OpportunityCrosswalkRow['ocr'] {
  const nestedOcr = objectValue(row, ['ocr', 'ocr_result']);
  const text = clean(first(row, ['ocr_text', 'text_ocr']) ?? first(nestedOcr, ['text', 'raw_text', 'value'])) || null;
  const entities = asStringArray(first(row, ['ocr_entities', 'reviewed_ocr_entities', 'entities']) ?? first(nestedOcr, ['entities', 'reviewed_entities']));
  const reviewed = Boolean(first(row, ['reviewed_ocr_entities', 'ocr_reviewed', 'ocr_entity_reviewed']) ?? first(nestedOcr, ['reviewed', 'entity_reviewed']));
  return { text, confidence: numeric(row, ['ocr_confidence', 'confidence']) ?? numeric(nestedOcr, ['confidence']), entities, reviewed, error: clean(first(row, ['ocr_error', 'error']) ?? first(nestedOcr, ['error'])) || null };
}

function extractGeocode(row: GenericRow | undefined): OpportunityCrosswalkRow['geocode'] {
  const geo = objectValue(row, ['geocode', 'geo']);
  return {
    latitude: numeric(row, ['latitude', 'lat', 'geo_lat']) ?? numeric(geo, ['latitude', 'lat']),
    longitude: numeric(row, ['longitude', 'lon', 'lng', 'geo_lng']) ?? numeric(geo, ['longitude', 'lon', 'lng']),
    place_name: clean(first(row, ['geocode_place_name', 'geo_place_name', 'place_name']) ?? first(geo, ['place_name', 'name'])) || null,
    confidence: numeric(row, ['geocode_confidence', 'geo_confidence']) ?? numeric(geo, ['confidence']),
    source: clean(first(row, ['geocode_source', 'geo_source']) ?? first(geo, ['source'])) || null,
  };
}

function extractVisual(row: GenericRow | undefined): OpportunityCrosswalkRow['visual'] {
  return {
    family_id: clean(first(row, ['primary_family_id', 'family_id', 'visual_family_id', 'component_id'])) || null,
    family_type: clean(first(row, ['primary_family_type', 'family_type', 'visual_family_type'])) || null,
    component_id: clean(first(row, ['component_id', 'leakage_group_id', 'family_id'])) || null,
  };
}

function extractTaxonomy(row: GenericRow | undefined): OpportunityCrosswalkRow['taxonomy'] {
  const taxonomy = objectValue(row, ['taxonomy', 'labels']);
  return {
    primary_category: clean(first(row, ['primaryCategory', 'primary_category', 'category']) ?? first(taxonomy, ['primaryCategory', 'primary_category', 'category'])) || null,
    confidence: numeric(row, ['primaryConfidence', 'primary_confidence', 'taxonomy_confidence']) ?? numeric(taxonomy, ['primaryConfidence', 'primary_confidence']),
    vantage: clean(first(row, ['vantage']) ?? first(taxonomy, ['vantage'])) || null,
    media_type: clean(first(row, ['mediaType', 'media_type']) ?? first(taxonomy, ['mediaType', 'media_type'])) || null,
    themes: asStringArray(first(row, ['themes', 'theme_labels']) ?? first(taxonomy, ['themes', 'theme_labels'])),
    search_facets: asStringArray(first(row, ['searchFacets', 'search_facets']) ?? first(taxonomy, ['searchFacets', 'search_facets'])),
    review_required: boolean(row, ['reviewRequired', 'review_required']) ?? boolean(taxonomy, ['reviewRequired', 'review_required']),
  };
}

function extractVlm(row: GenericRow | undefined): OpportunityCrosswalkRow['vlm'] {
  const metadata = objectValue(row, ['vlm_metadata', 'vlmMetadata', 'metadata']);
  return {
    caption: clean(first(row, ['vlm_caption', 'caption']) ?? first(metadata, ['caption', 'description'])) || null,
    scene_type: clean(first(row, ['scene_type', 'sceneType']) ?? first(metadata, ['scene_type', 'sceneType'])) || null,
    setting: clean(first(row, ['setting']) ?? first(metadata, ['setting'])) || null,
    subjects: asStringArray(first(row, ['visual_subjects', 'subjects']) ?? first(metadata, ['visual_subjects', 'subjects'])),
    valid: boolean(row, ['vlm_metadata_valid', 'valid']) ?? boolean(metadata, ['valid']),
    error: clean(first(row, ['vlm_error', 'vlm_metadata_error', 'error'])) || null,
  };
}

function extractScores(row: GenericRow | undefined, quality: GenericRow | undefined): OpportunityCrosswalkRow['scores'] {
  return {
    score: numeric(row, ['candidate_score', 'score', 'search_score', 'rank_score']),
    trust: numeric(row, ['trust_score', 'trust']),
    clip: numeric(row, ['clip_score', 'visual_score', 'clip_similarity']),
    semantic: numeric(row, ['semantic_score', 'text_score', 'bge_score']),
    quality_labels: asStringArray(first(row, ['quality_labels', 'image_quality_labels']) ?? first(quality, ['labels', 'quality_labels'])),
  };
}

function canonicalIdentity(row: GenericRow, fallbackIndex: number): OpportunityCrosswalkRow['identity'] {
  const metadata = clean(first(row, ['metadata_filename', 'record_id', 'record_link_id', 'identity'])) || `row-${fallbackIndex + 1}`;
  const sourceRecord = clean(first(row, ['source_record_id', 'record_link_id', 'record_id'])) || null;
  const portal = nested(row, 'portal_record');
  const cote = clean(first(row, ['cote', 'Cote']) ?? first(portal, ['Cote'])) || null;
  const image = clean(first(row, ['image_filename', 'resolved_image_filename', 'image_key'])) || null;
  const numeric = Number(metadata.match(/_(\d+)\.json$/)?.[1] ?? NaN);
  return { record_id: metadata, numeric_id: Number.isFinite(numeric) ? numeric : null, source_record_id: sourceRecord, metadata_filename: metadataId(metadata), cote, image_filename: image };
}

function identityKey(row: GenericRow, fallbackIndex: number): string {
  const value = first(row, ID_KEYS);
  return (metadataId(value) ?? clean(value) ?? clean(first(row, ['cote', 'Cote'])) ?? `row-${fallbackIndex + 1}`).toLowerCase();
}

function evidenceForText(text: string | null, field: string, place: keyof PlaceVocabulary, terms: string[], evidenceClass: PlaceEvidence['evidence_class']): PlaceEvidence[] {
  const haystack = normalized(text);
  if (!haystack) return [];
  return terms.filter((term) => haystack.includes(normalized(term))).map((term) => ({ place, term, field, evidence_class: evidenceClass }));
}

function deriveSignals(base: GenericRow, vlm: GenericRow | undefined, taxonomy: GenericRow | undefined, geocode: GenericRow | undefined, ocr: GenericRow | undefined, vocabulary: PlaceVocabulary): OpportunityCrosswalkRow['place_signals'] {
  const exact: PlaceEvidence[] = [];
  const inferred: PlaceEvidence[] = [];
  const portal = nested(base, 'portal_record');
  const exactFields: Array<[string, unknown]> = [
    ['name', first(base, ['name', 'title'])], ['description', first(base, ['raw_description', 'description'])],
    ['portal_record.Titre', first(portal, ['Titre'])], ['portal_record.Description', first(portal, ['Description'])],
    ['cote', first(base, ['cote', 'Cote']) ?? first(portal, ['Cote'])], ['external_url', sourceUrl(base)],
  ];
  for (const [field, value] of exactFields) for (const place of Object.keys(vocabulary) as Array<keyof PlaceVocabulary>) exact.push(...evidenceForText(clean(value) || null, field, place, vocabulary[place], 'exact_source_supported'));
  const reviewedOcr = extractOcr(ocr);
  if (reviewedOcr.reviewed) for (const place of Object.keys(vocabulary) as Array<keyof PlaceVocabulary>) exact.push(...evidenceForText([...reviewedOcr.entities, reviewedOcr.text].join(' ') || null, 'ocr.reviewed_entities', place, vocabulary[place], 'exact_source_supported'));
  const taxonomyFields: Array<[string, unknown]> = [['vlm.caption', extractVlm(vlm).caption], ['vlm.setting', extractVlm(vlm).setting], ['vlm.subjects', extractVlm(vlm).subjects.join(' ')], ['taxonomy.primary_category', extractTaxonomy(taxonomy).primary_category], ['taxonomy.themes', extractTaxonomy(taxonomy).themes.join(' ')], ['taxonomy.search_facets', extractTaxonomy(taxonomy).search_facets.join(' ')], ['geocode.place_name', extractGeocode(geocode).place_name]];
  for (const [field, value] of taxonomyFields) for (const place of Object.keys(vocabulary) as Array<keyof PlaceVocabulary>) inferred.push(...evidenceForText(clean(value) || null, field, place, vocabulary[place], 'model_inferred'));
  const uniqueEvidence = (rows: PlaceEvidence[]) => Array.from(new Map(rows.map((row) => [`${row.place}|${normalized(row.term)}|${row.field}|${row.evidence_class}`, row])).values());
  const exactUnique = uniqueEvidence(exact); const inferredUnique = uniqueEvidence(inferred);
  return { exact_source_supported: exactUnique, model_inferred: inferredUnique, places: Array.from(new Set([...exactUnique, ...inferredUnique].map((row) => row.place))).sort() };
}

function laneFor(row: OpportunityCrosswalkRow): CandidatePoolRow['candidate']['lane'] {
  const places = new Set(row.place_signals.places);
  if (places.has('old_port') && places.has('old_montreal')) return 'both';
  if (places.has('old_port')) return 'old_port';
  if (places.has('old_montreal')) return 'old_montreal';
  return 'thematic';
}

function candidateScore(row: OpportunityCrosswalkRow): { score: number; reasons: string[] } {
  const exact = row.place_signals.exact_source_supported.length;
  const inferred = row.place_signals.model_inferred.length;
  const themes = new Set(row.taxonomy.themes.map(normalized));
  const reasons: string[] = [];
  let score = 0;
  if (exact) { score += Math.min(48, exact * 12); reasons.push(`exact source place signal (${exact})`); }
  if (inferred) { score += Math.min(20, inferred * 4); reasons.push(`model place signal (${inferred})`); }
  const thematic = ['waterfront', 'industrial', 'construction', 'transit', 'park_green_space', 'civic_institutional'].filter((term) => themes.has(term));
  if (thematic.length) { score += thematic.length * 4; reasons.push(`themes: ${thematic.join(', ')}`); }
  if (row.aerial.datasets.length || row.aerial.matches.length) { score += 7; reasons.push('aerial linkage'); }
  if (row.visual.family_id) { score += 3; reasons.push('visual family available'); }
  if (row.source.original_url) { score += 3; reasons.push('original source link'); }
  if (row.source.date_period) { score += 2; reasons.push('dated record'); }
  if (row.scores.trust !== null) score += Math.max(0, Math.min(5, row.scores.trust * 5));
  return { score: Number(score.toFixed(3)), reasons };
}

function buildCrosswalkRows(canonical: GenericRow[], joined: Record<GrainName, Map<string, IndexedRow[]>>, vocabulary: PlaceVocabulary): OpportunityCrosswalkRow[] {
  return canonical.map((base, index) => {
    const identity = canonicalIdentity(base, index);
    const joinedRows = {} as Record<GrainName, GenericRow | undefined>;
    const joins = {} as Record<GrainName, JoinReceipt>;
    for (const grain of GRAIN_NAMES) {
      if (grain === 'canonical_scored') { joinedRows[grain] = base; joins[grain] = { status: 'matched', method: 'metadata_filename', alias: identity.record_id.toLowerCase(), candidates: 1 }; continue; }
      const result = joinRow(base, joined[grain]); joinedRows[grain] = result.row; joins[grain] = result.receipt;
    }
    const date = dateValue(joinedRows.date ?? base); const aerialSource = joinedRows.aerial ?? base; const aerialJoined = extractAerial(aerialSource); const aerialBase = extractAerial(base); const aerial = { datasets: Array.from(new Set([...aerialJoined.datasets, ...aerialBase.datasets])).sort(), matches: aerialJoined.matches.length ? aerialJoined.matches : aerialBase.matches }; const geocode = extractGeocode(joinedRows.geocode ?? base); const ocr = extractOcr(joinedRows.ocr ?? base); const visual = extractVisual(joinedRows.visual_family ?? base); const taxonomy = extractTaxonomy(joinedRows.taxonomy ?? base); const vlm = extractVlm(joinedRows.vlm ?? base); const sourcePortal = nested(base, 'portal_record');
    const result: OpportunityCrosswalkRow = {
      schema_version: 'city_memory_opportunity_crosswalk_v1', identity,
      corpus_grain: { canonical_scored: 'canonical_scored', vlm: joins.vlm.status === 'matched' ? 'vlm' : null, taxonomy: joins.taxonomy.status === 'matched' ? 'taxonomy' : null, geocode: joins.geocode.status === 'matched' ? 'geocode' : null, ocr: joins.ocr.status === 'matched' ? 'ocr' : null, date: joins.date.status === 'matched' ? 'date' : null, aerial: aerial.datasets.length || aerial.matches.length ? 'aerial' : joins.aerial.status === 'matched' ? 'aerial' : null, visual_family: joins.visual_family.status === 'matched' ? 'visual_family' : visual.family_id ? 'visual_family' : null },
      source: { title: title(base), description: sourceDescription(base), date: date.value, date_period: date.period, credits: clean(first(base, ['credits', 'credit', 'attribution']) ?? first(sourcePortal, ['Mention de crédits', 'credits'])) || null, cote: identity.cote, original_url: sourceUrl(base) }, geocode, ocr, aerial, visual, taxonomy, vlm,
      scores: extractScores(base, objectValue(base, ['quality', 'image_quality'])), joins,
      place_signals: deriveSignals(base, joinedRows.vlm ?? base, joinedRows.taxonomy ?? base, joinedRows.geocode ?? base, joinedRows.ocr ?? base, vocabulary),
    };
    return result;
  });
}

function makeCandidates(crosswalk: OpportunityCrosswalkRow[], limit: number): CandidatePoolRow[] {
  const eligible = crosswalk.filter((row) => row.place_signals.places.length > 0 || row.taxonomy.themes.some((theme) => ['waterfront', 'industrial', 'construction', 'transit'].includes(normalized(theme))));
  const scored = eligible.map((row) => { const ranking = candidateScore(row); return { row, ...ranking }; }).sort((a, b) => b.score - a.score || a.row.identity.record_id.localeCompare(b.row.identity.record_id));
  const picked: Array<{ row: OpportunityCrosswalkRow; score: number; reasons: string[] }> = [];
  const families = new Set<string>();
  const periods = new Set<string>();
  for (const entry of scored) {
    if (picked.length >= limit) break;
    const family = entry.row.visual.family_id; const period = entry.row.source.date_period;
    const diversityBonus = (family && !families.has(family) ? 1 : 0) + (period && !periods.has(period) ? 1 : 0);
    if (picked.length < Math.min(10, limit) && family && families.size < 3 && families.has(family)) continue;
    picked.push({ row: entry.row, score: Number((entry.score + diversityBonus).toFixed(3)), reasons: entry.reasons });
    if (family) families.add(family); if (period) periods.add(period);
  }
  return picked.sort((a, b) => b.score - a.score || a.row.identity.record_id.localeCompare(b.row.identity.record_id)).map((entry, index) => ({ ...entry.row, candidate: { rank: index + 1, score: entry.score, lane: laneFor(entry.row), reasons: entry.reasons, diversity: { family_id: entry.row.visual.family_id, period: entry.row.source.date_period } } }));
}

function emptySummary(dataRoot: string, vocabulary: PlaceVocabulary): OpportunityBuildResult['summary'] {
  const empty = (): GrainSummary => ({ path: null, rows: 0, unique_identities: 0, matched: 0, missing: 0, ambiguous: 0 });
  return { schema_version: 'city_memory_opportunity_run_v1', generated_at: new Date().toISOString(), data_root: dataRoot, vocabulary, grains: Object.fromEntries(GRAIN_NAMES.map((grain) => [grain, empty()])) as Record<GrainName, GrainSummary>, crosswalk_rows: 0, place_signal_rows: 0, candidate_rows: 0, limits: { max_crosswalk_rows: null, max_candidates: 100 }, gaps: [] };
}

export function buildOpportunity(options: { dataRoot: string; inputs?: Partial<Record<GrainName, string>>; vocabulary?: PlaceVocabulary; maxCandidates?: number; maxCrosswalkRows?: number }): OpportunityBuildResult {
  const dataRoot = path.resolve(options.dataRoot); const vocabulary = options.vocabulary ?? DEFAULT_VOCABULARY; const paths = resolveInputPaths(dataRoot, options.inputs); const sourceRows = {} as Record<GrainName, GenericRow[]>;
  for (const grain of GRAIN_NAMES) sourceRows[grain] = paths[grain] ? readJsonLines(paths[grain]!) : [];
  const canonical = sourceRows.canonical_scored; const indexes = {} as Record<GrainName, Map<string, IndexedRow[]>>;
  for (const grain of GRAIN_NAMES) indexes[grain] = indexRows(sourceRows[grain]);
  const rows = buildCrosswalkRows(canonical, indexes, vocabulary); const maxCrosswalkRows = options.maxCrosswalkRows && options.maxCrosswalkRows > 0 ? Math.floor(options.maxCrosswalkRows) : null; const boundedCrosswalk = maxCrosswalkRows ? rows.slice(0, maxCrosswalkRows) : rows; const candidates = makeCandidates(rows, Math.max(1, Math.floor(options.maxCandidates ?? 100)));
  const summary = emptySummary(dataRoot, vocabulary); summary.limits = { max_crosswalk_rows: maxCrosswalkRows, max_candidates: Math.max(1, Math.floor(options.maxCandidates ?? 100)) }; summary.crosswalk_rows = boundedCrosswalk.length; summary.place_signal_rows = rows.filter((row) => row.place_signals.places.length > 0).length; summary.candidate_rows = candidates.length;
  for (const grain of GRAIN_NAMES) {
    const rowsForGrain = sourceRows[grain]; const joined = grain === 'canonical_scored' ? rowsForGrain.length : rows.filter((row) => row.joins[grain].status === 'matched').length; const ambiguous = grain === 'canonical_scored' ? 0 : rows.filter((row) => row.joins[grain].status === 'ambiguous').length; summary.grains[grain] = { path: pathLabel(paths[grain]), rows: rowsForGrain.length, unique_identities: new Set(rowsForGrain.map(identityKey)).size, matched: joined, missing: grain === 'canonical_scored' ? 0 : rows.length - joined - ambiguous, ambiguous };
    if (!paths[grain]) summary.gaps.push(`missing ${grain} input artifact`);
  }
  if (!canonical.length) summary.gaps.push('canonical_scored grain is empty; pass --scored or set MTL_ARCHIVES_DATA_ROOT to the populated checkout');
  if (canonical.length && canonical.length !== 13_499) summary.gaps.push(`canonical_scored rows observed=${canonical.length}; expected reference grain=13499`);
  if (sourceRows.vlm.length && sourceRows.taxonomy.length && sourceRows.vlm.length !== sourceRows.taxonomy.length) summary.gaps.push(`vlm/taxonomy row counts differ (${sourceRows.vlm.length}/${sourceRows.taxonomy.length})`);
  if (!summary.place_signal_rows) summary.gaps.push('no vocabulary terms matched exact metadata or model fields');
  return { crosswalk: boundedCrosswalk, candidates, summary };
}

function loadVocabulary(value: string | undefined, dataRoot: string): PlaceVocabulary {
  if (!value) return DEFAULT_VOCABULARY;
  const resolved = resolvePath(dataRoot, value); const raw = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : value;
  const parsed = JSON.parse(raw) as Partial<PlaceVocabulary>; return { old_port: asStringArray(parsed.old_port), old_montreal: asStringArray(parsed.old_montreal) };
}

function flattenCandidate(row: CandidatePoolRow): Record<string, unknown> {
  return { rank: row.candidate.rank, score: row.candidate.score, lane: row.candidate.lane, record_id: row.identity.record_id, title: row.source.title, date: row.source.date, date_period: row.source.date_period, cote: row.identity.cote, original_url: row.source.original_url, exact_places: row.place_signals.exact_source_supported.map((entry) => `${entry.place}:${entry.term}`), inferred_places: row.place_signals.model_inferred.map((entry) => `${entry.place}:${entry.term}`), family_id: row.visual.family_id, aerial_datasets: row.aerial.datasets, reasons: row.candidate.reasons };
}

function flattenCrosswalk(row: OpportunityCrosswalkRow): Record<string, unknown> {
  return { record_id: row.identity.record_id, numeric_id: row.identity.numeric_id, title: row.source.title, date: row.source.date, date_period: row.source.date_period, cote: row.identity.cote, original_url: row.source.original_url, exact_places: row.place_signals.exact_source_supported.map((entry) => `${entry.place}:${entry.term}`), inferred_places: row.place_signals.model_inferred.map((entry) => `${entry.place}:${entry.term}`), latitude: row.geocode.latitude, longitude: row.geocode.longitude, geocode_confidence: row.geocode.confidence, ocr_reviewed: row.ocr.reviewed, aerial_datasets: row.aerial.datasets, family_id: row.visual.family_id, taxonomy_category: row.taxonomy.primary_category, taxonomy_themes: row.taxonomy.themes, vlm_caption: row.vlm.caption };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({ args: argv, options: { root: { type: 'string' }, 'data-root': { type: 'string' }, output: { type: 'string' }, 'output-dir': { type: 'string' }, scored: { type: 'string' }, vlm: { type: 'string' }, taxonomy: { type: 'string' }, geocode: { type: 'string' }, ocr: { type: 'string' }, date: { type: 'string' }, aerial: { type: 'string' }, 'visual-family': { type: 'string' }, vocabulary: { type: 'string' }, 'max-candidates': { type: 'string' }, 'max-crosswalk-rows': { type: 'string' } } });
  const dataRoot = parsed.values.root ?? parsed.values['data-root'] ?? process.env.MTL_ARCHIVES_DATA_ROOT ?? process.env.PORT_TO_CITY_DATA_ROOT ?? process.env.CITY_MEMORY_DATA_ROOT ?? DEFAULT_DATA_ROOT; const output = resolvePath(dataRoot, parsed.values.output ?? parsed.values['output-dir'] ?? 'reports/city_memory_opportunity_v1'); const inputs: Partial<Record<GrainName, string>> = { canonical_scored: parsed.values.scored, vlm: parsed.values.vlm, taxonomy: parsed.values.taxonomy, geocode: parsed.values.geocode, ocr: parsed.values.ocr, date: parsed.values.date, aerial: parsed.values.aerial, visual_family: parsed.values['visual-family'] };
  const result = buildOpportunity({ dataRoot, inputs, vocabulary: loadVocabulary(parsed.values.vocabulary ?? process.env.PORT_TO_CITY_VOCABULARY, dataRoot), maxCandidates: Number(parsed.values['max-candidates'] ?? process.env.PORT_TO_CITY_MAX_CANDIDATES ?? 100), maxCrosswalkRows: Number(parsed.values['max-crosswalk-rows'] ?? 0) });
  writeJsonl(path.join(output, 'crosswalk-v1.jsonl'), result.crosswalk); writeCsv(path.join(output, 'crosswalk-v1.csv'), result.crosswalk.map(flattenCrosswalk), ['record_id', 'numeric_id', 'title', 'date', 'date_period', 'cote', 'original_url', 'exact_places', 'inferred_places', 'latitude', 'longitude', 'geocode_confidence', 'ocr_reviewed', 'aerial_datasets', 'family_id', 'taxonomy_category', 'taxonomy_themes', 'vlm_caption']); writeJsonl(path.join(output, 'candidate-pool-v1.jsonl'), result.candidates); writeCsv(path.join(output, 'candidate-pool-v1.csv'), result.candidates.map(flattenCandidate), ['rank', 'score', 'lane', 'record_id', 'title', 'date', 'date_period', 'cote', 'original_url', 'exact_places', 'inferred_places', 'family_id', 'aerial_datasets', 'reasons']); writeJson(path.join(output, 'run-summary-v1.json'), result.summary);
  console.log(JSON.stringify({ status: 'ok', output, canonical_scored_rows: result.summary.grains.canonical_scored.rows, crosswalk_rows: result.crosswalk.length, candidate_rows: result.candidates.length, place_signal_rows: result.summary.place_signal_rows, gaps: result.summary.gaps }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
