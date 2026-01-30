-- Migration number: 0006	2026-01-30
-- Game auth: store user_id for signed-in streaks

ALTER TABLE daily_guess ADD COLUMN user_id TEXT;
ALTER TABLE practice_guess ADD COLUMN user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_guess_user_once ON daily_guess(date_key, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_guess_user_once ON practice_guess(date_key, user_id);
