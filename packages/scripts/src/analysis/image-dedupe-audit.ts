import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_dedupe_audit.json');
const DEFAULT_GROUPS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_dedupe_groups.ndjson');
const DEFAULT_DECISIONS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_dedupe_decisions.ndjson');

type ImageCandidate = {
  id: string;
  imageKey: string;
  imageUrl: string;
  name?: string;
  dateValue?: string;
  imageSizeBytes?: number | null;
};

type HashedCandidate = ImageCandidate & {
  hash: bigint;
  hashHex: string;
};

type DedupeGroup = {
  canonicalId: string;
  canonicalImageUrl: string;
  members: Array<{
    id: string;
    imageUrl: string;
    imageKey: string;
    hashHex: string;
    distanceFromCanonical: number;
    name?: string;
    dateValue?: string;
  }>;
};

type Decision = {
  id: string;
  canonicalId: string;
  action: 'keep' | 'drop_duplicate';
  reason: string;
};

class BKNode {
  hash: bigint;
  indices: number[];
  children: Map<number, BKNode>;

  constructor(hash: bigint, index: number) {
    this.hash = hash;
    this.indices = [index];
    this.children = new Map();
  }
}

function fail(message: string): never {
  console.error(`[image-dedupe:audit] FAIL: ${message}`);
  process.exit(1);
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function extractYear(value: unknown): string | undefined {
  const text = cleanText(value);
  const match = text.match(/(18\d{2}|19\d{2}|20\d{2})/);
  return match ? match[1] : undefined;
}

function resolveImageUrl(record: any, publicDomain?: string): string | null {
  const externalUrl = cleanText(record.external_url);
  if (externalUrl) return externalUrl;

  const imageKey = cleanText(record.resolved_image_filename || record.image_filename);
  if (!imageKey) return null;

  if (publicDomain) {
    return `https://${publicDomain}/${imageKey.replace(/^\/+/, '')}`;
  }

  return null;
}

async function* readJsonl(inputPath: string): AsyncGenerator<any> {
  const stream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const readline = await import('readline');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

function toHashHex(hash: bigint): string {
  return hash.toString(16).padStart(16, '0');
}

async function readImageBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  if (url.startsWith('file://')) {
    const filePath = decodeURIComponent(url.slice('file://'.length));
    return fs.readFileSync(filePath);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timeout);
  }
}

async function computeDHash64(imageBuffer: Buffer): Promise<bigint> {
  const { data, info } = await sharp(imageBuffer)
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 1) {
    throw new Error('Unexpected image channel count for hash computation');
  }

  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash;
}

function insertBk(root: BKNode | null, hash: bigint, index: number): BKNode {
  if (!root) return new BKNode(hash, index);

  let node: BKNode = root;
  while (true) {
    const distance = hammingDistance(hash, node.hash);
    if (distance === 0) {
      node.indices.push(index);
      return root;
    }
    const child = node.children.get(distance);
    if (!child) {
      node.children.set(distance, new BKNode(hash, index));
      return root;
    }
    node = child;
  }
}

function searchBk(node: BKNode | null, hash: bigint, radius: number, out: number[]) {
  if (!node) return;

  const distance = hammingDistance(hash, node.hash);
  if (distance <= radius) {
    out.push(...node.indices);
  }

  const min = Math.max(0, distance - radius);
  const max = distance + radius;
  for (const [edge, child] of node.children) {
    if (edge >= min && edge <= max) {
      searchBk(child, hash, radius, out);
    }
  }
}

