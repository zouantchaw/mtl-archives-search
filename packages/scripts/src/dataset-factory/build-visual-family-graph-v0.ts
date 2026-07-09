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
const DEFAULT_COLLECTION_RECORDS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
);
const DEFAULT_COLLECTIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collections_downstream.jsonl',
);
const DEFAULT_EMBEDDING_ROWS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl',
);
const DEFAULT_QUALITY_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
);
const DEFAULT_RERANKER_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/search_reranker_v0_prod/search_reranker_report.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/visual_family_graph_v0');
const DEFAULT_PUBLIC_R2_DOMAIN = 'pub-6a29793ea7664738880d1cc5afb21b87.r2.dev';

type FamilyType = 'exact_asset' | 'metadata_duplicate' | 'sequence_run' | 'embedding_neighbor';
type EdgeType = 'same_source_asset' | 'same_title_date' | 'same_sequence_run' | 'clip_near_neighbor';
type MemberRole = 'canonical' | 'related';

type ManifestRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  description?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  vlm_caption?: string | null;
};

type CollectionRecord = {
  collection_id?: string;
  collection_title?: string;
  collection_type?: string;
  rank?: number;
  id?: string;
  title?: string;
  date?: string;
  cote?: string;
  imageUrl?: string;
  imagePath?: string;
  score?: number;
  matchScore?: number;
  matchReasons?: string[];
  vlmCaption?: string | null;
};

type CollectionSummary = {
  collection_id?: string;
  title?: string;
  collection_type?: string;
  confidence?: number;
  record_count?: number;
};

type EmbeddingNeighborRow = {
  type: 'nearest_neighbors';
  id: string;
  primaryCategory?: string;
  themes?: string[];
  nearest?: Array<{
    id: string;
    primaryCategory?: string;
    themes?: string[];
    score?: number;
  }>;
};

type QualityRow = {
  id: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
};

type RecordInfo = {
  id: string;
  title: string;
  date: string;
  cote: string;
  imageUrl: string | null;
  imagePath: string | null;
  externalUrl: string | null;
  description: string;
  vlmCaption: string;
  collectionScores: number[];
  collectionIds: string[];
  qualityLabels: string[];
  qualitySeverity: string | null;
};

type VisualFamilyMember = {
  record_id: string;
  role: MemberRole;
  title: string;
  date: string;
  cote: string;
  image_url: string | null;
  image_path: string | null;
  score: number;
  reasons: string[];
};

type VisualFamily = {
  schema_version: 'visual_family_graph_v0';
  family_id: string;
  family_type: FamilyType;
  title: string;
  canonical_record_id: string;
  confidence: number;
  member_count: number;
  leakage_boundary: true;
  evidence_sources: string[];
  members: VisualFamilyMember[];
};

type VisualFamilyEdge = {
  schema_version: 'visual_family_graph_v0';
  edge_id: string;
  family_id: string;
  source_record_id: string;
  target_record_id: string;
  edge_type: EdgeType;
  weight: number;
  evidence: string[];
};

type FamilyCandidate = {
  familyType: FamilyType;
  edgeType: EdgeType;
  familyIdSeed: string;
  title: string;
  memberIds: string[];
  confidence: number;
  evidenceSources: string[];
  edgeEvidence: string[];
};

class UnionFind {
  parent = new Map<string, string>();
  rank = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    this.add(id);
    const parent = this.parent.get(id)!;
    if (parent !== id) {
      const root = this.find(parent);
      this.parent.set(id, root);
      return root;
    }
    return id;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }

  groups(): string[][] {
    const grouped = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const rows = grouped.get(root) ?? [];
      rows.push(id);
      grouped.set(root, rows);
    }
    return Array.from(grouped.values()).filter((rows) => rows.length > 1);
  }
}

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

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, '-').slice(0, 80) || stableHash(value);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
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
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function shared(valuesA: string[] | undefined, valuesB: string[] | undefined): string[] {
  const setB = new Set((valuesB ?? []).map(normalize));
  return (valuesA ?? []).filter((value) => setB.has(normalize(value)));
}

