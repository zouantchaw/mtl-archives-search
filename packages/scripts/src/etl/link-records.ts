import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_dated.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked_summary.json');
const PORTAL_DATASTORE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/phototheque_datastore.json');

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeCote(value: string): string {
  return cleanText(value).toUpperCase().replace(/\s+/g, '');
}

function filenameFromUrl(url: string): string {
  if (!url) return '';
  const parts = url.split('/');
  const last = parts[parts.length - 1] || '';
  const clean = last.split('?')[0];
  return decodeURIComponent(clean);
}

function loadPortalRecords() {
  if (!fs.existsSync(PORTAL_DATASTORE)) {
    console.warn(`Portal datastore not found: ${PORTAL_DATASTORE}`);
    return [];
  }
  const raw = fs.readFileSync(PORTAL_DATASTORE, 'utf-8');
  const json = JSON.parse(raw);
  return json?.result?.records || [];
}

function buildPortalIndexes(records: any[]) {
  const byCote = new Map<string, any>();
  const byFilename = new Map<string, any>();

  for (const record of records) {
    const cote = normalizeCote(record?.Cote || '');
    if (cote && !byCote.has(cote)) {
      byCote.set(cote, record);
    }

    const jpgUrl = record?.['Fichier jpg - 200 dpi'] || '';
    const tifUrl = record?.['Fichier tif - 300 dpi'] || '';
    const jpgName = filenameFromUrl(jpgUrl);
    const tifName = filenameFromUrl(tifUrl);

    if (jpgName && !byFilename.has(jpgName)) {
      byFilename.set(jpgName, record);
    }
    if (tifName && !byFilename.has(tifName)) {
      byFilename.set(tifName, record);
    }
  }

  return { byCote, byFilename };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const summaryPath = values.summary!;

  if (!fs.existsSync(inputPath)) {
    console.error(`Input manifest not found: ${inputPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const portalRecords = loadPortalRecords();
  const { byCote, byFilename } = buildPortalIndexes(portalRecords);

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    output_path: outputPath,
    total_records: 0,
    portal_linked_total: 0,
    portal_linked_existing: 0,
    portal_linked_new: 0,
    portal_link_methods: {} as Record<string, number>,
  };

  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    summary.total_records += 1;

    try {
      const record = JSON.parse(line);
      const existingPortal = record.portal_record && Object.keys(record.portal_record).length > 0;
      let portalRecord = existingPortal ? record.portal_record : null;
      let linkMethod = existingPortal ? 'existing' : '';

      if (!portalRecord) {
        const cote = normalizeCote(record.cote || record.portal_cote_raw || '');
        if (cote && byCote.has(cote)) {
          portalRecord = byCote.get(cote);
          linkMethod = 'cote';
        }
      }

      if (!portalRecord) {
        const fileName = filenameFromUrl(record.external_url || '')
          || record.resolved_image_filename
          || record.image_filename
          || '';
        if (fileName && byFilename.has(fileName)) {
          portalRecord = byFilename.get(fileName);
          linkMethod = 'file';
        }
      }

      if (portalRecord) {
        summary.portal_linked_total += 1;
        summary.portal_link_methods[linkMethod] = (summary.portal_link_methods[linkMethod] || 0) + 1;
        if (linkMethod === 'existing') {
          summary.portal_linked_existing += 1;
        } else {
          summary.portal_linked_new += 1;
        }
      }

      const recordLinkId = portalRecord ? `portal:${portalRecord._id}` : null;
      const recordLinkConfidence = portalRecord
        ? linkMethod === 'file' ? 1.0 : linkMethod === 'cote' ? 0.9 : 1.0
        : null;
      const recordLinkEvidence = portalRecord ? {
        portal: {
          method: linkMethod,
          portal_id: portalRecord._id ?? null,
          portal_cote: portalRecord.Cote ?? null,
          portal_file_url: portalRecord['Fichier jpg - 200 dpi'] || portalRecord['Fichier tif - 300 dpi'] || null,
        },
      } : null;

      const linked = {
        ...record,
        portal_record: portalRecord || record.portal_record || null,
        record_link_id: recordLinkId,
        record_link_confidence: recordLinkConfidence,
        record_link_evidence: recordLinkEvidence,
      };

      outputStream.write(JSON.stringify(linked) + '\n');
    } catch (err) {
      console.error('Failed to process line:', err);
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote linked manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
