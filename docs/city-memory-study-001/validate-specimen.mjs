#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '../..');
const APPROVALS = ['visual_evidence', 'metadata_labeling', 'rights_attribution', 'uncertainty', 'projection_fidelity'];
const HASH_RE = /^[0-9a-f]{64}$/;
const SELF_TEST = process.argv.includes('--self-test');

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashJson(value) {
  return hashBytes(Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalized(value) {
  return value === null || value === undefined ? '' : String(value);
}

function canonicalClientUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  return parsed.toString();
}

function sourceUrlsMatchClientProjection(clientUrl, upstreamUrl) {
  if (typeof clientUrl !== 'string' || typeof upstreamUrl !== 'string') return false;
  const canonical = canonicalClientUrl(upstreamUrl);
  return canonical !== null && clientUrl === canonical;
}

function uniqueMap(items, key, label, failures) {
  const map = new Map();
  if (!Array.isArray(items)) {
    failures.push(`${label} is not an array`);
    return map;
  }
  for (const item of items) {
    const id = item?.[key];
    if (id === undefined || id === null || map.has(id)) failures.push(`${label} has missing or duplicate ${key}: ${id}`);
    else map.set(id, item);
  }
  return map;
}

function requireString(value, label, failures) {
  if (typeof value !== 'string' || value.trim() === '') failures.push(`${label} is missing or not a non-empty string`);
}

function requireHash(value, label, failures) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) failures.push(`${label} is not a lowercase SHA-256 digest`);
}

function requireBool(value, label, failures) {
  if (value !== true) failures.push(`${label} is not true`);
}

function checkApprovalObject(approvals, label, failures) {
  if (!approvals || typeof approvals !== 'object') {
    failures.push(`${label} is missing`);
    return;
  }
  for (const approval of APPROVALS) requireBool(approvals[approval], `${label}.${approval}`, failures);
}

function checkMetadata(ledgerRecord, upstreamMetadata, label, failures) {
  if (!upstreamMetadata || typeof upstreamMetadata !== 'object') {
    failures.push(`${label}: archive metadata is missing`);
    return;
  }
  for (const field of ['name', 'date', 'cote']) {
    if (normalized(ledgerRecord.archive_metadata[field]) !== normalized(upstreamMetadata[field])) {
      failures.push(`${ledgerRecord.numeric_id}: ${label} ${field} does not match ledger`);
    }
  }
}

function checkVisualClaim(visualClaims, imageMode, evidenceHash, label, failures) {
  if (!Array.isArray(visualClaims) || visualClaims.length !== 1) {
    failures.push(`${label}: visual claim must contain exactly one claim`);
    return;
  }
  const claim = visualClaims[0];
  if (claim.predicate !== 'image_mode' || claim.value !== imageMode || claim.evidence?.review_row_sha256 !== evidenceHash) {
    failures.push(`${label}: visual-claim join mismatch`);
  }
  requireString(claim.boundary, `${label}: visual claim boundary`, failures);
}

function checkUpstreamRights(ledgerRecord, upstreamRights, label, failures) {
  if (upstreamRights?.license_id !== 'cc-by-4.0' || upstreamRights?.complete !== true || upstreamRights?.commercial_use_allowed !== true || upstreamRights?.attribution !== ledgerRecord.rights?.attribution_line) {
    failures.push(`${ledgerRecord.numeric_id}: ${label} rights join mismatch`);
  }
}

function checkSourceProjection(record, candidate, published, failures) {
  const ledgerUrl = record.archive_metadata?.source_url;
  const candidateUrl = candidate?.archive_metadata?.source_urls?.[0];
  const publishedUrl = published?.archive_metadata?.source_urls?.[0];
  requireString(ledgerUrl, `${record.numeric_id}: ledger source URL`, failures);
  for (const [label, urls] of [['candidate', candidate?.archive_metadata?.source_urls], ['published', published?.archive_metadata?.source_urls]]) {
    if (!Array.isArray(urls) || urls.length !== 1) failures.push(`${record.numeric_id}: ${label} source URL list must contain exactly one URL`);
  }
  if (!sourceUrlsMatchClientProjection(ledgerUrl, candidateUrl)) {
    failures.push(`${record.numeric_id}: ledger source URL is not the documented HTTPS-only projection of candidate source URL`);
  }
  if (!sourceUrlsMatchClientProjection(ledgerUrl, publishedUrl)) {
    failures.push(`${record.numeric_id}: ledger source URL is not the documented HTTPS-only projection of published source URL`);
  }
  if (canonicalClientUrl(ledgerUrl) !== ledgerUrl) failures.push(`${record.numeric_id}: ledger source URL is not canonical HTTPS`);
}

