import type { Metadata } from 'next';
import { PortToCityExperience } from '@/components/port-to-city/PortToCityExperience';
import { getPortToCityExperience } from '@/lib/port-to-city';

export const metadata: Metadata = {
  title: 'Port to City, evidence core',
  description: 'A reviewed, source-linked archive sequence connecting Montréal\'s working harbour, rue de la Commune and the later visitor district.',
  robots: { index: false, follow: false },
};

export default function PortToCityPage() {
  return <PortToCityExperience experience={getPortToCityExperience('port-to-city')} />;
}
