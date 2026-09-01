import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PortToCityExperience } from '@/components/port-to-city/PortToCityExperience';
import { canRenderPortToCity, getPortToCityExperience, isRecipientCut } from '@/lib/port-to-city';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ cut: 'old-port' }, { cut: 'sdc-vieux-montreal' }];
}

export async function generateMetadata({ params }: { params: Promise<{ cut: string }> }): Promise<Metadata> {
  const { cut } = await params;
  if (!isRecipientCut(cut)) return {};
  const experience = getPortToCityExperience(cut);

  return {
    title: experience.cut.title,
    description: experience.cut.dek,
    robots: { index: false, follow: false },
  };
}

export default async function RecipientCutPage({ params }: { params: Promise<{ cut: string }> }) {
  const { cut } = await params;
  if (!canRenderPortToCity() || !isRecipientCut(cut)) notFound();

  return <PortToCityExperience experience={getPortToCityExperience(cut)} />;
}
