import { type NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_SHIPPING_COUNTRIES,
  CHECKOUT_CURRENCY,
  SHIPPING_FEE_CENTS,
  checkoutRequestSchema,
  generateOrderId,
  resolveStripeImageUrl,
  trimMetadataValue,
  toStripeAmount,
} from '@/lib/checkout';
import { appendLangParam } from '@/lib/i18n';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = checkoutRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: 'Invalid checkout payload',
        fieldErrors: parsed.error.flatten(),
      }, {
        status: 400,
      });
    }

    const body = parsed.data;
    const stripe = getStripe();
    const orderId = generateOrderId();
    const customerName = `${body.customerFirstName} ${body.customerLastName}`.trim();
    const customer = await stripe.customers.create({
      email: body.customerEmail,
      name: customerName,
      address: {
        line1: body.customerAddressLine1,
        city: body.customerCity,
        postal_code: body.customerPostalCode,
        country: 'CA',
      },
      shipping: {
        name: customerName,
        address: {
          line1: body.customerAddressLine1,
          city: body.customerCity,
          postal_code: body.customerPostalCode,
          country: 'CA',
        },
      },
    });

    const successUrl = new URL(appendLangParam('/order-confirmation', body.lang), request.nextUrl.origin);
    successUrl.searchParams.set('orderId', orderId);
    const successUrlWithSessionId = `${successUrl.toString()}&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl = new URL(appendLangParam('/checkout', body.lang), request.nextUrl.origin);
    cancelUrl.searchParams.set('canceled', '1');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      customer_update: {
        address: 'auto',
        name: 'auto',
        shipping: 'auto',
      },
      client_reference_id: orderId,
      payment_method_types: ['card'],
      locale: body.lang,
      line_items: body.items.map((item) => ({
        ...(() => {
          const stripeImageUrl = resolveStripeImageUrl(item.photoUrl, request.nextUrl.origin);

          return {
            quantity: item.quantity,
            price_data: {
              currency: CHECKOUT_CURRENCY,
              unit_amount: toStripeAmount(item.price),
              product_data: {
                name: item.photoName,
                description: `${item.size} · ${item.frame}`,
                metadata: {
                  photoId: item.photoId,
                  size: item.size,
                  sizeId: item.sizeId,
                  frame: item.frame,
                  frameId: item.frameId,
                  ...(item.photoUrl.length <= 500 ? { photoUrl: item.photoUrl } : {}),
                },
                ...(stripeImageUrl ? { images: [stripeImageUrl] } : {}),
              },
            },
          };
        })(),
      })),
      shipping_address_collection: {
        allowed_countries: [...ALLOWED_SHIPPING_COUNTRIES],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: body.lang === 'fr' ? 'Livraison' : 'Shipping',
            fixed_amount: {
              amount: SHIPPING_FEE_CENTS,
              currency: CHECKOUT_CURRENCY,
            },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 7 },
            },
          },
        },
      ],
      phone_number_collection: {
        enabled: true,
      },
      payment_intent_data: {
        metadata: {
          orderId,
          orderSource: 'mtl-archives-next-app',
        },
      },
      metadata: {
        orderId,
        lang: body.lang,
        customerName: trimMetadataValue(customerName) || '',
        customerNotes: trimMetadataValue(body.customerNotes) || '',
      },
      success_url: successUrlWithSessionId,
      cancel_url: cancelUrl.toString(),
    });

    return NextResponse.json({
      success: true,
      orderId,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create Stripe Checkout session' },
      { status: 500 }
    );
  }
}
