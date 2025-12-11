import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
// Resolve paths relative to the monorepo root (packages/scripts/src/etl -> ../../../..)
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean_summary.json');

const ABBREVIATION_MAP: Record<string, string> = {
  "s/o": "",
  "sans objet": "",
  "n/d": "",
  "n.a.": "",
  "n/a": "",
};

const PHOTO_SERIES_PATTERN = /Le reportage photographique comprend les lieux et bâtiments suivants\s*:?\s*(.+)/is;

function cleanText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let text = String(value);
  text = text.normalize("NFC");
  text = text.replace(/\u2019/g, "'").replace(/\u2013/g, "-").replace(/\u2014/g, "-");
  text = text.replace(/\s+/g, " ");
  // Remove "Sans objet" prefix
  text = text.replace(/^Sans objet \(aucune description fournie\)\.\s*/i, "");
  return text.trim();
}

function extractImageFromFilename(filename: string): number | null {
  let match = filename.match(/image[_-](\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  match = filename.match(/_(\d+)\.(jpg|jpeg|png|tif|tiff)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

function parsePhotoSeries(description: string, imageNum: number | null = null): { text: string; parsed: boolean } {
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
        text: "Reportage photographique: " + cleanLocations.slice(0, 5).join("; ") + ".",
        parsed: true 
      };
    }
    return { text: content.slice(0, 200).trim() + "...", parsed: true };
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
      for (let i = start; i <= end; i++) {
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

  return { text: content.slice(0, 150).trim() + "...", parsed: true };
}

function expandAbbreviation(text: string): { text: string; changed: boolean } {
  const key = text.toLowerCase();
  if (key in ABBREVIATION_MAP) {
    return { text: ABBREVIATION_MAP[key], changed: true };
  }
  return { text, changed: false };
}

function mergeDescriptions(primary: string, secondary: string): { value: string; source: string } {
  const cleanedPrimary = cleanText(primary);
  const cleanedSecondary = cleanText(secondary);

  if (cleanedPrimary) {
    const { text, changed } = expandAbbreviation(cleanedPrimary);
    if (changed) {
      return { value: text, source: "expanded-abbreviation" };
    }
    return { value: cleanedPrimary, source: "original" };
  }

  if (cleanedSecondary) {
    const { text, changed } = expandAbbreviation(cleanedSecondary);
    if (changed) {
      return { value: text, source: "portal-expanded" };
    }
    return { value: cleanedSecondary, source: "portal" };
  }

  return { value: "", source: "missing" };
}

function buildSyntheticDescription(record: any): string {
  const name = cleanText(record.name);
  const attributes = record.attributes || [];
  const attrMap: Record<string, string> = {};
  for (const attr of attributes) {
    if (attr && typeof attr === 'object') {
      attrMap[attr.trait_type] = attr.value;
    }
  }
  
  const dateValue = cleanText(attrMap["Date"]);
  const coteValue = cleanText(attrMap["Cote"]);
  const portal = record.portal_record || {};
  const locationHint = cleanText(portal["Lieu"]);

  const fragments: string[] = [];
  if (name) {
    fragments.push(name.replace(/\.+$/, "") + ".");
  } else {
    fragments.push("Photographie d'archive de Montréal.");
  }

  if (dateValue) {
    fragments.push(`Capturée ou datée de ${dateValue}.`);
  }
  if (locationHint) {
    fragments.push(`Localisation: ${locationHint}.`);
  }
  if (coteValue) {
    fragments.push(`Cote archivistique ${coteValue}.`);
  }

  if (fragments.length === 0 || fragments.join(" ").length < 48) {
    const extra = cleanText(portal["Description"]);
    if (extra && !fragments.includes(extra.replace(/\.+$/, "") + ".")) {
      fragments.push(extra.replace(/\.+$/, "") + ".");
    }
  }

  let composed = fragments.join(" ").trim();
  if (composed.length < 50) {
    composed += " Détails supplémentaires non disponibles; description générée automatiquement.";
  }
  return composed;
}

function heuristicLanguageGuess(value: string): string {
  const lower = value.toLowerCase();
  const frenchMarkers = ["é", "è", "à", "ç", " qué", " montréal"].reduce((acc, marker) => acc + (lower.split(marker).length - 1), 0);
  const englishMarkers = ["the ", " and ", "street", " avenue", "montreal"].reduce((acc, marker) => acc + (lower.split(marker).length - 1), 0);
  
  if (frenchMarkers > englishMarkers && frenchMarkers >= 1) return "fr";
  if (englishMarkers > frenchMarkers && englishMarkers >= 1) return "en";
  return "unknown";
}

function detectLanguageLabel(value: string): string {
  if (!value || value.length < 24) return "unknown";
  return heuristicLanguageGuess(value);
}

function enrichRecord(record: any): { cleaned: any; quality: any } {
  const cleaned = { ...record };
  cleaned.metadata_schema_version = 1;

  const attributes = cleaned.attributes || [];
  const attrMap: Record<string, string> = {};
  for (const attr of attributes) {
    if (attr && typeof attr === 'object') {
      attrMap[attr.trait_type] = cleanText(attr.value);
    }
  }
  // Filter out empty values
  cleaned.attributes_map = Object.fromEntries(Object.entries(attrMap).filter(([_, v]) => v));

  const portalRecord = { ...(cleaned.portal_record || {}) };
  for (const key of ["Titre", "Description", "Date", "Cote", "Mention de crédits", "Lieu"]) {
    if (key in portalRecord) {
      portalRecord[key] = cleanText(portalRecord[key]);
    }
  }
  cleaned.portal_record = portalRecord;

  cleaned.name = cleanText(cleaned.name);

  const rawDescription = cleanText(cleaned.description);
  const portalDescription = portalRecord["Description"] || "";

  let { value: descriptionValue, source: descriptionSource } = mergeDescriptions(rawDescription, portalDescription);

  const imageFilename = cleaned.image_filename || cleaned.resolved_image_filename || "";
  const imageNum = extractImageFromFilename(imageFilename);

  if (descriptionValue) {
    const { text: parsedDesc, parsed: wasSeries } = parsePhotoSeries(descriptionValue, imageNum);
    if (wasSeries) {
      descriptionValue = parsedDesc;
      descriptionSource = `${descriptionSource}+series-parsed`;
    }
  }

  let syntheticUsed = false;
  if (!descriptionValue || descriptionValue.length < 10) {
    descriptionValue = buildSyntheticDescription(cleaned);
    descriptionSource = "synthetic";
    syntheticUsed = true;
  } else if (descriptionValue.length < 50) {
    const syntheticAppend = buildSyntheticDescription(cleaned);
    if (syntheticAppend && !descriptionValue.toLowerCase().includes(syntheticAppend.toLowerCase())) {
      descriptionValue = `${descriptionValue}. ${syntheticAppend}`.trim();
      descriptionSource = `${descriptionSource}+synthetic`;
      syntheticUsed = true;
    }
  }

  cleaned.raw_description = record.description;
  cleaned.description = descriptionValue;
  cleaned.description_source = descriptionSource;
  
  let language = detectLanguageLabel(descriptionValue);
  if (language === "unknown") {
    language = heuristicLanguageGuess(descriptionValue);
  }
  cleaned.description_language = language || "unknown";
  cleaned.portal_description_clean = portalDescription;

  const credits = cleanText(cleaned.credits || portalRecord["Mention de crédits"]);
  cleaned.credits = credits;

  const normalizedCote = cleanText(attrMap["Cote"]) || cleanText(portalRecord["Cote"]);
  cleaned.cote = normalizedCote;

  const qualityFlags: string[] = [];
  if (syntheticUsed) qualityFlags.push("synthetic-description");
  if (descriptionValue.length < 50) qualityFlags.push("short-description");
  if (descriptionValue === descriptionValue.toUpperCase() && descriptionValue) qualityFlags.push("uppercase-description");

  cleaned.metadata_quality = {
    description_source: descriptionSource,
    quality_flags: qualityFlags,
  };

  return { 
    cleaned, 
    quality: {
      description_source: descriptionSource,
      synthetic_used: syntheticUsed,
      quality_flags: qualityFlags
    }
  };
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
  };

  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  // Read line by line
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const record = JSON.parse(line);
      const { cleaned, quality } = enrichRecord(record);
      
      summary.total_records++;
      
      const source = quality.description_source;
      summary.description_source_counts[source] = (summary.description_source_counts[source] || 0) + 1;
      
      for (const flag of quality.quality_flags) {
        summary.quality_flag_counts[flag] = (summary.quality_flag_counts[flag] || 0) + 1;
      }
      
      outputStream.write(JSON.stringify(cleaned) + '\n');
    } catch (err) {
      console.error("Failed to process line:", err);
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote cleaned manifest to ${outputPath}`);
}

main().catch(console.error);
