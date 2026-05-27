import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates/candidates.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections',
);

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  description?: string;
  external_url?: string;
  image_exists?: boolean;
  image_size_bytes?: number;
  attributes_map?: Record<string, unknown>;
  vlm_caption?: string | null;
  vlm_error?: string | null;
  vlm_metadata_error?: string | null;
  vlm_metadata?: {
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
  } | null;
};

type CandidateReport = {
  rare_find_candidates?: CandidateRecord[];
  sequence_candidates?: SequenceCandidate[];
  social_candidates?: CandidateRecord[];
  print_candidates?: CandidateRecord[];
};

type CandidateRecord = {
  id: string;
  title: string;
  date: string;
  cote: string;
  imageUrl: string;
  imagePath: string;
  score: number;
  reasons: string[];
  vlmCaption?: string | null;
  socialHook?: string | null;
  metadata?: ArchiveRecord['vlm_metadata'];
};

type SequenceCandidate = {
  sequenceId: string;
  flight: string;
  frameStart: number;
  frameEnd: number;
  length: number;
  avgEmbeddingDistance: number;
  score: number;
  dominantSceneTypes?: Record<string, number>;
  representativeSubjects?: string[];
  records: CandidateRecord[];
};

type CollectionRecord = CandidateRecord & {
  matchScore: number;
  matchReasons: string[];
};

type Collection = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  collectionType: 'theme' | 'sequence' | 'editorial';
  intendedSurfaces: string[];
  confidence: number;
  usefulnessNotes: string[];
  sourceSignals: string[];
  representativeImages: CandidateRecord[];
  records: CollectionRecord[];
};

type ThemeSpec = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  include: string[];
  boost?: string[];
  surfaces: string[];
  minRecords?: number;
};

