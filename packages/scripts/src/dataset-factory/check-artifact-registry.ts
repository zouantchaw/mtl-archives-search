import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const DEFAULT_REGISTRY = path.join(MONOREPO_ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl');

type RegistryEntry = {
  stable_id: string;
  schema_version: string;
  artifact_schema_version: string;
  artifact_kind: 'file' | 'directory' | 'file_set';
  content_digest: { algorithm: 'sha256'; value: string; scope: 'file_bytes' | 'sorted_tree_manifest' };
  counts: { file_count: number; byte_count: number; row_count?: number };
  source_lineage: { description: string; source_artifact_ids: string[]; source_urls: string[] };
  storage: { storage_class: string; path_class: string; locator: string };
  generation: { command: string; code_ref: string };
  dependency_ids: string[];
  required_by: string[];
  rights_boundary: {
    license_id: string;
    attribution: string;
    commercial_use_allowed: boolean;
    notes: string;
  };
  created_at: string;
  creation_time_basis: string;
};

type ArtifactStats = {
  digest: string;
  fileCount: number;
  byteCount: number;
  rowCount: number | undefined;
};

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lineCount(filePath: string): number | undefined {
  if (!/\.(jsonl|ndjson)$/i.test(filePath)) return undefined;
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content) return 0;
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

function fileStats(filePath: string): ArtifactStats {
  const bytes = fs.readFileSync(filePath);
  return {
    digest: sha256(bytes),
    fileCount: 1,
    byteCount: bytes.byteLength,
    rowCount: lineCount(filePath),
  };
}

function walkFiles(root: string, current = root): string[] {
  const paths: string[] = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) paths.push(...walkFiles(root, absolute));
    if (entry.isFile()) paths.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return paths.sort();
}

function directoryStats(directoryPath: string): ArtifactStats {
  const files = walkFiles(directoryPath);
  if (files.length === 0) throw new Error(`Registered artifact directory is empty: ${directoryPath}`);
  let byteCount = 0;
  let rowCount = 0;
  let hasRows = false;
  const treeRows = files.map((relativePath) => {
    const absolute = path.join(directoryPath, relativePath);
    const bytes = fs.readFileSync(absolute);
    byteCount += bytes.byteLength;
    const rows = lineCount(absolute);
    if (rows !== undefined) {
      hasRows = true;
      rowCount += rows;
    }
    return `${relativePath}\t${sha256(bytes)}\t${bytes.byteLength}`;
  });
  return {
    digest: sha256(`${treeRows.join('\n')}\n`),
    fileCount: files.length,
    byteCount,
    rowCount: hasRows ? rowCount : undefined,
  };
}

