import type { Metadata } from 'next';
import { CheckoutClient } from './CheckoutClient';
import { bilingualMetadata, langFromSearchParams } from '@/lib/seo';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/checkout', {
    fr: {
      title: 'Commande',
      description: 'Finalisez votre commande de tirages d\u2019archives de Montréal.',
    },
    en: {
      title: 'Checkout',
      description: 'Complete your order for Montreal archive prints.',
    },
  }, {
    robots: { index: false, follow: true },
  });
}

export default function CheckoutPage() {
  return <CheckoutClient />;
}
