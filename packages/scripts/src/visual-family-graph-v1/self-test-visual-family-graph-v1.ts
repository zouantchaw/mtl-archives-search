import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import {
  CANONICAL_CORPUS_SNAPSHOT_ID,
  PHASH_FEATURE_VERSION,
  VFG_SCHEMA_VERSION,
  fileEvidence,
  readJson,
  readJsonl,
  recommendationAssessment,
  sha256,
  stableId,
  stableJson,
  writeJson,
  writeJsonl,
  type CorpusInputRow,
  type GraphEdge,
  type PhashFeatureRow,
} from './model.js';
import { computeVisualFeature, readBoundedResponse, validateResumeRows } from './extract-phash-v1.js';

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

function expectThrow(action: () => unknown, expected: RegExp): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.test(message)) throw new Error(`Expected failure ${expected}, received: ${message}`);
    return;
  }
  throw new Error(`Expected failure ${expected}`);
}

function run(args: string[], shouldPass: boolean, expectedMessage?: RegExp): void {
  const result = spawnSync(process.execPath, [TSX, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATASET_FACTORY_FIXED_NOW: '2026-07-10T12:30:00Z' } });
  const output = `${result.stdout}\n${result.stderr}`;
  if (shouldPass && result.status !== 0) throw new Error(`Command failed:\n${output}`);
  if (!shouldPass && result.status === 0) throw new Error(`Adversarial command unexpectedly passed:\n${output}`);
  if (!shouldPass && expectedMessage && !expectedMessage.test(output)) throw new Error(`Adversarial failure did not match ${expectedMessage}:\n${output}`);
}

