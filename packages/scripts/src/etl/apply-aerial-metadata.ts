import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_aerial.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_aerial_summary.json');

const PHOTO_SERIES_PATTERN = /Le reportage photographique comprend les lieux et bâtiments suivants\s*:?\s*(.+)/is;

const FILE_URL_KEYS = [
  'Fichier jpg - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier tiff - 600 dpi',
  'Fichiers TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier tif - 300 dpi',
  'Fichier jpg - 200 dpi',
];

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function isCodeLikeTitle(value: string): boolean {
  if (!value) return true;
  if (/\.(jpg|jpeg|png|tif|tiff|pdf)$/i.test(value)) return true;
  if (/^VM\d+[,\-_]/i.test(value)) return true;
  if (/^[\d\s,._-]+$/.test(value)) return true;
  const alpha = value.replace(/VM\d+|[\d\s,._-]/gi, '').trim();
  return alpha.length < 3;
}

function parsePhotoSeries(description: string, imageNum: number | null): { text: string; parsed: boolean } {
  const match = description.match(PHOTO_SERIES_PATTERN);
  if (!match) {
    return { text: description, parsed: false };
  }

  const content = match[1];

  if (imageNum === null) {
    const locations = Array.from(content.matchAll(/([^(]+?)\s*\((?:image|images)\s*[\d\s,-]+\)/gi));
    if (locations.length > 0) {
      const cleanLocations = locations.map(m => m[1].trim()).filter(Boolean);
      return {
        text: `Reportage photographique: ${cleanLocations.slice(0, 5).join('; ')}.`,
        parsed: true,
      };
    }
    return { text: `${content.slice(0, 200).trim()}...`, parsed: true };
  }

  const entries = Array.from(content.matchAll(/([^(]+?)\s*\((?:image|images)\s*([\d\s,-]+)\)/gi));
  for (const entry of entries) {
    const location = entry[1].trim();
    const imageRange = entry[2];
    const numbers = new Set<number>();

    const parts = imageRange.match(/\d+/g);
    if (parts) {
      parts.forEach(p => numbers.add(parseInt(p, 10)));
    }

    const rangeMatches = imageRange.matchAll(/(\d+)\s*-\s*(\d+)/g);
    for (const rangeMatch of rangeMatches) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i += 1) {
        numbers.add(i);
      }
    }

    if (numbers.has(imageNum)) {
      return { text: location, parsed: true };
    }
  }

  if (entries.length > 0) {
    return { text: entries[0][1].trim(), parsed: true };
  }

  return { text: `${content.slice(0, 150).trim()}...`, parsed: true };
}

