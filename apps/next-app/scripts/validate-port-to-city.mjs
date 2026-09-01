import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = join(appRoot, 'content', 'port-to-city');
const core = JSON.parse(await readFile(join(contentRoot, 'evidence-core.v1.json'), 'utf8'));
const cutFiles = ['port-to-city.v1.json', 'old-port.v1.json', 'sdc-vieux-montreal.v1.json'];
const cuts = await Promise.all(cutFiles.map(async (file) => JSON.parse(await readFile(join(contentRoot, 'cuts', file), 'utf8'))));

const failures = [];
const ids = new Set();
const familyIds = new Set(core.families.map((family) => family.id));

if (core.schemaVersion !== 'port_to_city_evidence_core_v1') failures.push('Unexpected schema version.');
if (core.releaseStatus !== 'internal_review') failures.push('Release status must remain internal_review until the release gate is approved.');
if (core.records.length !== 10) failures.push(`Expected 10 reviewed records, found ${core.records.length}.`);

for (const record of core.records) {
  if (ids.has(record.id)) failures.push(`Duplicate canonical ID: ${record.id}`);
  ids.add(record.id);

  if (!familyIds.has(record.familyId)) failures.push(`Unknown family ${record.familyId} on ${record.id}.`);
  if (record.reviewStatus !== 'reviewed_for_internal_concept') failures.push(`Unapproved record: ${record.id}`);
  if (!record.observed || !record.unresolved) failures.push(`Missing claim boundary: ${record.id}`);
  if (!record.archiveReported.sourceUrl.startsWith('https://')) failures.push(`Non-HTTPS source: ${record.id}`);
  if (!record.archiveReported.title || !record.archiveReported.date) failures.push(`Incomplete archive report: ${record.id}`);
  if (!record.alt) failures.push(`Missing visible-evidence alt text: ${record.id}`);

  const publicAsset = join(appRoot, 'public', record.image.src.replace(/^\//, ''));
  const bytes = await readFile(publicAsset);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== record.image.sha256) failures.push(`Derivative hash mismatch: ${record.id}`);
}

for (const cut of cuts) {
  const referenced = new Set();
  for (const chapter of cut.chapters) {
    for (const recordId of chapter.recordIds) {
      if (!ids.has(recordId)) failures.push(`Unknown ${recordId} in ${cut.id}.`);
      if (referenced.has(recordId)) failures.push(`Duplicate ${recordId} within ${cut.id}.`);
      referenced.add(recordId);
    }
  }
  if (referenced.size !== ids.size) failures.push(`${cut.id} does not use all reviewed records.`);
  if (!cut.nextStep || cut.activations.length !== 3) failures.push(`Incomplete activation framing in ${cut.id}.`);
}

if (failures.length) {
  console.error(JSON.stringify({ status: 'failed', failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  artifactId: core.artifactId,
  releaseStatus: core.releaseStatus,
  records: core.records.length,
  families: core.families.length,
  cuts: cuts.length,
  derivativesVerified: core.records.length,
}, null, 2));
