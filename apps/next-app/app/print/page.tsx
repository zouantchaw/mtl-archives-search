import type { Metadata } from 'next';
import { PrintGalleryClient } from './PrintGalleryClient';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

export const metadata: Metadata = {
  title: 'Impressions',
  description: 'Choisissez une photo historique de Montréal à imprimer.',
  alternates: {
    canonical: `${siteUrl}/print`,
  },
};

export default function PrintPage() {
  return <PrintGalleryClient />;
}
