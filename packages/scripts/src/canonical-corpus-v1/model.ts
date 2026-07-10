import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createInterface } from 'node:readline';

export const CORPUS_VERSION = 'canonical_corpus_v1';
export const SCHEMA_VERSION = 'canonical_corpus_v1.0.0';
export const RIGHTS_LICENSE_ID = 'cc-by-4.0-derived';
export const RIGHTS_NOTES =
  'Derived archive metadata; preserve Archives de la Ville de Montreal attribution and source links.';
export const ALIAS_BASIS = 'exact_source_identity_single_d1_member';
export const ALIAS_GROUP_REASON =
  'Exact normalized source identity has exactly one production D1 member; all other members are reversible aliases.';

export const PRIMARY_STATES = [
  'canonical_active',
  'canonical_document',
  'local_only_candidate',
  'production_only_candidate',
  'missing_r2_object',
  'orphan_r2_object',
  'text_vector_missing',
  'clip_vector_missing',
  'vector_only_or_stale',
  'duplicate_or_alias',
  'excluded_with_reason',
  'unresolved_blocker',
] as const;

export type PrimaryState = (typeof PRIMARY_STATES)[number];
export type R2ObjectClass = 'archive_image' | 'social_content' | 'content_asset' | 'other';

export type LocalInventoryRow = {
  schema_version: typeof SCHEMA_VERSION;
  corpus_version: typeof CORPUS_VERSION;
  identity: string;
  numeric_id: number;
  metadata_filename: string;
  image_filename: string;
  resolved_image_filename: string;
  image_exists: boolean | null;
  image_size_bytes: number | null;
  name: string;
  description: string;
  primary_source_url: string;
  source_urls: string[];
  source_datasets: string[];
  source_record_ids: string[];
  source_record_sha256: string;
  cote: string;
  attribution: string;
  rights: {
    license_id: typeof RIGHTS_LICENSE_ID;
    attribution: string;
    notes: typeof RIGHTS_NOTES;
    complete: boolean;
  };
};

export type R2InventoryRow = {
  schema_version: typeof SCHEMA_VERSION;
  key: string;
  object_class: R2ObjectClass;
  normalized_identity: string | null;
  numeric_id: number | null;
  size_bytes: number;
  etag: string | null;
  checksum_algorithms: string[];
  checksum_type: string | null;
  last_modified: string | null;
  storage_class: string | null;
};

export type R2SampleRow = {
  schema_version: typeof SCHEMA_VERSION;
  key: string;
  object_class: R2ObjectClass;
  stratum: string;
  required_evidence: boolean;
  head_ok: boolean;
  range_get_ok: boolean;
  content_type: string | null;
  content_length: number | null;
  etag: string | null;
  checksum_sha256: string | null;
  magic_kind: 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf' | 'tiff' | 'unknown' | 'unavailable';
  sampled_bytes: number;
  error: string | null;
};

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${stableJson(value)}\n`);
}

export function writeJsonl(filePath: string, values: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = values.map((value) => stableJson(value)).join('\n');
  fs.writeFileSync(filePath, body ? `${body}\n` : '');
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function readJsonl<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export async function* readJsonlStream(filePath: string): AsyncGenerator<{ value: Record<string, unknown>; raw: string }> {
  const input = fs.createReadStream(filePath);
  const stream = filePath.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield { value: JSON.parse(line) as Record<string, unknown>, raw: line };
    } catch (error) {
      throw new Error(`${filePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function sortedUnique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function parseMetadataIdentity(value: unknown): { identity: string; numericId: number } | null {
  const text = cleanText(value);
  const match = /^mtl_archives_metadata_(\d+)\.json$/.exec(text);
  if (!match) return null;
  const numericId = Number(match[1]);
  if (!Number.isSafeInteger(numericId)) return null;
  return { identity: text, numericId };
}

export function parseArchiveImageKey(value: unknown): {
  key: string;
  identity: string;
  numericId: number;
  extension: string;
} | null {
  const key = cleanText(value).replace(/^\/+/, '');
  const match = /^mtl_archives_image_(\d+)\.([A-Za-z0-9]+)$/.exec(key);
  if (!match) return null;
  const numericId = Number(match[1]);
  if (!Number.isSafeInteger(numericId)) return null;
  return {
    key,
    identity: `mtl_archives_metadata_${match[1]}.json`,
    numericId,
    extension: match[2].toLowerCase(),
  };
}

export function classifyR2Key(value: unknown): R2ObjectClass {
  const key = cleanText(value).replace(/^\/+/, '');
  if (parseArchiveImageKey(key)) return 'archive_image';
  if (/^(social-stories|social-posts|stories|reels|content)\//.test(key)) return 'social_content';
  if (/^(photo-[^/]+\.[A-Za-z0-9]+|upload-[^/]+\.[A-Za-z0-9]+)$/.test(key)) return 'content_asset';
  return 'other';
}

export function deriveSourceDataset(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('phototheque-archives')) return 'phototheque_archives';
  const aerialRange = /vues-aeriennes-(\d{4})-(\d{4})/.exec(lower);
  if (aerialRange) return `aerial_${aerialRange[1]}_${aerialRange[2]}`;
  if (lower.includes('vues-aeriennes-obliques')) return 'aerial_obliques_1960_1992';
  const aerialYear = /vues-aeriennes-(\d{4})/.exec(lower);
  if (aerialYear) return `aerial_${aerialYear[1]}`;
  if (lower.includes('vues-aeriennes-archives')) return 'aerial_1947_1949';
  return url ? 'montreal_archives_unknown_collection' : 'unknown';
}

export function idRange(numericId: number | null): string {
  if (numericId === null) return 'non_numeric';
  const start = Math.floor(numericId / 5000) * 5000;
  return `${String(start).padStart(5, '0')}-${String(start + 4999).padStart(5, '0')}`;
}

export function detectMagic(bytes: Uint8Array): R2SampleRow['magic_kind'] {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(bytes.slice(0, 6)).toString('ascii'))) return 'gif';
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.length >= 5 && Buffer.from(bytes.slice(0, 5)).toString('ascii') === '%PDF-') return 'pdf';
  if (bytes.length >= 4) {
    const head = Buffer.from(bytes.slice(0, 4));
    if (head.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || head.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return 'tiff';
  }
  return 'unknown';
}

export function fileEvidence(filePath: string, rowCount?: number): {
  path: string;
  sha256: string;
  byte_count: number;
  row_count?: number;
} {
  const bytes = fs.readFileSync(filePath);
  return {
    path: filePath.split(path.sep).join('/'),
    sha256: sha256(bytes),
    byte_count: bytes.byteLength,
    ...(rowCount === undefined ? {} : { row_count: rowCount }),
  };
}
