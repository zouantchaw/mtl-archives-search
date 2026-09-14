CREATE TABLE IF NOT EXISTS gpu_job (
  id TEXT PRIMARY KEY,
  spec_json TEXT NOT NULL,
  state TEXT NOT NULL,
  instance_id TEXT,
  checkpoint_sha TEXT,
  artifacts_json TEXT,
  metrics_json TEXT,
  spend_usd REAL NOT NULL DEFAULT 0,
  owner_authorized INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
