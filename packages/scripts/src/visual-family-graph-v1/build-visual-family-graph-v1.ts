import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from '../dataset-factory/clock.js';
import {
  CANONICAL_COUNTS,
  EDGE_TYPES,
  PHASH_FEATURE_VERSION,
  VFG_SCHEMA_VERSION,
  UnionFind,
  clean,
  countBy,
  deterministicSplit,
  fileEvidence,
  normalizeRecordId,
  recommendationAssessment,
  readJson,
  readJsonl,
  sequenceEvidence,
  sha256,
  stableId,
  unique,
  wilson95,
  writeJson,
  writeJsonl,
  type CorpusInputRow,
  type EdgeType,
  type GraphEdge,
  type LeakageMapRow,
  type PhashFeatureRow,
  type ReviewDecision,
} from './model.js';
import { BASELINE_DERIVATIVE_CONTRACT_ID, RECOVERY_CONTRACT_ID, validateTrustedMixedContracts } from '../canonical-image-recovery-v1/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_CORPUS = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/input/corpus-input-v1.jsonl');
const DEFAULT_CORPUS_SUMMARY = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/input/corpus-input-summary-v1.json');
const DEFAULT_FEATURES = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/phash/phash-features-v1.jsonl');
const DEFAULT_FEATURE_REPORT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/phash/phash-report-v1.json');
const DEFAULT_CLIP = path.join(ROOT, 'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl');
const DEFAULT_REVIEW = path.join(ROOT, 'docs/dataset-factory/fixtures/visual-family-graph-v1/review-adjudications.jsonl');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/graph');
const DEFAULT_THUMB_API = 'https://mtl-archives-worker.wiel.workers.dev';
const EXPANDED_REVIEW_TARGETS: Record<string, number> = {
  exact_payload: 12,
  same_source_asset: 12,
  phash_0: 20,
  same_aerial_run: 20,
  sequence_precedes: 12,
};

type ClipRow = {
  type?: string;
  id?: string;
  nearest?: Array<{ id?: string; score?: number; primaryCategory?: string; themes?: string[] }>;
};

type ReviewCandidate = {
  edge_id: string | null;
  edge_type: EdgeType;
  stratum: string;
  source_record_id: string;
  target_record_id: string;
  threshold: string | null;
  phash_distance: number | null;
  evidence: Record<string, unknown>;
};

type BkNode = { hash: bigint; recordIds: string[]; children: Map<number, BkNode> };

