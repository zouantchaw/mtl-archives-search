import { datasetFactoryFixedNowIso, normalizeDatasetFactoryTimestamp } from './clock.js';

const FIXED_NOW_ENV = 'DATASET_FACTORY_FIXED_NOW';
const originalFixedNow = process.env[FIXED_NOW_ENV];
const originalTimezone = process.env.TZ;

function expectFailure(value: string): void {
  process.env[FIXED_NOW_ENV] = value;
  try {
    datasetFactoryFixedNowIso();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('RFC 3339')) throw error;
    return;
  }
  throw new Error(`Expected clock value to be rejected: ${value}`);
}

try {
  const expected = '2026-07-09T12:00:00.000Z';
  for (const timezone of ['UTC', 'America/Toronto']) {
    process.env.TZ = timezone;
    if (normalizeDatasetFactoryTimestamp('2026-07-09T12:00:00Z') !== expected) {
      throw new Error(`Z timestamp changed under TZ=${timezone}`);
    }
    if (normalizeDatasetFactoryTimestamp('2026-07-09T08:00:00-04:00') !== expected) {
      throw new Error(`Offset timestamp changed under TZ=${timezone}`);
    }
    expectFailure('2026-07-09');
    expectFailure('2026-07-09T12:00:00');
    expectFailure('2026-02-30T12:00:00Z');
  }
  console.log(JSON.stringify({
    status: 'ok',
    timezones: ['UTC', 'America/Toronto'],
    equivalent_instant: expected,
    rejected: ['date-only', 'timezone-less', 'invalid-calendar-date'],
  }));
} finally {
  if (originalFixedNow === undefined) delete process.env[FIXED_NOW_ENV];
  else process.env[FIXED_NOW_ENV] = originalFixedNow;
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