function extractImageIndexFromUrl(url: string): number | null {
  if (!url) return null;
  const clean = url.split('?')[0];
  const match = clean.match(/[-_](\d{1,4})\.(jpg|jpeg|png|tif|tiff|pdf)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

function parseDate(dateStr: string): { value: string | null; confidence: number } {
  if (!dateStr) return { value: null, confidence: 0 };
  const raw = String(dateStr).trim();
  if (!raw) return { value: null, confidence: 0 };

  const decade = raw.match(/[Dd]écennie\s+(\d{4})/);
  if (decade) return { value: `${decade[1]}s`, confidence: 0.6 };

  const range = raw.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (range) return { value: `${range[1]}-${range[2]}`, confidence: 0.7 };

  const yearOnly = raw.match(/^(\d{4})$/);
  if (yearOnly) return { value: yearOnly[1], confidence: 0.9 };

  const yearAnywhere = raw.match(/(\d{4})/);
  if (yearAnywhere) return { value: yearAnywhere[1], confidence: 0.5 };

  return { value: null, confidence: 0 };
}

function extractTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  const cleaned = rawTitle.replace(/\r?\n/g, ' ').trim();
  const split = cleaned.split(' / ')[0].trim();
  return split || cleaned;
}

function getFileUrl(record: Record<string, unknown>): string {
  for (const key of FILE_URL_KEYS) {
    const value = record[key];
    if (value) return String(value);
  }
  return '';
}

function selectBestMatch(matches: any[]) {
  if (!matches.length) return null;
  return matches.find(m => m.dataset === 'aerial_obliques_1960_1992') || matches[0];
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

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    output_path: outputPath,
    total_records: 0,
    with_aerial_matches: 0,
    aerial_description_added: 0,
    aerial_title_added: 0,
    aerial_date_added: 0,
    aerial_credits_added: 0,
    series_parsed: 0,
    dataset_counts: {} as Record<string, number>,
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
      const matches = record.aerial_matches || [];
      if (matches.length) {
        summary.with_aerial_matches += 1;
      }

      let aerialTitle = '';
      let aerialDescription = '';
      let aerialDateRaw = '';
      let aerialDateValue: string | null = null;
      let aerialDateConfidence = 0;
      let aerialCredits = '';
      let aerialCote = '';
      let aerialDataset = '';
      let seriesParsed = false;

      const selected = selectBestMatch(matches);
      if (selected && selected.record) {
        const dataset = selected.dataset || 'unknown';
        summary.dataset_counts[dataset] = (summary.dataset_counts[dataset] || 0) + 1;
        aerialDataset = dataset;

        const matchRecord = selected.record as Record<string, unknown>;
        const rawTitle = cleanText(matchRecord['Titre'])
          || cleanText(matchRecord['Cote/Titre'])
          || cleanText(matchRecord['Titre / Photographe / Dates']);
        const extractedTitle = extractTitle(rawTitle);
        if (extractedTitle && !isCodeLikeTitle(extractedTitle) && !/Carte index/i.test(extractedTitle)) {
          aerialTitle = extractedTitle;
        }

        const rawDescription = cleanText(matchRecord['Description']);
        if (rawDescription) {
          const imageNum = extractImageIndexFromUrl(record.external_url || '')
            || extractImageIndexFromUrl(getFileUrl(matchRecord));
          const parsed = parsePhotoSeries(rawDescription, imageNum);
          aerialDescription = parsed.text;
          seriesParsed = parsed.parsed;
        }

        const rawDates = cleanText(matchRecord['Dates']);
        const dateCandidate = rawDates || rawTitle;
        if (dateCandidate) {
          const parsedDate = parseDate(dateCandidate);
          aerialDateRaw = dateCandidate;
          aerialDateValue = parsedDate.value;
          aerialDateConfidence = parsedDate.confidence;
        }

        aerialCredits = cleanText(matchRecord['Mention de crédits']);
        aerialCote = cleanText(matchRecord['Cote (reportage)'] || matchRecord['Cote']);
      }

      if (aerialDescription) summary.aerial_description_added += 1;
      if (aerialTitle) summary.aerial_title_added += 1;
      if (aerialDateValue) summary.aerial_date_added += 1;
      if (aerialCredits) summary.aerial_credits_added += 1;
      if (seriesParsed) summary.series_parsed += 1;

      let descriptionNormalized = record.description_normalized || '';
      let descriptionSource = record.description_source || 'missing';
      if (!descriptionNormalized && aerialDescription) {
        descriptionNormalized = aerialDescription;
        descriptionSource = 'aerial';
      }

      let titleNormalized = record.title_normalized || '';
      if (!titleNormalized && aerialTitle) {
        titleNormalized = aerialTitle;
      }

      let dateValue = record.date_value || null;
      let dateConfidence = record.date_confidence || null;
      if (!dateValue && aerialDateValue) {
        dateValue = aerialDateValue;
        dateConfidence = aerialDateConfidence;
      }

      let credits = record.credits || '';
      if (!credits && aerialCredits) {
        credits = aerialCredits;
      }

      const enriched = {
        ...record,
        title_normalized: titleNormalized,
        description_normalized: descriptionNormalized,
        description_source: descriptionSource,
        date_value: dateValue,
        date_confidence: dateConfidence,
        credits,
        aerial_title: aerialTitle || null,
        aerial_description: aerialDescription || null,
        aerial_date_raw: aerialDateRaw || null,
        aerial_date_value: aerialDateValue,
        aerial_date_confidence: aerialDateConfidence || null,
        aerial_credits: aerialCredits || null,
        aerial_cote: aerialCote || null,
        aerial_source_dataset: aerialDataset || null,
      };

      outputStream.write(JSON.stringify(enriched) + '\n');
    } catch (err) {
      console.error('Failed to process line:', err);
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote aerial-enriched manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
