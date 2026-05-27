import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl',
);
const DEFAULT_COLLECTION_RECORDS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
);
const DEFAULT_QUALITY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_taxonomy',
);

type VlmMetadata = {
  caption?: string;
  scene_type?: string;
  visual_subjects?: string[];
  setting?: string;
  season?: string;
  aerial_ground_document?: string;
  search_terms?: string[];
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
  vlm_caption?: string | null;
  vlm_metadata?: VlmMetadata | null;
  vlm_error?: string | null;
  vlm_metadata_error?: string | null;
};

type CandidateRow = {
  candidate_type?: string;
  id?: string;
  score?: number;
  reasons?: string[];
};

type CollectionRow = {
  collection_id?: string;
  collection_title?: string;
  collection_type?: string;
  id?: string;
  score?: number;
  matchReasons?: string[];
};

type QualityRow = {
  id?: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
};

type TaxonomyRow = {
  id: string;
  title: string;
  date: string;
  imageUrl: string;
  imagePath: string;
  primaryCategory: string;
  primaryConfidence: number;
  taxonomy: {
    vantage: string;
    mediaType: string;
    themes: string[];
    setting: string;
    season: string;
    qualityTier: string;
    publishRisk: string;
  };
  classifier: {
    confidence: number;
    evidence: string[];
    warnings: string[];
    sourceSignals: string[];
  };
  downstream: {
    searchFacets: string[];
    socialTags: string[];
    productTags: string[];
    excludeFromDefaultVisualSearch: boolean;
    reviewRequired: boolean;
  };
};

type ThemeDef = {
  id: string;
  socialTag: string;
  terms: string[];
};

const THEMES: ThemeDef[] = [
  { id: 'waterfront', socialTag: 'waterfront', terms: ['waterfront', 'river', 'harbor', 'harbour', 'port', 'dock', 'ship', 'boat', 'canal', 'bridge over water', 'fleuve', 'quai'] },
  { id: 'industrial', socialTag: 'industry', terms: ['industrial', 'factory', 'warehouse', 'rail yard', 'train yard', 'smokestack', 'port', 'silo', 'refinery', 'manufacturing'] },
  { id: 'residential', socialTag: 'residential', terms: ['residential', 'houses', 'homes', 'neighborhood', 'neighbourhood', 'apartment', 'row houses', 'duplex'] },
  { id: 'commercial', socialTag: 'commercial', terms: ['commercial', 'store', 'shop', 'market', 'sign', 'advertisement', 'downtown', 'business', 'office'] },
  { id: 'park_green_space', socialTag: 'parks', terms: ['park', 'garden', 'green space', 'trees', 'field', 'playground', 'mount royal', 'lafontaine'] },
  { id: 'transit', socialTag: 'transit', terms: ['tram', 'streetcar', 'bus', 'train', 'railway', 'railroad', 'station', 'metro', 'tracks', 'bridge'] },
  { id: 'construction', socialTag: 'construction', terms: ['construction', 'demolition', 'building site', 'crane', 'excavation', 'roadwork', 'under construction'] },
  { id: 'civic_institutional', socialTag: 'civic', terms: ['church', 'school', 'hospital', 'city hall', 'library', 'institution', 'municipal', 'clock tower', 'public building'] },
  { id: 'crowd_event', socialTag: 'people', terms: ['crowd', 'parade', 'children', 'people', 'group', 'ceremony', 'event', 'classroom', 'students'] },
  { id: 'winter', socialTag: 'winter', terms: ['winter', 'snow', 'ice', 'frozen'] },
];

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

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
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
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function metadataId(record: ArchiveRecord): string {
  return cleanText(record.metadata_filename);
}

function imagePath(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function imageUrl(record: ArchiveRecord, publicDomain: string): string {
  const external = cleanText(record.external_url);
  if (external) return external;
  const key = imagePath(record);
  if (!key || !publicDomain) return '';
  return `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(key)}`;
}

function dateValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Date);
}