function extractYear(value: unknown): string {
  const match = clean(value).match(/(18\d{2}|19\d{2}|20\d{2})/);
  return match ? match[1] : '';
}

function publicR2Url(imagePath: string | null, publicDomain: string): string | null {
  if (!imagePath) return null;
  return `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(imagePath)}`;
}

function titleLooksGeneric(title: string): boolean {
  return /^mtl_archives_metadata_\d+\.json$/i.test(title) || /^vm\d/i.test(title);
}

function upsertRecord(records: Map<string, RecordInfo>, incoming: Partial<RecordInfo> & { id: string }): void {
  const existing = records.get(incoming.id);
  const next: RecordInfo = {
    id: incoming.id,
    title: clean(incoming.title || existing?.title || incoming.id),
    date: clean(incoming.date || existing?.date),
    cote: clean(incoming.cote || existing?.cote),
    imageUrl: incoming.imageUrl ?? existing?.imageUrl ?? null,
    imagePath: incoming.imagePath ?? existing?.imagePath ?? null,
    externalUrl: incoming.externalUrl ?? existing?.externalUrl ?? null,
    description: clean(incoming.description || existing?.description),
    vlmCaption: clean(incoming.vlmCaption || existing?.vlmCaption),
    collectionScores: [...(existing?.collectionScores ?? []), ...(incoming.collectionScores ?? [])],
    collectionIds: unique([...(existing?.collectionIds ?? []), ...(incoming.collectionIds ?? [])]),
    qualityLabels: unique([...(existing?.qualityLabels ?? []), ...(incoming.qualityLabels ?? [])]),
    qualitySeverity: incoming.qualitySeverity ?? existing?.qualitySeverity ?? null,
  };
  if (!next.imageUrl) next.imageUrl = publicR2Url(next.imagePath, DEFAULT_PUBLIC_R2_DOMAIN);
  records.set(incoming.id, next);
}

function canonicalScore(record: RecordInfo): number {
  const titleScore = titleLooksGeneric(record.title) ? 0 : 3;
  const r2Score = record.imageUrl?.includes(DEFAULT_PUBLIC_R2_DOMAIN) ? 1 : 0;
  const collectionScore = record.collectionScores.length ? Math.max(...record.collectionScores) : 0;
  const qualityPenalty = record.qualityLabels.some((label) => /fetch|decode|unsafe/.test(label)) ? -3 : 0;
  const captionScore = record.vlmCaption ? 0.5 : 0;
  return titleScore + r2Score + collectionScore + qualityPenalty + captionScore;
}

function familyCandidateToFamily(
  candidate: FamilyCandidate,
  records: Map<string, RecordInfo>,
): { family: VisualFamily; edges: VisualFamilyEdge[] } | null {
  const memberRecords = unique(candidate.memberIds)
    .map((id) => records.get(id))
    .filter((row): row is RecordInfo => Boolean(row));
  if (memberRecords.length < 2) return null;

  memberRecords.sort((a, b) => canonicalScore(b) - canonicalScore(a) || a.id.localeCompare(b.id));
  const canonical = memberRecords[0];
  const familyId = `vf-${candidate.familyType}-${slug(candidate.familyIdSeed)}-${stableHash(memberRecords.map((row) => row.id).sort().join('|'))}`;
  const members: VisualFamilyMember[] = memberRecords.map((record) => ({
    record_id: record.id,
    role: record.id === canonical.id ? 'canonical' : 'related',
    title: record.title,
    date: record.date,
    cote: record.cote,
    image_url: record.imageUrl,
    image_path: record.imagePath,
    score: Number(canonicalScore(record).toFixed(4)),
    reasons: [
      ...candidate.edgeEvidence,
      ...record.collectionIds.slice(0, 3).map((collectionId) => `collection:${collectionId}`),
      ...record.qualityLabels.slice(0, 3).map((label) => `quality:${label}`),
    ],
  }));

  const family: VisualFamily = {
    schema_version: 'visual_family_graph_v0',
    family_id: familyId,
    family_type: candidate.familyType,
    title: candidate.title,
    canonical_record_id: canonical.id,
    confidence: candidate.confidence,
    member_count: members.length,
    leakage_boundary: true,
    evidence_sources: candidate.evidenceSources,
    members,
  };

  const edges: VisualFamilyEdge[] = [];
  for (const member of members) {
    if (member.record_id === canonical.id) continue;
    edges.push({
      schema_version: 'visual_family_graph_v0',
      edge_id: `edge-${stableHash(`${familyId}|${canonical.id}|${member.record_id}|${candidate.edgeType}`)}`,
      family_id: familyId,
      source_record_id: canonical.id,
      target_record_id: member.record_id,
      edge_type: candidate.edgeType,
      weight: candidate.confidence,
      evidence: candidate.edgeEvidence,
    });
  }

  if (candidate.familyType === 'sequence_run') {
    for (let i = 1; i < members.length; i += 1) {
      edges.push({
        schema_version: 'visual_family_graph_v0',
        edge_id: `edge-${stableHash(`${familyId}|sequence|${members[i - 1].record_id}|${members[i].record_id}`)}`,
        family_id: familyId,
        source_record_id: members[i - 1].record_id,
        target_record_id: members[i].record_id,
        edge_type: candidate.edgeType,
        weight: Math.max(0.75, candidate.confidence - 0.05),
        evidence: [...candidate.edgeEvidence, 'adjacent_sequence_member'],
      });
    }
  }

  return { family, edges };
}

