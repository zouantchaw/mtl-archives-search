import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
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
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl',
);
const DEFAULT_COLLECTIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
);
const DEFAULT_QUALITY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
);
const DEFAULT_FAMILY_MAP = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-record-family-map.jsonl',
);
const DEFAULT_ACTIVE_QUEUE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/research_enrichment_v0');
const DEFAULT_PUBLIC_R2_DOMAIN = 'pub-6a29793ea7664738880d1cc5afb21b87.r2.dev';
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
};

type CandidateRow = {
  id?: string;
  candidate_type?: string;
  rank?: number;
  score?: number;
  reasons?: string[];
  socialHook?: string | null;
  vlmCaption?: string | null;
};

type CollectionRow = {
  id?: string;
  collection_id?: string;
  collection_title?: string;
  collection_type?: string;
  rank?: number;
  score?: number;
  matchReasons?: string[];
};

type QualityRow = {
  id?: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
  notes?: string[];
};

type FamilyMapRow = {
  record_id?: string;
  primary_family_id?: string;
  primary_family_type?: string;
  leakage_group_id?: string;
};

type ActiveLearningRow = {
  record?: { id?: string };
  acquisition?: { score?: number; reasons?: string[]; primary_stratum?: string };
  label_task?: { priority?: string; ml_tasks?: string[] };
};

type EvidenceClaim = {
  claim: string;
  evidence_type: 'observed_model' | 'metadata' | 'inferred' | 'verified_source' | 'unresolved';
  source_field: string | null;
  source_url: string | null;
  confidence: number;
  review_flags: string[];
};

type ResearchPacket = {
  schema_version: 'research_enrichment_packet_v0';
  packet_id: string;
  record_id: string;
  selected_at: string;
  research_depth: 'deep_candidate' | 'shallow_candidate' | 'source_recovery_candidate';
  provenance_fit_score: number;
  title: string;
  date: string;
  cote: string;
  image_url: string | null;
  source_url: string | null;
  rights: {
    license_id: string;
    license_url: string;
    credit_line: string;
    commercial_use_allowed: boolean;
    attribution_required: boolean;
  };
  source_context: {
    family_id: string | null;
    family_type: string | null;
    active_learning_score: number | null;
    candidate_types: string[];
    collection_ids: string[];
    quality_labels: string[];
  };
  evidence: {
    observed_visual_facts: EvidenceClaim[];
    metadata_claims: EvidenceClaim[];
    inferences: EvidenceClaim[];
    verified: EvidenceClaim[];
    unresolved_questions: EvidenceClaim[];
  };
  research_targets: {
    entities: string[];
    search_terms: string[];
    source_urls_to_check: string[];
    suggested_queries: string[];
  };
  risk_flags: string[];
  recommendation: string;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlEscape(value: unknown): string {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort();
}

function r2Url(imagePath: string): string | null {
  if (!imagePath) return null;
  return `https://${DEFAULT_PUBLIC_R2_DOMAIN}/${encodeURIComponent(imagePath)}`;
}

function title(record: ArchiveRecord): string {
  return clean(record.name || record.metadata_filename || record.image_filename);
}

function dateValue(record: ArchiveRecord): string {
  return clean(record.attributes_map?.Date || record.portal_record?.Date || record.portal_record?.Dates);
}

function coteValue(record: ArchiveRecord): string {
  return clean(record.cote || record.attributes_map?.Cote || record.portal_record?.Cote || record.portal_record?.['Cote/Titre']);
}

function imagePath(record: ArchiveRecord): string {
  return clean(record.resolved_image_filename || record.image_filename);
}

function sourceUrl(record: ArchiveRecord): string | null {
  return clean(record.external_url || record.portal_record?.url || record.portal_record?.URL) || null;
}

function shortSnippet(value: unknown, maxLength = 240): string {
  const text = clean(value).replace(/\s+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function claim(
  text: string,
  evidenceType: EvidenceClaim['evidence_type'],
  sourceField: string | null,
  sourceUrlValue: string | null,
  confidence: number,
  reviewFlags: string[] = [],
): EvidenceClaim {
  return {
    claim: text,
    evidence_type: evidenceType,
    source_field: sourceField,
    source_url: sourceUrlValue,
    confidence,
    review_flags: reviewFlags,
  };
}

function extractEntities(text: string): string[] {
  const entities = new Set<string>();
  const patterns = [
    /\b(?:rue|avenue|boulevard|chemin|place|parc|pont|canal|port|gare|eglise|église|hotel|hôtel|edifice|édifice)\s+[A-ZÀ-Ý][\p{L}'’.-]+(?:\s+[A-ZÀ-Ýa-zà-ÿ][\p{L}'’.-]+){0,5}/giu,
    /\b(?:The Gazette|Magic Baking Powder|Coca-Cola|Molson|Holt Renfrew|Eaton|Tilden|Hertz)\b/giu,
    /\b[A-ZÀ-Ý][\p{L}'’.-]+(?:\s+(?:de|du|des|la|le|l'|d'|of|the|and|&)?\s*[A-ZÀ-Ý][\p{L}'’.-]+){1,4}/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const entity = clean(match[0])
        .replace(/\s+/g, ' ')
        .replace(/\.\s*(?:The|A|An)\b.*$/i, '')
        .replace(/\s+(?:Capturée|Capturee|En direction|On y aperçoit|Aujourd'hui|aujourd'hui|devenu|devenue)\b.*$/i, '')
        .replace(/\s+En$/i, '')
        .replace(/[.,;:()[\]{}]+$/g, '')
        .trim();
      if (
        entity.length >= 4
        && !/^(Archives|Ville|Montreal|Montréal|Capturée|Capturee|Décennie|Canada|The|A|An)$/i.test(entity)
        && !/\b(?:Capturée|Capturee)\b/i.test(entity)
      ) {
        entities.add(entity);
      }
    }
  }
  return Array.from(entities).slice(0, 16).sort();
}

