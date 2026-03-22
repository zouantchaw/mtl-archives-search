import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
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
  customerAddress: string;
  items: OrderItem[];
  total: number;
  orderId: string;
  orderDate: string;
  lang?: 'fr' | 'en';
}

const translations = {
  fr: {
    preview: 'Confirmation de votre commande #{orderId} - MTL Archives',
    heading: 'Merci pour votre commande!',
    greeting: 'Bonjour',
    intro: 'Nous avons bien recu votre commande et votre paiement. Voici les details de votre impression.',
    whatHappensNext: 'Que se passe-t-il ensuite?',
    step1Title: 'Paiement confirme',
    step1Desc: 'Votre paiement a bien ete accepte et votre commande est maintenant dans notre file de production.',
    step2Title: 'Preparation',
    step2Desc: 'Notre equipe verifie les references d\'archives et prepare vos impressions avec les specifications choisies.',
    step3Title: 'Suivi',
    step3Desc: 'Nous vous contacterons seulement si nous avons besoin de confirmer un detail de livraison ou de production.',
    step4Title: 'Production et livraison',
    step4Desc: 'Vos impressions seront preparees avec soin et livrees a l\'adresse indiquee, ou disponibles pour cueillette.',
    orderSummary: 'Resume de la commande',
    orderId: 'Commande',
    date: 'Date',
    yourPrints: 'Vos impressions',
    quantity: 'Qte',
    size: 'Format',
    frame: 'Encadrement',
    estimatedTotal: 'Montant paye',
    deliveryAddress: 'Adresse de livraison',
    contactInfo: 'Vos coordonnees',
    name: 'Nom',
    email: 'Courriel',
    phone: 'Telephone',
    aboutPrints: 'A propos de vos impressions',
    aboutPrintsDesc: 'Chaque impression est realisee sur papier archive de haute qualite, garantissant une reproduction fidele des photos historiques de Montreal. Nos encadrements sont fabriques localement avec des materiaux de qualite musee.',
    questions: 'Des questions?',
    questionsDesc: 'Repondez simplement a ce courriel ou contactez-nous a',
    viewArchive: 'Explorez plus de photos',
    closing: 'Merci de contribuer a la preservation de l\'histoire de Montreal!',
    team: 'L\'equipe MTL Archives',
    footerText: 'Vous recevez ce courriel car vous avez passe une commande sur mtlarchives.com',
  },
  en: {
    preview: 'Order Confirmation #{orderId} - MTL Archives',
    heading: 'Thank you for your order!',
    greeting: 'Hello',
    intro: 'We have received your order and payment. Here are the details of your print purchase.',
    whatHappensNext: 'What happens next?',
    step1Title: 'Payment Confirmed',
    step1Desc: 'Your payment has been accepted and your order is now in our production queue.',
    step2Title: 'Preparation',
    step2Desc: 'Our team reviews the archive reference and prepares your print with the selected specifications.',
    step3Title: 'Follow-up if Needed',
    step3Desc: 'We will only contact you if we need to confirm a delivery or production detail.',
    step4Title: 'Production & Delivery',
    step4Desc: 'Your prints will be carefully prepared and delivered to the address provided, or available for pickup.',
    orderSummary: 'Order Summary',
    orderId: 'Order',
    date: 'Date',
    yourPrints: 'Your Prints',
    quantity: 'Qty',
    size: 'Size',
    frame: 'Frame',
    estimatedTotal: 'Amount Paid',
    deliveryAddress: 'Delivery Address',
    contactInfo: 'Your Contact Information',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    aboutPrints: 'About Your Prints',
    aboutPrintsDesc: 'Each print is produced on high-quality archival paper, ensuring faithful reproduction of Montreal\'s historic photos. Our frames are locally crafted with museum-quality materials.',
    questions: 'Questions?',
    questionsDesc: 'Simply reply to this email or contact us at',
    viewArchive: 'Explore more photos',
    closing: 'Thank you for helping preserve Montreal\'s history!',
    team: 'The MTL Archives Team',
    footerText: 'You are receiving this email because you placed an order on mtlarchives.com',
  },
};

