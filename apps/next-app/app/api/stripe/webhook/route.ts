import type Stripe from 'stripe';
import { NextResponse } from 'next/server';
import {
  formatMailingAddress,
  formatOrderDate,
  fromStripeAmount,
} from '@/lib/checkout';
import { normalizeLang } from '@/lib/i18n';
import { sendOrderEmails, type FinalizedOrderItem } from '@/lib/print-orders';
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isStripeProduct(
  product: Stripe.Product | Stripe.DeletedProduct | null | undefined
): product is Stripe.Product {
  return Boolean(product && !('deleted' in product && product.deleted));
}

function mapStripeLineItem(lineItem: Stripe.LineItem): FinalizedOrderItem {
  const quantity = lineItem.quantity ?? 1;
  const rawProduct = typeof lineItem.price?.product === 'string' ? null : lineItem.price?.product;
  const product = isStripeProduct(rawProduct) ? rawProduct : null;
  const unitAmount = lineItem.price?.unit_amount ?? Math.round((lineItem.amount_subtotal ?? 0) / quantity);

  return {
    photoId: product?.metadata.photoId || lineItem.description || lineItem.id,
    photoName: lineItem.description || product?.name || 'Archive print',
    photoUrl: product?.images?.[0] || product?.metadata.photoUrl || '',
    size: product?.metadata.size || '',
    frame: product?.metadata.frame || '',
    price: fromStripeAmount(unitAmount),
    quantity,
  };
}

async function handleCompletedCheckoutSession(session: Stripe.Checkout.Session) {
  const stripe = getStripe();
  const latestSession = await stripe.checkout.sessions.retrieve(session.id);

  if (latestSession.metadata?.emailsSent === 'true') {
    return;
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ['data.price.product'],
  });

  const items = lineItems.data.map(mapStripeLineItem);
  if (items.length === 0) {
    throw new Error(`Stripe session ${session.id} did not contain any line items`);
  }

  const customerEmail = session.customer_details?.email || session.customer_email;
  if (!customerEmail) {
    throw new Error(`Stripe session ${session.id} is missing customer email`);
  }

  const customerName =
    latestSession.collected_information?.shipping_details?.name ||
    latestSession.customer_details?.name ||
    latestSession.metadata?.customerName ||
    'MTL Archives customer';
  const customerAddress = formatMailingAddress(
    latestSession.collected_information?.shipping_details?.address || latestSession.customer_details?.address
  );
  const orderId = latestSession.client_reference_id || latestSession.metadata?.orderId || latestSession.id;
  const lang = normalizeLang(latestSession.metadata?.lang);
  const orderDate = formatOrderDate(new Date(latestSession.created * 1000), lang);
  const total = fromStripeAmount(latestSession.amount_total);
  const paymentIntentId =
    typeof latestSession.payment_intent === 'string'
      ? latestSession.payment_intent
      : latestSession.payment_intent?.id;

  await sendOrderEmails({
    customerName,
    customerEmail,
    customerPhone: latestSession.customer_details?.phone || undefined,
    customerAddress,
    customerNotes: latestSession.metadata?.customerNotes || undefined,
    items,
    total,
    orderId,
    orderDate,
    lang,
    stripeSessionId: latestSession.id,
    stripePaymentIntentId: paymentIntentId,
  });

  try {
    await stripe.checkout.sessions.update(latestSession.id, {
      metadata: {
        ...latestSession.metadata,
        emailsSent: 'true',
      },
    });
  } catch (error) {
    console.error('Failed to mark Stripe session emails as sent:', error);
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, getStripeWebhookSecret());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Stripe webhook signature';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') {
        await handleCompletedCheckoutSession(session);
      }
    }

    if (event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCompletedCheckoutSession(session);
    }
  } catch (error) {
    console.error('Stripe webhook handling failed:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