function combinedText(record: ArchiveRecord): string {
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
    ...(metadata?.visual_subjects ?? []),
    ...(metadata?.search_terms ?? []),
  ].filter(Boolean).join(' '));
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const normalizedTerm = normalize(term);
    if (!normalizedTerm) return false;
    if (normalizedTerm.includes(' ')) return text.includes(normalizedTerm);
    return new RegExp(`(^| )${normalizedTerm}( |$)`).test(text);
  });
}

function classifyVantage(record: ArchiveRecord, text: string): { value: string; confidence: number; evidence: string[] } {
  const metadata = record.vlm_metadata;
  const agd = normalize(metadata?.aerial_ground_document);
  const scene = normalize(metadata?.scene_type);
  const evidence: string[] = [];
  if (agd === 'aerial' || scene.includes('aerial')) {
    evidence.push('VLM aerial signal');
    return { value: 'aerial', confidence: 0.9, evidence };
  }
  if (agd === 'document' || scene.includes('document') || scene.includes('map') || hasAny(text, ['map', 'plan', 'document', 'index', 'sheet'])) {
    evidence.push('VLM/document text signal');
    return { value: 'document_or_map', confidence: agd === 'document' ? 0.84 : 0.72, evidence };
  }
  if (agd === 'ground' || hasAny(text, ['street view', 'ground level', 'interior', 'classroom', 'storefront'])) {
    evidence.push('VLM ground/photo signal');
    return { value: 'ground', confidence: agd === 'ground' ? 0.86 : 0.7, evidence };
  }
  if (hasAny(text, ['aerial view', 'bird s eye', 'vue aerienne'])) {
    evidence.push('text aerial phrase');
    return { value: 'aerial', confidence: 0.7, evidence };
  }
  return { value: 'unknown', confidence: 0.25, evidence: ['no reliable vantage signal'] };
}

function classifyMedia(record: ArchiveRecord, text: string, vantage: string): { value: string; confidence: number; evidence: string[] } {
  const scene = normalize(record.vlm_metadata?.scene_type);
  if (vantage === 'document_or_map') return { value: 'document_map', confidence: 0.84, evidence: ['document/map vantage'] };
  if (scene.includes('map') || hasAny(text, ['map', 'plan', 'technical drawing', 'index sheet'])) return { value: 'document_map', confidence: 0.8, evidence: ['map/plan terms'] };
  if (vantage === 'aerial') return { value: 'photograph', confidence: 0.82, evidence: ['aerial photo signal'] };
  if (vantage === 'ground') return { value: 'photograph', confidence: 0.78, evidence: ['ground photo signal'] };
  return { value: 'unknown', confidence: 0.3, evidence: ['no reliable media signal'] };
}

function classifyThemes(record: ArchiveRecord, text: string, collectionIds: string[]): { themes: string[]; evidence: string[] } {
  const themes = new Set<string>();
  const evidence: string[] = [];
  for (const theme of THEMES) {
    if (hasAny(text, theme.terms)) {
      themes.add(theme.id);
      evidence.push(`text/theme:${theme.id}`);
    }
  }
  for (const collectionId of collectionIds) {
    if (collectionId.includes('waterfront')) themes.add('waterfront');
    if (collectionId.includes('industry')) themes.add('industrial');
    if (collectionId.includes('residential')) themes.add('residential');
    if (collectionId.includes('parks')) themes.add('park_green_space');
    if (collectionId.includes('transit')) themes.add('transit');
  }
  const season = normalize(record.vlm_metadata?.season);
  if (season === 'winter') themes.add('winter');
  return { themes: [...themes].slice(0, 6), evidence };
}

function primaryCategory(vantage: string, mediaType: string, themes: string[]): string {
  if (vantage === 'document_or_map' || mediaType === 'document_map') return 'document_map';
  if (vantage === 'aerial') {
    if (themes.includes('waterfront')) return 'aerial_waterfront';
    if (themes.includes('industrial')) return 'aerial_industrial';
    if (themes.includes('residential')) return 'aerial_residential';
    return 'aerial_general';
  }
  if (vantage === 'ground') {
    if (themes.includes('transit')) return 'ground_transit';
    if (themes.includes('crowd_event')) return 'people_event';
    if (themes.includes('commercial')) return 'street_commercial';
    if (themes.includes('civic_institutional')) return 'civic_institutional';
    return 'ground_photo';
  }
  return 'uncertain';
}

