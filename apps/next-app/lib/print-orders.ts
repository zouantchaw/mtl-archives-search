import { Resend } from 'resend';
import type { Lang } from '@/lib/i18n';
import { AdminOrderNotificationEmail } from '@/components/emails/admin-order-notification-email';
import { OrderConfirmationEmail } from '@/components/emails/order-confirmation-email';

const ADMIN_EMAIL = 'zouantchaw74@gmail.com';
const FROM_EMAIL = 'MTL Archives <support@support.mtlarchives.com>';

export interface FinalizedOrderItem {
  photoId: string;
  photoName: string;
  photoUrl: string;
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
  const resendSecret = process.env.RESEND_SECRET_KEY;
  if (!resendSecret) {
    throw new Error('Missing RESEND_SECRET_KEY');
  }

  const resend = new Resend(resendSecret);
  const emailKeyBase = order.stripeSessionId || order.orderId;

  const customerEmailResult = await resend.emails.send({
    from: FROM_EMAIL,
    to: [order.customerEmail],
    subject:
      order.lang === 'fr'
        ? `Confirmation de commande #${order.orderId} - MTL Archives`
        : `Order Confirmation #${order.orderId} - MTL Archives`,
    react: OrderConfirmationEmail({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      items: order.items,
      total: order.total,
      orderId: order.orderId,
      orderDate: order.orderDate,
      lang: order.lang,
    }),
  }, {
    idempotencyKey: `${emailKeyBase}:customer-confirmation`,
  });

  if (customerEmailResult.error) {
    throw new Error(`Failed to send customer email: ${customerEmailResult.error.message}`);
  }

  const adminEmailResult = await resend.emails.send({
    from: FROM_EMAIL,
    to: [ADMIN_EMAIL],
    replyTo: order.customerEmail,
    subject: `Paid Order #${order.orderId} - ${order.customerName} - $${order.total.toFixed(2)}`,
    react: AdminOrderNotificationEmail({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      customerNotes: order.customerNotes,
      items: order.items,
      total: order.total,
      orderId: order.orderId,
      orderDate: order.orderDate,
      stripeSessionId: order.stripeSessionId,
      stripePaymentIntentId: order.stripePaymentIntentId,
    }),
  }, {
    idempotencyKey: `${emailKeyBase}:admin-notification`,
  });

  if (adminEmailResult.error) {
    console.error('Failed to send admin email:', adminEmailResult.error);
  }

  return {
    customerEmailId: customerEmailResult.data?.id,
    adminEmailId: adminEmailResult.data?.id,
  };
}
