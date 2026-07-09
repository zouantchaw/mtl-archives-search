import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_TASKS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/retrieval_tasks.jsonl',
);
const DEFAULT_MANIFEST = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/search_reranker_v0',
);
const DEFAULT_API_BASE = 'https://www.mtlarchives.com';
const FEATURE_NAMES = [
  'bias',
  'best_api_score',
  'semantic_rank_rr',
  'smart_rank_rr',
  'visual_rank_rr',
  'source_lexical',
  'source_semantic',
  'source_visual',
  'exact_title',
  'exact_metadata',
  'exact_caption',
  'exact_cote',
  'token_coverage',
  'token_jaccard',
  'scene_text_hit',
  'entity_hit',
  'portal_match',
  'search_value_score',
  'quality_keep',
  'quality_penalty',
  'size_penalty',
] as const;

type SearchMode = 'semantic' | 'smart' | 'visual';
type FeatureName = typeof FEATURE_NAMES[number];
type Split = 'train' | 'validation' | 'test';

type RetrievalTask = {
  task_id: string;
  split: Split;
  slice: string;
  record_id: string;
  positive_record_ids: string[];
  query: string;
  expected_rank_bucket: string;
  source_expectation_mode: string;
  eval_modes: string[];
  adjudication_status?: string;
  judgment_source?: string;
  evidence_boundary?: string;
  confidence?: number;
  leakage_group_id?: string | null;
};

type SearchItem = {
  metadataFilename?: string;
  metadata_filename?: string;
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  score?: number;
  source?: string;
};

type ManifestRecord = {
  metadata_filename: string;
  image_filename?: string;
  resolved_image_filename?: string;
  image_size_bytes?: number;
  name?: string | null;
  description?: string | null;
  vlm_caption?: string | null;
  cote?: string | null;
  external_url?: string | null;
  portal_match?: boolean | number | string | null;
  portal_record?: {
    title?: string | null;
    description?: string | null;
    cote?: string | null;
  } | null;
  portal_title?: string | null;
  portal_description?: string | null;
  portal_cote?: string | null;
};

type SceneText = {
  text?: string;
  normalized_text?: string;
  confidence?: number;
};

type EntityMention = {
  name?: string;
  confidence?: number;
};

type LabelRow = {
  record_id: string;
  labels?: {
    search_value?: string;
    quality_action?: string[];
    scene_text?: SceneText[];
    entities?: EntityMention[];
  };
  confidence?: {
    overall?: number;
    needs_human_review?: boolean;
  };
};

type CandidateRow = {
  task_id: string;
  split: Split;
  slice: string;
  judgment_source: string;
  evidence_boundary: string;
  adjudication_status: string;
  query: string;
  expected_record_id: string;
  candidate_record_id: string;
  is_positive: boolean;
  ranks: Partial<Record<SearchMode, number>>;
  scores: Partial<Record<SearchMode, number>>;
  sources: string[];
  features: Record<FeatureName, number>;
  duplicate_key: string;
};

type PairwisePreference = {
  preference_id: string;
  task_id: string;
  split: Split;
  judgment_source: string;
  evidence_boundary: string;
  adjudication_status: string;
  query: string;
  preferred_record_id: string;
  other_record_id: string;
  source: 'search_candidate_hard_negative';
  label: 'preferred';
  rationale: string;
};

type Weights = Record<FeatureName, number>;

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl<T>(filePath: string): T[] {
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

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.json$/i, '');
}

function jsonId(value: unknown): string {
  const normalized = normalizeId(value);
  return normalized ? `${normalized}.json` : '';
}

function itemId(item: SearchItem): string {
  return jsonId(item.metadataFilename ?? item.metadata_filename ?? item.id);
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: unknown): string[] {
  const stopwords = new Set([
    'and',
    'avec',
    'aux',
    'des',
    'de',
    'du',
    'est',
    'entre',
    'les',
    'le',
    'la',
    'rue',
    'rues',
    'saint',
    'sainte',
    'street',
    'the',
    'une',
    'un',
    'west',
    'with',
    'ouest',
    'dans',
    'sur',
    'coin',
    'angle',
  ]);
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function reciprocalRank(rank: number | undefined): number {
  return rank ? 1 / rank : 0;
}

function rankFeature(rank: number | undefined): number {
  return rank ? 1 / Math.log2(rank + 1) : 0;
}

function sigmoid(value: number): number {
  if (value > 35) return 1;
  if (value < -35) return 0;
  return 1 / (1 + Math.exp(-value));
}

function thresholdForBucket(bucket: string, limit: number): number {
  if (bucket === 'top_1') return 1;
  if (bucket === 'top_3') return 3;
  if (bucket === 'top_10') return 10;
  if (bucket === 'discoverable') return limit;
  if (bucket === 'negative') return 0;
  return limit;
}

function initialWeights(): Weights {
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, 0])) as Weights;
}

