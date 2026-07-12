import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import sharp from 'sharp';

export const SELECTION_SCHEMA_VERSION = 'verified_multimodal_real_pilot_candidate_selection_v1.0.0';
export const EXCLUSION_SCHEMA_VERSION = 'verified_multimodal_real_pilot_candidate_exclusion_v1.0.0';
export const SUCCESSOR_GRAPH_CONTRACT_SHA256 = 'b3b26b45e9508c5838f5045f6565b77201d19d14fba99c98f20c5ea147e113bf';
export type Lane = 'ground_ocr_entity_place' | 'aerial_land_use_georeference';
export type Split = 'train' | 'validation' | 'test';

export type JoinedCandidate = {
  record_id: string;
  numeric_id: number;
  name: string;
  description: string | null;
  date: string | null;
  cote: string | null;
  corpus_state: string;
  corpus_rights_complete: boolean;
  corpus_attribution: string;
  local_rights_complete: boolean;
  local_attribution: string;
  source_identity: string;
  source_identity_sha256: string;
  source_urls: string[];
  component_id: string;
  map_split: Split;
  graph_split: Split;
  component_size: number;
  node_phash_status: string;
  derivative_path: string;
  derivative_sha256: string;
  derivative_bytes: number;
  derivative_width: number;
  derivative_height: number;
  derivative_decode_ok: boolean;
  recovery_recovered: boolean;
  recovery_disposition: string;
  normalized_pixel_sha256: string | null;
  recovered_payload_sha256: string | null;
  semantic_join_ok: boolean;
};

export type CandidateRow = {
  schema_version: typeof SELECTION_SCHEMA_VERSION;
  candidate_id: string;
  record_id: string;
  numeric_id: number;
  declared_anchor: boolean;
  anchor_note: string | null;
  lane: Lane;
  rank: number;
  selection_bucket: 'ranked_pool' | 'reserve';
  proxy_score: number;
  proxy_markers: string[];
  proxy_boundary: 'ranking_only_not_verified';
  verified_claim_count: 0;
  title: string;
  description: string | null;
  date: string | null;
  cote: string | null;
  component_id: string;
  component_size: number;
  benchmark_split: Split;
  source_identity_sha256: string;
  derivative: { path: string; sha256: string; bytes: number; width: number; height: number };
  payload_identities: { normalized_pixel_sha256: string | null; recovered_payload_sha256: string | null };
  rights: { complete: true; attribution: string };
  source: { policy: 'stable_https_or_vetted_depot_https_normalization_not_verified'; original_identity: string; normalized_identity: string; original_urls: string[]; normalized_urls: string[] };
};

export type ExclusionRow = {
  schema_version: typeof EXCLUSION_SCHEMA_VERSION;
  record_id: string;
  reasons: string[];
};

const AERIAL = /(?:aerial|aérien|vue[s]? aérienne|vm97|vm94-b|orthophoto)/i;
const GROUND_TEXT = /(?:rue|boulevard|avenue|édifice|immeuble|magasin|commerce|enseigne|affiche|panneau|gare|église|marché|hôtel|theatre|théâtre|restaurant|compagnie|limitée|inc\b|gazette)/i;

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export function assertApprovedHash(bytes: Buffer, expected: string, label: string): void { const actual = sha256(bytes); if (actual !== expected) throw new Error(`${label} approved hash drift: ${actual}`); }

const FORBIDDEN_HOST = /^(?:localhost|.*\.localhost)$/i;
function forbiddenAddress(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return FORBIDDEN_HOST.test(host) || net.isIP(normalized) !== 0;
}

export function normalizeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' && url.hostname === 'depot.ville.montreal.qc.ca') url.protocol = 'https:';
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.port || forbiddenAddress(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
export const safeSourceUrl = (value: string): boolean => normalizeSourceUrl(value) !== null;
export function normalizedUrlSet(values: string[]): string[] | null { const normalized = values.map(normalizeSourceUrl); return normalized.some((value) => value === null) ? null : [...new Set(normalized as string[])].sort(); }

export async function verifyDerivativeBytes(bytes: Buffer, expected: { sha256: string; bytes: number; width: number; height: number; format: string; magic: string }): Promise<void> {
  if (bytes.length !== expected.bytes) throw new Error('derivative byte length mismatch');
  if (sha256(bytes) !== expected.sha256) throw new Error('derivative hash mismatch');
  if (bytes.subarray(0, 2).toString('hex') !== expected.magic || expected.magic !== 'ffd8') throw new Error('derivative magic mismatch');
  const decoded = await sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).raw().toBuffer({ resolveWithObject: true });
  if (expected.format !== 'jpeg' || decoded.info.width !== expected.width || decoded.info.height !== expected.height || decoded.data.length !== expected.width * expected.height * decoded.info.channels) throw new Error('derivative full decode mismatch');
}

