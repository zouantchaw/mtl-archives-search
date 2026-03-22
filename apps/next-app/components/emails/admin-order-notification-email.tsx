import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface OrderItem {
  photoId: string;
  photoName: string;
  photoUrl: string;
  size: string;
  frame: string;
  price: number;
  quantity: number;
}

interface AdminOrderNotificationEmailProps {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress: string;
  customerNotes?: string;
  items: OrderItem[];
  total: number;
  orderId: string;
  orderDate: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
}

export function AdminOrderNotificationEmail({
  customerName,
  customerEmail,
  customerPhone,
  customerAddress,
  customerNotes,
  items,
  total,
  orderId,
  orderDate,
  stripeSessionId,
  stripePaymentIntentId,
}: AdminOrderNotificationEmailProps) {
  const formattedTotal = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(total);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Html>
      <Head />
      <Preview>
        Paid Order #{orderId} - {customerName} - {formattedTotal}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={heading}>Paid Print Order Received</Heading>

            {/* Alert Box */}
            <Section style={alertContainer}>
              <Text style={alertText}>
                <strong>Order ID:</strong> {orderId}
              </Text>
              <Text style={alertText}>
                <strong>Date:</strong> {orderDate}
              </Text>
              <Text style={alertText}>
                <strong>Total Items:</strong> {totalItems}
              </Text>
              <Text style={alertText}>
                <strong>Amount Paid:</strong> {formattedTotal}
              </Text>
              {stripeSessionId ? (
                <Text style={alertText}>
                  <strong>Stripe Session:</strong> {stripeSessionId}
                </Text>
              ) : null}
              {stripePaymentIntentId ? (
                <Text style={alertText}>
                  <strong>Payment Intent:</strong> {stripePaymentIntentId}
                </Text>
              ) : null}
            </Section>

            {/* Customer Info */}
            <Section style={detailsContainer}>
              <Heading as="h3" style={subheading}>
                Customer Information
              </Heading>
              <Text style={detailRow}>
                <strong>Name:</strong> {customerName}
              </Text>
              <Text style={detailRow}>
                <strong>Email:</strong> {customerEmail}
              </Text>
              {customerPhone && (
                <Text style={detailRow}>
                  <strong>Phone:</strong> {customerPhone}
                </Text>
              )}
              <Text style={detailRow}>
                <strong>Address:</strong> {customerAddress}
              </Text>
              {customerNotes && (
                <>
                  <Hr style={hr} />
                  <Text style={detailRow}>
                    <strong>Customer Notes:</strong>
                  </Text>
                  <Text style={notesText}>{customerNotes}</Text>
                </>
              )}
            </Section>

            {/* Items Ordered */}
            <Section style={detailsContainer}>
              <Heading as="h3" style={subheading}>
                Items Ordered
              </Heading>
              {items.map((item, index) => (
                <div key={index} style={itemRow}>
                  <Text style={detailRow}>
                    <strong>{item.photoName}</strong>
                  </Text>
                  <Text style={itemDetails}>Photo ID: {item.photoId}</Text>
                  <Text style={itemDetails}>
                    Size: {item.size} | Frame: {item.frame}
                  </Text>
                  <Text style={itemDetails}>
                    Quantity: {item.quantity} x ${item.price.toFixed(2)} = $
                    {(item.price * item.quantity).toFixed(2)}
                  </Text>
                  {item.photoUrl && (
                    <Text style={itemDetails}>
                      <a href={item.photoUrl} style={linkStyle}>
                        View Original Photo
                      </a>
                    </Text>
                  )}
                </div>
              ))}
              <Hr style={hr} />
              <Text style={totalRow}>
                <strong>Amount Paid: {formattedTotal}</strong>
              </Text>
            </Section>

            {/* Action Required */}
            <Section style={actionContainer}>
              <Heading as="h3" style={subheading}>
                Action Required
              </Heading>
              <Text style={actionItem}>
                1. Verify the paid order details and archive reference
              </Text>
              <Text style={actionItem}>
                2. Prepare the print order for production
              </Text>
              <Text style={actionItem}>3. Coordinate delivery or pickup if needed</Text>
              <Text style={actionItem}>
                4. Contact the customer only if a production or shipping detail needs confirmation
              </Text>
            </Section>

            <Hr style={hr} />

            <Text style={footerText}>
              This paid order was submitted through mtlarchives.com
            </Text>
            <Text style={footerText}>
              Reply to customer: {customerEmail}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
};

const content = {
  padding: '0 48px',
};

const heading = {
  fontSize: '24px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '600',
  color: '#171717',
  padding: '17px 0 0',
};

const subheading = {
  fontSize: '16px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 12px',
};

const detailsContainer = {
  padding: '20px',
  backgroundColor: '#fafafa',
  borderRadius: '8px',
  marginBottom: '20px',
};

const alertContainer = {
  padding: '20px',
  backgroundColor: '#dcfce7',
  borderRadius: '8px',
  marginBottom: '20px',
  border: '1px solid #22c55e',
};

const actionContainer = {
  padding: '20px',
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  marginBottom: '20px',
  border: '1px solid #f59e0b',
};

const detailRow = {
  margin: '0 0 8px',
  fontSize: '14px',
  color: '#3c4149',
};

const alertText = {
  margin: '0 0 8px',
  fontSize: '14px',
  color: '#166534',
  fontWeight: '600' as const,
};

const actionItem = {
  margin: '0 0 8px',
  fontSize: '14px',
  color: '#92400e',
};

const itemRow = {
  marginBottom: '16px',
  paddingBottom: '12px',
  borderBottom: '1px solid #e5e5e5',
};

const itemDetails = {
  margin: '4px 0',
  fontSize: '13px',
  color: '#737373',
};

const totalRow = {
  margin: '0',
  fontSize: '16px',
  color: '#171717',
  textAlign: 'right' as const,
};

const notesText = {
  margin: '8px 0 0',
  fontSize: '14px',
  color: '#3c4149',
  backgroundColor: '#fff',
  padding: '12px',
  borderRadius: '4px',
  border: '1px solid #e5e5e5',
  whiteSpace: 'pre-wrap' as const,
};

const linkStyle = {
  color: '#2563eb',
  textDecoration: 'underline',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const footerText = {
  margin: '0 0 8px',
  fontSize: '12px',
  color: '#737373',
};
