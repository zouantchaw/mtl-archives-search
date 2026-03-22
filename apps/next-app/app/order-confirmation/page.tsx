import type { Metadata } from 'next';
import Link from 'next/link';
import { OrderConfirmationClient } from './OrderConfirmationClient';
import { appendLangParam, normalizeLang } from '@/lib/i18n';
import { bilingualMetadata, langFromSearchParams } from '@/lib/seo';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const lang = langFromSearchParams(await searchParams);
  return bilingualMetadata(lang, '/order-confirmation', {
    fr: {
      title: 'Confirmation',
      description: 'Consultez la confirmation de votre commande MTL Archives.',
    },
    en: {
      title: 'Confirmation',
      description: 'View your MTL Archives order confirmation.',
    },
  }, {
    robots: { index: false, follow: true },
  });
}

const translations = {
  fr: {
    confirmedTitle: 'Paiement confirmé',
    confirmedBody: 'Merci. Votre paiement est confirmé et un courriel de confirmation arrive sous peu. Nous préparons maintenant votre commande manuellement.',
    pendingTitle: 'Commande reçue',
    pendingBody: 'Merci. Nous avons reçu votre retour de paiement, mais nous ne pouvons pas encore confirmer les détails sur cette page.',
    pendingHelp: 'Si votre carte a été débitée, un courriel de confirmation devrait arriver sous peu. Sinon, vous pouvez reprendre le paiement depuis votre panier.',
    orderNumber: 'Numéro de commande',
    emailLabel: 'Courriel',
    amountPaid: 'Montant payé',
    continue: 'Continuer à explorer',
    playGame: 'Jouer au jeu quotidien',
  },
  en: {
    confirmedTitle: 'Payment confirmed',
    confirmedBody: 'Thank you. Your payment is confirmed and a confirmation email should arrive shortly. We are now preparing your order manually.',
    pendingTitle: 'Order received',
    pendingBody: 'Thank you. We received your checkout return, but we cannot confirm the payment details on this page yet.',
    pendingHelp: 'If your card was charged, a confirmation email should still arrive shortly. Otherwise, you can restart payment from your cart.',
    orderNumber: 'Order number',
    emailLabel: 'Email',
    amountPaid: 'Amount paid',
    continue: 'Continue exploring',
    playGame: 'Play the daily game',
  },
} as const;

type ConfirmationDetails = {
  confirmed: boolean;
  orderId?: string;
  email?: string;
  amountPaid?: string;
  total?: number;
  itemCount?: number;
  itemSummary?: string;
};

async function getConfirmationDetails(sessionId: string | undefined, lang: 'fr' | 'en'): Promise<ConfirmationDetails> {
  if (!sessionId || !sessionId.startsWith('cs_') || !process.env.STRIPE_SECRET_KEY) {
    return { confirmed: false };
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const orderId = session.client_reference_id || session.metadata?.orderId || sessionId;
    const email = session.customer_details?.email || session.customer_email || undefined;

    if (session.payment_status !== 'paid') {
      return {
        confirmed: false,
        orderId,
        email,
      };
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
    const total = typeof session.amount_total === 'number' ? session.amount_total / 100 : undefined;
    const itemCount = lineItems.data.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
    const itemSummary = lineItems.data
      .map((item) => item.description)
      .filter(Boolean)
      .join(', ');

    return {
      confirmed: true,
      orderId,
      email,
      amountPaid:
        typeof total === 'number'
          ? new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
              style: 'currency',
              currency: 'CAD',
            }).format(total)
          : undefined,
      total,
      itemCount,
      itemSummary,
    };
  } catch (error) {
    console.error('Failed to load Stripe confirmation details:', error);
    return { confirmed: false };
  }
}

export default async function OrderConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; email?: string; lang?: string; session_id?: string }>;
}) {
  const params = await searchParams;
  const lang = normalizeLang(params.lang);
  const t = translations[lang];
  const details = await getConfirmationDetails(params.session_id, lang);
  const isConfirmed = details.confirmed;
  const orderId = details.orderId || params.orderId;
  const email = details.email || params.email;
  const title = isConfirmed ? t.confirmedTitle : t.pendingTitle;
  const body = isConfirmed ? t.confirmedBody : t.pendingBody;

  return (
    <main className="min-h-screen bg-background px-5 py-10 lg:px-12">
      <OrderConfirmationClient
        confirmed={isConfirmed}
        sessionId={params.session_id}
        orderId={orderId}
        total={details.total}
        itemCount={details.itemCount}
        itemSummary={details.itemSummary}
      />

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
          <div className={`flex h-24 w-24 items-center justify-center rounded-full text-white shadow-[0_16px_34px_rgba(0,0,0,0.12)] ${isConfirmed ? 'bg-brand-green' : 'bg-foreground/65'}`}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              {isConfirmed ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 8v5m0 3h.01M10.29 3.86l-7.4 12.82A2 2 0 0 0 4.62 20h14.76a2 2 0 0 0 1.73-3.02l-7.38-12.82a2 2 0 0 0-3.44 0Z" />}
            </svg>
          </div>

          <h1 className="text-display mt-8 text-[3rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[4.2rem]">
            {title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-muted-foreground">{body}</p>
          {!isConfirmed ? (
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              {t.pendingHelp}
            </p>
          ) : null}

          {orderId ? (
            <div className="mt-10 text-center">
              <p className="mono-metric text-[11px] text-muted-foreground">{t.orderNumber}</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground">{orderId}</p>
              {isConfirmed && details.amountPaid ? (
                <p className="mt-4 text-base text-muted-foreground">
                  {t.amountPaid}: {details.amountPaid}
                </p>
              ) : null}
              {email ? <p className="mt-2 text-base text-muted-foreground">{t.emailLabel}: {email}</p> : null}
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
