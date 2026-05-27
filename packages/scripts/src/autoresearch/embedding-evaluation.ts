import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  SiglipTextModel,
  SiglipVisionModel,
} from '@xenova/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const DEFAULT_TAXONOMY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl');
const DEFAULT_QUALITY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl');
const DEFAULT_CANDIDATES = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl');
const DEFAULT_COLLECTIONS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl');
const DEFAULT_QUERIES = path.resolve(MONOREPO_ROOT, 'experiments/autoresearch/search/queries.json');
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_embedding_eval');

type TaxonomyRow = {
  id: string;
  title: string;
  date: string;
  imageUrl: string;
  imagePath: string;
  primaryCategory: string;
  primaryConfidence: number;
  vantage: string;
  mediaType: string;
  themes: string[];
  searchFacets: string[];
  socialTags: string[];
  productTags: string[];
  reviewRequired: boolean;
  excludeFromDefaultVisualSearch: boolean;
};

type QualityRow = {
  id?: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
};

type CandidateRow = {
  id?: string;
  candidate_type?: string;
  score?: number;
};

type CollectionRow = {
  id?: string;
  collection_id?: string;
  score?: number;
};

type SearchQuery = {
  id: string;
  query: string;
  expectedKeywords?: string[];
  category?: string;
  language?: string;
};

type SampleRow = TaxonomyRow & {
  sampleReason: string;
  r2ImageUrl: string;
  candidateTypes: string[];
  collectionIds: string[];
  qualityLabels: string[];
};

type EmbeddingRow = SampleRow & {
  vector: number[];
};

type ModelEval = {
  modelKey: string;
  modelId: string;
  completedRows: number;
  failedRows: number;
  metrics: Record<string, number>;
  promptAlignment: Array<Record<string, unknown>>;
  nearestNeighbors: Array<Record<string, unknown>>;
  queryResults: Array<Record<string, unknown>>;
  failures: Array<{ id: string; error: string }>;
};

const PROMPTS = [
  { key: 'aerial_general', compatible: ['aerial_general'], text: 'aerial photograph of a city from above' },
  { key: 'aerial_waterfront', compatible: ['aerial_waterfront'], text: 'aerial photograph of a waterfront, harbor, river, docks, ships, or port' },
  { key: 'aerial_residential', compatible: ['aerial_residential'], text: 'aerial photograph of residential neighborhoods, houses, streets, and city blocks' },
  { key: 'aerial_industrial', compatible: ['aerial_industrial'], text: 'aerial photograph of industrial buildings, factories, rail yards, warehouses, or port industry' },
  { key: 'document_map', compatible: ['document_map'], text: 'scanned map, plan, document, index sheet, or technical drawing' },
  { key: 'ground_photo', compatible: ['ground_photo', 'street_commercial', 'ground_transit', 'civic_institutional', 'people_event'], text: 'ground level historical street or building photograph' },
  { key: 'park_green_space', compatible: ['aerial_general', 'ground_photo'], text: 'parks, trees, green space, playgrounds, or gardens' },
  { key: 'transit', compatible: ['ground_transit', 'aerial_general'], text: 'streetcars, trains, tracks, stations, bridges, or transit infrastructure' },
  { key: 'construction', compatible: ['aerial_general', 'ground_photo'], text: 'construction site, demolition, roadwork, or building under construction' },
] as const;

const QUERY_EXPECTATIONS: Record<string, { categories: string[]; themes: string[] }> = {
  'aerial-1': { categories: ['aerial_general', 'aerial_residential', 'aerial_industrial', 'aerial_waterfront'], themes: [] },
  'aerial-2': { categories: ['aerial_waterfront'], themes: ['waterfront'] },
  'port-1': { categories: ['aerial_waterfront'], themes: ['waterfront', 'industrial'] },
  'waterfront-1': { categories: ['aerial_waterfront'], themes: ['waterfront'] },
  'park-1': { categories: ['aerial_general', 'ground_photo'], themes: ['park_green_space'] },
  'park-2': { categories: ['ground_photo', 'people_event', 'aerial_general'], themes: ['park_green_space', 'crowd_event'] },
  'winter-1': { categories: ['aerial_general', 'ground_photo'], themes: ['winter'] },
  'winter-2': { categories: ['ground_photo', 'street_commercial', 'aerial_general'], themes: ['winter'] },
  'streetcar-1': { categories: ['ground_transit', 'ground_photo'], themes: ['transit'] },
  'factory-1': { categories: ['aerial_industrial'], themes: ['industrial'] },
  'residential-1': { categories: ['aerial_residential'], themes: ['residential'] },
  'demolition-1': { categories: ['aerial_general', 'ground_photo'], themes: ['construction'] },
  'children-1': { categories: ['people_event', 'ground_photo'], themes: ['crowd_event'] },
};

