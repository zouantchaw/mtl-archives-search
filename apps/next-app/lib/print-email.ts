import { render } from '@react-email/render';
import type { EmailPayload } from '@mtl-archives/core';
import type { FinalizedOrder } from './print-orders';
import { AdminOrderNotificationEmail } from '@/components/emails/admin-order-notification-email';
import { OrderConfirmationEmail } from '@/components/emails/order-confirmation-email';

const ADMIN_EMAIL = 'zouantchaw74@gmail.com';
const FROM_EMAIL = { email: 'support@support.mtlarchives.com', name: 'MTL Archives' };

export async function renderOrderEmailPayloads(order: FinalizedOrder) {
  const renderPayload = async (props: Omit<EmailPayload, 'html' | 'text'> & { react: React.ReactElement }) => {
    const { react, ...fields } = props;
    const html = await render(react);
    const text = await render(react, { plainText: true });
    return { ...fields, html, text };
  };
  const customer = await renderPayload({
    from: FROM_EMAIL,
    to: order.customerEmail,
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
  });

  const admin = await renderPayload({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
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
  });

  return { customer, admin };
}
