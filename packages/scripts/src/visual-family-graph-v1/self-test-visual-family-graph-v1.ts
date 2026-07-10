import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import {
  CANONICAL_CORPUS_SNAPSHOT_ID,
  VFG_SCHEMA_VERSION,
  fileEvidence,
  readJson,
  readJsonl,
  sha256,
  stableId,
  stableJson,
  writeJson,
  writeJsonl,
  type CorpusInputRow,
  type GraphEdge,
  type PhashFeatureRow,
} from './model.js';
import { computeVisualFeature } from './extract-phash-v1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const SPEC_PATH = path.join(ROOT, 'docs/dataset-factory/fixtures/visual-family-graph-v1/fixture-spec.json');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const BUILD = path.join(ROOT, 'packages/scripts/src/visual-family-graph-v1/build-visual-family-graph-v1.ts');
const CHECK = path.join(ROOT, 'packages/scripts/src/visual-family-graph-v1/check-visual-family-graph-v1.ts');

type SpecRecord = {
  id: number;
  state: CorpusInputRow['corpus_state'];
  local: boolean;
  d1: boolean;
  source: string;
  name: string;
  date: string;
  image: string;
  phash?: string;
  pixel?: string;
  canonical?: number;
  dataset?: string;
  failure?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(args: string[], shouldPass: boolean, expectedMessage?: RegExp): void {
  const result = spawnSync(process.execPath, [TSX, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATASET_FACTORY_FIXED_NOW: '2026-07-10T12:30:00Z' } });
  const output = `${result.stdout}\n${result.stderr}`;
  if (shouldPass && result.status !== 0) throw new Error(`Command failed:\n${output}`);
  if (!shouldPass && result.status === 0) throw new Error(`Adversarial command unexpectedly passed:\n${output}`);
  if (!shouldPass && expectedMessage && !expectedMessage.test(output)) throw new Error(`Adversarial failure did not match ${expectedMessage}:\n${output}`);
}

function buildArgs(base: string, output: string): string[] {
  return [
    BUILD,
    '--corpus', path.join(base, 'input/corpus-input-v1.jsonl'),
    '--corpus-summary', path.join(base, 'input/corpus-input-summary-v1.json'),
    '--features', path.join(base, 'phash/phash-features-v1.jsonl'),
    '--feature-report', path.join(base, 'phash/phash-report-v1.json'),
    '--clip', path.join(base, 'clip.jsonl'),
    '--review', path.join(base, 'no-review.jsonl'),
    '--output', output,
    '--mode', 'fixture',
    '--review-per-stratum', '2',
  ];
}

