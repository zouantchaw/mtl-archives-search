import { getCloudflareContext } from '@opennextjs/cloudflare';
import { deliverEmail } from '@mtl-archives/core';
import type { Lang } from '@/lib/i18n';
import { renderOrderEmailPayloads } from './print-email';

export interface FinalizedOrderItem {
  photoId: string;
  photoName: string;
  photoUrl: string;
  imageRotation: number;
  size: string;
  frame: string;
  price: number;
  quantity: number;
}

export interface FinalizedOrder {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress: string;
  customerNotes?: string;
  items: FinalizedOrderItem[];
  total: number;
  orderId: string;
  orderDate: string;
  lang: Lang;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
}

export async function sendOrderEmails(order: FinalizedOrder) {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.EMAIL || !env.MAIL_DB) throw new Error('Cloudflare email delivery is not configured');
  const sender = env.EMAIL;
  const db = env.MAIL_DB;
  const emailKeyBase = order.stripeSessionId || order.orderId;
  const { customer, admin } = await renderOrderEmailPayloads(order);
  const customerEmailResult = await deliverEmail(db, sender, `${emailKeyBase}:customer-confirmation`, customer);
  const adminEmailResult = await deliverEmail(db, sender, `${emailKeyBase}:admin-notification`, admin);

  return {
    customerEmailId: customerEmailResult,
    adminEmailId: adminEmailResult,
  };
}