export function OrderConfirmationEmail({
  customerName,
  customerEmail,
  customerPhone,
  customerAddress,
  items,
  total,
  orderId,
  orderDate,
  lang = 'fr',
}: OrderConfirmationEmailProps) {
  const t = translations[lang];
  const formattedTotal = new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(total);
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Html>
      <Head />
      <Preview>{t.preview.replace('{orderId}', orderId)}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Logo */}
          <Section style={headerSection}>
            <Text style={logoText}>MTL ARCHIVES</Text>
            <Text style={tagline}>
              {lang === 'fr' ? 'Photos historiques de Montreal' : 'Historic Montreal Photography'}
            </Text>
          </Section>

          <Section style={content}>
            {/* Main Heading */}
            <Heading style={heading}>{t.heading}</Heading>

            <Text style={paragraph}>
              {t.greeting} {customerName},
            </Text>
            <Text style={paragraph}>{t.intro}</Text>

            {/* Order Reference Box */}
            <Section style={orderRefBox}>
              <table style={orderRefTable}>
                <tbody>
                  <tr>
                    <td style={orderRefCell}>
                      <Text style={orderRefLabel}>{t.orderId}</Text>
                      <Text style={orderRefValue}>{orderId}</Text>
                    </td>
                    <td style={orderRefCell}>
                      <Text style={orderRefLabel}>{t.date}</Text>
                      <Text style={orderRefValueSmall}>{orderDate}</Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {/* What Happens Next */}
            <Section style={stepsSection}>
              <Heading as="h2" style={sectionHeading}>
                {t.whatHappensNext}
              </Heading>

              <div style={stepItem}>
                <Text style={stepNumber}>1</Text>
                <div style={stepContent}>
                  <Text style={stepTitle}>{t.step1Title}</Text>
                  <Text style={stepDesc}>{t.step1Desc}</Text>
                </div>
              </div>

              <div style={stepItem}>
                <Text style={stepNumber}>2</Text>
                <div style={stepContent}>
                  <Text style={stepTitle}>{t.step2Title}</Text>
                  <Text style={stepDesc}>{t.step2Desc}</Text>
                </div>
              </div>

              <div style={stepItem}>
                <Text style={stepNumber}>3</Text>
                <div style={stepContent}>
                  <Text style={stepTitle}>{t.step3Title}</Text>
                  <Text style={stepDesc}>{t.step3Desc}</Text>
                </div>
              </div>

              <div style={stepItem}>
                <Text style={stepNumber}>4</Text>
                <div style={stepContent}>
                  <Text style={stepTitle}>{t.step4Title}</Text>
                  <Text style={stepDesc}>{t.step4Desc}</Text>
                </div>
              </div>
            </Section>

            <Hr style={hr} />

            {/* Your Prints */}
            <Section style={printsSection}>
              <Heading as="h2" style={sectionHeading}>
                {t.yourPrints}
              </Heading>

              {items.map((item, index) => (
                <div key={index} style={printItem}>
                  <div style={printDetails}>
                    <Text style={printName}>{item.photoName}</Text>
                    <Text style={printMeta}>
                      {t.size}: {item.size} | {t.frame}: {item.frame}
                    </Text>
                    <Text style={printMeta}>
                      {t.quantity}: {item.quantity}
                    </Text>
                  </div>
                  <Text style={printPrice}>
                    ${(item.price * item.quantity).toFixed(2)}
                  </Text>
                </div>
              ))}

              <Hr style={subtotalHr} />

              <div style={totalRow}>
                <Text style={totalLabel}>{t.estimatedTotal}</Text>
                <Text style={totalValue}>{formattedTotal}</Text>
              </div>
            </Section>

            <Hr style={hr} />

            {/* Delivery Address */}
            <Section style={addressSection}>
              <Heading as="h3" style={smallHeading}>
                {t.deliveryAddress}
              </Heading>
              <Text style={addressText}>{customerAddress}</Text>
            </Section>

            {/* Contact Info */}
            <Section style={contactSection}>
              <Heading as="h3" style={smallHeading}>
                {t.contactInfo}
              </Heading>
              <Text style={contactText}>
                <strong>{t.name}:</strong> {customerName}
              </Text>
              <Text style={contactText}>
                <strong>{t.email}:</strong> {customerEmail}
              </Text>
              {customerPhone && (
                <Text style={contactText}>
                  <strong>{t.phone}:</strong> {customerPhone}
                </Text>
              )}
            </Section>

            <Hr style={hr} />

            {/* About Your Prints */}
            <Section style={aboutSection}>
              <Heading as="h3" style={smallHeading}>
                {t.aboutPrints}
              </Heading>
              <Text style={aboutText}>{t.aboutPrintsDesc}</Text>
            </Section>

            {/* Questions */}
            <Section style={questionsSection}>
              <Heading as="h3" style={smallHeading}>
                {t.questions}
              </Heading>
              <Text style={questionsText}>
                {t.questionsDesc}{' '}
                <Link href="mailto:support@mtlarchives.com" style={emailLink}>
                  support@mtlarchives.com
                </Link>
              </Text>
            </Section>

            {/* CTA Button */}
            <Section style={ctaSection}>
              <Link href="https://www.mtlarchives.com" style={ctaButton}>
                {t.viewArchive}
              </Link>
            </Section>

            <Hr style={hr} />

            {/* Closing */}
            <Text style={closingText}>{t.closing}</Text>
            <Text style={signature}>{t.team}</Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>{t.footerText}</Text>
            <Text style={footerLinks}>
              <Link href="https://www.mtlarchives.com" style={footerLink}>
                mtlarchives.com
              </Link>
              {' | '}
              <Link href="https://www.instagram.com/mtlarchives" style={footerLink}>
                @mtlarchives
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Styles
const main = {
  backgroundColor: '#f4f4f5',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  maxWidth: '600px',
  borderRadius: '8px',
  overflow: 'hidden',
  marginTop: '40px',
  marginBottom: '40px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
};

