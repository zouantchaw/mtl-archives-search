import type { Metadata } from 'next';
import Link from 'next/link';
import { appendLangParam, normalizeLang } from '@/lib/i18n';
import { bilingualMetadata, langFromSearchParams } from '@/lib/seo';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/order-confirmation', {
    fr: {
      title: 'Confirmation',
      description: 'Votre commande MTL Archives a été reçue.',
    },
    en: {
      title: 'Confirmation',
      description: 'Your MTL Archives order has been received.',
    },
  }, {
    robots: { index: false, follow: true },
  });
}

const translations = {
  fr: {
    title: 'Commande reçue',
    body: 'Merci. Nous vous avons envoyé un courriel de confirmation et nous reviendrons vers vous pour finaliser le paiement et la livraison.',
    orderNumber: 'Numéro de commande',
    emailLabel: 'Courriel de confirmation',
    continue: 'Continuer à explorer',
    playGame: 'Jouer au jeu quotidien',
  },
  en: {
    title: 'Order received',
    body: 'Thank you. We sent a confirmation email and will follow up to finalize payment and shipping.',
    orderNumber: 'Order number',
    emailLabel: 'Confirmation email',
    continue: 'Continue exploring',
    playGame: 'Play the daily game',
  },
} as const;

export default async function OrderConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; email?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const lang = normalizeLang(params.lang);
  const t = translations[lang];

  return (
    <main className="min-h-screen bg-background px-5 py-10 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <div className="hidden items-center justify-between pb-10 lg:flex">
          <Link href={appendLangParam('/', lang)} className="text-[16px] font-semibold text-foreground no-underline">
            mtl archives
          </Link>
          <nav className="flex items-center gap-8 text-[14px]">
            <Link href={appendLangParam('/search', lang)} className="text-foreground/60 transition-colors hover:text-foreground">
              {lang === 'fr' ? 'Explorer' : 'Explore'}
            </Link>
            <Link href={appendLangParam('/game', lang)} className="text-primary transition-colors hover:text-primary/80">
              {lang === 'fr' ? 'Jeu quotidien' : 'Daily game'}
            </Link>
            <Link href={appendLangParam('/print', lang)} className="text-foreground/60 transition-colors hover:text-foreground">
              {lang === 'fr' ? 'Impressions' : 'Prints'}
            </Link>
          </nav>
        </div>

        <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-green text-white shadow-[0_16px_34px_rgba(52,199,89,0.22)]">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <h1 className="text-display mt-8 text-[3rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[4.2rem]">
            {t.title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-muted-foreground">{t.body}</p>

          {params.orderId ? (
            <div className="mt-10 text-center">
              <p className="mono-metric text-[11px] text-muted-foreground">{t.orderNumber}</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground">{params.orderId}</p>
              {params.email ? (
                <p className="mt-4 text-base text-muted-foreground">{params.email}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-10 flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href={appendLangParam('/', lang)}
              className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
            >
              {t.continue}
            </Link>
            <Link
              href={appendLangParam('/game', lang)}
              className="inline-flex h-12 items-center justify-center rounded-full border border-input px-6 text-sm font-medium text-foreground transition-colors hover:bg-card"
            >
              {t.playGame}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
