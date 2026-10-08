-- Dedicated mtl-archives-mail database; no customer addresses, message bodies or tokens.
CREATE TABLE IF NOT EXISTS mail_delivery (
  logical_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('prepared','sending','rejected','accepted','review_required')),
  payload_sha256 TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER,
  message_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS mail_delivery_state ON mail_delivery(state, updated_at);
