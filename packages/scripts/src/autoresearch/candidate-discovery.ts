import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates',
);
const DEFAULT_EMBEDDINGS_URL = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings/embeddings_2d.json';

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  description?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  image_exists?: boolean;
  image_size_bytes?: number;
  vlm_caption?: string | null;
  vlm_error?: string | null;
  vlm_metadata_valid?: boolean;
  vlm_metadata_error?: string | null;
  vlm_metadata?: {
    caption?: string;
    scene_type?: string;
    visual_subjects?: string[];
    setting?: string;
    season?: string;
    aerial_ground_document?: string;
    search_terms?: string[];
    social_hook?: string;
    print_quality?: string;
    quality_notes?: string;
  } | null;
};

type EmbeddingPoint = {
  id: string;
  x: number;
  y: number;
  name?: string;
  date?: string;
  image_url?: string;
};

type EnrichedRecord = {
  record: ArchiveRecord;
  id: string;
  imageUrl: string;
  imagePath: string;
  title: string;
  date: string;
  cote: string;
  embedding?: EmbeddingPoint;
  sequence: SequenceRef | null;
  rareTokenScore: number;
  rareTokens: string[];
  outlierScore: number;
  rarityScore: number;
  socialScore: number;
  printScore: number;
  combinedCandidateScore: number;
};

type SequenceRef = {
  flight: string;
  frame: number;
  raw: string;
  pattern: string;
};

type Candidate = {
  rank: number;
  id: string;
  title: string;
  date: string;
  cote: string;
  imageUrl: string;
  imagePath: string;
  score: number;
  reasons: string[];
  vlmCaption: string | null;
  socialHook: string | null;
  metadata: ArchiveRecord['vlm_metadata'] | null | undefined;
};