function cloneWeights(weights: Weights): Weights {
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, weights[name]])) as Weights;
}

function score(features: Record<FeatureName, number>, weights: Weights): number {
  return FEATURE_NAMES.reduce((sum, name) => sum + features[name] * weights[name], 0);
}

function featureDiff(a: Record<FeatureName, number>, b: Record<FeatureName, number>): Record<FeatureName, number> {
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, a[name] - b[name]])) as Record<FeatureName, number>;
}

function taskExpectedId(task: RetrievalTask): string {
  return jsonId(task.positive_record_ids[0] ?? task.record_id);
}

function taskJudgmentSource(task: RetrievalTask): string {
  if (task.judgment_source) return task.judgment_source;
  if (task.adjudication_status === 'silver_needs_review') return 'research_enrichment_silver';
  return 'reviewed_gold';
}

function taskEvidenceBoundary(task: RetrievalTask): string {
  return task.evidence_boundary ?? (taskJudgmentSource(task) === 'reviewed_gold' ? 'reviewed_gold' : 'unknown');
}

function taskAdjudicationStatus(task: RetrievalTask): string {
  return task.adjudication_status ?? (taskJudgmentSource(task) === 'reviewed_gold' ? 'reviewed_gold' : 'unknown');
}

function searchValueScore(value: string | undefined): number {
  const map: Record<string, number> = {
    priority: 1,
    high: 0.8,
    medium: 0.55,
    low: 0.25,
    exclude: -0.5,
  };
  return map[String(value ?? '').toLowerCase()] ?? 0;
}

function isPortalMatch(value: ManifestRecord['portal_match']): boolean {
  return value === true || value === 1 || value === 'true';
}

function textFields(record: ManifestRecord | undefined, item: SearchItem | undefined, label: LabelRow | undefined): {
  title: string;
  metadata: string;
  caption: string;
  cote: string;
  sceneText: string;
  entities: string;
} {
  const portal = record?.portal_record ?? null;
  const titleParts = [
    item?.title,
    item?.name,
    record?.name,
    record?.portal_title,
    portal?.title,
  ];
  const metadataParts = [
    record?.description,
    record?.portal_description,
    portal?.description,
    item?.description,
  ];
  const sceneText = (label?.labels?.scene_text ?? [])
    .map((entry) => [entry.text, entry.normalized_text].filter(Boolean).join(' '))
    .join(' ');
  const entities = (label?.labels?.entities ?? [])
    .map((entry) => entry.name ?? '')
    .join(' ');
  return {
    title: titleParts.filter(Boolean).join(' '),
    metadata: metadataParts.filter(Boolean).join(' '),
    caption: String(record?.vlm_caption ?? ''),
    cote: [record?.cote, record?.portal_cote, portal?.cote].filter(Boolean).join(' '),
    sceneText,
    entities,
  };
}

function duplicateKey(record: ManifestRecord | undefined, item: SearchItem | undefined): string {
  const filename = String(record?.resolved_image_filename ?? record?.image_filename ?? '');
  if (filename) {
    const family = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]\d+[a-z]?$/i, '');
    if (family) return `image:${family.toLowerCase()}`;
  }
  const title = normalizeText(record?.name ?? item?.title ?? item?.name);
  if (title) return `title:${title.replace(/\d+/g, '#')}`;
  return `record:${record?.metadata_filename ?? itemId(item ?? {})}`;
}

function queryTypeSources(sources: string[]): { lexical: number; semantic: number; visual: number } {
  const joined = sources.join(' ').toLowerCase();
  return {
    lexical: joined.includes('lexical') ? 1 : 0,
    semantic: joined.includes('semantic') ? 1 : 0,
    visual: joined.includes('visual') ? 1 : 0,
  };
}

