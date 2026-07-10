import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { readJsonl, writeJson, writeJsonl } from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_PACKET = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/graph/review-packet-v1.jsonl');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/review-images');

type PacketRow = {
  review_id: string;
  stratum: string;
  edge_type: string;
  threshold: string | null;
  source_record_id: string;
  target_record_id: string;
  source_image_url: string;
  target_image_url: string;
};

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

async function fetchBounded(urlText: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || url.username || url.password || /X-Amz-|Signature=/i.test(url.search)) throw new Error(`Unsafe review URL for ${url.hostname}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'image/*' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error(`declared response ${declared} exceeds ${maxBytes}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error(`actual response ${buffer.byteLength} exceeds ${maxBytes}`);
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function unavailableImage(side: string, error: string): Promise<Buffer> {
  const label = `<svg width="384" height="384" xmlns="http://www.w3.org/2000/svg">
    <rect width="384" height="384" fill="#eeeeee"/>
    <text x="24" y="170" font-family="Arial, sans-serif" font-size="22" fill="#333333">${escapeXml(side)} unavailable</text>
    <text x="24" y="205" font-family="Arial, sans-serif" font-size="15" fill="#555555">${escapeXml(error.slice(0, 42))}</text>
    <text x="24" y="240" font-family="Arial, sans-serif" font-size="15" fill="#555555">Adjudication must abstain.</text>
  </svg>`;
  return sharp(Buffer.from(label)).jpeg({ quality: 86 }).toBuffer();
}

async function pairImage(row: PacketRow, maxBytes: number, timeoutMs: number): Promise<{ buffer: Buffer; failures: Array<{ side: string; error: string }> }> {
  const fetched = await Promise.allSettled([
    fetchBounded(row.source_image_url, maxBytes, timeoutMs),
    fetchBounded(row.target_image_url, maxBytes, timeoutMs),
  ]);
  const failures: Array<{ side: string; error: string }> = [];
  const normalized = await Promise.all(fetched.map(async (result, index) => {
    const side = index === 0 ? 'source' : 'target';
    if (result.status === 'rejected') {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push({ side, error });
      return unavailableImage(side, error);
    }
    return sharp(result.value, { failOn: 'none' })
      .rotate()
      .resize(384, 384, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 86 })
      .toBuffer();
  }));
  const label = `<svg width="800" height="118" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="118" fill="#ffffff"/>
    <text x="16" y="25" font-family="Arial, sans-serif" font-size="17" fill="#111111">${escapeXml(row.review_id)}</text>
    <text x="16" y="50" font-family="Arial, sans-serif" font-size="15" fill="#333333">${escapeXml(row.stratum)} | ${escapeXml(row.edge_type)} | ${escapeXml(row.threshold ?? 'n/a')}</text>
    <text x="16" y="78" font-family="Arial, sans-serif" font-size="14" fill="#111111">A: ${escapeXml(row.source_record_id)}</text>
    <text x="410" y="78" font-family="Arial, sans-serif" font-size="14" fill="#111111">B: ${escapeXml(row.target_record_id)}</text>
    <text x="16" y="104" font-family="Arial, sans-serif" font-size="13" fill="#555555">Record positive, negative, or abstain only after inspecting both frames.</text>
  </svg>`;
  const buffer = await sharp({ create: { width: 800, height: 510, channels: 3, background: '#e9e9e9' } })
    .composite([
      { input: normalized[0], left: 8, top: 8 },
      { input: normalized[1], left: 408, top: 8 },
      { input: Buffer.from(label), left: 0, top: 392 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
  return { buffer, failures };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      packet: { type: 'string', default: DEFAULT_PACKET },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'max-response-bytes': { type: 'string', default: '1572864' },
      'timeout-ms': { type: 'string', default: '30000' },
      'pairs-per-sheet': { type: 'string', default: '6' },
    },
  });
  const packetPath = resolvePath(values.packet!);
  const outputDir = resolvePath(values.output!);
  const maxBytes = Number.parseInt(values['max-response-bytes']!, 10);
  const timeoutMs = Number.parseInt(values['timeout-ms']!, 10);
  const pairsPerSheet = Number.parseInt(values['pairs-per-sheet']!, 10);
  if (!Number.isInteger(maxBytes) || maxBytes < 65536 || maxBytes > 4 * 1024 * 1024) throw new Error('max-response-bytes must be 65536..4194304');
  if (!Number.isInteger(pairsPerSheet) || pairsPerSheet < 1 || pairsPerSheet > 8) throw new Error('pairs-per-sheet must be 1..8');
  const packet = readJsonl<PacketRow>(packetPath);
  fs.mkdirSync(path.join(outputDir, 'pairs'), { recursive: true });
  const rendered: Array<{ review_id: string; path: string; sheet: string }> = [];
  const buffers: Buffer[] = [];
  const renderFailures: Array<{ review_id: string; side: string; error: string }> = [];
  for (let index = 0; index < packet.length; index += 1) {
    const row = packet[index];
    const result = await pairImage(row, maxBytes, timeoutMs);
    const pairPath = path.join(outputDir, 'pairs', `${row.review_id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`);
    fs.writeFileSync(pairPath, result.buffer);
    buffers.push(result.buffer);
    renderFailures.push(...result.failures.map((failure) => ({ review_id: row.review_id, ...failure })));
    if ((index + 1) % 10 === 0) console.log(`[vfg-v1:review-render] ${index + 1}/${packet.length}`);
  }
  for (let start = 0; start < packet.length; start += pairsPerSheet) {
    const rows = packet.slice(start, start + pairsPerSheet);
    const sheetNumber = Math.floor(start / pairsPerSheet) + 1;
    const sheetName = `review-sheet-${String(sheetNumber).padStart(2, '0')}.jpg`;
    const sheetPath = path.join(outputDir, sheetName);
    const columns = 2;
    const rowsCount = Math.ceil(rows.length / columns);
    const composites = rows.map((_, offset) => ({ input: buffers[start + offset], left: (offset % columns) * 800, top: Math.floor(offset / columns) * 510 }));
    await sharp({ create: { width: 1600, height: rowsCount * 510, channels: 3, background: '#dddddd' } }).composite(composites).jpeg({ quality: 88 }).toFile(sheetPath);
    rows.forEach((row) => rendered.push({ review_id: row.review_id, path: `pairs/${row.review_id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`, sheet: sheetName }));
  }
  writeJsonl(path.join(outputDir, 'review-render-failures.jsonl'), renderFailures);
  writeJson(path.join(outputDir, 'review-index.json'), { packet: packetPath, pair_count: packet.length, rendered, render_failures: renderFailures.length, direct_inspection_required: true });
  console.log(JSON.stringify({ status: 'ok', pairs: packet.length, sheets: Math.ceil(packet.length / pairsPerSheet), render_failures: renderFailures.length, output: outputDir }));
}

main().catch((error) => {
  console.error(`[vfg-v1:review-render] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