function hasStrongEntitySignal(text: string): boolean {
  return /(magic baking powder|the gazette|coca-cola|rue |avenue |boulevard |parc |pont |gare |eglise|église|hotel|hôtel|edifice|édifice|theatre|théâtre|factory|usine|canal|port)/i.test(text);
}

function groupById<T extends { id?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = clean(row.id);
    if (!id) continue;
    map.set(id, [...(map.get(id) ?? []), row]);
  }
  return map;
}

function activeById(rows: ActiveLearningRow[]): Map<string, ActiveLearningRow> {
  const map = new Map<string, ActiveLearningRow>();
  for (const row of rows) {
    const id = clean(row.record?.id);
    if (id) map.set(id, row);
  }
  return map;
}

function scoreRecord(
  record: ArchiveRecord,
  taxonomy: TaxonomyRow | undefined,
  candidates: CandidateRow[],
  collections: CollectionRow[],
  family: FamilyMapRow | undefined,
  active: ActiveLearningRow | undefined,
): number {
  const text = `${title(record)} ${record.description ?? ''} ${record.vlm_caption ?? ''} ${(record.vlm_metadata?.search_terms ?? []).join(' ')}`;
  let score = 0;
  if (!/^mtl_archives_metadata_\d+\.json$/i.test(title(record))) score += 15;
  if (clean(record.description).length > 80) score += 15;
  if (hasStrongEntitySignal(text)) score += 28;
  if (extractEntities(text).length >= 2) score += 12;
  if (taxonomy?.primaryCategory?.includes('ground') || taxonomy?.primaryCategory === 'street_commercial') score += 8;
  if ((record.vlm_metadata?.search_terms ?? []).length) score += 7;
  if (candidates.length) score += Math.min(14, candidates.length * 4);
  if (collections.length) score += Math.min(10, collections.length * 2);
  if (family?.primary_family_id) score += 4;
  if (active?.acquisition?.score) score += Math.min(10, active.acquisition.score / 10);
  if (sourceUrl(record)) score += 5;
  if (/magic baking powder/i.test(text)) score += 30;
  return Number(score.toFixed(2));
}