function buildFeatures(params: {
  task: RetrievalTask;
  item: SearchItem | undefined;
  record: ManifestRecord | undefined;
  label: LabelRow | undefined;
  ranks: Partial<Record<SearchMode, number>>;
  scores: Partial<Record<SearchMode, number>>;
  sources: string[];
  maxSize: number;
}): Record<FeatureName, number> {
  const fields = textFields(params.record, params.item, params.label);
  const normalizedQuery = normalizeText(params.task.query);
  const queryTokens = unique(tokenize(params.task.query));
  const titleNorm = normalizeText(fields.title);
  const metadataNorm = normalizeText(fields.metadata);
  const captionNorm = normalizeText(fields.caption);
  const coteNorm = normalizeText(fields.cote);
  const sceneTextNorm = normalizeText(fields.sceneText);
  const entityNorm = normalizeText(fields.entities);
  const haystackTokens = new Set(tokenize([
    fields.title,
    fields.metadata,
    fields.caption,
    fields.cote,
    fields.sceneText,
    fields.entities,
  ].join(' ')));
  const overlap = queryTokens.filter((token) => haystackTokens.has(token)).length;
  const union = new Set([...queryTokens, ...haystackTokens]).size;
  const sourceTypes = queryTypeSources(params.sources);
  const bestScore = Math.max(
    ...Object.values(params.scores).map((value) => typeof value === 'number' ? value : 0),
    0,
  );
  const qualityActions = params.label?.labels?.quality_action ?? [];
  const qualityPenalty = qualityActions.some((action) => /exclude|repair|rotate|crop/i.test(action)) || params.label?.confidence?.needs_human_review ? 1 : 0;
  const size = Number(params.record?.image_size_bytes ?? 0);
  const sizePenalty = params.maxSize > 0 && size > params.maxSize ? 1 : 0;
  const exact = (value: string): number => normalizedQuery && value.includes(normalizedQuery) ? 1 : 0;

  return {
    bias: 1,
    best_api_score: Math.max(0, Math.min(bestScore, 1.5)) / 1.5,
    semantic_rank_rr: rankFeature(params.ranks.semantic),
    smart_rank_rr: rankFeature(params.ranks.smart),
    visual_rank_rr: rankFeature(params.ranks.visual),
    source_lexical: sourceTypes.lexical,
    source_semantic: sourceTypes.semantic,
    source_visual: sourceTypes.visual,
    exact_title: exact(titleNorm),
    exact_metadata: exact(metadataNorm),
    exact_caption: exact(captionNorm),
    exact_cote: exact(coteNorm),
    token_coverage: queryTokens.length ? overlap / queryTokens.length : 0,
    token_jaccard: union ? overlap / union : 0,
    scene_text_hit: exact(sceneTextNorm),
    entity_hit: exact(entityNorm),
    portal_match: isPortalMatch(params.record?.portal_match) ? 1 : 0,
    search_value_score: searchValueScore(params.label?.labels?.search_value),
    quality_keep: qualityPenalty ? 0 : 1,
    quality_penalty: qualityPenalty,
    size_penalty: sizePenalty,
  };
}