class UnionFind {
  parent: number[];
  rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }
  }
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => next());
  await Promise.all(workers);
  return results;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      report: { type: 'string', default: DEFAULT_REPORT },
      groups: { type: 'string', default: DEFAULT_GROUPS },
      decisions: { type: 'string', default: DEFAULT_DECISIONS },
      limit: { type: 'string', default: '0' },
      'sample-limit': { type: 'string', default: '200' },
      'hamming-threshold': { type: 'string', default: '6' },
      concurrency: { type: 'string', default: '4' },
      'fetch-timeout-ms': { type: 'string', default: '20000' },
      'public-domain': { type: 'string', default: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '' },
    },
  });

  const inputPath = path.resolve(process.cwd(), values.input!);
  const reportPath = path.resolve(process.cwd(), values.report!);
  const groupsPath = path.resolve(process.cwd(), values.groups!);
  const decisionsPath = path.resolve(process.cwd(), values.decisions!);
  const limit = Number(values.limit || '0');
  const sampleLimit = Number(values['sample-limit'] || '200');
  const hammingThreshold = Number(values['hamming-threshold'] || '6');
  const concurrency = Number(values.concurrency || '4');
  const fetchTimeoutMs = Number(values['fetch-timeout-ms'] || '20000');
  const publicDomain = cleanText(values['public-domain']);

  if (!fs.existsSync(inputPath)) {
    fail(`Input file not found: ${inputPath}`);
  }

  const candidates: ImageCandidate[] = [];
  let scanned = 0;
  let skippedMissingUrl = 0;

  for await (const record of readJsonl(inputPath)) {
    if (limit > 0 && scanned >= limit) break;
    scanned += 1;

    const imageKey = cleanText(record.resolved_image_filename || record.image_filename);
    const imageUrl = resolveImageUrl(record, publicDomain);
    if (!imageUrl) {
      skippedMissingUrl += 1;
      continue;
    }

    candidates.push({
      id: cleanText(record.metadata_filename),
      imageKey,
      imageUrl,
      name: cleanText(record.name) || undefined,
      dateValue: extractYear(record.date_value || record.attributes_map?.Date || record.portal_record?.Date),
      imageSizeBytes: record.image_size_bytes != null ? Number(record.image_size_bytes) : null,
    });
  }

  const hashFailures: Array<{ id: string; imageUrl: string; error: string }> = [];

  const hashedMaybe = await runWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      const imageBuffer = await readImageBuffer(candidate.imageUrl, fetchTimeoutMs);
      const hash = await computeDHash64(imageBuffer);
      return {
        ...candidate,
        hash,
        hashHex: toHashHex(hash),
      } as HashedCandidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hashFailures.push({ id: candidate.id, imageUrl: candidate.imageUrl, error: message });
      return null;
    }
  });

  const hashed = hashedMaybe.filter((row): row is HashedCandidate => row !== null);

  const uf = new UnionFind(hashed.length);
  let root: BKNode | null = null;

  for (let i = 0; i < hashed.length; i += 1) {
    const near: number[] = [];
    searchBk(root, hashed[i].hash, hammingThreshold, near);
    for (const j of near) {
      uf.union(i, j);
    }
    root = insertBk(root, hashed[i].hash, i);
  }

  const groupsMap = new Map<number, number[]>();
  for (let i = 0; i < hashed.length; i += 1) {
    const leader = uf.find(i);
    const arr = groupsMap.get(leader) ?? [];
    arr.push(i);
    groupsMap.set(leader, arr);
  }

  const duplicateClusters = Array.from(groupsMap.values())
    .filter((indices) => indices.length > 1)
    .sort((a, b) => b.length - a.length);

  const groups: DedupeGroup[] = [];
  const decisions: Decision[] = [];

  for (const cluster of duplicateClusters.slice(0, sampleLimit)) {
    const canonicalIndex = cluster[0];
    const canonical = hashed[canonicalIndex];

    const members = cluster.map((idx) => {
      const row = hashed[idx];
      const distance = hammingDistance(canonical.hash, row.hash);
      decisions.push({
        id: row.id,
        canonicalId: canonical.id,
        action: idx === canonicalIndex ? 'keep' : 'drop_duplicate',
        reason: idx === canonicalIndex
          ? 'cluster_canonical'
          : `dhash_hamming<=${hammingThreshold} (distance=${distance})`,
      });

      return {
        id: row.id,
        imageUrl: row.imageUrl,
        imageKey: row.imageKey,
        hashHex: row.hashHex,
        distanceFromCanonical: distance,
        name: row.name,
        dateValue: row.dateValue,
      };
    });

    groups.push({
      canonicalId: canonical.id,
      canonicalImageUrl: canonical.imageUrl,
      members,
    });
  }

  const duplicateRecordCount = duplicateClusters.reduce((sum, cluster) => sum + cluster.length, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    params: {
      limit,
      sampleLimit,
      hammingThreshold,
      concurrency,
      fetchTimeoutMs,
      publicDomain: publicDomain || null,
    },
    counts: {
      scanned,
      candidateImages: candidates.length,
      hashedImages: hashed.length,
      skippedMissingUrl,
      hashFailures: hashFailures.length,
      duplicateClusters: duplicateClusters.length,
      duplicateRecords: duplicateRecordCount,
    },
    outputs: {
      reportPath,
      groupsPath,
      decisionsPath,
    },
    sampleHashFailures: hashFailures.slice(0, 50),
  };

  ensureDir(reportPath);
  ensureDir(groupsPath);
  ensureDir(decisionsPath);

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(groupsPath, groups.map((row) => JSON.stringify(row)).join('\n') + (groups.length ? '\n' : ''));
  fs.writeFileSync(decisionsPath, decisions.map((row) => JSON.stringify(row)).join('\n') + (decisions.length ? '\n' : ''));

  console.log(`[image-dedupe:audit] scanned=${scanned}`);
  console.log(`[image-dedupe:audit] candidates=${candidates.length}, hashed=${hashed.length}, failures=${hashFailures.length}`);
  console.log(`[image-dedupe:audit] duplicate clusters=${duplicateClusters.length}, records=${duplicateRecordCount}`);
  console.log(`[image-dedupe:audit] report=${reportPath}`);
  console.log(`[image-dedupe:audit] groups=${groupsPath}`);
  console.log(`[image-dedupe:audit] decisions=${decisionsPath}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
