'use client';

import { FormEvent, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/lib/cart-context';
import { appendLangParam, getLangFromSearchParams } from '@/lib/i18n';
import { events } from '@/lib/analytics';

const translations = {
  fr: {
    title: 'Commande',
    explore: 'Explorer',
    dailyGame: 'Jeu quotidien',
    prints: 'Impressions',
    coordinates: 'Coordonnées',
    shipping: 'Livraison',
    email: 'Courriel',
    firstName: 'Prénom',
    lastName: 'Nom',
    address: 'Adresse',
    city: 'Ville',
    postalCode: 'Code postal',
    notes: 'Notes',
    notesPlaceholder: 'Instructions spéciales, étage, code, etc.',
    emptyTitle: 'Votre panier est vide',
    emptyBody: 'Ajoutez des impressions avant de passer la commande.',
    backToPrints: 'Explorer les impressions',
    summary: 'Résumé',
    shippingLine: 'Livraison',
    total: 'Total',
    submit: 'Envoyer la commande',
    submitting: 'Envoi en cours',
    fulfillment: 'Imprimé à Montréal · Livraison 5-7 jours',
    manualPayment: 'Aucun paiement maintenant. Nous confirmons taxes, livraison et paiement par courriel.',
    requiredError: 'Veuillez remplir les champs obligatoires.',
    genericError: 'Une erreur est survenue. Veuillez réessayer.',
  },
  en: {
    title: 'Order',
    explore: 'Explore',
    dailyGame: 'Daily game',
    prints: 'Prints',
    coordinates: 'Contact',
    shipping: 'Shipping',
    email: 'Email',
    firstName: 'First name',
    lastName: 'Last name',
    address: 'Address',
    city: 'City',
    postalCode: 'Postal code',
    notes: 'Notes',
    notesPlaceholder: 'Special instructions, floor, code, etc.',
    emptyTitle: 'Your cart is empty',
    emptyBody: 'Add prints before checking out.',
    backToPrints: 'Explore prints',
    summary: 'Summary',
    shippingLine: 'Shipping',
    total: 'Total',
    submit: 'Submit order',
    submitting: 'Submitting',
    fulfillment: 'Printed in Montreal · Ships in 5-7 days',
    manualPayment: 'No payment now. We confirm shipping, taxes, and payment by email.',
    requiredError: 'Please complete the required fields.',
    genericError: 'Something went wrong. Please try again.',
  },
} as const;

const SHIPPING_FEE = 15;

export function CheckoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];
  const { items, total, itemCount, clearItems } = useCart();

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const finalTotal = useMemo(() => total + SHIPPING_FEE, [total]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !firstName.trim() || !lastName.trim() || !address.trim() || !city.trim() || !postalCode.trim() || items.length === 0) {
      setError(t.requiredError);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
          customerEmail: email.trim(),
          customerAddress: `${address.trim()}, ${city.trim()}, ${postalCode.trim()}`,
          customerNotes: notes.trim() || undefined,
          items: items.map((item) => ({
            photoId: item.photoId,
            photoName: item.photoName,
            photoUrl: item.photoUrl,
            size: item.size,
            frame: item.frame,
            price: item.price,
            quantity: item.quantity,
          })),
          subtotal: finalTotal,
          lang,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || t.genericError);
      }

      events.checkoutCompleted(data.orderId, finalTotal, itemCount, items.map((item) => `${item.size}/${item.frame}`).join(', '));
      clearItems();
      const next = new URLSearchParams();
      next.set('orderId', data.orderId);
      next.set('email', email.trim());
      if (lang !== 'fr') next.set('lang', lang);
      router.replace(`/order-confirmation?${next.toString()}`);
    } catch (submitError) {
      events.checkoutFailed(submitError instanceof Error ? submitError.message : 'checkout_error');
      setError(submitError instanceof Error ? submitError.message : t.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-6xl items-center px-5 lg:px-12">
            <Link href={appendLangParam('/', lang)} className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span>{t.backToPrints}</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto flex min-h-[calc(100vh-57px)] max-w-6xl items-center justify-center px-5 py-12 lg:px-12">
          <div className="surface-card max-w-lg px-8 py-10 text-center">
            <h1 className="text-display text-4xl font-semibold tracking-[-0.02em] text-foreground">{t.emptyTitle}</h1>
            <p className="mt-3 text-sm text-muted-foreground">{t.emptyBody}</p>
            <Button asChild className="mt-8 w-full sm:w-auto">
              <Link href={appendLangParam('/print', lang)}>{t.backToPrints}</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-5 lg:px-12">
          <Link href={appendLangParam('/', lang)} className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">mtl archives</span>
          </Link>
          <div className="hidden lg:flex lg:items-center lg:gap-10">
            <Link href={appendLangParam('/', lang)} className="text-[16px] font-semibold text-foreground no-underline">
              mtl archives
            </Link>
            <nav className="flex items-center gap-8 text-[14px]">
              <Link href={appendLangParam('/search', lang)} className="text-foreground/60 transition-colors hover:text-foreground">
                {t.explore}
              </Link>
              <Link href={appendLangParam('/game', lang)} className="text-primary transition-colors hover:text-primary/80">
                {t.dailyGame}
              </Link>
              <Link href={appendLangParam('/print', lang)} className="text-foreground/60 transition-colors hover:text-foreground">
                {t.prints}
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-12 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <section className="max-w-2xl">
            <h1 className="text-display text-[2.5rem] font-semibold leading-none tracking-[-0.03em] text-foreground">{t.title}</h1>

            <form id="checkout-form" onSubmit={handleSubmit} className="mt-8 space-y-8">
              <div className="space-y-4">
                <Label>{t.coordinates}</Label>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="sr-only">{t.email}</span>
                    <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="marie@example.com" required />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Label>{t.shipping}</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <span className="sr-only">{t.firstName}</span>
                    <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={t.firstName} required />
                  </div>
                  <div className="space-y-2">
                    <span className="sr-only">{t.lastName}</span>
                    <Input value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={t.lastName} required />
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="sr-only">{t.address}</span>
                  <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t.address} required />
                </div>

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="space-y-2">
                    <span className="sr-only">{t.city}</span>
                    <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder={t.city} required />
                  </div>
                  <div className="space-y-2">
                    <span className="sr-only">{t.postalCode}</span>
                    <Input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} placeholder={t.postalCode} required />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Label>{t.notes}</Label>
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t.notesPlaceholder} rows={4} />
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <div className="space-y-3 lg:hidden">
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{submitting ? `${t.submitting}...` : `${t.submit} · ${finalTotal} $`}</span>
                </Button>
                <p className="text-center text-xs text-muted-foreground">{t.manualPayment}</p>
              </div>
            </form>
          </section>

          <aside className="surface-card h-fit p-6 lg:sticky lg:top-8">
            <h2 className="text-xl font-semibold text-foreground">{t.summary}</h2>
            <div className="mt-5 space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-3 border-b border-border pb-4">
                  <div className="relative h-11 w-15 overflow-hidden rounded-xl bg-muted">
                    <Image src={item.photoUrl} alt={item.photoName} fill className="object-cover" sizes="60px" unoptimized />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-foreground">{item.photoName}</p>
                    <p className="text-xs text-muted-foreground">{item.size}</p>
                  </div>
                  <p className="text-sm font-medium text-foreground">{item.price * item.quantity} $</p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t.shippingLine}</span>
                <span>{SHIPPING_FEE} $</span>
              </div>
              <div className="flex items-center justify-between text-xl font-semibold text-foreground">
                <span>{t.total}</span>
                <span>{finalTotal} $</span>
              </div>
            </div>

            <div className="mt-6 hidden space-y-3 lg:block">
              <Button
                type="submit"
                form="checkout-form"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>{submitting ? `${t.submitting}...` : `${t.submit} · ${finalTotal} $`}</span>
              </Button>
              <p className="text-xs text-muted-foreground">{t.fulfillment}</p>
              <p className="text-xs text-muted-foreground">{t.manualPayment}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
