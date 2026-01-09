import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN;
const VLM_MODEL = process.env.VLM_TAGS_MODEL || process.env.VLM_MODEL || '@cf/unum/uform-gen2-qwen-500m';
const R2_PUBLIC_DOMAIN = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;
const VLM_PREFER_R2 = process.env.VLM_PREFER_R2 === '1' || process.env.VLM_PREFER_R2 === 'true';

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_structured.jsonl');

const DEFAULT_REQUESTS_PER_MINUTE = 30;

if (!ACCOUNT_ID) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function isRealName(name: string): boolean {
  if (!name || name.length < 5) return false;
  if (/\.(jpg|jpeg|png|tif|tiff)$/i.test(name)) return false;
  if (/^VM\d+[,_-]/i.test(name)) return false;
  if (/^[\d\s,._-]+$/.test(name)) return false;
  const alphaContent = name.replace(/VM\d+|[,._\-\d\s]/gi, '').trim();
  return alphaContent.length >= 3;
}

function buildAttributesMap(record: any): Record<string, string> {
  if (record.attributes_map && typeof record.attributes_map === 'object') {
    return record.attributes_map;
  }
  const map: Record<string, string> = {};
  for (const attr of record.attributes || []) {
    if (attr && typeof attr === 'object' && attr.trait_type) {
      map[attr.trait_type] = String(attr.value ?? '').trim();
    }
  }
  return map;
}

function extractDate(record: any): string | null {
  const attributesMap = buildAttributesMap(record);
  const dateValue = attributesMap.Date || record.portal_record?.Date || record.date_raw;
  if (!dateValue) return null;
  const cleaned = String(dateValue).trim();
  if (cleaned.length < 4) return null;
  return cleaned;
}

function buildPrompt(record: any): string {
  const parts: string[] = [];

  const name = cleanText(record.name || '');
  const date = extractDate(record);
  const hasRealName = name && isRealName(name);

  if (hasRealName || date) {
    parts.push("This is an archival photograph from Montreal's city archives.");
    if (hasRealName) {
      parts.push(`Title: "${name}".`);
    }
    if (date) {
      parts.push(`Date: ${date}.`);
    }
  } else {
    parts.push("This is a historical photograph from Montreal's city archives.");
  }

  parts.push('Return ONLY valid JSON with this schema:');
  parts.push('{');
  parts.push('  "objects": ["..."],');
  parts.push('  "setting": "...",');
  parts.push('  "actions": ["..."],');
  parts.push('  "landmarks": ["..."],');
  parts.push('  "time_period_guess": "...",');
  parts.push('  "visible_text_guess": "...",');
  parts.push('  "confidence": 0.0');
  parts.push('}');
  parts.push('Rules:');
  parts.push('- Use "unknown" when unsure.');
  parts.push('- Arrays max 8 items.');
  parts.push('- Use lower-case where possible, preserve proper nouns.');
  parts.push('- Only mention visible text if it is clearly legible.');
  parts.push('- Confidence is 0 to 1.');
  parts.push('- Use double quotes for all strings and keys.');
  parts.push('No extra text, no markdown.');

  return parts.join(' ');
}

function buildRetryPrompt(record: any): string {
  const parts: string[] = [];
  const name = cleanText(record.name || '');
  const date = extractDate(record);
  if (name || date) {
    parts.push(`Title: "${name || 'unknown'}".`);
    if (date) parts.push(`Date: ${date}.`);
  }

  parts.push('Return ONLY minified JSON with EXACT keys and double quotes:');
  parts.push('{\"objects\":[\"unknown\"],\"setting\":\"unknown\",\"actions\":[\"unknown\"],\"landmarks\":[\"unknown\"],\"time_period_guess\":\"unknown\",\"visible_text_guess\":\"unknown\",\"confidence\":0.5}');
  parts.push('Replace \"unknown\" with real values if visible. Arrays max 8 items.');
  parts.push('No markdown. No trailing commas. No extra text.');
  return parts.join(' ');
}

function getImageUrl(record: any): string | null {
  const filename = record.resolved_image_filename || record.image_filename;
  if (filename && R2_PUBLIC_DOMAIN && VLM_PREFER_R2) {
    return `https://${R2_PUBLIC_DOMAIN}/${encodeURIComponent(filename)}`;
  }
  if (record.external_url) {
    return record.external_url;
  }
  if (filename && R2_PUBLIC_DOMAIN) {
    return `https://${R2_PUBLIC_DOMAIN}/${encodeURIComponent(filename)}`;
  }
  return null;
}

