import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from '@xenova/transformers';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN;
const R2_PUBLIC_DOMAIN = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;
const VECTORIZE_INDEX = process.env.CLOUDFLARE_VECTORIZE_INDEX || "mtl-archives-clip";

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("Error: Missing Cloudflare credentials (ACCOUNT_ID, API_TOKEN)");
  process.exit(1);
}

const VECTORIZE_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/upsert`;

// Configuration
const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const BATCH_SIZE = parseInt(process.env.CLIP_BATCH_SIZE || "8", 10);

async function upsertVectors(vectors: any[]) {
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
  const response = await fetch(VECTORIZE_ENDPOINT, {
    method: 'POST',
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Vectorize upsert failed: ${response.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      limit: { type: 'string', default: '0' },
      offset: { type: 'string', default: '0' },
    },
  });

  const inputPath = values.input!;
  const limit = parseInt(values.limit!, 10);
  const offset = parseInt(values.offset!, 10);

  if (!fs.existsSync(inputPath)) {
    console.error(`Manifest not found: ${inputPath}`);
    process.exit(1);
  }

  console.log("Loading CLIP model (Xenova/clip-vit-base-patch32)...");
  // Load model and processor
  const model = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32');
  const processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');

  console.log("Model loaded. Reading manifest...");
  const records: any[] = [];
  const fileStream = fs.createReadStream(inputPath);
  const rl = (await import('readline')).createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim()) records.push(JSON.parse(line));
  }

  let subset = records.slice(offset);
  if (limit > 0) {
    subset = subset.slice(0, limit);
  }

  console.log(`Processing ${subset.length} records...`);

  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < subset.length; i += BATCH_SIZE) {
    const batch = subset.slice(i, i + BATCH_SIZE);
    const vectors: any[] = [];
    
    // Process batch in parallel
    const promises = batch.map(async (record) => {
      let url = record.external_url;
      if (!url && R2_PUBLIC_DOMAIN) {
        const img = record.resolved_image_filename || record.image_filename;
        if (img) url = `https://${R2_PUBLIC_DOMAIN}/${img}`;
      }

      if (!url) return null;

      try {
        const image = await RawImage.read(url);
        const image_inputs = await processor(image);
        const { image_embeds } = await model(image_inputs);
        
        // Normalize embedding (l2 norm)
        // tensor.data is a Float32Array. We need to convert it to a regular array.
        // Also need to implement manual normalization if transformers.js doesn't do it automatically for this model (CLIP usually outputs raw features).
        // For simplicity here we assume raw features.
        
        // Manual L2 normalization
        const raw = image_embeds.data;
        let sumSq = 0;
        for (let k = 0; k < raw.length; k++) sumSq += raw[k] * raw[k];
        const norm = Math.sqrt(sumSq);
        const values = [];
        for (let k = 0; k < raw.length; k++) values.push(raw[k] / norm);

        const metadata: any = {};
        if (record.name) metadata.name = record.name;
        if (record.attributes_map?.Date) metadata.date = record.attributes_map.Date;
        const imageKey = record.resolved_image_filename || record.image_filename;
        if (imageKey) metadata.image = imageKey;

        return {
          id: record.metadata_filename,
          values: values,
          metadata
        };
      } catch (err) {
        // console.error(`Failed to process ${url}:`, err); // Verbose
        return null;
      }
    });

    const results = await Promise.all(promises);
    const validVectors = results.filter(v => v !== null);

    if (validVectors.length > 0) {
      if (await upsertVectors(validVectors)) {
        processed += validVectors.length;
        skipped += (batch.length - validVectors.length);
        process.stdout.write(`\rProcessed: ${processed}, Skipped: ${skipped}`);
      } else {
        skipped += batch.length;
      }
    } else {
      skipped += batch.length;
    }
  }

  console.log(`\nComplete. Processed: ${processed}, Skipped: ${skipped}`);
}

main().catch(console.error);
