'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/lib/cart-context';
import { CHECKOUT_DRAFT_STORAGE_KEY } from '@/lib/checkout';
import { appendLangParam, getLangFromSearchParams } from '@/lib/i18n';
import { events } from '@/lib/analytics';
import {
  calculateShippingQuote,
  formatShippingAmount,
  getShippingSubdivisions,
  SHIPPING_COUNTRY_OPTIONS,
  type SupportedShippingCountry,
  validateShippingAddress,
} from '@/lib/shipping';

const selectClassName =
  'input-shell h-11 w-full min-w-0 appearance-none bg-background px-4 py-3 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/60';

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
    addressLine2: 'Appartement, suite, etc. (optionnel)',
    city: 'Ville',
    province: 'Province',
    state: 'Etat',
    country: 'Pays',
    postalCode: 'Code postal',
    notes: 'Notes',
    notesPlaceholder: 'Instructions spéciales, étage, code, etc.',
    emptyTitle: 'Votre panier est vide',
    emptyBody: 'Ajoutez des impressions avant de passer la commande.',
    backToPrints: 'Explorer les impressions',
    summary: 'Résumé',
    shippingLine: 'Livraison',
    total: 'Total',
    submit: 'Payer de façon sécurisée',
    submitting: 'Redirection',
    fulfillment: 'Imprime a Montreal · Le delai estime s’ajuste selon la destination',
    paymentNotice: 'Paiement sécurisé par Stripe. Les frais de livraison sont calcules a partir de l’adresse ci-dessus avant la redirection.',
    requiredError: 'Veuillez remplir les champs obligatoires.',
    invalidAddressError: 'Veuillez entrer une adresse de livraison valide au Canada ou aux Etats-Unis.',
    genericError: 'Une erreur est survenue. Veuillez réessayer.',
    canceled: 'Le paiement a été annulé. Votre panier et vos informations sont toujours enregistrés.',
    shippingPending: 'Entrez une adresse canadienne ou americaine valide pour calculer la livraison.',
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
    addressLine2: 'Apartment, suite, etc. (optional)',
    city: 'City',
    province: 'Province',
    state: 'State',
    country: 'Country',
    postalCode: 'Postal code',
    notes: 'Notes',
    notesPlaceholder: 'Special instructions, floor, code, etc.',
    emptyTitle: 'Your cart is empty',
    emptyBody: 'Add prints before checking out.',
    backToPrints: 'Explore prints',
    summary: 'Summary',
    shippingLine: 'Shipping',
    total: 'Total',
    submit: 'Pay securely',
    submitting: 'Redirecting',
    fulfillment: 'Printed in Montreal · Delivery estimate adjusts by destination',
    paymentNotice: 'Secure payment powered by Stripe. Shipping is quoted from the address above before you are redirected to Stripe.',
    requiredError: 'Please complete the required fields.',
    invalidAddressError: 'Please enter a valid Canadian or US shipping address.',
    genericError: 'Something went wrong. Please try again.',
    canceled: 'Checkout was canceled. Your cart and details are still saved.',
    shippingPending: 'Enter a valid Canadian or US address to calculate shipping.',
  },
} as const;

type CheckoutDraft = {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  country: SupportedShippingCountry;
  postalCode: string;
  notes: string;
};

