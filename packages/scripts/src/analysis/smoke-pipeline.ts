import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const TSX_CLI = path.resolve(MONOREPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

function fail(message: string): never {
  console.error(`[smoke:pipeline] FAIL: ${message}`);
  process.exit(1);
}

function runTsx(scriptPath: string, args: string[], env: NodeJS.ProcessEnv = {}, expectedExitCode = 0) {
  const result = spawnSync(process.execPath, [TSX_CLI, scriptPath, ...args], {
    cwd: MONOREPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });

  if ((result.status ?? 1) !== expectedExitCode) {
    const stderr = result.stderr?.trim() || '';
    const stdout = result.stdout?.trim() || '';
    fail(
      `Unexpected exit code for ${path.basename(scriptPath)} (expected ${expectedExitCode}, got ${result.status}).\n` +
      `stdout: ${stdout}\n` +
      `stderr: ${stderr}`
    );
  }

  return result;
}

function readJsonLines(filePath: string) {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} file missing: ${filePath}`);
  }
}

function createFixtureManifest(outputPath: string) {
  const fixture = [
    {
      metadata_filename: 'fixture_1.json',
      image_filename: 'fixture_1.jpg',
      resolved_image_filename: 'fixture_1.jpg',
      image_exists: true,
      image_size_bytes: 12345,
      external_url: null,
      portal_match: 1,
      portal_record: {
        Titre: 'Rue Sainte-Catherine',
        Description: 'Vue de rue avec tramway.',
        Date: '1952',
        Cote: 'VM94-123',
        'Mention de crédits': 'Archives de la Ville de Montréal',
      },
      attributes: [
        { trait_type: 'Date', value: '1952' },
        { trait_type: 'Cote', value: 'VM94-123' },
      ],
      name: 'Rue Sainte-Catherine',
      description: 'Vue de rue avec tramway et passants.',
    },
    {
      metadata_filename: 'fixture_2.json',
      image_filename: 'fixture_2.jpg',
      resolved_image_filename: 'fixture_2.jpg',
      image_exists: true,
      image_size_bytes: 23456,
      external_url: null,
      portal_match: 1,
      portal_record: {
        Titre: 'Parc enneigé',
        Description: 'Paysage hivernal.',
        Date: '1937',
        Cote: 'VM94-456',
        'Mention de crédits': 'Archives de la Ville de Montréal',
      },
      attributes: [
        { trait_type: 'Date', value: '1937' },
        { trait_type: 'Cote', value: 'VM94-456' },
      ],
      name: 'Parc enneigé',
      description: '',
    },
  ];

  fs.writeFileSync(outputPath, fixture.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

async function main() {
  if (!fs.existsSync(TSX_CLI)) {
    fail(`Missing tsx CLI at ${TSX_CLI}. Run npm install first.`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mtl-pipeline-smoke-'));
  const fixtureInput = path.join(tempRoot, 'manifest_enriched_fixture.jsonl');
  const canonicalOutput = path.join(tempRoot, 'manifest_canonical_fixture.jsonl');
  const canonicalSummary = path.join(tempRoot, 'manifest_canonical_summary.json');
  const datedOutput = path.join(tempRoot, 'manifest_dated_fixture.jsonl');
  const datedSummary = path.join(tempRoot, 'manifest_dated_summary.json');
  const textCheckpoint = path.join(tempRoot, '.checkpoints', 'vectorize-text.json');
  const textFailureLog = path.join(tempRoot, '.logs', 'vectorize-text-failures.ndjson');

  createFixtureManifest(fixtureInput);

  runTsx(
    path.resolve(MONOREPO_ROOT, 'packages/scripts/src/etl/canonicalize-metadata.ts'),
    ['--input', fixtureInput, '--output', canonicalOutput, '--summary', canonicalSummary],
  );

  assertFile(canonicalOutput, 'canonical output');
  assertFile(canonicalSummary, 'canonical summary');

  const canonicalRows = readJsonLines(canonicalOutput);
  if (canonicalRows.length !== 2) {
    fail(`Expected 2 canonical rows, got ${canonicalRows.length}`);
  }

  runTsx(
    path.resolve(MONOREPO_ROOT, 'packages/scripts/src/etl/normalize-dates.ts'),
    ['--input', canonicalOutput, '--output', datedOutput, '--summary', datedSummary],
  );

  assertFile(datedOutput, 'dated output');
  assertFile(datedSummary, 'dated summary');

  const datedRows = readJsonLines(datedOutput);
  const datedCount = datedRows.filter((row) => Boolean(row.date_value)).length;
  if (datedRows.length !== 2 || datedCount < 1) {
    fail(`Date normalization check failed (rows=${datedRows.length}, withDate=${datedCount})`);
  }

  runTsx(
    path.resolve(MONOREPO_ROOT, 'packages/scripts/src/vectorize/ingest-text.ts'),
    [
      '--input',
      datedOutput,
      '--limit',
      '1',
      '--checkpoint',
      textCheckpoint,
      '--failure-log',
      textFailureLog,
      '--reset',
    ],
    {
      CLOUDFLARE_ACCOUNT_ID: 'smoke-account',
      CLOUDFLARE_API_TOKEN: 'smoke-token',
      VECTORIZE_MAX_RETRIES: '1',
      VECTORIZE_FORCE_FAILURE: '1',
    },
    1,
  );

  assertFile(textFailureLog, 'vectorize text failure log');

  const failureLines = fs
    .readFileSync(textFailureLog, 'utf-8')
    .split('\n')
    .filter(Boolean);

  if (failureLines.length < 1) {
    fail('Expected at least one vectorize failure log entry');
  }

  console.log(`[smoke:pipeline] PASS: ${tempRoot}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