function packetForRecord(
  index: number,
  record: ArchiveRecord,
  score: number,
  taxonomy: TaxonomyRow | undefined,
  candidates: CandidateRow[],
  collections: CollectionRow[],
  quality: QualityRow | undefined,
  family: FamilyMapRow | undefined,
  active: ActiveLearningRow | undefined,
  selectedAt: string,
): ResearchPacket {
  const recordId = clean(record.metadata_filename);
  const image = imagePath(record);
  const srcUrl = sourceUrl(record);
  const text = `${title(record)} ${record.description ?? ''} ${record.vlm_caption ?? ''} ${(record.vlm_metadata?.search_terms ?? []).join(' ')}`;
  const entities = extractEntities(text);
  const searchTerms = unique([
    ...entities,
    title(record),
    coteValue(record),
    ...(record.vlm_metadata?.search_terms ?? []),
    ...(taxonomy?.themes ?? []),
    ...(taxonomy?.searchFacets ?? []),
  ]).slice(0, 24);
  const candidateTypes = unique(candidates.map((row) => clean(row.candidate_type)));
  const collectionIds = unique(collections.map((row) => clean(row.collection_id)));
  const riskFlags = unique([
    ...(quality?.recommendedAction === 'exclude_until_fixed' ? ['image_unavailable_or_decode_failed'] : []),
    ...(quality?.labels ?? []).map((label) => `quality:${label}`),
    ...(entities.length === 0 ? ['low_entity_signal'] : []),
    ...(srcUrl ? [] : ['missing_primary_source_url']),
    ...(hasStrongEntitySignal(text) && !srcUrl ? ['verification_needed_for_named_entity'] : []),
    ...(taxonomy?.reviewRequired ? ['taxonomy_review_required'] : []),
  ]);
  const researchDepth = quality?.recommendedAction === 'exclude_until_fixed'
    ? 'source_recovery_candidate'
    : score >= 55
      ? 'deep_candidate'
      : 'shallow_candidate';

  const observedFacts = unique([
    record.vlm_caption ? `Image model caption: ${shortSnippet(record.vlm_caption, 180)}` : '',
    taxonomy?.primaryCategory ? `Taxonomy category: ${taxonomy.primaryCategory}` : '',
    taxonomy?.vantage ? `Vantage: ${taxonomy.vantage}` : '',
    ...(record.vlm_metadata?.visual_subjects ?? []).map((subject) => `Visual subject: ${subject}`),
  ]).map((item) => claim(item, 'observed_model', 'vlm/taxonomy', null, 0.62, ['model_observed_not_verified']));

  const metadataClaims = [
    title(record) ? claim(`Title/name: ${shortSnippet(title(record), 180)}`, 'metadata', 'name', srcUrl, 0.86) : null,
    dateValue(record) ? claim(`Date: ${dateValue(record)}`, 'metadata', 'attributes_map.Date', srcUrl, 0.82) : null,
    coteValue(record) ? claim(`Cote/reference: ${coteValue(record)}`, 'metadata', 'cote/attributes_map.Cote', srcUrl, 0.86) : null,
    record.description ? claim(`Description summary: ${shortSnippet(record.description, 220)}`, 'metadata', 'description', srcUrl, 0.78) : null,
  ].filter((item): item is EvidenceClaim => Boolean(item));

  const inferenceClaims = [
    ...entities.slice(0, 8).map((entity) => claim(
      `Researchable entity candidate: ${entity}`,
      'inferred',
      'title/description/vlm',
      srcUrl,
      0.56,
      ['requires_external_or_source_verification'],
    )),
    ...(candidateTypes.length ? [claim(`Candidate surfaces: ${candidateTypes.join(', ')}`, 'inferred', 'candidate_discovery', null, 0.68)] : []),
    ...(family?.primary_family_id ? [claim(`Belongs to visual family ${family.primary_family_type}: ${family.primary_family_id}`, 'inferred', 'visual_family_graph_v0', null, 0.74)] : []),
  ];

  const verifiedClaims = [
    srcUrl ? claim('Primary archive/source URL is present for source follow-up.', 'verified_source', 'external_url', srcUrl, 0.88) : null,
    claim(`Rights baseline: ${LICENSE_ID}; attribution required to Archives de la Ville de Montréal.`, 'verified_source', 'rights_policy', LICENSE_URL, 0.82),
  ].filter((item): item is EvidenceClaim => Boolean(item));

  const unresolved = unique([
    ...(entities.length ? entities.slice(0, 5).map((entity) => `Verify identity/context for ${entity}.`) : ['Identify whether there are named places, institutions, signs, or events worth deeper research.']),
    ...(srcUrl ? ['Check source page/record for richer notes, creator, and exact rights wording.'] : ['Recover source URL before making external claims.']),
    ...(taxonomy?.primaryCategory?.startsWith('aerial') ? ['If aerial, determine whether location can be bounded without overclaiming exact coordinates.'] : []),
  ]).map((item) => claim(item, 'unresolved', null, srcUrl, 0.5, ['do_not_assert_until_resolved']));

  return {
    schema_version: 'research_enrichment_packet_v0',
    packet_id: `research-enrichment-v0-${String(index + 1).padStart(4, '0')}`,
    record_id: recordId,
    selected_at: selectedAt,
    research_depth: researchDepth,
    provenance_fit_score: score,
    title: title(record),
    date: dateValue(record),
    cote: coteValue(record),
    image_url: r2Url(image) ?? srcUrl,
    source_url: srcUrl,
    rights: {
      license_id: LICENSE_ID,
      license_url: LICENSE_URL,
      credit_line: clean(record.credits || record.attributes_map?.Credits || 'Archives de la Ville de Montréal'),
      commercial_use_allowed: true,
      attribution_required: true,
    },
    source_context: {
      family_id: clean(family?.primary_family_id) || null,
      family_type: clean(family?.primary_family_type) || null,
      active_learning_score: active?.acquisition?.score ?? null,
      candidate_types: candidateTypes,
      collection_ids: collectionIds,
      quality_labels: quality?.labels ?? [],
    },
    evidence: {
      observed_visual_facts: observedFacts,
      metadata_claims: metadataClaims,
      inferences: inferenceClaims,
      verified: verifiedClaims,
      unresolved_questions: unresolved,
    },
    research_targets: {
      entities,
      search_terms: searchTerms,
      source_urls_to_check: unique([srcUrl ?? '', LICENSE_URL]),
      suggested_queries: unique([
        ...entities.slice(0, 6).map((entity) => `${entity} Montréal archives`),
        title(record) ? `${title(record)} Montréal` : '',
        coteValue(record) ? `${coteValue(record)} Archives de Montréal` : '',
      ]).slice(0, 10),
    },
    risk_flags: riskFlags,
    recommendation: researchDepth === 'deep_candidate'
      ? 'Deep research candidate: source-check entities, preserve evidence boundaries, and consider Provenance/City Memory demo use.'
      : researchDepth === 'source_recovery_candidate'
        ? 'Recover/fix image or source availability before deep research.'
        : 'Keep shallow for now; enrich only if it enters a product/story queue.',
  };
}