export function CheckoutClient() {
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];
  const canceled = searchParams?.get('canceled') === '1';
  const { items, total } = useCart();

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address, setAddress] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState<SupportedShippingCountry>('CA');
  const [postalCode, setPostalCode] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  const selectedCountry = useMemo(
    () => SHIPPING_COUNTRY_OPTIONS.find((option) => option.code === country)?.code,
    [country]
  );
  const subdivisions = useMemo(
    () => (selectedCountry ? getShippingSubdivisions(selectedCountry) : []),
    [selectedCountry]
  );
  const regionLabel = country === 'US' ? t.state : t.province;
  const shippingValidation = useMemo(
    () =>
      validateShippingAddress({
        line1: address,
        line2: addressLine2,
        city,
        state,
        postalCode,
        country,
      }),
    [address, addressLine2, city, country, postalCode, state]
  );
  const shippingQuote = useMemo(() => {
    if (!shippingValidation.normalized || items.length === 0) return null;

    try {
      return calculateShippingQuote(shippingValidation.normalized, items, lang);
    } catch {
      return null;
    }
  }, [items, lang, shippingValidation.normalized]);
  const shippingDisplay = shippingQuote ? formatShippingAmount(shippingQuote.amount, lang) : t.shippingPending;
  const finalTotal = useMemo(() => total + (shippingQuote?.amount ?? 0), [shippingQuote?.amount, total]);
  const finalTotalLabel = shippingQuote ? formatShippingAmount(finalTotal, lang) : null;

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);
      if (!stored) return;
      const draft = JSON.parse(stored) as Partial<CheckoutDraft>;
      setEmail(draft.email ?? '');
      setFirstName(draft.firstName ?? '');
      setLastName(draft.lastName ?? '');
      setAddress(draft.address ?? '');
      setAddressLine2(draft.addressLine2 ?? '');
      setCity(draft.city ?? '');
      setState(draft.state ?? '');
      setCountry(draft.country ?? 'CA');
      setPostalCode(draft.postalCode ?? '');
      setNotes(draft.notes ?? '');
    } catch {
      // Ignore draft restore errors.
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;

    const draft: CheckoutDraft = {
      email,
      firstName,
      lastName,
      address,
      addressLine2,
      city,
      state,
      country,
      postalCode,
      notes,
    };

    try {
      window.sessionStorage.setItem(CHECKOUT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Ignore draft persistence errors.
    }
  }, [address, addressLine2, city, country, draftReady, email, firstName, lastName, notes, postalCode, state]);

  useEffect(() => {
    if (!selectedCountry || !state) return;
    if (!subdivisions.some((subdivision) => subdivision.code === state)) {
      setState('');
    }
  }, [selectedCountry, state, subdivisions]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !email.trim() ||
      !firstName.trim() ||
      !lastName.trim() ||
      !address.trim() ||
      !city.trim() ||
      !state.trim() ||
      !postalCode.trim() ||
      !country.trim() ||
      items.length === 0
    ) {
      setError(t.requiredError);
      return;
    }

    if (!shippingValidation.normalized || !shippingQuote) {
      setError(t.invalidAddressError);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: email.trim(),
          customerFirstName: firstName.trim(),
          customerLastName: lastName.trim(),
          customerAddressLine1: address.trim(),
          customerAddressLine2: addressLine2.trim() || undefined,
          customerCity: city.trim(),
          customerState: state.trim(),
          customerPostalCode: shippingValidation.normalized.postalCode,
          customerCountry: country,
          customerNotes: notes.trim() || undefined,
          items: items.map((item) => ({
            photoId: item.photoId,
            photoName: item.photoName,
            photoUrl: item.photoUrl,
            size: item.size,
            sizeId: item.sizeId,
            frame: item.frame,
            frameId: item.frameId,
            price: item.price,
            quantity: item.quantity,
          })),
          lang,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || t.genericError);
      }

      if (!data.url) {
        throw new Error(t.genericError);
      }

      window.location.assign(data.url);
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
              {canceled ? (
                <p className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  {t.canceled}
                </p>
              ) : null}

              <div className="space-y-4">
                <Label>{t.coordinates}</Label>
                <div className="space-y-4">
                <div className="space-y-2">
                  <span className="sr-only">{t.email}</span>
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="marie@example.com"
                      required
                    />
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

                <div className="space-y-2">
                  <span className="sr-only">{t.addressLine2}</span>
                  <Input
                    value={addressLine2}
                    onChange={(event) => setAddressLine2(event.target.value)}
                    placeholder={t.addressLine2}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="space-y-2">
                    <span className="sr-only">{t.country}</span>
                    <select
                      className={selectClassName}
                      value={country}
                      onChange={(event) => setCountry(event.target.value as SupportedShippingCountry)}
                      required
                    >
                      {SHIPPING_COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label[lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <span className="sr-only">{t.city}</span>
                    <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder={t.city} required />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="space-y-2">
                    <span className="sr-only">{regionLabel}</span>
                    <select
                      className={selectClassName}
                      value={state}
                      onChange={(event) => setState(event.target.value)}
                      required
                    >
                      <option value="">{regionLabel}</option>
                      {subdivisions.map((subdivision) => (
                        <option key={subdivision.code} value={subdivision.code}>
                          {subdivision.name}
                        </option>
                      ))}
                    </select>
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
                  <span>{submitting ? `${t.submitting}...` : finalTotalLabel ? `${t.submit} · ${finalTotalLabel}` : t.submit}</span>
                </Button>
                <p className="text-center text-xs text-muted-foreground">{t.paymentNotice}</p>
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
                  <p className="text-sm font-medium text-foreground">{formatShippingAmount(item.price * item.quantity, lang)}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t.shippingLine}</span>
                <span className="max-w-[200px] text-right">{shippingDisplay}</span>
              </div>
              <div className="flex items-center justify-between text-xl font-semibold text-foreground">
                <span>{t.total}</span>
                <span>{finalTotalLabel ?? formatShippingAmount(total, lang)}</span>
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
                <span>{submitting ? `${t.submitting}...` : finalTotalLabel ? `${t.submit} · ${finalTotalLabel}` : t.submit}</span>
              </Button>
              <p className="text-xs text-muted-foreground">{t.fulfillment}</p>
              <p className="text-xs text-muted-foreground">{t.paymentNotice}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
