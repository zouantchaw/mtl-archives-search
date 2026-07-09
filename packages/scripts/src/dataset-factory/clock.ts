const FIXED_NOW_ENV = 'DATASET_FACTORY_FIXED_NOW';

const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeDatasetFactoryTimestamp(value: string): string {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(
      `${FIXED_NOW_ENV} must be an RFC 3339 timestamp with Z or an explicit +/-HH:MM offset; received ${value}`,
    );
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  const valid = month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
  const parsed = valid ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${FIXED_NOW_ENV} is not a valid RFC 3339 timestamp; received ${value}`);
  }
  return parsed.toISOString();
}

export function datasetFactoryFixedNowIso(): string | null {
  const fixedNow = process.env[FIXED_NOW_ENV]?.trim();
  if (!fixedNow) return null;
  return normalizeDatasetFactoryTimestamp(fixedNow);
}

export function datasetFactoryNowIso(): string {
  return datasetFactoryFixedNowIso() ?? new Date().toISOString();
}