function hammingBigInt(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function repoEvidence(filePath: string, rowCount?: number): Record<string, unknown> {
  return { ...fileEvidence(filePath, rowCount), path: path.relative(ROOT, filePath).split(path.sep).join('/') };
}

function pair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

function thresholdBin(distance: number): string {
  if (distance === 0) return '0';
  if (distance <= 2) return '1-2';
  if (distance <= 4) return '3-4';
  if (distance <= 8) return '5-8';
  if (distance <= 12) return '9-12';
  return '13-16';
}

function addBk(root: BkNode | null, hash: bigint, recordId: string): BkNode {
  if (!root) return { hash, recordIds: [recordId], children: new Map() };
  let node = root;
  while (true) {
    const distance = hammingBigInt(hash, node.hash);
    if (distance === 0) {
      node.recordIds.push(recordId);
      return root;
    }
    const child = node.children.get(distance);
    if (child) node = child;
    else {
      node.children.set(distance, { hash, recordIds: [recordId], children: new Map() });
      return root;
    }
  }
}

function searchBk(node: BkNode | null, hash: bigint, radius: number, output: Array<{ recordId: string; distance: number }>): void {
  if (!node) return;
  const distance = hammingBigInt(hash, node.hash);
  if (distance <= radius) for (const recordId of node.recordIds) output.push({ recordId, distance });
  const low = Math.max(0, distance - radius);
  const high = distance + radius;
  for (const [edgeDistance, child] of node.children) if (edgeDistance >= low && edgeDistance <= high) searchBk(child, hash, radius, output);
}

function normalizeText(value: unknown): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleGeneric(value: string): boolean {
  const normalized = normalizeText(value);
  return !normalized || /^mtl archives metadata/.test(normalized) || /^vm\d/.test(normalized) || normalized.length < 8;
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.edge_type}\0${edge.source_record_id}\0${edge.target_record_id}\0${edge.threshold ?? ''}`;
}

function reviewThumb(imageUrl: string, apiOrigin: string): string {
  const url = new URL('/api/thumb', apiOrigin);
  url.searchParams.set('src', imageUrl);
  url.searchParams.set('w', '384');
  url.searchParams.set('h', '384');
  url.searchParams.set('fit', 'contain');
  url.searchParams.set('q', '82');
  url.searchParams.set('format', 'jpeg');
  return url.toString();
}

function precisionRows(edges: GraphEdge[], packet: Array<Record<string, unknown>>, decisions: ReviewDecision[]): Array<Record<string, unknown>> {
  const packetById = new Map(packet.map((row) => [String(row.review_id), row]));
  const decisionById = new Map<string, ReviewDecision>();
  for (const decision of decisions) {
    if (!packetById.has(decision.review_id)) throw new Error(`Review decision is not in current packet: ${decision.review_id}`);
    if (decisionById.has(decision.review_id)) throw new Error(`Duplicate review decision: ${decision.review_id}`);
    decisionById.set(decision.review_id, decision);
  }
  const groups: Array<{ edge_type: EdgeType; threshold: string | null }> = [];
  for (const edgeType of EDGE_TYPES) {
    if (edgeType === 'near_duplicate_phash') {
      for (const threshold of ['0', '1-2', '3-4', '5-8', '9-12', '13-16']) groups.push({ edge_type: edgeType, threshold });
    } else groups.push({ edge_type: edgeType, threshold: null });
  }
  return groups.map((group) => {
    const matchingEdges = edges.filter((edge) => edge.edge_type === group.edge_type && (group.threshold === null || edge.threshold === group.threshold));
    const matchingPacket = packet.filter((row) => row.edge_type === group.edge_type && (group.threshold === null || row.threshold === group.threshold));
    const reviewed = matchingPacket.map((row) => decisionById.get(String(row.review_id))).filter((row): row is ReviewDecision => Boolean(row));
    const inspected = reviewed.filter((row) => row.image_inspected);
    const decided = reviewed.filter((row) => row.decision !== 'abstain');
    const positive = decided.filter((row) => row.decision === 'positive').length;
    return {
      schema_version: VFG_SCHEMA_VERSION,
      edge_type: group.edge_type,
      threshold: group.threshold,
      graph_edges: matchingEdges.length,
      packet_pairs: matchingPacket.length,
      adjudication_rows: reviewed.length,
      reviewed_pairs: inspected.length,
      decided_denominator: decided.length,
      positive_numerator: positive,
      abstentions: reviewed.filter((row) => row.decision === 'abstain').length,
      pairwise_precision: decided.length ? Number((positive / decided.length).toFixed(6)) : null,
      wilson_95: wilson95(positive, decided.length),
      uncertainty: decided.length ? 'Wilson 95% interval over the reviewed, non-abstained stratified sample; not a census.' : 'No reviewed non-abstained pairs for this edge type/threshold.',
    };
  });
}

function renderMarkdown(report: Record<string, any>): string {
  return `# Visual Family Graph v1 Report

Generated: ${report.generated_at}

## Coverage

- Canonical Corpus records: ${report.coverage.corpus_records}
- Nodes: ${report.coverage.nodes}
- pHash successes: ${report.coverage.phash_successes}
- Individually reported pHash failures: ${report.coverage.phash_failures}
- Grouped records: ${report.components.grouped_records}
- Explicit singletons: ${report.components.singletons}
- Leakage components: ${report.components.total}

## Typed Edges

\`\`\`json
${JSON.stringify(report.edges.by_type, null, 2)}
\`\`\`

Grouping uses only edges with \`grouping_eligible=true\`. CLIP, DINO, alternate-crop, reportage, and low-confidence same-subject evidence do not force benchmark grouping.

## Split Check

- Train: ${report.splits.records.train}
- Validation: ${report.splits.records.validation}
- Test: ${report.splits.records.test}
- Connected components crossing splits: ${report.splits.component_crossings}

## Model Boundary

- CLIP: ${report.models.clip.model_id}; query coverage ${report.models.clip.query_records}/${report.coverage.corpus_records}; neighbor edges are similarity evidence, not historical identity.
- DINO: ${report.models.dino.status}; no paid compute was launched.

## Production Boundary

This workflow is read-only. It emits recommendations and preserved alternates, never deletion instructions, and performs no D1/R2/Vectorize write, reindex, deploy, ranking mutation, credential change, or paid launch.
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      corpus: { type: 'string', default: DEFAULT_CORPUS },
      'corpus-summary': { type: 'string', default: DEFAULT_CORPUS_SUMMARY },
      features: { type: 'string', default: DEFAULT_FEATURES },
      'feature-report': { type: 'string', default: DEFAULT_FEATURE_REPORT },
      clip: { type: 'string', default: DEFAULT_CLIP },
      review: { type: 'string', default: DEFAULT_REVIEW },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'thumb-api-origin': { type: 'string', default: DEFAULT_THUMB_API },
      'phash-group-threshold': { type: 'string', default: '-1' },
      'phash-review-threshold': { type: 'string', default: '8' },
      'phash-max-threshold': { type: 'string', default: '12' },
      'clip-threshold': { type: 'string', default: '0.84' },
      'review-per-stratum': { type: 'string', default: '4' },
      mode: { type: 'string', default: 'live' },
    },
  });
  const startedAt = datasetFactoryNowIso();
  const startedMs = Date.now();
  const corpusPath = resolvePath(values.corpus!);
  const corpusSummaryPath = resolvePath(values['corpus-summary']!);
  const featuresPath = resolvePath(values.features!);
  const featureReportPath = resolvePath(values['feature-report']!);
  const clipPath = resolvePath(values.clip!);
  const reviewPath = resolvePath(values.review!);
  const outputDir = resolvePath(values.output!);
  const groupThreshold = Number.parseInt(values['phash-group-threshold']!, 10);
  const reviewThreshold = Number.parseInt(values['phash-review-threshold']!, 10);
  const maxThreshold = Number.parseInt(values['phash-max-threshold']!, 10);
  const clipThreshold = Number.parseFloat(values['clip-threshold']!);
  const reviewPerStratum = Number.parseInt(values['review-per-stratum']!, 10);
  if (!(groupThreshold >= -1 && groupThreshold <= reviewThreshold && reviewThreshold <= maxThreshold && maxThreshold <= 16)) throw new Error('pHash thresholds must satisfy -1 <= group <= review <= max <= 16; -1 disables pHash grouping');
  if (!(clipThreshold >= -1 && clipThreshold <= 1)) throw new Error('clip-threshold must be -1..1');
  if (!Number.isInteger(reviewPerStratum) || reviewPerStratum < 1 || reviewPerStratum > 20) throw new Error('review-per-stratum must be 1..20');
  const corpus = readJsonl<CorpusInputRow>(corpusPath);
  const features = readJsonl<PhashFeatureRow>(featuresPath);
  const corpusSummary = readJson<Record<string, any>>(corpusSummaryPath);
  const featureReport = readJson<Record<string, any>>(featureReportPath);
  const clipRows = fs.existsSync(clipPath) ? readJsonl<ClipRow>(clipPath) : [];
  const decisions = fs.existsSync(reviewPath) ? readJsonl<ReviewDecision>(reviewPath) : [];
  if (new Set(corpus.map((row) => row.record_id)).size !== corpus.length) throw new Error('Duplicate corpus record ID');
  if (new Set(features.map((row) => row.record_id)).size !== features.length) throw new Error('Duplicate feature record ID');
  if (corpus.length !== features.length || corpus.some((row, index) => row.record_id !== features[index]?.record_id)) throw new Error('Feature rows must cover every corpus record exactly once in sorted order');
  if (values.mode === 'live') {
    if (corpus.length !== CANONICAL_COUNTS.corpus) throw new Error(`Canonical Corpus count drift: ${corpus.length}`);
    if (corpus.filter((row) => row.corpus_state === 'alias').length !== CANONICAL_COUNTS.aliases) throw new Error('Alias count drift');
    if (corpusSummary.counts?.corpus_records !== CANONICAL_COUNTS.corpus) throw new Error('Corpus input summary count drift');
  }
  const acquisitionIds = unique(corpus.map((row) => row.corpus_snapshot_id));
  if (acquisitionIds.length !== 1) throw new Error(`Corpus rows contain ${acquisitionIds.length} acquisition snapshot IDs`);
  if (acquisitionIds[0] !== corpusSummary.acquisition_snapshot_id) throw new Error('Corpus acquisition snapshot ID does not match its input summary');
  const referenceIds = unique(corpus.map((row) => row.canonical_corpus_reference_snapshot_id));
  if (referenceIds.length !== 1 || referenceIds[0] !== corpusSummary.canonical_corpus_reference_snapshot_id) throw new Error('Canonical Corpus reference snapshot mismatch');
  if (corpusSummary.byte_equivalent_to_canonical_reference !== false) throw new Error('Mutable public API acquisition must not claim byte equivalence to the #66 snapshot');
  const corpusInputSha256 = fileEvidence(corpusPath, corpus.length).sha256;
  const featureContractId = String(featureReport.transform_contract?.derivative_contract_id ?? '');
  if (!featureContractId) throw new Error('Feature report derivative contract is missing');
  const recoveryLineage = featureReport.recovery_lineage;
  const acceptedFeatureContractIds = recoveryLineage ? [BASELINE_DERIVATIVE_CONTRACT_ID, RECOVERY_CONTRACT_ID] : [featureContractId];
  if (recoveryLineage) validateTrustedMixedContracts(features, featureReport, String(fileEvidence(featuresPath, features.length).sha256));
  for (const [index, feature] of features.entries()) {
    const record = corpus[index];
    if (feature.feature_version !== PHASH_FEATURE_VERSION
      || feature.record_id !== record.record_id
      || feature.image_key !== record.image_key
      || feature.corpus_snapshot_id !== acquisitionIds[0]
      || feature.corpus_input_sha256 !== corpusInputSha256
      || !acceptedFeatureContractIds.includes(feature.derivative_contract_id)) {
      throw new Error(`${feature.record_id}: stale or mixed pHash feature contract`);
    }
  }
  if (featureReport.source_snapshot?.acquisition_snapshot_id !== acquisitionIds[0]
    || featureReport.source_snapshot?.corpus_input_sha256 !== corpusInputSha256) throw new Error('Feature report source snapshot mismatch');
  const corpusById = new Map(corpus.map((row) => [row.record_id, row]));
  const featureById = new Map(features.map((row) => [row.record_id, row]));
  const edgesByKey = new Map<string, GraphEdge>();
  const reviewCandidates: ReviewCandidate[] = [];
  function addEdge(input: Omit<GraphEdge, 'schema_version' | 'edge_id'>): GraphEdge {
    if (input.grouping_eligible !== (input.authority === 'grouping_authoritative')) {
      throw new Error(`${input.edge_type}: grouping eligibility and authority must be equivalent in v1`);
    }
    const [source, target] = input.directed ? [input.source_record_id, input.target_record_id] : pair(input.source_record_id, input.target_record_id);
    if (source === target) throw new Error(`Self-edge for ${source}`);
    const edge: GraphEdge = {
      ...input,
      schema_version: VFG_SCHEMA_VERSION,
      source_record_id: source,
      target_record_id: target,
      edge_id: stableId('edge', [input.edge_type, source, target, input.threshold ?? '']),
    };
    edgesByKey.set(edgeKey(edge), edge);
    return edge;
  }

  const pixelGroups = new Map<string, string[]>();
  for (const row of features.filter((feature) => feature.status === 'success')) {
    const group = pixelGroups.get(row.normalized_pixel_sha256!) ?? [];
    group.push(row.record_id);
    pixelGroups.set(row.normalized_pixel_sha256!, group);
  }
  for (const [pixelHash, ids] of pixelGroups) {
    const sorted = unique(ids);
    if (sorted.length < 2) continue;
    for (let index = 1; index < sorted.length; index += 1) addEdge({
      source_record_id: sorted[0], target_record_id: sorted[index], edge_type: 'exact_payload', directed: false,
      authority: 'grouping_authoritative', grouping_eligible: true, confidence: 1, threshold: null,
      evidence: {
        payload_scope: 'normalized_derivative_rgb_256x256_v1',
        payload_definition: 'auto-oriented, white-flattened, contain-fit RGB 256x256 pixel bytes under the recorded derivative contract',
        normalized_pixel_sha256: pixelHash,
        source_payload_equality_claimed: false,
        r2_etag_size_used_as_byte_proof: false,
      },
    });
  }

  const aliasGroups = new Map<string, CorpusInputRow[]>();
  for (const row of corpus.filter((record) => record.alias_group_id)) {
    const group = aliasGroups.get(row.alias_group_id!) ?? [];
    group.push(row);
    aliasGroups.set(row.alias_group_id!, group);
  }
  for (const [groupId, rows] of aliasGroups) {
    const canonical = rows.find((row) => row.corpus_state !== 'alias');
    if (!canonical) throw new Error(`${groupId}: alias group has no canonical source record`);
    for (const alias of rows.filter((row) => row.corpus_state === 'alias')) {
      const canonicalFeature = featureById.get(canonical.record_id)!;
      const aliasFeature = featureById.get(alias.record_id)!;
      const currentDerivativeMatch = canonicalFeature.status === 'success' && aliasFeature.status === 'success'
        ? canonicalFeature.normalized_pixel_sha256 === aliasFeature.normalized_pixel_sha256
        : null;
      addEdge({
        source_record_id: canonical.record_id, target_record_id: alias.record_id, edge_type: 'same_source_asset', directed: false,
        authority: 'grouping_authoritative', grouping_eligible: true, confidence: 1, threshold: null,
        evidence: {
          alias_group_id: groupId,
          source_identity_sha256: sha256(canonical.source_identity),
          source_identity_exact_match: canonical.source_identity === alias.source_identity,
          source_urls_preserved: true,
          current_normalized_derivative_equal: currentDerivativeMatch,
          current_derivative_identity_claimed: false,
        },
      });
    }
  }

  let bkRoot: BkNode | null = null;
  for (const feature of features.filter((row) => row.status === 'success' && row.phash64)) {
    const near: Array<{ recordId: string; distance: number }> = [];
    const hash = BigInt(`0x${feature.phash64}`);
    searchBk(bkRoot, hash, 16, near);
    for (const candidate of near) {
      const distance = candidate.distance;
      if (distance <= maxThreshold) {
        const authority = distance <= groupThreshold ? 'grouping_authoritative' : distance <= reviewThreshold ? 'review_required' : 'uncertain';
        const edge = addEdge({
          source_record_id: candidate.recordId, target_record_id: feature.record_id, edge_type: 'near_duplicate_phash', directed: false,
          authority, grouping_eligible: distance <= groupThreshold, confidence: Number(Math.max(0.5, 1 - distance / 20).toFixed(4)), threshold: thresholdBin(distance),
          evidence: { algorithm: 'DCT-pHash64', hamming_distance: distance, grouping_threshold: groupThreshold, grouping_disabled: groupThreshold < 0, review_threshold: reviewThreshold, max_threshold: maxThreshold },
        });
        const left = featureById.get(edge.source_record_id)!;
        const right = featureById.get(edge.target_record_id)!;
        const leftRatio = (left.derivative_width ?? 1) / (left.derivative_height ?? 1);
        const rightRatio = (right.derivative_width ?? 1) / (right.derivative_height ?? 1);
        const ratioDelta = Math.abs(Math.log(leftRatio / rightRatio));
        if (distance <= maxThreshold && ratioDelta >= 0.12) addEdge({
          source_record_id: edge.source_record_id, target_record_id: edge.target_record_id, edge_type: 'alternate_crop', directed: false,
          authority: 'review_required', grouping_eligible: false, confidence: Number(Math.max(0.5, 0.82 - distance * 0.025).toFixed(4)), threshold: `phash<=${maxThreshold};aspect_log_delta>=0.12`,
          evidence: { phash_distance: distance, aspect_log_delta: Number(ratioDelta.toFixed(6)), derivative_payloads_differ: left.derivative_sha256 !== right.derivative_sha256 },
        });
      } else if (distance <= 16) {
        const [source, target] = pair(candidate.recordId, feature.record_id);
        reviewCandidates.push({ edge_id: null, edge_type: 'near_duplicate_phash', stratum: 'hard_negative_phash_13_16', source_record_id: source, target_record_id: target, threshold: '13-16', phash_distance: distance, evidence: { expected_role: 'hard_negative' } });
      }
    }
    bkRoot = addBk(bkRoot, hash, feature.record_id);
  }
  console.log(`[vfg-v1:build] pHash edges=${[...edgesByKey.values()].filter((edge) => edge.edge_type === 'near_duplicate_phash').length} hard_negatives=${reviewCandidates.length}`);

  const runGroups = new Map<string, Array<{ row: CorpusInputRow; sequence: number; kind: 'aerial' | 'reportage' }>>();
  for (const row of corpus) {
    const parsed = sequenceEvidence(row);
    if (parsed) {
      const group = runGroups.get(parsed.runKey) ?? [];
      group.push({ row, sequence: parsed.sequence, kind: parsed.kind });
      runGroups.set(parsed.runKey, group);
    }
  }
  for (const [runKey, rawMembers] of runGroups) {
    const members = rawMembers.sort((a, b) => a.sequence - b.sequence || a.row.record_id.localeCompare(b.row.record_id));
    if (members.length < 2) continue;
    if (new Set(members.map((member) => member.kind)).size !== 1) throw new Error(`${runKey}: mixed run kinds`);
    const kind = members[0].kind;
    const edgeType: EdgeType = kind === 'aerial' ? 'same_aerial_run' : 'same_reportage';
    for (let index = 1; index < members.length; index += 1) {
      addEdge({
        source_record_id: members[0].row.record_id, target_record_id: members[index].row.record_id, edge_type: edgeType, directed: false,
        authority: kind === 'aerial' ? 'grouping_authoritative' : 'review_required', grouping_eligible: kind === 'aerial', confidence: kind === 'aerial' ? 0.94 : 0.76, threshold: null,
        evidence: { run_key: runKey, sequence_a: members[0].sequence, sequence_b: members[index].sequence, identity_claimed: false },
      });
      const previous = members[index - 1];
      const current = members[index];
      if (current.sequence > previous.sequence) addEdge({
        source_record_id: previous.row.record_id, target_record_id: current.row.record_id, edge_type: 'sequence_precedes', directed: true,
        authority: kind === 'aerial' ? 'grouping_authoritative' : 'review_required', grouping_eligible: kind === 'aerial', confidence: kind === 'aerial' ? 0.92 : 0.74, threshold: null,
        evidence: { run_key: runKey, source_sequence: previous.sequence, target_sequence: current.sequence, adjacency: current.sequence - previous.sequence },
      });
    }
  }

  const subjectGroups = new Map<string, string[]>();
  for (const row of corpus) {
    if (titleGeneric(row.name)) continue;
    const key = `${normalizeText(row.name)}|${normalizeText(row.date)}`;
    const group = subjectGroups.get(key) ?? [];
    group.push(row.record_id);
    subjectGroups.set(key, group);
  }
  for (const [key, ids] of subjectGroups) {
    const members = unique(ids);
    if (members.length < 2 || members.length > 25) continue;
    for (let index = 1; index < members.length; index += 1) addEdge({
      source_record_id: members[0], target_record_id: members[index], edge_type: 'same_subject_unverified', directed: false,
      authority: 'uncertain', grouping_eligible: false, confidence: 0.55, threshold: null,
      evidence: { normalized_title_date_sha256: sha256(key), similarity_is_not_historical_identity: true },
    });
  }

  const clipQueries = clipRows.filter((row) => row.type === 'nearest_neighbors' && corpusById.has(normalizeRecordId(row.id)));
  for (const row of clipQueries) {
    const source = normalizeRecordId(row.id);
    for (const neighbor of row.nearest ?? []) {
      const target = normalizeRecordId(neighbor.id);
      const score = Number(neighbor.score ?? Number.NaN);
      if (!target || !corpusById.has(target) || source === target || !Number.isFinite(score) || score < clipThreshold) continue;
      addEdge({
        source_record_id: source, target_record_id: target, edge_type: 'visual_neighbor_clip', directed: false,
        authority: 'uncertain', grouping_eligible: false, confidence: Number(Math.min(0.89, Math.max(0.5, score)).toFixed(4)), threshold: `cosine>=${clipThreshold}`,
        evidence: { model_id: 'Xenova/clip-vit-base-patch32', evidence_run: 'autoresearch_embedding_eval_gpu_500', cosine_score: score, similarity_is_not_historical_identity: true },
      });
    }
  }

  const edges = [...edgesByKey.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  console.log(`[vfg-v1:build] typed edges=${edges.length}`);
  const union = new UnionFind();
  for (const row of corpus) union.add(row.record_id);
  for (const edge of edges.filter((row) => row.grouping_eligible)) union.union(edge.source_record_id, edge.target_record_id);
  const groupingTypesByRoot = new Map<string, Set<EdgeType>>();
  for (const edge of edges.filter((row) => row.grouping_eligible)) {
    const root = union.find(edge.source_record_id);
    const types = groupingTypesByRoot.get(root) ?? new Set<EdgeType>();
    types.add(edge.edge_type);
    groupingTypesByRoot.set(root, types);
  }
  const rawComponents = union.groups().sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const componentByRecord = new Map<string, { id: string; members: string[] }>();
  const components = rawComponents.map((members) => {
    const componentId = stableId('leakage-component', members);
    const groupingTypes = [...(groupingTypesByRoot.get(union.find(members[0])) ?? new Set<EdgeType>())].sort((a, b) => a.localeCompare(b));
    const row = { schema_version: VFG_SCHEMA_VERSION, component_id: componentId, member_count: members.length, members, grouping_edge_types: groupingTypes };
    for (const member of members) componentByRecord.set(member, { id: componentId, members });
    return row;
  }).sort((a, b) => a.component_id.localeCompare(b.component_id));

  const edgeTypesByComponent = new Map(components.map((component) => [component.component_id, component.grouping_edge_types]));
  const leakageMap: LeakageMapRow[] = corpus.map((row): LeakageMapRow => {
    const component = componentByRecord.get(row.record_id)!;
    const split = deterministicSplit(component.id);
    return {
      schema_version: VFG_SCHEMA_VERSION,
      record_id: row.record_id,
      leakage_status: component.members.length > 1 ? 'grouped' : 'singleton',
      leakage_group_id: component.members.length > 1 ? component.id : null,
      component_id: component.id,
      component_size: component.members.length,
      benchmark_split: split,
      grouping_edge_types: edgeTypesByComponent.get(component.id) ?? [],
    };
  }).sort((a, b) => a.record_id.localeCompare(b.record_id));
  const authoritativeAerialRuns = [...runGroups.entries()]
    .filter(([, members]) => members.length >= 2 && members[0].kind === 'aerial')
    .map(([runKey, members]) => {
      const componentIds = unique(members.map((member) => componentByRecord.get(member.row.record_id)!.id));
      const splits = unique(members.map((member) => deterministicSplit(componentByRecord.get(member.row.record_id)!.id)));
      if (componentIds.length !== 1 || splits.length !== 1) throw new Error(`${runKey}: authoritative aerial run was not preserved in one component and split`);
      return { run_key: runKey, member_count: members.length, component_id: componentIds[0], split: splits[0] };
    })
    .sort((a, b) => a.run_key.localeCompare(b.run_key));

  const nodes = corpus.map((row) => ({
    schema_version: VFG_SCHEMA_VERSION,
    record_id: row.record_id,
    numeric_id: row.numeric_id,
    corpus_state: row.corpus_state,
    canonical_source_record_id: row.canonical_source_record_id,
    image_key: row.image_key,
    name: row.name,
    date: row.date,
    cote: row.cote,
    source_identity_sha256: sha256(row.source_identity),
    source_urls: row.source_urls,
    source_datasets: row.source_datasets,
    source_record_ids: row.source_record_ids,
    source_record_sha256: row.source_record_sha256,
    rights: row.rights,
    phash_status: featureById.get(row.record_id)!.status,
    phash_failure_code: featureById.get(row.record_id)!.failure_code,
  })).sort((a, b) => a.record_id.localeCompare(b.record_id));

  const groupingEdgesByComponent = new Map<string, GraphEdge[]>();
  for (const edge of edges.filter((row) => row.grouping_eligible)) {
    const componentId = componentByRecord.get(edge.source_record_id)!.id;
    const componentEdges = groupingEdgesByComponent.get(componentId) ?? [];
    componentEdges.push(edge);
    groupingEdgesByComponent.set(componentId, componentEdges);
  }

  const recommendations = components.filter((component) => component.member_count > 1).map((component) => {
    const ranked = component.members.map((recordId) => {
      const row = corpusById.get(recordId)!;
      const feature = featureById.get(recordId)!;
      const factors = {
        production_d1: row.systems.d1 ? 100 : 0,
        not_source_alias: row.corpus_state !== 'alias' ? 20 : 0,
        visual_feature_available: feature.status === 'success' ? 5 : 0,
        descriptive_title: titleGeneric(row.name) ? 0 : 3,
        rights_complete: row.rights.complete ? 2 : 0,
      };
      const score = Object.values(factors).reduce((sum, value) => sum + value, 0);
      return { row, feature, score, factors };
    }).sort((a, b) => b.score - a.score || a.row.record_id.localeCompare(b.row.record_id));
    const canonical = ranked[0];
    const authority = groupingEdgesByComponent.get(component.component_id) ?? [];
    const sourceEdges = authority.filter((edge) => edge.edge_type === 'same_source_asset');
    const sourceDerivativeDisagreement = sourceEdges.some((edge) => edge.evidence.current_normalized_derivative_equal === false);
    const runnerUpScore = ranked[1]?.score ?? canonical.score;
    const selection = {
      canonical_score: canonical.score,
      runner_up_score: runnerUpScore,
      score_margin: canonical.score - runnerUpScore,
      top_score_tie_count: ranked.filter((candidate) => candidate.score === canonical.score).length,
    };
    const assessment = recommendationAssessment(component.members, authority, selection);
    return {
      schema_version: VFG_SCHEMA_VERSION,
      component_id: component.component_id,
      canonical_record_id: canonical.row.record_id,
      alternate_record_ids: ranked.slice(1).map((candidate) => candidate.row.record_id),
      member_count: ranked.length,
      confidence: assessment.confidence,
      support: assessment.support,
      canonical_selection: {
        ...selection,
        ranking_factors: canonical.factors,
        deterministic_tie_breaker: 'record_id_ascending',
      },
      reasons: [
        canonical.row.systems.d1 ? 'production_d1_member' : 'not_in_production_d1',
        canonical.row.corpus_state !== 'alias' ? 'not_source_alias' : 'source_alias',
        canonical.feature.status === 'success' ? 'visual_feature_available' : 'visual_feature_failure',
        ...(sourceDerivativeDisagreement ? ['source_reference_current_derivative_disagreement'] : []),
        ...assessment.reasons,
        'alternates_remain_addressable',
        'recommendation_only_no_deletion_instruction',
      ],
      preserved_provenance: true,
      deletion_instruction: false,
    };
  }).sort((a, b) => a.component_id.localeCompare(b.component_id));
  console.log(`[vfg-v1:build] components=${components.length} largest=${Math.max(...components.map((component) => component.member_count))}`);

  for (const edge of edges) {
    const distance = Number((edge.evidence as Record<string, unknown>).hamming_distance ?? Number.NaN);
    reviewCandidates.push({
      edge_id: edge.edge_id,
      edge_type: edge.edge_type,
      stratum: edge.edge_type === 'near_duplicate_phash' ? `phash_${edge.threshold}` : edge.edge_type,
      source_record_id: edge.source_record_id,
      target_record_id: edge.target_record_id,
      threshold: edge.threshold,
      phash_distance: Number.isFinite(distance) ? distance : null,
      evidence: edge.evidence,
    });
    const sourceTitle = corpusById.get(edge.source_record_id)?.name ?? '';
    const targetTitle = corpusById.get(edge.target_record_id)?.name ?? '';
    if (/\b(rue|avenue|boulevard|street|coin|angle)\b/i.test(`${sourceTitle} ${targetTitle}`)) reviewCandidates.push({
      edge_id: edge.edge_id, edge_type: edge.edge_type, stratum: 'repeated_street_scenes', source_record_id: edge.source_record_id,
      target_record_id: edge.target_record_id, threshold: edge.threshold, phash_distance: Number.isFinite(distance) ? distance : null, evidence: edge.evidence,
    });
    if (/\b(carte|map|plan|index|document)\b/i.test(`${sourceTitle} ${targetTitle}`)) reviewCandidates.push({
      edge_id: edge.edge_id, edge_type: edge.edge_type, stratum: 'documents_maps', source_record_id: edge.source_record_id,
      target_record_id: edge.target_record_id, threshold: edge.threshold, phash_distance: Number.isFinite(distance) ? distance : null, evidence: edge.evidence,
    });
  }
  const packet: Array<Record<string, unknown>> = [];
  const decisionById = new Map(decisions.map((decision) => [decision.review_id, decision]));
  const byStratum = new Map<string, ReviewCandidate[]>();
  for (const candidate of reviewCandidates) {
    const stratum = byStratum.get(candidate.stratum) ?? [];
    stratum.push(candidate);
    byStratum.set(candidate.stratum, stratum);
  }
  for (const [stratum, candidates] of [...byStratum.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const stratumTarget = Math.max(reviewPerStratum, EXPANDED_REVIEW_TARGETS[stratum] ?? 0);
    const selected = [...new Map(candidates.map((candidate) => [`${candidate.edge_type}:${candidate.source_record_id}:${candidate.target_record_id}:${candidate.threshold}`, candidate])).values()]
      .sort((a, b) => {
        const aId = stableId('review', [stratum, a.edge_type, a.source_record_id, a.target_record_id, a.threshold ?? '']);
        const bId = stableId('review', [stratum, b.edge_type, b.source_record_id, b.target_record_id, b.threshold ?? '']);
        const reviewedOrder = Number(decisionById.has(bId)) - Number(decisionById.has(aId));
        return reviewedOrder || sha256(`${stratum}\0${a.source_record_id}\0${a.target_record_id}`).localeCompare(sha256(`${stratum}\0${b.source_record_id}\0${b.target_record_id}`));
      })
      .slice(0, stratumTarget);
    for (const candidate of selected) {
      const source = corpusById.get(candidate.source_record_id)!;
      const target = corpusById.get(candidate.target_record_id)!;
      packet.push({
        schema_version: VFG_SCHEMA_VERSION,
        review_id: stableId('review', [stratum, candidate.edge_type, candidate.source_record_id, candidate.target_record_id, candidate.threshold ?? '']),
        stratum,
        edge_id: candidate.edge_id,
        edge_type: candidate.edge_type,
        threshold: candidate.threshold,
        source_record_id: candidate.source_record_id,
        target_record_id: candidate.target_record_id,
        source_title: source.name,
        target_title: target.name,
        phash_distance: candidate.phash_distance,
        source_image_url: reviewThumb(source.image_url, values['thumb-api-origin']!),
        target_image_url: reviewThumb(target.image_url, values['thumb-api-origin']!),
        evidence: candidate.evidence,
        adjudication: 'pending',
      });
    }
  }
  packet.sort((a, b) => String(a.review_id).localeCompare(String(b.review_id)));
  const packetIds = new Set(packet.map((row) => String(row.review_id)));
  const missingDecisions = decisions.filter((decision) => !packetIds.has(decision.review_id));
  if (missingDecisions.length) throw new Error(`${missingDecisions.length} preserved review decisions are absent from the rebuilt packet`);
  for (const row of packet) {
    const decision = decisionById.get(String(row.review_id));
    row.adjudication = decision?.decision ?? 'pending';
    row.image_inspected = decision?.image_inspected ?? false;
  }
  const precision = precisionRows(edges, packet, decisions);
  const splitSetsByComponent = new Map<string, Set<string>>();
  for (const row of leakageMap) splitSetsByComponent.set(row.component_id, new Set([...(splitSetsByComponent.get(row.component_id) ?? []), row.benchmark_split]));
  const crossings = [...splitSetsByComponent.values()].filter((splits) => splits.size > 1).length;
  if (crossings) throw new Error(`${crossings} connected components cross benchmark splits`);

  fs.mkdirSync(outputDir, { recursive: true });
  const outputFiles: Array<[string, unknown[]]> = [
    [path.join(outputDir, 'nodes-v1.jsonl'), nodes],
    [path.join(outputDir, 'typed-edges-v1.jsonl'), edges],
    [path.join(outputDir, 'leakage-components-v1.jsonl'), components],
    [path.join(outputDir, 'record-leakage-map-v1.jsonl'), leakageMap],
    [path.join(outputDir, 'benchmark-splits-v1.jsonl'), leakageMap.map((row) => ({ schema_version: VFG_SCHEMA_VERSION, record_id: row.record_id, component_id: row.component_id, split: row.benchmark_split }))],
    [path.join(outputDir, 'canonical-recommendations-v1.jsonl'), recommendations],
    [path.join(outputDir, 'review-packet-v1.jsonl'), packet],
    [path.join(outputDir, 'review-precision-v1.jsonl'), precision],
  ];
  for (const [filePath, rows] of outputFiles) writeJsonl(filePath, rows);
  const completedAt = datasetFactoryNowIso();
  const report: Record<string, any> = {
    schema_version: VFG_SCHEMA_VERSION,
    graph_version: 'visual_family_graph_v1',
    generated_at: completedAt,
    issue: 67,
    source_snapshot: {
      acquisition_snapshot_id: acquisitionIds[0],
      canonical_corpus_reference_snapshot_id: referenceIds[0],
      byte_equivalent_to_canonical_reference: false,
      corpus_input_sha256: fileEvidence(corpusPath, corpus.length).sha256,
      phash_features_sha256: fileEvidence(featuresPath, features.length).sha256,
    },
    params: {
      phash_group_threshold: groupThreshold,
      phash_review_threshold: reviewThreshold,
      phash_max_threshold: maxThreshold,
      clip_threshold: clipThreshold,
      review_per_stratum: reviewPerStratum,
      expanded_review_targets: EXPANDED_REVIEW_TARGETS,
    },
    coverage: {
      corpus_records: corpus.length,
      nodes: nodes.length,
      phash_feature_rows: features.length,
      phash_successes: features.filter((row) => row.status === 'success').length,
      phash_failures: features.filter((row) => row.status === 'failure').length,
      individually_reported_phash_failures: features.filter((row) => row.status === 'failure').length,
      aliases_preserved: corpus.filter((row) => row.corpus_state === 'alias').length,
      records_with_exactly_one_leakage_status: leakageMap.length,
    },
    edges: {
      total: edges.length,
      by_type: Object.fromEntries(EDGE_TYPES.map((type) => [type, edges.filter((edge) => edge.edge_type === type).length])),
      by_authority: countBy(edges, (edge) => edge.authority),
      grouping_eligible: edges.filter((edge) => edge.grouping_eligible).length,
      review_or_uncertain: edges.filter((edge) => !edge.grouping_eligible).length,
      exact_payload_contract: {
        scope: 'normalized_derivative_rgb_256x256_v1',
        source_object_bytes_claimed_equal: false,
        r2_etag_size_used_as_byte_proof: false,
        same_source_identity_is_separate_edge_type: 'same_source_asset',
      },
    },
    components: {
      total: components.length,
      grouped: components.filter((component) => component.member_count > 1).length,
      grouped_records: leakageMap.filter((row) => row.leakage_status === 'grouped').length,
      singletons: leakageMap.filter((row) => row.leakage_status === 'singleton').length,
      largest: Math.max(...components.map((component) => component.member_count)),
      recommendations: recommendations.length,
      deletion_instructions: 0,
    },
    authoritative_aerial_runs: {
      runs: authoritativeAerialRuns.length,
      records: authoritativeAerialRuns.reduce((sum, run) => sum + run.member_count, 0),
      above_250: authoritativeAerialRuns.filter((run) => run.member_count > 250),
      preservation_contract: 'Every parsed aerial run with at least two members has n-1 same_aerial_run star edges and occupies exactly one leakage component and benchmark split.',
    },
    splits: {
      records: countBy(leakageMap, (row) => row.benchmark_split),
      components: countBy(components, (component) => deterministicSplit(component.component_id)),
      component_crossings: crossings,
      proof: 'Each record split is derived only from its grouping-authoritative connected component ID; checker recomputes all components and crossings.',
    },
    review: {
      packet_pairs: packet.length,
      strata: countBy(packet, (row) => String(row.stratum)),
      decisions: decisions.length,
      inspected_pairs: decisions.filter((row) => row.image_inspected).length,
      unreviewed_abstentions: decisions.filter((row) => row.decision === 'abstain' && !row.image_inspected).length,
      decision_counts: countBy(decisions, (row) => row.decision),
      precision_rows: precision.length,
      abstentions_preserved: decisions.filter((row) => row.decision === 'abstain').length,
    },
    recommendation_support: {
      confidence_counts: countBy(recommendations, (row) => row.confidence.toFixed(2)),
      source_disagreement_capped: recommendations.filter((row) => row.support.applied_confidence_caps.some((cap: string) => cap.startsWith('source_derivative_disagreement_confidence_cap'))).length,
      sequence_only_capped: recommendations.filter((row) => row.support.applied_confidence_caps.some((cap: string) => cap.includes('sequence_only_membership_confidence_cap'))).length,
      canonical_tie_capped: recommendations.filter((row) => row.support.applied_confidence_caps.some((cap: string) => cap.startsWith('canonical_selection_tie_confidence_cap'))).length,
      exact_payload_full_member_coverage: recommendations.filter((row) => row.support.exact_payload_member_rate === 1).length,
    },
    models: {
      phash: { model: 'DCT-pHash64', feature_version: features[0]?.feature_version ?? null, transform_contract: featureReport.transform_contract ?? null },
      clip: {
        model_id: 'Xenova/clip-vit-base-patch32',
        index_contract: 'production CLIP index is 512-dimensional cosine; neighbor evidence comes only from the frozen autoresearch GPU-500 evaluation artifact',
        run_id: 'autoresearch_embedding_eval_gpu_500',
        source_sha256: fs.existsSync(clipPath) ? fileEvidence(clipPath, clipRows.length).sha256 : null,
        query_records: new Set(clipQueries.map((row) => normalizeRecordId(row.id))).size,
        corpus_records_with_production_index_membership: CANONICAL_COUNTS.clipIndex,
        similarity_is_historical_identity: false,
      },
      dino: { status: 'not_run_no_approved_paid_compute_gate', model_id: null, edges: 0, cost_usd: 0 },
    },
    runtime_storage_cost: {
      started_at: startedAt,
      completed_at: completedAt,
      elapsed_ms: Date.now() - startedMs,
      graph_output_bytes: outputFiles.reduce((sum, [filePath]) => sum + fs.statSync(filePath).size, 0),
      paid_compute: false,
      cost_usd: 0,
    },
    lineage: {
      corpus_summary: repoEvidence(corpusSummaryPath),
      feature_report: repoEvidence(featureReportPath),
      clip_neighbors: fs.existsSync(clipPath) ? repoEvidence(clipPath, clipRows.length) : null,
      review_decisions: fs.existsSync(reviewPath) ? repoEvidence(reviewPath, decisions.length) : null,
    },
    safety: {
      production_writes: 0,
      paid_compute_launched: false,
      image_deletion_instructions: 0,
      ranking_changes: 0,
      identity_claim_from_similarity: false,
      same_subject_unverified_forces_grouping: edges.some((edge) => edge.edge_type === 'same_subject_unverified' && edge.grouping_eligible),
    },
  };
  if (report.safety.same_subject_unverified_forces_grouping) throw new Error('same_subject_unverified edge forced grouping');
  const reportPath = path.join(outputDir, 'graph-report-v1.json');
  writeJson(reportPath, report);
  fs.writeFileSync(path.join(outputDir, 'graph-report-v1.md'), renderMarkdown(report), 'utf8');
  const manifestEvidence = (filePath: string, rowCount?: number): Record<string, unknown> => ({
    ...fileEvidence(filePath, rowCount),
    path: path.relative(outputDir, filePath).split(path.sep).join('/'),
  });
  const artifacts = [...outputFiles.map(([filePath, rows]) => manifestEvidence(filePath, rows.length)), manifestEvidence(reportPath)];
  writeJson(path.join(outputDir, 'artifact-manifest-v1.json'), {
    schema_version: VFG_SCHEMA_VERSION,
    artifact_manifest_version: 'visual_family_graph_artifact_manifest_v1',
    source_snapshot: report.source_snapshot,
    generation: { command: 'npm run dataset-factory:visual-family-graph-v1', code_ref: 'codex/67-visual-family-graph-v1' },
    artifacts,
    arithmetic: { nodes: nodes.length, edges: edges.length, components: components.length, leakage_map_rows: leakageMap.length, grouped_records: report.components.grouped_records, singletons: report.components.singletons, split_crossings: crossings },
  });
  console.log(JSON.stringify({ status: 'ok', coverage: report.coverage, edges: report.edges, components: report.components, output: outputDir }));
}

main().catch((error) => {
  console.error(`[vfg-v1:build] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
