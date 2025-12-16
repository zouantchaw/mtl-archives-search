import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

// Configuration
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN;
// Options: '@cf/meta/llama-3.2-11b-vision-instruct' (requires license), '@cf/unum/uform-gen2-qwen-500m', '@cf/llava-hf/llava-1.5-7b-hf'
const VLM_MODEL = process.env.VLM_MODEL || '@cf/unum/uform-gen2-qwen-500m';
const R2_PUBLIC_DOMAIN = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm.jsonl');

// Rate limiting
const REQUESTS_PER_MINUTE = 30; // Conservative limit for Workers AI
const DELAY_MS = Math.ceil(60000 / REQUESTS_PER_MINUTE);

if (!ACCOUNT_ID) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

/**
 * Accept the Llama model license agreement (required first-time use)
 */
async function acceptModelAgreement(): Promise<void> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${VLM_MODEL}`;

  console.log('Accepting Llama 3.2 Vision license agreement...');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: 'agree',
        },
      ],
      max_tokens: 10,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`Agreement response: ${response.status} - ${text.slice(0, 200)}`);
  } else {
    console.log('License agreement accepted.\n');
  }
}

/**
 * Detect if a name is "real" (descriptive) vs a cote code or filename
 */
function isRealName(name: string): boolean {
  if (!name || name.length < 5) return false;

  // Looks like a filename
  if (/\.(jpg|jpeg|png|tif|tiff)$/i.test(name)) return false;

  // Looks like a cote code (e.g., VM97,S3,D08,P298 or VM94-Z2)
  if (/^VM\d+[,\-_]/i.test(name)) return false;

  // Just numbers and punctuation
  if (/^[\d\s,.\-_]+$/.test(name)) return false;

  // Has some alphabetic content that's not just VM codes
  const alphaContent = name.replace(/VM\d+|[,.\-_\d\s]/gi, '').trim();
  return alphaContent.length >= 3;
}

/**
 * Extract a clean date string from various formats
 */
function extractDate(record: any): string | null {
  const dateValue = record.attributes_map?.Date || record.portal_record?.Date;
  if (!dateValue) return null;

  // Clean up common patterns
  const cleaned = String(dateValue).trim();
  if (cleaned.length < 4) return null;

  return cleaned;
}

/**
 * Build a contextual prompt for the VLM
 */
function buildPrompt(record: any): string {
  const parts: string[] = [];

  const name = record.name?.trim();
  const date = extractDate(record);
  const hasRealName = name && isRealName(name);

  // Build context
  if (hasRealName || date) {
    parts.push("This is an archival photograph from Montreal's city archives.");

    if (hasRealName) {
      parts.push(`It is titled "${name}".`);
    }

    if (date) {
      parts.push(`It is dated ${date}.`);
    }
  } else {
    parts.push("This is a historical photograph from Montreal's city archives.");
  }

  parts.push("\nDescribe what you see in this image in 2-3 sentences. Focus on:");
  parts.push("- The main subject (building, street, park, people, event)");
  parts.push("- Notable visual details (architecture style, vehicles, clothing)");
  parts.push("- The setting (urban, rural, indoor, outdoor)");
  parts.push("\nBe specific and descriptive. Do not speculate about things you cannot see.");

  return parts.join(" ");
}

/**
 * Get the image URL for a record
 */
function getImageUrl(record: any): string | null {
  // Prefer external_url (Montreal's servers - authoritative source)
  if (record.external_url) {
    return record.external_url;
  }

  // Fallback to R2 if configured
  const filename = record.resolved_image_filename || record.image_filename;
  if (filename && R2_PUBLIC_DOMAIN) {
    return `https://${R2_PUBLIC_DOMAIN}/${encodeURIComponent(filename)}`;
  }

  return null;
}

// Max image size for API (resize if larger)
const MAX_IMAGE_DIMENSION = 1024;
const MAX_IMAGE_BYTES = 1024 * 1024; // 1MB

/**
 * Fetch image as raw bytes, resizing if too large
 */
async function fetchImageBytes(imageUrl: string): Promise<Uint8Array> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const originalBytes = new Uint8Array(buffer);

  // If image is small enough, return as-is
  if (originalBytes.length <= MAX_IMAGE_BYTES) {
    return originalBytes;
  }

  // Resize large images using sharp
  try {
    const resized = await sharp(Buffer.from(buffer))
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    return new Uint8Array(resized);
  } catch (err) {
    // If resizing fails, try with original
    console.warn(`Could not resize image, using original: ${err}`);
    return originalBytes;
  }
}

/**
 * Fetch image and convert to base64 data URI
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return `data:${contentType};base64,${base64}`;
}

/**
 * Call Workers AI VLM to caption an image
 */
