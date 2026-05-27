import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_CONFIG = path.resolve(MONOREPO_ROOT, 'experiments/autoresearch/search/config.json');
const DEFAULT_QUERIES = path.resolve(MONOREPO_ROOT, 'experiments/autoresearch/search/queries.json');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_report.json');
const DEFAULT_TAXONOMY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl');
const DEFAULT_QUALITY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl');

type SearchConfig = {
  endpoint: string;
  topK: number;
  resultLimit: number;
  rrfK: number;
  visualWeight: number;
  semanticWeight: number;
  bothBonus: number;
  metadataKeywordWeight: number;
  descriptionKeywordWeight: number;
  duplicatePenalty: number;
};

type QueryCase = {
  id: string;
  query: string;
  expectedKeywords: string[];
  category?: string;
  language?: string;
};

type SearchItem = {
  metadataFilename?: string;
  filename?: string | null;
  name?: string | null;
  description?: string | null;
  vlmCaption?: string | null;
  portalTitle?: string | null;
  portalDescription?: string | null;
  cote?: string | null;
  score?: number;
};

type Source = 'visual' | 'semantic';
type SearchPolicy = 'none' | 'autoresearch';
type TaxonomyRow = {
  id: string;
  primaryCategory?: string;
  themes?: string[];
  searchFacets?: string[];
  reviewRequired?: boolean;
  excludeFromDefaultVisualSearch?: boolean;
};
type QualityRow = {
  id: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
};
type PolicyStats = {
  excluded: number;
  demoted: number;
  reasons: Record<string, number>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function readJsonlMap<T extends { id?: string }>(filePath: string): Map<string, T> {
  if (!fs.existsSync(filePath)) return new Map();
  const rows = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
  return new Map(rows.filter((row) => row.id).map((row) => [String(row.id), row]));
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function weightedKeywordHits(parts: unknown[], keywords: string[], weight: number): number {
  if (weight <= 0) return 0;
  const text = parts.map(normalize).filter(Boolean).join(' ');
  if (!text) return 0;
  let hits = 0;
  for (const keyword of keywords) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedKeyword && text.includes(normalizedKeyword)) hits += weight;
  }
  return hits;
}

function relevance(item: SearchItem, query: QueryCase, config: SearchConfig): number {
  const metadataParts = [
    item.name,
    item.portalTitle,
    item.cote,
    item.metadataFilename,
    item.filename,
  ];
  const descriptionParts = [
    item.description,
    item.portalDescription,
    item.vlmCaption,
  ];
  const hits =
    weightedKeywordHits(metadataParts, query.expectedKeywords, config.metadataKeywordWeight) +
    weightedKeywordHits(descriptionParts, query.expectedKeywords, config.descriptionKeywordWeight);
  const maxScore = query.expectedKeywords.length * (config.metadataKeywordWeight + config.descriptionKeywordWeight);
  return maxScore > 0 ? hits / maxScore : 0;
}

function duplicateKey(item: SearchItem): string {
  return normalize(item.filename || item.metadataFilename || item.name || '');
}

function queryIntent(query: string): string[] {
  const normalized = normalize(query);
  const intents: string[] = [];
  const add = (intent: string, pattern: RegExp) => {
    if (pattern.test(normalized)) intents.push(intent);
  };
  add('park_green_space', /\b(park|parc|trees?|garden|fountain|fontaine)\b/);
  add('winter', /\b(winter|snow|neige|hiver)\b/);
  add('waterfront', /\b(waterfront|river|fleuve|port|harbou?r|ships?|shore|canal)\b/);
  add('residential', /\b(residential|neighbou?rhood|houses?|homes?|quartier)\b/);
  add('industrial', /\b(industrial|factory|factories|usine|port)\b/);
  add('transit', /\b(transit|tramway|streetcar|metro|station|rail|train)\b/);
  add('construction', /\b(construction|demolition|chantier)\b/);
  add('crowd_event', /\b(children|school|people|playing|event|crowd|enfants?|ecole)\b/);
  return intents;
}

