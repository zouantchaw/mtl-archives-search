#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const ledger = JSON.parse(await readFile(resolve(root, 'provenance-ledger.json'), 'utf8'));
const failures = [];
const repoRoot = resolve(root, '../..');
const publishedPath = resolve(repoRoot, ledger.review_basis.published_artifact);
const publishedBytes = await readFile(publishedPath).catch(() => null);
const published = publishedBytes ? JSON.parse(publishedBytes) : null;
if (!published) failures.push(`missing or invalid published dossier artifact: ${ledger.review_basis.published_artifact}`);
if (publishedBytes && ledger.review_basis.published_artifact_sha256) {
  const publishedSha = createHash('sha256').update(publishedBytes).digest('hex');
  if (publishedSha !== ledger.review_basis.published_artifact_sha256) failures.push(`published dossier artifact hash mismatch (${publishedSha})`);
}
const dossiersByRecordId = new Map((published?.dossiers || []).map(dossier => [dossier.record?.record_id, dossier]));
if (dossiersByRecordId.size !== (published?.dossiers || []).length) failures.push('published dossier artifact contains duplicate or missing record IDs');
if (ledger.records.length < 12 || ledger.records.length > 20) failures.push(`selected record count ${ledger.records.length} is outside 12–20`);
for (const record of ledger.records) {
  const image = await readFile(resolve(root, record.image.path)).catch(() => null);
  if (!image) { failures.push(`${record.numeric_id}: missing ${record.image.path}`); continue; }
  const sha = createHash('sha256').update(image).digest('hex');
  if (sha !== record.image.sha256) failures.push(`${record.numeric_id}: image hash mismatch (${sha})`);
  for (const field of ['canonical_record_id', 'direction', 'public_claim_boundary']) if (!record[field]) failures.push(`${record.numeric_id}: missing ${field}`);
  if (record.review.disposition !== 'accepted') failures.push(`${record.numeric_id}: disposition is not accepted`);
  if (record.rights.license !== 'CC BY 4.0' || !record.rights.commercial_use_allowed_by_captured_authority) failures.push(`${record.numeric_id}: incomplete rights authority`);
  if (!record.archive_metadata.source_url) failures.push(`${record.numeric_id}: missing source URL`);
  const dossier = dossiersByRecordId.get(record.canonical_record_id);
  if (!dossier) {
    failures.push(`${record.numeric_id}: no matching published dossier for ${record.canonical_record_id}`);
  } else {
    const dossierRights = dossier.rights || {};
    const expectedLicense = dossierRights.license_id === 'cc-by-4.0' ? 'CC BY 4.0' : dossierRights.license_id;
    if (dossier.record.numeric_id !== record.numeric_id) failures.push(`${record.numeric_id}: published dossier numeric ID join mismatch`);
    if (dossier.state !== 'published_independently_verified' || dossier.fully_verified !== true) failures.push(`${record.numeric_id}: published dossier is not fully independently verified`);
    if (dossierRights.complete !== true) failures.push(`${record.numeric_id}: published dossier rights are not complete`);
    if (record.rights.license !== expectedLicense) failures.push(`${record.numeric_id}: ledger license does not match published dossier (${dossierRights.license_id})`);
    if (record.rights.attribution_line !== dossierRights.attribution) failures.push(`${record.numeric_id}: ledger attribution does not match published dossier (${dossierRights.attribution})`);
    if (record.rights.commercial_use_allowed_by_captured_authority !== dossierRights.commercial_use_allowed) failures.push(`${record.numeric_id}: ledger commercial-use flag does not match published dossier`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`City Memory Study 001 valid: ${ledger.records.length} records, image hashes and rights/claim fields verified.`);
