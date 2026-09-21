'use client';

import { useState } from 'react';
import { events } from '@/lib/analytics';

type StoryEmailCaptureProps = {
  slug: string;
  variant?: string | null;
  lang?: 'fr' | 'en';
  compact?: boolean;
};

const copy = {
  fr: {
    title: "Recevez la photo d'archive chaque matin",
    placeholder: 'votre@courriel.com',
    submit: "S'inscrire",
    submitting: 'Inscription...',
    consent: 'En vous inscrivant, vous acceptez de recevoir le jeu du jour et une photo surprise par courriel. Désabonnement en tout temps.',
    invalid: 'Entrez une adresse courriel valide.',
    success: 'Inscription confirmée. Vérifiez votre boîte de réception.',
    already: 'Vous êtes déjà inscrit.',
    resubscribed: 'Votre abonnement est réactivé.',
    error: "Impossible de terminer l'inscription pour le moment.",
  },
  en: {
    title: 'Get the archive photo every morning',
    placeholder: 'your@email.com',
    submit: 'Sign up',
    submitting: 'Signing up...',
    consent: 'By signing up, you agree to receive the daily game and a surprise photo by email. Unsubscribe anytime.',
    invalid: 'Enter a valid email address.',
    success: 'You are subscribed. Check your inbox.',
    already: 'You are already subscribed.',
    resubscribed: 'Your subscription is active again.',
    error: 'Unable to complete signup right now.',
  },
};

export function StoryEmailCapture({ slug, variant, lang = 'fr', compact = false }: StoryEmailCaptureProps) {
  const t = copy[lang];
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setState('error');
      setFeedback(t.invalid);
      return;
    }

    setState('submitting');
    setFeedback('');
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: trimmed,
          lang,
          source: 'story',
          company: trap,
        }),
      });
      const json = await response.json() as { success?: boolean; status?: string; error?: string };
      if (!response.ok || json.success === false) {
        throw new Error(json.error || t.error);
      }
      setState('success');
      setEmail('');
      if (json.status === 'already_subscribed') setFeedback(t.already);
      else if (json.status === 'resubscribed') setFeedback(t.resubscribed);
      else setFeedback(t.success);
      events.storyEmailSignup(slug, variant);
    } catch (error) {
      setState('error');
      setFeedback(error instanceof Error ? error.message : t.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className={compact ? 'space-y-3' : 'rounded-3xl border border-border bg-card px-5 py-5'}>
      <p className="font-serif text-2xl leading-tight text-foreground">{t.title}</p>
      <div className="sr-only" aria-hidden="true">
        <label htmlFor={`story-company-${slug}${compact ? '-repeat' : ''}`}>Company</label>
        <input
          id={`story-company-${slug}${compact ? '-repeat' : ''}`}
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(event) => setTrap(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor={`story-email-${slug}${compact ? '-repeat' : ''}`}>{t.placeholder}</label>
        <input
          id={`story-email-${slug}${compact ? '-repeat' : ''}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t.placeholder}
          disabled={state === 'submitting'}
          className="min-h-12 flex-1 rounded-full border border-border bg-background px-4 text-base text-foreground outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={state === 'submitting'}
          className="min-h-12 rounded-full bg-brand-blue px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {state === 'submitting' ? t.submitting : t.submit}
        </button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t.consent}</p>
      {feedback ? (
        <p className={state === 'error' ? 'text-sm text-brand-copper' : 'text-sm text-brand-blue'}>{feedback}</p>
      ) : null}
    </form>
  );
}