function applyPolicy(
  item: SearchItem,
  queryText: string,
  taxonomyById: Map<string, TaxonomyRow>,
  qualityById: Map<string, QualityRow>,
): { excluded: boolean; demotion: number; boost: number; reasons: string[] } {
  const id = item.metadataFilename ?? '';
  const taxonomy = taxonomyById.get(id);
  const quality = qualityById.get(id);
  const reasons: string[] = [];
  let demotion = 1;
  let boost = 1;
  const qualityAction = quality?.recommendedAction ?? '';
  const qualitySeverity = quality?.severity ?? '';
  const excluded = false;

  if (qualityAction === 'exclude_until_fixed') {
    demotion *= 0.94;
    reasons.push('quality:exclude_until_fixed');
  }
  if (taxonomy?.excludeFromDefaultVisualSearch) reasons.push('taxonomy:exclude_from_default_visual');
  if (qualityAction === 'lower_rank') {
    demotion *= 0.94;
    reasons.push('quality:lower_rank');
  } else if (['review', 'rotate', 'crop_or_mask'].includes(qualityAction)) {
    demotion *= 0.97;
    reasons.push(`quality:${qualityAction}`);
  }
  if (qualitySeverity === 'high') {
    demotion *= 0.97;
    reasons.push('quality:high_severity');
  } else if (qualitySeverity === 'medium') {
    demotion *= 0.99;
    reasons.push('quality:medium_severity');
  }
  if (taxonomy?.reviewRequired && !excluded) reasons.push('taxonomy:review_required');
  const taxonomyTokens = new Set([
    taxonomy?.primaryCategory ?? '',
    ...(taxonomy?.themes ?? []),
    ...(taxonomy?.searchFacets ?? []),
  ]);
  for (const intent of queryIntent(queryText)) {
    if (
      taxonomyTokens.has(intent) ||
      taxonomyTokens.has(`theme:${intent}`) ||
      taxonomyTokens.has(`primary:aerial_${intent}`) ||
      taxonomyTokens.has(`primary:${intent}`)
    ) {
      boost *= 1.22;
      reasons.push(`taxonomy:intent:${intent}`);
    }
  }
  return { excluded, demotion, boost, reasons };
}

