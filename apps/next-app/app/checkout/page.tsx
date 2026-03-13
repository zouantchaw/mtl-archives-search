import type { Metadata } from 'next';
import { CheckoutClient } from './CheckoutClient';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

export const metadata: Metadata = {
  title: 'Commande',
  description: 'Finalisez votre commande de tirages d’archives de Montréal.',
  alternates: {
    canonical: `${siteUrl}/checkout`,
  },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