function checkOutputTransformMap(map, ledger, bytesByKey, failures) {
  if (!map || map.schema_version !== 'city_memory_output_transform_map_v1' || map.status !== 'preliminary_internal_outputs') failures.push('invalid output transform map schema/status');
  if (map?.generated_replacement_archive_imagery !== false || map?.external_release !== 'blocked_pending_human_rights_production_and_internal_approval') failures.push('output transform map release boundary is invalid');
  const expected = ['assets/city-memory-study-001-reel.mp4', 'assets/reel-frame-map.json', 'buyer-walkthrough.html', 'concept-study.html', 'interactive-study.html', 'spatial-applications.html'];
  const outputs = Array.isArray(map?.outputs) ? map.outputs : [];
  const paths = outputs.map(output => output?.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(expected)) failures.push('output transform map does not cover the exact client output set');
  const selected = new Set((ledger?.records || []).map(record => record.numeric_id));
  const seen = new Set();
  for (const output of outputs) {
    const label = `output ${output?.path}`;
    if (typeof output?.path !== 'string' || output.path.startsWith('/') || output.path.includes('..') || seen.has(output.path)) failures.push(`${label}: unsafe or duplicate path`);
    else seen.add(output.path);
    requireHash(output?.sha256, `${label}: hash`, failures);
    const bytes = bytesByKey?.[`output:${output?.path}`];
    if (!bytes) failures.push(`${label}: bytes missing`);
    else if (hashBytes(bytes) !== output.sha256) failures.push(`${label}: hash mismatch (${hashBytes(bytes)})`);
    if (!Array.isArray(output?.records) || output.records.some(id => !Number.isInteger(id) || !selected.has(id))) failures.push(`${label}: record map is invalid`);
    if (!Array.isArray(output?.transforms) || output.transforms.length === 0 || output.transforms.some(value => typeof value !== 'string' || !value.trim())) failures.push(`${label}: transforms are missing`);
    requireString(output?.boundary, `${label}: boundary`, failures);
  }
}