function addGroupedCandidates(
  candidates: FamilyCandidate[],
  groups: Map<string, string[]>,
  type: FamilyType,
  edgeType: EdgeType,
  titlePrefix: string,
  confidence: number,
  evidenceSources: string[],
  edgeEvidence: string[],
  maxGroups = 500,
): void {
  const sorted = Array.from(groups.entries())
    .filter(([, ids]) => unique(ids).length > 1)
    .sort(([, a], [, b]) => unique(b).length - unique(a).length)
    .slice(0, maxGroups);
  for (const [key, ids] of sorted) {
    candidates.push({
      familyType: type,
      edgeType,
      familyIdSeed: `${type}-${key}`,
      title: `${titlePrefix}: ${key}`,
      memberIds: unique(ids),
      confidence,
      evidenceSources,
      edgeEvidence,
    });
  }
}

function duplicateMetricsFromReranker(report: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!report) return null;
  const metricsSmart = report.metrics_smart as { overall?: Record<string, unknown>; by_slice?: Record<string, unknown> } | undefined;
  const metricsReranker = report.metrics_reranker as { overall?: Record<string, unknown>; by_slice?: Record<string, unknown> } | undefined;
  return {
    smart_duplicate_rate_at_10: metricsSmart?.overall?.duplicate_rate_at_10 ?? null,
    reranker_duplicate_rate_at_10: metricsReranker?.overall?.duplicate_rate_at_10 ?? null,
    smart_by_slice: metricsSmart?.by_slice ?? null,
    reranker_by_slice: metricsReranker?.by_slice ?? null,
    interpretation: 'Search eval already carries duplicate_rate_at_10; family graph can turn that from a diagnostic into a leakage and ranking constraint.',
  };
}

