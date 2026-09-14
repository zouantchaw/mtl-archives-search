-- Operator job store. Does not alter photos/captions.
CREATE TABLE IF NOT EXISTS operator_job (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  adapter TEXT,
  plan_hash TEXT,
  approval TEXT,
  version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_idempotency (
  token TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_receipt (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_candidate (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_record_id TEXT,
  canonical_json TEXT NOT NULL,
  candidate_json TEXT,
  media_sha256 TEXT,
  tombstone INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS operator_index_pointer (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  previous TEXT,
  activated_at TEXT NOT NULL
);
