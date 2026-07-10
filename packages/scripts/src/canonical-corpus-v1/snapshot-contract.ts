import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, sha256, stableJson } from './model.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');

export const INPUT_MANIFEST_VERSION = 'canonical_corpus_input_manifest_v1';
export const LIVE_INPUT_MANIFEST_PATH = path.join(
  MONOREPO_ROOT,
  'docs/dataset-factory/canonical-corpus-inputs.live.v1.json',
);
export const FIXTURE_INPUT_MANIFEST_PATH = path.join(
  MONOREPO_ROOT,
  'docs/dataset-factory/fixtures/canonical-corpus-v1/input-manifest.v1.json',
);

export type CorpusMode = 'live' | 'fixture';
export type InputKind = 'json' | 'jsonl';

export type SourceInputEvidence = {
  path: string;
  kind: InputKind;
  sha256: string;
  byte_count: number;
  row_count?: number;
};

export type SourceInputManifest = {
  schema_version: typeof INPUT_MANIFEST_VERSION;
  mode: CorpusMode;
  source_snapshot_id: string;
  inputs: SourceInputEvidence[];
};

export const RAW_INPUT_SPECS = [
  { path: 'local-manifest.jsonl', kind: 'jsonl' },
  { path: 'local-snapshot.json', kind: 'json' },
  { path: 'd1-manifest.jsonl', kind: 'jsonl' },
  { path: 'd1-query-manifest.json', kind: 'json' },
  { path: 'd1-snapshot.json', kind: 'json' },
  { path: 'r2-objects.jsonl', kind: 'jsonl' },
  { path: 'r2-samples.jsonl', kind: 'jsonl' },
  { path: 'r2-snapshot.json', kind: 'json' },
  { path: 'text-vector-ids.jsonl', kind: 'jsonl' },
  { path: 'text-vector-index.json', kind: 'json' },
  { path: 'clip-vector-ids.jsonl', kind: 'jsonl' },
  { path: 'clip-vector-index.json', kind: 'json' },
] as const satisfies ReadonlyArray<{ path: string; kind: InputKind }>;

export const GENERATED_OUTPUT_FILES = [
  'alias-map-v1.jsonl',
  'artifact-manifest-v1.json',
  'corpus-manifest-v1.jsonl',
  'r2-payload-duplicate-candidates-v1.jsonl',
  'reconciliation-v1.jsonl',
  'summary-v1.json',
  'unresolved-v1.jsonl',
] as const;

const MODE_AUXILIARY_FILES: Record<CorpusMode, readonly string[]> = {
  live: [],
  fixture: ['fixture-collection.json'],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertRootDirectory(root: string): string {
  const absolute = path.resolve(root);
  const stat = fs.lstatSync(absolute);
  assert(!stat.isSymbolicLink(), `input root must not be a symlink: ${root}`);
  assert(stat.isDirectory(), `input root must be a directory: ${root}`);
  return fs.realpathSync(absolute);
}

export function assertRelativeLocator(locator: string): void {
  assert(locator.length > 0, 'lineage locator must not be empty');
  assert(!path.isAbsolute(locator), `lineage locator must be relative: ${locator}`);
  assert(!locator.includes('\\'), `lineage locator must use POSIX separators: ${locator}`);
  assert(path.posix.normalize(locator) === locator && locator !== '.', `lineage locator must be normalized: ${locator}`);
  assert(!locator.split('/').includes('..'), `lineage locator escapes input root: ${locator}`);
}

export function resolveContainedFile(root: string, locator: string): string {
  assertRelativeLocator(locator);

  const rootReal = assertRootDirectory(root);
  const absolute = path.resolve(root, locator);
  assert(isContained(path.resolve(root), absolute), `lineage locator escapes input root: ${locator}`);

  let cursor = path.resolve(root);
  for (const part of locator.split('/')) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    assert(!stat.isSymbolicLink(), `lineage locator contains a symlink: ${locator}`);
  }
  const real = fs.realpathSync(absolute);
  assert(isContained(rootReal, real), `lineage locator realpath escapes input root: ${locator}`);
  assert(fs.statSync(real).isFile(), `lineage locator must resolve to a regular file: ${locator}`);
  return real;
}