async function fetchMode(endpoint: string, query: string, mode: Source, limit: number): Promise<{ items: SearchItem[]; latencyMs: number }> {
  const url = new URL('/api/search', endpoint.replace(/\/+$/, ''));
  url.searchParams.set('q', query);
  url.searchParams.set('mode', mode);
  url.searchParams.set('limit', String(limit));

  const started = Date.now();
  const response = await fetch(url);
  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${mode} search failed for "${query}": ${response.status} ${text.slice(0, 240)}`);
  }
  const json = await response.json() as { items?: SearchItem[] };
  return { items: json.items ?? [], latencyMs };
}

function fuseResults(
  visual: SearchItem[],
  semantic: SearchItem[],
  config: SearchConfig,
  queryText: string,
  policy: SearchPolicy,
  taxonomyById: Map<string, TaxonomyRow>,
  qualityById: Map<string, QualityRow>,
  policyStats: PolicyStats,
): Array<SearchItem & { fusedScore: number; source: string; policyReasons?: string[] }> {
  const scored = new Map<string, {
    item: SearchItem;
    score: number;
    sources: Set<Source>;
    duplicateKey: string;
    policyReasons: string[];
  }>();

  const apply = (items: SearchItem[], source: Source, weight: number) => {
    items.forEach((item, index) => {
      const id = item.metadataFilename || `${source}-${index}`;
      const itemPolicy = policy === 'autoresearch'
        ? applyPolicy(item, queryText, taxonomyById, qualityById)
        : { excluded: false, demotion: 1, boost: 1, reasons: [] };
      if (itemPolicy.excluded) {
        policyStats.excluded += 1;
        for (const reason of itemPolicy.reasons) policyStats.reasons[reason] = (policyStats.reasons[reason] ?? 0) + 1;
        return;
      }
      if (itemPolicy.demotion < 1) {
        policyStats.demoted += 1;
        for (const reason of itemPolicy.reasons) policyStats.reasons[reason] = (policyStats.reasons[reason] ?? 0) + 1;
      }
      const current = scored.get(id);
      const increment = (weight / (config.rrfK + index + 1)) * itemPolicy.demotion * itemPolicy.boost;
      if (current) {
        current.score += increment;
        current.sources.add(source);
        current.policyReasons = Array.from(new Set([...current.policyReasons, ...itemPolicy.reasons]));
        return;
      }
      scored.set(id, {
        item,
        score: increment,
        sources: new Set([source]),
        duplicateKey: duplicateKey(item),
        policyReasons: itemPolicy.reasons,
      });
    });
  };

  apply(visual, 'visual', config.visualWeight);
  apply(semantic, 'semantic', config.semanticWeight);

  const seenDuplicates = new Set<string>();
  return Array.from(scored.values())
    .map((entry) => {
      let fusedScore = entry.score + (entry.sources.size > 1 ? config.bothBonus : 0);
      if (entry.duplicateKey && seenDuplicates.has(entry.duplicateKey)) {
        fusedScore -= config.duplicatePenalty;
      }
      if (entry.duplicateKey) seenDuplicates.add(entry.duplicateKey);
      return {
        ...entry.item,
        fusedScore,
        source: entry.sources.size > 1 ? 'both' : Array.from(entry.sources)[0],
        policyReasons: entry.policyReasons,
      };
    })
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, config.resultLimit);
}

function precisionAt(items: SearchItem[], query: QueryCase, config: SearchConfig, k: number): number {
  const top = items.slice(0, k);
  if (!top.length) return 0;
  const relevant = top.filter((item) => relevance(item, query, config) > 0).length;
  return relevant / k;
}

function mrr(items: SearchItem[], query: QueryCase, config: SearchConfig): number {
  const rank = items.findIndex((item) => relevance(item, query, config) > 0);
  return rank === -1 ? 0 : 1 / (rank + 1);
}

function duplicateRate(items: SearchItem[]): number {
  if (items.length <= 1) return 0;
  const keys = items.map(duplicateKey).filter(Boolean);
  const unique = new Set(keys);
  return keys.length ? (keys.length - unique.size) / keys.length : 0;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string', default: DEFAULT_CONFIG },
      queries: { type: 'string', default: DEFAULT_QUERIES },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      policy: { type: 'string', default: 'none' },
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      quality: { type: 'string', default: DEFAULT_QUALITY },
    },
  });

  const configPath = resolveRepoPath(values.config!);
  const queriesPath = resolveRepoPath(values.queries!);
  const outputPath = resolveRepoPath(values.output!);
  const config = readJson<SearchConfig>(configPath);
  const queries = readJson<QueryCase[]>(queriesPath);
  const policy = values.policy === 'autoresearch' ? 'autoresearch' : 'none';
  const taxonomyPath = resolveRepoPath(values.taxonomy!);
  const qualityPath = resolveRepoPath(values.quality!);
  const taxonomyById = policy === 'autoresearch' ? readJsonlMap<TaxonomyRow>(taxonomyPath) : new Map<string, TaxonomyRow>();
  const qualityById = policy === 'autoresearch' ? readJsonlMap<QualityRow>(qualityPath) : new Map<string, QualityRow>();
  const policyStats: PolicyStats = { excluded: 0, demoted: 0, reasons: {} };

  const results = [];
  for (const query of queries) {
    const [visual, semantic] = await Promise.all([
      fetchMode(config.endpoint, query.query, 'visual', config.topK),
      fetchMode(config.endpoint, query.query, 'semantic', config.topK),
    ]);
    const fused = fuseResults(visual.items, semantic.items, config, query.query, policy, taxonomyById, qualityById, policyStats);
    results.push({
      query,
      latencyMs: Math.max(visual.latencyMs, semantic.latencyMs),
      metrics: {
        precisionAt1: precisionAt(fused, query, config, 1),
        precisionAt3: precisionAt(fused, query, config, 3),
        precisionAt5: precisionAt(fused, query, config, 5),
        mrr: mrr(fused, query, config),
        duplicateRate: duplicateRate(fused),
      },
      topResults: fused.slice(0, 5).map((item) => ({
        id: item.metadataFilename,
        name: item.name,
        source: item.source,
        fusedScore: Number(item.fusedScore.toFixed(6)),
        relevance: Number(relevance(item, query, config).toFixed(3)),
        policyReasons: item.policyReasons ?? [],
      })),
    });
  }

  const aggregate = {
    precisionAt1: mean(results.map((row) => row.metrics.precisionAt1)),
    precisionAt3: mean(results.map((row) => row.metrics.precisionAt3)),
    precisionAt5: mean(results.map((row) => row.metrics.precisionAt5)),
    mrr: mean(results.map((row) => row.metrics.mrr)),
    duplicateRate: mean(results.map((row) => row.metrics.duplicateRate)),
    avgLatencyMs: mean(results.map((row) => row.latencyMs)),
  };
  const weightedScore =
    aggregate.precisionAt5 * 0.4 +
    aggregate.mrr * 0.35 +
    aggregate.precisionAt1 * 0.2 -
    aggregate.duplicateRate * 0.05;

  const report = {
    generatedAt: new Date().toISOString(),
    configPath,
    queriesPath,
    config,
    policy,
    policyInputs: policy === 'autoresearch'
      ? {
          taxonomy: taxonomyPath,
          quality: qualityPath,
          taxonomyRows: taxonomyById.size,
          qualityRows: qualityById.size,
        }
      : null,
    policyStats,
    totalQueries: queries.length,
    aggregate: {
      ...aggregate,
      weightedScore,
    },
    results,
  };

  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`[autoresearch:search] queries=${queries.length}`);
  console.log(`[autoresearch:search] policy=${policy} precision@5=${aggregate.precisionAt5.toFixed(3)} mrr=${aggregate.mrr.toFixed(3)} duplicateRate=${aggregate.duplicateRate.toFixed(3)} weighted=${weightedScore.toFixed(3)}`);
  console.log(`[autoresearch:search] report=${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
