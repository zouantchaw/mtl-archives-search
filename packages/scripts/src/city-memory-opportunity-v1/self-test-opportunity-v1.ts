import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOpportunity } from './build-opportunity-v1.js';
import { writeJsonl } from './model.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'city-memory-opportunity-v1-'));
try {
  const scored = [
    { metadata_filename: 'mtl_archives_metadata_1.json', name: 'King Edward Quay', description: 'Vue sur le port', cote: 'VM1', date_value: '1947', external_url: 'https://example.test/VM1.jpg', score: 0.9 },
    { metadata_filename: 'mtl_archives_metadata_2.json', name: 'Rue Saint-Paul', description: 'Vieux Montréal', cote: 'VM2', date_value: 'Décennie 1930', score: 0.7 },
    { metadata_filename: 'mtl_archives_metadata_3.json', name: 'Rue neutre', description: 'A city street', cote: 'VM3', date_value: '1966', score: 0.1 },
  ];
  const taxonomy = [
    { id: 'mtl_archives_metadata_1.json', primaryCategory: 'aerial_waterfront', themes: ['waterfront'], vantage: 'aerial' },
    { id: 'mtl_archives_metadata_2.json', primaryCategory: 'ground_photo', themes: ['commercial'], vantage: 'ground' },
    { id: 'mtl_archives_metadata_3.json', primaryCategory: 'aerial_general', themes: ['industrial'], vantage: 'aerial' },
    { id: 'mtl_archives_metadata_4.json', primaryCategory: 'aerial_general', themes: ['waterfront'], vantage: 'aerial' },
  ];
  const vlm = [
    { id: 'mtl_archives_metadata_1.json', vlm_caption: 'Aerial view of the Old Port and river' },
    { id: 'mtl_archives_metadata_2.json', vlm_caption: 'Old Montreal street and storefronts' },
    { id: 'mtl_archives_metadata_3.json', vlm_caption: 'Industrial waterfront' },
    { id: 'mtl_archives_metadata_4.json', vlm_caption: 'Old Port skyline' },
  ];
  const geocode = [{ metadata_filename: 'mtl_archives_metadata_1.json', latitude: 45.5, longitude: -73.55, geocode_place_name: 'Old Port' }];
  const ocr = [{ metadata_filename: 'mtl_archives_metadata_2.json', ocr_text: 'Vieux Montréal', ocr_confidence: 0.9, ocr_reviewed: true }];
  const aerial = [{ metadata_filename: 'mtl_archives_metadata_1.json', aerial_datasets: ['aerial_1947_1949'] }];
  writeJsonl(path.join(temp, 'manifest_scored.jsonl'), scored);
  writeJsonl(path.join(temp, 'taxonomy.jsonl'), taxonomy);
  writeJsonl(path.join(temp, 'vlm.jsonl'), vlm);
  writeJsonl(path.join(temp, 'geo.jsonl'), geocode);
  writeJsonl(path.join(temp, 'ocr.jsonl'), ocr);
  writeJsonl(path.join(temp, 'aerial.jsonl'), aerial);

  const result = buildOpportunity({ dataRoot: temp, inputs: { canonical_scored: 'manifest_scored.jsonl', taxonomy: 'taxonomy.jsonl', vlm: 'vlm.jsonl', geocode: 'geo.jsonl', ocr: 'ocr.jsonl', aerial: 'aerial.jsonl' }, maxCandidates: 2 });
  assert.equal(result.summary.grains.canonical_scored.rows, 3);
  assert.equal(result.summary.grains.taxonomy.rows, 4);
  assert.equal(result.summary.grains.taxonomy.matched, 3);
  assert.equal(result.summary.grains.vlm.matched, 3);
  assert.equal(result.summary.grains.geocode.matched, 1);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.crosswalk[0].place_signals.exact_source_supported[0]?.place, 'old_port');
  assert(result.crosswalk[0].place_signals.model_inferred.some((entry) => entry.field === 'vlm.caption'));
  assert.equal(result.crosswalk[1].ocr.reviewed, true);
  assert.equal(result.crosswalk[1].place_signals.exact_source_supported.some((entry) => entry.field === 'ocr.reviewed_entities'), true);
  assert.equal(result.crosswalk[2].joins.taxonomy.status, 'matched');
  assert(result.summary.gaps.some((gap) => gap.includes('reference grain=13499')));
  console.log(JSON.stringify({ status: 'ok', cases: 10, canonical_rows: result.summary.grains.canonical_scored.rows, taxonomy_matches: result.summary.grains.taxonomy.matched, candidate_rows: result.candidates.length }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