export function assertSuccessorContract(value: unknown): void {
  if (value !== SUCCESSOR_GRAPH_CONTRACT_SHA256) throw new Error('successor graph contract digest mismatch');
}

export type DescriptorMember = { path: string; sha256: string; bytes: number };
export function verifyDescriptorMembers(root: string, descriptor: { output_root: string; successor_contract_sha256: string; tree_sha256: string; counts: { files: number; bytes: number }; members: DescriptorMember[] }): void {
  assertSuccessorContract(descriptor.successor_contract_sha256);
  if (descriptor.members.length !== descriptor.counts.files) throw new Error('descriptor file count mismatch');
  if (new Set(descriptor.members.map((m) => m.path)).size !== descriptor.members.length) throw new Error('duplicate descriptor member path');
  const rootReal = fs.realpathSync(root), output = path.resolve(root, descriptor.output_root); if (!output.startsWith(path.resolve(root) + path.sep)) throw new Error('unsafe descriptor output root');
  let cursor = path.resolve(root); for (const segment of path.relative(path.resolve(root), output).split(path.sep)) { cursor = path.join(cursor, segment); if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('symlinked descriptor output ancestor'); }
  if (!fs.statSync(output).isDirectory()) throw new Error('unsafe descriptor output root'); const outputReal = fs.realpathSync(output); if (!outputReal.startsWith(rootReal + path.sep)) throw new Error('descriptor output realpath escapes root');
  const members = [...descriptor.members].sort((a, b) => a.path.localeCompare(b.path));
  let bytes = 0;
  for (const member of members) { if (path.isAbsolute(member.path) || member.path.split(/[\\/]/).includes('..')) throw new Error('unsafe descriptor member path'); const file = path.resolve(output, member.path); if (!file.startsWith(output + path.sep) || !fs.realpathSync(file).startsWith(outputReal + path.sep)) throw new Error('descriptor member traversal'); const stat = fs.lstatSync(file); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('descriptor member is not a regular file'); const data = fs.readFileSync(file); bytes += data.length; if (data.length !== member.bytes || sha256(data) !== member.sha256) throw new Error(`descriptor member drift: ${member.path}`); }
  const actual: string[] = []; const walk = (dir: string) => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name), stat = fs.lstatSync(file); if (stat.isSymbolicLink()) throw new Error('symlink in descriptor output'); if (stat.isDirectory()) walk(file); else if (stat.isFile()) actual.push(path.relative(output, file)); else throw new Error('nonregular descriptor output'); } }; walk(output);
  if (JSON.stringify(actual.sort()) !== JSON.stringify(members.map((m) => m.path).sort())) throw new Error('descriptor exact output membership mismatch');
  if (bytes !== descriptor.counts.bytes) throw new Error('descriptor byte count mismatch');
  const tree = sha256(members.map((item) => `${item.path}\t${item.bytes}\t${item.sha256}`).join('\n') + '\n');
  if (tree !== descriptor.tree_sha256) throw new Error('descriptor tree digest mismatch');
}

export function mechanicalReasons(row: JoinedCandidate): string[] {
  const reasons: string[] = [];
  if (row.corpus_state !== 'canonical') reasons.push('not_canonical_real_state');
  if (!row.corpus_rights_complete || !row.local_rights_complete || !row.corpus_attribution.trim() || !row.local_attribution.trim()) reasons.push('incomplete_canonical_rights_or_attribution');
  if (!row.derivative_path || !row.derivative_sha256 || row.derivative_bytes <= 0 || row.derivative_width <= 0 || row.derivative_height <= 0) reasons.push('derivative_unavailable');
  if (!row.derivative_decode_ok || row.node_phash_status !== 'success') reasons.push('decode_or_visual_feature_failure');
  if (!row.recovery_recovered) reasons.push('recovery_not_available');
  if (!row.component_id) reasons.push('missing_authoritative_component');
  if (row.map_split !== row.graph_split) reasons.push('authoritative_split_mismatch');
  if (!row.source_identity || !row.source_identity_sha256) reasons.push('missing_source_identity');
  if (row.source_urls.length === 0 || row.source_urls.some((url) => !safeSourceUrl(url))) reasons.push('unsafe_or_missing_source_url');
  if (!safeSourceUrl(row.source_identity)) reasons.push('unsafe_or_missing_source_url');
  if (!row.semantic_join_ok) reasons.push('semantic_join_mismatch');
  return [...new Set(reasons)].sort();
}

