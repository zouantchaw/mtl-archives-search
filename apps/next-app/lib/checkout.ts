import { z } from 'zod';
import type { Lang } from '@/lib/i18n';
import {
  ALLOWED_SHIPPING_COUNTRIES,
  getShippingCountryLabel,
  validateShippingAddress,
} from '@/lib/shipping';

export const CHECKOUT_CURRENCY = 'cad';
export const CHECKOUT_DRAFT_STORAGE_KEY = 'mtl-archives-checkout-draft';

function isValidCheckoutImageReference(url: string): boolean {
  const normalized = url.trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return true;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export const checkoutItemSchema = z.object({
  photoId: z.string().trim().min(1).max(200),
  photoName: z.string().trim().min(1).max(200),
  photoUrl: z.string().trim().min(1).max(2000).refine(isValidCheckoutImageReference, {
    message: 'Invalid image URL',
  }),
  size: z.string().trim().min(1).max(100),
  sizeId: z.string().trim().min(1).max(100),
  frame: z.string().trim().min(1).max(100),
  frameId: z.string().trim().min(1).max(100),
  price: z.number().finite().positive().max(10000),
  quantity: z.number().int().positive().max(20),
});

export const checkoutRequestSchema = z.object({
  customerEmail: z.string().trim().email().max(320),
  customerFirstName: z.string().trim().min(1).max(100),
  customerLastName: z.string().trim().min(1).max(100),
  customerAddressLine1: z.string().trim().min(1).max(200),
  customerAddressLine2: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || undefined),
  customerCity: z.string().trim().min(1).max(120),
  customerState: z.string().trim().min(1).max(120),
  customerPostalCode: z.string().trim().min(1).max(20),
  customerCountry: z.string().trim().min(2).max(2),
  customerNotes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
  items: z.array(checkoutItemSchema).min(1).max(20),
  lang: z.enum(['fr', 'en']).optional().default('fr'),
}).superRefine((value, ctx) => {
  const validation = validateShippingAddress({
    line1: value.customerAddressLine1,
    line2: value.customerAddressLine2,
    city: value.customerCity,
    state: value.customerState,
    postalCode: value.customerPostalCode,
    country: value.customerCountry,
  });

  for (const [field, code] of Object.entries(validation.fieldErrors)) {
    const path =
      field === 'line1'
        ? ['customerAddressLine1']
        : field === 'city'
          ? ['customerCity']
          : field === 'state'
            ? ['customerState']
            : field === 'postalCode'
              ? ['customerPostalCode']
              : ['customerCountry'];

    const message =
      code === 'required'
        ? 'Required'
        : code === 'unsupported_country'
          ? `We currently ship to ${ALLOWED_SHIPPING_COUNTRIES.join(' and ')} only`
          : code === 'invalid_region'
            ? 'Invalid province or state'
            : 'Invalid postal or ZIP code';

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path,
    });
  }
});

export type CheckoutItemInput = z.infer<typeof checkoutItemSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export interface MailingAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MTL-${timestamp}-${random}`;
}

export function formatOrderDate(date: Date, lang: Lang): string {
  return date.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMailingAddress(address?: MailingAddress | null): string {
  if (!address) return '';
  return [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(', '),
    [
      address.postal_code,
      address.country
        ? getShippingCountryLabel((address.country.toUpperCase() as 'CA' | 'US') ?? 'CA')
        : undefined,
    ].filter(Boolean).join(' '),
  ]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n');
}

export function trimMetadataValue(value?: string | null, maxLength = 500): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

export function toStripeAmount(amount: number): number {
  return Math.round(amount * 100);
}

export function fromStripeAmount(amount?: number | null): number {
  if (typeof amount !== 'number') return 0;
  return amount / 100;
}

export function isSafeStripeImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveStripeImageUrl(url: string, origin: string): string | undefined {
  const normalized = url.trim();
  if (!normalized) return undefined;

  try {
    const absoluteUrl = normalized.startsWith('/') ? new URL(normalized, origin).toString() : normalized;
    return isSafeStripeImage(absoluteUrl) ? absoluteUrl : undefined;
  } catch {
    return undefined;
  }
}
