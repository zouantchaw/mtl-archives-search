import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import sharp from 'sharp';
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@xenova/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const DEFAULT_QUALITY_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_issues_downstream.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_cleanup_embedding',
);

type QualityRow = {
  id: string;
  title: string;
  date: string;
  imageUrl: string;
  imagePath: string;
  labels: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  recommendedAction: string;
  confidence: number;
  dimensions: { width: number | null; height: number | null };
  metrics?: {
    cropKeepRatio?: number;
    borderPx?: { top: number; bottom: number; left: number; right: number };
    meanBrightness?: number;
    contrastStd?: number;
    edgeEnergy?: number;
    darkFraction?: number;
    lightFraction?: number;
  };
  error?: string;
};

type ExperimentRow = {
  id: string;
  title: string;
  date: string;
  imageUrl: string;
  imagePath: string;
  labels: string[];
  cleanupMethod: string;
  originalPath: string;
  cleanedPath: string;
  originalSize: { width: number; height: number };
  cleanedSize: { width: number; height: number };
  crop: { left: number; top: number; width: number; height: number };
  cropKeepRatio: number;
  embeddingCosine: number;
  embeddingShift: number;
  categoryBefore: string;
  categoryAfter: string;
  categoryChanged: boolean;
  categoryMargins: {
    before: number;
    after: number;
    delta: number;
  };
  promptScoresBefore: Record<string, number>;
  promptScoresAfter: Record<string, number>;
  recommendation: 'keep_raw' | 'cleanup_before_embedding' | 'manual_review';
};

const CATEGORY_PROMPTS = [
  { key: 'aerial_photo', text: 'an aerial photograph of a city, streets, buildings, and urban blocks' },
  { key: 'street_or_building_photo', text: 'a historical street or building photograph' },
  { key: 'map_or_plan', text: 'a scanned map, plan, or technical drawing document' },
  { key: 'document_frame', text: 'a document scan with borders, labels, stamps, and blank margins' },
  { key: 'low_quality_scan', text: 'a washed out low contrast archival scan' },
] as const;

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function scoreCandidate(row: QualityRow): number {
  if (row.error) return -100;
  let score = 0;
  if (row.labels.includes('border_heavy')) score += 40;
  if (row.labels.includes('unsafe_crop_candidate')) score += 30;
  if (row.labels.includes('border_light')) score += 18;
  if (row.labels.includes('washed_out_scan')) score += 12;
  if (row.labels.includes('soft_or_blurry_scan')) score += 5;
  if (row.labels.includes('orientation_exif_rotation')) score += 4;
  if (row.severity === 'high') score += 8;
  if (row.severity === 'medium') score += 3;
  score += Math.round((1 - (row.metrics?.cropKeepRatio ?? 1)) * 100);
  return score;
}

