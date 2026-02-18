#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const target = process.argv[2] || process.env.SMOKE_URL || 'http://localhost:3001/';
const session = `mtl-filters-smoke-${Date.now()}`;

const filterLabels = [
  'Tramway',
  'Rosemont',
  'Neige',
  'Hochelaga',
  'Mont Royal',
  'Hiver',
  'Bridge',
  'Villeray',
];

const failMarkers = [
  'Something went wrong',
  'We encountered an unexpected error.',
  'NEXT_PUBLIC_API_URL is required in production.',
];

function run(args, options = {}) {
  const output = execFileSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 20000,
  });
  if (options.verbose) {
    console.log(output.trim());
  }
  return output;
}

function fail(message) {
  console.error(`[smoke:filters] FAIL: ${message}`);
  process.exit(1);
}

function clickFilter(label) {
  try {
    run(['find', 'role', 'button', 'click', '--name', label]);
    return true;
  } catch {
    return false;
  }
}

function closeSessionQuietly() {
  try {
    run(['close']);
  } catch {
    // Ignore cleanup failures.
  }
}

try {
  execFileSync('agent-browser', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch {
  fail('agent-browser CLI is not installed or not available on PATH');
}

try {
  run(['open', target]);
  run(['wait', '1500']);

  let taps = 0;
  for (const label of filterLabels) {
    if (clickFilter(label)) {
      taps += 1;
      run(['wait', '350']);
    }
  }

  if (taps < 4) {
    fail(`Only ${taps} filter taps succeeded; expected at least 4`);
  }

  run(['wait', '2000']);

  const bodyText = run(['get', 'text', 'body']);
  for (const marker of failMarkers) {
    if (bodyText.includes(marker)) {
      fail(`Found error marker "${marker}" after rapid filter taps`);
    }
  }

  const tileCountText = run([
    'eval',
    "document.querySelectorAll('button.aspect-square img').length",
  ]).trim();
  const tileCount = Number(tileCountText);

  if (!Number.isFinite(tileCount) || tileCount < 1) {
    fail(`Expected at least 1 photo tile after stress taps, got ${tileCountText}`);
  }

  console.log(`[smoke:filters] PASS: ${target} (${taps} taps, ${tileCount} tiles)`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  closeSessionQuietly();
}
