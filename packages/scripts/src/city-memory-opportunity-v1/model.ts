import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** The default vocabulary is deliberately conservative. Terms are only a
 * place signal; they are not a claim that an image depicts the place. */
export const DEFAULT_VOCABULARY: PlaceVocabulary = {
  old_port: [
    'old port', 'old-port', 'vieux port', 'vieux-port', 'port de montreal',
    'port de montréal', 'king edward quay', 'quai king edward',
    'jacques cartier quay', 'quai jacques cartier', 'clock tower quay',
    'quai de l horloge', "quai de l'horloge", 'clock tower', 'tour de l horloge',
    'quai de bonsecours', 'bonsecours quay', 'rue de la commune', 'quai alexandra',
  ],
  old_montreal: [
    'old montreal', 'old-montreal', 'vieux montreal', 'vieux-montréal',
    'vieux-montreal', 'place jacques cartier', 'marché bonsecours',
    'marche bonsecours', 'rue saint paul', 'rue saint-paul', 'square d youville',
    'square d youville', 'champ de mars', 'bonsecours', 'notre dame est',
  ],
};

export type PlaceVocabulary = Record<'old_port' | 'old_montreal', string[]>;
export type GrainName = 'canonical_scored' | 'vlm' | 'taxonomy' | 'geocode' | 'ocr' | 'date' | 'aerial' | 'visual_family';

export type GenericRow = Record<string, unknown>;

export type InputPaths = Partial<Record<GrainName, string>> & { dataRoot: string };

export type JoinStatus = 'matched' | 'missing' | 'ambiguous';

export type JoinReceipt = {
  status: JoinStatus;
  method: 'metadata_filename' | 'record_id' | 'source_record_id' | 'cote' | 'image_filename' | 'source_url' | null;
  alias: string | null;
  candidates: number;
};

export type PlaceEvidence = {
  place: keyof PlaceVocabulary;
  term: string;
  field: string;
  evidence_class: 'exact_source_supported' | 'model_inferred';
};

export type OpportunityCrosswalkRow = {
  schema_version: 'city_memory_opportunity_crosswalk_v1';
  identity: {
    record_id: string;
    numeric_id: number | null;
    source_record_id: string | null;
    metadata_filename: string | null;
    cote: string | null;
    image_filename: string | null;
  };
  corpus_grain: {
    canonical_scored: 'canonical_scored';
    vlm: 'vlm' | null;
    taxonomy: 'taxonomy' | null;
    geocode: 'geocode' | null;
    ocr: 'ocr' | null;
    date: 'date' | null;
    aerial: 'aerial' | null;
    visual_family: 'visual_family' | null;
  };
  source: {
    title: string | null;
    description: string | null;
    date: string | null;
    date_period: string | null;
    credits: string | null;
    cote: string | null;
    original_url: string | null;
  };
  geocode: { latitude: number | null; longitude: number | null; place_name: string | null; confidence: number | null; source: string | null };
  ocr: { text: string | null; confidence: number | null; entities: string[]; reviewed: boolean; error: string | null };
  aerial: { datasets: string[]; matches: unknown[] };
  visual: { family_id: string | null; family_type: string | null; component_id: string | null };
  taxonomy: { primary_category: string | null; confidence: number | null; vantage: string | null; media_type: string | null; themes: string[]; search_facets: string[]; review_required: boolean | null };
  vlm: { caption: string | null; scene_type: string | null; setting: string | null; subjects: string[]; valid: boolean | null; error: string | null };
  scores: { score: number | null; trust: number | null; clip: number | null; semantic: number | null; quality_labels: string[] };
  joins: Record<GrainName, JoinReceipt>;
  place_signals: { exact_source_supported: PlaceEvidence[]; model_inferred: PlaceEvidence[]; places: string[] };
};

export type CandidatePoolRow = OpportunityCrosswalkRow & {
  candidate: {
    rank: number;
    score: number;
    lane: 'old_port' | 'old_montreal' | 'both' | 'thematic';
    reasons: string[];
    diversity: { family_id: string | null; period: string | null };
  };
};

export type GrainSummary = {
  path: string | null;
  rows: number;
  unique_identities: number;
  matched: number;
  missing: number;
  ambiguous: number;
};

export type OpportunityBuildResult = {
  crosswalk: OpportunityCrosswalkRow[];
  candidates: CandidatePoolRow[];
  summary: {
    schema_version: 'city_memory_opportunity_run_v1';
    generated_at: string;
    data_root: string;
    vocabulary: PlaceVocabulary;
    grains: Record<GrainName, GrainSummary>;
    crosswalk_rows: number;
    place_signal_rows: number;
    candidate_rows: number;
    limits: { max_crosswalk_rows: number | null; max_candidates: number };
    gaps: string[];
  };
};

export function clean(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
}

export function normalized(value: unknown): string {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function first(row: GenericRow | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && clean(value) !== '') return value;
  }
  return undefined;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => typeof entry === 'string' ? [clean(entry)] : []).filter(Boolean);
  const text = clean(value);
  if (!text) return [];
  try { const parsed = JSON.parse(text) as unknown; return Array.isArray(parsed) ? asStringArray(parsed) : [text]; } catch { return [text]; }
}

export function nested(row: GenericRow | undefined, key: string): GenericRow | undefined {
  const value = row?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as GenericRow : undefined;
}

export function firstNumber(row: GenericRow | undefined, keys: string[]): number | null {
  const value = first(row, keys);
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readJsonLines(filePath: string): GenericRow[] {
  if (!fs.existsSync(filePath)) return [];
  const bytes = fs.readFileSync(filePath);
  const text = filePath.endsWith('.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (filePath.endsWith('.json') && !filePath.endsWith('.jsonl')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((row): row is GenericRow => Boolean(row && typeof row === 'object'));
    if (parsed && typeof parsed === 'object') {
      const rows = (parsed as GenericRow).rows;
      if (Array.isArray(rows)) return rows.filter((row): row is GenericRow => Boolean(row && typeof row === 'object'));
    }
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { const parsed = JSON.parse(line) as unknown; return parsed && typeof parsed === 'object' ? parsed as GenericRow : {}; }
    catch (error) { throw new Error(`${filePath}:${index + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); }
  });
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

export function csvEscape(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : clean(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(filePath: string, rows: Record<string, unknown>[], columns: string[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const output = [columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n') + '\n';
  fs.writeFileSync(filePath, output, 'utf8');
}