function rowCountAndParse(filePath: string, kind: InputKind): number | undefined {
  const content = fs.readFileSync(filePath, 'utf8');
  if (kind === 'json') {
    JSON.parse(content);
    return undefined;
  }
  let count = 0;
  for (const [index, line] of content.split('\n').entries()) {
    if (!line) continue;
    try {
      JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    count += 1;
  }
  return count;
}

export function canonicalSourceSnapshotId(inputs: SourceInputEvidence[]): string {
  const canonical = [...inputs]
    .map((input) => ({
      path: input.path,
      kind: input.kind,
      sha256: input.sha256,
      byte_count: input.byte_count,
      ...(input.row_count === undefined ? {} : { row_count: input.row_count }),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return sha256(`${stableJson(canonical)}\n`);
}

function assertInputManifestShape(value: SourceInputManifest, mode: CorpusMode): void {
  assert(stableJson(Object.keys(value).sort()) === stableJson(['inputs', 'mode', 'schema_version', 'source_snapshot_id']),
    'input manifest has unexpected or missing top-level fields');
  assert(value.schema_version === INPUT_MANIFEST_VERSION, 'input manifest schema version mismatch');
  assert(value.mode === mode, `input manifest mode ${value.mode} does not match ${mode}`);
  assert(/^[a-f0-9]{64}$/.test(value.source_snapshot_id), 'input manifest source_snapshot_id must be SHA-256');
  assert(Array.isArray(value.inputs), 'input manifest inputs must be an array');
  assert(value.inputs.length === RAW_INPUT_SPECS.length, `input manifest must contain exactly ${RAW_INPUT_SPECS.length} raw inputs`);

  const locators = value.inputs.map((input) => input.path);
  assert(new Set(locators).size === locators.length, 'input manifest contains a duplicate lineage locator');
  for (const locator of locators) assertRelativeLocator(locator);
  const expected = [...RAW_INPUT_SPECS].sort((a, b) => a.path.localeCompare(b.path));
  const actual = [...value.inputs].sort((a, b) => a.path.localeCompare(b.path));
  for (const [index, spec] of expected.entries()) {
    const input = actual[index];
    const expectedKeys = spec.kind === 'jsonl'
      ? ['byte_count', 'kind', 'path', 'row_count', 'sha256']
      : ['byte_count', 'kind', 'path', 'sha256'];
    assert(stableJson(Object.keys(input ?? {}).sort()) === stableJson(expectedKeys),
      `${input?.path ?? '<missing>'}: input manifest entry has unexpected or missing fields`);
    assert(input?.path === spec.path, `input manifest has unexpected or missing raw locator: ${input?.path ?? '<missing>'}`);
    assert(input.kind === spec.kind, `${input.path}: expected input kind ${spec.kind}, got ${input.kind}`);
    assert(/^[a-f0-9]{64}$/.test(input.sha256), `${input.path}: invalid recorded SHA-256`);
    assert(Number.isSafeInteger(input.byte_count) && input.byte_count >= 0, `${input.path}: invalid recorded byte count`);
    if (spec.kind === 'jsonl') {
      assert(Number.isSafeInteger(input.row_count) && input.row_count! >= 0, `${input.path}: invalid recorded row count`);
    } else {
      assert(input.row_count === undefined, `${input.path}: JSON input must not record a row count`);
    }
  }
}

export function assertDirectoryAllowlist(root: string, mode: CorpusMode): void {
  assertRootDirectory(root);
  const allowed = new Set<string>([
    ...RAW_INPUT_SPECS.map((entry) => entry.path),
    ...GENERATED_OUTPUT_FILES,
    ...MODE_AUXILIARY_FILES[mode],
  ]);
  for (const name of fs.readdirSync(root).sort((a, b) => a.localeCompare(b))) {
    assert(allowed.has(name), `unexpected file in canonical corpus ${mode} directory: ${name}`);
  }
}

export function assertGeneratedOutputDirectory(root: string): void {
  if (!fs.existsSync(root)) return;
  assertRootDirectory(root);
  const allowed = new Set<string>(GENERATED_OUTPUT_FILES);
  for (const name of fs.readdirSync(root).sort((a, b) => a.localeCompare(b))) {
    assert(allowed.has(name), `unexpected file in canonical corpus output directory: ${name}`);
  }
}

export function assertExistingGeneratedOutputsSafe(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const name of GENERATED_OUTPUT_FILES) {
    try {
      fs.lstatSync(path.join(root, name));
      resolveContainedFile(root, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function inputManifestPath(mode: CorpusMode): string {
  return mode === 'live' ? LIVE_INPUT_MANIFEST_PATH : FIXTURE_INPUT_MANIFEST_PATH;
}

export function verifySourceSnapshot(
  inputDir: string,
  mode: CorpusMode,
  manifestPath = inputManifestPath(mode),
): { manifest: SourceInputManifest; inputs: SourceInputEvidence[]; source_snapshot_id: string } {
  assertDirectoryAllowlist(inputDir, mode);
  const manifest = readJson<SourceInputManifest>(manifestPath);
  assertInputManifestShape(manifest, mode);

  const verified = manifest.inputs.map((input) => {
    const filePath = resolveContainedFile(inputDir, input.path);
    const bytes = fs.readFileSync(filePath);
    assert(bytes.byteLength === input.byte_count, `${input.path}: source byte count drifted`);
    assert(sha256(bytes) === input.sha256, `${input.path}: source SHA-256 drifted`);
    const rowCount = rowCountAndParse(filePath, input.kind);
    assert(rowCount === input.row_count, `${input.path}: source row count drifted`);
    return { ...input };
  });
  const sourceSnapshotId = canonicalSourceSnapshotId(verified);
  assert(sourceSnapshotId === manifest.source_snapshot_id, 'input manifest source_snapshot_id drifted');
  return { manifest, inputs: verified, source_snapshot_id: sourceSnapshotId };
}
