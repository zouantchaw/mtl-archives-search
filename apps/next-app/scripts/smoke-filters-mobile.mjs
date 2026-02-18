#!/usr/bin/env node

import { chromium, devices } from 'playwright';

const rawTarget = process.argv[2] || process.env.SMOKE_URL || 'http://localhost:3001/';
const iterations = Number(process.env.FILTER_STRESS_ITERATIONS || 2);
const targetUrl = new URL(rawTarget);
targetUrl.searchParams.set('ab', 'home');
const target = targetUrl.toString();

const scenarios = [
  { name: 'iPhone 14', device: devices['iPhone 14'], startIndex: 0 },
  { name: 'Pixel 7', device: devices['Pixel 7'], startIndex: 3 },
];

const failMarkers = [
  'Something went wrong',
  'We encountered an unexpected error.',
  'NEXT_PUBLIC_API_URL is required in production.',
];

function fail(message) {
  console.error(`[smoke:filters:mobile] FAIL: ${message}`);
  process.exit(1);
}

async function clickDiscoveryFilter(page, index) {
  const buttons = page.locator('div.will-change-transform button');
  const count = await buttons.count();
  if (count === 0) return false;
  const targetButton = buttons.nth(index % count);
  try {
    await targetButton.click({ timeout: 3000, force: true });
    return true;
  } catch {
    return false;
  }
}

async function runScenario(scenario) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...scenario.device });
  const page = await context.newPage();

  const runtimeErrors = [];
  const rejectedErrors = [];

  page.on('pageerror', (error) => {
    runtimeErrors.push(error.message || String(error));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      rejectedErrors.push(msg.text());
    }
  });

  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);

    const pills = page.locator('div.will-change-transform button');
    await pills.first().waitFor({ timeout: 10000 });

    let taps = 0;
    let clickIndex = scenario.startIndex;

    for (let i = 0; i < iterations; i += 1) {
      for (let step = 0; step < 5; step += 1) {
        const clicked = await clickDiscoveryFilter(page, clickIndex);
        if (!clicked) {
          throw new Error(`No discovery filter could be clicked in ${scenario.name}`);
        }
        clickIndex += 1;
        taps += 1;
        await page.waitForTimeout(450);
      }
    }

    await page.waitForTimeout(1800);

    const bodyText = await page.locator('body').innerText();
    for (const marker of failMarkers) {
      if (bodyText.includes(marker)) {
        throw new Error(`Found error marker "${marker}" in ${scenario.name}`);
      }
    }

    const tileCount = await page.locator('button.aspect-square img').count();
    if (tileCount < 1) {
      throw new Error(`Expected at least 1 photo tile in ${scenario.name}, got ${tileCount}`);
    }

    if (runtimeErrors.length > 0) {
      throw new Error(`Runtime errors in ${scenario.name}: ${runtimeErrors.slice(0, 3).join(' | ')}`);
    }

    const fatalConsoleErrors = rejectedErrors.filter((entry) => {
      const text = entry.toLowerCase();
      return text.includes('typeerror') || text.includes('referenceerror') || text.includes('uncaught');
    });

    if (fatalConsoleErrors.length > 0) {
      throw new Error(`Console fatal errors in ${scenario.name}: ${fatalConsoleErrors.slice(0, 3).join(' | ')}`);
    }

    console.log(`[smoke:filters:mobile] PASS: ${scenario.name} (${taps} taps, ${tileCount} tiles)`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function run() {
  for (const scenario of scenarios) {
    await runScenario(scenario);
  }
  console.log(`[smoke:filters:mobile] PASS: ${target}`);
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