function renderReviewSheet(packets: ResearchPacket[], report: Record<string, unknown>): string {
  const cards = packets.map((packet) => `<article>
  <header>
    <div>
      <h2>${htmlEscape(packet.title)}</h2>
      <p>${htmlEscape(packet.record_id)} · score ${packet.provenance_fit_score} · ${htmlEscape(packet.research_depth)}</p>
    </div>
    <span>${htmlEscape(packet.risk_flags.slice(0, 2).join(', ') || 'ready')}</span>
  </header>
  <div class="body">
    ${packet.image_url ? `<img src="${htmlEscape(packet.image_url)}" alt="${htmlEscape(packet.record_id)}">` : '<div class="missing">No image</div>'}
    <section>
      <h3>Entities</h3>
      <p>${htmlEscape(packet.research_targets.entities.join(', ') || 'None detected')}</p>
      <h3>Metadata Claims</h3>
      <ul>${packet.evidence.metadata_claims.slice(0, 4).map((item) => `<li>${htmlEscape(item.claim)}</li>`).join('')}</ul>
      <h3>Unresolved</h3>
      <ul>${packet.evidence.unresolved_questions.slice(0, 4).map((item) => `<li>${htmlEscape(item.claim)}</li>`).join('')}</ul>
    </section>
  </div>
</article>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Research Enrichment v0 Review Sheet</title>
  <style>
    body { margin: 0; background: #f4f1eb; color: #1d1a16; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 24px 0; }
    .stat { border: 1px solid #d5ccbd; background: #fffaf2; border-radius: 8px; padding: 14px; }
    .stat strong { display: block; font-size: 24px; }
    article { border-top: 1px solid #c9bcaa; padding: 24px 0; }
    header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
    h2 { margin: 0; font-size: 20px; }
    p { line-height: 1.45; }
    header p { margin: 4px 0 0; color: #61584f; }
    header span { border: 1px solid #1d1a16; border-radius: 999px; padding: 5px 9px; max-width: 320px; }
    .body { display: grid; grid-template-columns: minmax(220px, 360px) 1fr; gap: 18px; margin-top: 16px; }
    img, .missing { width: 100%; height: 260px; object-fit: cover; background: #1d1a16; color: #fffaf2; border-radius: 8px; display: grid; place-items: center; }
    h3 { margin: 0 0 6px; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; }
    ul { margin-top: 0; padding-left: 20px; }
    @media (max-width: 760px) { .body { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Research Enrichment v0 Review Sheet</h1>
    <p>Generated at ${htmlEscape(report.generated_at)}. Packets separate observed model output, metadata, inference, verified source facts, and unresolved questions.</p>
    <section class="stats">
      <div class="stat"><strong>${htmlEscape(report.packets)}</strong><span>packets</span></div>
      <div class="stat"><strong>${htmlEscape(report.deep_candidates)}</strong><span>deep candidates</span></div>
      <div class="stat"><strong>${htmlEscape(report.source_recovery_candidates)}</strong><span>source recovery</span></div>
      <div class="stat"><strong>${htmlEscape(report.unique_entities)}</strong><span>unique entities</span></div>
    </section>
    ${cards}
  </main>
</body>
</html>`;
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Research Enrichment v0

Generated at: ${report.generated_at}

## Summary

- Packets: ${report.packets}
- Deep candidates: ${report.deep_candidates}
- Source recovery candidates: ${report.source_recovery_candidates}
- Unique entities: ${report.unique_entities}
- Output directory: \`${report.output_dir}\`

## Selection Breakdown

\`\`\`json
${JSON.stringify(report.breakdown, null, 2)}
\`\`\`

## Decision

${report.decision}

## Caveats

${(report.caveats as string[]).map((line) => `- ${line}`).join('\n')}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      quality: { type: 'string', default: DEFAULT_QUALITY },
      'family-map': { type: 'string', default: DEFAULT_FAMILY_MAP },
      'active-queue': { type: 'string', default: DEFAULT_ACTIVE_QUEUE },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '50' },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const taxonomyPath = resolveRepoPath(values.taxonomy!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const collectionsPath = resolveRepoPath(values.collections!);
  const qualityPath = resolveRepoPath(values.quality!);
  const familyMapPath = resolveRepoPath(values['family-map']!);
  const activeQueuePath = resolveRepoPath(values['active-queue']!);
  const outputDir = resolveRepoPath(values.output!);
  const limit = Number.parseInt(values.limit!, 10);
  if (!Number.isFinite(limit) || limit < 25 || limit > 100) {
    throw new Error('--limit must be between 25 and 100');
  }
  requireArtifacts([
    { path: manifestPath, label: 'VLM structured manifest' },
    { path: taxonomyPath, label: 'taxonomy downstream rows' },
    { path: candidatesPath, label: 'candidate downstream rows' },
    { path: collectionsPath, label: 'collection downstream rows' },
    { path: qualityPath, label: 'image-quality labels' },
    { path: familyMapPath, label: 'visual family graph record map' },
    { path: activeQueuePath, label: 'active-learning queue' },
  ]);

  const manifest = readJsonl<ArchiveRecord>(manifestPath).filter((row) => clean(row.metadata_filename));
  const taxonomyById = new Map(readJsonl<TaxonomyRow>(taxonomyPath).map((row) => [clean(row.id), row]));
  const candidatesById = groupById(readJsonl<CandidateRow>(candidatesPath));
  const collectionsById = groupById(readJsonl<CollectionRow>(collectionsPath));
  const qualityById = new Map(readJsonl<QualityRow>(qualityPath).map((row) => [clean(row.id), row]));
  const familyById = new Map(readJsonl<FamilyMapRow>(familyMapPath).map((row) => [clean(row.record_id), row]));
  const activeMap = activeById(readJsonl<ActiveLearningRow>(activeQueuePath));

  const selectedAt = datasetFactoryNowIso();
  const scored = manifest
    .map((record) => {
      const id = clean(record.metadata_filename);
      return {
        record,
        id,
        score: scoreRecord(
          record,
          taxonomyById.get(id),
          candidatesById.get(id) ?? [],
          collectionsById.get(id) ?? [],
          familyById.get(id),
          activeMap.get(id),
        ),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const packets = scored.slice(0, limit).map((item, index) => packetForRecord(
    index,
    item.record,
    item.score,
    taxonomyById.get(item.id),
    candidatesById.get(item.id) ?? [],
    collectionsById.get(item.id) ?? [],
    qualityById.get(item.id),
    familyById.get(item.id),
    activeMap.get(item.id),
    selectedAt,
  ));

  const deepQueue = packets
    .filter((packet) => packet.research_depth === 'deep_candidate')
    .slice(0, 25)
    .map((packet) => ({
      schema_version: 'research_enrichment_deep_queue_v0',
      packet_id: packet.packet_id,
      record_id: packet.record_id,
      score: packet.provenance_fit_score,
      title: packet.title,
      source_url: packet.source_url,
      entities: packet.research_targets.entities,
      suggested_queries: packet.research_targets.suggested_queries,
      first_unresolved_questions: packet.evidence.unresolved_questions.slice(0, 4).map((item) => item.claim),
    }));

  fs.mkdirSync(outputDir, { recursive: true });
  const packetPath = path.join(outputDir, 'research-enrichment-packets-v0.jsonl');
  const deepQueuePath = path.join(outputDir, 'research-enrichment-deep-queue-v0.jsonl');
  const reportJsonPath = path.join(outputDir, 'research-enrichment-v0-report.json');
  const reportMdPath = path.join(outputDir, 'research-enrichment-v0-report.md');
  const reviewSheetPath = path.join(outputDir, 'research-enrichment-v0-review-sheet.html');

  const allEntities = unique(packets.flatMap((packet) => packet.research_targets.entities));
  const report = {
    generated_at: selectedAt,
    issue: 56,
    output_dir: rel(outputDir),
    inputs: {
      manifest: rel(manifestPath),
      taxonomy: rel(taxonomyPath),
      candidates: rel(candidatesPath),
      collections: rel(collectionsPath),
      quality: rel(qualityPath),
      family_map: rel(familyMapPath),
      active_queue: rel(activeQueuePath),
    },
    source_rows: manifest.length,
    packets: packets.length,
    deep_candidates: packets.filter((packet) => packet.research_depth === 'deep_candidate').length,
    shallow_candidates: packets.filter((packet) => packet.research_depth === 'shallow_candidate').length,
    source_recovery_candidates: packets.filter((packet) => packet.research_depth === 'source_recovery_candidate').length,
    unique_entities: allEntities.length,
    breakdown: {
      by_depth: countBy(packets, (packet) => packet.research_depth),
      by_top_risk_flag: countBy(packets, (packet) => packet.risk_flags[0] ?? 'none'),
      candidate_types: countBy(packets.flatMap((packet) => packet.source_context.candidate_types), (value) => value),
      collection_ids_top_20: Object.entries(countBy(packets.flatMap((packet) => packet.source_context.collection_ids), (value) => value))
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20),
    },
    top_packets: packets.slice(0, 12).map((packet) => ({
      packet_id: packet.packet_id,
      record_id: packet.record_id,
      title: packet.title,
      score: packet.provenance_fit_score,
      depth: packet.research_depth,
      entities: packet.research_targets.entities.slice(0, 8),
      risk_flags: packet.risk_flags.slice(0, 6),
    })),
    decision: 'Research Enrichment v0 has enough packets to feed Provenance/City Memory demos, but packets must be treated as evidence-bounded research prompts, not verified essays.',
    caveats: [
      'No broad external web search was performed in this generator; verified facts are limited to source URL and rights/source metadata boundaries.',
      'Observed visual facts come from VLM/taxonomy outputs and are marked model-observed, not human-verified.',
      'Exact locations, identities, brands, and event context remain unresolved unless represented in metadata/source evidence.',
      'Packets intentionally avoid long copied source text; source checks should store short notes and URLs only.',
    ],
  };

  writeJsonl(packetPath, packets);
  writeJsonl(deepQueuePath, deepQueue);
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(reportMdPath, renderMarkdown(report), 'utf-8');
  fs.writeFileSync(reviewSheetPath, renderReviewSheet(packets, report), 'utf-8');

  console.log(`Wrote Research Enrichment v0 to ${rel(outputDir)}`);
  console.log(`- packets=${packets.length}`);
  console.log(`- deep_candidates=${report.deep_candidates}`);
  console.log(`- unique_entities=${allEntities.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