function parseRegistry(filePath: string): RegistryEntry[] {
  if (!fs.existsSync(filePath)) throw new Error(`Artifact registry is missing: ${filePath}`);
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as RegistryEntry;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid registry field: ${label}`);
}

function validateEntry(entry: RegistryEntry, line: number): void {
  const prefix = `registry line ${line}`;
  assertString(entry.stable_id, `${prefix}.stable_id`);
  if (!/^dfv0_[a-z0-9_]+$/.test(entry.stable_id)) throw new Error(`Invalid artifact ID: ${entry.stable_id}`);
  if (entry.schema_version !== 'dataset_factory_artifact_registry_v0') {
    throw new Error(`${entry.stable_id}: unsupported schema_version ${entry.schema_version}`);
  }
  assertString(entry.artifact_schema_version, `${prefix}.artifact_schema_version`);
  if (!['file', 'directory', 'file_set'].includes(entry.artifact_kind)) throw new Error(`${entry.stable_id}: invalid artifact_kind`);
  if (entry.content_digest?.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(entry.content_digest?.value ?? '')) {
    throw new Error(`${entry.stable_id}: invalid SHA-256 digest`);
  }
  if (!Number.isInteger(entry.counts?.file_count) || entry.counts.file_count < 1) throw new Error(`${entry.stable_id}: invalid file_count`);
  if (!Number.isInteger(entry.counts?.byte_count) || entry.counts.byte_count < 0) throw new Error(`${entry.stable_id}: invalid byte_count`);
  if (entry.counts.row_count !== undefined && (!Number.isInteger(entry.counts.row_count) || entry.counts.row_count < 0)) {
    throw new Error(`${entry.stable_id}: invalid row_count`);
  }
  for (const value of [entry.source_lineage?.description, entry.storage?.locator, entry.generation?.command, entry.generation?.code_ref]) {
    assertString(value, `${entry.stable_id} required string`);
  }
  if (/[?&](X-Amz-|sig=|signature=|token=)/i.test(entry.storage.locator)) {
    throw new Error(`${entry.stable_id}: locator looks like a signed or tokenized URL`);
  }
  if (!Array.isArray(entry.dependency_ids) || !Array.isArray(entry.required_by) || entry.required_by.length === 0) {
    throw new Error(`${entry.stable_id}: dependency_ids and required_by must be arrays`);
  }
  if (Number.isNaN(Date.parse(entry.created_at))) throw new Error(`${entry.stable_id}: invalid created_at`);
  if (typeof entry.rights_boundary?.commercial_use_allowed !== 'boolean') throw new Error(`${entry.stable_id}: invalid rights boundary`);
}

function verifyArtifact(entry: RegistryEntry, artifactRoot: string): void {
  if (entry.storage.path_class !== 'repo_ignored_local') return;
  const artifactPath = path.resolve(artifactRoot, entry.storage.locator);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Missing required Dataset Factory artifact "${entry.stable_id}": ${artifactPath}. `
        + 'Restore it from the recorded lineage or use a tracked fixture for smoke tests.',
    );
  }
  const stats = fs.statSync(artifactPath).isDirectory() ? directoryStats(artifactPath) : fileStats(artifactPath);
  const expected = entry.content_digest.value;
  if (stats.digest !== expected) throw new Error(`${entry.stable_id}: SHA-256 mismatch (expected ${expected}, got ${stats.digest})`);
  if (stats.fileCount !== entry.counts.file_count) throw new Error(`${entry.stable_id}: file_count mismatch`);
  if (stats.byteCount !== entry.counts.byte_count) throw new Error(`${entry.stable_id}: byte_count mismatch`);
  if (entry.counts.row_count !== undefined && stats.rowCount !== entry.counts.row_count) {
    throw new Error(`${entry.stable_id}: row_count mismatch (expected ${entry.counts.row_count}, got ${stats.rowCount ?? 'n/a'})`);
  }
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      registry: { type: 'string', default: DEFAULT_REGISTRY },
      'artifact-root': { type: 'string', default: MONOREPO_ROOT },
      'verify-files': { type: 'boolean', default: false },
      require: { type: 'string', default: '' },
    },
  });
  const registryPath = path.resolve(values.registry!);
  const artifactRoot = path.resolve(values['artifact-root']!);
  const entries = parseRegistry(registryPath);
  if (entries.length === 0) throw new Error('Artifact registry contains no entries.');
  entries.forEach((entry, index) => validateEntry(entry, index + 1));
  const byId = new Map<string, RegistryEntry>();
  for (const entry of entries) {
    if (byId.has(entry.stable_id)) throw new Error(`Duplicate artifact ID: ${entry.stable_id}`);
    byId.set(entry.stable_id, entry);
  }
  for (const entry of entries) {
    for (const dependencyId of [...entry.dependency_ids, ...entry.source_lineage.source_artifact_ids]) {
      if (!byId.has(dependencyId)) throw new Error(`${entry.stable_id}: unknown dependency ${dependencyId}`);
    }
  }
  const requiredIds = values.require!.split(',').map((value) => value.trim()).filter(Boolean);
  for (const id of requiredIds) {
    if (!byId.has(id)) throw new Error(`Required artifact is not registered: ${id}`);
  }
  if (values['verify-files']) entries.forEach((entry) => verifyArtifact(entry, artifactRoot));
  console.log(JSON.stringify({
    status: 'ok',
    registry: path.relative(MONOREPO_ROOT, registryPath),
    entries: entries.length,
    verified_files: values['verify-files'],
    artifact_root: values['verify-files'] ? artifactRoot : null,
  }));
}

main();
