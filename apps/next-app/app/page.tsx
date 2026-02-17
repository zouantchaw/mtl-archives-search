import type { Metadata } from 'next';
import { ArchiveStore } from "@/components/ArchiveStore";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

export const metadata: Metadata = {
  alternates: {
    canonical: siteUrl,
    languages: {
      'fr-CA': `${siteUrl}?lang=fr`,
      'en-CA': `${siteUrl}?lang=en`,
      'x-default': siteUrl,
    },
  },
};

export default function Page() {
  return <ArchiveStore />;
}