const MAX_IMAGE_DIMENSION = 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;

async function fetchImageBytes(imageUrl: string): Promise<Uint8Array> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const originalBytes = new Uint8Array(buffer);

  if (originalBytes.length <= MAX_IMAGE_BYTES) {
    return originalBytes;
  }

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
    console.warn(`Could not resize image, using original: ${err}`);
    return originalBytes;
  }
}

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

async function tagImage(imageUrl: string, prompt: string): Promise<string> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${VLM_MODEL}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    let body: any;

    if (VLM_MODEL.includes('uform')) {
      const imageBytes = await fetchImageBytes(imageUrl);
      body = {
        image: Array.from(imageBytes),
        prompt: prompt,
        max_tokens: 256,
      };
    } else if (VLM_MODEL.includes('llava')) {
      const imageBytes = await fetchImageBytes(imageUrl);
      body = {
        image: Array.from(imageBytes),
        prompt: prompt,
        max_tokens: 256,
      };
    } else {
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
        max_tokens: 256,
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

    const result = json.result?.description
      || json.result?.response
      || json.result?.choices?.[0]?.message?.content
      || json.result?.output
      || json.result;

    if (typeof result === 'string') {
      return result.trim();
    }

    if (typeof result === 'object') {
      return JSON.stringify(result);
    }

    throw new Error(`Unexpected response shape: ${JSON.stringify(json)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty_response');

  let candidate = trimmed;
  if (candidate.startsWith('```')) {
    candidate = candidate.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no_json_object');
  }

  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice);
}

function normalizeArray(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean).slice(0, 8);
  }
  if (typeof value === 'string') {
    return value.split(',').map(cleanText).filter(Boolean).slice(0, 8);
  }
  return [];
}

function normalizeString(value: any): string {
  const cleaned = cleanText(value);
  return cleaned || 'unknown';
}

function normalizeConfidence(value: any): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(clamp(parsed, 0, 1).toFixed(4));
}

function normalizeTags(raw: any) {
  const objects = normalizeArray(raw?.objects);
  const actions = normalizeArray(raw?.actions);
  const landmarks = normalizeArray(raw?.landmarks);
  const setting = normalizeString(raw?.setting);
  const timePeriod = normalizeString(raw?.time_period_guess);
  const visibleText = normalizeString(raw?.visible_text_guess);
  const confidence = normalizeConfidence(raw?.confidence);

  return {
    tags: {
      objects: objects.length ? objects : ['unknown'],
      setting,
      actions: actions.length ? actions : ['unknown'],
      landmarks: landmarks.length ? landmarks : ['unknown'],
      time_period_guess: timePeriod,
      visible_text_guess: visibleText,
    },
    confidence,
  };
}

function needsTags(record: any): boolean {
  return !record.vlm_tags;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createRateLimiter(intervalMs: number): () => Promise<void> {
  let nextAvailable = 0;

  return async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextAvailable - now);
    nextAvailable = Math.max(nextAvailable, now) + intervalMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  };
}

