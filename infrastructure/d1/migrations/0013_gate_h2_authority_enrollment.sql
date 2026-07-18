-- Gate H2 post-begin authority root. Deployment authority may append an exact
-- enrolled document; stage callers receive no mutation path or D1 credential.
CREATE TABLE gate_h2_authority_enrollments (
  enrollment_id TEXT PRIMARY KEY,
  enrollment_sha256 TEXT NOT NULL UNIQUE,
  enrollment_bytes INTEGER NOT NULL,
  enrollment_document TEXT NOT NULL,
  source_descriptor_sha256 TEXT NOT NULL,
  candidate_commit TEXT NOT NULL,
  stage_launch_authority_sha256 TEXT NOT NULL,
  authority_document_sha256 TEXT NOT NULL,
  d1_namespace_digest TEXT NOT NULL,
  production_status TEXT NOT NULL CHECK (production_status = 'inactive'),
  enrolled_at TEXT NOT NULL,
  -- Every digest is lowercase hexadecimal. A length-only check accepts labels
  -- that cannot be compared with the source-pinned SHA-256 values.
  CHECK (length(enrollment_sha256) = 64 AND enrollment_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(source_descriptor_sha256) = 64 AND source_descriptor_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(stage_launch_authority_sha256) = 64 AND stage_launch_authority_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(authority_document_sha256) = 64 AND authority_document_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(d1_namespace_digest) = 64 AND d1_namespace_digest NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(candidate_commit) = 40 AND candidate_commit NOT GLOB '*[^0-9a-f]*'),
  -- Enrollment text is canonical ASCII JSON followed by exactly one LF. The
  -- byte count is intentionally measured as BLOB bytes, not TEXT characters.
  CHECK (enrollment_bytes = length(CAST(enrollment_document AS BLOB))),
  CHECK (length(enrollment_document) = length(CAST(enrollment_document AS BLOB))),
  CHECK (substr(enrollment_document, -1) = char(10)),
  CHECK (json_valid(substr(enrollment_document, 1, length(enrollment_document) - 1))),
  CHECK (enrollment_document = json(substr(enrollment_document, 1, length(enrollment_document) - 1)) || char(10)),
  -- The stored timestamp is the canonical RFC3339 UTC millisecond form.
  CHECK (enrolled_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', enrolled_at) = enrolled_at),
  CHECK (enrollment_bytes > 0)
) STRICT;

-- SQLite's json() removes insignificant whitespace but preserves object member
-- order and number spellings. v1 therefore freezes the current enrollment
-- document grammar: every object has its exact JCS member order, and every
-- file-pin byte count is rendered as a canonical decimal integer, and no JSON
-- string uses a backslash escape. The tracked v1 fixture contains no character
-- that requires an escape. A future schema requiring escaped characters needs
-- a new migration/trigger grammar; it must not append arbitrary fields to this
-- frozen v1 document.
CREATE TRIGGER gate_h2_authority_enrollments_canonical_document_v1
BEFORE INSERT ON gate_h2_authority_enrollments
WHEN json_valid(NEW.enrollment_document)
 AND (
   instr(NEW.enrollment_document, char(92)) > 0
   OR
   json_type(NEW.enrollment_document) <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document) ORDER BY id)), '') <> 'authority_document,candidate_commit,canonicalization_version,coordinator_endpoint,d1,enrollment_id,native_capability_contract,production_status,relay_executable,replay_journal,report_channel,schema_version,stage_launch_authority,synthetic,verifier'
   OR COALESCE(json_type(NEW.enrollment_document, '$.authority_document'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.authority_document') ORDER BY id)), '') <> 'bytes,path,sha256'
   OR COALESCE(json_type(NEW.enrollment_document, '$.coordinator_endpoint'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.coordinator_endpoint') ORDER BY id)), '') <> 'capability_id,capability_lineage_sha256,endpoint_identity_sha256,native_descriptor_sha256,principal,transfer_mode'
   OR COALESCE(json_type(NEW.enrollment_document, '$.d1'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.d1') ORDER BY id)), '') <> 'account_id_sha256,api_contract,coordinator_capability_lineage_sha256,database_id_sha256,endpoint_url_sha256,enrollment_table_schema,migration,namespace_digest'
   OR COALESCE(json_type(NEW.enrollment_document, '$.d1.enrollment_table_schema'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.d1.enrollment_table_schema') ORDER BY id)), '') <> 'bytes,sha256'
   OR COALESCE(json_type(NEW.enrollment_document, '$.d1.migration'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.d1.migration') ORDER BY id)), '') <> 'bytes,path,sha256'
   OR COALESCE(json_type(NEW.enrollment_document, '$.relay_executable'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.relay_executable') ORDER BY id)), '') <> 'bytes,path,sha256'
   OR COALESCE(json_type(NEW.enrollment_document, '$.replay_journal'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.replay_journal') ORDER BY id)), '') <> 'capability_lineage_sha256,exclusive_owner_id,journal_state_sha256,namespace,native_descriptor_sha256,object_id,retention_mode'
   OR COALESCE(json_type(NEW.enrollment_document, '$.report_channel'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.report_channel') ORDER BY id)), '') <> 'capability_lineage_sha256,channel_id,completion_expectations_sha256,native_descriptor_sha256,transfer_mode'
   OR COALESCE(json_type(NEW.enrollment_document, '$.stage_launch_authority'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.stage_launch_authority') ORDER BY id)), '') <> 'candidate_commit,sha256'
   OR COALESCE(json_type(NEW.enrollment_document, '$.verifier'), '') <> 'object'
   OR COALESCE((SELECT group_concat(key, ',') FROM (SELECT key FROM json_each(NEW.enrollment_document, '$.verifier') ORDER BY id)), '') <> 'algorithm,key_id,principal,spki_der_base64,spki_der_sha256'
   OR json_extract(NEW.enrollment_document, '$.authority_document') <> json_object('bytes', CAST(printf('%d', json_extract(NEW.enrollment_document, '$.authority_document.bytes')) AS INTEGER), 'path', json_extract(NEW.enrollment_document, '$.authority_document.path'), 'sha256', json_extract(NEW.enrollment_document, '$.authority_document.sha256'))
   OR json_extract(NEW.enrollment_document, '$.d1.enrollment_table_schema') <> json_object('bytes', CAST(printf('%d', json_extract(NEW.enrollment_document, '$.d1.enrollment_table_schema.bytes')) AS INTEGER), 'sha256', json_extract(NEW.enrollment_document, '$.d1.enrollment_table_schema.sha256'))
   OR json_extract(NEW.enrollment_document, '$.d1.migration') <> json_object('bytes', CAST(printf('%d', json_extract(NEW.enrollment_document, '$.d1.migration.bytes')) AS INTEGER), 'path', json_extract(NEW.enrollment_document, '$.d1.migration.path'), 'sha256', json_extract(NEW.enrollment_document, '$.d1.migration.sha256'))
   OR json_extract(NEW.enrollment_document, '$.relay_executable') <> json_object('bytes', CAST(printf('%d', json_extract(NEW.enrollment_document, '$.relay_executable.bytes')) AS INTEGER), 'path', json_extract(NEW.enrollment_document, '$.relay_executable.path'), 'sha256', json_extract(NEW.enrollment_document, '$.relay_executable.sha256'))
 )
BEGIN SELECT RAISE(ABORT, 'gate_h2_enrollment_document_not_canonical_v1'); END;

CREATE TRIGGER gate_h2_authority_enrollments_no_update
BEFORE UPDATE ON gate_h2_authority_enrollments
BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;

CREATE TRIGGER gate_h2_authority_enrollments_no_delete
BEFORE DELETE ON gate_h2_authority_enrollments
BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;

-- REPLACE can bypass DELETE triggers unless each connection enables recursive
-- triggers. Block duplicate primary/unique identities before conflict handling.
CREATE TRIGGER gate_h2_authority_enrollments_no_replace
BEFORE INSERT ON gate_h2_authority_enrollments
WHEN EXISTS (
  SELECT 1 FROM gate_h2_authority_enrollments
  WHERE enrollment_id = NEW.enrollment_id OR enrollment_sha256 = NEW.enrollment_sha256
)
BEGIN SELECT RAISE(ABORT, 'gate_h2_append_only'); END;
