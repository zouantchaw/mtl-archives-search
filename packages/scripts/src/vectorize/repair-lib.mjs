import crypto from 'node:crypto';

export const textVersion = 'canonical-metadata-caption-v1';
export function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export function imageIdentity(record) {
  // Preserve path case: URL paths may be case-sensitive. Ignore query/fragment only.
  if (!record.external_url) return null;
  try { const url = new URL(record.external_url); url.search = ''; url.hash = ''; return url.href; }
  catch { return null; }
}
export function buildSearchText(record) {
  const fields = [record.name, record.description, record.portal_title, record.portal_description,
    record.date_value, record.portal_date, record.cote, record.portal_cote];
  const archival = [...new Set(fields.map(x => String(x ?? '').trim()).filter(Boolean))].join('\n');
  return [archival && `Archival metadata:\n${archival}`, record.vlm_caption && `Image description (AI-generated):\n${record.vlm_caption}`]
    .filter(Boolean).join('\n\n') || record.metadata_filename;
}
export function reconcile(canonical, deduped, captioned) {
  const originals = new Map(captioned.map(r => [r.metadata_filename, r]));
  const groups = new Map(deduped.map(r => [r.metadata_filename, r]));
  const aliases = {}, conflicts = [], rejected = [], rows = [];
  for (const row of canonical) {
    const ids = [...new Set([row.metadata_filename, ...(groups.get(row.metadata_filename)?.dedupe_metadata_filenames ?? [])])];
    const verified = ids.filter(id => {
      const old = originals.get(id);
      const sameFile = old && (old.resolved_image_filename || old.image_filename) === (row.resolved_image_filename || row.image_filename);
      const sameSource = old && imageIdentity(old) && imageIdentity(old) === imageIdentity(row);
      if (id === row.metadata_filename && !old) return true;
      if (sameFile || sameSource) return true;
      rejected.push({ canonicalId: row.metadata_filename, alias: id, reason: 'image identity mismatch or unavailable' });
      return false;
    });
    for (const id of verified) {
      if (aliases[id] && aliases[id] !== row.metadata_filename) throw new Error(`Ambiguous alias ${id}`);
      aliases[id] = row.metadata_filename;
    }
    const candidates = verified.map(id => originals.get(id)).filter(r => r?.vlm_caption?.trim());
    const captions = [...new Set(candidates.map(r => r.vlm_caption.trim()))];
    const direct = candidates.find(r => r.metadata_filename === row.metadata_filename);
    // A direct caption is tied to the actual serving record. Never pick a conflicting alias arbitrarily.
    const selected = direct || (captions.length === 1 ? candidates[0] : null);
    if (captions.length > 1) conflicts.push({ canonicalId: row.metadata_filename, sources: candidates.map(r => r.metadata_filename), selected: selected?.metadata_filename ?? null });
    const caption = row.vlm_caption || selected?.vlm_caption?.trim() || null;
    rows.push({ ...row, vlm_caption: caption,
      caption_source: row.vlm_caption ? 'existing-serving-record' : selected ? `manifest_vlm_complete.jsonl#${selected.metadata_filename}` : null,
      // Legacy manifest does not record a model per row; do not invent provenance from a script default.
      caption_model: selected?.vlm_model || selected?.caption_model || null,
      caption_status: caption ? (captions.length > 1 ? 'unreviewed_conflict' : 'unreviewed') : 'missing',
      verified_aliases: verified,
    });
  }
  return { rows, aliases, conflicts, rejected };
}
