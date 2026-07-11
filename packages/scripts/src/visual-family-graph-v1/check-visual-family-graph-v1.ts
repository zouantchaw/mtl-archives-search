import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import {
  CANONICAL_CORPUS_SNAPSHOT_ID,
  CANONICAL_COUNTS,
  EDGE_TYPES,
  PHASH_FEATURE_VERSION,
  VFG_SCHEMA_VERSION,
  UnionFind,
  clean,
  deterministicSplit,
  fileEvidence,
  hamming64,
  readJson,
  readJsonl,
  recommendationAssessment,
  sequenceEvidence,
  sha256,
  stableId,
  stableJson,
  unique,
  wilson95,
  type CorpusInputRow,
  type EdgeType,
  type GraphEdge,
  type LeakageMapRow,
  type PhashFeatureRow,
  type RecommendationSupport,
  type ReviewDecision,
} from './model.js';
import { BASELINE_DERIVATIVE_CONTRACT_ID, RECOVERY_CONTRACT_ID, validateTrustedMixedContracts, type RecoveryRow } from '../canonical-image-recovery-v1/model.js';
import { verifyDerivativeManifest } from '../canonical-image-recovery-v1/run-canonical-image-recovery-v1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_ROOT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1');
const DEFAULT_REVIEW = path.join(ROOT, 'docs/dataset-factory/fixtures/visual-family-graph-v1/review-adjudications.jsonl');
const DEFAULT_CLIP = path.join(ROOT, 'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl');

