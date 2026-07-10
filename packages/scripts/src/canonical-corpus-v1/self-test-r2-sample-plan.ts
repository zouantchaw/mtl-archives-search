import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readJsonl, stableJson, type R2InventoryRow } from './model.js';
import {
  R2_SAMPLE_MAX_REQUESTS,
  R2_SAMPLE_PER_STRATUM_DEFAULT,
  parseR2SamplePerStratum,
  planR2Samples,
} from './r2-sample-plan.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const FIXTURE_INPUT = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/canonical-corpus-v1/r2-objects.jsonl');
const DEFAULT_LIVE_INPUT = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/canonical_corpus_v1/live/r2-objects.jsonl');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectFailure(name: string, action: () => unknown): void {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`${name}: expected failure`);
}

function syntheticRow(index: number): R2InventoryRow {
  return {
    schema_version: 'canonical_corpus_v1.0.0',
    key: `social-stories/group-${index}/sample.jpg`,
    object_class: 'social_content',
    normalized_identity: null,
    numeric_id: null,
    size_bytes: 1,
    etag: `etag-${index}`,
    checksum_algorithms: [],
    checksum_type: null,
    last_modified: null,
    storage_class: null,
  };
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { 'live-input': { type: 'string', default: DEFAULT_LIVE_INPUT } },
  });
  const invalid = ['-1', '0', '1.5', 'NaN', 'Infinity', '9007199254740992', '5', '999999999999999999999999'];
  for (const value of invalid) expectFailure(`invalid per-stratum ${value}`, () => parseR2SamplePerStratum(value));
  const fixturePlan = planR2Samples(readJsonl<R2InventoryRow>(FIXTURE_INPUT), R2_SAMPLE_PER_STRATUM_DEFAULT);
  assert(fixturePlan.selected_key_count === 4, `fixture default selected ${fixturePlan.selected_key_count}, expected 4`);
  assert(fixturePlan.planned_request_count === 8, 'fixture request arithmetic drifted');
  expectFailure('global selected-key cap', () => planR2Samples(
    Array.from({ length: 65 }, (_, index) => syntheticRow(index)),
    1,
  ));
  const liveInput = path.resolve(values['live-input']!);
  let liveSelectedKeys: number | null = null;
  if (fs.existsSync(liveInput)) {
    const livePlan = planR2Samples(readJsonl<R2InventoryRow>(liveInput), R2_SAMPLE_PER_STRATUM_DEFAULT);
    assert(livePlan.selected_key_count === 54, `live default selected ${livePlan.selected_key_count}, expected 54`);
    assert(livePlan.planned_request_count <= R2_SAMPLE_MAX_REQUESTS, 'live plan exceeds request cap');
    liveSelectedKeys = livePlan.selected_key_count;
  }
  console.log(stableJson({
    status: 'ok',
    invalid_cases: invalid.length,
    global_cap_case: 1,
    fixture_selected_keys: fixturePlan.selected_key_count,
    fixture_planned_requests: fixturePlan.planned_request_count,
    live_selected_keys: liveSelectedKeys,
    credentials_used: false,
    network_used: false,
  }));
}

main();