async function captionImage(imageUrl: string, prompt: string): Promise<string> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${VLM_MODEL}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

  try {
    let body: any;

    // Different API format based on model
    if (VLM_MODEL.includes('uform')) {
      // uform uses raw bytes and simple prompt
      const imageBytes = await fetchImageBytes(imageUrl);
      body = {
        image: Array.from(imageBytes),
        prompt: prompt,
        max_tokens: 256,
      };
    } else if (VLM_MODEL.includes('llava')) {
      // LLaVA uses raw bytes array
      const imageBytes = await fetchImageBytes(imageUrl);
      body = {
        image: Array.from(imageBytes),
        prompt: prompt,
        max_tokens: 200,
      };
    } else {
      // Llama and others use messages format with base64
      const imageDataUri = await fetchImageAsBase64(imageUrl);
      body = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUri } },
            ],
          },
        ],
        max_tokens: 200,
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`VLM API error: ${response.status} ${text}`);
    }

    const json = await response.json() as any;

    // Extract the response text from various possible shapes
    const result = json.result?.description  // uform returns description
      || json.result?.response
      || json.result?.choices?.[0]?.message?.content
      || json.result?.output
      || json.result;

    if (typeof result === 'string') {
      return result.trim();
    }

    throw new Error(`Unexpected response shape: ${JSON.stringify(json)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if a record needs VLM captioning
 */
function needsCaptioning(record: any): boolean {
  // Only caption synthetic descriptions
  const source = record.description_source || '';
  return source === 'synthetic' || source.includes('synthetic');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      limit: { type: 'string' },
      offset: { type: 'string', default: '0' },
      'only-synthetic': { type: 'boolean', default: true },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const offset = parseInt(values.offset!, 10);
  const onlySynthetic = values['only-synthetic'];
  const dryRun = values['dry-run'];

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`Reading from: ${inputPath}`);
  console.log(`Writing to: ${outputPath}`);
  console.log(`Model: ${VLM_MODEL}`);
  console.log(`Only synthetic: ${onlySynthetic}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Rate limit: ${REQUESTS_PER_MINUTE} req/min (${DELAY_MS}ms delay)`);
  console.log('');

  // Read all records
  const raw = fs.readFileSync(inputPath, 'utf-8');
  let records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));

  // Apply offset and limit
  if (offset > 0) {
    records = records.slice(offset);
    console.log(`Skipped ${offset} records (offset)`);
  }

  if (limit) {
    records = records.slice(0, limit);
    console.log(`Limited to ${limit} records`);
  }

  // Filter to only those needing captioning if requested
  const toProcess = onlySynthetic
    ? records.filter(needsCaptioning)
    : records;

  console.log(`Total records: ${records.length}`);
  console.log(`Records to caption: ${toProcess.length}`);
  console.log('');

  // Accept model license agreement (required for some models like Llama)
  if (!dryRun && toProcess.length > 0 && VLM_MODEL.includes('llama')) {
    await acceptModelAgreement();
  }

  if (dryRun) {
    console.log('=== DRY RUN: Sample prompts ===\n');
    for (const record of toProcess.slice(0, 5)) {
      const imageUrl = getImageUrl(record);
      const prompt = buildPrompt(record);
      console.log(`--- ${record.metadata_filename} ---`);
      console.log(`Name: ${record.name}`);
      console.log(`Real name: ${isRealName(record.name || '')}`);
      console.log(`Image URL: ${imageUrl}`);
      console.log(`Prompt: ${prompt}`);
      console.log('');
    }
    return;
  }

  // Process records
  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  let processed = 0;
  let captioned = 0;
  let errors = 0;
  const startTime = Date.now();

  for (const record of records) {
    const shouldCaption = !onlySynthetic || needsCaptioning(record);

    if (shouldCaption) {
      const imageUrl = getImageUrl(record);

      if (!imageUrl) {
        console.warn(`No image URL for ${record.metadata_filename}, skipping`);
        record.vlm_caption = null;
        record.vlm_error = 'no_image_url';
      } else {
        try {
          const prompt = buildPrompt(record);
          const caption = await captionImage(imageUrl, prompt);

          record.vlm_caption = caption;
          record.vlm_captioned_at = new Date().toISOString();
          captioned++;

          console.log(`[${captioned}/${toProcess.length}] ${record.metadata_filename}: ${caption.slice(0, 80)}...`);

          // Rate limiting
          await sleep(DELAY_MS);

        } catch (err: any) {
          console.error(`Error captioning ${record.metadata_filename}: ${err.message}`);
          record.vlm_caption = null;
          record.vlm_error = err.message;
          errors++;

          // Back off on errors
          await sleep(DELAY_MS * 2);
        }
      }
    }

    outputStream.write(JSON.stringify(record) + '\n');
    processed++;

    // Progress update every 100 records
    if (processed % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = captioned / elapsed * 60;
      console.log(`\nProgress: ${processed}/${records.length} processed, ${captioned} captioned, ${errors} errors`);
      console.log(`Rate: ${rate.toFixed(1)} captions/min, Elapsed: ${elapsed.toFixed(0)}s\n`);
    }
  }

  outputStream.end();

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n=== Complete ===');
  console.log(`Processed: ${processed}`);
  console.log(`Captioned: ${captioned}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${totalTime.toFixed(1)}s`);
  console.log(`Output: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