type ComponentRow = { schema_version: string; component_id: string; member_count: number; members: string[]; grouping_edge_types: EdgeType[] };
type Recommendation = {
  component_id: string;
  canonical_record_id: string;
  alternate_record_ids: string[];
  confidence: number;
  reasons: string[];
  deletion_instruction: boolean;
  preserved_provenance: boolean;
  support: RecommendationSupport;
  canonical_selection: {
    canonical_score: number;
    runner_up_score: number;
    score_margin: number;
    top_score_tie_count: number;
    ranking_factors: Record<string, number>;
    deterministic_tie_breaker: string;
  };
};
type SearchCandidate = { task_id: string; query?: string; slice?: string; candidate_record_id: string; duplicate_key?: string; ranks?: Partial<Record<'semantic' | 'smart' | 'visual', number>> };
type AjvLike = { addSchema(schema: Record<string, unknown>): void; compile(schema: Record<string, unknown>): ValidateFunction; errorsText(errors?: ValidateFunction['errors']): string };
const Ajv2020 = Ajv2020Import as unknown as new (options: Record<string, unknown>) => AjvLike;
const addFormats = addFormatsImport as unknown as (instance: AjvLike) => void;

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function titleGeneric(value: string): boolean {
  const normalized = clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !normalized || /^mtl archives metadata/.test(normalized) || /^vm\d/.test(normalized) || normalized.length < 8;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      root: { type: 'string', default: DEFAULT_ROOT },
      mode: { type: 'string', default: 'live' },
      schema: { type: 'string', default: path.join(ROOT, 'docs/dataset-factory/visual-family-graph.schema.v1.json') },
      review: { type: 'string', default: DEFAULT_REVIEW },
      'recovery-root': { type: 'string' },
    },
  });
  const base = resolvePath(values.root!);
  const recoveryRoot = values['recovery-root'] ? resolvePath(values['recovery-root']) : null;
  const inputDir = path.join(base, 'input');
  const phashDir = recoveryRoot ?? path.join(base, 'phash');
  const graphDir = recoveryRoot ? path.join(recoveryRoot, 'graph-after') : path.join(base, 'graph');
  const corpusPath = path.join(inputDir, 'corpus-input-v1.jsonl');
  const summaryPath = path.join(inputDir, 'corpus-input-summary-v1.json');
  const sitemapPath = path.join(inputDir, 'd1-sitemap.json');
  const detailPath = path.join(inputDir, 'd1-production-only-details.jsonl');
  const localPath = path.join(base, 'canonical_local/local-manifest.jsonl');
  const featurePath = path.join(phashDir, recoveryRoot ? 'successor-phash-features-v1.jsonl' : 'phash-features-v1.jsonl');
  const failuresPath = path.join(phashDir, recoveryRoot ? 'successor-phash-failures-v1.jsonl' : 'phash-failures-v1.jsonl');
  const featureReportPath = path.join(phashDir, recoveryRoot ? 'successor-phash-report-v1.json' : 'phash-report-v1.json');
  const nodesPath = path.join(graphDir, 'nodes-v1.jsonl');
  const edgesPath = path.join(graphDir, 'typed-edges-v1.jsonl');
  const componentsPath = path.join(graphDir, 'leakage-components-v1.jsonl');
  const mapPath = path.join(graphDir, 'record-leakage-map-v1.jsonl');
  const splitPath = path.join(graphDir, 'benchmark-splits-v1.jsonl');
  const recommendationPath = path.join(graphDir, 'canonical-recommendations-v1.jsonl');
  const packetPath = path.join(graphDir, 'review-packet-v1.jsonl');
  const precisionPath = path.join(graphDir, 'review-precision-v1.jsonl');
  const searchDir = recoveryRoot ? path.join(recoveryRoot, 'search-evaluation') : path.join(base, 'search-evaluation');
  const searchMetricsPath = path.join(searchDir, 'search-duplicate-task-metrics-v1.jsonl');
  const searchReportPath = path.join(searchDir, 'search-duplicate-report-v1.json');
  const searchCandidatesPath = path.join(ROOT, 'data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl');
  const reportPath = path.join(graphDir, 'graph-report-v1.json');
  const manifestPath = path.join(graphDir, 'artifact-manifest-v1.json');
  const reviewPath = resolvePath(values.review!);
  for (const required of [corpusPath, summaryPath, sitemapPath, detailPath, localPath, featurePath, failuresPath, featureReportPath, nodesPath, edgesPath, componentsPath, mapPath, splitPath, recommendationPath, packetPath, precisionPath, reportPath, manifestPath]) {
    assert(fs.existsSync(required), `Missing required artifact: ${required}`);
  }
  if (values.mode === 'live') assert(fs.existsSync(reviewPath), `Missing required reviewed adjudications: ${reviewPath}`);
  if (values.mode === 'live') assert(fs.existsSync(DEFAULT_CLIP), `Missing required frozen CLIP evidence: ${DEFAULT_CLIP}`);
  if (values.mode === 'live') for (const required of [searchMetricsPath, searchReportPath, searchCandidatesPath]) assert(fs.existsSync(required), `Missing required search-evaluation artifact: ${required}`);

  const corpus = readJsonl<CorpusInputRow>(corpusPath);
  const summary = readJson<Record<string, any>>(summaryPath);
  const features = readJsonl<PhashFeatureRow>(featurePath);
  const failures = readJsonl<PhashFeatureRow>(failuresPath);
  const featureReport = readJson<Record<string, any>>(featureReportPath);
  const nodes = readJsonl<Record<string, any>>(nodesPath);
  const edges = readJsonl<GraphEdge>(edgesPath);
  const components = readJsonl<ComponentRow>(componentsPath);
  const leakageMap = readJsonl<LeakageMapRow>(mapPath);
  const splits = readJsonl<Record<string, any>>(splitPath);
  const recommendations = readJsonl<Recommendation>(recommendationPath);
  const packet = readJsonl<Record<string, any>>(packetPath);
  const precision = readJsonl<Record<string, any>>(precisionPath);
  const decisions = fs.existsSync(reviewPath) ? readJsonl<ReviewDecision>(reviewPath) : [];
  const report = readJson<Record<string, any>>(reportPath);
  const manifest = readJson<Record<string, any>>(manifestPath);
  const schema = readJson<Record<string, unknown>>(resolvePath(values.schema!));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validateRows = (definition: string, rows: unknown[]): void => {
    const validate = ajv.compile({ $ref: `${String(schema.$id)}#/$defs/${definition}` });
    for (const [index, row] of rows.entries()) {
      if (!validate(row)) throw new Error(`${definition} schema failure at row ${index + 1}: ${ajv.errorsText(validate.errors)}`);
    }
  };
  validateRows('corpus_input', corpus);
  validateRows('phash_feature', features);
  validateRows('edge', edges);
  validateRows('leakage_map', leakageMap);
  validateRows('node', nodes);
  validateRows('component', components);
  validateRows('benchmark_split', splits);
  validateRows('recommendation', recommendations);
  validateRows('review_packet', packet);
  validateRows('review_precision', precision);
  validateRows('review_decision', decisions);
  const corpusIds = corpus.map((row) => row.record_id);
  const corpusSet = new Set(corpusIds);
  const corpusById = new Map(corpus.map((row) => [row.record_id, row]));
  assert(corpusSet.size === corpus.length, 'Corpus record IDs are not unique');
  assert(corpus.every((row) => row.schema_version === VFG_SCHEMA_VERSION), 'Corpus schema version mismatch');
  assert(corpus.every((row) => row.canonical_corpus_reference_snapshot_id === CANONICAL_CORPUS_SNAPSHOT_ID), 'Corpus rows impersonate or drift from the named Canonical Corpus reference');
  if (values.mode === 'live') {
    assert(corpus.length === CANONICAL_COUNTS.corpus, `Live corpus count ${corpus.length} != ${CANONICAL_COUNTS.corpus}`);
    assert(corpus.filter((row) => row.corpus_state === 'alias').length === CANONICAL_COUNTS.aliases, 'Live alias count mismatch');
  }

  const acquisitionIds = unique(corpus.map((row) => row.corpus_snapshot_id));
  assert(acquisitionIds.length === 1, 'Corpus has multiple acquisition snapshot IDs');
  const localEvidence = fileEvidence(localPath, readJsonl(localPath).length);
  const sitemapEvidence = fileEvidence(sitemapPath);
  const detailsEvidence = fileEvidence(detailPath, readJsonl(detailPath).length);
  const independentlyDerivedAcquisitionId = sha256(stableJson({
    schema_version: VFG_SCHEMA_VERSION,
    acquisition_kind: 'public_api_read_only_snapshot',
    canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
    api_origin: summary.acquisition.api_origin,
    local_sha256: localEvidence.sha256,
    sitemap_sha256: sitemapEvidence.sha256,
    production_details_sha256: detailsEvidence.sha256,
    methods: ['GET /api/sitemap', 'GET /api/photos?id=<production-only-id>'],
  }));
  assert(summary.byte_equivalent_to_canonical_reference === false, 'Mutable API acquisition claimed byte equivalence to #66');
  assert(summary.acquisition_snapshot_id === independentlyDerivedAcquisitionId, 'Input summary acquisition snapshot ID/content mismatch');
  assert(acquisitionIds[0] === independentlyDerivedAcquisitionId, 'Corpus row acquisition snapshot ID/content mismatch');

  assert(features.length === corpus.length, 'Feature row count does not cover corpus');
  assert(features.every((row, index) => row.record_id === corpus[index].record_id), 'Feature rows are not one-to-one and sorted with corpus');
  const corpusInputSha256 = fileEvidence(corpusPath, corpus.length).sha256;
  const { derivative_contract_id: derivativeContractId, ...transformContract } = featureReport.transform_contract ?? {};
  assert(typeof derivativeContractId === 'string' && derivativeContractId === stableId('derivative-contract', [stableJson(transformContract)]), 'pHash derivative contract ID/content mismatch');
  assert(featureReport.feature_version === PHASH_FEATURE_VERSION || recoveryRoot !== null, 'pHash feature report version mismatch');
  assert(featureReport.source_snapshot?.acquisition_snapshot_id === independentlyDerivedAcquisitionId, 'pHash report acquisition snapshot mismatch');
  assert(featureReport.source_snapshot?.corpus_input_sha256 === corpusInputSha256, 'pHash report corpus input identity mismatch');
  assert(featureReport.lineage?.corpus?.sha256 === corpusInputSha256, 'pHash report corpus lineage mismatch');
  assert(featureReport.lineage?.features?.sha256 === fileEvidence(featurePath, features.length).sha256, 'pHash report feature lineage mismatch');
  const recoveryLedger = recoveryRoot ? readJsonl<RecoveryRow>(path.join(recoveryRoot, 'recovery-ledger-v1.jsonl')) : [];
  const recoveryById = new Map(recoveryLedger.map((row) => [row.record_id, row]));
  if (recoveryRoot) {
    validateTrustedMixedContracts(features, featureReport, String(fileEvidence(featurePath, features.length).sha256));
    assert(recoveryLedger.length === 209 && recoveryById.size === 209 && recoveryLedger.every((row) => row.recovered), 'Recovery ledger coverage mismatch');
    const inspection = await verifyDerivativeManifest(path.join(ROOT, 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/inspection-derivatives'));
    assert(inspection.size === 209, 'Tracked inspection derivative manifest coverage mismatch');
    for (const row of recoveryLedger) {
      const manifestRow = inspection.get(row.record_id);
      assert(manifestRow?.sha256 === row.derivative_sha256, `${row.record_id}: tracked inspection derivative hash mismatch`);
    }
  }
  for (const [index, feature] of features.entries()) {
    const record = corpus[index];
    assert(feature.image_key === record.image_key, `${feature.record_id}: pHash image key drift`);
    assert(feature.feature_version === PHASH_FEATURE_VERSION, `${feature.record_id}: pHash feature version drift`);
    assert(feature.corpus_snapshot_id === independentlyDerivedAcquisitionId, `${feature.record_id}: pHash acquisition snapshot drift`);
    assert(feature.corpus_input_sha256 === corpusInputSha256, `${feature.record_id}: pHash corpus input drift`);
    const recovery = recoveryById.get(feature.record_id);
    assert(feature.derivative_contract_id === (recovery ? RECOVERY_CONTRACT_ID : derivativeContractId), `${feature.record_id}: pHash derivative contract drift`);
    if (recovery) assert(feature.status === 'success' && feature.derivative_sha256 === recovery.derivative_sha256
      && feature.normalized_pixel_sha256 === recovery.normalized_pixel_sha256 && feature.phash64 === recovery.phash64, `${feature.record_id}: recovery ledger/feature mismatch`);
    if (feature.status === 'success') {
      assert((feature.derivative_width ?? Number.POSITIVE_INFINITY) <= Number(transformContract.width) * 1.05
        && (feature.derivative_height ?? Number.POSITIVE_INFINITY) <= Number(transformContract.height) * 1.05, `${feature.record_id}: pHash derivative dimensions exceed contract`);
    }
  }
  const expectedFailures = features.filter((row) => row.status === 'failure');
  assert(sameJson(failures, expectedFailures), 'pHash failure file is not the exact individually enumerated feature-failure subset');
  assert(features.filter((row) => row.status === 'success').every((row) => /^[a-f0-9]{16}$/.test(row.phash64 ?? '') && /^[a-f0-9]{64}$/.test(row.normalized_pixel_sha256 ?? '')), 'Successful pHash rows have malformed features');
  if (recoveryRoot) {
    assert(features.filter((row) => row.derivative_contract_id === BASELINE_DERIVATIVE_CONTRACT_ID).length === 18_253, 'Baseline contract row count mismatch');
    assert(features.filter((row) => row.derivative_contract_id === RECOVERY_CONTRACT_ID).length === 209, 'Recovery contract row count mismatch');
  }

  assert(nodes.length === corpus.length && nodes.every((row, index) => row.record_id === corpus[index].record_id), 'Node coverage/order mismatch');
  assert(new Set(edges.map((edge) => edge.edge_id)).size === edges.length, 'Duplicate edge IDs');
  const featureById = new Map(features.map((row) => [row.record_id, row]));
  for (const edge of edges) {
    assert(EDGE_TYPES.includes(edge.edge_type), `${edge.edge_id}: invalid edge type`);
    assert(corpusSet.has(edge.source_record_id) && corpusSet.has(edge.target_record_id), `${edge.edge_id}: endpoint outside corpus`);
    assert(edge.source_record_id !== edge.target_record_id, `${edge.edge_id}: self edge`);
    if (!edge.directed) assert(edge.source_record_id.localeCompare(edge.target_record_id) < 0, `${edge.edge_id}: undirected edge endpoints are not canonicalized`);
    assert(edge.grouping_eligible === (edge.authority === 'grouping_authoritative'), `${edge.edge_id}: grouping eligibility/authority contract mismatch`);
    if (['visual_neighbor_clip', 'visual_neighbor_dino', 'alternate_crop', 'same_reportage', 'same_subject_unverified'].includes(edge.edge_type)) {
      assert(!edge.grouping_eligible, `${edge.edge_id}: review/uncertain evidence forced grouping`);
    }
    if (edge.edge_type === 'near_duplicate_phash') {
      const left = featureById.get(edge.source_record_id)!;
      const right = featureById.get(edge.target_record_id)!;
      const actual = hamming64(left.phash64!, right.phash64!);
      assert(actual === edge.evidence.hamming_distance, `${edge.edge_id}: pHash distance mismatch`);
      assert(edge.grouping_eligible === (actual <= report.params.phash_group_threshold), `${edge.edge_id}: pHash grouping threshold mismatch`);
    }
    if (edge.edge_type === 'visual_neighbor_clip') {
      assert(edge.evidence.model_id === 'Xenova/clip-vit-base-patch32', `${edge.edge_id}: CLIP model contract mismatch`);
      assert(edge.evidence.evidence_run === 'autoresearch_embedding_eval_gpu_500', `${edge.edge_id}: CLIP evidence version mismatch`);
      assert(edge.evidence.similarity_is_not_historical_identity === true, `${edge.edge_id}: CLIP similarity overstates identity`);
      assert(Number.isFinite(Number(edge.evidence.cosine_score)) && Number(edge.evidence.cosine_score) >= report.params.clip_threshold, `${edge.edge_id}: CLIP score/threshold mismatch`);
    }
    if (edge.edge_type === 'same_source_asset') {
      const left = corpusById.get(edge.source_record_id)!;
      const right = corpusById.get(edge.target_record_id)!;
      assert(left.source_identity === right.source_identity, `${edge.edge_id}: source asset identity mismatch`);
      assert(edge.evidence.source_identity_exact_match === true, `${edge.edge_id}: source exact-match contract missing`);
      assert(edge.evidence.source_identity_sha256 === sha256(left.source_identity), `${edge.edge_id}: source identity hash mismatch`);
      assert(edge.evidence.current_derivative_identity_claimed === false, `${edge.edge_id}: source edge overstates current derivative identity`);
      const leftFeature = featureById.get(edge.source_record_id)!;
      const rightFeature = featureById.get(edge.target_record_id)!;
      const expectedDerivativeMatch = leftFeature.status === 'success' && rightFeature.status === 'success'
        ? leftFeature.normalized_pixel_sha256 === rightFeature.normalized_pixel_sha256
        : null;
      assert(edge.evidence.current_normalized_derivative_equal === expectedDerivativeMatch, `${edge.edge_id}: current derivative agreement evidence mismatch`);
    }
    if (edge.edge_type === 'exact_payload') {
      const left = featureById.get(edge.source_record_id)!;
      const right = featureById.get(edge.target_record_id)!;
      assert(edge.evidence.payload_scope === 'normalized_derivative_rgb_256x256_v1', `${edge.edge_id}: exact_payload scope/name mismatch`);
      assert(edge.evidence.payload_definition === 'auto-oriented, white-flattened, contain-fit RGB 256x256 pixel bytes under the recorded derivative contract', `${edge.edge_id}: exact_payload definition mismatch`);
      assert(edge.evidence.source_payload_equality_claimed === false, `${edge.edge_id}: unsupported source-payload equality claim`);
      assert(edge.evidence.r2_etag_size_used_as_byte_proof === false, `${edge.edge_id}: R2 ETag+size used as byte proof`);
      assert(left.normalized_pixel_sha256 === right.normalized_pixel_sha256 && left.normalized_pixel_sha256 === edge.evidence.normalized_pixel_sha256, `${edge.edge_id}: normalized derivative payload mismatch`);
    }
  }

  const uf = new UnionFind();
  for (const id of corpusIds) uf.add(id);
  for (const edge of edges.filter((row) => row.grouping_eligible)) uf.union(edge.source_record_id, edge.target_record_id);
  const expectedComponents = uf.groups().map((members) => ({ id: stableId('leakage-component', members), members })).sort((a, b) => a.id.localeCompare(b.id));
  const actualComponents = components.map((row) => ({ id: row.component_id, members: row.members })).sort((a, b) => a.id.localeCompare(b.id));
  assert(sameJson(actualComponents, expectedComponents), 'Leakage components do not match grouping-authoritative connected components');
  assert(components.every((row) => row.member_count === row.members.length), 'Component member_count mismatch');
  const componentByRecord = new Map<string, ComponentRow>();
  for (const component of components) for (const id of component.members) {
    assert(!componentByRecord.has(id), `${id}: appears in multiple components`);
    componentByRecord.set(id, component);
  }
  assert(componentByRecord.size === corpus.length, 'Components do not cover corpus exactly once');

  assert(leakageMap.length === corpus.length, 'Leakage map row count mismatch');
  assert(new Set(leakageMap.map((row) => row.record_id)).size === corpus.length, 'Leakage map record IDs are not unique');
  for (const row of leakageMap) {
    const component = componentByRecord.get(row.record_id)!;
    assert(row.component_id === component.component_id && row.component_size === component.member_count, `${row.record_id}: component mapping mismatch`);
    assert(row.benchmark_split === deterministicSplit(component.component_id), `${row.record_id}: nondeterministic split`);
    if (component.member_count === 1) assert(row.leakage_status === 'singleton' && row.leakage_group_id === null, `${row.record_id}: singleton status mismatch`);
    else assert(row.leakage_status === 'grouped' && row.leakage_group_id === component.component_id, `${row.record_id}: leakage group mismatch`);
  }
  const splitByRecord = new Map(splits.map((row) => [row.record_id, row]));
  assert(splitByRecord.size === corpus.length, 'Benchmark split rows do not cover corpus');
  for (const row of leakageMap) {
    const split = splitByRecord.get(row.record_id)!;
    assert(split.component_id === row.component_id && split.split === row.benchmark_split, `${row.record_id}: split artifact mismatch`);
  }
  const splitCrossings = components.filter((component) => new Set(component.members.map((id) => leakageMap.find((row) => row.record_id === id)!.benchmark_split)).size > 1);
  assert(splitCrossings.length === 0, `${splitCrossings.length} connected components cross splits`);
  const parsedAerialRuns = new Map<string, string[]>();
  for (const record of corpus) {
    const parsed = sequenceEvidence(record);
    if (!parsed || parsed.kind !== 'aerial') continue;
    parsedAerialRuns.set(parsed.runKey, [...(parsedAerialRuns.get(parsed.runKey) ?? []), record.record_id]);
  }
  const expectedAerialRuns = [...parsedAerialRuns.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([runKey, members]) => {
      const componentIds = unique(members.map((member) => componentByRecord.get(member)!.component_id));
      const runSplits = unique(members.map((member) => leakageMap.find((row) => row.record_id === member)!.benchmark_split));
      assert(componentIds.length === 1, `${runKey}: parsed authoritative aerial run spans ${componentIds.length} components`);
      assert(runSplits.length === 1, `${runKey}: parsed authoritative aerial run spans ${runSplits.length} splits`);
      const runEdges = edges.filter((edge) => edge.edge_type === 'same_aerial_run' && edge.evidence.run_key === runKey);
      const sequenceEdges = edges.filter((edge) => edge.edge_type === 'sequence_precedes' && edge.evidence.run_key === runKey);
      assert(runEdges.length === members.length - 1, `${runKey}: expected ${members.length - 1} linear same_aerial_run edges, found ${runEdges.length}`);
      assert(sequenceEdges.length <= members.length - 1, `${runKey}: sequence edge count is not linear`);
      assert(runEdges.every((edge) => edge.grouping_eligible && edge.authority === 'grouping_authoritative'), `${runKey}: aerial run edge is not grouping-authoritative`);
      return { run_key: runKey, member_count: members.length, component_id: componentIds[0], split: runSplits[0] };
    })
    .sort((a, b) => a.run_key.localeCompare(b.run_key));
  assert(report.authoritative_aerial_runs?.runs === expectedAerialRuns.length, 'Report authoritative aerial run count mismatch');
  assert(report.authoritative_aerial_runs?.records === expectedAerialRuns.reduce((sum, run) => sum + run.member_count, 0), 'Report authoritative aerial record count mismatch');
  assert(sameJson(report.authoritative_aerial_runs?.above_250, expectedAerialRuns.filter((run) => run.member_count > 250)), 'Report >250 aerial run census mismatch');

  const groupedComponents = components.filter((row) => row.member_count > 1);
  const componentByRecordId = new Map<string, string>();
  for (const component of components) for (const recordId of component.members) componentByRecordId.set(recordId, component.component_id);
  const groupingEdgesByComponent = new Map<string, GraphEdge[]>();
  for (const edge of edges.filter((row) => row.grouping_eligible)) {
    const componentId = componentByRecordId.get(edge.source_record_id)!;
    groupingEdgesByComponent.set(componentId, [...(groupingEdgesByComponent.get(componentId) ?? []), edge]);
  }
  assert(recommendations.length === groupedComponents.length, 'Canonical recommendations do not cover every grouped component');
  for (const recommendation of recommendations) {
    const component = components.find((row) => row.component_id === recommendation.component_id)!;
    assert(component, `${recommendation.component_id}: recommendation component missing`);
    assert(component.members.includes(recommendation.canonical_record_id), `${recommendation.component_id}: canonical is not a member`);
    assert(sameJson(unique([recommendation.canonical_record_id, ...recommendation.alternate_record_ids]), component.members), `${recommendation.component_id}: alternates are not exactly preserved`);
    assert(recommendation.deletion_instruction === false && recommendation.preserved_provenance === true, `${recommendation.component_id}: unsafe recommendation contract`);
    const authority = groupingEdgesByComponent.get(recommendation.component_id) ?? [];
    const ranked = component.members.map((recordId) => {
      const record = corpusById.get(recordId)!;
      const feature = featureById.get(recordId)!;
      const factors = {
        production_d1: record.systems.d1 ? 100 : 0,
        not_source_alias: record.corpus_state !== 'alias' ? 20 : 0,
        visual_feature_available: feature.status === 'success' ? 5 : 0,
        descriptive_title: titleGeneric(record.name) ? 0 : 3,
        rights_complete: record.rights.complete ? 2 : 0,
      };
      return { recordId, factors, score: Object.values(factors).reduce((sum, value) => sum + value, 0) };
    }).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId));
    const expectedSelection = {
      canonical_score: ranked[0].score,
      runner_up_score: ranked[1]?.score ?? ranked[0].score,
      score_margin: ranked[0].score - (ranked[1]?.score ?? ranked[0].score),
      top_score_tie_count: ranked.filter((candidate) => candidate.score === ranked[0].score).length,
    };
    assert(recommendation.canonical_record_id === ranked[0].recordId, `${recommendation.component_id}: canonical ranking mismatch`);
    assert(sameJson(recommendation.canonical_selection, { ...expectedSelection, ranking_factors: ranked[0].factors, deterministic_tie_breaker: 'record_id_ascending' }), `${recommendation.component_id}: canonical selection evidence mismatch`);
    const assessment = recommendationAssessment(component.members, authority, expectedSelection);
    const sourceEdges = authority.filter((edge) => edge.edge_type === 'same_source_asset');
    const sourceDerivativeDisagreement = sourceEdges.some((edge) => edge.evidence.current_normalized_derivative_equal === false);
    assert(recommendation.confidence === assessment.confidence, `${recommendation.component_id}: recommendation confidence mismatch`);
    assert(sameJson(recommendation.support, assessment.support), `${recommendation.component_id}: recommendation component support mismatch`);
    for (const reason of assessment.reasons) assert(recommendation.reasons.includes(reason), `${recommendation.component_id}: recommendation confidence reason missing: ${reason}`);
    assert(recommendation.reasons.includes('alternates_remain_addressable') && recommendation.reasons.includes('recommendation_only_no_deletion_instruction'), `${recommendation.component_id}: recommendation reasons omit preservation boundary`);
    assert(recommendation.reasons.includes('source_reference_current_derivative_disagreement') === sourceDerivativeDisagreement, `${recommendation.component_id}: source derivative disagreement reason mismatch`);
  }

  const packetById = new Map(packet.map((row) => [String(row.review_id), row]));
  assert(packetById.size === packet.length, 'Review packet IDs are not unique');
  const decisionById = new Map<string, ReviewDecision>();
  for (const decision of decisions) {
    assert(packetById.has(decision.review_id), `${decision.review_id}: adjudication is outside the current packet`);
    assert(!decisionById.has(decision.review_id), `${decision.review_id}: duplicate adjudication`);
    assert(decision.decision === 'abstain' || decision.image_inspected === true, `${decision.review_id}: decided pair recorded without direct image inspection`);
    assert(decision.image_inspected || decision.decision === 'abstain', `${decision.review_id}: uninspected pair must abstain`);
    decisionById.set(decision.review_id, decision);
  }
  if (values.mode === 'live') assert(decisionById.size === packet.length, `Review adjudications ${decisionById.size} do not cover all ${packet.length} packet pairs`);
  if (values.mode === 'live') {
    for (const [stratum, minimum] of Object.entries({ exact_payload: 12, same_source_asset: 12, phash_0: 20, same_aerial_run: 20, sequence_precedes: 12 })) {
      assert(packet.filter((row) => row.stratum === stratum).length >= minimum, `${stratum}: authoritative review stratum is below minimum ${minimum}`);
    }
  }
  for (const row of packet) {
    const decision = decisionById.get(String(row.review_id));
    assert(row.adjudication === (decision?.decision ?? 'pending'), `${row.review_id}: packet adjudication mismatch`);
    assert(row.image_inspected === (decision?.image_inspected ?? false), `${row.review_id}: packet inspection flag mismatch`);
  }
  const expectedPrecisionGroups: Array<{ edge_type: EdgeType; threshold: string | null }> = [];
  for (const edgeType of EDGE_TYPES) {
    if (edgeType === 'near_duplicate_phash') for (const threshold of ['0', '1-2', '3-4', '5-8', '9-12', '13-16']) expectedPrecisionGroups.push({ edge_type: edgeType, threshold });
    else expectedPrecisionGroups.push({ edge_type: edgeType, threshold: null });
  }
  assert(precision.length === expectedPrecisionGroups.length, 'Review precision row count mismatch');
  for (const group of expectedPrecisionGroups) {
    const row = precision.find((candidate) => candidate.edge_type === group.edge_type && candidate.threshold === group.threshold);
    assert(row, `Missing precision row for ${group.edge_type}/${group.threshold ?? 'n/a'}`);
    const matchingPacket = packet.filter((candidate) => candidate.edge_type === group.edge_type && (group.threshold === null || candidate.threshold === group.threshold));
    const reviewed = matchingPacket.map((candidate) => decisionById.get(String(candidate.review_id))).filter((candidate): candidate is ReviewDecision => Boolean(candidate));
    const inspected = reviewed.filter((candidate) => candidate.image_inspected);
    const decided = reviewed.filter((candidate) => candidate.decision !== 'abstain');
    const positives = decided.filter((candidate) => candidate.decision === 'positive').length;
    assert(row.graph_edges === edges.filter((edge) => edge.edge_type === group.edge_type && (group.threshold === null || edge.threshold === group.threshold)).length, `Precision graph edge count mismatch: ${group.edge_type}/${group.threshold ?? 'n/a'}`);
    assert(row.packet_pairs === matchingPacket.length && row.adjudication_rows === reviewed.length && row.reviewed_pairs === inspected.length, `Precision reviewed pair count mismatch: ${group.edge_type}/${group.threshold ?? 'n/a'}`);
    assert(row.decided_denominator === decided.length && row.positive_numerator === positives, `Precision numerator/denominator mismatch: ${group.edge_type}/${group.threshold ?? 'n/a'}`);
    assert(row.abstentions === reviewed.length - decided.length, `Precision abstention mismatch: ${group.edge_type}/${group.threshold ?? 'n/a'}`);
    assert(row.pairwise_precision === (decided.length ? Number((positives / decided.length).toFixed(6)) : null), `Precision value mismatch: ${group.edge_type}/${group.threshold ?? 'n/a'}`);
    assert(sameJson(row.wilson_95, wilson95(positives, decided.length)), `Precision interval mismatch: ${group.edge_type}/${group.threshold ?? 'n/a'}`);
  }

  assert(report.coverage.corpus_records === corpus.length && report.coverage.nodes === nodes.length, 'Report coverage arithmetic mismatch');
  assert(report.coverage.phash_failures === failures.length, 'Report pHash failure arithmetic mismatch');
  assert(report.edges.total === edges.length, 'Report edge total mismatch');
  if (values.mode === 'live') assert(report.params.phash_group_threshold === -1 && edges.every((edge) => edge.edge_type !== 'near_duplicate_phash' || !edge.grouping_eligible), 'Reviewed v1 policy requires every pHash edge to remain non-grouping');
  assert(sameJson(report.edges.by_authority, Object.fromEntries(['grouping_authoritative', 'review_required', 'uncertain'].map((authority) => [authority, edges.filter((edge) => edge.authority === authority).length]))), 'Report edge authority arithmetic mismatch');
  assert(report.edges.grouping_eligible === edges.filter((edge) => edge.grouping_eligible).length, 'Report grouping edge arithmetic mismatch');
  assert(report.edges.review_or_uncertain === edges.filter((edge) => !edge.grouping_eligible).length, 'Report non-grouping edge arithmetic mismatch');
  assert(report.edges.exact_payload_contract?.scope === 'normalized_derivative_rgb_256x256_v1', 'Report exact_payload scope mismatch');
  assert(report.edges.exact_payload_contract?.source_object_bytes_claimed_equal === false, 'Report overstates source object equality');
  assert(report.edges.exact_payload_contract?.r2_etag_size_used_as_byte_proof === false, 'Report treats R2 ETag+size as byte proof');
  for (const edgeType of EDGE_TYPES) assert(report.edges.by_type[edgeType] === edges.filter((edge) => edge.edge_type === edgeType).length, `Report edge count mismatch: ${edgeType}`);
  assert(report.components.total === components.length, 'Report component total mismatch');
  assert(report.components.grouped === groupedComponents.length, 'Report grouped component mismatch');
  assert(report.components.grouped_records === components.filter((row) => row.member_count > 1).reduce((sum, row) => sum + row.member_count, 0), 'Report grouped record mismatch');
  assert(report.components.singletons === components.filter((row) => row.member_count === 1).length, 'Report singleton mismatch');
  assert(report.components.largest === Math.max(...components.map((row) => row.member_count)), 'Report largest component mismatch');
  assert(sameJson(report.recommendation_support?.confidence_counts, Object.fromEntries(unique(recommendations.map((row) => row.confidence.toFixed(2))).map((confidence) => [confidence, recommendations.filter((row) => row.confidence.toFixed(2) === confidence).length]))), 'Report recommendation confidence distribution mismatch');
  assert(report.recommendation_support?.source_disagreement_capped === recommendations.filter((row) => row.support.applied_confidence_caps.some((cap) => cap.startsWith('source_derivative_disagreement_confidence_cap'))).length, 'Report source-disagreement cap count mismatch');
  assert(report.recommendation_support?.sequence_only_capped === recommendations.filter((row) => row.support.applied_confidence_caps.some((cap) => cap.includes('sequence_only_membership_confidence_cap'))).length, 'Report sequence-only cap count mismatch');
  assert(report.recommendation_support?.canonical_tie_capped === recommendations.filter((row) => row.support.applied_confidence_caps.some((cap) => cap.startsWith('canonical_selection_tie_confidence_cap'))).length, 'Report canonical tie cap count mismatch');
  assert(report.recommendation_support?.exact_payload_full_member_coverage === recommendations.filter((row) => row.support.exact_payload_member_rate === 1).length, 'Report exact-payload full-coverage count mismatch');
  assert(report.splits.component_crossings === 0, 'Report split crossing mismatch');
  assert(report.review.packet_pairs === packet.length && report.review.decisions === decisions.length, 'Report review arithmetic mismatch');
  assert(report.review.abstentions_preserved === decisions.filter((row) => row.decision === 'abstain').length, 'Report review abstention mismatch');
  assert(report.review.inspected_pairs === decisions.filter((row) => row.image_inspected).length, 'Report inspected review arithmetic mismatch');
  assert(report.review.unreviewed_abstentions === decisions.filter((row) => row.decision === 'abstain' && !row.image_inspected).length, 'Report unreviewed abstention arithmetic mismatch');
  const observedRecordSplits = unique(leakageMap.map((row) => row.benchmark_split));
  const observedComponentSplits = unique(components.map((row) => deterministicSplit(row.component_id)));
  assert(sameJson(report.splits.records, Object.fromEntries(observedRecordSplits.map((split) => [split, leakageMap.filter((row) => row.benchmark_split === split).length]))), 'Report split record arithmetic mismatch');
  assert(sameJson(report.splits.components, Object.fromEntries(observedComponentSplits.map((split) => [split, components.filter((row) => deterministicSplit(row.component_id) === split).length]))), 'Report split component arithmetic mismatch');
  assert(report.safety.production_writes === 0 && report.safety.paid_compute_launched === false && report.safety.image_deletion_instructions === 0, 'Report safety boundary mismatch');
  if (values.mode === 'live') {
    assert(report.models.clip.model_id === 'Xenova/clip-vit-base-patch32', 'Report CLIP model mismatch');
    assert(report.models.clip.run_id === 'autoresearch_embedding_eval_gpu_500' && report.models.clip.query_records === 500, 'Report CLIP run/coverage mismatch');
    assert(report.models.clip.corpus_records_with_production_index_membership === CANONICAL_COUNTS.clipIndex, 'Report production CLIP membership mismatch');
    assert(report.models.clip.source_sha256 === fileEvidence(DEFAULT_CLIP, readJsonl(DEFAULT_CLIP).length).sha256, 'Report frozen CLIP hash mismatch');
    assert(report.models.clip.similarity_is_historical_identity === false, 'Report calls CLIP similarity historical identity');
    assert(report.models.dino.status === 'not_run_no_approved_paid_compute_gate' && report.models.dino.edges === 0 && report.models.dino.cost_usd === 0, 'Report DINO gate mismatch');
  }
  assert(report.source_snapshot.acquisition_snapshot_id === independentlyDerivedAcquisitionId, 'Graph report acquisition snapshot mismatch');
  assert(report.source_snapshot.corpus_input_sha256 === fileEvidence(corpusPath, corpus.length).sha256, 'Graph report corpus input hash mismatch');
  assert(report.source_snapshot.phash_features_sha256 === fileEvidence(featurePath, features.length).sha256, 'Graph report feature hash mismatch');
  assert(report.source_snapshot.byte_equivalent_to_canonical_reference === false, 'Graph report impersonates #66 byte equivalence');

  for (const artifact of manifest.artifacts ?? []) {
    assert(!path.isAbsolute(artifact.path), `Artifact manifest path must be relative: ${artifact.path}`);
    const artifactPath = path.resolve(graphDir, artifact.path);
    assert(artifactPath.startsWith(`${path.resolve(graphDir)}${path.sep}`), `Artifact manifest path escapes graph root: ${artifact.path}`);
    assert(fs.existsSync(artifactPath), `Artifact manifest path is missing: ${artifact.path}`);
    const evidence = fileEvidence(artifactPath, artifact.row_count);
    assert(evidence.sha256 === artifact.sha256 && evidence.byte_count === artifact.byte_count, `Artifact manifest hash/size mismatch: ${artifact.path}`);
  }
  assert(manifest.source_snapshot.acquisition_snapshot_id === independentlyDerivedAcquisitionId, 'Artifact manifest acquisition snapshot mismatch');
  assert(manifest.source_snapshot.corpus_input_sha256 === fileEvidence(corpusPath, corpus.length).sha256, 'Artifact manifest corpus input hash mismatch');
  assert(manifest.source_snapshot.phash_features_sha256 === fileEvidence(featurePath, features.length).sha256, 'Artifact manifest feature hash mismatch');
  assert(manifest.arithmetic.nodes === nodes.length && manifest.arithmetic.edges === edges.length && manifest.arithmetic.components === components.length, 'Artifact manifest arithmetic mismatch');
  assert(manifest.arithmetic.grouped_records + manifest.arithmetic.singletons === corpus.length, 'Grouped/singleton arithmetic does not reconcile');

  if (fs.existsSync(searchMetricsPath) && fs.existsSync(searchReportPath) && fs.existsSync(searchCandidatesPath)) {
    const candidates = readJsonl<SearchCandidate>(searchCandidatesPath);
    const actualMetrics = readJsonl<Record<string, any>>(searchMetricsPath);
    const searchReport = readJson<Record<string, any>>(searchReportPath);
    const byTask = new Map<string, SearchCandidate[]>();
    for (const candidate of candidates) byTask.set(candidate.task_id, [...(byTask.get(candidate.task_id) ?? []), candidate]);
    const mapById = new Map(leakageMap.map((row) => [row.record_id, row]));
    const expectedMetrics: Array<Record<string, unknown>> = [];
    const unmapped = new Set<string>();
    const modes = ['semantic', 'smart', 'visual'] as const;
    const k = Number(searchReport.params?.k);
    assert(Number.isInteger(k) && k >= 2 && k <= 100, 'Search duplicate report k is invalid');
    for (const [taskId, rows] of [...byTask.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const mode of modes) {
        const ranked = rows.filter((row) => Number.isFinite(row.ranks?.[mode])).sort((a, b) => Number(a.ranks![mode]) - Number(b.ranks![mode])).slice(0, k);
        if (!ranked.length) continue;
        const seenComponents = new Set<string>();
        const seenLegacy = new Set<string>();
        let componentDuplicates = 0;
        let legacyDuplicates = 0;
        for (const candidate of ranked) {
          const mapping = mapById.get(candidate.candidate_record_id);
          if (!mapping) unmapped.add(candidate.candidate_record_id);
          const componentKey = mapping?.component_id ?? `unmapped:${candidate.candidate_record_id}`;
          const legacyKey = candidate.duplicate_key ?? `record:${candidate.candidate_record_id}`;
          if (seenComponents.has(componentKey)) componentDuplicates += 1;
          if (seenLegacy.has(legacyKey)) legacyDuplicates += 1;
          seenComponents.add(componentKey);
          seenLegacy.add(legacyKey);
        }
        expectedMetrics.push({
          schema_version: VFG_SCHEMA_VERSION,
          task_id: taskId,
          query: rows[0]?.query ?? '',
          slice: rows[0]?.slice ?? 'unknown',
          mode,
          k,
          returned: ranked.length,
          component_duplicate_results: componentDuplicates,
          component_duplicate_rate: Number((componentDuplicates / ranked.length).toFixed(6)),
          legacy_duplicate_results: legacyDuplicates,
          legacy_duplicate_rate: Number((legacyDuplicates / ranked.length).toFixed(6)),
          unique_components: seenComponents.size,
        });
      }
    }
    assert(sameJson(actualMetrics, expectedMetrics), 'Search duplicate task metrics do not independently reproduce');
    const expectedByMode = Object.fromEntries(modes.map((mode) => {
      const rows = expectedMetrics.filter((row) => row.mode === mode);
      return [mode, {
        tasks: rows.length,
        mean_component_duplicate_rate_at_k: Number(mean(rows.map((row) => Number(row.component_duplicate_rate))).toFixed(6)),
        mean_legacy_duplicate_rate_at_k: Number(mean(rows.map((row) => Number(row.legacy_duplicate_rate))).toFixed(6)),
        tasks_with_component_duplicates: rows.filter((row) => Number(row.component_duplicate_results) > 0).length,
      }];
    }));
    assert(sameJson(searchReport.by_mode, expectedByMode), 'Search duplicate by-mode arithmetic mismatch');
    assert(searchReport.counts.candidate_rows === candidates.length && searchReport.counts.tasks === byTask.size && searchReport.counts.task_mode_rows === expectedMetrics.length, 'Search duplicate report count mismatch');
    assert(searchReport.counts.leakage_map_rows === leakageMap.length && searchReport.counts.unmapped_candidate_records === unmapped.size, 'Search duplicate map coverage mismatch');
    assert(searchReport.lineage.candidates.sha256 === fileEvidence(searchCandidatesPath, candidates.length).sha256, 'Search candidate lineage hash mismatch');
    assert(searchReport.lineage.leakage_map.sha256 === fileEvidence(mapPath, leakageMap.length).sha256, 'Search leakage-map lineage hash mismatch');
    assert(searchReport.lineage.task_metrics.sha256 === fileEvidence(searchMetricsPath, actualMetrics.length).sha256, 'Search metric lineage hash mismatch');
  }

  console.log(JSON.stringify({
    status: 'ok',
    acquisition_snapshot_id: independentlyDerivedAcquisitionId,
    corpus_records: corpus.length,
    phash_successes: features.length - failures.length,
    phash_failures: failures.length,
    edges: edges.length,
    components: components.length,
    singletons: components.filter((row) => row.member_count === 1).length,
    split_crossings: 0,
  }));
}

main().catch((error) => {
  console.error(`[vfg-v1:check] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
