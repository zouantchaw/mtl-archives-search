PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS research_entity (
  id TEXT PRIMARY KEY CHECK(length(id)=64),
  kind TEXT NOT NULL,
  logical_key TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_entity_lookup ON research_entity(kind,logical_key);
CREATE TABLE IF NOT EXISTS research_event (
  id TEXT PRIMARY KEY CHECK(length(id)=64),
  run_id TEXT NOT NULL REFERENCES research_entity(id),
  phase TEXT NOT NULL CHECK(phase IN ('started','succeeded','failed')),
  payload_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS research_event_start ON research_event(run_id) WHERE phase='started';
CREATE UNIQUE INDEX IF NOT EXISTS research_event_terminal ON research_event(run_id) WHERE phase IN ('succeeded','failed');
CREATE TABLE IF NOT EXISTS research_publication (
  id TEXT PRIMARY KEY CHECK(length(id)=64),
  manifest_json TEXT NOT NULL,
  entity_count INTEGER NOT NULL,
  event_count INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS research_entity_update BEFORE UPDATE ON research_entity BEGIN SELECT RAISE(ABORT,'immutable research entity'); END;
CREATE TRIGGER IF NOT EXISTS research_entity_delete BEFORE DELETE ON research_entity BEGIN SELECT RAISE(ABORT,'immutable research entity'); END;
CREATE TRIGGER IF NOT EXISTS research_event_update BEFORE UPDATE ON research_event BEGIN SELECT RAISE(ABORT,'immutable research event'); END;
CREATE TRIGGER IF NOT EXISTS research_event_delete BEFORE DELETE ON research_event BEGIN SELECT RAISE(ABORT,'immutable research event'); END;
CREATE TRIGGER IF NOT EXISTS research_publication_update BEFORE UPDATE ON research_publication BEGIN SELECT RAISE(ABORT,'immutable publication'); END;
CREATE TRIGGER IF NOT EXISTS research_publication_delete BEFORE DELETE ON research_publication BEGIN SELECT RAISE(ABORT,'immutable publication'); END;
