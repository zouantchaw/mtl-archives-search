'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { MtlArchivesLogo } from '@/components/LandingHero';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050814] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,94,168,0.2),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(200,112,54,0.12),_transparent_30%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-5 py-10">
        <div className="w-full max-w-[26rem]">
          <Link href="/" className="mb-8 flex items-center justify-center gap-3">
            <MtlArchivesLogo size={26} />
            <span className="text-[2rem] font-semibold tracking-[-0.03em] text-white">mtl archives</span>
          </Link>
          <div className="rounded-[2rem] border border-white/6 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:p-8">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

export const clerkV4Appearance = {
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full',
    card: 'w-full border-0 bg-transparent p-0 shadow-none',
    headerTitle: 'text-display text-4xl font-semibold tracking-[-0.04em] text-white',
    headerSubtitle: 'hidden',
    socialButtonsBlockButton:
      'h-12 rounded-2xl border border-white/8 bg-[#060816] text-white shadow-none hover:bg-white/[0.06]',
    socialButtonsBlockButtonText: 'font-medium text-white',
    dividerLine: 'bg-white/8',
    dividerText: 'mono-metric text-[10px] text-white/35',
    formFieldLabel: 'mono-metric mb-2 text-[10px] text-white/50',
    formFieldInput:
      'h-12 rounded-2xl border border-white/8 bg-[#060816] text-white placeholder:text-white/25 shadow-none focus:border-white/14 focus:ring-0',
    formButtonPrimary:
      'mt-3 h-12 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-none hover:bg-primary/92',
    footerActionText: 'text-white/45',
    footerActionLink: 'font-medium text-primary hover:text-primary/80',
    formFieldAction: 'text-primary hover:text-primary/80',
    identityPreviewText: 'text-white',
    identityPreviewEditButton: 'text-primary hover:text-primary/80',
    otpCodeFieldInput:
      'h-12 rounded-2xl border border-white/8 bg-[#060816] text-white shadow-none',
    alertText: 'text-sm text-white',
    alertClerkError: 'rounded-2xl border border-red-500/20 bg-red-500/10 text-red-100',
    formResendCodeLink: 'text-primary hover:text-primary/80',
  },
} as const;
