import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
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

interface OrderConfirmationEmailProps {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress?: string;
  items: OrderItem[];
  subtotal: number;
  orderId: string;
  orderDate: string;
  lang?: 'fr' | 'en';
}

const translations = {
  fr: {
    preview: 'Confirmation de votre commande - MTL Archives',
    heading: 'Confirmation de commande',
    greeting: 'Bonjour',
    thanks: 'Merci pour votre commande! Nous avons bien recu votre demande et nous vous contacterons sous peu pour finaliser le paiement et la livraison.',
    orderDetails: 'Details de la commande',
    orderId: 'Numero de commande',
    date: 'Date',
    items: 'Articles commandes',
    quantity: 'Qte',
    summary: 'Resume',
    subtotal: 'Sous-total',
    contact: 'Vos coordonnees',
    name: 'Nom',
    email: 'Courriel',
    phone: 'Telephone',
    address: 'Adresse',
    nextSteps: 'Prochaines etapes',
    step1: 'Notre equipe examinera votre commande',
    step2: 'Nous vous contacterons pour confirmer les details et le paiement',
    step3: 'Vos impressions seront preparees avec soin',
    step4: 'Livraison ou cueillette selon votre preference',
    questions: 'Des questions? Repondez a ce courriel ou contactez-nous a',
    closing: 'Merci de votre confiance!',
    team: 'L\'equipe MTL Archives',
  },
  en: {
    preview: 'Your order confirmation - MTL Archives',
    heading: 'Order Confirmation',
    greeting: 'Hello',
    thanks: 'Thank you for your order! We have received your request and will contact you shortly to finalize payment and delivery.',
    orderDetails: 'Order Details',
    orderId: 'Order Number',
    date: 'Date',
    items: 'Items Ordered',
    quantity: 'Qty',
    summary: 'Summary',
    subtotal: 'Subtotal',
    contact: 'Your Contact Information',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    address: 'Address',
    nextSteps: 'Next Steps',
    step1: 'Our team will review your order',
    step2: 'We will contact you to confirm details and payment',
    step3: 'Your prints will be carefully prepared',
    step4: 'Delivery or pickup based on your preference',
    questions: 'Questions? Reply to this email or contact us at',
    closing: 'Thank you for your trust!',
    team: 'The MTL Archives Team',
  },
};

export function OrderConfirmationEmail({
  customerName,
  customerEmail,
  customerPhone,
  customerAddress,
  items,
  subtotal,
  orderId,
  orderDate,
  lang = 'fr',
}: OrderConfirmationEmailProps) {
  const t = translations[lang];
  const formattedSubtotal = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(subtotal);

  return (
    <Html>
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            {/* Header */}
            <Heading style={heading}>{t.heading}</Heading>

            <Text style={paragraph}>
              {t.greeting} {customerName},
            </Text>
            <Text style={paragraph}>{t.thanks}</Text>

            {/* Order Details */}
            <Section style={detailsContainer}>
              <Heading as="h3" style={subheading}>
                {t.orderDetails}
              </Heading>
              <Text style={detailRow}>
                <strong>{t.orderId}:</strong> {orderId}
              </Text>
              <Text style={detailRow}>
                <strong>{t.date}:</strong> {orderDate}
              </Text>
            </Section>

            {/* Items */}
            <Section style={detailsContainer}>
              <Heading as="h3" style={subheading}>
                {t.items}
              </Heading>
              {items.map((item, index) => (
                <div key={index} style={itemRow}>
                  <Text style={detailRow}>
                    <strong>{item.photoName}</strong>
                  </Text>
                  <Text style={itemDetails}>
                    {item.size} · {item.frame} · {t.quantity}: {item.quantity}
                  </Text>
                  <Text style={itemPrice}>
                    ${(item.price * item.quantity).toFixed(2)}
                  </Text>
                </div>
              ))}
              <Hr style={hr} />
              <Text style={totalRow}>
                <strong>{t.subtotal}:</strong> {formattedSubtotal}
              </Text>
            </Section>

            {/* Contact Info */}
            <Section style={detailsContainer}>
              <Heading as="h3" style={subheading}>
                {t.contact}
              </Heading>
              <Text style={detailRow}>
                <strong>{t.name}:</strong> {customerName}
              </Text>
              <Text style={detailRow}>
                <strong>{t.email}:</strong> {customerEmail}
              </Text>
              {customerPhone && (
                <Text style={detailRow}>
                  <strong>{t.phone}:</strong> {customerPhone}
                </Text>
              )}
              {customerAddress && (
                <Text style={detailRow}>
                  <strong>{t.address}:</strong> {customerAddress}
                </Text>
              )}
            </Section>

            {/* Next Steps */}
            <Section style={stepsContainer}>
              <Heading as="h3" style={subheading}>
                {t.nextSteps}
              </Heading>
              <Text style={stepItem}>1. {t.step1}</Text>
              <Text style={stepItem}>2. {t.step2}</Text>
              <Text style={stepItem}>3. {t.step3}</Text>
              <Text style={stepItem}>4. {t.step4}</Text>
            </Section>

            <Hr style={hr} />

            <Text style={paragraph}>
              {t.questions} <strong>support@mtlarchives.com</strong>
            </Text>

            <Text style={paragraph}>{t.closing}</Text>
            <Text style={signature}>{t.team}</Text>
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
  textAlign: 'center' as const,
};

const subheading = {
  fontSize: '16px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 12px',
};

const paragraph = {
  margin: '0 0 15px',
  fontSize: '15px',
  lineHeight: '1.5',
  color: '#3c4149',
};

const detailsContainer = {
  padding: '20px',
  backgroundColor: '#fafafa',
  borderRadius: '8px',
  marginBottom: '20px',
};

const stepsContainer = {
  padding: '20px',
  backgroundColor: '#f0f9ff',
  borderRadius: '8px',
  marginBottom: '20px',
  border: '1px solid #bae6fd',
};

const detailRow = {
  margin: '0 0 8px',
  fontSize: '14px',
  color: '#3c4149',
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

const itemPrice = {
  margin: '4px 0 0',
  fontSize: '14px',
  fontWeight: '600',
  color: '#171717',
};

const totalRow = {
  margin: '0',
  fontSize: '16px',
  color: '#171717',
  textAlign: 'right' as const,
};

const stepItem = {
  margin: '0 0 8px',
  fontSize: '14px',
  color: '#0369a1',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const signature = {
  margin: '0',
  fontSize: '14px',
  color: '#737373',
  fontStyle: 'italic' as const,
};
