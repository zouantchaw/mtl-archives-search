-- Migration number: 0005	2026-01-30
-- Game MVP: daily challenge + practice guesses

CREATE TABLE IF NOT EXISTS daily_challenge (
  date_key TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS daily_guess (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  anon_id TEXT NOT NULL,
  guessed_lat REAL NOT NULL,
  guessed_lng REAL NOT NULL,
  distance_meters REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS practice_guess (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  anon_id TEXT NOT NULL,
  guessed_lat REAL NOT NULL,
  guessed_lng REAL NOT NULL,
  distance_meters REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_guess_once ON daily_guess(date_key, anon_id);
CREATE INDEX IF NOT EXISTS idx_daily_guess_leaderboard ON daily_guess(date_key, score DESC, distance_meters ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_guess_once ON practice_guess(date_key, anon_id);