function validateInputs({ ledger, candidate_artifact, independent_review_artifact, published_artifact, publication_status_artifact, output_transform_map, bytesByKey }) {
  const failures = [];
  const candidate = candidate_artifact;
  const basis = ledger?.review_basis;
  if (!ledger || ledger.schema_version !== 'city_memory_study_001_provenance_ledger_v1') failures.push('invalid City Memory ledger schema');
  if (!basis || typeof basis !== 'object') failures.push('missing ledger review_basis');
  const projection = ledger?.source_authority?.client_projection;
  if (!projection || projection.source_url_policy !== 'https_only_scheme_projection' || projection.upstream_source_evidence_unchanged !== true) {
    failures.push('missing or invalid HTTPS-only client source URL projection declaration');
  }

  const upstream = [
    ['candidate_artifact', candidate, 'candidate_artifact_sha256'],
    ['independent_review_artifact', independent_review_artifact, 'independent_review_artifact_sha256'],
    ['published_artifact', published_artifact, 'published_artifact_sha256'],
    ['publication_status_artifact', publication_status_artifact, 'publication_status_artifact_sha256'],
  ];
  for (const [key, value, hashField] of upstream) {
    requireHash(basis?.[hashField], `ledger review_basis.${hashField}`, failures);
    const bytes = bytesByKey?.[key];
    if (!bytes) failures.push(`missing upstream artifact bytes for ${key}`);
    else if (basis?.[hashField] !== hashBytes(bytes)) failures.push(`${key} hash mismatch (${hashBytes(bytes)})`);
    if (!value) failures.push(`missing parsed upstream artifact for ${key}`);
  }
  requireHash(basis?.output_transform_map_sha256, 'ledger review_basis.output_transform_map_sha256', failures);
  if (basis?.output_transform_map !== 'docs/city-memory-study-001/assets/output-transform-map.json') failures.push('ledger output transform map path is invalid');
  const transformBytes = bytesByKey?.output_transform_map;
  if (!transformBytes) failures.push('missing output transform map bytes');
  else if (basis.output_transform_map_sha256 !== hashBytes(transformBytes)) failures.push(`output transform map hash mismatch (${hashBytes(transformBytes)})`);
  checkOutputTransformMap(output_transform_map, ledger, bytesByKey, failures);

  const records = ledger?.records;
  if (!Array.isArray(records)) failures.push('ledger records is not an array');
  if (records && (records.length < 12 || records.length > 20)) failures.push(`selected record count ${records.length} is outside 12–20`);
  const selectedById = uniqueMap(records, 'numeric_id', 'ledger records', failures);
  const selectedByRecordId = uniqueMap(records, 'canonical_record_id', 'ledger records', failures);
  if (records && records.length === 12) {
    const ground = records.filter(record => record.review?.image_mode === 'ground_street').length;
    const aerial = records.filter(record => String(record.review?.image_mode || '').startsWith('aerial_')).length;
    if (ground !== 6 || aerial !== 6) failures.push(`selected image-mode balance is ${ground} ground / ${aerial} aerial; expected 6 / 6`);
  }

  const candidateById = new Map();
  if (!Array.isArray(candidate?.packets)) failures.push('candidate packets is not an array');
  else {
    for (const packet of candidate.packets) {
      const id = packet?.record?.numeric_id;
      if (id === undefined || id === null || candidateById.has(id)) failures.push(`candidate packets has missing or duplicate numeric_id: ${id}`);
      else candidateById.set(id, packet);
    }
  }
  const reviewById = uniqueMap(independent_review_artifact?.dispositions, 'numeric_id', 'independent review dispositions', failures);
  const publishedDossiers = published_artifact?.dossiers;
  const publishedById = uniqueMap(publishedDossiers?.map(dossier => dossier.record), 'numeric_id', 'published dossier records', failures);
  if (publishedById.size !== (publishedDossiers || []).length) failures.push('published dossier artifact contains duplicate or missing record IDs');

  const expectedCounts = { candidates: 36, accepted: 32, held: 4, rejected: 0, fully_verified: 32 };
  for (const [field, expected] of Object.entries(expectedCounts)) {
    if (independent_review_artifact?.counts?.[field] !== expected) failures.push(`review ${field} count does not equal ${expected}`);
    if (publication_status_artifact?.counts?.[field] !== expected) failures.push(`status ${field} count does not equal ${expected}`);
  }
  if (basis?.candidate_count !== 36 || basis?.accepted_count !== 32 || basis?.held_count !== 4 || basis?.selected_count !== records?.length) failures.push('ledger review_basis counts do not match the selected/publication contract');
  if (publication_status_artifact?.state !== 'published' || publication_status_artifact?.production_mutation !== false || publication_status_artifact?.paid_gpu !== false) failures.push('publication status is not the expected read-only published state');

  for (const record of records || []) {
    const id = record.numeric_id;
    const prefix = `${id}`;
    for (const field of ['canonical_record_id', 'direction', 'editorial_role', 'public_claim_boundary', 'transform_history']) requireString(record[field], `${prefix}: ledger ${field}`, failures);
    if (!Array.isArray(record.uncertainty) || record.uncertainty.length === 0 || record.uncertainty.some(value => typeof value !== 'string' || !value.trim())) failures.push(`${prefix}: ledger uncertainty must be a non-empty string array`);
    if (!Array.isArray(record.family_links) || record.family_links.some(value => typeof value !== 'string')) failures.push(`${prefix}: ledger family_links must be a string array`);
    if (!Array.isArray(record.review?.approvals) || APPROVALS.some(approval => !record.review.approvals.includes(approval)) || record.review.approvals.length !== APPROVALS.length) failures.push(`${prefix}: ledger review approvals are incomplete or unexpected`);
    if (record.review?.disposition !== 'accepted') failures.push(`${prefix}: ledger disposition is not accepted`);
    requireString(record.review?.image_mode, `${prefix}: ledger image mode`, failures);
    requireHash(record.review?.packet_sha256, `${prefix}: ledger packet hash`, failures);
    requireHash(record.review?.claim_evidence_row_sha256, `${prefix}: ledger claim-evidence hash`, failures);
    if (!record.image || record.image.format !== 'jpeg' || !Number.isInteger(record.image.width) || !Number.isInteger(record.image.height)) failures.push(`${prefix}: ledger image format/dimensions are incomplete`);
    requireHash(record.image?.sha256, `${prefix}: ledger image hash`, failures);
    if (!record.image?.path || record.image.path.startsWith('/') || record.image.path.includes('..')) failures.push(`${prefix}: ledger image path is unsafe`);
    if (record.rights?.license !== 'CC BY 4.0' || record.rights?.commercial_use_allowed_by_captured_authority !== true) failures.push(`${prefix}: ledger rights authority is incomplete`);
    requireString(record.rights?.attribution_line, `${prefix}: ledger attribution line`, failures);
    if (record.rights?.status !== 'documented_source_authority_not_legal_opinion') failures.push(`${prefix}: ledger rights status is not bounded/non-legal`);
    if (record.archive_metadata?.status !== 'reported_by_archive_not_independently_corroborated') failures.push(`${prefix}: ledger archive metadata status is not bounded`);

    const candidatePacket = candidateById.get(id);
    const publishedDossier = publishedDossiers?.find(dossier => dossier.record?.numeric_id === id);
    checkSourceProjection(record, candidatePacket, publishedDossier, failures);
    if (!candidatePacket) failures.push(`${prefix}: no matching candidate packet`);
    else {
      if (candidatePacket.record?.record_id !== record.canonical_record_id || candidatePacket.record?.numeric_id !== id) failures.push(`${prefix}: candidate record join mismatch`);
      if (candidatePacket.review_pixels?.sha256 !== record.image.sha256 || candidatePacket.review_pixels?.width !== record.image.width || candidatePacket.review_pixels?.height !== record.image.height || candidatePacket.review_pixels?.full_decode_verified !== true) failures.push(`${prefix}: candidate review-pixel join/decode mismatch`);
      checkMetadata(record, candidatePacket.archive_metadata, 'candidate metadata', failures);
      checkUpstreamRights(record, candidatePacket.rights, 'candidate', failures);
      checkVisualClaim(candidatePacket.visual_claims, record.review.image_mode, record.review.claim_evidence_row_sha256, `${prefix}: candidate`, failures);
      if (candidatePacket.independent_review?.completed !== false) failures.push(`${prefix}: candidate packet unexpectedly claims completed independent review`);
    }

    const reviewDisposition = reviewById.get(id);
    if (!reviewDisposition) failures.push(`${prefix}: no matching independent review disposition`);
    else {
      if (reviewDisposition.dossier_id !== `verified-dossier-candidate:${id}`) failures.push(`${prefix}: review dossier join mismatch`);
      if (reviewDisposition.packet_sha256 !== record.review.packet_sha256 || reviewDisposition.review_pixel_sha256 !== record.image.sha256) failures.push(`${prefix}: review packet/pixel hash join mismatch`);
      if (reviewDisposition.disposition !== 'accepted' || reviewDisposition.publication_eligible !== true) failures.push(`${prefix}: review disposition is not accepted/publication eligible`);
      checkApprovalObject(reviewDisposition.approvals, `${prefix}: review approvals`, failures);
    }

    if (!publishedDossier) failures.push(`${prefix}: no matching published dossier`);
    else {
      if (publishedDossier.record.record_id !== record.canonical_record_id || publishedDossier.record.numeric_id !== id) failures.push(`${prefix}: published dossier record join mismatch`);
      if (publishedDossier.state !== 'published_independently_verified' || publishedDossier.fully_verified !== true || publishedDossier.publication_eligible !== true || publishedDossier.source_acquisition_only !== false) failures.push(`${prefix}: published dossier state/eligibility mismatch`);
      if (publishedDossier.review_pixels?.sha256 !== record.image.sha256 || publishedDossier.review_pixels?.width !== record.image.width || publishedDossier.review_pixels?.height !== record.image.height || publishedDossier.review_pixels?.full_decode_verified !== true) failures.push(`${prefix}: published review-pixel join/decode mismatch`);
      checkMetadata(record, publishedDossier.archive_metadata, 'published metadata', failures);
      checkVisualClaim(publishedDossier.visual_claims, record.review.image_mode, record.review.claim_evidence_row_sha256, `${prefix}: published`, failures);
      if (publishedDossier.independent_review?.disposition !== 'accepted') failures.push(`${prefix}: published independent-review disposition mismatch`);
      checkApprovalObject(publishedDossier.independent_review?.approvals, `${prefix}: published approvals`, failures);
      if (publishedDossier.rights?.license_id !== 'cc-by-4.0' || publishedDossier.rights?.complete !== true || publishedDossier.rights?.commercial_use_allowed !== true || publishedDossier.rights?.attribution !== record.rights.attribution_line) failures.push(`${prefix}: published rights join mismatch`);
      if (!publishedDossier.alternatives || !publishedDossier.uncertainty || !Array.isArray(publishedDossier.uncertainty.unresolved)) failures.push(`${prefix}: published uncertainty/alternative boundary missing`);
    }

    const imageBytes = bytesByKey?.[`image:${id}`];
    if (!imageBytes) failures.push(`${prefix}: missing selected image bytes`);
    else if (hashBytes(imageBytes) !== record.image.sha256) failures.push(`${prefix}: image hash mismatch (${hashBytes(imageBytes)})`);
  }

  if (selectedById.size !== records?.length || selectedByRecordId.size !== records?.length) failures.push('ledger selected-record IDs are not unique');
  return failures;
}

