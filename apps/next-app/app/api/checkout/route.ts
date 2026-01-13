import { type NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { OrderConfirmationEmail } from '@/components/emails/order-confirmation-email';
import { AdminOrderNotificationEmail } from '@/components/emails/admin-order-notification-email';

const resend = new Resend(process.env.RESEND_SECRET_KEY);

const ADMIN_EMAIL = 'zouantchaw74@gmail.com';
const FROM_EMAIL = 'MTL Archives <support@support.mtlarchives.com>';

interface OrderItem {
  photoId: string;
  photoName: string;
  photoUrl: string;
  size: string;
  frame: string;
  price: number;
  quantity: number;
}

interface CheckoutRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress: string;
  customerNotes?: string;
  items: OrderItem[];
  subtotal: number;
  lang?: 'fr' | 'en';
}

function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MTL-${timestamp}-${random}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: CheckoutRequest = await request.json();

    const {
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerNotes,
      items,
      subtotal,
      lang = 'fr',
    } = body;

    // Validate required fields
    if (!customerName || !customerEmail || !customerAddress || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const orderId = generateOrderId();
    const orderDate = new Date().toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Send customer confirmation email
    const customerEmailResult = await resend.emails.send({
      from: FROM_EMAIL,
      to: [customerEmail],
      subject: lang === 'fr'
        ? `Confirmation de commande #${orderId} - MTL Archives`
        : `Order Confirmation #${orderId} - MTL Archives`,
      react: OrderConfirmationEmail({
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        items,
        subtotal,
        orderId,
        orderDate,
        lang,
      }),
    });

    if (customerEmailResult.error) {
      console.error('Failed to send customer email:', customerEmailResult.error);
      return NextResponse.json(
        { success: false, error: 'Failed to send confirmation email' },
        { status: 500 }
      );
    }

    // Send admin notification email
    const adminEmailResult = await resend.emails.send({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      replyTo: customerEmail,
      subject: `New Order #${orderId} - ${customerName} - $${subtotal.toFixed(2)}`,
      react: AdminOrderNotificationEmail({
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerNotes,
        items,
        subtotal,
        orderId,
        orderDate,
      }),
    });

    if (adminEmailResult.error) {
      console.error('Failed to send admin email:', adminEmailResult.error);
      // Don't fail the request - customer email was sent successfully
    }

    console.log(`Order ${orderId} processed successfully`);
    console.log(`Customer email sent: ${customerEmailResult.data?.id}`);
    console.log(`Admin email sent: ${adminEmailResult.data?.id}`);

    return NextResponse.json({
      success: true,
      orderId,
      customerEmailId: customerEmailResult.data?.id,
      adminEmailId: adminEmailResult.data?.id,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process order' },
      { status: 500 }
    );
  }
}
