import {
  ALIAS_GROUP_REASON,
  RIGHTS_LICENSE_ID,
  RIGHTS_NOTES,
  cleanText,
  deriveSourceDataset,
  parseMetadataIdentity,
  sha256,
  sortedUnique,
  type LocalInventoryRow,
  type R2InventoryRow,
  type R2SampleRow,
} from './model.js';

export type RawD1Row = Record<string, unknown> & {
  metadata_filename: string;
  image_filename: string;
  resolved_image_filename?: string | null;
  external_url?: string | null;
  credits?: string | null;
  cote?: string | null;
  name?: string | null;
  description?: string | null;
  created_at?: string | null;
};

export type RawVectorRow = {
  id: string;
  normalized_identity: string | null;
  valid_identity: boolean;
};

export type RawSystems = {
  local: boolean;
  d1: boolean;
  r2: boolean;
  text_vector: boolean;
  clip_vector: boolean;
};

export type RawRecordProvenance = {
  identity: string;
  numeric_id: number;
  source_identity: string | null;
  source_urls: string[];
  source_datasets: string[];
  source_record_ids: string[];
  name: string;
  description: string;
  cote: string;
  rights: {
    license_id: string;
    attribution: string;
    notes: string;
    complete: boolean;
  };
  systems: RawSystems;
  expected_key: string;
  observed_r2_keys: string[];
  sampled_content_type: string | null;
  sampled_magic_kind: string | null;
  sampled_etag: string | null;
  sampled_size_bytes: number | null;
  media_type: 'archive_image' | 'document';
  d1_created_at: string | null;
};

export type RawSourceGroup = {
  group_id: string;
  source_identity: string;
  members: string[];
  d1_members: string[];
  canonical_identity: string | null;
  reason: string;
};

export type RawAliasRelation = {
  alias_identity: string;
  canonical_identity: string;
  source_identity: string;
  group_id: string;
  reason: string;
  group_members: string[];
  payload_etag_match: boolean | null;
};

export type RawProvenanceModel = {
  records: Map<string, RawRecordProvenance>;
  groups: Map<string, RawSourceGroup>;
  aliases: Map<string, RawAliasRelation>;
  ambiguous_identities: Set<string>;
  canonical_targets: Set<string>;
  source_group_count: number;
  alias_count: number;
  ambiguous_group_count: number;
};

function normalizeSourceUrl(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return text;
  }
}