const THEME_SPECS: ThemeSpec[] = [
  {
    id: 'waterfront-industry',
    title: 'Waterfront Industry and Port Edges',
    summary: 'Riverfront infrastructure, industrial waterfronts, canals, port edges, and working shoreline views.',
    tags: ['waterfront', 'industry', 'river', 'port'],
    include: ['waterfront', 'river', 'canal', 'port', 'industrial', 'factory', 'ship', 'boat', 'dock', 'shoreline', 'warehouse'],
    boost: ['excellent', 'aerial', 'social hook'],
    surfaces: ['search browse collection', 'story page', 'social carousel', 'print review'],
  },
  {
    id: 'parks-public-leisure',
    title: 'Parks, Fountains, and Public Leisure',
    summary: 'Public parks, fountains, sports grounds, green spaces, and leisure scenes with strong social/story potential.',
    tags: ['parks', 'leisure', 'public space'],
    include: ['park', 'fountain', 'field', 'stadium', 'baseball', 'football', 'playground', 'garden', 'pond', 'duck', 'trees'],
    boost: ['street_scene', 'excellent', 'social hook'],
    surfaces: ['search browse collection', 'social carousel', 'story page'],
  },
  {
    id: 'bridges-roads-infrastructure',
    title: 'Bridges, Highways, and City Infrastructure',
    summary: 'Bridges, highways, road networks, intersections, and transportation infrastructure seen from the air and street.',
    tags: ['bridges', 'roads', 'infrastructure'],
    include: ['bridge', 'highway', 'road', 'intersection', 'street', 'railway', 'train', 'tracks', 'overpass', 'tramway'],
    boost: ['aerial', 'excellent', 'river'],
    surfaces: ['search browse collection', 'story page', 'social carousel'],
  },
  {
    id: 'vanished-streets-civic-life',
    title: 'Street Scenes and Civic Life',
    summary: 'Ground-level street scenes, schools, civic buildings, storefronts, people, and daily urban life.',
    tags: ['street scenes', 'civic life', 'people'],
    include: ['street_scene', 'people', 'children', 'school', 'classroom', 'storefront', 'church', 'building', 'sidewalk', 'car', 'horse'],
    boost: ['ground', 'document', 'social hook'],
    surfaces: ['story page', 'social carousel', 'search browse collection'],
  },
  {
    id: 'aerial-neighborhood-grid',
    title: 'Aerial Neighborhood Grids',
    summary: 'Dense aerial views of residential blocks, street grids, houses, and neighborhood fabric across decades.',
    tags: ['aerial', 'neighborhoods', 'urban grid'],
    include: ['aerial_view', 'houses', 'residential', 'neighborhood', 'streets', 'buildings', 'city', 'blocks', 'urban'],
    boost: ['excellent', 'aerial', 'search terms'],
    surfaces: ['search browse collection', 'story page', 'product/editorial review'],
  },
  {
    id: 'winter-and-seasonal-city',
    title: 'Winter and Seasonal City',
    summary: 'Winter streets, snow-covered scenes, seasonal contrasts, and weather-specific archive views.',
    tags: ['winter', 'snow', 'seasonal'],
    include: ['winter', 'snow', 'ice', 'frozen', 'skating', 'sled', 'traineau'],
    boost: ['street_scene', 'social hook', 'rare'],
    surfaces: ['social carousel', 'story page', 'search browse collection'],
    minRecords: 8,
  },
  {
    id: 'stadiums-events-venues',
    title: 'Stadiums, Venues, and Event Grounds',
    summary: 'Stadiums, sports fields, parking lots, large venues, and event-scale urban spaces.',
    tags: ['stadiums', 'venues', 'events'],
    include: ['stadium', 'football', 'baseball', 'sports', 'parking lot', 'venue', 'field', 'arena'],
    boost: ['excellent', 'social hook', 'aerial'],
    surfaces: ['social carousel', 'story page', 'print review'],
  },
  {
    id: 'rural-edges-farms',
    title: 'Rural Edges and Farms',
    summary: 'Fields, farms, rural roads, and the edge conditions where Montreal expands into surrounding land.',
    tags: ['rural', 'farms', 'urban edge'],
    include: ['farm', 'field', 'rural', 'dirt road', 'crop', 'barn', 'countryside', 'open land'],
    boost: ['aerial', 'excellent', 'sequence'],
    surfaces: ['search browse collection', 'story page', 'print review'],
  },
  {
    id: 'rare-objects-documents',
    title: 'Rare Objects, Documents, and Unusual Views',
    summary: 'Visually unusual records, document-like frames, rare subjects, and outliers worth manual editorial review.',
    tags: ['rare finds', 'documents', 'outliers'],
    include: ['document', 'map_or_document', 'poster', 'sign', 'horse', 'train', 'coal mine', 'open pit', 'classroom', 'duck'],
    boost: ['rare', 'embedding isolation', 'excellent'],
    surfaces: ['editorial review', 'story page', 'social carousel'],
  },
  {
    id: 'print-ready-aerials',
    title: 'Print-Ready Aerials',
    summary: 'High-quality, visually coherent aerial records that can seed print/product review workflows.',
    tags: ['print', 'aerial', 'product'],
    include: ['aerial_view', 'excellent', 'waterfront', 'river', 'city', 'road', 'houses', 'park'],
    boost: ['tif', 'image bytes', 'print quality excellent'],
    surfaces: ['print review', 'product landing surface', 'search browse collection'],
  },
];

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function readJsonl(filePath: string): ArchiveRecord[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ArchiveRecord;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
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

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'collection';
}

function titleValue(record: ArchiveRecord): string {
  return cleanText(record.name || record.metadata_filename || record.image_filename);
}

function dateValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Date);
}

function coteValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Cote);
}

