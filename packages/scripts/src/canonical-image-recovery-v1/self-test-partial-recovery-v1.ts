import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_DERIVATIVE_CONTRACT_ID,
  readJsonl,
  sha256,
  terminalFailureDetail,
  writeJson,
  writeJsonl,
  type RecoveryRow,
} from './model.js';
import type { PhashFeatureRow } from '../visual-family-graph-v1/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const SOURCE = path.join(ROOT, 'data/mtl_archives/reports/canonical_image_recovery_v1');

function npm(args: string[]): void {
  execFileSync('npm', args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATASET_FACTORY_FIXED_NOW: '2026-07-11T13:00:00.000Z' } });
}

function main(): void {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'issue77-partial-'));
  try {
    for (const name of ['recovery-ledger-v1.jsonl', 'successor-phash-features-v1.jsonl', 'successor-phash-failures-v1.jsonl', 'successor-phash-report-v1.json']) {
      fs.copyFileSync(path.join(SOURCE, name), path.join(temp, name));
    }
    fs.cpSync(path.join(SOURCE, 'derivatives'), path.join(temp, 'derivatives'), { recursive: true });
    const rows = readJsonl<RecoveryRow>(path.join(temp, 'recovery-ledger-v1.jsonl'));
    const targetIndex = rows.length - 1; const previous = rows[targetIndex];
    const residual: RecoveryRow = { ...previous, recovered: false, recovered_lane: null, recovered_payload_sha256: null,
      recovery_payload_reuse_group_id: null, recovery_payload_hash_verified: false, derivative_path: null, derivative_sha256: null,
      normalized_pixel_sha256: null, phash64: null, root_cause: 'bounded_response_size_failure', disposition: 'held_over_contract',
      root_cause_evidence: 'synthetic full-corpus fixture: valid terminal row held by the signed bounded response contract' };
    rows[targetIndex] = residual; writeJsonl(path.join(temp, 'recovery-ledger-v1.jsonl'), rows);
    fs.rmSync(path.join(temp, previous.derivative_path!));
    npm(['run', 'dataset-factory:canonical-image-recovery-derivative-manifest-v1', '--', '--root', path.join(temp, 'derivatives')]);
    const features = readJsonl<PhashFeatureRow>(path.join(temp, 'successor-phash-features-v1.jsonl'));
    const featureIndex = features.findIndex((row) => row.record_id === residual.record_id);
    if (featureIndex < 0) throw new Error('synthetic residual feature is missing');
    features[featureIndex] = { ...features[featureIndex], status: 'failure', derivative_contract_id: BASELINE_DERIVATIVE_CONTRACT_ID,
      derivative_sha256: null, normalized_pixel_sha256: null, phash64: null, derivative_width: null, derivative_height: null,
      derivative_bytes: 0, elapsed_ms: 0, attempts: Math.min(5, residual.attempted_lanes.length),
      failure_code: 'canonical_image_recovery_terminal', failure_detail: terminalFailureDetail(residual) };
    writeJsonl(path.join(temp, 'successor-phash-features-v1.jsonl'), features);
    writeJsonl(path.join(temp, 'successor-phash-failures-v1.jsonl'), features.filter((row) => row.status === 'failure'));
    const report = JSON.parse(fs.readFileSync(path.join(temp, 'successor-phash-report-v1.json'), 'utf8'));
    const featurePath = path.join(temp, 'successor-phash-features-v1.jsonl'); const failures = features.filter((row) => row.status === 'failure');
    const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'derivatives/manifest-v1.json'), 'utf8'));
    report.coverage = { ...report.coverage, successful: 18_461, failures: 1, success_rate_percent: 99.994583,
      failure_codes: { canonical_image_recovery_terminal: 1 }, individually_reported: 1 };
    report.lineage.features = { ...report.lineage.features, row_count: features.length, byte_count: fs.statSync(featurePath).size, sha256: sha256(fs.readFileSync(featurePath)) };
    report.recovery_lineage = { ...report.recovery_lineage, terminal_rows: 209, recovered_rows: 208, unrecovered_rows: 1,
      terminal_ledger: { row_count: 209, sha256: sha256(fs.readFileSync(path.join(temp, 'recovery-ledger-v1.jsonl'))) },
      derivative_manifest: { row_count: 208, tree_sha256: manifest.tree_sha256 } };
    writeJson(path.join(temp, 'successor-phash-report-v1.json'), report);
    npm(['run', 'dataset-factory:visual-family-graph-v1', '--',
      '--corpus', 'data/mtl_archives/reports/visual_family_graph_v1/input/corpus-input-v1.jsonl',
      '--corpus-summary', 'data/mtl_archives/reports/visual_family_graph_v1/input/corpus-input-summary-v1.json',
      '--features', featurePath, '--feature-report', path.join(temp, 'successor-phash-report-v1.json'), '--output', path.join(temp, 'graph-after')]);
    npm(['run', 'dataset-factory:visual-family-search-eval-v1', '--',
      '--candidates', 'data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl',
      '--map', path.join(temp, 'graph-after/record-leakage-map-v1.jsonl'), '--output', path.join(temp, 'search-evaluation')]);
    npm(['run', 'dataset-factory:visual-family-check-v1', '--', '--recovery-root', temp]);
    const graph = JSON.parse(fs.readFileSync(path.join(temp, 'graph-after/graph-report-v1.json'), 'utf8'));
    if (graph.coverage?.corpus_records !== 18_462 || graph.coverage?.phash_successes !== 18_461 || graph.coverage?.phash_failures !== 1
      || graph.splits?.component_crossings !== 0) throw new Error('synthetic partial graph contract mismatch');
    console.log(JSON.stringify({ status: 'ok', terminal_rows: 209, recovered_rows: 208, unresolved_rows: 1,
      graph_nodes: graph.coverage.corpus_records, phash_successes: graph.coverage.phash_successes, split_crossings: graph.splits.component_crossings }));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

main();