export function deriveRawProvenance(args: {
  local: LocalInventoryRow[];
  d1: RawD1Row[];
  r2: R2InventoryRow[];
  r2Samples: R2SampleRow[];
  text: RawVectorRow[];
  clip: RawVectorRow[];
}): RawProvenanceModel {
  const localById = new Map(args.local.map((row) => [row.identity, row]));
  const d1ById = new Map<string, RawD1Row>();
  for (const row of args.d1) {
    const parsed = parseMetadataIdentity(row.metadata_filename);
    if (!parsed) throw new Error(`Raw D1 provenance has invalid identity: ${row.metadata_filename}`);
    if (d1ById.has(parsed.identity)) throw new Error(`Raw D1 provenance has duplicate identity: ${parsed.identity}`);
    d1ById.set(parsed.identity, row);
  }
  if (localById.size !== args.local.length) throw new Error('Raw local provenance has duplicate identities');

  const r2ById = new Map<string, R2InventoryRow[]>();
  for (const object of args.r2) {
    if (!object.normalized_identity) continue;
    const group = r2ById.get(object.normalized_identity) ?? [];
    group.push(object);
    r2ById.set(object.normalized_identity, group);
  }
  const textIds = new Set(args.text.filter((row) => row.valid_identity).map((row) => row.normalized_identity!));
  const clipIds = new Set(args.clip.filter((row) => row.valid_identity).map((row) => row.normalized_identity!));
  const sampleByKey = new Map(args.r2Samples.map((row) => [row.key, row]));
  const identities = sortedUnique([
    ...localById.keys(),
    ...d1ById.keys(),
    ...r2ById.keys(),
    ...textIds,
    ...clipIds,
  ]);

  const records = new Map<string, RawRecordProvenance>();
  for (const identity of identities) {
    const parsed = parseMetadataIdentity(identity);
    if (!parsed) throw new Error(`Raw record provenance has invalid identity: ${identity}`);
    const local = localById.get(identity);
    const d1 = d1ById.get(identity);
    const sourceUrls = sortedUnique([
      ...(local?.source_urls ?? []),
      local?.primary_source_url,
      cleanText(d1?.external_url),
    ].map(normalizeSourceUrl));
    const sourceIdentity = normalizeSourceUrl(local?.primary_source_url || d1?.external_url);
    const sourceDatasets = local?.source_datasets.length
      ? sortedUnique(local.source_datasets)
      : sortedUnique(d1 && cleanText(d1.external_url) ? [deriveSourceDataset(cleanText(d1.external_url))] : []);
    const sourceRecordIds = sortedUnique(local?.source_record_ids ?? []);
    const attribution = cleanText(local?.attribution) || cleanText(d1?.credits);
    const rightsComplete = sourceUrls.length > 0 && attribution.length > 0;
    const r2Objects = [...(r2ById.get(identity) ?? [])].sort((a, b) => a.key.localeCompare(b.key));
    const samples = r2Objects
      .map((object) => sampleByKey.get(object.key))
      .filter((sample): sample is R2SampleRow => Boolean(sample));
    const primarySample = samples.find((sample) => sample.magic_kind === 'pdf') ?? samples[0];
    const expectedKey = local?.resolved_image_filename || local?.image_filename
      || cleanText(d1?.resolved_image_filename) || cleanText(d1?.image_filename)
      || `mtl_archives_image_${parsed.numericId}.jpg`;
    records.set(identity, {
      identity,
      numeric_id: parsed.numericId,
      source_identity: sourceIdentity,
      source_urls: sourceUrls,
      source_datasets: sourceDatasets,
      source_record_ids: sourceRecordIds,
      name: cleanText(local?.name) || cleanText(d1?.name),
      description: cleanText(local?.description) || cleanText(d1?.description),
      cote: cleanText(local?.cote) || cleanText(d1?.cote),
      rights: {
        license_id: RIGHTS_LICENSE_ID,
        attribution,
        notes: RIGHTS_NOTES,
        complete: rightsComplete,
      },
      systems: {
        local: Boolean(local),
        d1: Boolean(d1),
        r2: r2Objects.length > 0,
        text_vector: textIds.has(identity),
        clip_vector: clipIds.has(identity),
      },
      expected_key: expectedKey,
      observed_r2_keys: r2Objects.map((object) => object.key),
      sampled_content_type: primarySample?.content_type ?? null,
      sampled_magic_kind: primarySample?.magic_kind ?? null,
      sampled_etag: primarySample?.etag ?? r2Objects[0]?.etag ?? null,
      sampled_size_bytes: primarySample?.content_length ?? r2Objects[0]?.size_bytes ?? null,
      media_type: sourceUrls.some((url) => /\.pdf(?:$|[?#])/i.test(url)) || primarySample?.magic_kind === 'pdf'
        ? 'document'
        : 'archive_image',
      d1_created_at: d1 ? cleanText(d1.created_at) || null : null,
    });
  }

  const groupedMembers = new Map<string, string[]>();
  for (const identity of sortedUnique([...localById.keys(), ...d1ById.keys()])) {
    const source = records.get(identity)?.source_identity;
    if (!source) continue;
    const members = groupedMembers.get(source) ?? [];
    members.push(identity);
    groupedMembers.set(source, members);
  }

  const groups = new Map<string, RawSourceGroup>();
  const aliases = new Map<string, RawAliasRelation>();
  const ambiguousIdentities = new Set<string>();
  const canonicalTargets = new Set<string>();
  let ambiguousGroupCount = 0;
  for (const [source, unsortedMembers] of [...groupedMembers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const members = [...unsortedMembers].sort((a, b) => a.localeCompare(b));
    const d1Members = members.filter((identity) => d1ById.has(identity));
    const canonicalIdentity = d1Members.length === 1 ? d1Members[0] : null;
    const group: RawSourceGroup = {
      group_id: `source-group:${sha256(source)}`,
      source_identity: source,
      members,
      d1_members: d1Members,
      canonical_identity: canonicalIdentity,
      reason: ALIAS_GROUP_REASON,
    };
    groups.set(source, group);
    if (members.length < 2) continue;
    if (!canonicalIdentity) {
      ambiguousGroupCount += 1;
      for (const identity of members) ambiguousIdentities.add(identity);
      continue;
    }
    canonicalTargets.add(canonicalIdentity);
    const canonicalEtags = (r2ById.get(canonicalIdentity) ?? []).map((row) => row.etag).filter(Boolean);
    for (const identity of members) {
      if (identity === canonicalIdentity) continue;
      const aliasEtags = (r2ById.get(identity) ?? []).map((row) => row.etag).filter(Boolean);
      const etagMatch = aliasEtags.length && canonicalEtags.length
        ? aliasEtags.some((etag) => canonicalEtags.includes(etag))
        : null;
      aliases.set(identity, {
        alias_identity: identity,
        canonical_identity: canonicalIdentity,
        source_identity: source,
        group_id: group.group_id,
        reason: group.reason,
        group_members: members,
        payload_etag_match: etagMatch,
      });
    }
  }

  return {
    records,
    groups,
    aliases,
    ambiguous_identities: ambiguousIdentities,
    canonical_targets: canonicalTargets,
    source_group_count: groups.size,
    alias_count: aliases.size,
    ambiguous_group_count: ambiguousGroupCount,
  };
}
