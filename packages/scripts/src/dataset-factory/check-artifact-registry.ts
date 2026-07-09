import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const DEFAULT_REGISTRY = path.join(MONOREPO_ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl');
const REGISTRY_SCHEMA = path.join(MONOREPO_ROOT, 'docs/dataset-factory/artifact-registry.schema.v0.json');
const ROOT_PACKAGE = path.join(MONOREPO_ROOT, 'package.json');

type ArtifactKind = 'file' | 'directory' | 'file_set';
type DigestScope = 'file_bytes' | 'sorted_tree_manifest';
type GenerationMethod =
  | 'automated'
  | 'review_assisted'
  | 'human_authored'
  | 'automated_with_human_inputs'
  | 'external_snapshot';

type RegistryEntry = {
  stable_id: string;
  schema_version: string;
  artifact_schema_version: string;
  artifact_kind: ArtifactKind;
  content_digest: { algorithm: 'sha256'; value: string; scope: DigestScope };
  counts: { file_count: number; byte_count: number; row_count?: number };
  source_lineage: { description: string; source_artifact_ids: string[]; source_urls: string[] };
  storage: {
    storage_class: 'local_filesystem' | 'object_store' | 'tracked_repository' | 'remote_snapshot';
    path_class: 'repo_ignored_local' | 'external_object_store' | 'tracked_fixture' | 'remote_api_snapshot';
    locator: string;
    members?: string[];
  };
  generation: {
    method: GenerationMethod;
    command: string;
    code_ref: string;
    human_input_ids: string[];
  };
  dependency_ids: string[];
  required_by: string[];
  rights_boundary: {
    license_id: string;
    attribution: string;
    commercial_use_allowed: boolean;
    notes: string;
  };
  created_at: string;
  creation_time_basis: 'report_metadata' | 'filesystem_mtime' | 'latest_file_mtime';
};

type ArtifactStats = {
  digest: string;
  fileCount: number;
  byteCount: number;
  rowCount: number | undefined;
};

type ValidationOptions = {
  artifactRoot: string;
  verifyFiles: boolean;
  rootScripts: Set<string>;
};

type AjvLike = { compile<T>(schema: Record<string, unknown>): ValidateFunction<T> };
const Ajv2020 = Ajv2020Import as unknown as new (options: Record<string, unknown>) => AjvLike;
const addFormats = addFormatsImport as unknown as (instance: AjvLike) => void;
const registrySchema = JSON.parse(fs.readFileSync(REGISTRY_SCHEMA, 'utf-8')) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile<RegistryEntry>(registrySchema);

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lineCount(filePath: string): number | undefined {
  if (!/\.(jsonl|ndjson)$/i.test(filePath)) return undefined;
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content) return 0;
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

function statsForFiles(root: string, relativePaths: string[]): ArtifactStats {
  if (relativePaths.length === 0) throw new Error(`Registered artifact has no files: ${root}`);
  let byteCount = 0;
  let rowCount = 0;
  let hasRows = false;
  const treeRows = [...relativePaths].sort().map((relativePath) => {
    const absolute = path.join(root, relativePath);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new Error(`Registered artifact member is not a file: ${absolute}`);
    const bytes = fs.readFileSync(absolute);
    byteCount += bytes.byteLength;
    const rows = lineCount(absolute);
    if (rows !== undefined) {
      hasRows = true;
      rowCount += rows;
    }
    return `${relativePath.split(path.sep).join('/')}\t${sha256(bytes)}\t${bytes.byteLength}`;
  });
  return {
    digest: sha256(`${treeRows.join('\n')}\n`),
    fileCount: relativePaths.length,
    byteCount,
    rowCount: hasRows ? rowCount : undefined,
  };
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
  return statsForFiles(directoryPath, walkFiles(directoryPath));
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

function schemaErrorMessage(entry: unknown, line: number): string {
  const id = typeof entry === 'object' && entry !== null && 'stable_id' in entry
    ? String((entry as { stable_id?: unknown }).stable_id)
    : `registry line ${line}`;
  const errors = (validateSchema.errors ?? []).map((error: ErrorObject) => {
    const location = error.instancePath || '/';
    const detail = error.params && Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : '';
    return `${location} ${error.message ?? 'is invalid'}${detail}`;
  });
  return `${id}: schema validation failed: ${errors.join('; ')}`;
}

function assertContained(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes repository root: ${target}`);
  }
}

function assertSortedUnique(values: string[], label: string): void {
  const sorted = [...new Set(values)].sort();
  if (values.length !== sorted.length || values.some((value, index) => value !== sorted[index])) {
    throw new Error(`${label} must be sorted and unique`);
  }
}

function validateEntrySemantics(entry: RegistryEntry, artifactRoot: string): void {
  if (/[?&](x-amz-|sig=|signature=|token=)/i.test(entry.storage.locator)) {
    throw new Error(`${entry.stable_id}: locator looks like a signed or tokenized URL`);
  }
  const expectedScope: DigestScope = entry.artifact_kind === 'file' ? 'file_bytes' : 'sorted_tree_manifest';
  if (entry.content_digest.scope !== expectedScope) {
    throw new Error(`${entry.stable_id}: digest scope ${entry.content_digest.scope} is invalid for ${entry.artifact_kind}`);
  }

  if (entry.artifact_kind === 'file' && entry.counts.file_count !== 1) {
    throw new Error(`${entry.stable_id}: file artifacts must have file_count 1`);
  }
  if (entry.artifact_kind === 'file_set') {
    const members = entry.storage.members ?? [];
    if (members.length === 0) throw new Error(`${entry.stable_id}: file_set requires storage.members`);
    assertSortedUnique(members, `${entry.stable_id}.storage.members`);
    if (entry.counts.file_count !== members.length) {
      throw new Error(`${entry.stable_id}: file_set count does not match storage.members`);
    }
  } else if (entry.storage.members !== undefined) {
    throw new Error(`${entry.stable_id}: ${entry.artifact_kind} artifacts cannot declare storage.members`);
  }

  const expectedStorageClass = {
    repo_ignored_local: 'local_filesystem',
    external_object_store: 'object_store',
    tracked_fixture: 'tracked_repository',
    remote_api_snapshot: 'remote_snapshot',
  }[entry.storage.path_class];
  if (entry.storage.storage_class !== expectedStorageClass) {
    throw new Error(`${entry.stable_id}: storage_class does not match path_class`);
  }

  if (entry.storage.path_class === 'repo_ignored_local' || entry.storage.path_class === 'tracked_fixture') {
    if (path.isAbsolute(entry.storage.locator)) throw new Error(`${entry.stable_id}: locator must be repository-relative`);
    const artifactPath = path.resolve(artifactRoot, entry.storage.locator);
    assertContained(artifactRoot, artifactPath, `${entry.stable_id} locator`);
    if (entry.storage.path_class === 'repo_ignored_local' && !entry.storage.locator.startsWith('data/')) {
      throw new Error(`${entry.stable_id}: repo_ignored_local locator must be under data/`);
    }
    if (entry.storage.path_class === 'tracked_fixture' && !entry.storage.locator.startsWith('docs/dataset-factory/fixtures/')) {
      throw new Error(`${entry.stable_id}: tracked_fixture locator must be under docs/dataset-factory/fixtures/`);
    }
    for (const member of entry.storage.members ?? []) {
      const memberPath = path.resolve(artifactPath, member);
      assertContained(artifactPath, memberPath, `${entry.stable_id} member`);
    }
  }
}

function loadRootScripts(): Set<string> {
  const packageJson = JSON.parse(fs.readFileSync(ROOT_PACKAGE, 'utf-8')) as { scripts?: Record<string, string> };
  return new Set(Object.keys(packageJson.scripts ?? {}));
}

function validateGenerationCommands(entries: RegistryEntry[], rootScripts: Set<string>): void {
  for (const entry of entries) {
    const matches = entry.generation.command.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/g);
    for (const match of matches) {
      const script = match[1];
      if (!rootScripts.has(script)) throw new Error(`${entry.stable_id}: unknown root npm script ${script}`);
    }
  }
}

function validateDependencyGraph(entries: RegistryEntry[]): Map<string, RegistryEntry> {
  const byId = new Map<string, RegistryEntry>();
  for (const entry of entries) {
    if (byId.has(entry.stable_id)) throw new Error(`Duplicate artifact ID: ${entry.stable_id}`);
    byId.set(entry.stable_id, entry);
  }

  for (const entry of entries) {
    const dependencySet = new Set(entry.dependency_ids);
    const lineageSet = new Set(entry.source_lineage.source_artifact_ids);
    if (dependencySet.size !== lineageSet.size || [...dependencySet].some((id) => !lineageSet.has(id))) {
      throw new Error(`${entry.stable_id}: dependency_ids must exactly match source_lineage.source_artifact_ids`);
    }
    for (const dependencyId of dependencySet) {
      if (!byId.has(dependencyId)) throw new Error(`${entry.stable_id}: unknown dependency ${dependencyId}`);
    }
    for (const humanInputId of entry.generation.human_input_ids) {
      const input = byId.get(humanInputId);
      if (!input) throw new Error(`${entry.stable_id}: unknown human input ${humanInputId}`);
      if (!dependencySet.has(humanInputId)) throw new Error(`${entry.stable_id}: human input ${humanInputId} is not a dependency`);
      if (input.generation.method !== 'human_authored') {
        throw new Error(`${entry.stable_id}: human input ${humanInputId} is not marked human_authored`);
      }
    }
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    const currentState = state.get(id);
    if (currentState === 'visited') return;
    if (currentState === 'visiting') {
      const cycleStart = stack.indexOf(id);
      throw new Error(`Dependency cycle detected: ${[...stack.slice(cycleStart), id].join(' -> ')}`);
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dependencyId of byId.get(id)?.dependency_ids ?? []) visit(dependencyId);
    stack.pop();
    state.set(id, 'visited');
  };
  for (const id of byId.keys()) visit(id);
  return byId;
}

function verifyArtifact(entry: RegistryEntry, artifactRoot: string): void {
  if (entry.storage.path_class !== 'repo_ignored_local' && entry.storage.path_class !== 'tracked_fixture') return;
  const artifactPath = path.resolve(artifactRoot, entry.storage.locator);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Missing required Dataset Factory artifact "${entry.stable_id}": ${artifactPath}. `
        + 'Restore it from the recorded lineage or use a tracked fixture for smoke tests.',
    );
  }

  const stat = fs.statSync(artifactPath);
  let stats: ArtifactStats;
  if (entry.artifact_kind === 'file') {
    if (!stat.isFile()) throw new Error(`${entry.stable_id}: artifact_kind file does not match locator`);
    stats = fileStats(artifactPath);
  } else if (entry.artifact_kind === 'directory') {
    if (!stat.isDirectory()) throw new Error(`${entry.stable_id}: artifact_kind directory does not match locator`);
    stats = directoryStats(artifactPath);
  } else {
    if (!stat.isDirectory()) throw new Error(`${entry.stable_id}: file_set locator must be a directory`);
    stats = statsForFiles(artifactPath, entry.storage.members ?? []);
  }

  const expected = entry.content_digest.value;
  if (stats.digest !== expected) throw new Error(`${entry.stable_id}: SHA-256 mismatch (expected ${expected}, got ${stats.digest})`);
  if (stats.fileCount !== entry.counts.file_count) throw new Error(`${entry.stable_id}: file_count mismatch`);
  if (stats.byteCount !== entry.counts.byte_count) throw new Error(`${entry.stable_id}: byte_count mismatch`);
  if (entry.counts.row_count !== undefined && stats.rowCount !== entry.counts.row_count) {
    throw new Error(`${entry.stable_id}: row_count mismatch (expected ${entry.counts.row_count}, got ${stats.rowCount ?? 'n/a'})`);
  }
}

