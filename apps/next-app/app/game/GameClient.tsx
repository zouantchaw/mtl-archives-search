'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE } from '@/lib/runtime-config';
import { SignedIn, SignedOut, UserButton, useAuth } from '@clerk/nextjs';
import type { PhotoRecord } from '@/lib/types';
import { Share2 } from 'lucide-react';
import { appendLangParam, DEFAULT_LANG, getLangFromSearchParams, type Lang } from '@/lib/i18n';

type GameDailyResponse = {
  date: string;
  daily: {
    photo: PhotoRecord;
    played: boolean;
    result: { score: number; distanceMeters: number } | null;
  };
  practice: {
    available: boolean;
    photo: PhotoRecord | null;
    result: { score: number; distanceMeters: number } | null;
  };
};

type GuessResult = {
  mode: 'daily' | 'practice';
  played: boolean;
  score: number;
  distanceMeters: number;
};

type LeaderboardEntry = {
  rank: number;
  anonTag: string;
  score: number;
  distanceMeters: number;
};

const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const MONTREAL_CENTER: [number, number] = [-73.5674, 45.5019];

function LangToggle({ lang }: { lang: Lang }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[36px] px-2.5 py-1 rounded-full border border-neutral-200 bg-white/80 text-[10px] font-semibold tracking-[0.2em] text-neutral-500">
      {lang === 'fr' ? 'FR' : 'EN'}
    </span>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const ANON_STORAGE_KEY = 'mtl-archives-game-anon';
let inMemoryAnonId: string | null = null;

function getAnonId(): string {
  if (typeof window === 'undefined') return '';
  if (inMemoryAnonId) return inMemoryAnonId;

  let id: string | null = null;
  try {
    id = window.localStorage.getItem(ANON_STORAGE_KEY);
  } catch {
    // ignore storage access failures
  }
  if (!id) {
    try {
      id = window.sessionStorage.getItem(ANON_STORAGE_KEY);
    } catch {
      // ignore storage access failures
    }
  }
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  try {
    window.localStorage.setItem(ANON_STORAGE_KEY, id);
  } catch {
    // ignore storage access failures
  }
  try {
    window.sessionStorage.setItem(ANON_STORAGE_KEY, id);
  } catch {
    // ignore storage access failures
  }
  inMemoryAnonId = id;
  return id;
}

const translations = {
  fr: {
    title: 'Devine où la photo a été prise',
    subtitle: 'Montréal Machine à Remonter le Temps',
    daily: 'Défi du jour',
    practice: 'Essai',
    practiceAvailable: 'Essai (1/1)',
    practiceUsed: 'Essai (0/1)',
    ctaSubtitle: 'Un défi par jour. Un essai libre.',
    fullPhoto: 'Voir la photo complète',
    loading: 'Chargement...',
    validate: 'Valider mon point',
    alreadyPlayed: 'Déjà joué',
    calculating: 'Calcul...',
    tapHint: 'Clique sur la carte pour placer ton point.',
    mapHint: 'Place ton repère sur la carte.',
    pinHint: 'Glisse et zoome pour être précis.',
    result: 'Résultat',
    score: 'pts',
    distance: 'À {distance} du lieu réel.',
    share: 'Partager',
    shareCopied: 'Lien copié',
    shareFailed: 'Impossible de copier',
    saveStreak: 'Connecte-toi pour sauvegarder ta série.',
    streakSaved: 'Série sauvegardée sur ton compte.',
    leaderboard: 'Classement du jour',
    leaderboardEmpty: 'Aucun score pour l\'instant.',
    signIn: 'Se connecter',
  },
  en: {
    title: 'Guess where the photo was taken',
    subtitle: 'Montreal Time Machine',
    daily: 'Daily Challenge',
    practice: 'Practice',
    practiceAvailable: 'Practice (1/1)',
    practiceUsed: 'Practice (0/1)',
    ctaSubtitle: 'One daily challenge. One practice round.',
    fullPhoto: 'View full photo',
    loading: 'Loading...',
    validate: 'Submit guess',
    alreadyPlayed: 'Already played',
    calculating: 'Scoring...',
    tapHint: 'Tap the map to place your pin.',
    mapHint: 'Drop your pin on the map.',
    pinHint: 'Drag and zoom to be precise.',
    result: 'Result',
    score: 'pts',
    distance: '{distance} from the real location.',
    share: 'Share',
    shareCopied: 'Link copied',
    shareFailed: 'Could not copy',
    saveStreak: 'Sign in to save your streak.',
    streakSaved: 'Streak saved to your account.',
    leaderboard: 'Today\'s leaderboard',
    leaderboardEmpty: 'No scores yet.',
    signIn: 'Sign in',
  },
} as const;

export function GameClient() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = getLangFromSearchParams(searchParams);
  const t = translations[lang];

  const [anonId, setAnonId] = useState<string | null>(null);
  const [data, setData] = useState<GameDailyResponse | null>(null);
  const [mode, setMode] = useState<'daily' | 'practice'>('daily');
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<GuessResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const currentPhoto = mode === 'daily' ? data?.daily.photo : data?.practice.photo;
  const currentPlayed = mode === 'daily' ? data?.daily.played : data?.practice.result !== null;

  const loadDaily = useCallback(async (id?: string | null) => {
    setLoading(true);
    try {
      const token = await getToken();
      const url = new URL(`${API_BASE}/api/game/daily`, window.location.origin);
      if (id) url.searchParams.set('anonId', id);
      const res = await fetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = await res.json();
      if (res.ok) {
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  const loadLeaderboard = useCallback(async (date?: string) => {
    if (!date) return;
    const res = await fetch(`${API_BASE}/api/game/leaderboard?date=${encodeURIComponent(date)}`);
    const json = await res.json();
    if (res.ok) {
      setLeaderboard(json.leaderboard || []);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      setAnonId(null);
      return;
    }
    setAnonId(getAnonId());
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      loadDaily(null);
      return;
    }
    if (anonId) {
      loadDaily(anonId);
    }
  }, [anonId, isLoaded, isSignedIn, loadDaily]);

  useEffect(() => {
    if (data?.date) {
      loadLeaderboard(data.date);
    }
  }, [data?.date, loadLeaderboard]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: MONTREAL_CENTER,
      zoom: 11,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (e) => {
      setGuess({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !guess) return;
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#0f172a' })
        .setLngLat([guess.lng, guess.lat])
        .addTo(mapRef.current);
    } else {
      markerRef.current.setLngLat([guess.lng, guess.lat]);
    }
  }, [guess]);

  useEffect(() => {
    if (!data) return;
    if (mode === 'daily' && data.daily.result) {
      setResult({ mode: 'daily', played: true, ...data.daily.result });
      return;
    }
    if (mode === 'practice' && data.practice.result) {
      setResult({ mode: 'practice', played: true, ...data.practice.result });
      return;
    }
    setResult(null);
  }, [data, mode]);

  const submitGuess = async () => {
    if (!guess || !currentPhoto) return;
    if (!isSignedIn && !anonId) return;
    setSubmitting(true);
    setShareMessage('');
    try {
      const token = await getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/game/guess`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode,
          photoId: currentPhoto.metadataFilename,
          lat: guess.lat,
          lng: guess.lng,
          ...(isSignedIn ? {} : { anonId }),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(json);
        await loadDaily(isSignedIn ? null : anonId);
        if (mode === 'daily' && data?.date) {
          loadLeaderboard(data.date);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const shareScore = async () => {
    if (!result || !data?.date) return;
    const text = `MTL Archives — ${data.date} : ${result.score} pts (${formatDistance(result.distanceMeters)})`;
    const url = `${window.location.origin}${appendLangParam('/game', lang)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'MTL Archives', text, url });
        return;
      } catch {
        // ignore
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShareMessage(t.shareCopied);
      setTimeout(() => setShareMessage(''), 2000);
    } catch {
      setShareMessage(t.shareFailed);
    }
  };

  const modeTabs = useMemo(() => {
    const practiceAvailable = data?.practice.available;
    return [
      { id: 'daily' as const, label: t.daily, disabled: false },
      {
        id: 'practice' as const,
        label: practiceAvailable == null ? t.practice : practiceAvailable ? t.practiceAvailable : t.practiceUsed,
        disabled: !practiceAvailable,
      },
    ];
  }, [data?.practice.available, t]);

  const actionLabel = currentPlayed ? t.alreadyPlayed : submitting ? t.calculating : t.validate;
  const photoLink = currentPhoto
    ? appendLangParam(`/photo/${encodeURIComponent(currentPhoto.metadataFilename)}`, lang)
    : '#';
  const signInRedirect = appendLangParam('/game', lang);
  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(signInRedirect)}`;
  const showMapHint = !guess && !currentPlayed;
  const scoreLabel = result ? `${result.score} ${t.score}` : `-- ${t.score}`;
  const distanceLabel = result ? t.distance.replace('{distance}', formatDistance(result.distanceMeters)) : '';
  const showShare = Boolean(result && mode === 'daily');
  const showResultMeta = Boolean(result);
  const showStreakHint = Boolean(result);
  const handleLangChange = useCallback(() => {
    const nextLang = lang === 'fr' ? 'en' : 'fr';
    const params = new URLSearchParams(searchParams?.toString());
    if (nextLang === DEFAULT_LANG) {
      params.delete('lang');
    } else {
      params.set('lang', nextLang);
    }
    const query = params.toString();
    router.push(query ? `/game?${query}` : '/game');
  }, [lang, router, searchParams]);

  return (
    <div className="min-h-screen bg-[#f6f5f2] text-neutral-900">
      <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-[#f6f5f2]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 pt-4 pb-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <a href="/" className="text-[11px] font-medium tracking-[0.18em] uppercase">MTL Archives</a>
            <div className="flex items-center gap-2">
              {showShare && (
                <button
                  onClick={shareScore}
                  className="p-2 rounded-full border border-neutral-200 bg-white/80 text-neutral-600 hover:text-neutral-900 transition"
                  aria-label={t.share}
                >
                  <Share2 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={handleLangChange}
                className="p-1.5"
                aria-label={lang === 'fr' ? 'Changer en anglais' : 'Switch to French'}
              >
                <LangToggle lang={lang} />
              </button>
              <SignedIn>
                <UserButton />
              </SignedIn>
              <SignedOut>
                <a
                  href={signInUrl}
                  className="px-3 py-2 rounded-full border border-neutral-300 text-xs bg-white/80 hover:bg-white transition"
                >
                  {t.signIn}
                </a>
              </SignedOut>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[11px] uppercase tracking-[0.34em] text-neutral-400">{t.subtitle}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl sm:text-3xl font-semibold">{t.title}</h1>
              <div className="flex items-center gap-2">
                <div className="px-3 py-1 rounded-full border border-neutral-200 bg-white/80 text-[10px] uppercase tracking-[0.3em] text-neutral-500">
                  {mode === 'daily' ? t.daily : t.practice}
                </div>
                <div className="px-3 py-1 rounded-full bg-neutral-900 text-white text-sm font-semibold">
                  {scoreLabel}
                </div>
              </div>
            </div>
            <p className="text-xs text-neutral-500">{t.ctaSubtitle}</p>
            {showResultMeta && (
              <p className="text-xs text-neutral-500">{distanceLabel}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modeTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setMode(tab.id);
                  setGuess(null);
                }}
                disabled={tab.disabled}
                className={`px-4 py-2 rounded-full text-xs border transition ${
                  mode === tab.id
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
                } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-24 pt-6 lg:pt-10">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-4">
            <div className="rounded-3xl border border-neutral-200 bg-white/90 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.35)] overflow-hidden">
              <div className="relative w-full min-h-[220px] aspect-[16/10] sm:aspect-[4/3] bg-neutral-100">
                {currentPhoto?.imageUrl ? (
                  <Image
                    src={currentPhoto.imageUrl}
                    alt={currentPhoto.name || 'Photo historique'}
                    fill
                    sizes="(max-width: 1024px) 100vw, 56vw"
                    className="object-contain"
                    priority
                  />
                ) : null}
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
                    {t.loading}
                  </div>
                )}
              </div>
              <div className="p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">
                  {data?.date ? `${t.daily} · ${data.date}` : t.daily}
                </p>
                <h2 className="text-lg font-semibold">{currentPhoto?.name || 'Photo historique'}</h2>
                <p className="text-sm text-neutral-500">{currentPhoto?.dateValue || ''}</p>
                <a
                  href={photoLink}
                  className="text-sm text-neutral-900 underline underline-offset-4"
                >
                  {t.fullPhoto}
                </a>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-3xl border border-neutral-200 bg-white/90 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.35)] overflow-hidden">
              <div className="relative game-map">
                <div ref={mapContainerRef} className="h-[260px] sm:h-[360px] lg:h-[520px] w-full" />
                {showMapHint && (
                  <div className="absolute left-4 bottom-4 right-4 rounded-2xl bg-white/90 backdrop-blur px-4 py-3 text-xs text-neutral-600 shadow-lg">
                    <div className="font-medium text-neutral-800">{t.mapHint}</div>
                    <div className="text-neutral-500">{t.pinHint}</div>
                  </div>
                )}
              </div>
              <div className="p-4 hidden lg:flex flex-col gap-3">
                <button
                  onClick={submitGuess}
                  disabled={!guess || submitting || currentPlayed}
                  className="px-4 py-3 rounded-full bg-neutral-900 text-white text-sm disabled:opacity-40"
                >
                  {actionLabel}
                </button>
                {!guess && <p className="text-xs text-neutral-500">{t.tapHint}</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-neutral-200 bg-white/90 p-4 space-y-3 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.35)] hidden lg:block">
              <h3 className="text-sm uppercase tracking-[0.2em] text-neutral-400">{t.result}</h3>
              {result ? (
                <>
                  <p className="text-3xl font-semibold">{result.score} {t.score}</p>
                  <p className="text-sm text-neutral-600">
                    {t.distance.replace('{distance}', formatDistance(result.distanceMeters))}
                  </p>
                  {mode === 'daily' && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={shareScore}
                        className="flex items-center gap-2 px-3 py-2 rounded-full border border-neutral-200 text-sm bg-white"
                      >
                        <Share2 className="h-4 w-4" />
                        {t.share}
                      </button>
                      {shareMessage && <span className="text-xs text-neutral-500">{shareMessage}</span>}
                    </div>
                  )}
                  <SignedOut>
                    <div className="text-xs text-neutral-500">
                      {t.saveStreak}
                    </div>
                  </SignedOut>
                  <SignedIn>
                    <div className="text-xs text-emerald-600">
                      {t.streakSaved}
                    </div>
                  </SignedIn>
                </>
              ) : (
                <p className="text-sm text-neutral-500">{t.tapHint}</p>
              )}
            </div>

            {showStreakHint && (
              <div className="lg:hidden rounded-2xl border border-neutral-200 bg-white/90 px-4 py-3 text-xs text-neutral-500">
                <SignedOut>{t.saveStreak}</SignedOut>
                <SignedIn>{t.streakSaved}</SignedIn>
              </div>
            )}

            <div className="rounded-3xl border border-neutral-200 bg-white/90 p-4 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.35)] hidden lg:block">
              <h3 className="text-sm uppercase tracking-[0.2em] text-neutral-400 mb-3">{t.leaderboard}</h3>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-neutral-500">{t.leaderboardEmpty}</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry) => (
                    <div key={`${entry.rank}-${entry.anonTag}`} className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">#{entry.rank} · {entry.anonTag}</span>
                      <span className="font-medium">{entry.score} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <details className="lg:hidden rounded-2xl border border-neutral-200 bg-white/90 px-4 py-3">
              <summary className="text-xs uppercase tracking-[0.2em] text-neutral-400 cursor-pointer">
                {t.leaderboard}
              </summary>
              <div className="mt-3">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-neutral-500">{t.leaderboardEmpty}</p>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry) => (
                      <div key={`${entry.rank}-${entry.anonTag}`} className="flex items-center justify-between text-sm">
                        <span className="text-neutral-500">#{entry.rank} · {entry.anonTag}</span>
                        <span className="font-medium">{entry.score} pts</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </section>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <button
            onClick={submitGuess}
            disabled={!guess || submitting || currentPlayed}
            className="w-full px-4 py-3 rounded-full bg-neutral-900 text-white text-sm disabled:opacity-40"
          >
            {actionLabel}
          </button>
        </div>
      </div>

    </div>
  );
}