function loadProcessedIds(outputPath: string, retryErrors: boolean): Set<string> {
  const processed = new Set<string>();
  if (!fs.existsSync(outputPath)) return processed;

  const raw = fs.readFileSync(outputPath, 'utf-8').trim();
  if (!raw) return processed;

  for (const line of raw.split('\n')) {
    try {
      const record = JSON.parse(line);
      if (!record || !record.metadata_filename) continue;
      if (retryErrors) {
        if (record.vlm_tags_error) continue;
        if (record.vlm_tags) {
          processed.add(record.metadata_filename);
        }
      } else {
        processed.add(record.metadata_filename);
      }
    } catch (err) {
      console.warn(`Skipping malformed JSONL line in ${outputPath}`);
    }
  }

  return processed;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      limit: { type: 'string' },
      offset: { type: 'string', default: '0' },
      all: { type: 'boolean', default: false },
      resume: { type: 'boolean', default: false },
      'retry-errors': { type: 'boolean', default: false },
      'retry-attempts': { type: 'string', default: '1' },
      concurrency: { type: 'string', default: '1' },
      'requests-per-minute': { type: 'string' },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const offset = parseInt(values.offset!, 10);
  const all = values.all;
  const resume = values.resume;
  const retryErrors = values['retry-errors'];
  const retryAttempts = Math.max(0, parseInt(values['retry-attempts']!, 10) || 0);
  const concurrency = Math.max(1, parseInt(values.concurrency!, 10) || 1);
  const requestsPerMinute = values['requests-per-minute']
    ? Math.max(1, parseInt(values['requests-per-minute'], 10))
    : (process.env.VLM_TAGS_REQUESTS_PER_MINUTE
      ? Math.max(1, parseInt(process.env.VLM_TAGS_REQUESTS_PER_MINUTE, 10))
      : (process.env.VLM_REQUESTS_PER_MINUTE
        ? Math.max(1, parseInt(process.env.VLM_REQUESTS_PER_MINUTE, 10))
        : DEFAULT_REQUESTS_PER_MINUTE));
  const delayMs = Math.ceil(60000 / requestsPerMinute);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`Reading from: ${inputPath}`);
  console.log(`Writing to: ${outputPath}`);
  console.log(`Model: ${VLM_MODEL}`);
  console.log(`All records: ${all}`);
  console.log(`Rate limit: ${requestsPerMinute} req/min (${delayMs}ms delay)`);
  console.log(`Concurrency: ${concurrency}`);
  if (resume) {
    console.log('Resume: true');
  }
  if (retryErrors) {
    console.log(`Retry errors: true (${retryAttempts} attempts)`);
  }
  console.log('');

  const raw = fs.readFileSync(inputPath, 'utf-8');
  let records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));

  if (offset > 0) {
    records = records.slice(offset);
    console.log(`Skipped ${offset} records (offset)`);
  }

  if (limit) {
    records = records.slice(0, limit);
    console.log(`Limited to ${limit} records`);
  }

  const toProcess = all ? records : records.filter(needsTags);

  console.log(`Total records: ${records.length}`);
  const processedIds = resume ? loadProcessedIds(outputPath, retryErrors) : new Set<string>();
  const remaining = toProcess.filter(record => !processedIds.has(record.metadata_filename));
  if (resume) {
    console.log(`Already written: ${processedIds.size}`);
  }
  console.log(`Records to tag: ${remaining.length}`);
  console.log('');

  const outputStream = fs.createWriteStream(outputPath, {
    encoding: 'utf-8',
    flags: resume ? 'a' : 'w',
  });

  const rateLimiter = createRateLimiter(delayMs);
  let handled = 0;
  let tagged = 0;
  let errors = 0;
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= records.length) break;

      const record = records[index];
      const recordId = record.metadata_filename;

      if (resume && processedIds.has(recordId)) {
        handled += 1;
        continue;
      }

      const shouldTag = all || needsTags(record);

      if (shouldTag) {
        const imageUrl = getImageUrl(record);

        if (!imageUrl) {
          record.vlm_tags = null;
          record.vlm_tags_error = 'no_image_url';
        } else {
          try {
            await rateLimiter();
            const prompt = buildPrompt(record);
            let responseText = await tagImage(imageUrl, prompt);
            let parsed: any;
            let attempt = 0;

            while (true) {
              try {
                parsed = extractJson(responseText);
                break;
              } catch (err) {
                if (attempt >= retryAttempts) {
                  throw err;
                }
                attempt += 1;
                const retryPrompt = buildRetryPrompt(record);
                responseText = await tagImage(imageUrl, retryPrompt);
              }
            }
            const normalized = normalizeTags(parsed);

            record.vlm_tags = normalized.tags;
            record.vlm_tags_confidence = normalized.confidence;
            record.vlm_tags_source = VLM_MODEL;
            record.vlm_tags_generated_at = new Date().toISOString();
            record.vlm_tags_error = null;

            tagged += 1;
            console.log(`[${tagged}/${remaining.length}] ${record.metadata_filename}: ${cleanText(record.vlm_tags.setting)}...`);
          } catch (err: any) {
            record.vlm_tags = null;
            record.vlm_tags_confidence = null;
            record.vlm_tags_source = VLM_MODEL;
            record.vlm_tags_generated_at = new Date().toISOString();
            record.vlm_tags_error = err.message;
            errors += 1;
            console.error(`Error tagging ${record.metadata_filename}: ${err.message}`);
            await sleep(delayMs * 2);
          }
        }
      }

      outputStream.write(JSON.stringify(record) + '\n');
      handled += 1;
    }
  });

  await Promise.all(workers);
  outputStream.end();

  console.log('');
  console.log('=== Complete ===');
  console.log(`Processed: ${handled}`);
  console.log(`Tagged: ${tagged}`);
  console.log(`Errors: ${errors}`);
  console.log(`Output: ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
