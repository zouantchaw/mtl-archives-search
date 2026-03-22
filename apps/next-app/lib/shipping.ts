import type { Lang } from '@/lib/i18n';

export const ALLOWED_SHIPPING_COUNTRIES = ['CA', 'US'] as const;

export type SupportedShippingCountry = (typeof ALLOWED_SHIPPING_COUNTRIES)[number];

export type ShippingSubdivision = {
  code: string;
  name: string;
};

export type ShippingAddressInput = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type ShippingAddressValidationKey =
  | 'line1'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country';

export type ShippingAddressValidationCode =
  | 'required'
  | 'unsupported_country'
  | 'invalid_region'
  | 'invalid_postal_code';

export type ShippingAddressValidationResult = {
  normalized: NormalizedShippingAddress | null;
  fieldErrors: Partial<Record<ShippingAddressValidationKey, ShippingAddressValidationCode>>;
};

export type NormalizedShippingAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: SupportedShippingCountry;
};

export type ShippableItemInput = {
  sizeId: string;
  frameId: string;
  quantity: number;
};

type ShippingZoneId =
  | 'CA_QC'
  | 'CA_ON'
  | 'CA_ATLANTIC'
  | 'CA_WEST'
  | 'CA_TERRITORIES'
  | 'US_NORTHEAST'
  | 'US_MIDWEST'
  | 'US_SOUTH'
  | 'US_WEST'
  | 'US_NON_CONTIGUOUS';

type ShippingZone = {
  id: ShippingZoneId;
  label: {
    en: string;
    fr: string;
  };
  baseAmount: number;
  perPound: number;
  oversizeSurcharge: number;
  framedHandlingSurcharge: number;
  deliveryEstimate: {
    minBusinessDays: number;
    maxBusinessDays: number;
  };
};

type SizeShippingProfile = {
  longestSideIn: number;
  baseWeightOz: number;
};

type FrameShippingProfile = {
  extraWeightOz: number;
  handlingSurcharge: number;
  packaging: 'tube' | 'flat';
};

export type ShippingQuote = {
  amount: number;
  amountCents: number;
  zone: ShippingZoneId;
  zoneLabel: string;
  totalWeightOz: number;
  deliveryEstimate: {
    minBusinessDays: number;
    maxBusinessDays: number;
  };
};

export const SHIPPING_COUNTRY_OPTIONS: Array<{
  code: SupportedShippingCountry;
  label: { en: string; fr: string };
}> = [
  { code: 'CA', label: { en: 'Canada', fr: 'Canada' } },
  { code: 'US', label: { en: 'United States', fr: 'Etats-Unis' } },
];