function selectRows(rows: QualityRow[], limit: number): QualityRow[] {
  const useful = rows
    .filter((row) => row.id && row.imageUrl && !row.error)
    .filter((row) => row.labels.some((label) => [
      'border_heavy',
      'border_light',
      'unsafe_crop_candidate',
      'washed_out_scan',
      'soft_or_blurry_scan',
      'orientation_exif_rotation',
    ].includes(label)))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.id.localeCompare(b.id));

  const selected = new Map<string, QualityRow>();
  for (const row of useful.filter((item) => item.labels.includes('border_heavy') || item.labels.includes('unsafe_crop_candidate'))) {
    selected.set(row.id, row);
    if (selected.size >= Math.ceil(limit / 2)) break;
  }
  for (const row of useful) {
    selected.set(row.id, row);
    if (selected.size >= limit) break;
  }
  return [...selected.values()].slice(0, limit);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchImageBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'image/*' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 750);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function clampCrop(
  crop: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) {
  const left = Math.max(0, Math.min(width - 1, Math.round(crop.left)));
  const top = Math.max(0, Math.min(height - 1, Math.round(crop.top)));
  const right = Math.max(left + 1, Math.min(width, Math.round(crop.left + crop.width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round(crop.top + crop.height)));
  return { left, top, width: right - left, height: bottom - top };
}

function chooseCrop(row: QualityRow, width: number, height: number) {
  const border = row.metrics?.borderPx;
  if (border) {
    const crop = clampCrop({
      left: border.left,
      top: border.top,
      width: width - border.left - border.right,
      height: height - border.top - border.bottom,
    }, width, height);
    const keep = (crop.width * crop.height) / (width * height);
    if (keep >= 0.68 && keep <= 0.985) return crop;
  }

  const marginX = row.labels.includes('border_heavy') ? 0.08 : 0.035;
  const marginY = row.labels.includes('border_heavy') ? 0.08 : 0.035;
  return clampCrop({
    left: width * marginX,
    top: height * marginY,
    width: width * (1 - marginX * 2),
    height: height * (1 - marginY * 2),
  }, width, height);
}

async function writeExperimentImages(row: QualityRow, outputDir: string, timeoutMs: number) {
  const buffer = await fetchImageBuffer(row.imageUrl, timeoutMs);
  const orientedBuffer = await sharp(buffer, { failOn: 'none' }).rotate().toBuffer();
  const metadata = await sharp(orientedBuffer, { failOn: 'none' }).metadata();
  const width = metadata.width ?? row.dimensions.width ?? 0;
  const height = metadata.height ?? row.dimensions.height ?? 0;
  if (!width || !height) throw new Error('Missing image dimensions after decode');

  const crop = chooseCrop(row, width, height);
  const keep = Number(((crop.width * crop.height) / (width * height)).toFixed(4));
  const needsToneNormalize = row.labels.includes('washed_out_scan') || row.labels.includes('low_contrast_scan');

  const imageDir = path.join(outputDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  const stem = row.id.replace(/\.json$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const originalPath = path.join(imageDir, `${stem}_before.jpg`);
  const cleanedPath = path.join(imageDir, `${stem}_after.jpg`);

  await sharp(orientedBuffer, { failOn: 'none' })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(originalPath);

  let cleaned = sharp(orientedBuffer, { failOn: 'none' }).extract(crop);
  if (needsToneNormalize) cleaned = cleaned.normalize();
  await cleaned
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(cleanedPath);

  const cleanedMetadata = await sharp(cleanedPath).metadata();
  return {
    originalPath,
    cleanedPath,
    originalSize: { width, height },
    cleanedSize: { width: cleanedMetadata.width ?? crop.width, height: cleanedMetadata.height ?? crop.height },
    crop,
    cropKeepRatio: keep,
    cleanupMethod: needsToneNormalize ? 'exif_orient_border_crop_tone_normalize' : 'exif_orient_border_crop',
  };
}

function normalizeVector(raw: Float32Array | number[]): number[] {
  let sumSq = 0;
  for (const value of raw) sumSq += value * value;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding norm');
  return Array.from(raw, (value) => value / norm);
}

async function imageEmbedding(filePath: string, model: any, processor: any): Promise<number[]> {
  const image = await RawImage.read(filePath);
  const inputs = await processor(image);
  const output = await model(inputs);
  return normalizeVector(output.image_embeds.data as Float32Array);
}

async function textEmbeddings(model: any, tokenizer: any): Promise<Record<string, number[]>> {
  const embeddings: Record<string, number[]> = {};
  for (const prompt of CATEGORY_PROMPTS) {
    const inputs = tokenizer(prompt.text, { padding: true, truncation: true });
    const output = await model(inputs);
    embeddings[prompt.key] = normalizeVector(output.text_embeds.data as Float32Array);
  }
  return embeddings;
}

function cosine(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) sum += a[i] * b[i];
  return sum;
}

function l2(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function promptScores(imageVector: number[], textVectors: Record<string, number[]>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(textVectors)
      .map(([key, value]) => [key, Number(cosine(imageVector, value).toFixed(4))])
      .sort((a, b) => Number(b[1]) - Number(a[1])),
  );
}

function topCategory(scores: Record<string, number>) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = sorted[0] ?? ['unknown', 0];
  const next = sorted[1] ?? ['unknown', 0];
  return { key: top[0], margin: Number((top[1] - next[1]).toFixed(4)) };
}

function recommendation(row: ExperimentRow): ExperimentRow['recommendation'] {
  if (row.cropKeepRatio < 0.72) return 'manual_review';
  const docBefore = row.promptScoresBefore.document_frame ?? 0;
  const docAfter = row.promptScoresAfter.document_frame ?? 0;
  const aerialBefore = row.promptScoresBefore.aerial_photo ?? 0;
  const aerialAfter = row.promptScoresAfter.aerial_photo ?? 0;
  const mapBefore = row.promptScoresBefore.map_or_plan ?? 0;
  const mapAfter = row.promptScoresAfter.map_or_plan ?? 0;
  const usefulShift = aerialAfter - aerialBefore > 0.01 || mapAfter - mapBefore > 0.01 || docBefore - docAfter > 0.01;
  if (row.embeddingCosine < 0.985 && usefulShift) return 'cleanup_before_embedding';
  return 'keep_raw';
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Autoresearch Cleanup Embedding Experiment',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Input quality rows: ${report.summary.input_quality_rows}`,
    `- Selected rows: ${report.summary.selected_rows}`,
    `- Completed rows: ${report.summary.completed_rows}`,
    `- Failed rows: ${report.summary.failed_rows}`,
    `- SAM available: ${report.environment.sam_available}`,
    `- Average original/cleaned cosine: ${report.summary.average_embedding_cosine}`,
    `- Average embedding shift: ${report.summary.average_embedding_shift}`,
    `- Category changes: ${report.summary.category_changes}`,
    '',
    '## Recommendations',
    '',
  ];
  for (const [key, count] of Object.entries(report.recommendation_counts)) lines.push(`- ${key}: ${count}`);
  lines.push('', '## Top Changed Rows', '');
  for (const row of report.top_changed) {
    lines.push(`- \`${row.id}\`: cosine=${row.embeddingCosine}, ${row.categoryBefore} -> ${row.categoryAfter}, keep=${row.cropKeepRatio}, ${row.recommendation}`);
  }
  lines.push('', '## Decision', '');
  lines.push(report.decision);
  lines.push('', '## Artifacts', '');
  lines.push('- `cleanup_embedding_report.json`: full metrics and recommendations.');
  lines.push('- `cleanup_embedding_report.md`: readable summary.');
  lines.push('- `cleanup_embedding_rows.jsonl`: row-level before/after metrics.');
  lines.push('- `images/*_before.jpg` and `images/*_after.jpg`: visual review sample.');
  return `${lines.join('\n')}\n`;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_QUALITY_LABELS },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '12' },
      'fetch-timeout-ms': { type: 'string', default: '30000' },
      'skip-embeddings': { type: 'boolean', default: false },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const limit = Number.parseInt(values.limit!, 10);
  const timeoutMs = Number.parseInt(values['fetch-timeout-ms']!, 10);
  fs.mkdirSync(outputDir, { recursive: true });

  const rows = readJsonl<QualityRow>(inputPath);
  const selected = selectRows(rows, limit);
  const samAvailable = false;
  const failures: Array<{ id: string; error: string }> = [];

  let visionModel: any = null;
  let processor: any = null;
  let textModel: any = null;
  let tokenizer: any = null;
  let textVectors: Record<string, number[]> = {};

  if (!values['skip-embeddings']) {
    visionModel = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
    processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
    textModel = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
    tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
    textVectors = await textEmbeddings(textModel, tokenizer);
  }

  const completed: ExperimentRow[] = [];
  for (const row of selected) {
    try {
      const images = await writeExperimentImages(row, outputDir, timeoutMs);
      const originalVector = values['skip-embeddings'] ? [] : await imageEmbedding(images.originalPath, visionModel, processor);
      const cleanedVector = values['skip-embeddings'] ? [] : await imageEmbedding(images.cleanedPath, visionModel, processor);
      const scoresBefore = values['skip-embeddings'] ? {} : promptScores(originalVector, textVectors);
      const scoresAfter = values['skip-embeddings'] ? {} : promptScores(cleanedVector, textVectors);
      const before = topCategory(scoresBefore);
      const after = topCategory(scoresAfter);
      const experimentRow: ExperimentRow = {
        id: row.id,
        title: row.title,
        date: row.date,
        imageUrl: row.imageUrl,
        imagePath: row.imagePath,
        labels: row.labels,
        cleanupMethod: images.cleanupMethod,
        originalPath: path.relative(MONOREPO_ROOT, images.originalPath),
        cleanedPath: path.relative(MONOREPO_ROOT, images.cleanedPath),
        originalSize: images.originalSize,
        cleanedSize: images.cleanedSize,
        crop: images.crop,
        cropKeepRatio: images.cropKeepRatio,
        embeddingCosine: values['skip-embeddings'] ? 1 : Number(cosine(originalVector, cleanedVector).toFixed(4)),
        embeddingShift: values['skip-embeddings'] ? 0 : Number(l2(originalVector, cleanedVector).toFixed(4)),
        categoryBefore: before.key,
        categoryAfter: after.key,
        categoryChanged: before.key !== after.key,
        categoryMargins: {
          before: before.margin,
          after: after.margin,
          delta: Number((after.margin - before.margin).toFixed(4)),
        },
        promptScoresBefore: scoresBefore,
        promptScoresAfter: scoresAfter,
        recommendation: 'keep_raw',
      };
      experimentRow.recommendation = recommendation(experimentRow);
      completed.push(experimentRow);
    } catch (error) {
      failures.push({ id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const avgCosine = Number(average(completed.map((row) => row.embeddingCosine)).toFixed(4));
  const avgShift = Number(average(completed.map((row) => row.embeddingShift)).toFixed(4));
  const cleanupWins = completed.filter((row) => row.recommendation === 'cleanup_before_embedding').length;
  const manualReview = completed.filter((row) => row.recommendation === 'manual_review').length;
  const decision = cleanupWins > completed.length * 0.35
    ? 'Cleanup should be promoted to a larger re-embedding experiment for border-heavy records, with manual review for unsafe crops.'
    : manualReview > cleanupWins
      ? 'Do not blindly cleanup all flagged records yet. Use cleanup for review samples and require manual approval for unsafe crops before a larger re-embedding pipeline.'
      : 'Cleanup has measurable embedding effects but should stay as a targeted preprocessing option until a larger GPU/SAM pass confirms broad search gains.';

  const report = {
    generated_at: new Date().toISOString(),
    command: 'npm run autoresearch:cleanup-embedding',
    inputs: {
      quality_labels: path.relative(MONOREPO_ROOT, inputPath),
    },
    environment: {
      sam_available: samAvailable,
      sam_note: 'The legacy Python SAM script remains in pipelines/sam-experiment/border_stripping_experiment.py, but this reproducible run used deterministic border crops because local Python SAM dependencies are not installed.',
      embedding_model: values['skip-embeddings'] ? null : 'Xenova/clip-vit-base-patch32',
    },
    summary: {
      input_quality_rows: rows.length,
      selected_rows: selected.length,
      completed_rows: completed.length,
      failed_rows: failures.length,
      average_embedding_cosine: avgCosine,
      average_embedding_shift: avgShift,
      category_changes: completed.filter((row) => row.categoryChanged).length,
    },
    label_counts: countBy(completed.flatMap((row) => row.labels)),
    recommendation_counts: countBy(completed.map((row) => row.recommendation)),
    decision,
    category_prompt_text: Object.fromEntries(CATEGORY_PROMPTS.map((prompt) => [prompt.key, prompt.text])),
    top_changed: [...completed]
      .sort((a, b) => a.embeddingCosine - b.embeddingCosine)
      .slice(0, 12),
    rows: completed,
    failures,
    artifacts: {
      report_json: 'cleanup_embedding_report.json',
      report_markdown: 'cleanup_embedding_report.md',
      rows_jsonl: 'cleanup_embedding_rows.jsonl',
      images_dir: 'images',
    },
  };

  fs.writeFileSync(path.join(outputDir, 'cleanup_embedding_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'cleanup_embedding_report.md'), renderMarkdown(report));
  writeJsonl(path.join(outputDir, 'cleanup_embedding_rows.jsonl'), completed);
  if (failures.length) writeJsonl(path.join(outputDir, 'cleanup_embedding_failures.jsonl'), failures);

  console.log(`[autoresearch:cleanup-embedding] output=${outputDir}`);
  console.log(`[autoresearch:cleanup-embedding] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
