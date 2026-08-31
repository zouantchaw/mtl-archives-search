import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';

export const PROMOTION_PREFLIGHT_SCHEMA = 'mtl_citymemory_promotion_challenge_preflight_v1.0.0';
export const PROMOTION_PREFLIGHT_ID = 'mtl_citymemory_promotion_challenge_v1';
export const CANDIDATE_SCHEMA = 'mtl_citymemory_bench_v1_candidate_v1.0.0';
export const CANDIDATE_BENCHMARK_ID = 'mtl_citymemory_bench_v1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_CANDIDATE_REPORT = path.join(ROOT, 'docs/dataset-factory/fixtures/benchmark-v1-candidate/preflight-report-v1.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs/dataset-factory/fixtures/promotion-challenge-v1/preflight-report-v1.json');

type GateStatus = 'pass' | 'blocked' | 'not_provided';

export type PromotionGate = {
  gate_id: string;
  status: GateStatus;
  reason: string;
};

export type PromotionChallengePreflight = {
  schema_version: typeof PROMOTION_PREFLIGHT_SCHEMA;
  preflight_id: typeof PROMOTION_PREFLIGHT_ID;
  generated_at: string;
  decision: 'no_ship';
  ship_authority: false;
  scope: {
    issue: 71;
    benchmark_id: typeof CANDIDATE_BENCHMARK_ID;
    mode: 'pre_lock_scaffold';
  };
  benchmark_v1: {
    candidate_report: {
      locator: string;
      status: 'available' | 'missing' | 'invalid';
      sha256: string | null;
    };
    issue_70_complete: false;
    lock_authority: false;
  };
  challenge_execution: {
    status: 'not_run';
    model_runs: 0;
    gpu_runs: 0;
    production_runs: 0;
    results_consumed: false;
  };
  gates: PromotionGate[];
  blockers: string[];
  next_steps: string[];
};

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function locator(filePath: string): string {
  const relative = path.relative(ROOT, filePath).replaceAll(path.sep, '/');
  if (relative && !relative.startsWith('../') && relative !== '..') return relative;
  return `<external-input>/${path.basename(filePath)}`;
}

function readObject(filePath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('candidate report must be a JSON object');
  return value as Record<string, unknown>;
}

