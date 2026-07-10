import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCanonicalCorpus } from './build-canonical-corpus-v1.js';
import { checkCanonicalCorpus } from './check-canonical-corpus-v1.js';
import { PRIMARY_STATES, readJson, sha256, stableJson } from './model.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const COLLECTOR = path.join(SCRIPT_DIR, 'collect-canonical-corpus-v1.ts');
const FIXTURE_DIR = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/canonical-corpus-v1');
const OUTPUT_NAMES = [
  'corpus-manifest-v1.jsonl',
  'reconciliation-v1.jsonl',
  'alias-map-v1.jsonl',
  'unresolved-v1.jsonl',
  'r2-payload-duplicate-candidates-v1.jsonl',
  'summary-v1.json',
  'artifact-manifest-v1.json',
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runFixtureCollection(output: string): void {
  const tsx = path.join(MONOREPO_ROOT, 'node_modules/.bin/tsx');
  const result = spawnSync(tsx, [COLLECTOR, '--fixture', '--fixture-dir', FIXTURE_DIR, '--output', output], {
    cwd: MONOREPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) throw new Error(`Fixture collection failed: ${(result.stderr || result.stdout).trim()}`);
}

function outputDigest(directory: string): string {
  return sha256(`${OUTPUT_NAMES.map((name) => `${name}\t${sha256(fs.readFileSync(path.join(directory, name)))}`).join('\n')}\n`);
}

function main(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-corpus-v1-smoke-'));
  try {
    const first = path.join(tempRoot, 'first');
    const second = path.join(tempRoot, 'second');
    runFixtureCollection(first);
    runFixtureCollection(second);
    buildCanonicalCorpus(first, first, undefined, { mode: 'fixture' });
    buildCanonicalCorpus(second, second, undefined, { mode: 'fixture' });
    const firstCheck = checkCanonicalCorpus(first, { mode: 'fixture' });
    const secondCheck = checkCanonicalCorpus(second, { mode: 'fixture' });
    const firstSummary = readJson<{ states: Record<string, number> }>(path.join(first, 'summary-v1.json'));
    for (const state of PRIMARY_STATES) assert(firstSummary.states[state] === 1, `Fixture must exercise ${state} exactly once`);
    for (const name of OUTPUT_NAMES) {
      assert(fs.readFileSync(path.join(first, name)).equals(fs.readFileSync(path.join(second, name))), `${name} is not deterministic`);
    }
    assert(stableJson(firstCheck) === stableJson(secondCheck), 'Repeated fixture checks differ');
    console.log(stableJson({
      status: 'ok',
      fixture_states: firstSummary.states,
      output_sha256: outputDigest(first),
      checks: firstCheck,
      network_used: false,
      credentials_used: false,
    }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