async function fetchModeCandidates(task: RetrievalTask, mode: SearchMode, apiBase: string, limit: number, maxSize: number, cacheBust?: string): Promise<SearchItem[]> {
  const url = new URL('/api/search', apiBase);
  url.searchParams.set('q', task.query);
  url.searchParams.set('mode', mode);
  url.searchParams.set('limit', String(limit));
  if (maxSize > 0) url.searchParams.set('maxSize', String(maxSize));
  if (cacheBust) url.searchParams.set('__bench', `${cacheBust}-${mode}`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${mode} ${task.task_id}`);
  const payload = await response.json() as { items?: SearchItem[]; results?: SearchItem[] };
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

async function collectCandidates(params: {
  tasks: RetrievalTask[];
  modes: SearchMode[];
  apiBase: string;
  limit: number;
  maxSize: number;
  cacheBust?: string;
  manifest: Map<string, ManifestRecord>;
  labels: Map<string, LabelRow>;
}): Promise<{ candidates: CandidateRow[]; errors: Array<{ task_id: string; mode: string; error: string }> }> {
  const rows: CandidateRow[] = [];
  const errors: Array<{ task_id: string; mode: string; error: string }> = [];

  for (const task of params.tasks) {
    const expected = taskExpectedId(task);
    const byId = new Map<string, {
      item?: SearchItem;
      ranks: Partial<Record<SearchMode, number>>;
      scores: Partial<Record<SearchMode, number>>;
      sources: Set<string>;
    }>();

    for (const mode of params.modes) {
      try {
        const items = await fetchModeCandidates(task, mode, params.apiBase, params.limit, params.maxSize, params.cacheBust);
        items.forEach((item, index) => {
          const id = itemId(item);
          if (!id) return;
          const existing = byId.get(id) ?? { ranks: {}, scores: {}, sources: new Set<string>() };
          existing.item = existing.item ?? item;
          existing.ranks[mode] = index + 1;
          if (typeof item.score === 'number') existing.scores[mode] = item.score;
          if (item.source) existing.sources.add(item.source);
          existing.sources.add(mode);
          byId.set(id, existing);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ task_id: task.task_id, mode, error: message });
      }
    }

    for (const [candidateId, value] of byId) {
      const record = params.manifest.get(candidateId);
      const label = params.labels.get(candidateId);
      const sources = Array.from(value.sources).sort();
      const features = buildFeatures({
        task,
        item: value.item,
        record,
        label,
        ranks: value.ranks,
        scores: value.scores,
        sources,
        maxSize: params.maxSize,
      });
      rows.push({
        task_id: task.task_id,
        split: task.split,
        slice: task.slice,
        judgment_source: taskJudgmentSource(task),
        evidence_boundary: taskEvidenceBoundary(task),
        adjudication_status: taskAdjudicationStatus(task),
        query: task.query,
        expected_record_id: expected,
        candidate_record_id: candidateId,
        is_positive: candidateId === expected || task.positive_record_ids.map(jsonId).includes(candidateId),
        ranks: value.ranks,
        scores: value.scores,
        sources,
        features,
        duplicate_key: duplicateKey(record, value.item),
      });
    }
  }

  return { candidates: rows, errors };
}

function buildPreferences(candidates: CandidateRow[], maxNegativesPerTask: number): PairwisePreference[] {
  const byTask = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    const rows = byTask.get(row.task_id) ?? [];
    rows.push(row);
    byTask.set(row.task_id, rows);
  }

  const preferences: PairwisePreference[] = [];
  for (const [taskId, rows] of byTask) {
    const positive = rows.find((row) => row.is_positive);
    if (!positive) continue;
    const negatives = rows
      .filter((row) => !row.is_positive)
      .sort((a, b) => (a.ranks.smart ?? a.ranks.semantic ?? a.ranks.visual ?? Number.POSITIVE_INFINITY) - (b.ranks.smart ?? b.ranks.semantic ?? b.ranks.visual ?? Number.POSITIVE_INFINITY))
      .slice(0, maxNegativesPerTask);
    for (const negative of negatives) {
      preferences.push({
        preference_id: `pref-${String(preferences.length + 1).padStart(5, '0')}`,
        task_id: taskId,
        split: positive.split,
        judgment_source: positive.judgment_source,
        evidence_boundary: positive.evidence_boundary,
        adjudication_status: positive.adjudication_status,
        query: positive.query,
        preferred_record_id: positive.candidate_record_id,
        other_record_id: negative.candidate_record_id,
        source: 'search_candidate_hard_negative',
        label: 'preferred',
        rationale: `For query "${positive.query}", benchmark positive ${positive.candidate_record_id} is preferred over retrieved hard negative ${negative.candidate_record_id}.`,
      });
    }
  }
  return preferences;
}

function trainRanker(candidates: CandidateRow[], preferences: PairwisePreference[], epochs: number, learningRate: number, l2: number): { weights: Weights; train_pairwise_accuracy: number; preferences_used: number } {
  const byKey = new Map<string, CandidateRow>();
  for (const row of candidates) byKey.set(`${row.task_id}:${row.candidate_record_id}`, row);
  const trainPrefs = preferences.filter((pref) => pref.split === 'train');
  const training = trainPrefs.length ? trainPrefs : preferences;
  const weights = initialWeights();

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const pref of training) {
      const preferred = byKey.get(`${pref.task_id}:${pref.preferred_record_id}`);
      const other = byKey.get(`${pref.task_id}:${pref.other_record_id}`);
      if (!preferred || !other) continue;
      const diff = featureDiff(preferred.features, other.features);
      const margin = FEATURE_NAMES.reduce((sum, name) => sum + diff[name] * weights[name], 0);
      const gradientScale = 1 - sigmoid(margin);
      for (const name of FEATURE_NAMES) {
        weights[name] += learningRate * (gradientScale * diff[name] - l2 * weights[name]);
      }
    }
  }

  const accuracyRows = training.map((pref): number | null => {
    const preferred = byKey.get(`${pref.task_id}:${pref.preferred_record_id}`);
    const other = byKey.get(`${pref.task_id}:${pref.other_record_id}`);
    if (!preferred || !other) return null;
    return score(preferred.features, weights) > score(other.features, weights) ? 1 : 0;
  }).filter((value): value is number => value !== null);

  return {
    weights,
    train_pairwise_accuracy: mean(accuracyRows),
    preferences_used: training.length,
  };
}

function rankedBySmart(rows: CandidateRow[]): CandidateRow[] {
  return [...rows]
    .filter((row) => row.ranks.smart)
    .sort((a, b) => (a.ranks.smart ?? Number.POSITIVE_INFINITY) - (b.ranks.smart ?? Number.POSITIVE_INFINITY));
}

function rankedByReranker(rows: CandidateRow[], weights: Weights, duplicatePenalty: number): Array<CandidateRow & { reranker_score: number }> {
  const remaining = [...rows]
    .map((row) => ({ ...row, reranker_score: score(row.features, weights) }))
    .sort((a, b) => {
      if (b.reranker_score !== a.reranker_score) return b.reranker_score - a.reranker_score;
      return (a.ranks.smart ?? a.ranks.semantic ?? a.ranks.visual ?? Number.POSITIVE_INFINITY) - (b.ranks.smart ?? b.ranks.semantic ?? b.ranks.visual ?? Number.POSITIVE_INFINITY);
    });
  const ranked: Array<CandidateRow & { reranker_score: number }> = [];
  const seenDuplicateKeys = new Set<string>();

  while (remaining.length) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const adjustedScore = candidate.reranker_score - (seenDuplicateKeys.has(candidate.duplicate_key) ? duplicatePenalty : 0);
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = index;
      }
    }
    const [selected] = remaining.splice(bestIndex, 1);
    ranked.push(selected);
    seenDuplicateKeys.add(selected.duplicate_key);
  }

  return ranked;
}

function duplicateRate(rows: CandidateRow[], k: number): number {
  const top = rows.slice(0, k);
  if (top.length <= 1) return 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of top) {
    if (seen.has(row.duplicate_key)) duplicates += 1;
    seen.add(row.duplicate_key);
  }
  return duplicates / top.length;
}

function metricsForTasks(tasks: RetrievalTask[], candidateRows: CandidateRow[], ranker: 'smart' | 'reranker', weights: Weights, limit: number, duplicatePenalty: number): Record<string, unknown> {
  const byTask = new Map<string, CandidateRow[]>();
  for (const row of candidateRows) {
    const rows = byTask.get(row.task_id) ?? [];
    rows.push(row);
    byTask.set(row.task_id, rows);
  }

  const rows = tasks.map((task) => {
    const expected = taskExpectedId(task);
    const candidates = byTask.get(task.task_id) ?? [];
    const ranked = ranker === 'smart' ? rankedBySmart(candidates) : rankedByReranker(candidates, weights, duplicatePenalty);
    const index = ranked.findIndex((row) => row.candidate_record_id === expected);
    const rank = index >= 0 ? index + 1 : null;
    const threshold = thresholdForBucket(task.expected_rank_bucket, limit);
    return {
      task_id: task.task_id,
      split: task.split,
      slice: task.slice,
      judgment_source: taskJudgmentSource(task),
      evidence_boundary: taskEvidenceBoundary(task),
      adjudication_status: taskAdjudicationStatus(task),
      rank,
      pass_expected_bucket: task.expected_rank_bucket === 'negative' ? rank === null : rank !== null && rank <= threshold,
      ndcg_at_10: rank !== null && rank <= 10 ? 1 / Math.log2(rank + 1) : 0,
      duplicate_rate_at_10: duplicateRate(ranked, 10),
      candidate_count: ranked.length,
    };
  });

  const summarize = (items: typeof rows) => ({
    tasks: items.length,
    precision_at_1: mean(items.map((row) => row.rank !== null && row.rank <= 1 ? 1 : 0)),
    precision_at_3: mean(items.map((row) => row.rank !== null && row.rank <= 3 ? 1 : 0)),
    precision_at_10: mean(items.map((row) => row.rank !== null && row.rank <= 10 ? 1 : 0)),
    expected_bucket_pass_rate: mean(items.map((row) => row.pass_expected_bucket ? 1 : 0)),
    mrr: mean(items.map((row) => row.rank ? reciprocalRank(row.rank) : 0)),
    ndcg_at_10: mean(items.map((row) => row.ndcg_at_10)),
    found_rate: mean(items.map((row) => row.rank !== null ? 1 : 0)),
    duplicate_rate_at_10: mean(items.map((row) => row.duplicate_rate_at_10)),
    candidate_count_mean: mean(items.map((row) => row.candidate_count)),
  });

  const bySplit: Record<string, typeof rows> = {};
  const bySlice: Record<string, typeof rows> = {};
  const byJudgmentSource: Record<string, typeof rows> = {};
  for (const row of rows) {
    bySplit[row.split] = bySplit[row.split] ?? [];
    bySplit[row.split].push(row);
    bySlice[row.slice] = bySlice[row.slice] ?? [];
    bySlice[row.slice].push(row);
    byJudgmentSource[row.judgment_source] = byJudgmentSource[row.judgment_source] ?? [];
    byJudgmentSource[row.judgment_source].push(row);
  }

  return {
    overall: summarize(rows),
    by_split: Object.fromEntries(Object.entries(bySplit).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)])),
    by_slice: Object.fromEntries(Object.entries(bySlice).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)])),
    by_judgment_source: Object.fromEntries(Object.entries(byJudgmentSource).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)])),
    task_rows: rows,
  };
}

function pairwiseAccuracy(candidates: CandidateRow[], preferences: PairwisePreference[], weights: Weights): Record<string, unknown> {
  const byKey = new Map<string, CandidateRow>();
  for (const row of candidates) byKey.set(`${row.task_id}:${row.candidate_record_id}`, row);
  const rows = preferences.map((pref) => {
    const preferred = byKey.get(`${pref.task_id}:${pref.preferred_record_id}`);
    const other = byKey.get(`${pref.task_id}:${pref.other_record_id}`);
    if (!preferred || !other) return null;
    return {
      split: pref.split,
      judgment_source: pref.judgment_source,
      correct: score(preferred.features, weights) > score(other.features, weights) ? 1 : 0,
    };
  }).filter((row): row is { split: Split; judgment_source: string; correct: number } => row !== null);
  const bySplit: Record<string, typeof rows> = {};
  const byJudgmentSource: Record<string, typeof rows> = {};
  for (const row of rows) {
    bySplit[row.split] = bySplit[row.split] ?? [];
    bySplit[row.split].push(row);
    byJudgmentSource[row.judgment_source] = byJudgmentSource[row.judgment_source] ?? [];
    byJudgmentSource[row.judgment_source].push(row);
  }
  return {
    overall: {
      pairs: rows.length,
      accuracy: mean(rows.map((row) => row.correct)),
    },
    by_split: Object.fromEntries(Object.entries(bySplit).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, {
      pairs: value.length,
      accuracy: mean(value.map((row) => row.correct)),
    }])),
    by_judgment_source: Object.fromEntries(Object.entries(byJudgmentSource).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, {
      pairs: value.length,
      accuracy: mean(value.map((row) => row.correct)),
    }])),
  };
}

function metricTable(title: string, metrics: Record<string, unknown>): string[] {
  const overall = metrics.overall as {
    tasks: number;
    precision_at_1: number;
    precision_at_3: number;
    precision_at_10: number;
    expected_bucket_pass_rate: number;
    mrr: number;
    ndcg_at_10: number;
    duplicate_rate_at_10: number;
  };
  return [
    `## ${title}`,
    '',
    '| Tasks | P@1 | P@3 | P@10 | Expected Pass | MRR | nDCG@10 | Dup@10 |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${overall.tasks} | ${overall.precision_at_1.toFixed(3)} | ${overall.precision_at_3.toFixed(3)} | ${overall.precision_at_10.toFixed(3)} | ${overall.expected_bucket_pass_rate.toFixed(3)} | ${overall.mrr.toFixed(3)} | ${overall.ndcg_at_10.toFixed(3)} | ${overall.duplicate_rate_at_10.toFixed(3)} |`,
    '',
  ];
}

