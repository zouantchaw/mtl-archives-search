-- Track newsletter dispatch runs so cron/admin triggers stay idempotent and non-overlapping.

CREATE TABLE IF NOT EXISTS newsletter_run (
  job_name TEXT NOT NULL,
  date_key TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  total_active INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (job_name, date_key)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_run_status_started
  ON newsletter_run(status, started_at DESC);