function qualityTier(record: ArchiveRecord, quality?: QualityRow): string {
  const pq = normalize(record.vlm_metadata?.print_quality);
  if (quality?.severity === 'high') return 'review_required';
  if (pq === 'excellent' || pq === 'good') return pq;
  if (pq === 'fair' || pq === 'poor') return pq;
  return 'unknown';
}

function publishRisk(quality?: QualityRow): string {
  if (!quality) return 'not_audited';
  if (quality.recommendedAction === 'exclude_until_fixed') return 'exclude_until_fixed';
  if (quality.recommendedAction && quality.recommendedAction !== 'none') return 'review';
  return 'normal';
}

function confidenceScore(parts: number[], warnings: string[]): number {
  const base = parts.reduce((sum, value) => sum + value, 0) / parts.length;
  return Number(Math.max(0.05, Math.min(0.98, base - warnings.length * 0.06)).toFixed(2));
}

function countBy(rows: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row, (counts.get(row) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Autoresearch Visual Taxonomy Classifier',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Input rows: ${report.summary.input_rows}`,
    `- Classified rows: ${report.summary.classified_rows}`,
    `- High confidence rows: ${report.summary.high_confidence_rows}`,
    `- Review required rows: ${report.summary.review_required_rows}`,
    `- VLM missing/error rows: ${report.summary.vlm_missing_rows}`,
    '',
    '## Primary Categories',
    '',
  ];
  for (const [key, value] of Object.entries(report.distributions.primaryCategory)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Themes', '');
  for (const [key, value] of Object.entries(report.distributions.themes)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Validation Notes', '');
  for (const note of report.validation.notes) lines.push(`- ${note}`);
  lines.push('', '## Downstream Contract', '');
  lines.push('- `taxonomy_labels.jsonl` contains one row per input record and joins on `id == metadata_filename`.');
  lines.push('- `taxonomy_downstream.jsonl` contains compact fields for search facets, social tags, product tags, review flags, and image references.');
  lines.push('- `taxonomy.md` documents the compact taxonomy and classifier limitations.');
  return `${lines.join('\n')}\n`;
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTION_RECORDS },
      quality: { type: 'string', default: DEFAULT_QUALITY },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'public-domain': { type: 'string', default: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || '' },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const publicDomain = cleanText(values['public-domain']);
  fs.mkdirSync(outputDir, { recursive: true });

  const records = readJsonl<ArchiveRecord>(inputPath);
  const candidates = readJsonl<CandidateRow>(resolveRepoPath(values.candidates!));
  const collections = readJsonl<CollectionRow>(resolveRepoPath(values.collections!));
  const qualityRows = readJsonl<QualityRow>(resolveRepoPath(values.quality!));

  const candidatesById = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    if (!row.id) continue;
    const current = candidatesById.get(row.id) ?? [];
    current.push(row);
    candidatesById.set(row.id, current);
  }
  const collectionsById = new Map<string, CollectionRow[]>();
  for (const row of collections) {
    if (!row.id) continue;
    const current = collectionsById.get(row.id) ?? [];
    current.push(row);
    collectionsById.set(row.id, current);
  }
  const qualityById = new Map(qualityRows.filter((row) => row.id).map((row) => [row.id!, row]));

  const rows: TaxonomyRow[] = records
    .filter((record) => metadataId(record))
    .map((record) => {
      const id = metadataId(record);
      const text = combinedText(record);
      const quality = qualityById.get(id);
      const collectionIds = (collectionsById.get(id) ?? []).map((row) => cleanText(row.collection_id));
      const candidateTypes = (candidatesById.get(id) ?? []).map((row) => cleanText(row.candidate_type));
      const vantage = classifyVantage(record, text);
      const media = classifyMedia(record, text, vantage.value);
      const themeResult = classifyThemes(record, text, collectionIds);
      const warnings: string[] = [];
      if (record.vlm_error || record.vlm_metadata_error || !record.vlm_metadata) warnings.push('vlm_missing_or_error');
      if (quality?.severity === 'high') warnings.push('high_quality_issue');
      if (vantage.value === 'unknown') warnings.push('unknown_vantage');
      const primary = primaryCategory(vantage.value, media.value, themeResult.themes);
      const qTier = qualityTier(record, quality);
      const risk = publishRisk(quality);
      const confidence = confidenceScore([
        vantage.confidence,
        media.confidence,
        themeResult.themes.length ? 0.78 : 0.48,
        record.vlm_metadata ? 0.82 : 0.25,
      ], warnings);
      const searchFacets = [
        `primary:${primary}`,
        `vantage:${vantage.value}`,
        `media:${media.value}`,
        ...themeResult.themes.map((theme) => `theme:${theme}`),
        `quality:${qTier}`,
      ];
      const socialTags = [
        primary,
        ...themeResult.themes.map((theme) => THEMES.find((item) => item.id === theme)?.socialTag ?? theme),
        ...candidateTypes.map((type) => `candidate_${type}`),
      ].filter(Boolean).slice(0, 10);

      return {
        id,
        title: cleanText(record.name || id),
        date: dateValue(record),
        imageUrl: imageUrl(record, publicDomain),
        imagePath: imagePath(record),
        primaryCategory: primary,
        primaryConfidence: confidence,
        taxonomy: {
          vantage: vantage.value,
          mediaType: media.value,
          themes: themeResult.themes,
          setting: cleanText(record.vlm_metadata?.setting) || 'unknown',
          season: normalize(record.vlm_metadata?.season) || 'unknown',
          qualityTier: qTier,
          publishRisk: risk,
        },
        classifier: {
          confidence,
          evidence: [...vantage.evidence, ...media.evidence, ...themeResult.evidence, ...collectionIds.map((cid) => `collection:${cid}`), ...candidateTypes.map((type) => `candidate:${type}`)].slice(0, 16),
          warnings,
          sourceSignals: [
            record.vlm_metadata ? 'vlm_metadata' : 'metadata_only',
            quality ? 'image_quality' : '',
            collectionIds.length ? 'collections' : '',
            candidateTypes.length ? 'candidates' : '',
          ].filter(Boolean),
        },
        downstream: {
          searchFacets,
          socialTags: [...new Set(socialTags)],
          productTags: [`quality:${qTier}`, `risk:${risk}`, ...themeResult.themes.map((theme) => `theme:${theme}`)],
          excludeFromDefaultVisualSearch: primary === 'document_map' || risk === 'exclude_until_fixed',
          reviewRequired: risk === 'review' || risk === 'exclude_until_fixed' || confidence < 0.55,
        },
      };
    });

  const downstreamRows = rows.map((row) => ({
    id: row.id,
    title: row.title,
    date: row.date,
    imageUrl: row.imageUrl,
    imagePath: row.imagePath,
    primaryCategory: row.primaryCategory,
    primaryConfidence: row.primaryConfidence,
    vantage: row.taxonomy.vantage,
    mediaType: row.taxonomy.mediaType,
    themes: row.taxonomy.themes,
    searchFacets: row.downstream.searchFacets,
    socialTags: row.downstream.socialTags,
    productTags: row.downstream.productTags,
    reviewRequired: row.downstream.reviewRequired,
    excludeFromDefaultVisualSearch: row.downstream.excludeFromDefaultVisualSearch,
  }));

  const highConfidenceRows = rows.filter((row) => row.primaryConfidence >= 0.7);
  const reviewRows = rows.filter((row) => row.downstream.reviewRequired);
  const vlmMissingRows = rows.filter((row) => row.classifier.warnings.includes('vlm_missing_or_error'));
  const validationSample = [
    ...highConfidenceRows.slice(0, 20),
    ...reviewRows.slice(0, 20),
    ...rows.filter((row) => row.primaryCategory === 'document_map').slice(0, 20),
    ...rows.filter((row) => row.primaryCategory.startsWith('aerial')).slice(0, 20),
  ].filter((row, index, array) => array.findIndex((item) => item.id === row.id) === index);

  const report = {
    generated_at: new Date().toISOString(),
    command: 'npm run autoresearch:taxonomy',
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, inputPath),
      candidates: path.relative(MONOREPO_ROOT, resolveRepoPath(values.candidates!)),
      collections: path.relative(MONOREPO_ROOT, resolveRepoPath(values.collections!)),
      quality: path.relative(MONOREPO_ROOT, resolveRepoPath(values.quality!)),
    },
    taxonomy: {
      primary_categories: ['aerial_general', 'aerial_waterfront', 'aerial_industrial', 'aerial_residential', 'ground_photo', 'ground_transit', 'street_commercial', 'civic_institutional', 'people_event', 'document_map', 'uncertain'],
      themes: THEMES.map((theme) => theme.id),
      fields: ['primaryCategory', 'vantage', 'mediaType', 'themes', 'setting', 'season', 'qualityTier', 'publishRisk'],
    },
    summary: {
      input_rows: records.length,
      classified_rows: rows.length,
      high_confidence_rows: highConfidenceRows.length,
      review_required_rows: reviewRows.length,
      vlm_missing_rows: vlmMissingRows.length,
      downstream_rows: downstreamRows.length,
    },
    distributions: {
      primaryCategory: countBy(rows.map((row) => row.primaryCategory)),
      vantage: countBy(rows.map((row) => row.taxonomy.vantage)),
      mediaType: countBy(rows.map((row) => row.taxonomy.mediaType)),
      themes: countBy(rows.flatMap((row) => row.taxonomy.themes)),
      publishRisk: countBy(rows.map((row) => row.taxonomy.publishRisk)),
    },
    validation: {
      spot_check_rows: validationSample.length,
      notes: [
        `${highConfidenceRows.length} rows classified with confidence >= 0.70.`,
        `${reviewRows.length} rows routed to review because of uncertainty or quality risk.`,
        `${vlmMissingRows.length} rows have missing/error VLM metadata and are intentionally lower-confidence.`,
        'Validation sample mixes high-confidence, review-required, document/map, and aerial rows for manual spot checks.',
      ],
      sample: validationSample.slice(0, 80),
    },
    artifacts: {
      report_json: 'taxonomy_report.json',
      report_markdown: 'taxonomy_report.md',
      labels_jsonl: 'taxonomy_labels.jsonl',
      downstream_jsonl: 'taxonomy_downstream.jsonl',
      validation_jsonl: 'taxonomy_validation_sample.jsonl',
      taxonomy_markdown: 'taxonomy.md',
    },
  };

  const taxonomyDoc = [
    '# Visual Taxonomy',
    '',
    'Primary category is a compact, single-label field for browsing and ranking. Themes are multi-label facets for filtering, social packaging, and product review.',
    '',
    '## Primary Categories',
    '',
    ...report.taxonomy.primary_categories.map((category) => `- \`${category}\``),
    '',
    '## Theme Facets',
    '',
    ...THEMES.map((theme) => `- \`${theme.id}\`: ${theme.terms.slice(0, 8).join(', ')}`),
    '',
    '## Downstream Fields',
    '',
    '- `searchFacets`: stable facet strings for API/UI filtering.',
    '- `socialTags`: compact social/content packaging tags.',
    '- `productTags`: quality, risk, and theme tags for print/product review.',
    '- `reviewRequired`: true when confidence is low or quality labels imply review.',
    '- `excludeFromDefaultVisualSearch`: true for document/map or broken-image records.',
    '',
    '## Limitations',
    '',
    '- This is a deterministic classifier over VLM metadata, collection/candidate signals, and image-quality labels.',
    '- It does not train a new neural model and does not require local embedding files.',
    '- Rows with missing VLM metadata are classified conservatively as lower confidence.',
  ].join('\n');

  fs.writeFileSync(path.join(outputDir, 'taxonomy_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'taxonomy_report.md'), renderMarkdown(report));
  fs.writeFileSync(path.join(outputDir, 'taxonomy.md'), `${taxonomyDoc}\n`);
  writeJsonl(path.join(outputDir, 'taxonomy_labels.jsonl'), rows);
  writeJsonl(path.join(outputDir, 'taxonomy_downstream.jsonl'), downstreamRows);
  writeJsonl(path.join(outputDir, 'taxonomy_validation_sample.jsonl'), validationSample);

  console.log(`[autoresearch:taxonomy] output=${outputDir}`);
  console.log(`[autoresearch:taxonomy] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