function boolAt(value: unknown, key: string): boolean | null {
  const child = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  return typeof child === 'boolean' ? child : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function candidateGate(report: Record<string, unknown>, key: string): boolean {
  const gates = report.gates;
  return Boolean(gates && typeof gates === 'object' && boolAt(gates, key) === true);
}

function validCandidateShape(report: Record<string, unknown>): boolean {
  const requiredFields = [
    'generated_at',
    'inputs',
    'splits',
    'retrieval_shortfall',
    'classification_support',
    'promotion_thresholds',
    'acquisition_queue',
    'gates',
    'blockers',
  ];
  const inputFields = ['canonical_corpus', 'visual_family_graph', 'gold_batch_002', 'verified_intelligence', 'retrieval_tasks'];
  const inputs = report.inputs;
  const splits = report.splits;
  const retrievalShortfall = report.retrieval_shortfall;
  const classificationSupport = report.classification_support;
  const thresholds = report.promotion_thresholds;
  const acquisitionQueue = report.acquisition_queue;
  return requiredFields.every((field) => Object.hasOwn(report, field))
    && isRecord(inputs)
    && inputFields.every((field) => Object.hasOwn(inputs, field))
    && isRecord(splits)
    && isRecord(retrievalShortfall)
    && isRecord(classificationSupport)
    && isRecord(thresholds)
    && isRecord(acquisitionQueue)
    && isRecord(report.gates)
    && Array.isArray(report.blockers)
    && report.schema_version === CANDIDATE_SCHEMA
    && report.benchmark_id === CANDIDATE_BENCHMARK_ID
    && report.state === 'preflight_blocked'
    && report.candidate_ready === false
    && report.lock_authority === false
    && report.issue_70_complete === false;
}

export function buildPromotionChallengePreflight(options: {
  candidateReport: string;
  generatedAt?: string;
}): PromotionChallengePreflight {
  const candidatePath = options.candidateReport;
  const blockers: string[] = [];
  const nextSteps = [
    'Complete and independently review Benchmark v1 before any candidate model result is inspected.',
    'Register each baseline/candidate run, code/data hashes, resource budget, and output artifact before execution.',
    'Run the promotion challenge only on train/validation for tuning; reserve held-out test for the final report.',
    'Evaluate all mechanical thresholds, critical-query guardrails, leakage, latency, cost, and rollback/feature-flag evidence.',
  ];
  let candidateStatus: PromotionChallengePreflight['benchmark_v1']['candidate_report']['status'] = 'missing';
  let candidateHash: string | null = null;
  let report: Record<string, unknown> | null = null;

  if (!fs.existsSync(candidatePath)) {
    blockers.push(`Benchmark v1 candidate report is missing: ${locator(candidatePath)}`);
  } else {
    const bytes = fs.readFileSync(candidatePath);
    candidateHash = sha256(bytes);
    try {
      report = readObject(candidatePath);
    } catch (error) {
      candidateStatus = 'invalid';
      blockers.push(`Benchmark v1 candidate report is not valid JSON/object: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (report && !validCandidateShape(report)) {
      candidateStatus = 'invalid';
      blockers.push('Benchmark v1 candidate report does not have the #70 fail-closed pre-lock shape.');
    }
    if (report && validCandidateShape(report)) {
      candidateStatus = 'available';
      if (Array.isArray(report.blockers)) {
        for (const blocker of report.blockers) {
          if (typeof blocker === 'string' && blocker.length) blockers.push(`#70 candidate blocker: ${blocker}`);
        }
      }
    }
  }

  blockers.push('Benchmark v1 is not locked; #70 explicitly reports issue_70_complete=false and lock_authority=false.');
  blockers.push('No candidate model, reranker, baseline comparison, held-out report, or promotion result exists in this preflight.');
  blockers.push('Production promotion is outside this scaffold and has no feature-flag, rollback, latency, cost, or operational approval evidence.');

  const gates: PromotionGate[] = [
    {
      gate_id: 'candidate_report_shape',
      status: candidateStatus === 'available' ? 'pass' : 'blocked',
      reason: candidateStatus === 'available' ? 'The #70 candidate report is present and preserves its fail-closed shape.' : 'A valid #70 candidate report is required before challenge planning can be bound to benchmark inputs.',
    },
    {
      gate_id: 'benchmark_v1_locked',
      status: 'blocked',
      reason: 'Benchmark v1 lock authority is explicitly false in the #70 contract.',
    },
    {
      gate_id: 'promotion_thresholds_authorized',
      status: 'blocked',
      reason: 'The #70 thresholds are explicitly proposed_not_authorized; they must be frozen and approved before candidate results are inspected.',
    },
    {
      gate_id: 'candidate_ready',
      status: candidateStatus === 'available' && report?.candidate_ready === true ? 'pass' : 'blocked',
      reason: 'The #70 candidate must become ready only after required evidence, support, split, and review gates pass; current preflight does not override that decision.',
    },
    {
      gate_id: 'family_split_leakage_audit',
      status: candidateStatus === 'available' && report ? (candidateGate(report, 'leakage_audit') ? 'pass' : 'blocked') : 'not_provided',
      reason: 'Family-component leakage must be audited on the locked benchmark; a missing or blocked candidate report cannot satisfy it.',
    },
    {
      gate_id: 'reviewed_gold_support',
      status: candidateStatus === 'available' && report ? (candidateGate(report, 'classification_support') && candidateGate(report, 'retrieval_support') ? 'pass' : 'blocked') : 'not_provided',
      reason: 'Classification and retrieval support must meet the #70 minimums before challenge execution.',
    },
    {
      gate_id: 'independent_benchmark_review',
      status: 'blocked',
      reason: 'Independent review of validity, arithmetic, source boundaries, and splits is not supplied by this scaffold.',
    },
    {
      gate_id: 'registered_baselines_and_candidate_runs',
      status: 'not_provided',
      reason: 'No model or baseline run is executed or accepted here; registration is a prerequisite for a later challenge.',
    },
    {
      gate_id: 'held_out_test_report',
      status: 'not_provided',
      reason: 'Held-out test is report-only and cannot be produced before the benchmark and challenge evidence are locked.',
    },
    {
      gate_id: 'production_readiness',
      status: 'not_provided',
      reason: 'Latency, cost, feature-flag, rollback, monitoring, and operational approval evidence are outside this offline preflight.',
    },
  ];

  return {
    schema_version: PROMOTION_PREFLIGHT_SCHEMA,
    preflight_id: PROMOTION_PREFLIGHT_ID,
    generated_at: options.generatedAt ?? datasetFactoryNowIso(),
    decision: 'no_ship',
    ship_authority: false,
    scope: { issue: 71, benchmark_id: CANDIDATE_BENCHMARK_ID, mode: 'pre_lock_scaffold' },
    benchmark_v1: {
      candidate_report: { locator: locator(candidatePath), status: candidateStatus, sha256: candidateHash },
      issue_70_complete: false,
      lock_authority: false,
    },
    challenge_execution: { status: 'not_run', model_runs: 0, gpu_runs: 0, production_runs: 0, results_consumed: false },
    gates,
    blockers,
    next_steps: nextSteps,
  };
}

export function validatePromotionChallengePreflight(preflight: PromotionChallengePreflight): void {
  if (preflight.decision !== 'no_ship' || preflight.ship_authority !== false) throw new Error('promotion preflight must remain no-ship and non-authoritative');
  if (preflight.benchmark_v1.issue_70_complete || preflight.benchmark_v1.lock_authority) throw new Error('promotion preflight cannot assert Benchmark v1 completion or lock authority');
  const execution = preflight.challenge_execution;
  if (execution.status !== 'not_run' || execution.model_runs !== 0 || execution.gpu_runs !== 0 || execution.production_runs !== 0 || execution.results_consumed) throw new Error('promotion preflight cannot contain execution or result claims');
  if (!preflight.blockers.length) throw new Error('promotion preflight must name at least one no-ship blocker');
  const gateIds = new Set(preflight.gates.map((gate) => gate.gate_id));
  if (gateIds.size !== preflight.gates.length) throw new Error('promotion preflight gate IDs must be unique');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'candidate-report': { type: 'string', default: DEFAULT_CANDIDATE_REPORT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'generated-at': { type: 'string' },
    },
  });
  const preflight = buildPromotionChallengePreflight({ candidateReport: resolvePath(values['candidate-report']!), generatedAt: values['generated-at'] });
  validatePromotionChallengePreflight(preflight);
  const output = resolvePath(values.output!);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(preflight, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: preflight.decision, ship_authority: preflight.ship_authority, candidate_report: preflight.benchmark_v1.candidate_report.status, output: locator(output) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exit(1); });