const headerSection = {
  backgroundColor: '#171717',
  padding: '32px 48px',
  textAlign: 'center' as const,
};

const logoText = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: '700',
  letterSpacing: '2px',
  margin: '0 0 4px',
};

const tagline = {
  color: '#a3a3a3',
  fontSize: '12px',
  letterSpacing: '1px',
  margin: '0',
  textTransform: 'uppercase' as const,
};

const content = {
  padding: '40px 48px',
};

const heading = {
  fontSize: '28px',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 24px',
  textAlign: 'center' as const,
};

const sectionHeading = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 16px',
};

const smallHeading = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const paragraph = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#3f3f46',
  margin: '0 0 16px',
};

const orderRefBox = {
  backgroundColor: '#fafafa',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '32px',
  border: '1px solid #e4e4e7',
};

const orderRefTable = {
  width: '100%',
  borderCollapse: 'collapse' as const,
};

const orderRefCell = {
  padding: '0 12px',
  verticalAlign: 'top' as const,
};

const orderRefLabel = {
  fontSize: '11px',
  fontWeight: '600',
  color: '#71717a',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  margin: '0 0 4px',
};

const orderRefValue = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#171717',
  fontFamily: 'monospace',
  margin: '0',
};

const orderRefValueSmall = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#171717',
  margin: '0',
};

const stepsSection = {
  marginBottom: '32px',
};

const stepItem = {
  display: 'flex',
  marginBottom: '16px',
};

const stepNumber = {
  width: '28px',
  height: '28px',
  backgroundColor: '#171717',
  color: '#ffffff',
  borderRadius: '50%',
  fontSize: '13px',
  fontWeight: '600',
  textAlign: 'center' as const,
  lineHeight: '28px',
  margin: '0 12px 0 0',
  flexShrink: 0,
};

const stepContent = {
  flex: 1,
};

const stepTitle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 2px',
};

const stepDesc = {
  fontSize: '13px',
  color: '#71717a',
  margin: '0',
  lineHeight: '1.5',
};

const printsSection = {
  marginBottom: '24px',
};

const printItem = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: '16px 0',
  borderBottom: '1px solid #e4e4e7',
};

const printDetails = {
  flex: 1,
};

const printName = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#171717',
  margin: '0 0 4px',
};

const printMeta = {
  fontSize: '13px',
  color: '#71717a',
  margin: '0 0 2px',
};

const printPrice = {
  fontSize: '15px',
  fontWeight: '600',
  color: '#171717',
  margin: '0',
  textAlign: 'right' as const,
};

const subtotalHr = {
  borderColor: '#e4e4e7',
  margin: '16px 0',
};

const totalRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',
};

const totalLabel = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#171717',
  margin: '0',
};

const totalValue = {
  fontSize: '20px',
  fontWeight: '700',
  color: '#171717',
  margin: '0',
};

const taxesNote = {
  fontSize: '12px',
  color: '#71717a',
  fontStyle: 'italic' as const,
  margin: '0',
};

const addressSection = {
  backgroundColor: '#fafafa',
  borderRadius: '8px',
  padding: '16px 20px',
  marginBottom: '16px',
};

const addressText = {
  fontSize: '14px',
  color: '#3f3f46',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
  lineHeight: '1.5',
};

const contactSection = {
  marginBottom: '24px',
};

const contactText = {
  fontSize: '14px',
  color: '#3f3f46',
  margin: '0 0 6px',
};

const aboutSection = {
  backgroundColor: '#f0f9ff',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '24px',
  border: '1px solid #bae6fd',
};

const aboutText = {
  fontSize: '13px',
  color: '#0369a1',
  margin: '0',
  lineHeight: '1.6',
};

const questionsSection = {
  marginBottom: '24px',
};

const questionsText = {
  fontSize: '14px',
  color: '#3f3f46',
  margin: '0',
};

const emailLink = {
  color: '#171717',
  fontWeight: '600',
  textDecoration: 'underline',
};

const ctaSection = {
  textAlign: 'center' as const,
  marginBottom: '24px',
};

const ctaButton = {
  backgroundColor: '#171717',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: '600',
  padding: '12px 32px',
  textDecoration: 'none',
};

const hr = {
  borderColor: '#e4e4e7',
  margin: '24px 0',
};

const closingText = {
  fontSize: '15px',
  color: '#3f3f46',
  margin: '0 0 8px',
  textAlign: 'center' as const,
};

const signature = {
  fontSize: '14px',
  color: '#71717a',
  fontStyle: 'italic' as const,
  margin: '0',
  textAlign: 'center' as const,
};

const footer = {
  backgroundColor: '#fafafa',
  padding: '24px 48px',
  textAlign: 'center' as const,
};

const footerText = {
  fontSize: '12px',
  color: '#a1a1aa',
  margin: '0 0 8px',
};

const footerLinks = {
  fontSize: '12px',
  color: '#71717a',
  margin: '0',
};

const footerLink = {
  color: '#71717a',
  textDecoration: 'underline',
};
