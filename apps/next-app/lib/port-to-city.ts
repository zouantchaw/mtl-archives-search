import evidenceCoreJson from '@/content/port-to-city/evidence-core.v1.json';
import portToCityJson from '@/content/port-to-city/cuts/port-to-city.v1.json';
import oldPortJson from '@/content/port-to-city/cuts/old-port.v1.json';
import sdcJson from '@/content/port-to-city/cuts/sdc-vieux-montreal.v1.json';

export type EvidenceRecord = (typeof evidenceCoreJson.records)[number];
export type EvidenceFamily = (typeof evidenceCoreJson.families)[number];
export type RecipientCut = typeof portToCityJson;
export type RecipientCutId = 'port-to-city' | 'old-port' | 'sdc-vieux-montreal';

const cuts: Record<RecipientCutId, RecipientCut> = {
  'port-to-city': portToCityJson,
  'old-port': oldPortJson,
  'sdc-vieux-montreal': sdcJson,
};

function validateEvidencePackage() {
  if (evidenceCoreJson.schemaVersion !== 'port_to_city_evidence_core_v1') {
    throw new Error('Unsupported Port-to-City evidence schema.');
  }

  const recordIds = new Set<string>();
  for (const record of evidenceCoreJson.records) {
    if (recordIds.has(record.id)) throw new Error(`Duplicate evidence record: ${record.id}`);
    if (record.reviewStatus !== 'reviewed_for_internal_concept') {
      throw new Error(`Unreviewed record cannot render: ${record.id}`);
    }
    if (!record.archiveReported.sourceUrl.startsWith('https://')) {
      throw new Error(`Evidence source must use HTTPS: ${record.id}`);
    }
    if (!record.observed || !record.unresolved || !record.image.sha256) {
      throw new Error(`Incomplete claim boundary: ${record.id}`);
    }
    recordIds.add(record.id);
  }

  for (const cut of Object.values(cuts)) {
    for (const chapter of cut.chapters) {
      for (const recordId of chapter.recordIds) {
        if (!recordIds.has(recordId)) {
          throw new Error(`Unknown record ${recordId} in ${cut.id}.`);
        }
      }
    }
  }
}

validateEvidencePackage();

export const evidenceCore = evidenceCoreJson;
export const recipientCuts = cuts;

export function getPortToCityExperience(cutId: RecipientCutId) {
  const cut = cuts[cutId];
  const recordById = new Map(evidenceCore.records.map((record) => [record.id, record]));

  return {
    core: evidenceCore,
    cut,
    chapters: cut.chapters.map((chapter) => ({
      ...chapter,
      records: chapter.recordIds.map((recordId) => {
        const record = recordById.get(recordId);
        if (!record) throw new Error(`Missing reviewed record: ${recordId}`);
        return record;
      }),
    })),
  };
}

export function isRecipientCut(value: string): value is Exclude<RecipientCutId, 'port-to-city'> {
  return value === 'old-port' || value === 'sdc-vieux-montreal';
}
