import { CORPUS_VERSION, idRange, sha256, type R2InventoryRow } from './model.js';

export const R2_SAMPLE_PER_STRATUM_DEFAULT = 2;
export const R2_SAMPLE_PER_STRATUM_MAX = 4;
export const R2_SAMPLE_MAX_SELECTED_KEYS = 64;
export const R2_SAMPLE_REQUESTS_PER_KEY = 2;
export const R2_SAMPLE_MAX_REQUESTS = 128;
export const REQUIRED_R2_EVIDENCE = [
  'mtl_archives_image_9247.jpg',
  'mtl_archives_image_9696.jpg',
] as const;

export type R2SamplePlan = {
  seed: string;
  per_stratum: number;
  stratum_count: number;
  required_keys_present: string[];
  selected_keys: string[];
  selected_key_count: number;
  requests_per_key: number;
  total_request_cap: number;
  planned_request_count: number;
};

export function parseR2SamplePerStratum(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('--r2-sample-per-stratum must be a strict positive decimal integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--r2-sample-per-stratum exceeds the safe integer range');
  if (parsed > R2_SAMPLE_PER_STRATUM_MAX) {
    throw new Error(`--r2-sample-per-stratum must be <= ${R2_SAMPLE_PER_STRATUM_MAX}`);
  }
  return parsed;
}

export function r2SampleStratum(row: R2InventoryRow): string {
  if (row.object_class === 'archive_image') return `archive_image:${idRange(row.numeric_id)}`;
  const parts = row.key.split('/').filter(Boolean);
  const prefix = parts.slice(0, Math.min(2, parts.length)).join('/') || '<root>';
  return `${row.object_class}:${prefix}`;
}

export function planR2Samples(
  rows: R2InventoryRow[],
  perStratum = R2_SAMPLE_PER_STRATUM_DEFAULT,
  seed = CORPUS_VERSION,
): R2SamplePlan {
  if (!Number.isSafeInteger(perStratum) || perStratum <= 0 || perStratum > R2_SAMPLE_PER_STRATUM_MAX) {
    throw new Error(`R2 sample per-stratum value must be an integer from 1 through ${R2_SAMPLE_PER_STRATUM_MAX}`);
  }
  const keys = rows.map((row) => row.key);
  if (new Set(keys).size !== keys.length) throw new Error('R2 sampling planner requires unique inventory keys');

  const groups = new Map<string, R2InventoryRow[]>();
  for (const row of rows) {
    const stratum = r2SampleStratum(row);
    const group = groups.get(stratum) ?? [];
    group.push(row);
    groups.set(stratum, group);
  }
  const selected = new Set<string>();
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) =>
      sha256(`${seed}\0${a.key}`).localeCompare(sha256(`${seed}\0${b.key}`)) || a.key.localeCompare(b.key));
    for (const row of ranked.slice(0, perStratum)) selected.add(row.key);
  }
  const inventoryKeys = new Set(keys);
  const requiredKeysPresent = REQUIRED_R2_EVIDENCE.filter((key) => inventoryKeys.has(key));
  for (const key of requiredKeysPresent) selected.add(key);

  const selectedKeys = [...selected].sort((a, b) => a.localeCompare(b));
  if (selectedKeys.length > R2_SAMPLE_MAX_SELECTED_KEYS) {
    throw new Error(`R2 sample plan selects ${selectedKeys.length} keys, exceeding cap ${R2_SAMPLE_MAX_SELECTED_KEYS}`);
  }
  const plannedRequests = selectedKeys.length * R2_SAMPLE_REQUESTS_PER_KEY;
  if (plannedRequests > R2_SAMPLE_MAX_REQUESTS) {
    throw new Error(`R2 sample plan requires ${plannedRequests} requests, exceeding cap ${R2_SAMPLE_MAX_REQUESTS}`);
  }
  return {
    seed,
    per_stratum: perStratum,
    stratum_count: groups.size,
    required_keys_present: [...requiredKeysPresent],
    selected_keys: selectedKeys,
    selected_key_count: selectedKeys.length,
    requests_per_key: R2_SAMPLE_REQUESTS_PER_KEY,
    total_request_cap: R2_SAMPLE_MAX_REQUESTS,
    planned_request_count: plannedRequests,
  };
}
