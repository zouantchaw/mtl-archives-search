import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_vlm_bakeoff/input.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_vlm_bakeoff/sample_summary.json');

type RecordRow = {
  metadata_filename?: string;
  name?: string;
  description?: string;
  description_source?: string;
  image_filename?: string;
  resolved_image_filename?: string;
};

type Candidate = {
  record: RecordRow;
  category: string;
  imageFilename: string;
};

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(MONOREPO_ROOT, value);
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function categorize(record: RecordRow): string {
  const text = `${record.name ?? ''} ${record.description ?? ''}`.toLowerCase();
  if (/hiver|neige|snow|winter/.test(text)) return 'winter';
  if (/parc|park|lafontaine|mont-royal/.test(text)) return 'park';
  if (/enfant|children|child|school|école|ecole|play/.test(text)) return 'children_activity';
  if (/fleuve|canal|port|waterfront|river|harbour|harbor|quai/.test(text)) return 'waterfront';
  if (/rue|avenue|boulevard|residential|maison|house|quartier/.test(text)) return 'residential_street';
  if (/^vm97|aerial|vue aérienne|aerienne/.test(text)) return 'aerial_or_sparse';
  if (/construction|chantier|building|édifice|edifice/.test(text)) return 'building_construction';
  return 'general';
}

async function isR2Available(domain: string, filename: string): Promise<boolean> {
  const url = `https://${domain}/${filename.replace(/^\/+/, '')}`;
  try {
    let response = await fetch(url, { method: 'HEAD' });
    if (response.ok) return true;
    if (response.status !== 405 && response.status !== 403) return false;
    response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

function readJsonl(inputPath: string): RecordRow[] {
  return fs.readFileSync(inputPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordRow);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
      limit: { type: 'string', default: '8' },
      'r2-public-domain': { type: 'string' },
      'max-scan': { type: 'string', default: '15000' },
      'per-category-cap': { type: 'string' },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputPath = resolveRepoPath(values.output!);
  const summaryPath = resolveRepoPath(values.summary!);
  const limit = Math.max(1, parseInt(values.limit!, 10));
  const maxScan = Math.max(limit, parseInt(values['max-scan']!, 10));
  const preferredCategories = [
    'winter',
    'park',
    'children_activity',
    'waterfront',
    'residential_street',
    'aerial_or_sparse',
    'building_construction',
    'general',
  ];
  const perCategoryCap = values['per-category-cap']
    ? Math.max(1, parseInt(values['per-category-cap'], 10))
    : Math.max(3, Math.ceil(limit / preferredCategories.length) + 10);
  const r2Domain = (
    values['r2-public-domain'] ||
    process.env.R2_PUBLIC_DOMAIN ||
    process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN ||
    ''
  ).trim();

  if (!r2Domain) throw new Error('Missing R2 public domain.');
  if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);

  const rows = readJsonl(inputPath);
  const buckets = new Map<string, Candidate[]>();
  let scanned = 0;
  let checked = 0;

  for (const record of rows) {
    if (scanned >= maxScan) break;
    scanned += 1;
    const imageFilename = cleanText(record.resolved_image_filename || record.image_filename);
    if (!imageFilename) continue;

    const category = categorize(record);
    const bucket = buckets.get(category) ?? [];
    if (bucket.length >= perCategoryCap) continue;

    checked += 1;
    if (await isR2Available(r2Domain, imageFilename)) {
      bucket.push({ record, category, imageFilename });
      buckets.set(category, bucket);
    }
  }

  const selected: Candidate[] = [];

  while (selected.length < limit) {
    const before = selected.length;
    for (const category of preferredCategories) {
      const next = buckets.get(category)?.shift();
      if (next) selected.push(next);
      if (selected.length >= limit) break;
    }
    if (selected.length === before) break;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, selected.map(({ record }) => JSON.stringify(record)).join('\n') + '\n');

  const summary = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    output: outputPath,
    r2_domain: r2Domain,
    requested_limit: limit,
    selected: selected.length,
    per_category_cap: perCategoryCap,
    scanned,
    r2_checked: checked,
    categories: selected.map(({ record, category, imageFilename }) => ({
      category,
      metadata_filename: record.metadata_filename,
      name: record.name,
      description_source: record.description_source,
      image_filename: imageFilename,
    })),
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[vlm:bakeoff:sample] selected=${selected.length} output=${outputPath}`);
  console.log(`[vlm:bakeoff:sample] summary=${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
