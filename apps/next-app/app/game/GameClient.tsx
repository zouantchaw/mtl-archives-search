'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE } from '@/lib/runtime-config';
import { SignedIn, SignedOut, UserButton, useAuth } from '@clerk/nextjs';
import type { PhotoRecord } from '@/lib/types';
import { Share2 } from 'lucide-react';

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

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function getAnonId(): string {
  if (typeof window === 'undefined') return '';
  const key = 'mtl-archives-game-anon';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(key, id);
  }
  return id;
}

type Lang = 'fr' | 'en';

const translations = {
  fr: {
    title: 'Devine où la photo a été prise',
    subtitle: 'Montréal Machine à Remonter le Temps',
    daily: 'Défi du jour',
    practice: 'Essai',
    fullPhoto: 'Voir la photo complète',
    loading: 'Chargement...',
    validate: 'Valider mon point',
    alreadyPlayed: 'Déjà joué',
    calculating: 'Calcul...',
    tapHint: 'Clique sur la carte pour placer ton point.',
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
    fullPhoto: 'View full photo',
    loading: 'Loading...',
    validate: 'Submit guess',
    alreadyPlayed: 'Already played',
    calculating: 'Scoring...',
    tapHint: 'Tap the map to place your pin.',
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

  const searchParams = useSearchParams();
  const lang = (searchParams.get('lang') as Lang) || 'fr';
  const t = translations[lang];

  const [anonId, setAnonId] = useState('');
  const [data, setData] = useState<GameDailyResponse | null>(null);
  const [mode, setMode] = useState<'daily' | 'practice'>('daily');
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<GuessResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const { getToken } = useAuth();

  const currentPhoto = mode === 'daily' ? data?.daily.photo : data?.practice.photo;
  const currentPlayed = mode === 'daily' ? data?.daily.played : data?.practice.result !== null;

  const loadDaily = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/game/daily?anonId=${encodeURIComponent(id)}`, {
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
    const id = getAnonId();
    setAnonId(id);
  }, []);

  useEffect(() => {
    if (!anonId) return;
    loadDaily(anonId);
  }, [anonId, loadDaily]);

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
    if (!guess || !currentPhoto || !anonId) return;
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
          anonId,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(json);
        await loadDaily(anonId);
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
    const url = `${window.location.origin}/game`;
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
    return [
      { id: 'daily' as const, label: t.daily, disabled: false },
      { id: 'practice' as const, label: t.practice, disabled: !data?.practice.available },
    ];
  }, [data?.practice.available, t]);

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">{t.subtitle}</p>
            <h1 className="text-2xl sm:text-3xl font-semibold">{t.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <SignedIn>
              <UserButton />
            </SignedIn>
            <SignedOut>
              <a
                href={`/sign-in?redirect_url=/game${lang !== 'fr' ? `&lang=${lang}` : ''}`}
                className="px-3 py-2 rounded-full border border-neutral-200 text-sm"
              >
                {t.signIn}
              </a>
            </SignedOut>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            {modeTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setMode(tab.id);
                  setGuess(null);
                }}
                disabled={tab.disabled}
                className={`px-4 py-2 rounded-full text-sm border transition ${
                  mode === tab.id
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
                } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
            <div className="relative w-full aspect-[4/3] bg-neutral-100">
              {currentPhoto?.imageUrl ? (
                <Image
                  src={currentPhoto.imageUrl}
                  alt={currentPhoto.name || 'Photo historique'}
                  fill
                  sizes="(max-width: 1024px) 100vw, 60vw"
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
              <p className="text-sm text-neutral-500">{data?.date ? `${t.daily} · ${data.date}` : t.daily}</p>
              <h2 className="text-lg font-semibold">{currentPhoto?.name || 'Photo historique'}</h2>
              <p className="text-sm text-neutral-500">{currentPhoto?.dateValue || ''}</p>
              <a
                href={currentPhoto ? `/photo/${encodeURIComponent(currentPhoto.metadataFilename)}` : '#'}
                className="text-sm text-neutral-900 underline underline-offset-4"
              >
                {t.fullPhoto}
              </a>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
            <div ref={mapContainerRef} className="h-[360px] sm:h-[420px] w-full" />
            <div className="p-4 flex flex-col gap-3">
              <button
                onClick={submitGuess}
                disabled={!guess || submitting || currentPlayed}
                className="px-4 py-3 rounded-full bg-neutral-900 text-white text-sm disabled:opacity-40"
              >
                {currentPlayed ? t.alreadyPlayed : submitting ? t.calculating : t.validate}
              </button>
              {!guess && <p className="text-xs text-neutral-500">{t.tapHint}</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
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
                      className="flex items-center gap-2 px-3 py-2 rounded-full border border-neutral-200 text-sm"
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

          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
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
        </section>
      </main>
    </div>
  );
}