function validateRegistry(entries: RegistryEntry[], options: ValidationOptions): Map<string, RegistryEntry> {
  if (entries.length === 0) throw new Error('Artifact registry contains no entries.');
  entries.forEach((entry, index) => {
    if (!validateSchema(entry)) throw new Error(schemaErrorMessage(entry, index + 1));
    validateEntrySemantics(entry, options.artifactRoot);
  });
  const byId = validateDependencyGraph(entries);
  validateGenerationCommands(entries, options.rootScripts);
  if (options.verifyFiles) entries.forEach((entry) => verifyArtifact(entry, options.artifactRoot));
  return byId;
}

function runSelfTests(entries: RegistryEntry[], options: ValidationOptions): string[] {
  type MutableEntry = RegistryEntry & Record<string, unknown>;
  const tests: Array<{
    name: string;
    expected: string;
    mutate: (copy: MutableEntry[]) => void;
  }> = [
    {
      name: 'schema_enum',
      expected: 'must be equal to one of the allowed values',
      mutate: (copy) => { copy[0].storage.storage_class = 'not_a_schema_value' as RegistryEntry['storage']['storage_class']; },
    },
    {
      name: 'schema_additional_property',
      expected: 'must NOT have additional properties',
      mutate: (copy) => { copy[0].unexpected_property = true; },
    },
    {
      name: 'digest_scope',
      expected: 'must be equal to constant',
      mutate: (copy) => { copy[0].content_digest.scope = 'sorted_tree_manifest'; },
    },
    {
      name: 'artifact_kind',
      expected: 'must be equal to one of the allowed values',
      mutate: (copy) => { copy[0].artifact_kind = 'archive' as ArtifactKind; },
    },
    {
      name: 'locator_containment',
      expected: 'escapes repository root',
      mutate: (copy) => { copy[0].storage.locator = '../outside.jsonl'; },
    },
    {
      name: 'stable_id_uniqueness',
      expected: 'Duplicate artifact ID',
      mutate: (copy) => { copy.push(structuredClone(copy[0])); },
    },
    {
      name: 'dependency_existence',
      expected: 'unknown dependency',
      mutate: (copy) => {
        copy[0].dependency_ids = ['dfv0_missing_dependency'];
        copy[0].source_lineage.source_artifact_ids = ['dfv0_missing_dependency'];
      },
    },
    {
      name: 'dependency_cycle',
      expected: 'Dependency cycle detected',
      mutate: (copy) => {
        copy[0].dependency_ids = [copy[1].stable_id];
        copy[0].source_lineage.source_artifact_ids = [copy[1].stable_id];
      },
    },
    {
      name: 'generation_command_exists',
      expected: 'unknown root npm script',
      mutate: (copy) => { copy[0].generation.command = 'npm run definitely-not-a-script'; },
    },
  ];

  const passed: string[] = [];
  for (const test of tests) {
    const copy = structuredClone(entries) as MutableEntry[];
    test.mutate(copy);
    try {
      validateRegistry(copy, { ...options, verifyFiles: false });
      throw new Error(`Self-test ${test.name} unexpectedly passed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(test.expected)) {
        throw new Error(`Self-test ${test.name} failed for the wrong reason: ${message}`);
      }
      passed.push(test.name);
    }
  }
  return passed;
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      registry: { type: 'string', default: DEFAULT_REGISTRY },
      'artifact-root': { type: 'string', default: MONOREPO_ROOT },
      'verify-files': { type: 'boolean', default: false },
      'self-test': { type: 'boolean', default: false },
      require: { type: 'string', default: '' },
    },
  });
  const registryPath = path.resolve(values.registry!);
  const artifactRoot = path.resolve(values['artifact-root']!);
  const entries = parseRegistry(registryPath);
  const options = {
    artifactRoot,
    verifyFiles: values['verify-files']!,
    rootScripts: loadRootScripts(),
  };
  const byId = validateRegistry(entries, options);
  const requiredIds = values.require!.split(',').map((value) => value.trim()).filter(Boolean);
  for (const id of requiredIds) {
    if (!byId.has(id)) throw new Error(`Required artifact is not registered: ${id}`);
  }
  const selfTests = values['self-test'] ? runSelfTests(entries, options) : [];
  console.log(JSON.stringify({
    status: 'ok',
    registry: path.relative(MONOREPO_ROOT, registryPath),
    entries: entries.length,
    verified_files: values['verify-files'],
    artifact_root: values['verify-files'] ? artifactRoot : null,
    self_tests: selfTests,
  }));
}

main();
