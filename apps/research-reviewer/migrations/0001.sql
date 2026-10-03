CREATE TABLE review_revision (
 snapshot_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('image','families','query')),
 entity_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), request_hash TEXT NOT NULL,
 save_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(snapshot_id,actor,kind,entity_key,revision), UNIQUE(snapshot_id,actor,save_id)
);
CREATE TRIGGER no_review_update BEFORE UPDATE ON review_revision BEGIN SELECT RAISE(ABORT,'review history is immutable'); END;
CREATE TRIGGER no_review_delete BEFORE DELETE ON review_revision BEGIN SELECT RAISE(ABORT,'review history is immutable'); END;
CREATE VIEW latest_review AS SELECT r.* FROM review_revision r WHERE NOT EXISTS(
 SELECT 1 FROM review_revision n WHERE n.snapshot_id=r.snapshot_id AND n.actor=r.actor AND n.kind=r.kind AND n.entity_key=r.entity_key AND n.revision>r.revision
);
