import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvImport from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import {
  buildPromotionChallengePreflight,
  validatePromotionChallengePreflight,
  type PromotionChallengePreflight,
} from './build-promotion-challenge-preflight-v1.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const schemaPath = path.join(root, 'docs/dataset-factory/promotion-challenge-preflight-v1.schema.json');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mtl-promotion-preflight-'));
const candidatePath = path.join(tempRoot, 'candidate.json');

const Ajv = AjvImport as unknown as new (options: Record<string, unknown>) => {
  compile: (schema: unknown) => ((value: unknown) => boolean) & { errors?: unknown };
  errorsText: () => string;
};

function writeCandidate(value: Record<string, unknown>): void {
  fs.writeFileSync(candidatePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function candidate(gates: Record<string, boolean> = {}): Record<string, unknown> {
  return {
    schema_version: 'mtl_citymemory_bench_v1_candidate_v1.0.0',
    benchmark_id: 'mtl_citymemory_bench_v1',
    state: 'preflight_blocked',
    candidate_ready: false,
    lock_authority: false,
    issue_70_complete: false,
    generated_at: '2026-08-31T12:00:00.000Z',
    inputs: {
      canonical_corpus: {},
      visual_family_graph: {},
      gold_batch_002: {},
      verified_intelligence: {},
      retrieval_tasks: {},
    },
    splits: {},
    retrieval_shortfall: {},
    classification_support: {},
    promotion_thresholds: {},
    acquisition_queue: {},
    gates,
    blockers: ['synthetic benchmark blocker'],
  };
}

try {
  const missing = buildPromotionChallengePreflight({ candidateReport: path.join(tempRoot, 'missing.json'), generatedAt: '2026-08-31T12:00:00.000Z' });
  validatePromotionChallengePreflight(missing);
  assert.equal(missing.decision, 'no_ship');
  assert.equal(missing.ship_authority, false);
  assert.equal(missing.benchmark_v1.candidate_report.status, 'missing');
  assert.equal(missing.challenge_execution.gpu_runs, 0);
  assert.ok(missing.blockers.some((blocker) => blocker.includes('candidate report is missing')));

  writeCandidate(candidate({ leakage_audit: true, classification_support: true, retrieval_support: true }));
  const available = buildPromotionChallengePreflight({ candidateReport: candidatePath, generatedAt: '2026-08-31T12:00:00.000Z' });
  validatePromotionChallengePreflight(available);
  assert.equal(available.benchmark_v1.candidate_report.status, 'available');
  assert.match(available.benchmark_v1.candidate_report.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(available.gates.find((gate) => gate.gate_id === 'family_split_leakage_audit')?.status, 'pass');
  assert.equal(available.gates.find((gate) => gate.gate_id === 'benchmark_v1_locked')?.status, 'blocked');

  writeCandidate({
    ...candidate({ leakage_audit: true, classification_support: true, retrieval_support: true }),
    candidate_ready: true,
  });
  const invalid = buildPromotionChallengePreflight({ candidateReport: candidatePath, generatedAt: '2026-08-31T12:00:00.000Z' });
  validatePromotionChallengePreflight(invalid);
  assert.equal(invalid.benchmark_v1.candidate_report.status, 'invalid');
  assert.ok(invalid.blockers.some((blocker) => blocker.includes('fail-closed pre-lock shape')));
  assert.equal(invalid.gates.find((gate) => gate.gate_id === 'candidate_ready')?.status, 'blocked');
  assert.equal(invalid.gates.find((gate) => gate.gate_id === 'family_split_leakage_audit')?.status, 'not_provided');
  assert.equal(invalid.gates.find((gate) => gate.gate_id === 'reviewed_gold_support')?.status, 'not_provided');

  const ajv = new Ajv({ allErrors: true, strict: false });
  const addFormats = addFormatsImport as unknown as (instance: unknown) => void;
  addFormats(ajv);
  const validateSchema = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
  assert.equal(validateSchema(available), true, ajv.errorsText());
  assert.throws(() => validatePromotionChallengePreflight({ ...available, ship_authority: true } as unknown as PromotionChallengePreflight), /no-ship and non-authoritative/);
  assert.throws(() => validatePromotionChallengePreflight({ ...available, challenge_execution: { ...available.challenge_execution, gpu_runs: 1 } } as unknown as PromotionChallengePreflight), /cannot contain execution/);
  console.log(JSON.stringify({ status: 'promotion_challenge_preflight_self_test_passed', cases: 15 }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
