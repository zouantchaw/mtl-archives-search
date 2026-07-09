const FIXED_NOW_ENV = 'DATASET_FACTORY_FIXED_NOW';

export function datasetFactoryFixedNowIso(): string | null {
  const fixedNow = process.env[FIXED_NOW_ENV]?.trim();
  if (!fixedNow) return null;
  const parsed = new Date(fixedNow);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${FIXED_NOW_ENV} must be a valid ISO-8601 timestamp; received ${fixedNow}`);
  }
  return parsed.toISOString();
}

export function datasetFactoryNowIso(): string {
  return datasetFactoryFixedNowIso() ?? new Date().toISOString();
}