async function readJson(path) {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes) };
}

async function loadPackage() {
  const ledgerResult = await readJson(resolve(root, 'provenance-ledger.json'));
  const ledger = ledgerResult.value;
  const files = {
    candidate_artifact: ledger.review_basis.candidate_artifact,
    independent_review_artifact: ledger.review_basis.independent_review_artifact,
    published_artifact: ledger.review_basis.published_artifact,
    publication_status_artifact: ledger.review_basis.publication_status_artifact,
  };
  const loaded = {};
  const bytesByKey = {};
  for (const [key, relativePath] of Object.entries(files)) {
    const result = await readJson(resolve(repoRoot, relativePath));
    loaded[key] = result.value;
    bytesByKey[key] = result.bytes;
  }
  const transformResult = await readJson(resolve(repoRoot, ledger.review_basis.output_transform_map));
  loaded.output_transform_map = transformResult.value;
  bytesByKey.output_transform_map = transformResult.bytes;
  for (const output of loaded.output_transform_map.outputs || []) bytesByKey[`output:${output.path}`] = await readFile(resolve(root, output.path)).catch(() => null);
  for (const record of ledger.records || []) bytesByKey[`image:${record.numeric_id}`] = await readFile(resolve(root, record.image.path)).catch(() => null);
  return { ledger, ...loaded, bytesByKey };
}

