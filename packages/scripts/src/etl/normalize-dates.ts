import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_canonical.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_dated.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_dated_summary.json');

const FRENCH_MONTHS: Record<string, string> = {
  janvier: '01', jan: '01', janv: '01',
  février: '02', fevrier: '02', fév: '02', fev: '02',
  mars: '03', mar: '03',
  avril: '04', avr: '04',
  mai: '05',
  juin: '06', jun: '06',
  juillet: '07', juil: '07', jul: '07',
  août: '08', aout: '08', aoû: '08',
  septembre: '09', sept: '09', sep: '09',
  octobre: '10', oct: '10',
  novembre: '11', nov: '11',
  décembre: '12', decembre: '12', déc: '12', dec: '12',
};

function normalizeYear(yearStr: string): string | null {
  const trimmed = yearStr.trim();
  if (!trimmed) return null;
  const yearNum = Number(trimmed);
  if (!Number.isFinite(yearNum)) return null;
  let year = yearNum;
  if (year < 100) {
    year = 1900 + year;
  }
  if (year >= 1800 && year <= 2100) {
    return String(year);
  }
  return null;
}

function parseDate(dateStr: string): { value: string | null; confidence: number } {
  if (!dateStr) return { value: null, confidence: 0 };
  const raw = dateStr.trim();
  if (!raw) return { value: null, confidence: 0 };

  const decade = raw.match(/[Dd]écennie\s+(\d{4})/);
  if (decade) {
    return { value: `${decade[1]}s`, confidence: 0.6 };
  }

  const range = raw.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (range) {
    return { value: `${range[1]}-${range[2]}`, confidence: 0.7 };
  }

  const rangeShort = raw.match(/^(\d{4})\s*[-–]\s*(\d{2,4})$/);
  if (rangeShort) {
    const start = rangeShort[1];
    let end = rangeShort[2];
    if (end.length === 2) end = start.slice(0, 2) + end;
    return { value: `${start}-${end}`, confidence: 0.7 };
  }

  const yearOnly = raw.match(/^(\d{4})$/);
  if (yearOnly) {
    return { value: yearOnly[1], confidence: 0.9 };
  }

  const frenchDmy = raw.match(/^(\d{1,2})[-\s]([a-zéûô]+)\.?[-\s](\d{2,4})$/i);
  if (frenchDmy) {
    const monthStr = frenchDmy[2].toLowerCase().replace('.', '');
    const year = normalizeYear(frenchDmy[3]);
    if (FRENCH_MONTHS[monthStr] && year) {
      return { value: year, confidence: 0.8 };
    }
  }

  const frenchFull = raw.match(/^(\d{1,2})(?:er|e|ème)?\s+([a-zéûô]+)\s+(\d{4})$/i);
  if (frenchFull) {
    return { value: frenchFull[3], confidence: 0.8 };
  }

  const monthYear = raw.match(/^([a-zéûô]+)\s+(\d{4})$/i);
  if (monthYear) {
    return { value: monthYear[2], confidence: 0.7 };
  }

  const endDate = raw.match(/[-–]\s*(\d{1,2})\s+([a-zéûô]+)\s+(\d{4})\s*$/i);
  if (endDate) {
    return { value: endDate[3], confidence: 0.6 };
  }

  const abbrev = raw.match(/^([a-zéûô]+)\.?[-\s](\d{2})$/i);
  if (abbrev) {
    const year = normalizeYear(abbrev[2]);
    if (year) {
      return { value: year, confidence: 0.6 };
    }
  }

  const yearAnywhere = raw.match(/(\d{4})/);
  if (yearAnywhere) {
    const year = Number(yearAnywhere[1]);
    if (year >= 1800 && year <= 2100) {
      return { value: yearAnywhere[1], confidence: 0.5 };
    }
  }

  return { value: null, confidence: 0 };
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
    date_value_added: 0,
    date_value_existing: 0,
    date_missing: 0,
    parse_failed: 0,
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
      if (record.date_value) {
        summary.date_value_existing += 1;
        outputStream.write(JSON.stringify(record) + '\n');
        continue;
      }

      const dateRaw = record.date_raw || record.attributes_map?.Date || record.portal_date_raw || '';
      if (!dateRaw) {
        summary.date_missing += 1;
        outputStream.write(JSON.stringify(record) + '\n');
        continue;
      }

      const parsed = parseDate(dateRaw);
      if (parsed.value) {
        record.date_value = parsed.value;
        record.date_confidence = parsed.confidence;
        summary.date_value_added += 1;
      } else {
        summary.parse_failed += 1;
      }

      outputStream.write(JSON.stringify(record) + '\n');
    } catch (err) {
      console.error('Failed to process line:', err);
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote dated manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
