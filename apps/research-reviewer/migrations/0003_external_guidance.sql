-- Owner-recorded external guidance, separate from original human review payloads.
CREATE TABLE external_guidance (
 id TEXT PRIMARY KEY,
 snapshot_id TEXT NOT NULL,
 actor TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX external_guidance_actor ON external_guidance(snapshot_id,actor);
CREATE TRIGGER external_guidance_no_update BEFORE UPDATE ON external_guidance
 BEGIN SELECT RAISE(ABORT,'external guidance is immutable'); END;
CREATE TRIGGER external_guidance_no_delete BEFORE DELETE ON external_guidance
 BEGIN SELECT RAISE(ABORT,'external guidance is immutable'); END;
