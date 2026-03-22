import { type NextRequest, NextResponse } from 'next/server';
import {
  CHECKOUT_CURRENCY,
  checkoutRequestSchema,
  generateOrderId,
  resolveStripeImageUrl,
  trimMetadataValue,
  toStripeAmount,
} from '@/lib/checkout';
import { appendLangParam } from '@/lib/i18n';
import { calculateShippingQuote, validateShippingAddress } from '@/lib/shipping';
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
    const shippingAddressValidation = validateShippingAddress({
      line1: body.customerAddressLine1,
      line2: body.customerAddressLine2,
      city: body.customerCity,
      state: body.customerState,
      postalCode: body.customerPostalCode,
      country: body.customerCountry,
    });

    if (!shippingAddressValidation.normalized) {
      return NextResponse.json(
        { success: false, error: 'Invalid shipping address' },
        { status: 400 }
      );
    }

    const shippingAddress = shippingAddressValidation.normalized;
    const shippingQuote = calculateShippingQuote(shippingAddress, body.items, body.lang);
    const customer = await stripe.customers.create({
      email: body.customerEmail,
      name: customerName,
      address: {
        line1: shippingAddress.line1,
        ...(shippingAddress.line2 ? { line2: shippingAddress.line2 } : {}),
        city: shippingAddress.city,
        state: shippingAddress.state,
        postal_code: shippingAddress.postalCode,
        country: shippingAddress.country,
      },
      shipping: {
        name: customerName,
        address: {
          line1: shippingAddress.line1,
          ...(shippingAddress.line2 ? { line2: shippingAddress.line2 } : {}),
          city: shippingAddress.city,
          state: shippingAddress.state,
          postal_code: shippingAddress.postalCode,
          country: shippingAddress.country,
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
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: body.lang === 'fr' ? 'Livraison' : 'Shipping',
            fixed_amount: {
              amount: shippingQuote.amountCents,
              currency: CHECKOUT_CURRENCY,
            },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: shippingQuote.deliveryEstimate.minBusinessDays },
              maximum: { unit: 'business_day', value: shippingQuote.deliveryEstimate.maxBusinessDays },
            },
            metadata: {
              orderId,
              shippingZone: shippingQuote.zone,
              shippingWeightOz: String(shippingQuote.totalWeightOz),
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
          shippingZone: shippingQuote.zone,
          shippingAmountCents: String(shippingQuote.amountCents),
          shippingCountry: shippingAddress.country,
          shippingState: shippingAddress.state,
          shippingPostalCode: shippingAddress.postalCode,
        },
        shipping: {
          name: customerName,
          address: {
            line1: shippingAddress.line1,
            ...(shippingAddress.line2 ? { line2: shippingAddress.line2 } : {}),
            city: shippingAddress.city,
            state: shippingAddress.state,
            postal_code: shippingAddress.postalCode,
            country: shippingAddress.country,
          },
        },
      },
      metadata: {
        orderId,
        lang: body.lang,
        customerName: trimMetadataValue(customerName) || '',
        customerNotes: trimMetadataValue(body.customerNotes) || '',
        customerAddressLine1: trimMetadataValue(shippingAddress.line1) || '',
        customerAddressLine2: trimMetadataValue(shippingAddress.line2) || '',
        customerCity: trimMetadataValue(shippingAddress.city) || '',
        customerState: trimMetadataValue(shippingAddress.state) || '',
        customerPostalCode: trimMetadataValue(shippingAddress.postalCode) || '',
        customerCountry: trimMetadataValue(shippingAddress.country) || '',
        shippingAmountCents: String(shippingQuote.amountCents),
        shippingZone: shippingQuote.zone,
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
