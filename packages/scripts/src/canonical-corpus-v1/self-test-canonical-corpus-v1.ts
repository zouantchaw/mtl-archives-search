import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalCorpus } from './build-canonical-corpus-v1.js';
import { checkCanonicalCorpus } from './check-canonical-corpus-v1.js';
import { readJson, readJsonl, stableJson, writeJson, writeJsonl } from './model.js';
import {
  FIXTURE_INPUT_MANIFEST_PATH,
  RAW_INPUT_SPECS,
  resolveContainedFile,
  type SourceInputManifest,
} from './snapshot-contract.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const FIXTURE_DIR = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/canonical-corpus-v1');

type JsonObject = Record<string, unknown>;
type TestResult = { name: string; error: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function prepareFixture(root: string, built = true): string {
  const input = path.join(root, 'input');
  fs.mkdirSync(input, { recursive: true });
  for (const spec of RAW_INPUT_SPECS) fs.copyFileSync(path.join(FIXTURE_DIR, spec.path), path.join(input, spec.path));
  writeJson(path.join(input, 'fixture-collection.json'), {
    schema_version: 'canonical_corpus_v1.0.0',
    collection_mode: 'tracked_fixture_no_network',
    source: 'docs/dataset-factory/fixtures/canonical-corpus-v1',
    files: RAW_INPUT_SPECS.map((entry) => entry.path).sort(),
  });
  if (built) buildCanonicalCorpus(input, input, undefined, { mode: 'fixture' });
  return input;
}

function mutateJson(filePath: string, mutate: (value: JsonObject) => void): void {
  const value = readJson<JsonObject>(filePath);
  mutate(value);
  writeJson(filePath, value);
}

function manifestCopy(root: string, mutate: (manifest: SourceInputManifest) => void): string {
  const manifest = clone(readJson<SourceInputManifest>(FIXTURE_INPUT_MANIFEST_PATH));
  mutate(manifest);
  const target = path.join(root, 'input-manifest.json');
  writeJson(target, manifest);
  return target;
}

function runFailureCase(
  root: string,
  name: string,
  action: (input: string, caseRoot: string) => void,
  results: TestResult[],
  built = true,
): void {
  const caseRoot = path.join(root, `case-${String(results.length).padStart(2, '0')}`);
  fs.mkdirSync(caseRoot, { recursive: true });
  const input = prepareFixture(caseRoot, built);
  try {
    action(input, caseRoot);
  } catch (error) {
    results.push({ name, error: error instanceof Error ? error.message : String(error) });
    return;
  }
  throw new Error(`${name}: expected failure`);
}

function summaryMutation(pathParts: string[], value: unknown): (input: string) => void {
  return (input) => {
    mutateJson(path.join(input, 'summary-v1.json'), (summary) => {
      let cursor: JsonObject = summary;
      for (const part of pathParts.slice(0, -1)) cursor = cursor[part] as JsonObject;
      cursor[pathParts.at(-1)!] = value;
    });
    checkCanonicalCorpus(input, { mode: 'fixture' });
  };
}

function main(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-corpus-v1-self-test-'));
  const results: TestResult[] = [];
  try {
    runFailureCase(root, 'modified D1 content cannot be blessed by rebuild', (input) => {
      fs.appendFileSync(path.join(input, 'd1-manifest.jsonl'), ' ');
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture' });
    }, results, false);
    runFailureCase(root, 'modified recorded input hash', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[2].sha256 = '0'.repeat(64); });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'modified recorded input bytes', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[2].byte_count += 1; });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'modified recorded input rows', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[2].row_count! += 1; });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'modified source snapshot id', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.source_snapshot_id = 'f'.repeat(64); });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'missing raw input', (input) => {
      fs.rmSync(path.join(input, 'd1-manifest.jsonl'));
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture' });
    }, results, false);
    runFailureCase(root, 'unexpected raw input', (input) => {
      fs.copyFileSync(path.join(input, 'd1-manifest.jsonl'), path.join(input, 'extra-input.jsonl'));
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture' });
    }, results, false);
    runFailureCase(root, 'duplicate lineage locator', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[1].path = value.inputs[0].path; });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'modified input kind', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[2].kind = 'json'; });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'absolute lineage locator', (input, caseRoot) => {
      const external = path.join(caseRoot, 'external-d1.jsonl');
      fs.copyFileSync(path.join(input, 'd1-manifest.jsonl'), external);
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[2].path = external; });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'escaping lineage locator', (input, caseRoot) => {
      const manifest = manifestCopy(caseRoot, (value) => { value.inputs[2].path = '../external-d1.jsonl'; });
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture', inputManifestPath: manifest });
    }, results, false);
    runFailureCase(root, 'external matching-content leaf symlink', (input, caseRoot) => {
      const external = path.join(caseRoot, 'external-d1.jsonl');
      const target = path.join(input, 'd1-manifest.jsonl');
      fs.copyFileSync(target, external);
      fs.rmSync(target);
      fs.symlinkSync(external, target);
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture' });
    }, results, false);
    runFailureCase(root, 'symlinked input root parent', (input, caseRoot) => {
      const linked = path.join(caseRoot, 'linked-input');
      fs.symlinkSync(input, linked, 'dir');
      buildCanonicalCorpus(linked, linked, undefined, { mode: 'fixture' });
    }, results, false);
    runFailureCase(root, 'locator parent-directory symlink', (input, caseRoot) => {
      const external = path.join(caseRoot, 'external-parent');
      fs.mkdirSync(external);
      fs.copyFileSync(path.join(input, 'd1-manifest.jsonl'), path.join(external, 'd1-manifest.jsonl'));
      fs.symlinkSync(external, path.join(input, 'linked-parent'), 'dir');
      resolveContainedFile(input, 'linked-parent/d1-manifest.jsonl');
    }, results, false);
    runFailureCase(root, 'generated artifact leaf symlink', (input, caseRoot) => {
      const target = path.join(input, 'summary-v1.json');
      const external = path.join(caseRoot, 'external-summary.json');
      fs.copyFileSync(target, external);
      fs.rmSync(target);
      fs.symlinkSync(external, target);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'generated artifact symlink before rebuild', (input, caseRoot) => {
      const target = path.join(input, 'summary-v1.json');
      const external = path.join(caseRoot, 'external-summary-before-build.json');
      fs.copyFileSync(target, external);
      fs.rmSync(target);
      fs.symlinkSync(external, target);
      buildCanonicalCorpus(input, input, undefined, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'absolute generated artifact locator', (input, caseRoot) => {
      const external = path.join(caseRoot, 'external-summary.json');
      fs.copyFileSync(path.join(input, 'summary-v1.json'), external);
      mutateJson(path.join(input, 'artifact-manifest-v1.json'), (manifest) => {
        const artifact = (manifest.artifacts as JsonObject[]).find((entry) => entry.path === 'summary-v1.json')!;
        artifact.path = external;
      });
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'escaping generated artifact locator', (input) => {
      mutateJson(path.join(input, 'artifact-manifest-v1.json'), (manifest) => {
        const artifact = (manifest.artifacts as JsonObject[]).find((entry) => entry.path === 'summary-v1.json')!;
        artifact.path = '../summary-v1.json';
      });
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'unexpected generated output file', (input) => {
      fs.writeFileSync(path.join(input, 'unexpected-output.json'), '{}\n');
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'artifact lineage hash mutation', (input) => {
      mutateJson(path.join(input, 'artifact-manifest-v1.json'), (manifest) => {
        ((manifest.lineage as JsonObject).inputs as JsonObject[])[0].sha256 = '0'.repeat(64);
      });
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'artifact lineage byte mutation', (input) => {
      mutateJson(path.join(input, 'artifact-manifest-v1.json'), (manifest) => {
        ((manifest.lineage as JsonObject).inputs as JsonObject[])[0].byte_count = 0;
      });
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'artifact lineage row mutation', (input) => {
      mutateJson(path.join(input, 'artifact-manifest-v1.json'), (manifest) => {
        ((manifest.lineage as JsonObject).inputs as JsonObject[])[0].row_count = 0;
      });
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'artifact source snapshot mutation', (input) => {
      mutateJson(path.join(input, 'artifact-manifest-v1.json'), (manifest) => { manifest.source_snapshot_id = '0'.repeat(64); });
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);

    runFailureCase(root, 'summary schema required field', summaryMutation(['summary_version'], null), results);
    runFailureCase(root, 'summary identity rule', summaryMutation(['identity_rule', 'join'], 'numeric order'), results);
    runFailureCase(root, 'summary primary states', summaryMutation(['states', 'canonical_active'], 2), results);
    runFailureCase(root, 'summary secondary flags', summaryMutation(['secondary_flags', 'r2_missing'], 99), results);
    runFailureCase(root, 'summary presence matrix', summaryMutation(['system_presence_matrix', 'local=1,d1=1,r2=1,text=1,clip=1'], 99), results);
    runFailureCase(root, 'summary source slice', summaryMutation(['by_source_dataset', 'fixture'], 99), results);
    runFailureCase(root, 'summary media slice', summaryMutation(['by_media_type', 'archive_image'], 99), results);
    runFailureCase(root, 'summary ID range slice', summaryMutation(['by_id_range', '00000-04999'], 99), results);
    runFailureCase(root, 'summary counts', summaryMutation(['counts', 'local_rows'], 99), results);
    runFailureCase(root, 'summary rights totals and rate', summaryMutation(['rights_and_attribution', 'complete_rate_percent'], 50), results);
    runFailureCase(root, 'summary D1 schema coverage', summaryMutation(['d1', 'schema_existence', 'ocr_text'], false), results);
    runFailureCase(root, 'summary D1 populated coverage', summaryMutation(['d1', 'populated_row_coverage', 'rotation'], 99), results);
    runFailureCase(root, 'summary R2 classes', summaryMutation(['r2', 'exact_inventory', 'by_class', 'archive_image'], 99), results);
    runFailureCase(root, 'summary R2 sample metrics', summaryMutation(['r2', 'sampled_magic', 'pdf'], 99), results);
    runFailureCase(root, 'summary vector coverage and rate', summaryMutation(['vector_coverage', 'text_missing_rate_percent'], 50), results);
    runFailureCase(root, 'summary source snapshots', summaryMutation(['source_snapshots', 'd1', 'started_at'], '2000-01-01T00:00:00.000Z'), results);
    runFailureCase(root, 'summary state samples', summaryMutation(['samples', 'by_primary_state', 'canonical_active'], ['missing']), results);
    runFailureCase(root, 'summary 9696 evidence', summaryMutation(['decision_9696', 'evidence', 'production_d1_member_9247'], true), results);

    runFailureCase(root, 'row r2_missing conflict on active row', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => entry.primary_state === 'canonical_active')!;
      row.secondary_flags = [...(row.secondary_flags as string[]), 'r2_missing'].sort();
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'row systems conflict', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => entry.primary_state === 'canonical_active')!;
      (row.systems as JsonObject).local = false;
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    for (const flag of ['local_missing', 'd1_missing', 'text_vector_missing', 'clip_vector_missing']) {
      runFailureCase(root, `row ${flag} conflict`, (input) => {
        const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
        const row = rows.find((entry) => entry.primary_state === 'canonical_active')!;
        row.secondary_flags = [...(row.secondary_flags as string[]), flag].sort();
        writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
        checkCanonicalCorpus(input, { mode: 'fixture' });
      }, results);
    }
    runFailureCase(root, 'row primary state conflict', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      rows.find((entry) => entry.primary_state === 'canonical_active')!.primary_state = 'clip_vector_missing';
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'row alias flag conflict', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => entry.primary_state === 'duplicate_or_alias')!;
      row.secondary_flags = (row.secondary_flags as string[]).filter((flag) => flag !== 'alias_identity');
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'alias map target conflict', (input) => {
      const aliases = readJsonl<JsonObject>(path.join(input, 'alias-map-v1.jsonl'));
      aliases[0].canonical_identity = 'mtl_archives_metadata_0.json';
      writeJsonl(path.join(input, 'alias-map-v1.jsonl'), aliases);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'invalid identity flag on record', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => entry.primary_state === 'canonical_active')!;
      row.secondary_flags = [...(row.secondary_flags as string[]), 'invalid_identity_format'].sort();
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'malformed namespace flag on record', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => entry.primary_state === 'canonical_active')!;
      row.secondary_flags = [...(row.secondary_flags as string[]), 'malformed_archive_key'].sort();
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'document media and magic conflict', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => entry.primary_state === 'canonical_document')!;
      row.media_type = 'archive_image';
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);
    runFailureCase(root, 'sampled content type and magic flag conflict', (input) => {
      const rows = readJsonl<JsonObject>(path.join(input, 'reconciliation-v1.jsonl'));
      const row = rows.find((entry) => (entry.secondary_flags as string[]).includes('sampled_content_type_magic_mismatch'))!;
      row.secondary_flags = (row.secondary_flags as string[]).filter((flag) => flag !== 'sampled_content_type_magic_mismatch');
      writeJsonl(path.join(input, 'reconciliation-v1.jsonl'), rows);
      checkCanonicalCorpus(input, { mode: 'fixture' });
    }, results);

    assert(results.length === 54, `expected 54 negative self-tests, got ${results.length}`);
    console.log(stableJson({
      status: 'ok',
      negative_self_tests: results.length,
      tests: results.map((result) => result.name),
      credentials_used: false,
      network_used: false,
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