function splitTable(metrics: Record<string, unknown>): string[] {
  const bySplit = metrics.by_split as Record<string, {
    tasks: number;
    precision_at_1: number;
    precision_at_3: number;
    expected_bucket_pass_rate: number;
    mrr: number;
    ndcg_at_10: number;
    duplicate_rate_at_10: number;
  }>;
  const lines = [
    '| Split | Tasks | P@1 | P@3 | Expected Pass | MRR | nDCG@10 | Dup@10 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [split, row] of Object.entries(bySplit ?? {})) {
    lines.push(`| ${split} | ${row.tasks} | ${row.precision_at_1.toFixed(3)} | ${row.precision_at_3.toFixed(3)} | ${row.expected_bucket_pass_rate.toFixed(3)} | ${row.mrr.toFixed(3)} | ${row.ndcg_at_10.toFixed(3)} | ${row.duplicate_rate_at_10.toFixed(3)} |`);
  }
  return lines;
}

function judgmentSourceTable(metrics: Record<string, unknown>): string[] {
  const bySource = metrics.by_judgment_source as Record<string, {
    tasks: number;
    precision_at_1: number;
    precision_at_3: number;
    precision_at_10: number;
    expected_bucket_pass_rate: number;
    mrr: number;
    ndcg_at_10: number;
    duplicate_rate_at_10: number;
  }>;
  const lines = [
    '| Judgment Source | Tasks | P@1 | P@3 | P@10 | Expected Pass | MRR | nDCG@10 | Dup@10 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [source, row] of Object.entries(bySource ?? {})) {
    lines.push(`| ${source} | ${row.tasks} | ${row.precision_at_1.toFixed(3)} | ${row.precision_at_3.toFixed(3)} | ${row.precision_at_10.toFixed(3)} | ${row.expected_bucket_pass_rate.toFixed(3)} | ${row.mrr.toFixed(3)} | ${row.ndcg_at_10.toFixed(3)} | ${row.duplicate_rate_at_10.toFixed(3)} |`);
  }
  return lines;
}