const CANADA_SUBDIVISIONS: ShippingSubdivision[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

const US_SUBDIVISIONS: ShippingSubdivision[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' },
];

const SHIPPING_SUBDIVISIONS: Record<SupportedShippingCountry, ShippingSubdivision[]> = {
  CA: CANADA_SUBDIVISIONS,
  US: US_SUBDIVISIONS,
};

const SIZE_SHIPPING_PROFILES: Record<string, SizeShippingProfile> = {
  '8x10': { longestSideIn: 10, baseWeightOz: 10 },
  '18x24': { longestSideIn: 24, baseWeightOz: 18 },
  '24x36': { longestSideIn: 36, baseWeightOz: 28 },
};

const FRAME_SHIPPING_PROFILES: Record<string, FrameShippingProfile> = {
  'fine-art': {
    extraWeightOz: 0,
    handlingSurcharge: 0,
    packaging: 'tube',
  },
  hanger: {
    extraWeightOz: 10,
    handlingSurcharge: 2,
    packaging: 'flat',
  },
  'framed-canvas': {
    extraWeightOz: 80,
    handlingSurcharge: 7,
    packaging: 'flat',
  },
};

const SHIPPING_ZONES: Record<ShippingZoneId, ShippingZone> = {
  CA_QC: {
    id: 'CA_QC',
    label: { en: 'Quebec', fr: 'Quebec' },
    baseAmount: 10,
    perPound: 1.75,
    oversizeSurcharge: 4,
    framedHandlingSurcharge: 4,
    deliveryEstimate: { minBusinessDays: 3, maxBusinessDays: 5 },
  },
  CA_ON: {
    id: 'CA_ON',
    label: { en: 'Ontario', fr: 'Ontario' },
    baseAmount: 12,
    perPound: 2.1,
    oversizeSurcharge: 5,
    framedHandlingSurcharge: 4.5,
    deliveryEstimate: { minBusinessDays: 4, maxBusinessDays: 6 },
  },
  CA_ATLANTIC: {
    id: 'CA_ATLANTIC',
    label: { en: 'Atlantic Canada', fr: 'Canada atlantique' },
    baseAmount: 14,
    perPound: 2.5,
    oversizeSurcharge: 5.5,
    framedHandlingSurcharge: 5,
    deliveryEstimate: { minBusinessDays: 5, maxBusinessDays: 7 },
  },
  CA_WEST: {
    id: 'CA_WEST',
    label: { en: 'Western Canada', fr: 'Ouest canadien' },
    baseAmount: 16,
    perPound: 2.9,
    oversizeSurcharge: 6.5,
    framedHandlingSurcharge: 5.5,
    deliveryEstimate: { minBusinessDays: 5, maxBusinessDays: 8 },
  },
  CA_TERRITORIES: {
    id: 'CA_TERRITORIES',
    label: { en: 'Northern territories', fr: 'Territoires du Nord' },
    baseAmount: 23,
    perPound: 4.1,
    oversizeSurcharge: 9,
    framedHandlingSurcharge: 8,
    deliveryEstimate: { minBusinessDays: 7, maxBusinessDays: 12 },
  },
  US_NORTHEAST: {
    id: 'US_NORTHEAST',
    label: { en: 'US Northeast', fr: 'Nord-est des Etats-Unis' },
    baseAmount: 14,
    perPound: 2.8,
    oversizeSurcharge: 5.5,
    framedHandlingSurcharge: 5,
    deliveryEstimate: { minBusinessDays: 5, maxBusinessDays: 8 },
  },
  US_MIDWEST: {
    id: 'US_MIDWEST',
    label: { en: 'US Midwest', fr: 'Midwest americain' },
    baseAmount: 17,
    perPound: 3.2,
    oversizeSurcharge: 6.5,
    framedHandlingSurcharge: 5.5,
    deliveryEstimate: { minBusinessDays: 6, maxBusinessDays: 9 },
  },
  US_SOUTH: {
    id: 'US_SOUTH',
    label: { en: 'US South', fr: 'Sud des Etats-Unis' },
    baseAmount: 18,
    perPound: 3.3,
    oversizeSurcharge: 6.5,
    framedHandlingSurcharge: 6,
    deliveryEstimate: { minBusinessDays: 6, maxBusinessDays: 10 },
  },
  US_WEST: {
    id: 'US_WEST',
    label: { en: 'US West', fr: 'Ouest des Etats-Unis' },
    baseAmount: 21,
    perPound: 4.2,
    oversizeSurcharge: 8,
    framedHandlingSurcharge: 7,
    deliveryEstimate: { minBusinessDays: 7, maxBusinessDays: 11 },
  },
  US_NON_CONTIGUOUS: {
    id: 'US_NON_CONTIGUOUS',
    label: { en: 'Alaska and Hawaii', fr: 'Alaska et Hawaii' },
    baseAmount: 28,
    perPound: 5.4,
    oversizeSurcharge: 10,
    framedHandlingSurcharge: 9,
    deliveryEstimate: { minBusinessDays: 8, maxBusinessDays: 14 },
  },
};

const COUNTRY_LOOKUP = new Set(ALLOWED_SHIPPING_COUNTRIES);
const CA_POSTAL_CODE_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
const US_ZIP_RE = /^\d{5}(?:-\d{4})?$/;

const CA_ATLANTIC_CODES = new Set(['NB', 'NL', 'NS', 'PE']);
const CA_WEST_CODES = new Set(['AB', 'BC', 'MB', 'SK']);
const CA_TERRITORY_CODES = new Set(['NT', 'NU', 'YT']);

const US_NORTHEAST_CODES = new Set([
  'CT',
  'DC',
  'DE',
  'MA',
  'MD',
  'ME',
  'NH',
  'NJ',
  'NY',
  'PA',
  'RI',
  'VA',
  'VT',
  'WV',
]);
const US_MIDWEST_CODES = new Set([
  'IA',
  'IL',
  'IN',
  'KS',
  'MI',
  'MN',
  'MO',
  'ND',
  'NE',
  'OH',
  'SD',
  'WI',
]);
const US_SOUTH_CODES = new Set([
  'AL',
  'AR',
  'FL',
  'GA',
  'KY',
  'LA',
  'MS',
  'NC',
  'OK',
  'SC',
  'TN',
  'TX',
]);
const US_NON_CONTIGUOUS_CODES = new Set(['AK', 'HI']);

function normalizeString(value?: string): string {
  return value?.trim() ?? '';
}

function normalizeCountry(value?: string): SupportedShippingCountry | null {
  const normalized = normalizeString(value).toUpperCase();
  if (!COUNTRY_LOOKUP.has(normalized as SupportedShippingCountry)) {
    return null;
  }
  return normalized as SupportedShippingCountry;
}

function getSubdivisionLookup(country: SupportedShippingCountry): Map<string, string> {
  return new Map(
    SHIPPING_SUBDIVISIONS[country].flatMap((subdivision) => [
      [subdivision.code.toUpperCase(), subdivision.code],
      [subdivision.name.toUpperCase(), subdivision.code],
    ])
  );
}

function normalizeSubdivision(country: SupportedShippingCountry, value?: string): string | null {
  const normalized = normalizeString(value).toUpperCase();
  if (!normalized) return null;

  return getSubdivisionLookup(country).get(normalized) ?? null;
}

function normalizePostalCode(country: SupportedShippingCountry, value?: string): string {
  const normalized = normalizeString(value);
  if (!normalized) return '';

  if (country === 'CA') {
    const compact = normalized.toUpperCase().replace(/\s+/g, '');
    if (compact.length === 6) {
      return `${compact.slice(0, 3)} ${compact.slice(3)}`;
    }
    return compact;
  }

  const compact = normalized.replace(/\s+/g, '');
  if (/^\d{9}$/.test(compact)) {
    return `${compact.slice(0, 5)}-${compact.slice(5)}`;
  }
  return compact;
}

function isValidPostalCode(country: SupportedShippingCountry, postalCode: string): boolean {
  if (country === 'CA') {
    return CA_POSTAL_CODE_RE.test(postalCode);
  }
  return US_ZIP_RE.test(postalCode);
}

function resolveShippingZone(country: SupportedShippingCountry, state: string): ShippingZone {
  if (country === 'CA') {
    if (state === 'QC') return SHIPPING_ZONES.CA_QC;
    if (state === 'ON') return SHIPPING_ZONES.CA_ON;
    if (CA_ATLANTIC_CODES.has(state)) return SHIPPING_ZONES.CA_ATLANTIC;
    if (CA_TERRITORY_CODES.has(state)) return SHIPPING_ZONES.CA_TERRITORIES;
    if (CA_WEST_CODES.has(state)) return SHIPPING_ZONES.CA_WEST;
    return SHIPPING_ZONES.CA_WEST;
  }

  if (US_NON_CONTIGUOUS_CODES.has(state)) return SHIPPING_ZONES.US_NON_CONTIGUOUS;
  if (US_NORTHEAST_CODES.has(state)) return SHIPPING_ZONES.US_NORTHEAST;
  if (US_MIDWEST_CODES.has(state)) return SHIPPING_ZONES.US_MIDWEST;
  if (US_SOUTH_CODES.has(state)) return SHIPPING_ZONES.US_SOUTH;
  return SHIPPING_ZONES.US_WEST;
}

function getItemShippingMetrics(item: ShippableItemInput) {
  const sizeProfile = SIZE_SHIPPING_PROFILES[item.sizeId];
  const frameProfile = FRAME_SHIPPING_PROFILES[item.frameId];
  if (!sizeProfile || !frameProfile) {
    throw new Error(`Unsupported shippable print configuration: ${item.sizeId}/${item.frameId}`);
  }

  const weightOz = sizeProfile.baseWeightOz + frameProfile.extraWeightOz;
  const oversized = sizeProfile.longestSideIn >= 30 || (frameProfile.packaging === 'flat' && sizeProfile.longestSideIn >= 24);
  const framed = item.frameId === 'framed-canvas';

  return {
    weightOz,
    oversized,
    framed,
    handlingSurcharge: frameProfile.handlingSurcharge,
  };
}

export function getShippingSubdivisions(country: SupportedShippingCountry): ShippingSubdivision[] {
  return SHIPPING_SUBDIVISIONS[country];
}

export function getShippingCountryLabel(country: SupportedShippingCountry, lang: Lang = 'en'): string {
  return SHIPPING_COUNTRY_OPTIONS.find((option) => option.code === country)?.label[lang] ?? country;
}

export function formatShippingAmount(amount: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function validateShippingAddress(address: ShippingAddressInput): ShippingAddressValidationResult {
  const line1 = normalizeString(address.line1);
  const line2 = normalizeString(address.line2);
  const city = normalizeString(address.city);

  const fieldErrors: ShippingAddressValidationResult['fieldErrors'] = {};

  if (!line1) fieldErrors.line1 = 'required';
  if (!city) fieldErrors.city = 'required';

  const country = normalizeCountry(address.country);
  if (!country) {
    fieldErrors.country = normalizeString(address.country) ? 'unsupported_country' : 'required';
  }

  let state: string | null = null;
  let postalCode = '';

  if (country) {
    state = normalizeSubdivision(country, address.state);
    if (!state) {
      fieldErrors.state = normalizeString(address.state) ? 'invalid_region' : 'required';
    }

    postalCode = normalizePostalCode(country, address.postalCode);
    if (!postalCode) {
      fieldErrors.postalCode = 'required';
    } else if (!isValidPostalCode(country, postalCode)) {
      fieldErrors.postalCode = 'invalid_postal_code';
    }
  } else {
    if (!normalizeString(address.state)) fieldErrors.state = 'required';
    if (!normalizeString(address.postalCode)) fieldErrors.postalCode = 'required';
  }

  if (Object.keys(fieldErrors).length > 0 || !country || !state) {
    return {
      normalized: null,
      fieldErrors,
    };
  }

  return {
    normalized: {
      line1,
      ...(line2 ? { line2 } : {}),
      city,
      state,
      postalCode,
      country,
    },
    fieldErrors,
  };
}

export function calculateShippingQuote(
  address: ShippingAddressInput,
  items: ShippableItemInput[],
  lang: Lang = 'en'
): ShippingQuote {
  const validation = validateShippingAddress(address);
  if (!validation.normalized) {
    throw new Error('Cannot calculate shipping for an invalid address');
  }

  if (!items.length) {
    throw new Error('Cannot calculate shipping without at least one item');
  }

  const zone = resolveShippingZone(validation.normalized.country, validation.normalized.state);
  let totalWeightOz = 0;
  let oversizeCount = 0;
  let framedCount = 0;
  let handlingSurcharge = 0;

  for (const item of items) {
    const quantity = Math.max(1, Math.trunc(item.quantity || 0));
    const metrics = getItemShippingMetrics(item);
    totalWeightOz += metrics.weightOz * quantity;
    if (metrics.oversized) oversizeCount += quantity;
    if (metrics.framed) framedCount += quantity;
    handlingSurcharge += metrics.handlingSurcharge * quantity;
  }

  const totalWeightLb = totalWeightOz / 16;
  const rawAmount =
    zone.baseAmount +
    totalWeightLb * zone.perPound +
    oversizeCount * zone.oversizeSurcharge +
    framedCount * zone.framedHandlingSurcharge +
    handlingSurcharge;
  const amount = Math.ceil(rawAmount);

  return {
    amount,
    amountCents: amount * 100,
    zone: zone.id,
    zoneLabel: zone.label[lang],
    totalWeightOz,
    deliveryEstimate: zone.deliveryEstimate,
  };
}
