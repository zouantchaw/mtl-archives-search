import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { UMAP } from 'umap-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_AI_TOKEN || process.env.CF_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const VECTORIZE_INDEX = 'mtl-archives-clip'; // Visual embeddings
const R2_PUBLIC_DOMAIN = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;

const MANIFEST_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const OUTPUT_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/embeddings_2d.json');
const CACHE_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/vectors_cache.json');

const BATCH_SIZE = 20;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Missing Cloudflare credentials.');
  process.exit(1);
}

async function fetchVectorsByIds(ids: string[]) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/get_by_ids`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    throw new Error(`Vectorize fetch failed: ${response.status}`);
  }

  const json = await response.json() as any;
  return json.result || [];
}

async function fetchAllVectors(manifest: any[]) {
  const ids = manifest.map(r => r.metadata_filename).filter(Boolean);
  const total = ids.length;
  console.log(`Fetching ${total} vectors from Vectorize...`);

  const allVectors: number[][] = [];
  const validIds: string[] = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    try {
      const results = await fetchVectorsByIds(batchIds);
      
      for (const vec of results) {
        if (vec.values && vec.values.length > 0) {
          allVectors.push(vec.values);
          validIds.push(vec.id);
        }
      }
      
      process.stdout.write(`\rFetched ${Math.min(i + BATCH_SIZE, total)}/${total} (${allVectors.length} valid)`);
      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`\nBatch failed:`, err);
    }
  }
  console.log('\nFetch complete.');
  return { vectors: allVectors, ids: validIds };
}

function runUMAP(vectors: number[][]) {
  console.log(`Running UMAP on ${vectors.length} vectors...`);
  
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: 15,
    minDist: 0.1,
    spread: 1.0,
    random: () => Math.random(), // Seed if needed
  });

  const embedding = umap.fit(vectors);
  
  // Normalize to 0-1
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of embedding) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }

  return embedding.map(p => [
    (p[0] - minX) / (maxX - minX),
    (p[1] - minY) / (maxY - minY)
  ]);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'skip-fetch': { type: 'boolean' },
    },
  });

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  let vectors: number[][] = [];
  let ids: string[] = [];

  if (values['skip-fetch'] && fs.existsSync(CACHE_PATH)) {
    console.log('Loading cached vectors...');
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    vectors = cache.vectors;
    ids = cache.ids;
  } else {
    const result = await fetchAllVectors(manifest);
    vectors = result.vectors;
    ids = result.ids;

    if (vectors.length > 0) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify({ vectors, ids }));
      console.log(`Cached vectors to ${CACHE_PATH}`);
    }
  }

  if (vectors.length === 0) {
    console.error('No vectors available to process.');
    process.exit(1);
  }

  const embedding2d = runUMAP(vectors);

  const manifestLookup = new Map(manifest.map(r => [r.metadata_filename, r]));
  const output = ids.map((id, idx) => {
    const record = manifestLookup.get(id) as any || {};
    const imgFile = record.resolved_image_filename || record.image_filename;
    const imgUrl = (R2_PUBLIC_DOMAIN && imgFile) ? `https://${R2_PUBLIC_DOMAIN}/${imgFile}` : '';

    return {
      id,
      x: embedding2d[idx][0],
      y: embedding2d[idx][1],
      name: record.name || '',
      date: record.attributes_map?.Date || '',
      image_url: imgUrl,
    };
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Saved ${output.length} points to ${OUTPUT_PATH}`);
}

main().catch(console.error);
