-- Additive reviewer help; original review_revision rows and triggers stay intact.
CREATE TABLE assistance_run (
 id TEXT PRIMARY KEY,
 snapshot_id TEXT NOT NULL,
 actor TEXT NOT NULL,
 image_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('inspect','text','explain')),
 request_hash TEXT NOT NULL,
 spec_json TEXT NOT NULL,
 model TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 started_at TEXT,
 finished_at TEXT,
 input_key TEXT,
 input_sha256 TEXT,
 output_key TEXT,
 output_sha256 TEXT,
 answer TEXT,
 error TEXT,
 metrics_json TEXT
);
CREATE INDEX assistance_actor_image ON assistance_run(snapshot_id,actor,image_id,created_at);
CREATE INDEX assistance_replay ON assistance_run(snapshot_id,actor,request_hash,status);
CREATE TRIGGER assistance_identity_immutable BEFORE UPDATE ON assistance_run
 WHEN NEW.id!=OLD.id OR NEW.snapshot_id!=OLD.snapshot_id OR NEW.actor!=OLD.actor
 OR NEW.image_id!=OLD.image_id OR NEW.kind!=OLD.kind OR NEW.request_hash!=OLD.request_hash
 OR NEW.spec_json!=OLD.spec_json OR NEW.model!=OLD.model OR NEW.prompt_version!=OLD.prompt_version
 OR NEW.created_at!=OLD.created_at
 BEGIN SELECT RAISE(ABORT,'assistance identity is immutable'); END;
CREATE TRIGGER assistance_no_delete BEFORE DELETE ON assistance_run
 BEGIN SELECT RAISE(ABORT,'assistance history is immutable'); END;
CREATE TABLE assistance_event (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES assistance_run(id),
 snapshot_id TEXT NOT NULL,
 actor TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('output_delivered','accepted_note','dismissed')),
 reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);
CREATE INDEX assistance_events_actor ON assistance_event(snapshot_id,actor,run_id,created_at);
CREATE TRIGGER assistance_event_no_update BEFORE UPDATE ON assistance_event
 BEGIN SELECT RAISE(ABORT,'assistance events are immutable'); END;
CREATE TRIGGER assistance_event_no_delete BEFORE DELETE ON assistance_event
 BEGIN SELECT RAISE(ABORT,'assistance events are immutable'); END;