type SequenceCandidate = {
  rank: number;
  sequenceId: string;
  flight: string;
  frameStart: number;
  frameEnd: number;
  length: number;
  avgEmbeddingDistance: number;
  score: number;
  dominantSceneTypes: Record<string, number>;
  representativeSubjects: string[];
  records: Candidate[];
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl(filePath: string): ArchiveRecord[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ArchiveRecord;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function readEmbeddings(source: string): Promise<EmbeddingPoint[]> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Embedding fetch failed: ${response.status} ${response.statusText}`);
    return await response.json() as EmbeddingPoint[];
  }
  return JSON.parse(fs.readFileSync(resolveRepoPath(source), 'utf-8')) as EmbeddingPoint[];
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function percentileRank(sortedAscending: number[], value: number): number {
  if (!sortedAscending.length) return 0;
  let low = 0;
  let high = sortedAscending.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedAscending[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low / sortedAscending.length;
}

function distance(a: EmbeddingPoint, b: EmbeddingPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function dateValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Date);
}

function coteValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Cote);
}

function imagePath(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function imageUrl(record: ArchiveRecord, embedding?: EmbeddingPoint): string {
  return cleanText(embedding?.image_url) || cleanText(record.external_url);
}

function titleValue(record: ArchiveRecord): string {
  return cleanText(record.name || record.metadata_filename || record.image_filename);
}

function termsForRecord(record: ArchiveRecord): string[] {
  const metadata = record.vlm_metadata;
  const rawTerms = [
    metadata?.scene_type,
    metadata?.setting,
    metadata?.season,
    metadata?.aerial_ground_document,
    metadata?.print_quality,
    ...(metadata?.visual_subjects ?? []),
    ...(metadata?.search_terms ?? []),
  ];
  return Array.from(new Set(rawTerms.map(normalize).filter((term) => term && term !== 'unknown')));
}

function countTerms(records: ArchiveRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const term of termsForRecord(record)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return counts;
}

function parseSequence(name: string): SequenceRef | null {
  const vm97 = name.match(/VM97-3_([0-9A-Z]+)-(\d+)/i);
  if (vm97) {
    return {
      flight: vm97[1].toUpperCase(),
      frame: Number.parseInt(vm97[2], 10),
      raw: name,
      pattern: 'vm97-3',
    };
  }

  const vm97Series = name.match(/VM97,S(\d+),D(\d+),P(\d+)/i);
  if (vm97Series) {
    return {
      flight: `S${vm97Series[1]}D${vm97Series[2]}`,
      frame: Number.parseInt(vm97Series[3], 10),
      raw: name,
      pattern: 'vm97-series',
    };
  }

  return null;
}

function nearestNeighborScores(points: EmbeddingPoint[], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (let i = 0; i < points.length; i += 1) {
    const distances: number[] = [];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      distances.push(distance(points[i], points[j]));
    }
    distances.sort((a, b) => a - b);
    const nearest = distances.slice(0, k);
    const average = nearest.reduce((sum, value) => sum + value, 0) / Math.max(1, nearest.length);
    const isolation = nearest[0] ?? 0;
    scores.set(points[i].id, average * 0.75 + isolation * 0.25);
  }
  return scores;
}

function printQualityScore(value: string | undefined): number {
  const normalized = normalize(value);
  if (normalized === 'excellent') return 1;
  if (normalized === 'good') return 0.75;
  if (normalized === 'fair') return 0.45;
  if (normalized === 'poor') return 0.05;
  return 0.35;
}

function scoreSocial(record: ArchiveRecord, rarityScore: number): number {
  const metadata = record.vlm_metadata;
  const hook = cleanText(metadata?.social_hook);
  const caption = cleanText(record.vlm_caption || metadata?.caption);
  const subjects = metadata?.visual_subjects ?? [];
  const searchTerms = metadata?.search_terms ?? [];
  const hasError = Boolean(record.vlm_error || record.vlm_metadata_error);

  let score = 0;
  score += hook.length >= 80 ? 0.25 : hook.length >= 30 ? 0.15 : 0;
  score += caption.length >= 45 ? 0.18 : caption.length >= 20 ? 0.1 : 0;
  score += Math.min(0.18, subjects.length * 0.04);
  score += Math.min(0.12, searchTerms.length * 0.03);
  score += printQualityScore(metadata?.print_quality) * 0.12;
  score += rarityScore * 0.15;
  score += record.image_exists === false ? 0 : 0.1;
  if (hasError) score -= 0.3;
  return clamp01(score);
}

function scorePrint(record: ArchiveRecord, rarityScore: number): number {
  const metadata = record.vlm_metadata;
  const hasError = Boolean(record.vlm_error || record.vlm_metadata_error);
  const bytes = Number(record.image_size_bytes || 0);
  let score = 0;
  score += printQualityScore(metadata?.print_quality) * 0.45;
  score += bytes > 15_000_000 ? 0.2 : bytes > 5_000_000 ? 0.12 : bytes > 1_000_000 ? 0.05 : 0;
  score += cleanText(record.external_url).toLowerCase().endsWith('.tif') ? 0.1 : 0;
  score += rarityScore * 0.15;
  score += metadata?.scene_type === 'map_or_document' ? -0.15 : 0;
  score += record.image_exists === false ? -0.2 : 0.05;
  if (hasError) score -= 0.25;
  return clamp01(score);
}

function candidateFromRecord(row: EnrichedRecord, rank: number, score: number, reasons: string[]): Candidate {
  return {
    rank,
    id: row.id,
    title: row.title,
    date: row.date,
    cote: row.cote,
    imageUrl: row.imageUrl,
    imagePath: row.imagePath,
    score: Number(score.toFixed(4)),
    reasons,
    vlmCaption: row.record.vlm_caption ?? row.record.vlm_metadata?.caption ?? null,
    socialHook: row.record.vlm_metadata?.social_hook ?? null,
    metadata: row.record.vlm_metadata,
  };
}

function diversityKey(row: EnrichedRecord): string {
  const title = normalize(row.title);
  if (title && !title.startsWith('mtl archives metadata')) return `${title}|${row.date}`;
  return row.sequence?.flight ?? normalize(row.record.vlm_metadata?.scene_type) ?? row.id;
}

function selectDiverse(
  rows: EnrichedRecord[],
  limit: number,
  keyFn: (row: EnrichedRecord) => string,
  maxPerKey: number,
): EnrichedRecord[] {
  const selected: EnrichedRecord[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row) || row.id;
    const count = counts.get(key) ?? 0;
    if (count >= maxPerKey) continue;
    selected.push(row);
    counts.set(key, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function topCounts(values: string[], limit: number): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values.map(normalize).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit));
}

function buildSequences(rows: EnrichedRecord[], limit: number): SequenceCandidate[] {
  const byFlight = new Map<string, EnrichedRecord[]>();
  for (const row of rows) {
    if (!row.sequence || !row.embedding) continue;
    const bucket = byFlight.get(row.sequence.flight) ?? [];
    bucket.push(row);
    byFlight.set(row.sequence.flight, bucket);
  }

  const candidates: SequenceCandidate[] = [];
  for (const [flight, flightRows] of byFlight.entries()) {
    const sorted = [...flightRows].sort((a, b) => (a.sequence?.frame ?? 0) - (b.sequence?.frame ?? 0));
    let current: EnrichedRecord[] = [];
    const flush = () => {
      if (current.length < 4) {
        current = [];
        return;
      }
      const distances: number[] = [];
      for (let i = 0; i < current.length - 1; i += 1) {
        const a = current[i].embedding;
        const b = current[i + 1].embedding;
        if (a && b) distances.push(distance(a, b));
      }
      const avgDistance = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
      const sceneTypes = topCounts(current.map((row) => row.record.vlm_metadata?.scene_type ?? ''), 5);
      const subjects = Object.keys(topCounts(current.flatMap((row) => row.record.vlm_metadata?.visual_subjects ?? []), 8));
      const score = current.length * 0.08 + clamp01(1 - avgDistance / 0.08) * 0.35 + Math.max(...current.map((row) => row.socialScore)) * 0.25;
      candidates.push({
        rank: 0,
        sequenceId: `${flight}:${current[0].sequence?.frame}-${current[current.length - 1].sequence?.frame}`,
        flight,
        frameStart: current[0].sequence?.frame ?? 0,
        frameEnd: current[current.length - 1].sequence?.frame ?? 0,
        length: current.length,
        avgEmbeddingDistance: Number(avgDistance.toFixed(5)),
        score: Number(score.toFixed(4)),
        dominantSceneTypes: sceneTypes,
        representativeSubjects: subjects,
        records: current.slice(0, 12).map((row, idx) => candidateFromRecord(row, idx + 1, row.combinedCandidateScore, [
          `frame ${row.sequence?.frame}`,
          `sequence ${flight}`,
        ])),
      });
      current = [];
    };

    for (const row of sorted) {
      const prev = current[current.length - 1];
      const frame = row.sequence?.frame ?? 0;
      const prevFrame = prev?.sequence?.frame ?? 0;
      const contiguous = !prev || (frame - prevFrame >= 1 && frame - prevFrame <= 3);
      if (!contiguous) flush();
      current.push(row);
    }
    flush();
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function renderMarkdown(report: any): string {
  const lines: string[] = [
    '# Autoresearch Candidate Discovery',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Input rows: ${report.summary.input_rows}`,
    `- Rows with 2D embeddings: ${report.summary.rows_with_embeddings}`,
    `- Rare find candidates: ${report.summary.rare_find_candidates}`,
    `- Sequence candidates: ${report.summary.sequence_candidates}`,
    `- Social candidates: ${report.summary.social_candidates}`,
    `- Print candidates: ${report.summary.print_candidates}`,
    '',
    '## Top Rare Finds',
    '',
  ];

  for (const candidate of report.rare_find_candidates.slice(0, 15)) {
    lines.push(`${candidate.rank}. ${candidate.title || candidate.id} (${candidate.date || 'unknown date'})`);
    lines.push(`   - Score: ${candidate.score}; reasons: ${candidate.reasons.join('; ')}`);
    lines.push(`   - ID: \`${candidate.id}\`; image: ${candidate.imageUrl}`);
  }

  lines.push('', '## Top Sequences', '');
  for (const sequence of report.sequence_candidates.slice(0, 10)) {
    lines.push(`${sequence.rank}. ${sequence.sequenceId} (${sequence.length} frames, avg distance ${sequence.avgEmbeddingDistance})`);
    lines.push(`   - Subjects: ${sequence.representativeSubjects.join(', ') || 'unknown'}`);
    lines.push(`   - First record: \`${sequence.records[0]?.id ?? 'n/a'}\`; image: ${sequence.records[0]?.imageUrl ?? 'n/a'}`);
  }

  lines.push('', '## Top Social Picks', '');
  for (const candidate of report.social_candidates.slice(0, 15)) {
    lines.push(`${candidate.rank}. ${candidate.title || candidate.id}`);
    lines.push(`   - Score: ${candidate.score}; reasons: ${candidate.reasons.join('; ')}`);
    if (candidate.socialHook) lines.push(`   - Hook: ${candidate.socialHook}`);
    lines.push(`   - ID: \`${candidate.id}\`; image: ${candidate.imageUrl}`);
  }

  lines.push('', '## Top Print Picks', '');
  for (const candidate of report.print_candidates.slice(0, 15)) {
    lines.push(`${candidate.rank}. ${candidate.title || candidate.id}`);
    lines.push(`   - Score: ${candidate.score}; reasons: ${candidate.reasons.join('; ')}`);
    lines.push(`   - ID: \`${candidate.id}\`; image: ${candidate.imageUrl}`);
  }

  lines.push('', '## Downstream Contract', '');
  lines.push('- `candidates.json` contains grouped candidates for review UI/reporting.');
  lines.push('- `candidates_downstream.jsonl` is one candidate per line with `candidate_type`, stable record ID, image URL/path, score, and reasons.');
  lines.push('- `social_candidates.jsonl` and `print_candidates.jsonl` can be consumed directly by social and print packaging jobs.');

  return `${lines.join('\n')}\n`;
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      embeddings: { type: 'string', default: DEFAULT_EMBEDDINGS_URL },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '100' },
      'sequence-limit': { type: 'string', default: '50' },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const limit = Number.parseInt(values.limit!, 10);
  const sequenceLimit = Number.parseInt(values['sequence-limit']!, 10);

  if (!fs.existsSync(inputPath)) throw new Error(`Missing input manifest: ${inputPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const records = readJsonl(inputPath);
  const embeddings = await readEmbeddings(values.embeddings!);
  const embeddingsById = new Map(embeddings.map((point) => [point.id, point]));
  const outlierById = nearestNeighborScores(embeddings, 15);
  const outlierValues = [...outlierById.values()].sort((a, b) => a - b);
  const termCounts = countTerms(records);

  const rows: EnrichedRecord[] = records.map((record) => {
    const id = cleanText(record.metadata_filename);
    const embedding = embeddingsById.get(id);
    const outlierRaw = embedding ? outlierById.get(id) ?? 0 : 0;
    const outlierScore = percentileRank(outlierValues, outlierRaw);
    const terms = termsForRecord(record);
    const rareTerms = terms
      .map((term) => ({ term, count: termCounts.get(term) ?? records.length }))
      .filter((entry) => entry.count <= Math.max(12, records.length * 0.012))
      .sort((a, b) => a.count - b.count)
      .slice(0, 6);
    const rareTokenScore = clamp01(rareTerms.reduce((sum, entry) => sum + (1 / Math.sqrt(entry.count)), 0) / 1.8);
    const rarityScore = clamp01(outlierScore * 0.65 + rareTokenScore * 0.35);
    const socialScore = scoreSocial(record, rarityScore);
    const printScore = scorePrint(record, rarityScore);
    return {
      record,
      id,
      imageUrl: imageUrl(record, embedding),
      imagePath: imagePath(record),
      title: titleValue(record),
      date: dateValue(record),
      cote: coteValue(record),
      embedding,
      sequence: parseSequence(titleValue(record)),
      rareTokenScore,
      rareTokens: rareTerms.map((entry) => `${entry.term} (${entry.count})`),
      outlierScore,
      rarityScore,
      socialScore,
      printScore,
      combinedCandidateScore: clamp01(rarityScore * 0.35 + socialScore * 0.35 + printScore * 0.3),
    };
  });

  const validRows = rows.filter((row) => row.id && row.imageUrl);
  const rareFindCandidates = selectDiverse(
    [...validRows].sort((a, b) => b.rarityScore - a.rarityScore),
    limit,
    diversityKey,
    1,
  )
    .map((row, index) => candidateFromRecord(row, index + 1, row.rarityScore, [
      `embedding isolation percentile ${(row.outlierScore * 100).toFixed(1)}`,
      row.rareTokens.length ? `rare VLM terms: ${row.rareTokens.join(', ')}` : 'visual embedding outlier',
    ]));

  const socialCandidates = selectDiverse(
    [...validRows]
      .filter((row) => row.socialScore >= 0.55)
      .sort((a, b) => (b.socialScore - a.socialScore) || (b.rarityScore - a.rarityScore)),
    limit,
    (row) => row.sequence?.flight ?? normalize(row.record.vlm_metadata?.scene_type) ?? diversityKey(row),
    6,
  )
    .map((row, index) => candidateFromRecord(row, index + 1, row.socialScore, [
      `social hook ${cleanText(row.record.vlm_metadata?.social_hook).length} chars`,
      `subjects ${(row.record.vlm_metadata?.visual_subjects ?? []).length}`,
      `print quality ${row.record.vlm_metadata?.print_quality ?? 'unknown'}`,
      `rarity ${(row.rarityScore * 100).toFixed(1)}`,
    ]));

  const printCandidates = selectDiverse(
    [...validRows]
      .filter((row) => row.printScore >= 0.55)
      .sort((a, b) => (b.printScore - a.printScore) || (b.rarityScore - a.rarityScore)),
    limit,
    (row) => row.sequence?.flight ?? diversityKey(row),
    6,
  )
    .map((row, index) => candidateFromRecord(row, index + 1, row.printScore, [
      `print quality ${row.record.vlm_metadata?.print_quality ?? 'unknown'}`,
      `image bytes ${row.record.image_size_bytes ?? 0}`,
      `source ${cleanText(row.record.external_url).toLowerCase().endsWith('.tif') ? 'tif' : 'web image'}`,
      `rarity ${(row.rarityScore * 100).toFixed(1)}`,
    ]));

  const sequenceCandidates = buildSequences(validRows, sequenceLimit);
  const downstreamRows = [
    ...rareFindCandidates.map((candidate) => ({ candidate_type: 'rare_find', ...candidate })),
    ...socialCandidates.map((candidate) => ({ candidate_type: 'social', ...candidate })),
    ...printCandidates.map((candidate) => ({ candidate_type: 'print', ...candidate })),
    ...sequenceCandidates.flatMap((sequence) => sequence.records.map((candidate) => ({
      candidate_type: 'sequence',
      sequence_id: sequence.sequenceId,
      sequence_rank: sequence.rank,
      ...candidate,
    }))),
  ];

  const report = {
    generated_at: new Date().toISOString(),
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, inputPath),
      embeddings: values.embeddings,
    },
    summary: {
      input_rows: records.length,
      rows_with_embeddings: rows.filter((row) => row.embedding).length,
      rows_with_sequence_ids: rows.filter((row) => row.sequence).length,
      rare_find_candidates: rareFindCandidates.length,
      sequence_candidates: sequenceCandidates.length,
      social_candidates: socialCandidates.length,
      print_candidates: printCandidates.length,
      downstream_rows: downstreamRows.length,
    },
    rare_find_candidates: rareFindCandidates,
    sequence_candidates: sequenceCandidates,
    social_candidates: socialCandidates,
    print_candidates: printCandidates,
    downstream_contract: {
      file: 'candidates_downstream.jsonl',
      key_fields: ['candidate_type', 'id', 'imageUrl', 'imagePath', 'score', 'reasons'],
      intended_consumers: ['social packaging', 'print review', 'search/story collection review'],
    },
  };

  fs.writeFileSync(path.join(outputDir, 'candidates.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'candidates.md'), renderMarkdown(report));
  writeJsonl(path.join(outputDir, 'rare_find_candidates.jsonl'), rareFindCandidates);
  writeJsonl(path.join(outputDir, 'sequence_candidates.jsonl'), sequenceCandidates);
  writeJsonl(path.join(outputDir, 'social_candidates.jsonl'), socialCandidates);
  writeJsonl(path.join(outputDir, 'print_candidates.jsonl'), printCandidates);
  writeJsonl(path.join(outputDir, 'candidates_downstream.jsonl'), downstreamRows);

  console.log(`[autoresearch:candidates] output=${outputDir}`);
  console.log(`[autoresearch:candidates] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
