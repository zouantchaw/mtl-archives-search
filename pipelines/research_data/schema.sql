-- This schema belongs ONLY to mtl-archives-research-catalog. Never apply to app D1.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS artifact (
 sha256 TEXT PRIMARY KEY CHECK(length(sha256)=64), bucket TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
 media_type TEXT NOT NULL, verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_snapshot (
 id TEXT PRIMARY KEY REFERENCES artifact(sha256), captured_at TEXT NOT NULL,
 record_count INTEGER NOT NULL, production_metadata_sha256 TEXT NOT NULL,
 conditions_sha256 TEXT NOT NULL REFERENCES artifact(sha256)
);
CREATE TABLE IF NOT EXISTS source_record (
 id TEXT PRIMARY KEY, identity_strategy TEXT NOT NULL, source_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS record_version (
 id TEXT PRIMARY KEY REFERENCES artifact(sha256), record_id TEXT NOT NULL REFERENCES source_record(id),
 snapshot_id TEXT NOT NULL REFERENCES source_snapshot(id), aliases_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset (
 id TEXT PRIMARY KEY, record_version_id TEXT NOT NULL REFERENCES record_version(id),
 artifact_sha256 TEXT NOT NULL REFERENCES artifact(sha256), role TEXT NOT NULL,
 parent_asset_id TEXT REFERENCES asset(id), processing_run_id TEXT,
 lineage_status TEXT NOT NULL, details_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assertion (
 id TEXT PRIMARY KEY, record_version_id TEXT NOT NULL REFERENCES record_version(id),
 origin TEXT NOT NULL CHECK(origin IN ('source_payload','legacy_serving','legacy_derived')),
 review_status TEXT NOT NULL, input_identity_status TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS duplicate_group (
 id TEXT PRIMARY KEY, byte_sha256 TEXT NOT NULL, members_json TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(evidence='sha256_equal_verified_bytes')
);
CREATE TABLE IF NOT EXISTS processing_run (
 id TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, code_sha256 TEXT NOT NULL,
 config_json TEXT NOT NULL, environment_json TEXT NOT NULL, report_sha256 TEXT NOT NULL REFERENCES artifact(sha256)
);
CREATE TABLE IF NOT EXISTS fetch_attempt (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, record_id TEXT NOT NULL, role TEXT NOT NULL,
 requested_at TEXT NOT NULL, outcome TEXT NOT NULL, details_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_release (
 id TEXT PRIMARY KEY REFERENCES artifact(sha256), snapshot_id TEXT NOT NULL REFERENCES source_snapshot(id),
 processing_run_id TEXT NOT NULL REFERENCES processing_run(id), record_count INTEGER NOT NULL,
 exclusion_count INTEGER NOT NULL, verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS release_record (
 release_id TEXT NOT NULL REFERENCES dataset_release(id), record_version_id TEXT NOT NULL REFERENCES record_version(id),
 PRIMARY KEY(release_id,record_version_id)
);
CREATE TRIGGER IF NOT EXISTS release_count_guard BEFORE INSERT ON release_record
WHEN (SELECT count(*) FROM release_record WHERE release_id=NEW.release_id) >=
     (SELECT record_count FROM dataset_release WHERE id=NEW.release_id)
AND NOT EXISTS(SELECT 1 FROM release_record WHERE release_id=NEW.release_id AND record_version_id=NEW.record_version_id)
BEGIN SELECT RAISE(ABORT,'release membership exceeds declared count'); END;
-- Content rows are append-only. SQL migrations may add entities, never rewrite versions.
