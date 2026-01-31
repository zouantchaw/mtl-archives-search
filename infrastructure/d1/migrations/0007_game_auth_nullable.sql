-- Migration number: 0007	2026-01-31
-- Allow authenticated guesses without anon_id while keeping a safety check

CREATE TABLE IF NOT EXISTS daily_guess_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  anon_id TEXT,
  user_id TEXT,
  guessed_lat REAL NOT NULL,
  guessed_lng REAL NOT NULL,
  distance_meters REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (anon_id IS NOT NULL OR user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS practice_guess_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  anon_id TEXT,
  user_id TEXT,
  guessed_lat REAL NOT NULL,
  guessed_lng REAL NOT NULL,
  distance_meters REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (anon_id IS NOT NULL OR user_id IS NOT NULL)
);

INSERT INTO daily_guess_new (
  id, date_key, photo_id, anon_id, user_id, guessed_lat, guessed_lng, distance_meters, score, created_at
)
SELECT
  id, date_key, photo_id, anon_id, user_id, guessed_lat, guessed_lng, distance_meters, score, created_at
FROM daily_guess;

INSERT INTO practice_guess_new (
  id, date_key, photo_id, anon_id, user_id, guessed_lat, guessed_lng, distance_meters, score, created_at
)
SELECT
  id, date_key, photo_id, anon_id, user_id, guessed_lat, guessed_lng, distance_meters, score, created_at
FROM practice_guess;

DROP TABLE daily_guess;
ALTER TABLE daily_guess_new RENAME TO daily_guess;

DROP TABLE practice_guess;
ALTER TABLE practice_guess_new RENAME TO practice_guess;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_guess_once ON daily_guess(date_key, anon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_guess_user_once ON daily_guess(date_key, user_id);
CREATE INDEX IF NOT EXISTS idx_daily_guess_leaderboard ON daily_guess(date_key, score DESC, distance_meters ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_guess_once ON practice_guess(date_key, anon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_guess_user_once ON practice_guess(date_key, user_id);
