'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { API_BASE } from '@/lib/runtime-config';
import { SignedIn, SignedOut, UserButton, useAuth } from '@clerk/nextjs';
import type { PhotoRecord } from '@/lib/types';
import { Share2, X, MapPin, Trophy, ChevronLeft, Maximize2, ShoppingBag, LogIn } from 'lucide-react';
import { appendLangParam, DEFAULT_LANG, getLangFromSearchParams } from '@/lib/i18n';
import { events } from '@/lib/analytics';
import { getAbVariant } from '@/lib/experiments';
import { Map, MapMarker, MapPolyline, MapTileLayer, MapZoomControl } from '@/components/ui/map';
import { useMap, useMapEvents } from 'react-leaflet';
import { normalizePhotoId } from '@/lib/photo-id';
import { FlagQC, FlagEN } from '@/components/ui/lang-flags';

type GameResult = {
  score: number;
  distanceMeters: number;
  guessedLat?: number;
  guessedLng?: number;
};

type GameDailyResponse = {
  date: string;
  daily: {
    photo: PhotoRecord;
    played: boolean;
    result: GameResult | null;
  };
  practice: {
    available: boolean;
    photo: PhotoRecord | null;
    result: GameResult | null;
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

const MONTREAL_CENTER: [number, number] = [45.5019, -73.5674];

const ANON_STORAGE_KEY = 'mtl-archives-game-anon';
let inMemoryAnonId: string | null = null;

const getAnonId = (): string => {
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
};

const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

// Generate accuracy blocks for shareable result (Wordle-style)
const generateAccuracyBlocks = (score: number): string => {
  const filled = Math.round((score / 1000) * 5);
  return '🟩'.repeat(filled) + '⬜'.repeat(5 - filled);
};

// Get score color based on performance
const getScoreColor = (score: number): string => {
  if (score >= 900) return 'text-emerald-500';
  if (score >= 700) return 'text-lime-500';
  if (score >= 500) return 'text-amber-500';
  if (score >= 300) return 'text-orange-500';
  return 'text-red-500';
};

const INTRO_SEEN_KEY = 'mtl-archives-game-intro-seen';

const translations = {
  fr: {
    title: 'Devine où la photo a été prise',
    subtitle: 'MTL Archives',
    daily: 'Défi du jour',
    practice: 'Essai',
    practiceAvailable: 'Essai',
    practiceUsed: 'Essai utilisé',
    tapToPlaceHint: 'Touche la carte pour placer ton repère. Zoome pour être précis.',
    tapToPlaceButton: 'Placer mon point',
    submitGuess: 'Valider mon point',
    loading: 'Chargement...',
    alreadyPlayed: 'Déjà joué',
    calculating: 'Calcul...',
    viewPhoto: 'Voir la photo',
    closePhoto: 'Fermer',
    result: 'Résultat',
    score: 'pts',
    points: 'points',
    distance: 'à {distance} du lieu réel',
    share: 'Partager',
    shareResult: 'Partager mon score',
    shareCopied: 'Copié!',
    shareFailed: 'Erreur',
    shareHint: 'Défie un ami — partage ton score',
    orderPrint: 'Commander un tirage · à partir de 45 $',
    saveStreak: 'Connecte-toi pour sauvegarder ta série',
    signInToSave: 'Sauvegarder ma série',
    streakSaved: 'Série sauvegardée!',
    playAgain: 'Essai gratuit',
    comeBackTomorrow: 'Reviens demain!',
    leaderboard: 'Classement',
    yourRank: 'Ton rang',
    signIn: 'Connexion',
    back: 'Retour',
    // Zoom prompt
    zoomHint: 'Zoome pour vérifier',
    viewMyScore: 'Voir mon score',
    // Intro
    introQuestion: 'Où cette photo a-t-elle été prise?',
    introSkip: 'Passer',
    clue: 'Indice',
    photoOnWall: 'Cette photo sur votre mur?',
    send: 'Envoyer',
  },
  en: {
    title: 'Guess where this photo was taken',
    subtitle: 'MTL Archives',
    daily: 'Daily',
    practice: 'Practice',
    practiceAvailable: 'Practice',
    practiceUsed: 'Practice used',
    tapToPlaceHint: 'Tap the map to place your pin. Zoom in to be precise.',
    tapToPlaceButton: 'Place my pin',
    submitGuess: 'Submit my guess',
    loading: 'Loading...',
    alreadyPlayed: 'Already played',
    calculating: 'Scoring...',
    viewPhoto: 'View photo',
    closePhoto: 'Close',
    result: 'Result',
    score: 'pts',
    points: 'points',
    distance: '{distance} from actual location',
    share: 'Share',
    shareResult: 'Share my score',
    shareCopied: 'Copied!',
    shareFailed: 'Error',
    shareHint: 'Challenge a friend — share your score',
    orderPrint: 'Order a Print · from $45',
    saveStreak: 'Sign in to save your streak',
    signInToSave: 'Save my streak',
    streakSaved: 'Streak saved!',
    playAgain: 'Free practice',
    comeBackTomorrow: 'Come back tomorrow!',
    leaderboard: 'Leaderboard',
    yourRank: 'Your rank',
    signIn: 'Sign in',
    back: 'Back',
    // Zoom prompt
    zoomHint: 'Zoom in to check',
    viewMyScore: 'View my score',
    // Intro
    introQuestion: 'Where was this photo taken?',
    introSkip: 'Skip',
    clue: 'Clue',
    photoOnWall: 'This photo on your wall?',
    send: 'Send',
  },
} as const;

function MapClickHandler({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (event) => {
      if (disabled) return;
      onSelect(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

function MapZoomTracker({ onZoom }: { onZoom: () => void }) {
  useMapEvents({
    zoomend: () => onZoom(),
  });
  return null;
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const handleResize = () => {
      map.invalidateSize();
    };

    const timer = window.setTimeout(handleResize, 0);
    window.addEventListener('resize', handleResize);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [map]);

  return null;
}

export function GameClient() {
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
  const sharePromptKeyRef = useRef<string | null>(null);
  const [photoExpanded, setPhotoExpanded] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [introAnimating, setIntroAnimating] = useState(false);
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const abVariantRef = useRef<string | null>(null);
  const landedRef = useRef(false);
  const pinPlacedRef = useRef(false);
  const prevModeRef = useRef<'daily' | 'practice'>('daily');
  const zoomedAfterPinRef = useRef(false);
  const [showZoomHint, setShowZoomHint] = useState(false);

  const currentPhoto = mode === 'daily' ? data?.daily.photo : data?.practice.photo;
  const currentPlayed = mode === 'daily' ? data?.daily.played : data?.practice.result !== null;
  const practiceAvailable = data?.practice.available ?? false;
  const mapKey = useMemo(
    () => `${mode}-${currentPhoto?.metadataFilename ?? 'loading'}`,
    [mode, currentPhoto?.metadataFilename]
  );
  const canPlacePin = !loading && !showResults && !currentPlayed;

  const resultBounds = useMemo(() => {
    if (!result || !guess || !currentPhoto?.latitude || !currentPhoto?.longitude) return null;
    return [
      [guess.lat, guess.lng],
      [currentPhoto.latitude, currentPhoto.longitude],
    ] as [[number, number], [number, number]];
  }, [result, guess, currentPhoto?.latitude, currentPhoto?.longitude]);

  const handleMapPick = useCallback((lat: number, lng: number) => {
    setGuess({ lat, lng });
    zoomedAfterPinRef.current = false;
    setShowZoomHint(true);
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  }, []);

  const handleMapZoom = useCallback(() => {
    if (guess && !zoomedAfterPinRef.current) {
      zoomedAfterPinRef.current = true;
      setShowZoomHint(false);
      if (currentPhoto) {
        events.photoZoomed(currentPhoto.metadataFilename, { dateValue: currentPhoto.dateValue });
      }
    }
  }, [guess, currentPhoto]);

  // Auto-dismiss zoom hint after 3s
  useEffect(() => {
    if (!showZoomHint) return;
    const timer = setTimeout(() => setShowZoomHint(false), 3000);
    return () => clearTimeout(timer);
  }, [showZoomHint]);

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
    setAnonId(getAnonId());
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      loadDaily(anonId);
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

  // Restore result from data — show pin + score for already-played games
  useEffect(() => {
    if (!data) return;
    const r = mode === 'daily' ? data.daily.result : data.practice.result;
    if (r) {
      setResult({ mode, played: true, score: r.score, distanceMeters: r.distanceMeters });
      if (r.guessedLat != null && r.guessedLng != null) {
        setGuess({ lat: r.guessedLat, lng: r.guessedLng });
      }
      setShowResults(true);
    }
  }, [data, mode]);

  // Intro animation on first load
  const introShownRef = useRef(false);
  const forceIntro = searchParams?.get('intro') === '1';
  
  useEffect(() => {
    // Only run once per session
    if (introShownRef.current) return;
    if (!currentPhoto || loading) return;
    
    // Check if user has seen intro today (skip check if forcing via URL)
    if (!forceIntro) {
      try {
        const seenDate = localStorage.getItem(INTRO_SEEN_KEY);
        const today = new Date().toDateString();
        if (seenDate === today) {
          introShownRef.current = true;
          return;
        }
      } catch {
        // Ignore storage errors
      }
    }
    
    // Mark as shown for this session
    introShownRef.current = true;
    
    // Small delay to ensure everything is rendered
    const startTimer = setTimeout(() => {
      setShowIntro(true);
      
      // After 2.5 seconds, start shrink animation
      setTimeout(() => {
        setIntroAnimating(true);
      }, 2500);
      
      // After animation completes, hide intro and mark as seen
      setTimeout(() => {
        setShowIntro(false);
        setIntroAnimating(false);
        try {
          localStorage.setItem(INTRO_SEEN_KEY, new Date().toDateString());
        } catch {
          // Ignore storage errors
        }
      }, 3200); // 2500ms view + 700ms animation
    }, 100);
    
    return () => {
      clearTimeout(startTimer);
    };
  }, [currentPhoto, loading, forceIntro]);

  // Analytics
  useEffect(() => {
    if (!isLoaded || landedRef.current) return;
    abVariantRef.current = getAbVariant();
    const hasPlayedBefore = Boolean(localStorage.getItem(ANON_STORAGE_KEY));
    events.gameLanded(abVariantRef.current ?? undefined, mode, { returnVisitor: hasPlayedBefore });
    prevModeRef.current = mode;
    landedRef.current = true;
  }, [isLoaded, mode]);

  useEffect(() => {
    if (prevModeRef.current !== mode) {
      events.gameModeChanged(prevModeRef.current, mode);
      prevModeRef.current = mode;
      pinPlacedRef.current = false;
    }
  }, [mode]);

  useEffect(() => {
    if (!guess || pinPlacedRef.current) return;
    events.gamePinPlaced(mode);
    pinPlacedRef.current = true;
  }, [guess, mode]);

  useEffect(() => {
    if (!showResults || !result) return;
    const key = `${data?.date ?? 'unknown'}:${mode}:${result.score}:${Math.round(result.distanceMeters)}`;
    if (sharePromptKeyRef.current === key) return;
    sharePromptKeyRef.current = key;
    events.gameSharePromptShown(mode, result.score);
  }, [showResults, result, mode, data?.date]);

  // Submit the guess to the API
  const submitGuessToAPI = useCallback(async (guessData: { lat: number; lng: number }, gameMode: 'daily' | 'practice') => {
    if (!currentPhoto) return;
    setSubmitting(true);
    setShareMessage('');
    try {
      const token = await getToken();
      if (!token && !anonId) {
        setSubmitting(false);
        return;
      }
      events.gameGuessSubmitted(gameMode, currentPhoto.metadataFilename, Boolean(isSignedIn));
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/game/guess`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: gameMode,
          photoId: currentPhoto.metadataFilename,
          lat: guessData.lat,
          lng: guessData.lng,
          ...(token ? {} : { anonId }),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(json);
        setShowResults(true);
        events.gameGuessResult(gameMode, json.score, json.distanceMeters, { photoYear: currentPhoto.dateValue });
        await loadDaily(anonId);
        if (gameMode === 'daily' && data?.date) {
          loadLeaderboard(data.date);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [currentPhoto, isSignedIn, getToken, loadDaily, anonId, data?.date, loadLeaderboard]);

  // Handle submit button click — always submit (anon or signed-in)
  const handleSubmitGuess = async () => {
    if (!guess || !currentPhoto) return;
    await submitGuessToAPI(guess, mode);
  };

  const handleShareScore = async () => {
    if (!result || !data?.date) return;
    const accuracy = generateAccuracyBlocks(result.score);
    const text = `MTL Archives 📍 ${data.date}\n${result.score}/1000 ${t.points}\n${accuracy}\n\n${formatDistance(result.distanceMeters)} ${lang === 'fr' ? 'du lieu réel' : 'from actual'}`;
    const shareUrl = new URL(`${window.location.origin}${appendLangParam('/game', lang)}`);
    shareUrl.searchParams.set('utm_source', 'game');
    shareUrl.searchParams.set('utm_medium', 'share');
    shareUrl.searchParams.set('utm_campaign', 'game_share');
    const url = shareUrl.toString();
    events.gameShareClicked(mode, result.score);
    
    if (navigator.share) {
      try {
        await navigator.share({ title: 'MTL Archives', text, url });
        events.gameShareCompleted('native', mode, result.score);
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      events.gameShareCompleted('copy', mode, result.score);
      setShareMessage(t.shareCopied);
      setTimeout(() => setShareMessage(''), 2000);
    } catch {
      setShareMessage(t.shareFailed);
    }
  };

  const handleModeChange = (newMode: 'daily' | 'practice') => {
    if (newMode === mode) return;
    if (newMode === 'practice' && !practiceAvailable) return;
    
    // Clean up previous result display
    setShowResults(false);
    setResult(null);
    setGuess(null);

    setMode(newMode);
  };

  const handleTogglePhoto = () => {
    setPhotoExpanded(!photoExpanded);
  };

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

  const homeLink = appendLangParam('/?from=game', lang);
  const signInRedirect = appendLangParam('/game', lang);
  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(signInRedirect)}`;
  const printBaseLink = currentPhoto ? appendLangParam(`/photo/${normalizePhotoId(currentPhoto.metadataFilename)}`, lang) : '';
  const printLink = printBaseLink
    ? `${printBaseLink}${printBaseLink.includes('?') ? '&' : '?'}order=1&utm_source=game&utm_medium=game_result`
    : '';
  const filledAccuracy = result ? Math.round((result.score / 1000) * 5) : 0;
  const currentPhotoTitle = currentPhoto?.name || (lang === 'fr' ? 'Photo historique' : 'Historical photo');
  const currentPhotoDate = currentPhoto?.dateValue || '?';
  const desktopSidePanelWidth = 'lg:pr-[360px]';

  // Determine CTA state
  const ctaDisabled = !guess || submitting || currentPlayed;
  const ctaLabel = currentPlayed 
    ? t.alreadyPlayed 
    : submitting 
      ? t.calculating 
      : guess 
        ? t.submitGuess 
        : t.tapToPlaceButton;

  return (
    <div 
      className="flex w-full flex-col overflow-hidden bg-brand-dark text-white"
      style={{ height: '100dvh', minHeight: '100vh' }}
    >
      {/* Minimal Header - 44px */}
      <header className="z-30 flex h-12 shrink-0 items-center justify-between border-b border-white/8 bg-brand-dark px-3 text-white lg:px-5">
        <a
          href={homeLink}
          onClick={() => { events.homeNavClicked(); events.gameReturnToArchive(currentPhoto?.metadataFilename); }}
          className="flex items-center gap-2 text-white/88 transition-colors hover:text-white"
          aria-label={t.back}
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden text-xs font-medium tracking-wide sm:inline">mtl archives</span>
        </a>

        <div className="flex items-center gap-2 lg:gap-4">
          {/* Score pill */}
          <div className="flex items-center gap-1.5 rounded-full bg-white/4 px-2.5 py-1 text-primary">
            <Trophy className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold tabular-nums text-primary">
              {result ? result.score : '--'} {t.score}
            </span>
          </div>

          <div className="hidden items-center gap-4 text-sm lg:flex">
            <button
              onClick={() => handleModeChange('daily')}
              className={mode === 'daily' ? 'text-white' : 'text-white/45 transition-colors hover:text-white/80'}
            >
              {t.daily}
            </button>
            <button
              onClick={() => handleModeChange('practice')}
              disabled={!practiceAvailable && mode !== 'practice'}
              className={
                mode === 'practice'
                  ? 'text-white'
                  : practiceAvailable
                    ? 'text-white/45 transition-colors hover:text-white/80'
                    : 'cursor-not-allowed text-white/25'
              }
            >
              {practiceAvailable ? t.practice : t.practiceUsed}
            </button>
          </div>

          {/* Language toggle */}
          <button
            onClick={handleLangChange}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/6 animate-lang-nudge"
            aria-label={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
          >
            {lang === 'fr' ? <FlagEN /> : <FlagQC />}
          </button>

          {/* Auth */}
          <SignedIn>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <a
              href={signInUrl}
              className="text-xs font-medium text-white/60 transition-colors hover:text-white"
            >
              {t.signIn}
            </a>
          </SignedOut>
        </div>
      </header>

      {/* Map Container - Takes all remaining space */}
      <div className={`relative min-h-0 flex-1 overflow-hidden ${desktopSidePanelWidth}`}>
        <div className="absolute inset-0">
          <Map
            key={mapKey}
            center={MONTREAL_CENTER}
            zoom={11}
            maxZoom={18}
            bounds={resultBounds ?? undefined}
            boundsOptions={{ padding: [80, 80], maxZoom: 14 }}
            className="game-map min-h-0 rounded-none z-0"
          >
            <MapTileLayer 
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
            />
            <MapZoomControl className="bottom-4 right-3" />
            <MapResizeHandler />
            <MapClickHandler disabled={!canPlacePin} onSelect={handleMapPick} />
            <MapZoomTracker onZoom={handleMapZoom} />
            {guess && (
              <MapMarker
                position={[guess.lat, guess.lng]}
                iconAnchor={[16, 32]}
                icon={
                  <div className="game-marker-guess w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg border-2 border-card">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                }
              />
            )}
            {result && guess && currentPhoto?.latitude && currentPhoto?.longitude && (
              <>
                <MapMarker
                  position={[currentPhoto.latitude, currentPhoto.longitude]}
                  iconAnchor={[16, 16]}
                  icon={
                    <div className="game-marker-actual w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg border-2 border-card animate-bounce-in">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                  }
                />
                <MapPolyline
                  positions={[
                    [guess.lat, guess.lng],
                    [currentPhoto.latitude, currentPhoto.longitude],
                  ]}
                  color="#ef4444"
                  weight={2}
                  dashArray="4 4"
                />
              </>
            )}
          </Map>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-brand-dark/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white" />
              <span className="text-sm text-white/70">{t.loading}</span>
            </div>
          </div>
        )}

        {/* Pin placement hint - shows when no pin placed */}
        {!guess && !currentPlayed && !loading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center pb-28 lg:pb-18">
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white shadow-lg">
                  <MapPin className="h-6 w-6 text-brand-charcoal" />
                </div>
              </div>
              <span className="max-w-[92%] rounded-2xl border border-white/10 bg-white/92 px-4 py-2 text-center text-xs font-medium leading-relaxed text-brand-charcoal shadow-md backdrop-blur sm:max-w-md sm:rounded-full sm:px-5 sm:py-2.5 sm:text-sm">
                {t.tapToPlaceHint}
              </span>
            </div>
          </div>
        )}

        {/* Floating Photo Thumbnail */}
        {currentPhoto && !photoExpanded && (
          <button
            onClick={handleTogglePhoto}
            className="group absolute top-3 left-3 z-20 lg:hidden"
            aria-label={t.viewPhoto}
          >
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-xl border-2 border-card bg-muted transition-transform group-hover:scale-105 group-active:scale-95">
              <Image
                src={currentPhoto.imageUrl}
                alt={currentPhoto.name || 'Historical photo'}
                fill
                sizes="96px"
                className="object-cover"
                priority
                unoptimized
              />
              {/* Date badge */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                <span className="text-[10px] font-medium text-white">
                  {currentPhoto.dateValue || '?'}
                </span>
              </div>
              {/* Expand icon */}
              <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="w-3 h-3 text-white" />
              </div>
            </div>
          </button>
        )}

        {/* Mode indicator pill */}
        <div className="absolute top-3 right-3 z-20 lg:hidden">
          <div className="px-3 py-1.5 bg-card/90 backdrop-blur rounded-full shadow-sm border border-input/60">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {mode === 'daily' ? t.daily : t.practice}
            </span>
          </div>
        </div>

        {!showResults ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 hidden justify-center lg:flex">
            <button
              onClick={handleSubmitGuess}
              disabled={ctaDisabled}
              className={
                guess && !currentPlayed
                  ? 'pointer-events-auto inline-flex h-[52px] min-w-[200px] items-center justify-center rounded-full bg-white px-8 text-base font-medium text-brand-charcoal shadow-xl transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:bg-white/40 disabled:text-white/55'
                  : 'pointer-events-auto inline-flex h-[52px] min-w-[200px] items-center justify-center rounded-full bg-white/88 px-8 text-base font-medium text-brand-charcoal transition-transform disabled:cursor-not-allowed disabled:bg-white/40 disabled:text-white/55'
              }
            >
              {ctaLabel}
            </button>
          </div>
        ) : null}

        <aside
          className={`absolute inset-y-0 right-0 hidden w-[360px] border-l lg:flex ${
            showResults
              ? 'border-border bg-background text-foreground'
              : 'border-white/8 bg-brand-dark text-white'
          }`}
        >
          <div className="flex h-full w-full flex-col px-6 py-6">
            {showResults && result ? (
              <>
                <div className="text-center">
                  <div className="text-display text-7xl font-semibold leading-none tracking-[-0.06em] text-primary">
                    {result.score}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t.points} · {formatDistance(result.distanceMeters)}
                  </p>
                </div>

                <div className="mt-6 flex justify-center gap-2">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`h-9 w-9 rounded-xl ${i < filledAccuracy ? 'bg-brand-green' : 'bg-brand-steel/55'}`}
                    />
                  ))}
                </div>

                <div className="mt-6 border-t border-border pt-6">
                  <h4 className="mono-metric text-[10px] text-muted-foreground">{t.leaderboard}</h4>
                  <div className="mt-4 space-y-3">
                    {leaderboard.slice(0, 3).map((entry) => (
                      <div key={`${entry.rank}-${entry.anonTag}`} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          #{entry.rank} · {entry.anonTag}
                        </span>
                        <span className={`font-medium tabular-nums ${entry.rank === 1 ? 'text-brand-green' : 'text-foreground'}`}>
                          {entry.score} {t.score}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {printLink && currentPhoto ? (
                  <a
                    href={printLink}
                    onClick={() => {
                      events.gamePrintCtaClicked(mode, currentPhoto.metadataFilename);
                      events.printCtaClicked(currentPhoto.metadataFilename);
                    }}
                    className="surface-subtle mt-8 flex items-center gap-3 p-3"
                  >
                    <div className="relative h-9 w-12 overflow-hidden rounded-xl bg-muted">
                      <Image src={currentPhoto.imageUrl} alt={currentPhotoTitle} fill sizes="48px" className="object-cover" unoptimized />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{t.photoOnWall}</p>
                      <p className="mt-1 text-xs text-muted-foreground">dès 45$</p>
                    </div>
                    <span className="text-sm font-medium text-primary">{t.orderPrint} →</span>
                  </a>
                ) : null}

                <div className="mt-auto flex items-center justify-center gap-5 pt-8 text-sm">
                  <button onClick={handleShareScore} className="text-primary transition-colors hover:text-primary/80">
                    {shareMessage || t.share}
                  </button>
                  {mode === 'daily' && practiceAvailable ? (
                    <button onClick={() => handleModeChange('practice')} className="text-primary transition-colors hover:text-primary/80">
                      {t.playAgain} →
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{t.comeBackTomorrow}</span>
                  )}
                </div>
              </>
            ) : (
              <>
                {currentPhoto ? (
                  <>
                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-white/8">
                      <Image
                        src={currentPhoto.imageUrl}
                        alt={currentPhotoTitle}
                        fill
                        sizes="320px"
                        className="object-cover"
                        priority
                        unoptimized
                      />
                    </div>
                    <div className="mt-5">
                      <p className="mono-metric text-[10px] text-white/40">{t.clue}</p>
                      <p className="mt-3 text-lg leading-8 text-white/90">
                        {currentPhotoDate}
                        {currentPhoto.name ? ` · ${currentPhoto.name}` : ''}
                      </p>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Action Bar - Thumb Zone */}
      <div className="z-30 shrink-0 border-t border-input/60 bg-card safe-area-pb lg:hidden">
        <div className="px-4 pt-3 pb-3 space-y-3">
          {/* Primary CTA */}
          {!showResults && currentPlayed && result ? (
            <button
              onClick={() => setShowResults(true)}
              className="w-full h-12 rounded-full bg-primary text-primary-foreground font-medium text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              aria-label={t.viewMyScore}
            >
              <Trophy className="w-4 h-4" />
              {t.viewMyScore} · {result.score} {t.score}
            </button>
          ) : !showResults ? (
            <button
              onClick={handleSubmitGuess}
              disabled={ctaDisabled}
              className={`
                w-full h-12 rounded-full font-medium text-xs sm:text-sm transition-all
                active:scale-[0.98] disabled:active:scale-100
                ${guess && !currentPlayed
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-muted text-muted-foreground/70'
                }
                ${submitting ? 'animate-pulse' : ''}
              `}
              aria-label={ctaLabel}
            >
              {ctaLabel}
            </button>
          ) : (
            <button
              onClick={handleShareScore}
              className="w-full h-12 rounded-full bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              aria-label={t.shareResult}
            >
              <Share2 className="w-4 h-4" />
              {shareMessage || t.shareResult}
            </button>
          )}

          {/* Zoom hint - nudge after pin placement */}
          {showZoomHint && guess && !showResults && !currentPlayed && (
            <div className="text-center text-xs text-muted-foreground/70 animate-pulse -mt-1">
              <Maximize2 className="w-3 h-3 inline mr-1" />
              {t.zoomHint}
            </div>
          )}

          {/* Mode tabs - secondary */}
          <div className="flex justify-center items-center gap-6">
            <button
              onClick={() => handleModeChange('daily')}
              className={`text-xs font-medium transition-colors flex items-center gap-1.5 ${
                mode === 'daily' ? 'text-foreground' : 'text-muted-foreground/70'
              }`}
              aria-pressed={mode === 'daily'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${mode === 'daily' ? 'bg-primary' : 'bg-transparent'}`} />
              {t.daily}
            </button>
            <button
              onClick={() => handleModeChange('practice')}
              disabled={!practiceAvailable && mode !== 'practice'}
              className={`text-xs font-medium transition-colors flex items-center gap-1.5 ${
                mode === 'practice' 
                  ? 'text-foreground' 
                  : practiceAvailable 
                    ? 'text-muted-foreground/70' 
                    : 'text-muted-foreground/50 cursor-not-allowed'
              }`}
              aria-pressed={mode === 'practice'}
              aria-disabled={!practiceAvailable && mode !== 'practice'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${mode === 'practice' ? 'bg-primary' : 'bg-transparent'}`} />
              {practiceAvailable ? t.practiceAvailable : t.practiceUsed}
            </button>
          </div>
        </div>
      </div>

      {/* Photo Expanded Modal */}
      {photoExpanded && currentPhoto && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-fade-in"
          onClick={handleTogglePhoto}
          role="dialog"
          aria-modal="true"
          aria-label={t.viewPhoto}
        >
          {/* Close button */}
          <button
            onClick={handleTogglePhoto}
            className="absolute top-4 right-4 z-10 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors"
            aria-label={t.closePhoto}
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {/* Photo */}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="relative w-full h-full max-w-2xl">
              <Image
                src={currentPhoto.imageUrl}
                alt={currentPhoto.name || 'Historical photo'}
                fill
                sizes="100vw"
                className="object-contain"
                priority
                unoptimized
              />
            </div>
          </div>

          {/* Photo info */}
          <div className="p-4 text-center text-white safe-area-pb">
            <h3 className="font-medium text-sm mb-1">{currentPhoto.name || 'Historical photo'}</h3>
            <p className="text-xs text-white/60">{currentPhoto.dateValue}</p>
          </div>
        </div>
      )}

      {/* Intro Animation - Shows photo then shrinks to thumbnail */}
      {showIntro && currentPhoto && (
        <div 
          className={`fixed inset-0 z-50 flex flex-col transition-all duration-700 ease-in-out ${
            introAnimating ? 'bg-transparent' : 'bg-black/90'
          }`}
        >
          {/* Photo container - animates from center to top-left */}
          <div 
            className={`
              absolute transition-all duration-700 ease-in-out
              ${introAnimating 
                ? 'top-[56px] left-3 w-20 h-20 sm:w-24 sm:h-24 rounded-xl' 
                : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85vw] max-w-md aspect-[4/3] rounded-2xl'
              }
            `}
          >
            <div className={`relative w-full h-full overflow-hidden rounded-inherit ${introAnimating ? 'rounded-xl shadow-xl border-2 border-white' : 'rounded-2xl shadow-2xl'}`}>
              <Image
                src={currentPhoto.imageUrl}
                alt={currentPhoto.name || 'Historical photo'}
                fill
                sizes={introAnimating ? '96px' : '85vw'}
                className="object-cover"
                priority
                unoptimized
              />
              {/* Date badge - always visible */}
              <div className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent transition-all duration-700 ${introAnimating ? 'p-1.5' : 'p-3'}`}>
                <span className={`font-medium text-white transition-all duration-700 ${introAnimating ? 'text-[10px]' : 'text-sm'}`}>
                  {currentPhoto.dateValue || '?'}
                </span>
              </div>
            </div>
          </div>

          {/* Caption - fades out during animation */}
          <div 
            className={`
              absolute bottom-0 inset-x-0 p-6 text-center transition-opacity duration-500
              ${introAnimating ? 'opacity-0' : 'opacity-100'}
            `}
          >
            <h3 className="text-white font-semibold text-lg mb-2">
              {currentPhoto.name || (lang === 'fr' ? 'Photo historique' : 'Historical photo')}
            </h3>
            <p className="text-white/70 text-sm mb-4">
              {currentPhoto.dateValue}
            </p>
            <p className="text-white/50 text-xs">
              {t.introQuestion}
            </p>
          </div>

          {/* Skip hint - tap anywhere */}
          <button 
            onClick={() => {
              setShowIntro(false);
              setIntroAnimating(false);
              try {
                localStorage.setItem(INTRO_SEEN_KEY, new Date().toDateString());
              } catch { /* ignore */ }
            }}
            className={`absolute top-4 right-4 text-white/50 text-xs transition-opacity duration-500 ${introAnimating ? 'opacity-0' : 'opacity-100'}`}
          >
            {t.introSkip} →
          </button>
        </div>
      )}

      {/* Results Overlay - Slides up from bottom */}
      {showResults && result && (
        <div 
          className="fixed inset-x-0 bottom-0 z-40 animate-slide-up lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t.result}
        >
          {/* Backdrop */}
          <div 
            className="absolute inset-0 -top-screen bg-black/20 backdrop-blur-sm"
            onClick={() => setShowResults(false)}
          />

          {/* Results card */}
          <div className="relative bg-card rounded-t-3xl shadow-2xl safe-area-pb">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-muted rounded-full" />
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Score display */}
              <div className="text-center">
                <div className={`text-5xl font-bold tabular-nums ${getScoreColor(result.score)}`}>
                  {result.score}
                </div>
                <div className="text-sm text-muted-foreground mt-1">{t.points}</div>
                <div className="text-sm text-muted-foreground mt-2">
                  {t.distance.replace('{distance}', formatDistance(result.distanceMeters))}
                </div>
              </div>

              {/* Accuracy visualization */}
              <div className="flex justify-center gap-1.5">
                {[...Array(5)].map((_, i) => {
                  const filled = Math.round((result.score / 1000) * 5);
                  return (
                    <div
                      key={i}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                        i < filled ? 'bg-emerald-500' : 'bg-muted'
                      }`}
                    >
                      {i < filled ? '🎯' : ''}
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="space-y-2">
                {!isSignedIn ? (
                  <>
                    <p className="text-xs text-center text-muted-foreground">{t.saveStreak}</p>
                    <a
                      href={signInUrl}
                      onClick={() => events.gameSignInCtaClicked()}
                      className="w-full h-11 rounded-full bg-primary text-primary-foreground font-medium text-xs flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
                    >
                      <LogIn className="w-4 h-4" />
                      {t.signInToSave}
                    </a>
                    <button
                      onClick={handleShareScore}
                      className="w-full h-10 rounded-full border border-input text-foreground/80 font-medium text-xs flex items-center justify-center gap-2 hover:bg-secondary transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      {shareMessage || t.shareResult}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleShareScore}
                      className="w-full h-12 rounded-full bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                    >
                      <Share2 className="w-4 h-4" />
                      {shareMessage || t.shareResult}
                    </button>
                    <p className="text-[11px] text-center text-muted-foreground">
                      {t.shareHint}
                    </p>
                    <div className="text-xs text-center text-emerald-600 font-medium py-2">
                      ✓ {t.streakSaved}
                    </div>
                  </>
                )}

                {printLink && (
                  <a
                    href={printLink}
                    onClick={() => {
                      if (currentPhoto) {
                        events.gamePrintCtaClicked(mode, currentPhoto.metadataFilename);
                        events.printCtaClicked(currentPhoto.metadataFilename);
                      }
                    }}
                    className="w-full h-11 rounded-full border border-input text-foreground/80 font-medium text-xs flex items-center justify-center gap-2 hover:bg-secondary transition-colors"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    {t.orderPrint}
                  </a>
                )}
              </div>

              {/* Next action hint */}
              <div className="text-center pt-2">
                {mode === 'daily' && practiceAvailable ? (
                  <button
                    onClick={() => handleModeChange('practice')}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t.playAgain} →
                  </button>
                ) : (
                  <span className="text-sm text-muted-foreground/70">{t.comeBackTomorrow}</span>
                )}
              </div>

              {/* Mini leaderboard peek */}
              {leaderboard.length > 0 && (
                <div className="border-t border-border pt-4 mt-4">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
                    {t.leaderboard}
                  </h4>
                  <div className="space-y-2">
                    {leaderboard.slice(0, 3).map((entry) => (
                      <div 
                        key={`${entry.rank}-${entry.anonTag}`} 
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          #{entry.rank} · {entry.anonTag}
                        </span>
                        <span className="font-medium tabular-nums">{entry.score} {t.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