function renderReviewSheet(families: VisualFamily[], report: Record<string, unknown>): string {
  const cards = families
    .sort((a, b) => b.member_count - a.member_count || b.confidence - a.confidence)
    .slice(0, 80)
    .map((family) => {
      const memberCards = family.members.slice(0, 8).map((member) => `<figure class="${member.role}">
  ${member.image_url ? `<img src="${htmlEscape(member.image_url)}" alt="${htmlEscape(member.record_id)}">` : '<div class="missing">No image</div>'}
  <figcaption>${htmlEscape(member.role)} · ${htmlEscape(member.title)}<br>${htmlEscape(member.record_id)}</figcaption>
</figure>`).join('\n');
      return `<article class="family">
  <header>
    <div>
      <h2>${htmlEscape(family.title)}</h2>
      <p>${htmlEscape(family.family_id)} · ${htmlEscape(family.family_type)} · ${family.member_count} members</p>
    </div>
    <span>${Math.round(family.confidence * 100)}%</span>
  </header>
  <div class="grid">${memberCards}</div>
</article>`;
    }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visual Family Graph v0 Review Sheet</title>
  <style>
    body { margin: 0; background: #f3f0ea; color: #1f1b17; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1220px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 24px 0; }
    .stat { border: 1px solid #d3cabd; background: #fffaf2; border-radius: 8px; padding: 14px; }
    .stat strong { display: block; font-size: 24px; }
    .family { border-top: 1px solid #cbbfaf; padding: 24px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
    h2 { margin: 0; font-size: 20px; }
    p { margin: 4px 0 0; color: #665e54; line-height: 1.45; }
    header span { border: 1px solid #1f1b17; border-radius: 999px; padding: 5px 9px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 16px; }
    figure { margin: 0; border: 1px solid #d3cabd; background: #fffaf2; border-radius: 8px; overflow: hidden; }
    figure.canonical { border-color: #1f1b17; }
    img { display: block; width: 100%; height: 150px; object-fit: cover; background: #1f1b17; }
    figcaption { padding: 8px; font-size: 12px; color: #4b453e; line-height: 1.35; }
    .missing { display: grid; place-items: center; height: 150px; color: #665e54; }
  </style>
</head>
<body>
  <main>
    <h1>Visual Family Graph v0 Review Sheet</h1>
    <p>Generated at ${htmlEscape(report.generated_at)}. Canonicals are suggestions for duplicate-aware search, labeling, and split leakage control.</p>
    <section class="stats">
      <div class="stat"><strong>${htmlEscape(report.families)}</strong><span>families</span></div>
      <div class="stat"><strong>${htmlEscape(report.family_records)}</strong><span>records in families</span></div>
      <div class="stat"><strong>${htmlEscape(report.edges)}</strong><span>edges</span></div>
      <div class="stat"><strong>${htmlEscape(report.record_family_map_rows)}</strong><span>split-map rows</span></div>
    </section>
    ${cards}
  </main>
</body>
</html>`;
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Visual Family Graph v0 Report

Generated at: ${report.generated_at}

## Summary

- Families: ${report.families}
- Records in at least one family: ${report.family_records}
- Edges: ${report.edges}
- Record-family map rows: ${report.record_family_map_rows}
- Output directory: \`${report.output_dir}\`

## Family Counts

\`\`\`json
${JSON.stringify(report.by_family_type, null, 2)}
\`\`\`

## Search Duplicate Guardrail

\`\`\`json
${JSON.stringify(report.search_duplicate_guardrail, null, 2)}
\`\`\`

## Split Leakage Policy

Every row in \`visual-family-graph-v0-record-family-map.jsonl\` carries a \`leakage_group_id\`. Train/validation/test splits should assign the full group to one split unless an explicit leakage experiment is being run.

## Caveats

${(report.caveats as string[]).map((line) => `- ${line}`).join('\n')}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      'collection-records': { type: 'string', default: DEFAULT_COLLECTION_RECORDS },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      embeddings: { type: 'string', default: DEFAULT_EMBEDDING_ROWS },
      quality: { type: 'string', default: DEFAULT_QUALITY_LABELS },
      'reranker-report': { type: 'string', default: DEFAULT_RERANKER_REPORT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'neighbor-threshold': { type: 'string', default: '0.84' },
      'max-embedding-families': { type: 'string', default: '250' },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const collectionRecordsPath = resolveRepoPath(values['collection-records']!);
  const collectionsPath = resolveRepoPath(values.collections!);
  const embeddingsPath = resolveRepoPath(values.embeddings!);
  const qualityPath = resolveRepoPath(values.quality!);
  const outputDir = resolveRepoPath(values.output!);
  const neighborThreshold = Number.parseFloat(values['neighbor-threshold']!);
  const maxEmbeddingFamilies = Number.parseInt(values['max-embedding-families']!, 10);
  requireArtifacts([
    { path: manifestPath, label: 'VLM structured manifest' },
    { path: collectionRecordsPath, label: 'collection record rows' },
    { path: collectionsPath, label: 'collection summaries' },
    { path: embeddingsPath, label: 'embedding nearest-neighbor rows' },
    { path: qualityPath, label: 'image-quality labels' },
    { path: resolveRepoPath(values['reranker-report']!), label: 'search reranker report' },
  ]);

  const manifest = readJsonl<ManifestRecord>(manifestPath);
  const collectionRecords = readJsonl<CollectionRecord>(collectionRecordsPath);
  const collections = readJsonl<CollectionSummary>(collectionsPath);
  const embeddingRows = readJsonl<EmbeddingNeighborRow>(embeddingsPath).filter((row) => row.type === 'nearest_neighbors');
  const qualityRows = readJsonl<QualityRow>(qualityPath);
  const rerankerReport = readJson<Record<string, unknown>>(resolveRepoPath(values['reranker-report']!));

  const records = new Map<string, RecordInfo>();
  const qualityById = new Map(qualityRows.map((row) => [row.id, row]));

  for (const row of manifest) {
    const id = clean(row.metadata_filename);
    if (!id) continue;
    const imagePath = clean(row.resolved_image_filename || row.image_filename);
    const quality = qualityById.get(id);
    upsertRecord(records, {
      id,
      title: clean(row.name || id),
      date: clean(row.attributes_map?.Date),
      cote: clean(row.attributes_map?.Cote),
      imagePath,
      externalUrl: clean(row.external_url) || null,
      imageUrl: publicR2Url(imagePath, DEFAULT_PUBLIC_R2_DOMAIN),
      description: clean(row.description),
      vlmCaption: clean(row.vlm_caption),
      qualityLabels: quality?.labels ?? [],
      qualitySeverity: quality?.severity ?? null,
    });
  }

  for (const row of collectionRecords) {
    const id = clean(row.id);
    if (!id) continue;
    upsertRecord(records, {
      id,
      title: clean(row.title),
      date: clean(row.date),
      cote: clean(row.cote),
      imageUrl: clean(row.imageUrl) || null,
      imagePath: clean(row.imagePath) || null,
      collectionScores: [Number(row.matchScore ?? row.score ?? 0)].filter(Number.isFinite),
      collectionIds: [clean(row.collection_id)],
      vlmCaption: clean(row.vlmCaption),
    });
  }

  const candidates: FamilyCandidate[] = [];

  const exactAssetGroups = new Map<string, string[]>();
  const titleDateGroups = new Map<string, string[]>();
  for (const record of records.values()) {
    const assetKey = normalize(record.externalUrl || record.imageUrl || '');
    if (assetKey) exactAssetGroups.set(assetKey, [...(exactAssetGroups.get(assetKey) ?? []), record.id]);

    const titleKey = normalize(record.title);
    const year = extractYear(record.date);
    if (titleKey.length >= 8 && !titleLooksGeneric(record.title)) {
      titleDateGroups.set(`${titleKey}|${year}`, [...(titleDateGroups.get(`${titleKey}|${year}`) ?? []), record.id]);
    }
  }

  addGroupedCandidates(
    candidates,
    exactAssetGroups,
    'exact_asset',
    'same_source_asset',
    'Exact source asset',
    0.98,
    ['manifest_or_collection_image_url'],
    ['same_external_or_public_image_url'],
  );

  addGroupedCandidates(
    candidates,
    titleDateGroups,
    'metadata_duplicate',
    'same_title_date',
    'Repeated title/date',
    0.84,
    ['manifest_title_date'],
    ['same_normalized_title_and_year'],
    300,
  );

  const sequenceGroups = new Map<string, string[]>();
  for (const row of collectionRecords.filter((record) => record.collection_type === 'sequence')) {
    const id = clean(row.id);
    const collectionId = clean(row.collection_id);
    if (id && collectionId) sequenceGroups.set(collectionId, [...(sequenceGroups.get(collectionId) ?? []), id]);
  }
  for (const [collectionId, ids] of sequenceGroups.entries()) {
    const collection = collections.find((row) => row.collection_id === collectionId);
    candidates.push({
      familyType: 'sequence_run',
      edgeType: 'same_sequence_run',
      familyIdSeed: collectionId,
      title: collection?.title ?? `Sequence run ${collectionId}`,
      memberIds: unique(ids),
      confidence: Math.min(0.96, Math.max(0.85, Number(collection?.confidence ?? 0.9))),
      evidenceSources: ['autoresearch_collections.sequence'],
      edgeEvidence: [`sequence_collection:${collectionId}`],
    });
  }

  const uf = new UnionFind();
  const embeddingEvidence = new Map<string, string[]>();
  for (const row of embeddingRows) {
    uf.add(row.id);
    for (const neighbor of row.nearest ?? []) {
      const score = Number(neighbor.score ?? 0);
      const sharedThemes = shared(row.themes, neighbor.themes);
      const sameCategory = clean(row.primaryCategory) && row.primaryCategory === neighbor.primaryCategory;
      if (score >= neighborThreshold && (sameCategory || sharedThemes.length > 0)) {
        uf.union(row.id, neighbor.id);
        const key = [row.id, neighbor.id].sort().join('|');
        embeddingEvidence.set(key, [
          `clip_score=${score.toFixed(4)}`,
          sameCategory ? `same_category:${row.primaryCategory}` : '',
          sharedThemes.length ? `shared_themes:${sharedThemes.join(',')}` : '',
        ].filter(Boolean));
      }
    }
  }
  for (const ids of uf.groups()
    .sort((a, b) => b.length - a.length)
    .slice(0, maxEmbeddingFamilies)) {
    candidates.push({
      familyType: 'embedding_neighbor',
      edgeType: 'clip_near_neighbor',
      familyIdSeed: ids.join('|'),
      title: `CLIP near-neighbor cluster (${ids.length})`,
      memberIds: ids,
      confidence: 0.78,
      evidenceSources: ['autoresearch_embedding_eval_gpu_500.clip_nearest_neighbors'],
      edgeEvidence: [`clip_neighbor_threshold>=${neighborThreshold}`],
    });
  }

  const familiesById = new Map<string, VisualFamily>();
  const edgesById = new Map<string, VisualFamilyEdge>();
  for (const candidate of candidates) {
    const built = familyCandidateToFamily(candidate, records);
    if (!built) continue;
    if (familiesById.has(built.family.family_id)) continue;
    familiesById.set(built.family.family_id, built.family);
    for (const edge of built.edges) edgesById.set(edge.edge_id, edge);
  }

  const families = Array.from(familiesById.values())
    .sort((a, b) => {
      const typeOrder = ['exact_asset', 'sequence_run', 'metadata_duplicate', 'embedding_neighbor'];
      const typeDiff = typeOrder.indexOf(a.family_type) - typeOrder.indexOf(b.family_type);
      if (typeDiff) return typeDiff;
      return b.member_count - a.member_count || b.confidence - a.confidence || a.family_id.localeCompare(b.family_id);
    });
  const edges = Array.from(edgesById.values()).sort((a, b) => a.family_id.localeCompare(b.family_id));

  const familyIdsByRecord = new Map<string, string[]>();
  for (const family of families) {
    for (const member of family.members) {
      familyIdsByRecord.set(member.record_id, [...(familyIdsByRecord.get(member.record_id) ?? []), family.family_id]);
    }
  }

  const familyPriority: Record<FamilyType, number> = {
    exact_asset: 4,
    sequence_run: 3,
    metadata_duplicate: 2,
    embedding_neighbor: 1,
  };
  const familyById = new Map(families.map((family) => [family.family_id, family]));
  const recordFamilyMap = Array.from(familyIdsByRecord.entries())
    .map(([recordId, familyIds]) => {
      const sortedFamilyIds = unique(familyIds).sort((a, b) => {
        const famA = familyById.get(a)!;
        const famB = familyById.get(b)!;
        return familyPriority[famB.family_type] - familyPriority[famA.family_type]
          || famB.confidence - famA.confidence
          || b.localeCompare(a);
      });
      const primaryFamilyId = sortedFamilyIds[0];
      const primaryFamily = familyById.get(primaryFamilyId)!;
      return {
        schema_version: 'visual_family_graph_v0',
        record_id: recordId,
        primary_family_id: primaryFamilyId,
        primary_family_type: primaryFamily.family_type,
        family_ids: sortedFamilyIds,
        leakage_group_id: primaryFamilyId,
        split_policy: 'keep_family_in_single_split',
      };
    })
    .sort((a, b) => a.record_id.localeCompare(b.record_id));

  fs.mkdirSync(outputDir, { recursive: true });
  const familiesPath = path.join(outputDir, 'visual-family-graph-v0-families.jsonl');
  const edgesPath = path.join(outputDir, 'visual-family-graph-v0-edges.jsonl');
  const mapPath = path.join(outputDir, 'visual-family-graph-v0-record-family-map.jsonl');
  const reportJsonPath = path.join(outputDir, 'visual-family-graph-v0-report.json');
  const reportMdPath = path.join(outputDir, 'visual-family-graph-v0-report.md');
  const reviewSheetPath = path.join(outputDir, 'visual-family-graph-v0-review-sheet.html');

  const familyRecordCount = new Set(recordFamilyMap.map((row) => row.record_id)).size;
  const report = {
    generated_at: datasetFactoryNowIso(),
    issue: 54,
    output_dir: rel(outputDir),
    inputs: {
      manifest: rel(manifestPath),
      collection_records: rel(collectionRecordsPath),
      collections: rel(collectionsPath),
      embeddings: rel(embeddingsPath),
      quality: rel(qualityPath),
      reranker_report: rel(resolveRepoPath(values['reranker-report']!)),
    },
    params: {
      neighbor_threshold: neighborThreshold,
      max_embedding_families: maxEmbeddingFamilies,
    },
    manifest_records: manifest.length,
    collection_records: collectionRecords.length,
    embedding_nearest_neighbor_rows: embeddingRows.length,
    candidates: candidates.length,
    families: families.length,
    edges: edges.length,
    family_records: familyRecordCount,
    record_family_map_rows: recordFamilyMap.length,
    by_family_type: countBy(families, (family) => family.family_type),
    by_member_count_bucket: countBy(families, (family) => {
      if (family.member_count >= 50) return '50+';
      if (family.member_count >= 20) return '20-49';
      if (family.member_count >= 10) return '10-19';
      if (family.member_count >= 3) return '3-9';
      return '2';
    }),
    top_families: families.slice(0, 20).map((family) => ({
      family_id: family.family_id,
      family_type: family.family_type,
      title: family.title,
      canonical_record_id: family.canonical_record_id,
      member_count: family.member_count,
      confidence: family.confidence,
    })),
    search_duplicate_guardrail: duplicateMetricsFromReranker(rerankerReport),
    split_policy: {
      key: 'leakage_group_id',
      rule: 'Keep all records with the same leakage_group_id in the same train/validation/test split.',
      reason: 'Near-duplicate, repeated-source, and sequence images otherwise leak visual information across model evaluation splits.',
    },
    caveats: [
      'This v0 graph uses exact asset keys, metadata/title repetition, existing sequence collections, and CLIP nearest-neighbor sample rows.',
      'It does not yet include a full-dataset pHash pass or DINO/DINOv2 nearest-neighbor graph; #55 covers foundation-model expansion.',
      'Canonical records are ranked suggestions, not deletion decisions. Alternates must remain related images unless a human review says otherwise.',
      'Embedding-neighbor families are sample-bounded to the current 500-row GPU evaluation set.',
    ],
  };

  writeJsonl(familiesPath, families);
  writeJsonl(edgesPath, edges);
  writeJsonl(mapPath, recordFamilyMap);
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(reportMdPath, renderMarkdown(report), 'utf-8');
  fs.writeFileSync(reviewSheetPath, renderReviewSheet(families, report), 'utf-8');

  console.log(`Wrote Visual Family Graph v0 to ${rel(outputDir)}`);
  console.log(`- families=${families.length}`);
  console.log(`- family_records=${familyRecordCount}`);
  console.log(`- edges=${edges.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