function topWeightLines(weights: Weights, limit: number): string[] {
  return Object.entries(weights)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([name, value]) => `- \`${name}\`: ${value.toFixed(4)}`);
}

function renderMarkdown(report: Record<string, unknown>): string {
  const training = report.training as { preferences_used: number; train_pairwise_accuracy: number };
  const pairwise = report.pairwise_accuracy as { overall: { pairs: number; accuracy: number } };
  const weights = report.weights as Weights;
  const lines = [
    '# Search Reranker v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    `API base: ${report.api_base}`,
    '',
    '## Summary',
    '',
    `- Candidate rows: ${report.candidate_rows}`,
    `- Pairwise preferences: ${report.pairwise_preferences}`,
    `- Training pairs used: ${training.preferences_used}`,
    `- Train pairwise accuracy: ${training.train_pairwise_accuracy.toFixed(3)}`,
    `- Overall pairwise accuracy: ${pairwise.overall.accuracy.toFixed(3)} (${pairwise.overall.pairs} pairs)`,
    `- Duplicate penalty: ${Number(report.duplicate_penalty).toFixed(3)}`,
    '',
    ...metricTable('Current Smart Baseline', report.metrics_smart as Record<string, unknown>),
    ...splitTable(report.metrics_smart as Record<string, unknown>),
    '',
    ...judgmentSourceTable(report.metrics_smart as Record<string, unknown>),
    '',
    ...metricTable('Learned Linear Reranker', report.metrics_reranker as Record<string, unknown>),
    ...splitTable(report.metrics_reranker as Record<string, unknown>),
    '',
    ...judgmentSourceTable(report.metrics_reranker as Record<string, unknown>),
    '',
    '## Top Learned Weights',
    '',
    ...topWeightLines(weights, 12),
    '',
    '## Notes',
    '',
    '- This is an offline reranker evaluation over the candidates returned by existing search modes.',
    '- It can reorder returned candidates but cannot recover records missing from all candidate modes.',
    '- Pairwise preferences are generated from the supplied task positives against retrieved hard negatives.',
    '- Judgment-source metrics are included so reviewed-gold results are not conflated with silver-needs-review stress tasks.',
    '',
  ];
  return `${lines.join('\n')}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tasks: { type: 'string', default: DEFAULT_TASKS },
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      labels: { type: 'string', default: DEFAULT_LABELS },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      'report-api-base': { type: 'string' },
      modes: { type: 'string', default: 'semantic,smart,visual' },
      limit: { type: 'string', default: '24' },
      'max-size': { type: 'string', default: '1000000' },
      'limit-tasks': { type: 'string' },
      'max-negatives-per-task': { type: 'string', default: '12' },
      epochs: { type: 'string', default: '240' },
      'learning-rate': { type: 'string', default: '0.06' },
      'l2': { type: 'string', default: '0.001' },
      'duplicate-penalty': { type: 'string', default: '3' },
      'cache-bust': { type: 'string' },
    },
  });

  const tasksPath = resolveRepoPath(values.tasks!);
  const manifestPath = resolveRepoPath(values.manifest!);
  const labelsPath = resolveRepoPath(values.labels!);
  const outputDir = resolveRepoPath(values.output!);
  const apiBase = values['api-base']!;
  const reportApiBase = values['report-api-base'] ?? apiBase;
  const modes = values.modes!.split(',').map((mode) => mode.trim()).filter(Boolean) as SearchMode[];
  const limit = Math.max(1, Number(values.limit ?? 24));
  const maxSize = Math.max(0, Number(values['max-size'] ?? 0));
  const taskLimit = values['limit-tasks'] ? Math.max(1, Number(values['limit-tasks'])) : null;
  const maxNegativesPerTask = Math.max(1, Number(values['max-negatives-per-task'] ?? 12));
  const epochs = Math.max(1, Number(values.epochs ?? 240));
  const learningRate = Math.max(0.001, Number(values['learning-rate'] ?? 0.06));
  const l2 = Math.max(0, Number(values.l2 ?? 0.001));
  const duplicatePenalty = Math.max(0, Number(values['duplicate-penalty'] ?? 3));
  const cacheBust = values['cache-bust'];
  requireArtifacts([
    { path: tasksPath, label: 'benchmark retrieval tasks' },
    { path: manifestPath, label: 'manifest rows for reranker features' },
    { path: labelsPath, label: 'gold label rows for reranker features' },
  ]);

  const tasks = readJsonl<RetrievalTask>(tasksPath).slice(0, taskLimit ?? undefined);
  const manifestRows = readJsonl<ManifestRecord>(manifestPath);
  const labelRows = readJsonl<LabelRow>(labelsPath);
  const manifest = new Map(manifestRows.map((row) => [jsonId(row.metadata_filename), row]));
  const labels = new Map(labelRows.map((row) => [jsonId(row.record_id), row]));

  const { candidates, errors } = await collectCandidates({
    tasks,
    modes,
    apiBase,
    limit,
    maxSize,
    cacheBust,
    manifest,
    labels,
  });
  const preferences = buildPreferences(candidates, maxNegativesPerTask);
  const training = trainRanker(candidates, preferences, epochs, learningRate, l2);
  const weights = cloneWeights(training.weights);
  const metricsSmart = metricsForTasks(tasks, candidates, 'smart', weights, limit, duplicatePenalty);
  const metricsReranker = metricsForTasks(tasks, candidates, 'reranker', weights, limit, duplicatePenalty);
  const preferenceAccuracy = pairwiseAccuracy(candidates, preferences, weights);

  const report = {
    benchmark_id: 'mtl_citymemory_bench_v0',
    evaluator_id: 'search_reranker_v0',
    generated_at: datasetFactoryNowIso(),
    api_base: reportApiBase,
    cache_bust: cacheBust ?? null,
    inputs: {
      tasks: path.relative(MONOREPO_ROOT, tasksPath),
      manifest: path.relative(MONOREPO_ROOT, manifestPath),
      labels: path.relative(MONOREPO_ROOT, labelsPath),
    },
    modes,
    search_limit: limit,
    max_size: maxSize,
    candidate_rows: candidates.length,
    pairwise_preferences: preferences.length,
    duplicate_penalty: duplicatePenalty,
    candidate_errors: errors,
    training: {
      epochs,
      learning_rate: learningRate,
      l2,
      ...training,
    },
    weights,
    pairwise_accuracy: preferenceAccuracy,
    metrics_smart: metricsSmart,
    metrics_reranker: metricsReranker,
    outputs: {
      candidates: 'search_candidates.jsonl',
      pairwise_preferences: 'search_pairwise_preferences.jsonl',
      weights: 'search_reranker_weights.json',
      report_json: 'search_reranker_report.json',
      report_md: 'search_reranker_report.md',
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'search_candidates.jsonl'), candidates);
  writeJsonl(path.join(outputDir, 'search_pairwise_preferences.jsonl'), preferences);
  fs.writeFileSync(path.join(outputDir, 'search_reranker_weights.json'), JSON.stringify(weights, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'search_reranker_report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'search_reranker_report.md'), renderMarkdown(report), 'utf-8');

  const smart = (metricsSmart.overall as { expected_bucket_pass_rate: number; mrr: number; ndcg_at_10: number });
  const reranker = (metricsReranker.overall as { expected_bucket_pass_rate: number; mrr: number; ndcg_at_10: number });
  console.log(`Wrote search reranker v0 to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- candidates=${candidates.length} preferences=${preferences.length} errors=${errors.length}`);
  console.log(`- smart: expectedPass=${smart.expected_bucket_pass_rate.toFixed(3)} mrr=${smart.mrr.toFixed(3)} ndcg@10=${smart.ndcg_at_10.toFixed(3)}`);
  console.log(`- reranker: expectedPass=${reranker.expected_bucket_pass_rate.toFixed(3)} mrr=${reranker.mrr.toFixed(3)} ndcg@10=${reranker.ndcg_at_10.toFixed(3)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