function imagePath(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function imageUrl(record: ArchiveRecord, candidateById: Map<string, CandidateRecord>): string {
  const id = cleanText(record.metadata_filename);
  return cleanText(candidateById.get(id)?.imageUrl) || cleanText(record.external_url);
}

function textForRecord(record: ArchiveRecord): string {
  const metadata = record.vlm_metadata;
  return normalize([
    record.metadata_filename,
    record.image_filename,
    record.name,
    record.description,
    record.vlm_caption,
    metadata?.caption,
    metadata?.scene_type,
    metadata?.setting,
    metadata?.season,
    metadata?.aerial_ground_document,
    metadata?.social_hook,
    metadata?.print_quality,
    metadata?.quality_notes,
    ...(metadata?.visual_subjects ?? []),
    ...(metadata?.search_terms ?? []),
  ].join(' '));
}

function candidateSources(report: CandidateReport): Map<string, { score: number; types: string[]; reasons: string[] }> {
  const map = new Map<string, { score: number; types: string[]; reasons: string[] }>();
  const add = (type: string, candidates: CandidateRecord[] | undefined) => {
    for (const candidate of candidates ?? []) {
      const current = map.get(candidate.id) ?? { score: 0, types: [], reasons: [] };
      current.score = Math.max(current.score, candidate.score);
      current.types.push(type);
      current.reasons.push(...(candidate.reasons ?? []).slice(0, 2));
      map.set(candidate.id, current);
    }
  };
  add('rare_find', report.rare_find_candidates);
  add('social', report.social_candidates);
  add('print', report.print_candidates);
  for (const sequence of report.sequence_candidates ?? []) add(`sequence:${sequence.sequenceId}`, sequence.records);
  return map;
}

function candidateRecordFromArchive(
  record: ArchiveRecord,
  score: number,
  candidateById: Map<string, CandidateRecord>,
): CandidateRecord {
  const id = cleanText(record.metadata_filename);
  const fromCandidate = candidateById.get(id);
  return {
    id,
    title: titleValue(record),
    date: dateValue(record),
    cote: coteValue(record),
    imageUrl: imageUrl(record, candidateById),
    imagePath: imagePath(record),
    score: Number(score.toFixed(4)),
    reasons: fromCandidate?.reasons ?? [],
    vlmCaption: record.vlm_caption ?? record.vlm_metadata?.caption ?? null,
    socialHook: record.vlm_metadata?.social_hook ?? null,
    metadata: record.vlm_metadata,
  };
}

function themeScore(record: ArchiveRecord, text: string, spec: ThemeSpec, source?: { score: number; types: string[]; reasons: string[] }): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const term of spec.include) {
    if (text.includes(normalize(term))) {
      score += 1;
      if (reasons.length < 5) reasons.push(`matches ${term}`);
    }
  }
  for (const term of spec.boost ?? []) {
    if (text.includes(normalize(term)) || source?.reasons.some((reason) => normalize(reason).includes(normalize(term)))) {
      score += 0.35;
      if (reasons.length < 7) reasons.push(`boost ${term}`);
    }
  }
  if (source?.types.includes('rare_find')) score += 0.4;
  if (source?.types.includes('social')) score += 0.35;
  if (source?.types.includes('print')) score += 0.3;
  if (record.vlm_error || record.vlm_metadata_error) score -= 1;
  if (!record.vlm_metadata) score -= 0.5;
  return { score, reasons };
}

