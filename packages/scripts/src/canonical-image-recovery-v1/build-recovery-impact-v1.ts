import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readJsonl, sha256, writeJson } from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_ROOT = path.join(ROOT, 'data/mtl_archives/reports/canonical_image_recovery_v1');

function file(pathname: string): { sha256: string; bytes: number } {
  const bytes = fs.readFileSync(pathname); return { sha256: sha256(bytes), bytes: bytes.length };
}

function changedIds(beforePath: string, afterPath: string, key: string): string[] {
  const before = new Map(readJsonl<Record<string, unknown>>(beforePath).map((row) => [String(row[key]), JSON.stringify(row)]));
  const after = new Map(readJsonl<Record<string, unknown>>(afterPath).map((row) => [String(row[key]), JSON.stringify(row)]));
  return [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id)).sort();
}

function main(): void {
  const { values } = parseArgs({ options: { root: { type: 'string', default: DEFAULT_ROOT } } });
  const root = path.resolve(values.root!); const before = path.join(root, 'graph-before'); const after = path.join(root, 'graph-after');
  const beforeReport = JSON.parse(fs.readFileSync(path.join(before, 'graph-report-v1.json'), 'utf8'));
  const afterReport = JSON.parse(fs.readFileSync(path.join(after, 'graph-report-v1.json'), 'utf8'));
  const artifacts = [
    ['typed_edges', 'typed-edges-v1.jsonl', 'edge_id'], ['components', 'leakage-components-v1.jsonl', 'component_id'],
    ['leakage_map', 'record-leakage-map-v1.jsonl', 'record_id'], ['splits', 'benchmark-splits-v1.jsonl', 'record_id'],
    ['recommendations', 'canonical-recommendations-v1.jsonl', 'component_id'], ['review_packet', 'review-packet-v1.jsonl', 'review_id'],
  ] as const;
  const comparisons = Object.fromEntries(artifacts.map(([name, filename, key]) => {
    const beforePath = path.join(before, filename); const afterPath = path.join(after, filename); const changed = changedIds(beforePath, afterPath, key);
    return [name, { before: file(beforePath), after: file(afterPath), byte_identical: file(beforePath).sha256 === file(afterPath).sha256, changed_rows: changed.length, changed_ids: changed.slice(0, 500) }];
  }));
  const afterMap = readJsonl<Record<string, any>>(path.join(after, 'record-leakage-map-v1.jsonl'));
  const beforeMap = readJsonl<Record<string, any>>(path.join(before, 'record-leakage-map-v1.jsonl'));
  const searchProjection = (rows: Array<Record<string, any>>) => rows.map((row) => `${row.record_id}\0${row.component_id}\0${row.benchmark_split}\n`).join('');
  const searchProjectionBefore = sha256(searchProjection(beforeMap)); const searchProjectionAfter = sha256(searchProjection(afterMap));
  const splitByComponent = new Map<string, Set<string>>();
  for (const row of afterMap) { const splits = splitByComponent.get(row.component_id) ?? new Set(); splits.add(row.benchmark_split); splitByComponent.set(row.component_id, splits); }
  const crossings = [...splitByComponent.values()].filter((splits) => splits.size > 1).length;
  const delta = (section: string, key: string) => (afterReport[section]?.[key] ?? 0) - (beforeReport[section]?.[key] ?? 0);
  writeJson(path.join(root, 'graph-impact-report-v1.json'), {
    schema_version: 'canonical_image_recovery_graph_impact_v1.0.0',
    graph_digests: { before_manifest: file(path.join(before, 'artifact-manifest-v1.json')).sha256, after_manifest: file(path.join(after, 'artifact-manifest-v1.json')).sha256 },
    edge_deltas: { total: delta('edges', 'total'), exact_payload: afterReport.edges.by_type.exact_payload - beforeReport.edges.by_type.exact_payload,
      near_duplicate_phash: afterReport.edges.by_type.near_duplicate_phash - beforeReport.edges.by_type.near_duplicate_phash,
      alternate_crop: afterReport.edges.by_type.alternate_crop - beforeReport.edges.by_type.alternate_crop,
      grouping_authoritative: afterReport.edges.by_authority.grouping_authoritative - beforeReport.edges.by_authority.grouping_authoritative },
    components: { before: beforeReport.components, after: afterReport.components, split_crossings: crossings },
    comparisons,
    search_duplicate_metrics: { impact: searchProjectionBefore === searchProjectionAfter ? 'unchanged' : 'requires_frozen_candidate_recalculation',
      projection_before_sha256: searchProjectionBefore, projection_after_sha256: searchProjectionAfter,
      frozen_rates: { semantic: 0.006757, smart: 0.076333, visual: 0.177772 },
      rationale: 'Frozen search duplicate metrics depend on candidate IDs and record-to-component membership; support-only leakage-map fields are excluded.' },
    downstream_contract: { graph_manifest_sha256: file(path.join(after, 'artifact-manifest-v1.json')).sha256, irrecoverable_exclusions: 0, recovered_rows: 209 },
  });
  if (crossings !== 0) throw new Error(`successor graph has ${crossings} split crossings`);
  console.log(JSON.stringify({ status: 'ok', crossings, output: path.join(root, 'graph-impact-report-v1.json') }));
}

main();