function runSelfTest(base) {
  const cases = [
    ['candidate artifact tamper', input => { input.candidate_artifact.packets[0].record.record_id = 'tampered-record-id'; input.ledger.review_basis.candidate_artifact_sha256 = hashJson(input.candidate_artifact); }, /candidate record join mismatch/],
    ['review approval tamper', input => { input.independent_review_artifact.dispositions[0].approvals.rights_attribution = false; input.ledger.review_basis.independent_review_artifact_sha256 = hashJson(input.independent_review_artifact); }, /review approvals/],
    ['published claim tamper', input => { const dossier = input.published_artifact.dossiers.find(item => item.record?.numeric_id === input.ledger.records[0].numeric_id); dossier.visual_claims[0].value = 'aerial_vertical'; input.ledger.review_basis.published_artifact_sha256 = hashJson(input.published_artifact); }, /published.*visual-claim join mismatch/],
    ['ledger source projection tamper', input => { input.ledger.records[0].archive_metadata.source_url = 'https://example.invalid/image.jpg'; }, /HTTPS-only projection/],
    ['ledger family boundary tamper', input => { delete input.ledger.records[0].family_links; }, /family_links/],
    ['ledger transform boundary tamper', input => { input.ledger.records[0].transform_history = ''; }, /transform_history/],
    ['output transform tamper', input => { input.output_transform_map.outputs[0].transforms = []; input.ledger.review_basis.output_transform_map_sha256 = hashJson(input.output_transform_map); input.bytesByKey.output_transform_map = Buffer.from(`${JSON.stringify(input.output_transform_map, null, 2)}\n`); }, /transforms are missing/],
  ];
  const failures = [];
  for (const [name, mutate, expected] of cases) {
    const input = { ledger: clone(base.ledger), candidate_artifact: clone(base.candidate_artifact), independent_review_artifact: clone(base.independent_review_artifact), published_artifact: clone(base.published_artifact), publication_status_artifact: clone(base.publication_status_artifact), output_transform_map: clone(base.output_transform_map), bytesByKey: { ...base.bytesByKey } };
    mutate(input);
    if (!expected.test(validateInputs(input).join('\n'))) failures.push(`${name} did not fail with expected diagnostic`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`City Memory validator self-test passed: ${cases.length} adversarial cases rejected.`);
}

try {
  const base = await loadPackage();
  if (SELF_TEST) runSelfTest(base);
  else {
    const failures = validateInputs(base);
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exit(1);
    }
    console.log(`City Memory Study 001 valid: ${base.ledger.records.length} records, upstream artifacts, joins, image hashes, rights, claims, family and transform boundaries verified.`);
  }
} catch (error) {
  console.error(`City Memory validator could not complete: ${error.message}`);
  process.exit(1);
}