function selectDiverseRecords(records: CollectionRecord[], limit: number): CollectionRecord[] {
  const selected: CollectionRecord[] = [];
  const byTitle = new Map<string, number>();
  const bySequence = new Map<string, number>();
  for (const record of records) {
    const titleKey = normalize(record.title || record.id);
    const sequenceKey = normalize(record.title.match(/VM97,S\d+,D\d+/i)?.[0] || record.title.match(/VM97-3_[0-9A-Z]+/i)?.[0] || '');
    if ((byTitle.get(titleKey) ?? 0) >= 2) continue;
    if (sequenceKey && (bySequence.get(sequenceKey) ?? 0) >= 8) continue;
    selected.push(record);
    byTitle.set(titleKey, (byTitle.get(titleKey) ?? 0) + 1);
    if (sequenceKey) bySequence.set(sequenceKey, (bySequence.get(sequenceKey) ?? 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function topTerms(records: CollectionRecord[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const value of [
      record.metadata?.scene_type,
      record.metadata?.setting,
      record.metadata?.season,
      ...(record.metadata?.visual_subjects ?? []),
      ...(record.metadata?.search_terms ?? []),
    ]) {
      const normalized = normalize(value);
      if (!normalized || normalized === 'unknown') continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term]) => term);
}

function buildThemeCollections(records: ArchiveRecord[], report: CandidateReport, limitPerCollection: number): Collection[] {
  const flatCandidates = [
    ...(report.rare_find_candidates ?? []),
    ...(report.social_candidates ?? []),
    ...(report.print_candidates ?? []),
    ...(report.sequence_candidates ?? []).flatMap((sequence) => sequence.records ?? []),
  ];
  const candidateById = new Map(flatCandidates.map((candidate) => [candidate.id, candidate]));
  const sources = candidateSources(report);
  const collections: Collection[] = [];

  for (const spec of THEME_SPECS) {
    const matched: CollectionRecord[] = [];
    for (const record of records) {
      const id = cleanText(record.metadata_filename);
      if (!id) continue;
      const candidate = candidateById.get(id);
      const source = sources.get(id);
      const scored = themeScore(record, textForRecord(record), spec, source);
      if (scored.score <= 0) continue;
      const baseScore = scored.score + (source?.score ?? 0) * 0.75;
      const candidateRecord = candidateRecordFromArchive(record, baseScore, candidateById);
      matched.push({
        ...candidateRecord,
        matchScore: Number(baseScore.toFixed(4)),
        matchReasons: [...scored.reasons, ...(source?.types ?? []).slice(0, 3).map((type) => `candidate ${type}`)],
      });
    }

    const selected = selectDiverseRecords(matched.sort((a, b) => b.matchScore - a.matchScore), limitPerCollection);
    if (selected.length < (spec.minRecords ?? 10)) continue;
    const confidence = Math.min(0.98, 0.45 + Math.min(selected.length, 30) / 60 + Math.min(selected[0].matchScore, 5) / 12);
    collections.push({
      id: spec.id,
      title: spec.title,
      summary: `${spec.summary} Built from ${selected.length} records; strongest repeated signals include ${topTerms(selected, 5).join(', ') || spec.tags.join(', ')}.`,
      tags: spec.tags,
      collectionType: 'theme',
      intendedSurfaces: spec.surfaces,
      confidence: Number(confidence.toFixed(3)),
      usefulnessNotes: [
        'Useful as a curated search/browse landing collection.',
        selected.some((row) => row.matchReasons.some((reason) => reason.includes('candidate social')))
          ? 'Includes records already scored as social-ready.'
          : 'Needs editorial copy review before social use.',
        selected.some((row) => row.matchReasons.some((reason) => reason.includes('candidate print')))
          ? 'Includes records already scored as print-ready.'
          : 'Print suitability should be checked before product use.',
      ],
      sourceSignals: ['full structured VLM metadata', 'candidate discovery scores', 'record title/date/cote metadata'],
      representativeImages: selected.slice(0, 6),
      records: selected,
    });
  }
  return collections;
}

function buildSequenceCollections(report: CandidateReport): Collection[] {
  return (report.sequence_candidates ?? []).slice(0, 8).map((sequence, index) => {
    const records = (sequence.records ?? []).map((record) => ({
      ...record,
      matchScore: record.score,
      matchReasons: [`flight/frame sequence ${sequence.sequenceId}`, `${sequence.length} detected frames`, `avg embedding distance ${sequence.avgEmbeddingDistance}`],
    }));
    return {
      id: `sequence-${slug(sequence.sequenceId)}`,
      title: `Aerial Flight Run ${sequence.sequenceId}`,
      summary: `A coherent aerial run from frame ${sequence.frameStart} to ${sequence.frameEnd}, with ${sequence.length} detected records and average embedding distance ${sequence.avgEmbeddingDistance}. Repeated visual subjects include ${(sequence.representativeSubjects ?? []).slice(0, 6).join(', ') || 'aerial city fabric'}.`,
      tags: ['aerial sequence', sequence.flight, ...(sequence.representativeSubjects ?? []).slice(0, 4)],
      collectionType: 'sequence' as const,
      intendedSurfaces: ['story page', 'search browse collection', 'before/after or route experiment'],
      confidence: Number(Math.min(0.99, 0.72 + Math.min(sequence.length, 100) / 500 - sequence.avgEmbeddingDistance).toFixed(3)),
      usefulnessNotes: [
        'Useful for story pages and browsing by coherent aerial route.',
        'Representative records are capped for review; the source sequence candidate retains the full detected length.',
        index < 3 ? 'High priority because this is one of the longest/coherent detected runs.' : 'Good secondary sequence candidate.',
      ],
      sourceSignals: ['sequence filename pattern', '2D embedding continuity', 'VLM subject summaries'],
      representativeImages: records.slice(0, 6),
      records,
    };
  });
}

function buildEditorialCollections(report: CandidateReport): Collection[] {
  const rare = (report.rare_find_candidates ?? []).slice(0, 18).map((record) => ({
    ...record,
    matchScore: record.score,
    matchReasons: ['top rare-find candidate', ...(record.reasons ?? []).slice(0, 3)],
  }));
  const social = (report.social_candidates ?? []).slice(0, 18).map((record) => ({
    ...record,
    matchScore: record.score,
    matchReasons: ['top social candidate', ...(record.reasons ?? []).slice(0, 3)],
  }));
  const print = (report.print_candidates ?? []).slice(0, 18).map((record) => ({
    ...record,
    matchScore: record.score,
    matchReasons: ['top print candidate', ...(record.reasons ?? []).slice(0, 3)],
  }));

  return [
    {
      id: 'editorial-rare-finds',
      title: 'Editorial Rare Finds Queue',
      summary: 'A manual review queue for unusually isolated or semantically rare records that may deserve stories, explainers, or collection placement.',
      tags: ['rare finds', 'editorial review'],
      collectionType: 'editorial',
      intendedSurfaces: ['editorial review', 'story page', 'social carousel'],
      confidence: 0.9,
      usefulnessNotes: ['Built directly from rare-find scores.', 'Best used as a human editorial triage list.'],
      sourceSignals: ['candidate discovery rare-find output'],
      representativeImages: rare.slice(0, 6),
      records: rare,
    },
    {
      id: 'editorial-social-ready',
      title: 'Social-Ready Visual Hooks',
      summary: 'Records with strong social hook text, rich VLM subjects, and usable image URLs for carousel or reel package experiments.',
      tags: ['social', 'hooks', 'carousel'],
      collectionType: 'editorial',
      intendedSurfaces: ['social carousel', 'daily reel candidate pool'],
      confidence: 0.92,
      usefulnessNotes: ['Can seed social package candidate selection.', 'Hooks still need brand/editorial rewrite before publishing.'],
      sourceSignals: ['candidate discovery social output', 'VLM social_hook field'],
      representativeImages: social.slice(0, 6),
      records: social,
    },
    {
      id: 'editorial-print-review',
      title: 'Print/Product Review Queue',
      summary: 'High quality image candidates with strong print-quality signals and enough metadata for product review surfaces.',
      tags: ['print', 'product', 'review'],
      collectionType: 'editorial',
      intendedSurfaces: ['print review', 'product landing surface'],
      confidence: 0.9,
      usefulnessNotes: ['Can seed print/product curation.', 'Requires visual inspection for crop, rights, and final production suitability.'],
      sourceSignals: ['candidate discovery print output', 'VLM print_quality field', 'image size/source URL metadata'],
      representativeImages: print.slice(0, 6),
      records: print,
    },
  ];
}

function renderMarkdown(report: any): string {
  const lines: string[] = [
    '# Autoresearch Visual Collections',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Collections: ${report.summary.collections}`,
    `- Theme collections: ${report.summary.theme_collections}`,
    `- Sequence collections: ${report.summary.sequence_collections}`,
    `- Editorial collections: ${report.summary.editorial_collections}`,
    `- Collection records: ${report.summary.collection_records}`,
    `- Downstream rows: ${report.summary.downstream_rows}`,
    '',
  ];

  for (const collection of report.collections) {
    lines.push(`## ${collection.title}`, '');
    lines.push(collection.summary, '');
    lines.push(`- ID: \`${collection.id}\``);
    lines.push(`- Type: ${collection.collectionType}`);
    lines.push(`- Confidence: ${collection.confidence}`);
    lines.push(`- Surfaces: ${collection.intendedSurfaces.join(', ')}`);
    lines.push(`- Tags: ${collection.tags.join(', ')}`);
    lines.push(`- Notes: ${collection.usefulnessNotes.join(' ')}`);
    lines.push('');
    lines.push('Representative images:');
    for (const record of collection.representativeImages.slice(0, 5)) {
      lines.push(`- \`${record.id}\` ${record.title || record.id} (${record.date || 'unknown date'}) — ${record.imageUrl}`);
    }
    lines.push('');
  }

  lines.push('## Downstream Contract', '');
  lines.push('- `collections.json` is the grouped review/report artifact.');
  lines.push('- `collections_downstream.jsonl` is one collection per line for app/social/product experiments.');
  lines.push('- `collection_records_downstream.jsonl` is one collection-record pair per line for search/story indexing or review UI import.');
  return `${lines.join('\n')}\n`;
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'limit-per-collection': { type: 'string', default: '24' },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const limitPerCollection = Number.parseInt(values['limit-per-collection']!, 10);

  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  if (!fs.existsSync(candidatesPath)) throw new Error(`Missing candidates report: ${candidatesPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const records = readJsonl(manifestPath);
  const candidateReport = readJson<CandidateReport>(candidatesPath);
  const themeCollections = buildThemeCollections(records, candidateReport, limitPerCollection);
  const sequenceCollections = buildSequenceCollections(candidateReport);
  const editorialCollections = buildEditorialCollections(candidateReport);
  const collections = [...themeCollections, ...sequenceCollections, ...editorialCollections]
    .sort((a, b) => b.confidence - a.confidence || b.records.length - a.records.length);

  const collectionRows = collections.map((collection) => ({
    collection_id: collection.id,
    title: collection.title,
    summary: collection.summary,
    collection_type: collection.collectionType,
    tags: collection.tags,
    intended_surfaces: collection.intendedSurfaces,
    confidence: collection.confidence,
    usefulness_notes: collection.usefulnessNotes,
    representative_images: collection.representativeImages.map((record) => ({
      id: record.id,
      imageUrl: record.imageUrl,
      imagePath: record.imagePath,
      title: record.title,
    })),
    record_count: collection.records.length,
  }));
  const collectionRecordRows = collections.flatMap((collection) => collection.records.map((record, index) => ({
    collection_id: collection.id,
    collection_title: collection.title,
    collection_type: collection.collectionType,
    rank: index + 1,
    id: record.id,
    title: record.title,
    date: record.date,
    cote: record.cote,
    imageUrl: record.imageUrl,
    imagePath: record.imagePath,
    score: record.score,
    matchScore: record.matchScore,
    matchReasons: record.matchReasons,
    socialHook: record.socialHook,
    vlmCaption: record.vlmCaption,
  })));

  const report = {
    generated_at: new Date().toISOString(),
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, manifestPath),
      candidates: path.relative(MONOREPO_ROOT, candidatesPath),
    },
    summary: {
      input_rows: records.length,
      collections: collections.length,
      theme_collections: themeCollections.length,
      sequence_collections: sequenceCollections.length,
      editorial_collections: editorialCollections.length,
      collection_records: collectionRecordRows.length,
      downstream_rows: collectionRows.length,
    },
    collections,
    downstream_contract: {
      collections: 'collections_downstream.jsonl',
      collection_records: 'collection_records_downstream.jsonl',
      required_collection_fields: ['collection_id', 'title', 'summary', 'representative_images', 'confidence', 'intended_surfaces'],
      required_record_fields: ['collection_id', 'id', 'imageUrl', 'imagePath', 'score', 'matchReasons'],
      intended_consumers: ['search browse surfaces', 'story page experiments', 'social package planning', 'print/product curation'],
    },
  };

  fs.writeFileSync(path.join(outputDir, 'collections.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'collections.md'), renderMarkdown(report));
  writeJsonl(path.join(outputDir, 'collections_downstream.jsonl'), collectionRows);
  writeJsonl(path.join(outputDir, 'collection_records_downstream.jsonl'), collectionRecordRows);

  console.log(`[autoresearch:collections] output=${outputDir}`);
  console.log(`[autoresearch:collections] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
