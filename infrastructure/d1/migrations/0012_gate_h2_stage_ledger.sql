-- Gate H2 coordinator-owned append-only ledger. Stage executors must not receive
-- the D1 credential. All mutations made by the coordinator contract are INSERTs.
CREATE TABLE gate_h2_stage_attempts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  candidate_commit TEXT NOT NULL,
  authority_hash TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  UNIQUE (candidate_commit, authority_hash, stage_id, attempt_id)
) STRICT;

CREATE TABLE gate_h2_stage_claims (
  candidate_commit TEXT NOT NULL,
  authority_hash TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  began_at TEXT NOT NULL,
  begin_envelope TEXT NOT NULL,
  begin_sha256 TEXT NOT NULL,
  PRIMARY KEY (candidate_commit, authority_hash, stage_id),
  UNIQUE (candidate_commit, authority_hash, stage_id, attempt_id),
  FOREIGN KEY (candidate_commit, authority_hash, stage_id, attempt_id)
    REFERENCES gate_h2_stage_attempts(candidate_commit, authority_hash, stage_id, attempt_id)
) STRICT;

CREATE TABLE gate_h2_stage_completions (
  candidate_commit TEXT NOT NULL,
  authority_hash TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  completion_envelope TEXT NOT NULL,
  completion_sha256 TEXT NOT NULL,
  PRIMARY KEY (candidate_commit, authority_hash, stage_id),
  UNIQUE (candidate_commit, authority_hash, stage_id, attempt_id),
  FOREIGN KEY (candidate_commit, authority_hash, stage_id, attempt_id)
    REFERENCES gate_h2_stage_claims(candidate_commit, authority_hash, stage_id, attempt_id)
) STRICT;

CREATE TRIGGER gate_h2_stage_attempts_no_update BEFORE UPDATE ON gate_h2_stage_attempts BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
CREATE TRIGGER gate_h2_stage_attempts_no_delete BEFORE DELETE ON gate_h2_stage_attempts BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
CREATE TRIGGER gate_h2_stage_claims_no_update BEFORE UPDATE ON gate_h2_stage_claims BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
CREATE TRIGGER gate_h2_stage_claims_no_delete BEFORE DELETE ON gate_h2_stage_claims BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
CREATE TRIGGER gate_h2_stage_completions_no_update BEFORE UPDATE ON gate_h2_stage_completions BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
CREATE TRIGGER gate_h2_stage_completions_no_delete BEFORE DELETE ON gate_h2_stage_completions BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