function proxy(row: JoinedCandidate): { lane: Lane; score: number; markers: string[] } {
  const text = [row.name, row.description, row.cote, row.source_identity].filter(Boolean).join(' ');
  const aerial = AERIAL.test(text);
  const markers = aerial ? ['metadata_aerial_marker'] : ['metadata_ground_marker'];
  let score = aerial ? 80 : 55;
  if (!aerial && GROUND_TEXT.test(text)) { score += 20; markers.push('metadata_ocr_entity_place_marker'); }
  if ((row.description ?? '').length >= 80) { score += 8; markers.push('metadata_description_richness'); }
  if (row.cote) { score += 4; markers.push('metadata_cote_present'); }
  if (row.component_size === 1) { score += 3; markers.push('graph_singleton'); }
  if (row.recovery_disposition === 'recovered_authoritative_source') { score += 2; markers.push('recovery_authoritative_source'); }
  return { lane: aerial ? 'aerial_land_use_georeference' : 'ground_ocr_entity_place', score, markers: markers.sort() };
}

export function selectCandidates(rows: JoinedCandidate[], poolPerLane = 60): { candidates: CandidateRow[]; exclusions: ExclusionRow[] } {
  const exclusions: ExclusionRow[] = [];
  const mechanicallyEligible: JoinedCandidate[] = [];
  for (const row of [...rows].sort((a, b) => a.record_id.localeCompare(b.record_id))) {
    const reasons = mechanicalReasons(row);
    if (reasons.length) exclusions.push({ schema_version: EXCLUSION_SCHEMA_VERSION, record_id: row.record_id, reasons });
    else mechanicallyEligible.push(row);
  }

  const ranked = mechanicallyEligible.map((row) => ({ row, ...proxy(row) })).sort((a, b) =>
    a.lane.localeCompare(b.lane) || b.score - a.score || a.row.numeric_id - b.row.numeric_id || a.row.record_id.localeCompare(b.row.record_id));
  const seenComponents = new Set<string>();
  const seenSources = new Set<string>();
  const seenPayloads = new Set<string>();
  const accepted: typeof ranked = [];
  for (const item of ranked) {
    const duplicateReasons: string[] = [];
    if (seenComponents.has(item.row.component_id)) duplicateReasons.push('duplicate_component_identity');
    const normalizedIdentity = normalizeSourceUrl(item.row.source_identity)!; const normalizedUrls = normalizedUrlSet(item.row.source_urls)!; const sourceKeys = [normalizedIdentity, ...normalizedUrls];
    if (sourceKeys.some((key) => seenSources.has(key))) duplicateReasons.push('duplicate_source_identity');
    const payloads = [item.row.derivative_sha256, item.row.normalized_pixel_sha256, item.row.recovered_payload_sha256].filter((x): x is string => Boolean(x));
    if (payloads.some((value) => seenPayloads.has(value))) duplicateReasons.push('duplicate_image_or_payload_identity');
    if (duplicateReasons.length) {
      exclusions.push({ schema_version: EXCLUSION_SCHEMA_VERSION, record_id: item.row.record_id, reasons: duplicateReasons.sort() });
      continue;
    }
    seenComponents.add(item.row.component_id); sourceKeys.forEach((key) => seenSources.add(key)); payloads.forEach((value) => seenPayloads.add(value)); accepted.push(item);
  }

  const laneRanks = new Map<Lane, number>();
  const candidates: CandidateRow[] = accepted.map(({ row, lane, score, markers }): CandidateRow => {
    const rank = (laneRanks.get(lane) ?? 0) + 1; laneRanks.set(lane, rank);
    const anchor = row.numeric_id === 0;
    return {
      schema_version: SELECTION_SCHEMA_VERSION, candidate_id: `real-pilot-candidate:${sha256(row.record_id).slice(0, 24)}`,
      record_id: row.record_id, numeric_id: row.numeric_id, declared_anchor: anchor,
      anchor_note: anchor ? 'Magic Baking Powder record 0; declared mechanical anchor only, with no verified historical claim.' : null,
      lane, rank, selection_bucket: rank <= poolPerLane ? 'ranked_pool' : 'reserve', proxy_score: score,
      proxy_markers: markers, proxy_boundary: 'ranking_only_not_verified', verified_claim_count: 0,
      title: row.name, description: row.description, date: row.date, cote: row.cote,
      component_id: row.component_id, component_size: row.component_size, benchmark_split: row.map_split,
      source_identity_sha256: row.source_identity_sha256,
      derivative: { path: row.derivative_path, sha256: row.derivative_sha256, bytes: row.derivative_bytes, width: row.derivative_width, height: row.derivative_height },
      payload_identities: { normalized_pixel_sha256: row.normalized_pixel_sha256, recovered_payload_sha256: row.recovered_payload_sha256 },
      rights: { complete: true as const, attribution: row.corpus_attribution },
      source: { policy: 'stable_https_or_vetted_depot_https_normalization_not_verified', original_identity: row.source_identity, normalized_identity: normalizeSourceUrl(row.source_identity)!, original_urls: row.source_urls, normalized_urls: normalizedUrlSet(row.source_urls)! },
    };
  });
  exclusions.sort((a, b) => a.record_id.localeCompare(b.record_id));
  return { candidates, exclusions };
}
