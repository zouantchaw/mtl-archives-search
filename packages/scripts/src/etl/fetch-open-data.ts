import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives');
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_DELAY_MS = 150;

const DATASETS = [
  {
    key: 'phototheque_archives',
    resourceId: '41f0cec9-2110-452e-a93d-8f29190ee2ae',
    outputFile: 'phototheque_datastore.json',
  },
  {
    key: 'aerial_1925_1935',
    resourceId: '31f8294c-db24-49c5-993c-8738593dce7f',
    outputFile: 'vues_aeriennes_1925_1935.json',
  },
  {
    key: 'aerial_1947_1949',
    resourceId: '09a0893e-3142-4950-8c54-1250540bde13',
    outputFile: 'vues_aeriennes_1947_1949.json',
  },
  {
    key: 'aerial_obliques_1960_1992',
    resourceId: '0ef12a2f-da90-49fb-8c46-89024edece54',
    outputFile: 'vues_aeriennes_obliques_1960_1992.json',
  },
  {
    key: 'aerial_1958',
    resourceId: '9ab0c8c1-f4f3-4ea9-b6d5-d10018cebda2',
    outputFile: 'vues_aeriennes_1958.json',
  },
  {
    key: 'aerial_1962',
    resourceId: 'eff33c42-bad4-4d8c-9059-28e4b425b7e2',
    outputFile: 'vues_aeriennes_1962.json',
  },
  {
    key: 'aerial_1964',
    resourceId: 'c6e12ed5-8a9d-4559-a96c-f50689a41c44',
    outputFile: 'vues_aeriennes_1964.json',
  },
  {
    key: 'aerial_1966',
    resourceId: '379921f4-1991-4a08-b900-0a72453ae28a',
    outputFile: 'vues_aeriennes_1966.json',
  },
  {
    key: 'aerial_1969',
    resourceId: 'd3206ff5-4e40-4713-abda-0fd498bbffb3',
    outputFile: 'vues_aeriennes_1969.json',
  },
  {
    key: 'aerial_1971',
    resourceId: 'd259d85d-a7ac-4ebd-8843-2ac6fd611017',
    outputFile: 'vues_aeriennes_1971.json',
  },
  {
    key: 'aerial_1973',
    resourceId: '78395826-e67e-467b-a017-29b03a156aa8',
    outputFile: 'vues_aeriennes_1973.json',
  },
  {
    key: 'aerial_1975',
    resourceId: '2df16f9d-663c-48a2-9f53-5a58be1d85b5',
    outputFile: 'vues_aeriennes_1975.json',
  },
];

type DatasetConfig = (typeof DATASETS)[number];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'mtl-archives-scripts/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) ${url}`);
  }
  return response.json();
}

async function fetchDataset(dataset: DatasetConfig, pageSize: number, delayMs: number) {
  const records: any[] = [];
  let offset = 0;
  let total = 0;
  let fields: any[] = [];
  let help = '';
  let includeTotal = true;
  let recordsFormat = 'objects';
  let totalEstimated = false;

  while (true) {
    const url = new URL('https://donnees.montreal.ca/api/3/action/datastore_search');
    url.searchParams.set('resource_id', dataset.resourceId);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    const data = await fetchJson(url.toString());
    if (!data || data.success !== true) {
      throw new Error(`API failure for ${dataset.key}`);
    }

    help = data.help || help;
    const result = data.result || {};
    total = result.total ?? total;
    includeTotal = result.include_total ?? includeTotal;
    recordsFormat = result.records_format ?? recordsFormat;
    totalEstimated = result.total_was_estimated ?? totalEstimated;
    if (!fields.length && Array.isArray(result.fields)) {
      fields = result.fields;
    }

    const pageRecords = Array.isArray(result.records) ? result.records : [];
    records.push(...pageRecords);

    if (records.length >= total || pageRecords.length === 0) {
      break;
    }

    offset += pageRecords.length;
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    help,
    success: true,
    result: {
      include_total: includeTotal,
      limit: pageSize,
      records_format: recordsFormat,
      resource_id: dataset.resourceId,
      total_estimation_threshold: null,
      records,
      fields,
      _links: {
        start: `/api/3/action/datastore_search?resource_id=${dataset.resourceId}&limit=${pageSize}`,
      },
      total,
      total_was_estimated: totalEstimated,
    },
  };
}

function parseDatasetFilter(value: string | undefined): Set<string> | null {
  if (!value) return null;
  return new Set(
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  );
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'page-size': { type: 'string', default: String(DEFAULT_PAGE_SIZE) },
      delay: { type: 'string', default: String(DEFAULT_DELAY_MS) },
      datasets: { type: 'string' },
    },
  });

  const outputDir = values.output!;
  const pageSize = Math.max(1, Number(values['page-size'] || DEFAULT_PAGE_SIZE));
  const delayMs = Math.max(0, Number(values.delay || DEFAULT_DELAY_MS));
  const datasetFilter = parseDatasetFilter(values.datasets);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const selected = datasetFilter
    ? DATASETS.filter(item => datasetFilter.has(item.key))
    : DATASETS;

  if (datasetFilter && selected.length === 0) {
    console.error('No matching datasets found for --datasets');
    process.exit(1);
  }

  for (const dataset of selected) {
    console.log(`Fetching ${dataset.key} (${dataset.resourceId})`);
    const payload = await fetchDataset(dataset, pageSize, delayMs);
    const outputPath = path.resolve(outputDir, dataset.outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(payload), 'utf-8');
    console.log(`Wrote ${outputPath}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
