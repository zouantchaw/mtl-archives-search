import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from '../dataset-factory/clock.js';
import { VFG_SCHEMA_VERSION, countBy, fileEvidence, readJsonl, writeJson, writeJsonl, type LeakageMapRow } from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_CANDIDATES = path.join(ROOT, 'data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl');
const DEFAULT_MAP = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/graph/record-leakage-map-v1.jsonl');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/search-evaluation');
const MODES = ['semantic', 'smart', 'visual'] as const;

type Candidate = {
  task_id: string;
  query?: string;
  slice?: string;
  candidate_record_id: string;
  duplicate_key?: string;
  ranks?: Partial<Record<(typeof MODES)[number], number>>;
};

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function repoEvidence(filePath: string, rowCount?: number): Record<string, unknown> {
  return { ...fileEvidence(filePath, rowCount), path: path.relative(ROOT, filePath).split(path.sep).join('/') };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      map: { type: 'string', default: DEFAULT_MAP },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      k: { type: 'string', default: '10' },
    },
  });
  const started = Date.now();
  const candidatePath = resolvePath(values.candidates!);
  const mapPath = resolvePath(values.map!);
  const outputDir = resolvePath(values.output!);
  const k = Number.parseInt(values.k!, 10);
  if (!Number.isInteger(k) || k < 2 || k > 100) throw new Error('k must be 2..100');
  const candidates = readJsonl<Candidate>(candidatePath);
  const leakageMap = readJsonl<LeakageMapRow>(mapPath);
  const mapById = new Map(leakageMap.map((row) => [row.record_id, row]));
  const byTask = new Map<string, Candidate[]>();
  for (const row of candidates) byTask.set(row.task_id, [...(byTask.get(row.task_id) ?? []), row]);
  const taskRows: Array<Record<string, unknown>> = [];
  const unmapped = new Set<string>();
  for (const [taskId, rows] of [...byTask.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const mode of MODES) {
      const ranked = rows.filter((row) => Number.isFinite(row.ranks?.[mode])).sort((a, b) => Number(a.ranks![mode]) - Number(b.ranks![mode])).slice(0, k);
      if (!ranked.length) continue;
      const seenComponents = new Set<string>();
      const seenLegacy = new Set<string>();
      let componentDuplicates = 0;
      let legacyDuplicates = 0;
      for (const row of ranked) {
        const mapping = mapById.get(row.candidate_record_id);
        if (!mapping) unmapped.add(row.candidate_record_id);
        const componentKey = mapping?.component_id ?? `unmapped:${row.candidate_record_id}`;
        const legacyKey = row.duplicate_key ?? `record:${row.candidate_record_id}`;
        if (seenComponents.has(componentKey)) componentDuplicates += 1;
        if (seenLegacy.has(legacyKey)) legacyDuplicates += 1;
        seenComponents.add(componentKey);
        seenLegacy.add(legacyKey);
      }
      taskRows.push({
        schema_version: VFG_SCHEMA_VERSION,
        task_id: taskId,
        query: rows[0]?.query ?? '',
        slice: rows[0]?.slice ?? 'unknown',
        mode,
        k,
        returned: ranked.length,
        component_duplicate_results: componentDuplicates,
        component_duplicate_rate: Number((componentDuplicates / ranked.length).toFixed(6)),
        legacy_duplicate_results: legacyDuplicates,
        legacy_duplicate_rate: Number((legacyDuplicates / ranked.length).toFixed(6)),
        unique_components: seenComponents.size,
      });
    }
  }
  const rowsPath = path.join(outputDir, 'search-duplicate-task-metrics-v1.jsonl');
  writeJsonl(rowsPath, taskRows);
  const byMode = Object.fromEntries(MODES.map((mode) => {
    const rows = taskRows.filter((row) => row.mode === mode);
    return [mode, {
      tasks: rows.length,
      mean_component_duplicate_rate_at_k: Number(mean(rows.map((row) => Number(row.component_duplicate_rate))).toFixed(6)),
      mean_legacy_duplicate_rate_at_k: Number(mean(rows.map((row) => Number(row.legacy_duplicate_rate))).toFixed(6)),
      tasks_with_component_duplicates: rows.filter((row) => Number(row.component_duplicate_results) > 0).length,
    }];
  }));
  const report = {
    schema_version: VFG_SCHEMA_VERSION,
    evaluation_version: 'search_duplicate_rate_v1',
    generated_at: datasetFactoryNowIso(),
    params: { k, modes: MODES },
    counts: { candidate_rows: candidates.length, tasks: byTask.size, task_mode_rows: taskRows.length, leakage_map_rows: leakageMap.length, unmapped_candidate_records: unmapped.size },
    by_mode: byMode,
    by_slice: countBy(taskRows, (row) => String(row.slice)),
    unmapped_record_ids: [...unmapped].sort((a, b) => a.localeCompare(b)),
    definition: {
      component_duplicate_rate: 'Within each task/mode top-k, every result after the first occurrence of its grouping-authoritative leakage component is counted as a duplicate.',
      legacy_duplicate_rate: 'The same calculation using the frozen candidate artifact duplicate_key for comparison.',
      mutable_search_claim: false,
    },
    runtime_cost: { elapsed_ms: Date.now() - started, cost_usd: 0, network_requests: 0 },
    lineage: { candidates: repoEvidence(candidatePath, candidates.length), leakage_map: repoEvidence(mapPath, leakageMap.length), task_metrics: repoEvidence(rowsPath, taskRows.length) },
  };
  writeJson(path.join(outputDir, 'search-duplicate-report-v1.json'), report);
  fs.writeFileSync(path.join(outputDir, 'search-duplicate-report-v1.md'), `# Search Duplicate Rate v1\n\nGenerated: ${report.generated_at}\n\nFrozen candidate rows: ${candidates.length}; tasks: ${byTask.size}; k: ${k}.\n\n\`\`\`json\n${JSON.stringify(byMode, null, 2)}\n\`\`\`\n\nThis evaluation is reproducible from the recorded candidate and leakage-map hashes. It does not claim to describe later mutable search/index state.\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', counts: report.counts, by_mode: byMode, output: outputDir }));
}

main().catch((error) => {
  console.error(`[vfg-v1:search-eval] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