const MODEL_IDS: Record<string, string> = {
  clip: 'Xenova/clip-vit-base-patch32',
  siglip: 'Xenova/siglip-base-patch16-224',
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
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

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function r2Url(imagePathValue: string, publicDomain: string): string {
  if (!imagePathValue || !publicDomain) return '';
  return `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(imagePathValue)}`;
}

function normalizeVector(raw: Float32Array | number[]): number[] {
  let sumSq = 0;
  for (const value of raw) sumSq += value * value;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding norm');
  return Array.from(raw, (value) => value / norm);
}

function cosine(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
  return sum;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function mrr(ranks: number[]): number {
  return mean(ranks.map((rank) => (rank > 0 ? 1 / rank : 0)));
}

function precisionAt(ranks: number[], k: number): number {
  return mean(ranks.map((rank) => (rank > 0 && rank <= k ? 1 : 0)));
}

function compatiblePrompt(row: TaxonomyRow, promptKey: string): boolean {
  const prompt = PROMPTS.find((item) => item.key === promptKey);
  if (!prompt) return false;
  if ((prompt.compatible as readonly string[]).includes(row.primaryCategory)) return true;
  return row.themes.includes(prompt.key);
}

function expectedQueryHit(row: TaxonomyRow, query: SearchQuery): boolean {
  const expected = QUERY_EXPECTATIONS[query.id];
  if (!expected) {
    const category = cleanText(query.category).replace(/-/g, '_');
    return row.searchFacets.some((facet) => facet.includes(category)) || row.themes.some((theme) => category.includes(theme));
  }
  return expected.categories.includes(row.primaryCategory) || row.themes.some((theme) => expected.themes.includes(theme));
}

function countBy(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function pickSample(
  taxonomy: TaxonomyRow[],
  qualityById: Map<string, QualityRow>,
  candidateById: Map<string, CandidateRow[]>,
  collectionById: Map<string, CollectionRow[]>,
  limit: number,
  publicDomain: string,
): SampleRow[] {
  const selected = new Map<string, SampleRow>();
  const categories = [
    'aerial_general',
    'aerial_waterfront',
    'aerial_residential',
    'aerial_industrial',
    'document_map',
    'ground_photo',
    'people_event',
    'street_commercial',
    'uncertain',
  ];
  const perCategory = Math.max(2, Math.floor(limit / categories.length));
  const rows = taxonomy
    .filter((row) => row.id && row.imagePath && row.primaryConfidence >= 0.55)
    .filter((row) => !row.excludeFromDefaultVisualSearch || row.primaryCategory === 'document_map')
    .filter((row) => qualityById.get(row.id)?.recommendedAction !== 'exclude_until_fixed');

  const add = (row: TaxonomyRow, reason: string) => {
    if (selected.size >= limit || selected.has(row.id)) return;
    selected.set(row.id, {
      ...row,
      sampleReason: reason,
      r2ImageUrl: r2Url(row.imagePath, publicDomain) || row.imageUrl,
      candidateTypes: (candidateById.get(row.id) ?? []).map((item) => cleanText(item.candidate_type)).filter(Boolean),
      collectionIds: (collectionById.get(row.id) ?? []).map((item) => cleanText(item.collection_id)).filter(Boolean),
      qualityLabels: qualityById.get(row.id)?.labels ?? [],
    });
  };

  for (const category of categories) {
    const bucket = rows
      .filter((row) => row.primaryCategory === category)
      .sort((a, b) => {
        const candidateDelta = (candidateById.get(b.id)?.length ?? 0) - (candidateById.get(a.id)?.length ?? 0);
        if (candidateDelta) return candidateDelta;
        const collectionDelta = (collectionById.get(b.id)?.length ?? 0) - (collectionById.get(a.id)?.length ?? 0);
        if (collectionDelta) return collectionDelta;
        return b.primaryConfidence - a.primaryConfidence;
      });
    for (const row of bucket.slice(0, perCategory)) add(row, `category:${category}`);
  }

  for (const row of rows.filter((row) => (candidateById.get(row.id)?.length ?? 0) > 0)) add(row, 'candidate_report');
  for (const row of rows.filter((row) => (collectionById.get(row.id)?.length ?? 0) > 0)) add(row, 'collection_report');
  for (const row of rows) add(row, 'fill');
  return [...selected.values()].slice(0, limit);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function imageEmbedding(row: SampleRow, modelKey: string, model: any, processor: any): Promise<number[]> {
  let lastError: unknown;
  for (const url of [row.r2ImageUrl, row.imageUrl].filter(Boolean)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const image = await RawImage.read(url);
        const inputs = await processor(image);
        const output = await model(inputs);
        if (modelKey === 'siglip') return normalizeVector(output.image_embeds?.data ?? output.pooler_output?.data ?? output.last_hidden_state?.data);
        return normalizeVector(output.image_embeds.data as Float32Array);
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(500);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function textEmbedding(text: string, modelKey: string, model: any, tokenizer: any): Promise<number[]> {
  const inputs = tokenizer(text, modelKey === 'siglip' ? { padding: 'max_length', truncation: true } : { padding: true, truncation: true });
  const output = await model(inputs);
  if (modelKey === 'siglip') return normalizeVector(output.text_embeds?.data ?? output.pooler_output?.data ?? output.last_hidden_state?.data);
  return normalizeVector(output.text_embeds.data as Float32Array);
}

async function loadModel(modelKey: string) {
  const modelId = MODEL_IDS[modelKey] ?? modelKey;
  if (modelKey === 'siglip' || modelId.includes('siglip')) {
    const visionModel = await SiglipVisionModel.from_pretrained(modelId, { quantized: true });
    const textModel = await SiglipTextModel.from_pretrained(modelId, { quantized: true });
    const processor = await AutoProcessor.from_pretrained(modelId);
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    return { modelId, visionModel, textModel, processor, tokenizer };
  }
  const visionModel = await CLIPVisionModelWithProjection.from_pretrained(modelId, { quantized: true });
  const textModel = await CLIPTextModelWithProjection.from_pretrained(modelId, { quantized: true });
  const processor = await AutoProcessor.from_pretrained(modelId);
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  return { modelId, visionModel, textModel, processor, tokenizer };
}

function evaluatePromptAlignment(rows: EmbeddingRow[], promptVectors: Record<string, number[]>) {
  const results = rows.map((row) => {
    const ranked = Object.entries(promptVectors)
      .map(([key, vector]) => ({ key, score: cosine(row.vector, vector) }))
      .sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex((item) => compatiblePrompt(row, item.key)) + 1;
    return {
      id: row.id,
      primaryCategory: row.primaryCategory,
      themes: row.themes,
      topPrompt: ranked[0]?.key,
      topScore: Number((ranked[0]?.score ?? 0).toFixed(4)),
      compatibleRank: rank || 0,
      compatibleAt1: rank === 1,
      compatibleAt3: rank > 0 && rank <= 3,
    };
  });
  return {
    rows: results,
    metrics: {
      prompt_p_at_1: Number(mean(results.map((row) => row.compatibleAt1 ? 1 : 0)).toFixed(4)),
      prompt_p_at_3: Number(mean(results.map((row) => row.compatibleAt3 ? 1 : 0)).toFixed(4)),
      prompt_mrr: Number(mrr(results.map((row) => Number(row.compatibleRank))).toFixed(4)),
    },
  };
}

function evaluateNeighbors(rows: EmbeddingRow[]) {
  const results = rows.map((row) => {
    const ranked = rows
      .filter((other) => other.id !== row.id)
      .map((other) => ({
        id: other.id,
        primaryCategory: other.primaryCategory,
        themes: other.themes,
        score: cosine(row.vector, other.vector),
      }))
      .sort((a, b) => b.score - a.score);
    const top5 = ranked.slice(0, 5);
    const sameCategoryAt5 = mean(top5.map((other) => other.primaryCategory === row.primaryCategory ? 1 : 0));
    const sharedThemeAt5 = mean(top5.map((other) => other.themes.some((theme) => row.themes.includes(theme)) ? 1 : 0));
    return {
      id: row.id,
      primaryCategory: row.primaryCategory,
      themes: row.themes,
      nearest: top5.map((other) => ({ ...other, score: Number(other.score.toFixed(4)) })),
      sameCategoryAt5: Number(sameCategoryAt5.toFixed(4)),
      sharedThemeAt5: Number(sharedThemeAt5.toFixed(4)),
    };
  });
  const pairs: Array<{ same: boolean; sharedTheme: boolean; score: number }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      pairs.push({
        same: rows[i].primaryCategory === rows[j].primaryCategory,
        sharedTheme: rows[i].themes.some((theme) => rows[j].themes.includes(theme)),
        score: cosine(rows[i].vector, rows[j].vector),
      });
    }
  }
  return {
    rows: results,
    metrics: {
      nn_same_category_at_5: Number(mean(results.map((row) => Number(row.sameCategoryAt5))).toFixed(4)),
      nn_shared_theme_at_5: Number(mean(results.map((row) => Number(row.sharedThemeAt5))).toFixed(4)),
      mean_same_category_cosine: Number(mean(pairs.filter((pair) => pair.same).map((pair) => pair.score)).toFixed(4)),
      mean_different_category_cosine: Number(mean(pairs.filter((pair) => !pair.same).map((pair) => pair.score)).toFixed(4)),
      mean_shared_theme_cosine: Number(mean(pairs.filter((pair) => pair.sharedTheme).map((pair) => pair.score)).toFixed(4)),
    },
  };
}

async function evaluateQueries(rows: EmbeddingRow[], queries: SearchQuery[], modelKey: string, textModel: any, tokenizer: any) {
  const evaluated: Array<Record<string, unknown>> = [];
  const ranks: number[] = [];
  for (const query of queries.filter((item) => QUERY_EXPECTATIONS[item.id]).slice(0, 16)) {
    const vector = await textEmbedding(query.query, modelKey, textModel, tokenizer);
    const ranked = rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        primaryCategory: row.primaryCategory,
        themes: row.themes,
        score: cosine(vector, row.vector),
        expectedHit: expectedQueryHit(row, query),
      }))
      .sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex((row) => row.expectedHit) + 1;
    ranks.push(rank || 0);
    evaluated.push({
      id: query.id,
      query: query.query,
      category: query.category,
      expected: QUERY_EXPECTATIONS[query.id],
      firstHitRank: rank || 0,
      topResults: ranked.slice(0, 8).map((row) => ({ ...row, score: Number(row.score.toFixed(4)) })),
    });
  }
  return {
    rows: evaluated,
    metrics: {
      query_p_at_1: Number(precisionAt(ranks, 1).toFixed(4)),
      query_p_at_3: Number(precisionAt(ranks, 3).toFixed(4)),
      query_p_at_5: Number(precisionAt(ranks, 5).toFixed(4)),
      query_mrr: Number(mrr(ranks).toFixed(4)),
    },
  };
}

async function evaluateModel(modelKey: string, sample: SampleRow[], queries: SearchQuery[]): Promise<ModelEval> {
  const loaded = await loadModel(modelKey);
  const failures: Array<{ id: string; error: string }> = [];
  const embedded: EmbeddingRow[] = [];
  for (const row of sample) {
    try {
      embedded.push({
        ...row,
        vector: await imageEmbedding(row, modelKey, loaded.visionModel, loaded.processor),
      });
    } catch (error) {
      failures.push({ id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const promptVectors: Record<string, number[]> = {};
  for (const prompt of PROMPTS) promptVectors[prompt.key] = await textEmbedding(prompt.text, modelKey, loaded.textModel, loaded.tokenizer);
  const prompt = evaluatePromptAlignment(embedded, promptVectors);
  const neighbors = evaluateNeighbors(embedded);
  const query = await evaluateQueries(embedded, queries, modelKey, loaded.textModel, loaded.tokenizer);
  return {
    modelKey,
    modelId: loaded.modelId,
    completedRows: embedded.length,
    failedRows: failures.length,
    metrics: { ...prompt.metrics, ...neighbors.metrics, ...query.metrics },
    promptAlignment: prompt.rows,
    nearestNeighbors: neighbors.rows,
    queryResults: query.rows,
    failures,
  };
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Autoresearch Embedding Evaluation Smoke Test',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Sample rows: ${report.summary.sample_rows}`,
    `- Models requested: ${report.summary.models_requested.join(', ')}`,
    `- Models completed: ${report.summary.models_completed.join(', ')}`,
    '',
    '## Sample Categories',
    '',
  ];
  for (const [key, value] of Object.entries(report.sample.distributions.primaryCategory)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Model Metrics', '');
  for (const model of report.models) {
    lines.push(`### ${model.modelKey}`);
    lines.push(`- Completed rows: ${model.completedRows}`);
    lines.push(`- Failed rows: ${model.failedRows}`);
    for (const [key, value] of Object.entries(model.metrics)) lines.push(`- ${key}: ${value}`);
    lines.push('');
  }
  lines.push('## Recommendation', '', report.recommendation, '', '## Artifacts', '');
  lines.push('- `embedding_eval_report.json`: full metrics and row-level results.');
  lines.push('- `embedding_eval_report.md`: readable summary.');
  lines.push('- `embedding_eval_sample.jsonl`: selected smoke-test records.');
  lines.push('- `embedding_eval_model_<model>.jsonl`: per-model prompt and neighbor rows.');
  return `${lines.join('\n')}\n`;
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      quality: { type: 'string', default: DEFAULT_QUALITY },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      queries: { type: 'string', default: DEFAULT_QUERIES },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '30' },
      models: { type: 'string', default: 'clip' },
      'public-domain': { type: 'string', default: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || '' },
    },
  });

  const outputDir = resolveRepoPath(values['output-dir']!);
  fs.mkdirSync(outputDir, { recursive: true });
  const taxonomy = readJsonl<TaxonomyRow>(resolveRepoPath(values.taxonomy!));
  const quality = readJsonl<QualityRow>(resolveRepoPath(values.quality!));
  const candidates = readJsonl<CandidateRow>(resolveRepoPath(values.candidates!));
  const collections = readJsonl<CollectionRow>(resolveRepoPath(values.collections!));
  const queries = readJson<SearchQuery[]>(resolveRepoPath(values.queries!));
  const limit = Number.parseInt(values.limit!, 10);
  const publicDomain = cleanText(values['public-domain']);

  const qualityById = new Map(quality.filter((row) => row.id).map((row) => [row.id!, row]));
  const candidateById = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    if (!row.id) continue;
    const current = candidateById.get(row.id) ?? [];
    current.push(row);
    candidateById.set(row.id, current);
  }
  const collectionById = new Map<string, CollectionRow[]>();
  for (const row of collections) {
    if (!row.id) continue;
    const current = collectionById.get(row.id) ?? [];
    current.push(row);
    collectionById.set(row.id, current);
  }

  const sample = pickSample(taxonomy, qualityById, candidateById, collectionById, limit, publicDomain);
  const modelKeys = values.models!.split(',').map((model) => model.trim()).filter(Boolean);
  const modelReports: ModelEval[] = [];
  const modelLoadFailures: Array<{ modelKey: string; error: string }> = [];
  for (const modelKey of modelKeys) {
    try {
      modelReports.push(await evaluateModel(modelKey, sample, queries));
    } catch (error) {
      modelLoadFailures.push({ modelKey, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    command: 'npm run autoresearch:embedding-eval -- --limit 30 --models clip',
    inputs: {
      taxonomy: path.relative(MONOREPO_ROOT, resolveRepoPath(values.taxonomy!)),
      quality: path.relative(MONOREPO_ROOT, resolveRepoPath(values.quality!)),
      candidates: path.relative(MONOREPO_ROOT, resolveRepoPath(values.candidates!)),
      collections: path.relative(MONOREPO_ROOT, resolveRepoPath(values.collections!)),
      queries: path.relative(MONOREPO_ROOT, resolveRepoPath(values.queries!)),
    },
    summary: {
      sample_rows: sample.length,
      models_requested: modelKeys,
      models_completed: modelReports.map((model) => model.modelKey),
      model_load_failures: modelLoadFailures.length,
    },
    sample: {
      distributions: {
        primaryCategory: countBy(sample.map((row) => row.primaryCategory)),
        themes: countBy(sample.flatMap((row) => row.themes)),
        sampleReason: countBy(sample.map((row) => row.sampleReason)),
      },
      rows: sample,
    },
    models: modelReports,
    model_load_failures: modelLoadFailures,
    recommendation: modelReports.length
      ? 'Local harness is ready. The smoke test should be used as the baseline before launching Lambda for SigLIP/OpenCLIP and larger stratified samples; do not re-embed production indexes from this local CLIP-only run.'
      : 'No models completed locally. Fix model loading before launching the GPU benchmark.',
    gpu_next_step: {
      recommended: true,
      reason: 'Issue #17 acceptance needs at least one alternative embedding run; the local phase verifies sampling, metrics, and reporting, while SigLIP/OpenCLIP should run on Lambda GPU.',
      suggested_command_shape: 'npm run autoresearch:embedding-eval -- --limit 500 --models clip,siglip',
    },
    artifacts: {
      report_json: 'embedding_eval_report.json',
      report_markdown: 'embedding_eval_report.md',
      sample_jsonl: 'embedding_eval_sample.jsonl',
    },
  };

  fs.writeFileSync(path.join(outputDir, 'embedding_eval_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'embedding_eval_report.md'), renderMarkdown(report));
  writeJsonl(path.join(outputDir, 'embedding_eval_sample.jsonl'), sample);
  for (const model of modelReports) {
    writeJsonl(path.join(outputDir, `embedding_eval_model_${model.modelKey}.jsonl`), model.promptAlignment.map((row) => ({
      type: 'prompt_alignment',
      ...row,
    })).concat(model.nearestNeighbors.map((row) => ({
      type: 'nearest_neighbors',
      ...row,
    }))));
  }

  console.log(`[autoresearch:embedding-eval] output=${outputDir}`);
  console.log(`[autoresearch:embedding-eval] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