async function expectReject(action: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.test(message)) throw new Error(`Expected rejection ${expected}, received: ${message}`);
    return;
  }
  throw new Error(`Expected rejection ${expected}`);
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
  const spec = readJson<{ records: SpecRecord[]; clip_neighbors: unknown[]; expected: Record<string, number>; adversarial_large_aerial_run: { records: number; first_id: number; run_key: string } }>(SPEC_PATH);
  const largeRunRecords: SpecRecord[] = Array.from({ length: spec.adversarial_large_aerial_run.records }, (_, index) => {
    const sequence = String(index + 1).padStart(4, '0');
    const id = spec.adversarial_large_aerial_run.first_id + index;
    return {
      id,
      state: 'canonical',
      local: true,
      d1: true,
      source: `https://example.test/aerial/VM97-S9-D99-P${sequence}.tif`,
      name: `VM97-S9-D99-P${sequence}.tif`,
      date: '1965',
      image: `large-${sequence}.jpg`,
      dataset: 'aerial_obliques_fixture',
      failure: 'fixture_large_run_no_feature',
    };
  });
  const records = [...spec.records, ...largeRunRecords];
  const localRows = records.filter((row) => row.local).map((row) => ({ identity: `mtl_archives_metadata_${row.id}.json`, source: row.source }));
  const sitemap = { schema_version: VFG_SCHEMA_VERSION, count: records.filter((row) => row.d1).length, items: records.filter((row) => row.d1).map((row) => ({ id: `mtl_archives_metadata_${row.id}.json`, imageUrl: `https://images.example.test/${row.image}`, name: row.name, dateValue: row.date })) };
  const details = records.filter((row) => row.state === 'production_only').map((row) => ({ record_id: `mtl_archives_metadata_${row.id}.json`, item: { externalUrl: row.source, imageUrl: `https://images.example.test/${row.image}` } }));
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
  const corpus: CorpusInputRow[] = records.map((row): CorpusInputRow => ({
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
  const transformContract = { source: 'fixture', width: 256, height: 256, max_response_bytes: 1048576 };
  const contractId = stableId('derivative-contract', [stableJson(transformContract)]);
  const corpusInputSha256 = String(fileEvidence(corpusPath, corpus.length).sha256);
  const features: PhashFeatureRow[] = records.map((row): PhashFeatureRow => ({
    schema_version: VFG_SCHEMA_VERSION,
    feature_version: PHASH_FEATURE_VERSION,
    corpus_snapshot_id: acquisitionId,
    corpus_input_sha256: corpusInputSha256,
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
  writeJson(path.join(phashDir, 'phash-report-v1.json'), {
    feature_version: PHASH_FEATURE_VERSION,
    transform_contract: { ...transformContract, derivative_contract_id: contractId },
    source_snapshot: { acquisition_snapshot_id: acquisitionId, corpus_input_sha256: corpusInputSha256 },
    coverage: { feature_rows: features.length },
    lineage: {
      corpus: fileEvidence(corpusPath, corpus.length),
      features: fileEvidence(path.join(phashDir, 'phash-features-v1.jsonl'), features.length),
    },
  });
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
  const largeRunEdges = fixtureEdges.filter((edge) => edge.edge_type === 'same_aerial_run' && edge.evidence.run_key === spec.adversarial_large_aerial_run.run_key);
  assert(largeRunEdges.length === spec.adversarial_large_aerial_run.records - 1, 'Fixture >250 aerial run did not receive linear n-1 grouping edges');
  const leakageRows = readJsonl<Record<string, any>>(path.join(outputA, 'record-leakage-map-v1.jsonl'));
  const largeRunIds = new Set(largeRunRecords.map((row) => `mtl_archives_metadata_${row.id}.json`));
  const largeRunMappings = leakageRows.filter((row) => largeRunIds.has(row.record_id));
  assert(new Set(largeRunMappings.map((row) => row.component_id)).size === 1, 'Fixture >250 aerial run spans components');
  assert(new Set(largeRunMappings.map((row) => row.benchmark_split)).size === 1, 'Fixture >250 aerial run spans benchmark splits');
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
  run(checkArgs(base), false, /grouping eligibility\/authority contract mismatch/);
  fs.writeFileSync(edgesPath, originalEdges);

  const graphReportPath = path.join(outputA, 'graph-report-v1.json');
  const graphManifestPath = path.join(outputA, 'artifact-manifest-v1.json');
  const originalGraphReport = fs.readFileSync(graphReportPath);
  const originalGraphManifest = fs.readFileSync(graphManifestPath);
  const authorityTamper = readJsonl<GraphEdge>(edgesPath);
  const groupingEdge = authorityTamper.find((row) => row.edge_type === 'exact_payload' && row.grouping_eligible);
  assert(groupingEdge, 'Fixture did not produce grouping-authoritative exact edge');
  groupingEdge.authority = 'review_required';
  writeJsonl(edgesPath, authorityTamper);
  const tamperedReport = readJson<Record<string, any>>(graphReportPath);
  tamperedReport.edges.by_authority = Object.fromEntries(['grouping_authoritative', 'review_required', 'uncertain'].map((authority) => [authority, authorityTamper.filter((edge) => edge.authority === authority).length]));
  writeJson(graphReportPath, tamperedReport);
  const tamperedManifest = readJson<Record<string, any>>(graphManifestPath);
  for (const artifact of tamperedManifest.artifacts) {
    if (!['typed-edges-v1.jsonl', 'graph-report-v1.json'].includes(artifact.path)) continue;
    const evidence = fileEvidence(path.join(outputA, artifact.path), artifact.row_count);
    artifact.sha256 = evidence.sha256;
    artifact.byte_count = evidence.byte_count;
  }
  writeJson(graphManifestPath, tamperedManifest);
  run(checkArgs(base), false, /grouping eligibility\/authority contract mismatch/);
  fs.writeFileSync(edgesPath, originalEdges);
  fs.writeFileSync(graphReportPath, originalGraphReport);
  fs.writeFileSync(graphManifestPath, originalGraphManifest);

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

  const featurePath = path.join(phashDir, 'phash-features-v1.jsonl');
  const featureReportPath = path.join(phashDir, 'phash-report-v1.json');
  const originalFeatures = fs.readFileSync(featurePath);
  const originalFeatureReport = fs.readFileSync(featureReportPath);
  const runFeatureTamper = (mutate: (rows: PhashFeatureRow[]) => void, expected: RegExp): void => {
    const rows = readJsonl<PhashFeatureRow>(featurePath);
    mutate(rows);
    writeJsonl(featurePath, rows);
    const currentReport = readJson<Record<string, any>>(featureReportPath);
    currentReport.lineage.features = fileEvidence(featurePath, rows.length);
    writeJson(featureReportPath, currentReport);
    run(checkArgs(base), false, expected);
    fs.writeFileSync(featurePath, originalFeatures);
    fs.writeFileSync(featureReportPath, originalFeatureReport);
  };
  runFeatureTamper((rows) => { rows[0].image_key = 'mtl_archives_image_drift.jpg'; }, /pHash image key drift/);
  runFeatureTamper((rows) => { rows[0].derivative_contract_id = `derivative-contract:${'0'.repeat(64)}`; }, /pHash derivative contract drift/);
  runFeatureTamper((rows) => { rows.find((row) => row.status === 'success')!.derivative_width = 300; }, /pHash derivative dimensions exceed contract/);
  runFeatureTamper((rows) => { rows[0].corpus_input_sha256 = '0'.repeat(64); }, /pHash corpus input drift/);

  const resumeIdentity = { acquisitionSnapshotId: acquisitionId, corpusInputSha256, derivativeContractId: contractId };
  validateResumeRows(features, corpus, resumeIdentity);
  expectThrow(() => validateResumeRows([{ ...features[0], image_key: 'drift' }, ...features.slice(1)], corpus, resumeIdentity), /image_key mismatch/);
  expectThrow(() => validateResumeRows([{ ...features[0], corpus_snapshot_id: '0'.repeat(64) }, ...features.slice(1)], corpus, resumeIdentity), /corpus_snapshot_id mismatch/);
  expectThrow(() => validateResumeRows([{ ...features[0], corpus_input_sha256: '0'.repeat(64) }, ...features.slice(1)], corpus, resumeIdentity), /corpus_input_sha256 mismatch/);
  expectThrow(() => validateResumeRows([{ ...features[0], feature_version: 'stale' as PhashFeatureRow['feature_version'] }, ...features.slice(1)], corpus, resumeIdentity), /feature_version mismatch/);
  expectThrow(() => validateResumeRows([{ ...features[0], derivative_contract_id: `derivative-contract:${'0'.repeat(64)}` }, ...features.slice(1)], corpus, resumeIdentity), /derivative_contract_id mismatch/);

  const baseImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#111111' } })
    .composite([{ input: { create: { width: 24, height: 40, channels: 3, background: '#eeeeee' } }, left: 8, top: 12 }]).png().toBuffer();
  const shiftedImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#111111' } })
    .composite([{ input: { create: { width: 24, height: 40, channels: 3, background: '#eeeeee' } }, left: 32, top: 12 }]).png().toBuffer();
  const hashA = await computeVisualFeature(baseImage);
  const hashARepeat = await computeVisualFeature(baseImage);
  const hashB = await computeVisualFeature(shiftedImage);
  assert(hashA.phash64 === hashARepeat.phash64 && hashA.normalizedPixelSha256 === hashARepeat.normalizedPixelSha256, 'Visual feature extraction is not deterministic');
  assert(hashA.phash64 !== hashB.phash64, 'Adversarial shifted image did not change pHash');

  const streamedResponse = (chunks: number[], headers: Record<string, string>, onCancel: () => void): Response => {
    let cursor = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (cursor >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunks[cursor]));
        cursor += 1;
      },
      cancel() { onCancel(); },
    }), { headers });
  };
  let missingLengthCancelled = false;
  await expectReject(() => readBoundedResponse(streamedResponse([8, 8], {}, () => { missingLengthCancelled = true; }), 10), /response_too_large_actual_16/);
  assert(missingLengthCancelled, 'Missing Content-Length oversized stream was not cancelled');
  let falseLengthCancelled = false;
  await expectReject(() => readBoundedResponse(streamedResponse([6, 6], { 'content-length': '4' }, () => { falseLengthCancelled = true; }), 10), /response_too_large_actual_12/);
  assert(falseLengthCancelled, 'False Content-Length oversized stream was not cancelled');
  const bounded = await readBoundedResponse(streamedResponse([4, 5], {}, () => undefined), 10);
  assert(bounded.byteLength === 9, 'Bounded streamed derivative did not preserve bytes');

  const syntheticEdge = (edgeType: GraphEdge['edge_type'], source: string, target: string, currentMatch?: boolean): GraphEdge => ({
    schema_version: VFG_SCHEMA_VERSION,
    edge_id: stableId('edge', [edgeType, source, target, String(currentMatch)]),
    source_record_id: source,
    target_record_id: target,
    edge_type: edgeType,
    directed: edgeType === 'sequence_precedes',
    authority: 'grouping_authoritative',
    grouping_eligible: true,
    confidence: 1,
    threshold: null,
    evidence: edgeType === 'same_source_asset' ? { current_normalized_derivative_equal: currentMatch } : {},
  });
  const cited234Members = Array.from({ length: 234 }, (_, index) => `cited-234-${index}`);
  const cited234Edges = [
    ...cited234Members.slice(1).map((member) => syntheticEdge('same_aerial_run', cited234Members[0], member)),
    syntheticEdge('exact_payload', cited234Members[0], cited234Members[1]),
    syntheticEdge('exact_payload', cited234Members[0], cited234Members[2]),
    ...Array.from({ length: 117 }, (_, index) => syntheticEdge('same_source_asset', cited234Members[index * 2], cited234Members[index * 2 + 1], index >= 115)),
  ];
  const cited234 = recommendationAssessment(cited234Members, cited234Edges, { canonical_score: 128, runner_up_score: 128, score_margin: 0, top_score_tie_count: 200 });
  assert(cited234.confidence === 0.6 && cited234.support.exact_payload_edges === 2 && cited234.support.source_derivative_disagreement === 115, '234-member recommendation pattern escaped component-wide disagreement cap');
  const cited222Members = Array.from({ length: 222 }, (_, index) => `cited-222-${index}`);
  const cited222Edges = [
    ...cited222Members.slice(1).map((member) => syntheticEdge('same_aerial_run', cited222Members[0], member)),
    ...Array.from({ length: 8 }, (_, index) => syntheticEdge('exact_payload', cited222Members[0], cited222Members[index + 1])),
    ...Array.from({ length: 111 }, (_, index) => syntheticEdge('same_source_asset', cited222Members[index * 2], cited222Members[index * 2 + 1], false)),
  ];
  const cited222 = recommendationAssessment(cited222Members, cited222Edges, { canonical_score: 128, runner_up_score: 128, score_margin: 0, top_score_tie_count: 180 });
  assert(cited222.confidence === 0.6 && cited222.support.exact_payload_edges === 8 && cited222.support.source_derivative_disagreement === 111, '222-member recommendation pattern escaped component-wide disagreement cap');

  console.log(JSON.stringify({ status: 'ok', fixture_records: corpus.length, large_aerial_run_records: largeRunRecords.length, deterministic_hashes: Object.fromEntries(deterministicFiles.map((name, index) => [name, hashesA[index]])), adversarial_cases: 18, recommendation_patterns: { cited_234_confidence: cited234.confidence, cited_222_confidence: cited222.confidence } }));
  fs.rmSync(temp, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(`[vfg-v1:self-test] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
