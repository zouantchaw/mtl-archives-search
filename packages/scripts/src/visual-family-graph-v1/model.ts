import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VFG_SCHEMA_VERSION = 'visual_family_graph_v1.0.0';
export const VFG_VERSION = 'visual_family_graph_v1';
export const CANONICAL_CORPUS_SNAPSHOT_ID = 'd9239bffc50ad0b3c81e3f667ed4334a886bbcc62bfc70648a435ac4feeaeaa9';
export const CANONICAL_LOCAL_SHA256 = '904c042227af8698a214ad98805281fde9f7aea2256cb39a63be3c4f4ff66140';
export const CANONICAL_COUNTS = {
  corpus: 18_462,
  local: 14_822,
  d1: 13_499,
  aliases: 4_963,
  sourceGroups: 13_499,
  r2ArchiveImages: 18_431,
  r2Missing: 31,
  clipIndex: 18_382,
} as const;

export const EDGE_TYPES = [
  'exact_payload',
  'same_source_asset',
  'near_duplicate_phash',
  'visual_neighbor_clip',
  'visual_neighbor_dino',
  'sequence_precedes',
  'same_reportage',
  'same_aerial_run',
  'alternate_crop',
  'same_subject_unverified',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];
export type EvidenceAuthority = 'grouping_authoritative' | 'review_required' | 'uncertain';
export type Split = 'train' | 'validation' | 'test';

export type CorpusInputRow = {
  schema_version: typeof VFG_SCHEMA_VERSION;
  corpus_snapshot_id: string;
  canonical_corpus_reference_snapshot_id: typeof CANONICAL_CORPUS_SNAPSHOT_ID;
  record_id: string;
  numeric_id: number;
  systems: { local: boolean; d1: boolean };
  corpus_state: 'canonical' | 'production_only' | 'alias';
  canonical_source_record_id: string | null;
  alias_group_id: string | null;
  image_key: string;
  image_url: string;
  name: string;
  description: string;
  date: string;
  cote: string;
  source_identity: string;
  source_urls: string[];
  source_datasets: string[];
  source_record_ids: string[];
  source_record_sha256: string | null;
  rights: {
    license_id: string;
    attribution: string;
    notes: string;
    complete: boolean;
  };
};

export type PhashFeatureRow = {
  schema_version: typeof VFG_SCHEMA_VERSION;
  feature_version: 'phash_dct64_normalized_derivative_v1';
  record_id: string;
  image_key: string;
  status: 'success' | 'failure';
  derivative_contract_id: string;
  derivative_sha256: string | null;
  normalized_pixel_sha256: string | null;
  phash64: string | null;
  derivative_width: number | null;
  derivative_height: number | null;
  derivative_bytes: number;
  elapsed_ms: number;
  attempts: number;
  failure_code: string | null;
  failure_detail: string | null;
};

export type GraphEdge = {
  schema_version: typeof VFG_SCHEMA_VERSION;
  edge_id: string;
  source_record_id: string;
  target_record_id: string;
  edge_type: EdgeType;
  directed: boolean;
  authority: EvidenceAuthority;
  grouping_eligible: boolean;
  confidence: number;
  threshold: string | null;
  evidence: Record<string, unknown>;
};

export type LeakageMapRow = {
  schema_version: typeof VFG_SCHEMA_VERSION;
  record_id: string;
  leakage_status: 'grouped' | 'singleton';
  leakage_group_id: string | null;
  component_id: string;
  component_size: number;
  benchmark_split: Split;
  grouping_edge_types: EdgeType[];
};

export type ReviewDecision = {
  schema_version: typeof VFG_SCHEMA_VERSION;
  review_id: string;
  decision: 'positive' | 'negative' | 'abstain';
  image_inspected: boolean;
  reviewer: string;
  reviewed_at: string;
  notes: string;
};

export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function sha256(value: string | Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableId(prefix: string, values: string[]): string {
  return `${prefix}:${sha256(`${values.join('\0')}\n`)}`;
}

export function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function normalizeRecordId(value: unknown): string {
  const text = clean(value).replace(/\.json$/i, '');
  return text ? `${text}.json` : '';
}

export function numericRecordId(value: unknown): number {
  const match = /^mtl_archives_metadata_(\d+)\.json$/.exec(normalizeRecordId(value));
  if (!match) throw new Error(`Invalid record identity: ${clean(value) || '<empty>'}`);
  const result = Number(match[1]);
  if (!Number.isSafeInteger(result)) throw new Error(`Unsafe numeric record identity: ${value}`);
  return result;
}

export function normalizeSourceUrl(value: unknown): string {
  const text = clean(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return text;
  }
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stable(value), null, 2)}\n`, 'utf8');
}

export function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => stableJson(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

export function fileEvidence(filePath: string, rowCount?: number): Record<string, unknown> {
  const bytes = fs.readFileSync(filePath);
  return {
    path: filePath,
    sha256: sha256(bytes),
    byte_count: bytes.byteLength,
    ...(rowCount === undefined ? {} : { row_count: rowCount }),
  };
}

export function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function hamming64(a: string, b: string): number {
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent) throw new Error(`UnionFind missing value: ${value}`);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const [first, second] = [rootA, rootB].sort((x, y) => x.localeCompare(y));
    this.parent.set(second, first);
  }

  groups(): string[][] {
    const groups = new Map<string, string[]>();
    for (const value of this.parent.keys()) {
      const root = this.find(value);
      groups.set(root, [...(groups.get(root) ?? []), value]);
    }
    return [...groups.values()].map((values) => values.sort((a, b) => a.localeCompare(b)));
  }
}

export function deterministicSplit(componentId: string): Split {
  const bucket = Number.parseInt(sha256(componentId).slice(0, 8), 16) / 0x1_0000_0000;
  if (bucket < 0.8) return 'train';
  if (bucket < 0.9) return 'validation';
  return 'test';
}

export function wilson95(successes: number, total: number): { low: number; high: number } | null {
  if (!total) return null;
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { low: Number(Math.max(0, centre - margin).toFixed(6)), high: Number(Math.min(1, centre + margin).toFixed(6)) };
}