function checkArgs(base: string): string[] {
  return [CHECK, '--root', base, '--mode', 'fixture', '--review', path.join(base, 'no-review.jsonl')];
}

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vfg-v1-self-test-'));
  const base = path.join(temp, 'visual_family_graph_v1');
  const inputDir = path.join(base, 'input');
  const localDir = path.join(base, 'canonical_local');
  const phashDir = path.join(base, 'phash');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });
  fs.mkdirSync(phashDir, { recursive: true });
  const spec = readJson<{ records: SpecRecord[]; clip_neighbors: unknown[]; expected: Record<string, number> }>(SPEC_PATH);
  const localRows = spec.records.filter((row) => row.local).map((row) => ({ identity: `mtl_archives_metadata_${row.id}.json`, source: row.source }));
  const sitemap = { schema_version: VFG_SCHEMA_VERSION, count: spec.records.filter((row) => row.d1).length, items: spec.records.filter((row) => row.d1).map((row) => ({ id: `mtl_archives_metadata_${row.id}.json`, imageUrl: `https://images.example.test/${row.image}`, name: row.name, dateValue: row.date })) };
  const details = spec.records.filter((row) => row.state === 'production_only').map((row) => ({ record_id: `mtl_archives_metadata_${row.id}.json`, item: { externalUrl: row.source, imageUrl: `https://images.example.test/${row.image}` } }));
  const localPath = path.join(localDir, 'local-manifest.jsonl');
  const sitemapPath = path.join(inputDir, 'd1-sitemap.json');
  const detailsPath = path.join(inputDir, 'd1-production-only-details.jsonl');
  writeJsonl(localPath, localRows);
  writeJson(sitemapPath, sitemap);
  writeJsonl(detailsPath, details);
  const apiOrigin = 'https://api.example.test';
  const acquisitionId = sha256(stableJson({
    schema_version: VFG_SCHEMA_VERSION,
    acquisition_kind: 'public_api_read_only_snapshot',
    canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
    api_origin: apiOrigin,
    local_sha256: fileEvidence(localPath, localRows.length).sha256,
    sitemap_sha256: fileEvidence(sitemapPath).sha256,
    production_details_sha256: fileEvidence(detailsPath, details.length).sha256,
    methods: ['GET /api/sitemap', 'GET /api/photos?id=<production-only-id>'],
  }));
  const corpus: CorpusInputRow[] = spec.records.map((row): CorpusInputRow => ({
    schema_version: VFG_SCHEMA_VERSION,
    corpus_snapshot_id: acquisitionId,
    canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
    record_id: `mtl_archives_metadata_${row.id}.json`,
    numeric_id: row.id,
    systems: { local: row.local, d1: row.d1 },
    corpus_state: row.state,
    canonical_source_record_id: row.canonical === undefined ? null : `mtl_archives_metadata_${row.canonical}.json`,
    alias_group_id: row.canonical === undefined && row.id !== 0 ? null : stableId('source-group', [row.source]),
    image_key: `mtl_archives_image_${row.image}`,
    image_url: `https://images.example.test/${row.image}`,
    name: row.name,
    description: '',
    date: row.date,
    cote: '',
    source_identity: row.source,
    source_urls: [row.source],
    source_datasets: [row.dataset ?? 'fixture'],
    source_record_ids: [`fixture:${row.id}`],
    source_record_sha256: row.local ? sha256(`fixture:${row.id}`) : null,
    rights: { license_id: 'cc-by-4.0-derived', attribution: 'Archives de la Ville de Montreal', notes: 'Fixture derived metadata.', complete: true },
  })).sort((a, b) => a.record_id.localeCompare(b.record_id));
  const corpusPath = path.join(inputDir, 'corpus-input-v1.jsonl');
  writeJsonl(corpusPath, corpus);
  writeJson(path.join(inputDir, 'corpus-input-summary-v1.json'), {
    acquisition_snapshot_id: acquisitionId,
    canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
    byte_equivalent_to_canonical_reference: false,
    acquisition: { api_origin: apiOrigin },
    counts: { corpus_records: corpus.length },
  });
  const contractId = stableId('derivative-contract', ['fixture']);
  const features: PhashFeatureRow[] = spec.records.map((row): PhashFeatureRow => ({
    schema_version: VFG_SCHEMA_VERSION,
    feature_version: 'phash_dct64_normalized_derivative_v1',
    record_id: `mtl_archives_metadata_${row.id}.json`,
    image_key: `mtl_archives_image_${row.image}`,
    status: row.failure ? 'failure' : 'success',
    derivative_contract_id: contractId,
    derivative_sha256: row.failure ? null : sha256(`derivative:${row.id}`),
    normalized_pixel_sha256: row.failure ? null : row.pixel!,
    phash64: row.failure ? null : row.phash!,
    derivative_width: row.failure ? null : 256,
    derivative_height: row.failure ? null : row.id === 5 ? 200 : 256,
    derivative_bytes: row.failure ? 0 : 1024 + row.id,
    elapsed_ms: 0,
    attempts: 1,
    failure_code: row.failure ?? null,
    failure_detail: row.failure ?? null,
  })).sort((a, b) => a.record_id.localeCompare(b.record_id));
  writeJsonl(path.join(phashDir, 'phash-features-v1.jsonl'), features);
  writeJsonl(path.join(phashDir, 'phash-failures-v1.jsonl'), features.filter((row) => row.status === 'failure'));
  writeJson(path.join(phashDir, 'phash-report-v1.json'), { transform_contract: { derivative_contract_id: contractId }, coverage: { feature_rows: features.length } });
  writeJsonl(path.join(base, 'clip.jsonl'), spec.clip_neighbors);

  const outputA = path.join(base, 'graph');
  const outputB = path.join(base, 'graph-repeat');
  run(buildArgs(base, outputA), true);
  run(buildArgs(base, outputB), true);
  run(checkArgs(base), true);
  const fixtureEdges = readJsonl<GraphEdge>(path.join(outputA, 'typed-edges-v1.jsonl'));
  for (const requiredType of ['exact_payload', 'same_source_asset', 'near_duplicate_phash', 'visual_neighbor_clip', 'sequence_precedes', 'same_aerial_run', 'alternate_crop', 'same_subject_unverified']) {
    assert(fixtureEdges.some((edge) => edge.edge_type === requiredType), `Fixture did not exercise ${requiredType}`);
  }
  assert(fixtureEdges.filter((edge) => edge.edge_type === 'near_duplicate_phash').every((edge) => !edge.grouping_eligible), 'Fixture pHash evidence forced grouping');
  assert(fixtureEdges.filter((edge) => edge.edge_type === 'same_subject_unverified').every((edge) => !edge.grouping_eligible), 'Fixture same-subject evidence forced grouping');
  const deterministicFiles = ['nodes-v1.jsonl', 'typed-edges-v1.jsonl', 'leakage-components-v1.jsonl', 'record-leakage-map-v1.jsonl', 'benchmark-splits-v1.jsonl', 'canonical-recommendations-v1.jsonl', 'review-packet-v1.jsonl'];
  const hashesA = deterministicFiles.map((name) => sha256(fs.readFileSync(path.join(outputA, name))));
  const hashesB = deterministicFiles.map((name) => sha256(fs.readFileSync(path.join(outputB, name))));
  assert(stableJson(hashesA) === stableJson(hashesB), 'Repeated fixture graph hashes differ');

  const edgesPath = path.join(outputA, 'typed-edges-v1.jsonl');
  const originalEdges = fs.readFileSync(edgesPath);
  const adversarialEdges = readJsonl<GraphEdge>(edgesPath);
  const subject = adversarialEdges.find((row) => row.edge_type === 'same_subject_unverified');
  assert(subject, 'Fixture did not produce same_subject_unverified edge');
  subject.grouping_eligible = true;
  writeJsonl(edgesPath, adversarialEdges);
  run(checkArgs(base), false, /review\/uncertain evidence forced grouping/);
  fs.writeFileSync(edgesPath, originalEdges);

  const payloadEdges = readJsonl<GraphEdge>(edgesPath);
  const payload = payloadEdges.find((row) => row.edge_type === 'exact_payload');
  assert(payload, 'Fixture did not produce exact_payload edge');
  payload.evidence.source_payload_equality_claimed = true;
  writeJsonl(edgesPath, payloadEdges);
  run(checkArgs(base), false, /unsupported source-payload equality claim/);
  fs.writeFileSync(edgesPath, originalEdges);

  const sourceEdges = readJsonl<GraphEdge>(edgesPath);
  const source = sourceEdges.find((row) => row.edge_type === 'same_source_asset');
  assert(source, 'Fixture did not produce same_source_asset edge');
  source.evidence.source_identity_exact_match = false;
  writeJsonl(edgesPath, sourceEdges);
  run(checkArgs(base), false, /source exact-match contract missing/);
  fs.writeFileSync(edgesPath, originalEdges);

  const splitPath = path.join(outputA, 'benchmark-splits-v1.jsonl');
  const originalSplits = fs.readFileSync(splitPath);
  const splitRows = readJsonl<Record<string, any>>(splitPath);
  splitRows[0].split = splitRows[0].split === 'train' ? 'test' : 'train';
  writeJsonl(splitPath, splitRows);
  run(checkArgs(base), false, /split artifact mismatch/);
  fs.writeFileSync(splitPath, originalSplits);

  const originalSitemap = fs.readFileSync(sitemapPath);
  const mutatedSitemap = readJson<Record<string, any>>(sitemapPath);
  mutatedSitemap.items[0].name = 'same-count mutable source drift';
  writeJson(sitemapPath, mutatedSitemap);
  run(checkArgs(base), false, /acquisition snapshot ID\/content mismatch/);
  fs.writeFileSync(sitemapPath, originalSitemap);

  const baseImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#111111' } })
    .composite([{ input: { create: { width: 24, height: 40, channels: 3, background: '#eeeeee' } }, left: 8, top: 12 }]).png().toBuffer();
  const shiftedImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#111111' } })
    .composite([{ input: { create: { width: 24, height: 40, channels: 3, background: '#eeeeee' } }, left: 32, top: 12 }]).png().toBuffer();
  const hashA = await computeVisualFeature(baseImage);
  const hashARepeat = await computeVisualFeature(baseImage);
  const hashB = await computeVisualFeature(shiftedImage);
  assert(hashA.phash64 === hashARepeat.phash64 && hashA.normalizedPixelSha256 === hashARepeat.normalizedPixelSha256, 'Visual feature extraction is not deterministic');
  assert(hashA.phash64 !== hashB.phash64, 'Adversarial shifted image did not change pHash');

  console.log(JSON.stringify({ status: 'ok', fixture_records: corpus.length, deterministic_hashes: Object.fromEntries(deterministicFiles.map((name, index) => [name, hashesA[index]])), adversarial_cases: 6 }));
  fs.rmSync(temp, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(`[vfg-v1:self-test] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
