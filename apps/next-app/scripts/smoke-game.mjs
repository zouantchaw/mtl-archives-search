#!/usr/bin/env node

const target = process.argv[2] || process.env.SMOKE_URL || 'http://localhost:3001/game';

const failMarkers = [
  'Something went wrong',
  'We encountered an unexpected error.',
  'NEXT_PUBLIC_API_URL is required in production.',
];

function fail(message) {
  console.error(`[smoke:game] FAIL: ${message}`);
  process.exit(1);
}

async function run() {
  const response = await fetch(target, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'cache-control': 'no-cache',
      pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    fail(`HTTP ${response.status} for ${target}`);
  }

  const html = await response.text();

  for (const marker of failMarkers) {
    if (html.includes(marker)) {
      fail(`Found error marker "${marker}" in ${target}`);
    }
  }

  if (!html.includes('/_next/static/')) {
    fail(`Expected Next.js markup not found in ${target}`);
  }

  console.log(`[smoke:game] PASS: ${target}`);
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
