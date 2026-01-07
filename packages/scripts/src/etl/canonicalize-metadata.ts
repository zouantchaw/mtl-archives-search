import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_canonical.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_canonical_summary.json');

const ABBREVIATION_MAP: Record<string, string> = {
  's/o': '',
  'sans objet': '',
  'n/d': '',
  'n.a.': '',
  'n/a': '',
};

function cleanText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  text = text.normalize('NFC');
  text = text.replace(/\u2019/g, "'").replace(/\u2013/g, '-').replace(/\u2014/g, '-');
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/^Sans objet \(aucune description fournie\)\.\s*/i, '');
  return text.trim();
}

function expandAbbreviation(text: string): string {
  const key = text.toLowerCase();
  if (key in ABBREVIATION_MAP) {
    return ABBREVIATION_MAP[key];
  }
  return text;
}

function isCodeLikeTitle(value: string): boolean {
  if (!value) return true;
  if (/\.(jpg|jpeg|png|tif|tiff)$/i.test(value)) return true;
  if (/^VM\d+[,\-_]/i.test(value)) return true;
  if (/^[\d\s,._-]+$/.test(value)) return true;
  const alpha = value.replace(/VM\d+|[\d\s,._-]/gi, '').trim();
  return alpha.length < 3;
}

function heuristicLanguageGuess(value: string): string {
  const lower = value.toLowerCase();
  const frenchMarkers = ['é', 'è', 'à', 'ç', ' qué', ' montréal']
    .reduce((acc, marker) => acc + (lower.split(marker).length - 1), 0);
  const englishMarkers = ['the ', ' and ', 'street', ' avenue', 'montreal']
    .reduce((acc, marker) => acc + (lower.split(marker).length - 1), 0);

  if (frenchMarkers > englishMarkers && frenchMarkers >= 1) return 'fr';
  if (englishMarkers > frenchMarkers && englishMarkers >= 1) return 'en';
  return 'unknown';
}

function detectLanguageLabel(value: string): string {
  if (!value || value.length < 24) return 'unknown';
  return heuristicLanguageGuess(value);
}

function buildAttributesMap(attributes: any[] | undefined): Record<string, string> {
  const attrMap: Record<string, string> = {};
  for (const attr of attributes || []) {
    if (attr && typeof attr === 'object' && attr.trait_type) {
      attrMap[attr.trait_type] = cleanText(attr.value);
    }
  }
  return Object.fromEntries(Object.entries(attrMap).filter(([_, v]) => v));
}

function getPortalField(portal: Record<string, unknown>, key: string): string {
  if (!portal || typeof portal !== 'object') return '';
  return cleanText((portal as Record<string, unknown>)[key]);
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
    description_source_counts: {} as Record<string, number>,
    quality_flag_counts: {} as Record<string, number>,
    title_code_like_count: 0,
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

    try {
      const record = JSON.parse(line);
      const portalRecord = { ...(record.portal_record || {}) };

      const titleRaw = record.name ?? '';
      const descriptionRaw = record.description ?? '';
      const portalTitleRaw = getPortalField(portalRecord, 'Titre');
      const portalDescriptionRaw = getPortalField(portalRecord, 'Description');
      const portalDateRaw = getPortalField(portalRecord, 'Date');
      const portalCoteRaw = getPortalField(portalRecord, 'Cote');
      const portalCreditsRaw = getPortalField(portalRecord, 'Mention de crédits');

      const titleClean = expandAbbreviation(cleanText(titleRaw));
      const titleIsCodeLike = isCodeLikeTitle(titleClean);
      const titleNormalized = titleIsCodeLike ? '' : titleClean;

      const descriptionClean = expandAbbreviation(cleanText(descriptionRaw));
      const portalDescriptionClean = expandAbbreviation(portalDescriptionRaw);

      let descriptionNormalized = '';
      let descriptionSource = 'missing';
      if (descriptionClean) {
        descriptionNormalized = descriptionClean;
        descriptionSource = 'original';
      } else if (portalDescriptionClean) {
        descriptionNormalized = portalDescriptionClean;
        descriptionSource = 'portal';
      }

      const descriptionLanguage = detectLanguageLabel(descriptionNormalized);

      const attributesMap = buildAttributesMap(record.attributes);

      const dateRaw = attributesMap.Date || portalDateRaw || '';
      const dateRawSource = attributesMap.Date ? 'attributes' : portalDateRaw ? 'portal' : 'missing';

      const credits = cleanText(record.credits || attributesMap.Credits || portalCreditsRaw);
      const cote = cleanText(attributesMap.Cote || portalCoteRaw);

      const qualityFlags: string[] = [];
      if (!titleNormalized) qualityFlags.push('missing-title');
      if (titleIsCodeLike) qualityFlags.push('code-like-title');
      if (!descriptionNormalized) qualityFlags.push('missing-description');
      if (descriptionNormalized && descriptionNormalized.length < 50) qualityFlags.push('short-description');
      if (descriptionNormalized && descriptionNormalized === descriptionNormalized.toUpperCase()) {
        qualityFlags.push('uppercase-description');
      }

      if (titleIsCodeLike) summary.title_code_like_count += 1;
      summary.total_records += 1;
      summary.description_source_counts[descriptionSource] =
        (summary.description_source_counts[descriptionSource] || 0) + 1;
      for (const flag of qualityFlags) {
        summary.quality_flag_counts[flag] = (summary.quality_flag_counts[flag] || 0) + 1;
      }

      const canonical = {
        metadata_schema_version: 2,
        metadata_filename: record.metadata_filename,
        image_filename: record.image_filename,
        resolved_image_filename: record.resolved_image_filename,
        image_exists: record.image_exists,
        image_size_bytes: record.image_size_bytes,
        external_url: record.external_url,
        portal_match: record.portal_match,
        portal_record: portalRecord,
        attributes: record.attributes,
        attributes_map: attributesMap,
        aerial_matches: record.aerial_matches,
        name: record.name,
        description: record.description,
        title_raw: titleRaw,
        title_normalized: titleNormalized,
        title_is_code_like: titleIsCodeLike,
        description_raw: descriptionRaw,
        description_normalized: descriptionNormalized,
        description_source: descriptionSource,
        description_language: descriptionLanguage,
        portal_title_raw: portalTitleRaw,
        portal_description_raw: portalDescriptionRaw,
        portal_date_raw: portalDateRaw,
        portal_cote_raw: portalCoteRaw,
        portal_credits_raw: portalCreditsRaw,
        portal_title_normalized: portalTitleRaw ? cleanText(portalTitleRaw) : '',
        portal_description_normalized: portalDescriptionRaw ? cleanText(portalDescriptionRaw) : '',
        date_raw: dateRaw,
        date_raw_source: dateRawSource,
        credits,
        cote,
        metadata_quality: {
          quality_flags: qualityFlags,
        },
      };

      outputStream.write(JSON.stringify(canonical) + '\n');
    } catch (err) {
      console.error('Failed to process line:', err);
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote canonical manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
