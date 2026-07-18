import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jcs, parseStrictJson } from "./https-exchange-contract-v1.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectJson = { [key: string]: Json };
type EnrollmentRow = Record<string, unknown>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SOURCE_DESCRIPTOR_PATH = "docs/dataset-factory/fixtures/gate-h2-authority-enrollment-v1/source-descriptor-v1.json";
const ENROLLMENT_PATH = "docs/dataset-factory/fixtures/gate-h2-authority-enrollment-v1/authority-enrollment-v1.json";
const ENROLLMENT_SCHEMA_PATH = "docs/dataset-factory/schemas/reviewed-metrics-v2/post-begin-authority-enrollment.schema.v1.json";
const ENROLLMENT_MIGRATION_PATH = "infrastructure/d1/migrations/0013_gate_h2_authority_enrollment.sql";
// Updated only by the local fixture-regeneration step after the descriptor is final.
const EXPECTED_SOURCE_DESCRIPTOR_SHA256 = "0ab6cdb59ad5d7bc9f022fbed0cea304a6e36a1c13d6cae066afc693875c1718";
const GRANT_DOMAIN = "gate-h2-post-begin-authority-grant-v1";

export class PostBeginAuthorityEnrollmentError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "PostBeginAuthorityEnrollmentError"; }
}

function fail(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PostBeginAuthorityEnrollmentError(code, message);
}
function sha256(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonicalLine(value: Json): Buffer { return Buffer.from(`${jcs(value)}\n`, "utf8"); }
function exactKeys(value: unknown, keys: readonly string[], code: string): asserts value is ObjectJson {
  fail(value !== null && typeof value === "object" && !Array.isArray(value), code, "value must be an object");
  const observed = Object.keys(value as object).sort(); const expected = [...keys].sort();
  fail(observed.length === expected.length && observed.every((key, index) => key === expected[index]), code, "object keys differ from the frozen contract");
}
function string(value: unknown, code: string, name: string, expression = /.+/): string {
  fail(typeof value === "string" && expression.test(value), code, `${name} is invalid`); return value;
}
function integer(value: unknown, code: string, name: string): number {
  fail(Number.isSafeInteger(value) && (value as number) > 0, code, `${name} is invalid`); return value as number;
}
function digest(value: unknown, code: string, name: string): string { return string(value, code, name, /^[a-f0-9]{64}$/); }
function pin(value: unknown, code: string, expectedPath?: string, runtimeAbsolute = false): ObjectJson {
  exactKeys(value, ["bytes", "path", "sha256"], code); const result = value as ObjectJson;
  const pattern = runtimeAbsolute ? /^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/ : /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
  const file = string(result.path, code, "pin path", pattern);
  if (expectedPath) fail(file === expectedPath, code, "pin path differs from the fixed source path");
  integer(result.bytes, code, "pin bytes"); digest(result.sha256, code, "pin sha256"); return result;
}
function strictCanonicalObject(raw: Buffer, code: string): ObjectJson {
  let parsed: Json;
  try { parsed = parseStrictJson(raw); } catch { throw new PostBeginAuthorityEnrollmentError(code, "document is not strict JSON"); }
  fail(raw.equals(canonicalLine(parsed)), code, "document must be exact JCS UTF-8 plus one newline");
  fail(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), code, "document must be an object");
  return parsed as ObjectJson;
}
function readFixed(root: string, relative: string, code: string): Buffer {
  const absolute = path.resolve(root, relative);
  fail(absolute === path.join(root, relative), code, "fixed source path escapes repository root");
  try { return fs.readFileSync(absolute); } catch { throw new PostBeginAuthorityEnrollmentError(code, "fixed source artifact is unavailable"); }
}
function canonicalRfc3339Ms(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}

export type SourcePinnedEnrollment = Readonly<{ document: ObjectJson; documentBytes: Buffer; enrollmentSha256: string; sourceDescriptorSha256: string }>;
export type AuthorityEnrollmentSchemaAttestation = Readonly<{ rows: EnrollmentRow[]; sha256: string; bytes: number }>;

function schemaRows(rows: EnrollmentRow[]): AuthorityEnrollmentSchemaAttestation {
  const normalized = rows.map((row) => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql ?? null }))
    .sort((left, right) => `${left.type}\0${left.name}`.localeCompare(`${right.type}\0${right.name}`));
  const bytes = canonicalLine(normalized as Json); return { rows: normalized, sha256: sha256(bytes), bytes: bytes.length };
}
export function gateH2AuthorityEnrollmentSchemaAttestation(repositoryRoot = ROOT): AuthorityEnrollmentSchemaAttestation {
  const sqlite = "/usr/bin/sqlite3"; fail(fs.existsSync(sqlite), "H2_ENROLLMENT_SCHEMA", "sqlite3 is required for schema attestation");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h2-enrollment-schema-"));
  try {
    const database = path.join(directory, "enrollment.sqlite3");
    execFileSync(sqlite, [database], { input: readFixed(repositoryRoot, ENROLLMENT_MIGRATION_PATH, "H2_ENROLLMENT_SCHEMA") });
    const output = execFileSync(sqlite, ["-json", database, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name LIKE 'gate_h2_authority_enrollment%' ORDER BY type,name"], { encoding: "utf8" });
    return schemaRows(JSON.parse(output) as EnrollmentRow[]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function validateBinding(value: unknown, root: string): void {
  exactKeys(value, ["bytes", "path", "sha256"], "H2_ENROLLMENT_SOURCE_DESCRIPTOR"); const binding = value as ObjectJson;
  const relative = string(binding.path, "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "binding path", /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/);
  const raw = readFixed(root, relative, "H2_ENROLLMENT_SOURCE_DESCRIPTOR");
  fail(integer(binding.bytes, "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "binding bytes") === raw.length && digest(binding.sha256, "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "binding sha256") === sha256(raw), "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "source binding readback differs");
}
export function validateSourceDescriptorBytes(raw: Buffer, root = ROOT): ObjectJson {
  fail(sha256(raw) === EXPECTED_SOURCE_DESCRIPTOR_SHA256, "H2_ENROLLMENT_SOURCE_PIN", "source descriptor digest differs from shipped enrollment root");
  const descriptor = strictCanonicalObject(raw, "H2_ENROLLMENT_SOURCE_DESCRIPTOR");
  exactKeys(descriptor, ["bindings", "candidate_commit", "production_status", "schema_version"], "H2_ENROLLMENT_SOURCE_DESCRIPTOR");
  fail(descriptor.schema_version === "gate_h2_post_begin_authority_enrollment_source_descriptor_v1.0.0" && descriptor.production_status === "inactive", "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "source descriptor is not the inactive v1 root");
  string(descriptor.candidate_commit, "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "candidate commit", /^[a-f0-9]{40}$/);
  fail(Array.isArray(descriptor.bindings) && descriptor.bindings.length === 3, "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "source descriptor must bind enrollment, schema, and migration");
  const paths = descriptor.bindings.map((binding) => (binding as ObjectJson).path);
  fail(JSON.stringify(paths) === JSON.stringify([ENROLLMENT_PATH, ENROLLMENT_SCHEMA_PATH, ENROLLMENT_MIGRATION_PATH]), "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "source binding order or paths differ");
  for (const binding of descriptor.bindings) validateBinding(binding, root); return descriptor;
}

function validateEnrollmentDocument(document: ObjectJson, raw: Buffer, root: string): void {
  exactKeys(document, ["authority_document", "candidate_commit", "canonicalization_version", "coordinator_endpoint", "d1", "enrollment_id", "native_capability_contract", "production_status", "relay_executable", "replay_journal", "report_channel", "schema_version", "stage_launch_authority", "synthetic", "verifier"], "H2_ENROLLMENT_DOCUMENT");
  fail(document.schema_version === "gate_h2_post_begin_authority_enrollment_v1.0.0" && document.production_status === "inactive" && document.synthetic === true && document.canonicalization_version === "gate_h2_post_begin_grant_jcs_v1" && document.native_capability_contract === "gate_h2_native_retained_fd_attestation_v1", "H2_ENROLLMENT_DOCUMENT", "enrollment must be the synthetic inactive v1 document");
  string(document.enrollment_id, "H2_ENROLLMENT_DOCUMENT", "enrollment id", /^[a-z0-9][a-z0-9_-]{7,127}$/); string(document.candidate_commit, "H2_ENROLLMENT_DOCUMENT", "candidate commit", /^[a-f0-9]{40}$/);
  pin(document.relay_executable, "H2_ENROLLMENT_DOCUMENT", undefined, true);
  const authority = pin(document.authority_document, "H2_ENROLLMENT_DOCUMENT", "docs/dataset-factory/fixtures/reviewed-metrics-v2/input-authority-v2.json"); const authorityBytes = readFixed(root, authority.path as string, "H2_ENROLLMENT_DOCUMENT");
  fail(authority.bytes === authorityBytes.length && authority.sha256 === sha256(authorityBytes), "H2_ENROLLMENT_DOCUMENT", "authority document pin differs from source readback");
  exactKeys(document.stage_launch_authority, ["candidate_commit", "sha256"], "H2_ENROLLMENT_DOCUMENT"); const launch = document.stage_launch_authority as ObjectJson;
  fail(launch.candidate_commit === document.candidate_commit, "H2_ENROLLMENT_DOCUMENT", "stage launch candidate differs from enrollment candidate"); digest(launch.sha256, "H2_ENROLLMENT_DOCUMENT", "stage launch digest");
  exactKeys(document.verifier, ["algorithm", "key_id", "principal", "spki_der_base64", "spki_der_sha256"], "H2_ENROLLMENT_DOCUMENT"); const verifier = document.verifier as ObjectJson;
  fail(verifier.algorithm === "ed25519", "H2_ENROLLMENT_DOCUMENT", "verifier algorithm must be Ed25519"); string(verifier.principal, "H2_ENROLLMENT_DOCUMENT", "verifier principal"); string(verifier.key_id, "H2_ENROLLMENT_DOCUMENT", "verifier key id");
  const spki = Buffer.from(string(verifier.spki_der_base64, "H2_ENROLLMENT_DOCUMENT", "SPKI DER", /^[A-Za-z0-9+/]+={0,2}$/), "base64");
  fail(spki.toString("base64") === verifier.spki_der_base64 && spki.length === 44 && sha256(spki) === digest(verifier.spki_der_sha256, "H2_ENROLLMENT_DOCUMENT", "SPKI digest"), "H2_ENROLLMENT_DOCUMENT", "verifier SPKI DER hash differs");
  try { fail(crypto.createPublicKey({ key: spki, format: "der", type: "spki" }).asymmetricKeyType === "ed25519", "H2_ENROLLMENT_DOCUMENT", "verifier key is not Ed25519"); } catch (error) { if (error instanceof PostBeginAuthorityEnrollmentError) throw error; throw new PostBeginAuthorityEnrollmentError("H2_ENROLLMENT_DOCUMENT", "verifier SPKI cannot be parsed"); }
  const endpoint = document.coordinator_endpoint as ObjectJson; exactKeys(endpoint, ["capability_id", "capability_lineage_sha256", "endpoint_identity_sha256", "native_descriptor_sha256", "principal", "transfer_mode"], "H2_ENROLLMENT_DOCUMENT");
  fail(endpoint.transfer_mode === "coordinator_retained_inherited_one_run_fd", "H2_ENROLLMENT_DOCUMENT", "endpoint must be coordinator-retained inherited capability"); string(endpoint.principal, "H2_ENROLLMENT_DOCUMENT", "endpoint principal"); for (const key of ["capability_id", "capability_lineage_sha256", "native_descriptor_sha256", "endpoint_identity_sha256"]) digest(endpoint[key], "H2_ENROLLMENT_DOCUMENT", key);
  const replay = document.replay_journal as ObjectJson; exactKeys(replay, ["capability_lineage_sha256", "exclusive_owner_id", "journal_state_sha256", "namespace", "native_descriptor_sha256", "object_id", "retention_mode"], "H2_ENROLLMENT_DOCUMENT");
  fail(replay.retention_mode === "coordinator_retained_durable_exclusive_writer", "H2_ENROLLMENT_DOCUMENT", "replay journal must retain one exclusive writer"); for (const key of ["namespace", "object_id", "exclusive_owner_id"]) string(replay[key], "H2_ENROLLMENT_DOCUMENT", key); for (const key of ["capability_lineage_sha256", "native_descriptor_sha256", "journal_state_sha256"]) digest(replay[key], "H2_ENROLLMENT_DOCUMENT", key);
  const report = document.report_channel as ObjectJson; exactKeys(report, ["capability_lineage_sha256", "channel_id", "completion_expectations_sha256", "native_descriptor_sha256", "transfer_mode"], "H2_ENROLLMENT_DOCUMENT");
  fail(report.transfer_mode === "coordinator_retained_one_run_report_fd", "H2_ENROLLMENT_DOCUMENT", "report channel must retain one-run FD"); string(report.channel_id, "H2_ENROLLMENT_DOCUMENT", "report channel id"); for (const key of ["capability_lineage_sha256", "native_descriptor_sha256", "completion_expectations_sha256"]) digest(report[key], "H2_ENROLLMENT_DOCUMENT", key);
  const d1 = document.d1 as ObjectJson; exactKeys(d1, ["account_id_sha256", "api_contract", "coordinator_capability_lineage_sha256", "database_id_sha256", "endpoint_url_sha256", "enrollment_table_schema", "migration", "namespace_digest"], "H2_ENROLLMENT_DOCUMENT");
  fail(d1.api_contract === "cloudflare_v4_d1_query_select_v1", "H2_ENROLLMENT_DOCUMENT", "D1 API contract differs"); for (const key of ["account_id_sha256", "database_id_sha256", "endpoint_url_sha256", "coordinator_capability_lineage_sha256", "namespace_digest"]) digest(d1[key], "H2_ENROLLMENT_DOCUMENT", key);
  const migration = pin(d1.migration, "H2_ENROLLMENT_DOCUMENT", ENROLLMENT_MIGRATION_PATH); const migrationBytes = readFixed(root, ENROLLMENT_MIGRATION_PATH, "H2_ENROLLMENT_DOCUMENT");
  fail(migration.bytes === migrationBytes.length && migration.sha256 === sha256(migrationBytes), "H2_ENROLLMENT_DOCUMENT", "D1 migration pin differs from source readback"); exactKeys(d1.enrollment_table_schema, ["bytes", "sha256"], "H2_ENROLLMENT_DOCUMENT");
  const schema = gateH2AuthorityEnrollmentSchemaAttestation(root); fail((d1.enrollment_table_schema as ObjectJson).bytes === schema.bytes && (d1.enrollment_table_schema as ObjectJson).sha256 === schema.sha256, "H2_ENROLLMENT_DOCUMENT", "D1 enrollment schema pin differs from migration attestation");
  fail(raw.equals(canonicalLine(document)), "H2_ENROLLMENT_DOCUMENT", "enrollment bytes lost canonical identity");
}
export function loadSourcePinnedAuthorityEnrollment(): SourcePinnedEnrollment {
  const descriptorBytes = readFixed(ROOT, SOURCE_DESCRIPTOR_PATH, "H2_ENROLLMENT_SOURCE_PIN"); const descriptor = validateSourceDescriptorBytes(descriptorBytes, ROOT);
  const documentBytes = readFixed(ROOT, ENROLLMENT_PATH, "H2_ENROLLMENT_DOCUMENT"); const document = strictCanonicalObject(documentBytes, "H2_ENROLLMENT_DOCUMENT"); validateEnrollmentDocument(document, documentBytes, ROOT);
  fail(descriptor.candidate_commit === document.candidate_commit, "H2_ENROLLMENT_SOURCE_DESCRIPTOR", "source descriptor candidate commit differs from enrollment candidate");
  return { document, documentBytes, enrollmentSha256: sha256(documentBytes), sourceDescriptorSha256: sha256(descriptorBytes) };
}

/**
 * This is a strict data contract for #100's native retained-FD attestor, not a
 * JavaScript capability. #100 must construct it only after native validation of
 * inherited descriptors; TypeScript objects and copied public labels are not a
 * trust boundary. #104 remains inactive until that implementation exists.
 */
export type NativeRetainedCapabilityEvidence = Readonly<{
  schema_version: "gate_h2_native_retained_fd_attestation_v1";
  request_descriptor_sha256: string;
  endpoint: Readonly<{ capability_id: string; capability_lineage_sha256: string; native_descriptor_sha256: string; observed_endpoint_sha256: string }>;
  replay_journal: Readonly<{ namespace: string; object_id: string; exclusive_owner_id: string; capability_lineage_sha256: string; native_descriptor_sha256: string; journal_state_sha256: string }>;
  report_channel: Readonly<{ channel_id: string; capability_lineage_sha256: string; native_descriptor_sha256: string; completion_expectations_sha256: string }>;
  d1: Readonly<{ account_id_sha256: string; database_id_sha256: string; endpoint_url_sha256: string; coordinator_capability_lineage_sha256: string }>;
}>;
function validateNativeEvidence(enrollment: SourcePinnedEnrollment, requestBytes: Buffer, evidence: NativeRetainedCapabilityEvidence): void {
  exactKeys(evidence, ["d1", "endpoint", "replay_journal", "report_channel", "request_descriptor_sha256", "schema_version"], "H2_ENROLLMENT_NATIVE_CAPABILITY");
  const document = enrollment.document; const endpoint = document.coordinator_endpoint as ObjectJson; const replay = document.replay_journal as ObjectJson; const report = document.report_channel as ObjectJson; const d1 = document.d1 as ObjectJson;
  fail(evidence.schema_version === document.native_capability_contract, "H2_ENROLLMENT_NATIVE_CAPABILITY", "native capability attestation contract differs");
  fail(digest(evidence.request_descriptor_sha256, "H2_ENROLLMENT_NATIVE_CAPABILITY", "request descriptor") === sha256(requestBytes), "H2_ENROLLMENT_REQUEST", "actual request bytes do not match the retained request descriptor");
  exactKeys(evidence.endpoint, ["capability_id", "capability_lineage_sha256", "native_descriptor_sha256", "observed_endpoint_sha256"], "H2_ENROLLMENT_NATIVE_CAPABILITY");
  fail(evidence.endpoint.capability_id === endpoint.capability_id && evidence.endpoint.capability_lineage_sha256 === endpoint.capability_lineage_sha256 && evidence.endpoint.native_descriptor_sha256 === endpoint.native_descriptor_sha256 && digest(evidence.endpoint.observed_endpoint_sha256, "H2_ENROLLMENT_NATIVE_CAPABILITY", "endpoint identity") === endpoint.endpoint_identity_sha256, "H2_ENROLLMENT_ENDPOINT", "endpoint capability or retained descriptor was substituted");
  exactKeys(evidence.replay_journal, ["capability_lineage_sha256", "exclusive_owner_id", "journal_state_sha256", "namespace", "native_descriptor_sha256", "object_id"], "H2_ENROLLMENT_NATIVE_CAPABILITY");
  fail(evidence.replay_journal.namespace === replay.namespace && evidence.replay_journal.object_id === replay.object_id && evidence.replay_journal.exclusive_owner_id === replay.exclusive_owner_id && evidence.replay_journal.capability_lineage_sha256 === replay.capability_lineage_sha256 && evidence.replay_journal.native_descriptor_sha256 === replay.native_descriptor_sha256 && digest(evidence.replay_journal.journal_state_sha256, "H2_ENROLLMENT_NATIVE_CAPABILITY", "journal state") === replay.journal_state_sha256, "H2_ENROLLMENT_REPLAY", "replay journal capability or durable state was substituted");
  exactKeys(evidence.report_channel, ["capability_lineage_sha256", "channel_id", "completion_expectations_sha256", "native_descriptor_sha256"], "H2_ENROLLMENT_NATIVE_CAPABILITY");
  fail(evidence.report_channel.channel_id === report.channel_id && evidence.report_channel.capability_lineage_sha256 === report.capability_lineage_sha256 && evidence.report_channel.native_descriptor_sha256 === report.native_descriptor_sha256 && evidence.report_channel.completion_expectations_sha256 === report.completion_expectations_sha256, "H2_ENROLLMENT_REPORT", "report channel or expectations were substituted");
  exactKeys(evidence.d1, ["account_id_sha256", "coordinator_capability_lineage_sha256", "database_id_sha256", "endpoint_url_sha256"], "H2_ENROLLMENT_NATIVE_CAPABILITY");
  fail(evidence.d1.account_id_sha256 === d1.account_id_sha256 && evidence.d1.database_id_sha256 === d1.database_id_sha256 && evidence.d1.endpoint_url_sha256 === d1.endpoint_url_sha256 && evidence.d1.coordinator_capability_lineage_sha256 === d1.coordinator_capability_lineage_sha256, "H2_ENROLLMENT_D1_CAPABILITY", "D1 account, database, endpoint, or coordinator capability was substituted");
}

type AuthorityGrant = ObjectJson;
function validateEnrollmentGrant(enrollment: SourcePinnedEnrollment, raw: Buffer, requestBytes: Buffer, evidence: NativeRetainedCapabilityEvidence): AuthorityGrant {
  validateNativeEvidence(enrollment, requestBytes, evidence); const grant = strictCanonicalObject(raw, "H2_ENROLLMENT_GRANT");
  exactKeys(grant, ["candidate_commit", "canonicalization_version", "completion_expectations_sha256", "coordinator_endpoint_capability_id", "coordinator_endpoint_lineage_sha256", "d1_namespace_digest", "enrollment_id", "enrollment_sha256", "grant_id", "relay_executable_sha256", "replay_namespace", "replay_sequence", "report_channel_id", "request_sha256", "signature_base64url", "stage_launch_authority_sha256", "verifier_key_id"], "H2_ENROLLMENT_GRANT");
  const document = enrollment.document; const d1 = document.d1 as ObjectJson; const endpoint = document.coordinator_endpoint as ObjectJson; const replay = document.replay_journal as ObjectJson; const report = document.report_channel as ObjectJson; const verifier = document.verifier as ObjectJson; const launch = document.stage_launch_authority as ObjectJson; const relay = document.relay_executable as ObjectJson;
  fail(grant.canonicalization_version === document.canonicalization_version && grant.enrollment_id === document.enrollment_id && grant.enrollment_sha256 === enrollment.enrollmentSha256 && grant.candidate_commit === document.candidate_commit && grant.stage_launch_authority_sha256 === launch.sha256 && grant.relay_executable_sha256 === relay.sha256 && grant.d1_namespace_digest === d1.namespace_digest && grant.verifier_key_id === verifier.key_id, "H2_ENROLLMENT_GRANT", "grant differs from the frozen enrollment identity");
  fail(grant.coordinator_endpoint_capability_id === endpoint.capability_id && grant.coordinator_endpoint_lineage_sha256 === endpoint.capability_lineage_sha256 && grant.replay_namespace === replay.namespace && grant.report_channel_id === report.channel_id && grant.completion_expectations_sha256 === report.completion_expectations_sha256, "H2_ENROLLMENT_GRANT", "grant selects a non-enrolled endpoint, replay namespace, report channel, or expectations digest");
  fail(digest(grant.request_sha256, "H2_ENROLLMENT_GRANT", "request digest") === sha256(requestBytes), "H2_ENROLLMENT_REQUEST", "grant request digest does not match exact request bytes");
  fail(Number.isSafeInteger(grant.replay_sequence) && (grant.replay_sequence as number) >= 0, "H2_ENROLLMENT_GRANT", "replay sequence is invalid");
  const unsigned = structuredClone(grant); delete unsigned.grant_id; delete unsigned.signature_base64url; fail(grant.grant_id === sha256(`${GRANT_DOMAIN}\0${jcs(unsigned)}`), "H2_ENROLLMENT_GRANT", "grant id differs from canonical grant bytes");
  const signatureText = string(grant.signature_base64url, "H2_ENROLLMENT_GRANT", "grant signature", /^[A-Za-z0-9_-]+$/); const signature = Buffer.from(signatureText, "base64url"); fail(signature.length === 64 && signature.toString("base64url") === signatureText, "H2_ENROLLMENT_GRANT", "grant signature encoding is invalid");
  const spki = Buffer.from(verifier.spki_der_base64 as string, "base64"); const signedGrant = structuredClone(grant); delete signedGrant.signature_base64url;
  fail(crypto.verify(null, Buffer.concat([Buffer.from(`${GRANT_DOMAIN}\0`), Buffer.from(jcs(signedGrant))]), crypto.createPublicKey({ key: spki, format: "der", type: "spki" }), signature), "H2_ENROLLMENT_GRANT", "grant signature was not produced by the enrolled verifier key");
  return grant;
}

export type SourcePinnedProductionAdmissionInput = Readonly<{
  grantBytes: Buffer;
  requestBytes: Buffer;
  nativeEvidence: NativeRetainedCapabilityEvidence;
}>;

/** The only production entry point. It loads the fixed root and fails closed. */
export async function admitSourcePinnedPostBeginAuthority(input: SourcePinnedProductionAdmissionInput): Promise<never> {
  const enrollment = loadSourcePinnedAuthorityEnrollment();
  fail(enrollment.document.synthetic === false && enrollment.document.production_status === "active", "H2_ENROLLMENT_INACTIVE", "synthetic inactive enrollment cannot authorize production");
  validateEnrollmentGrant(enrollment, input.grantBytes, input.requestBytes, input.nativeEvidence);
  throw new PostBeginAuthorityEnrollmentError("H2_ENROLLMENT_INACTIVE", "unreachable inactive enrollment guard");
}

export type CompletionRow = Readonly<{ candidate_commit: string; authority_hash: string; stage_id: string; attempt_id: string; completion_sha256: string }>;
export function reconcileExactCompletion(expected: CompletionRow, rows: readonly CompletionRow[]): "completion_recorded" | "indeterminate_no_completion" {
  if (rows.length === 0) return "indeterminate_no_completion"; fail(rows.length === 1, "H2_ENROLLMENT_COMPLETION", "conflicting completion rows fail closed"); const row = rows[0];
  fail(row.candidate_commit === expected.candidate_commit && row.authority_hash === expected.authority_hash && row.stage_id === expected.stage_id && row.attempt_id === expected.attempt_id && row.completion_sha256 === expected.completion_sha256, "H2_ENROLLMENT_COMPLETION", "completion row differs from exact immutable attempt identity"); return "completion_recorded";
}

// The following injected reader and mutable enrollment helpers are self-test-only.
// They are deliberately not exported and cannot be selected by production callers.
type TestEnrollmentReader = { attestSchema(enrollment: SourcePinnedEnrollment): Promise<void>; readExact(enrollment: SourcePinnedEnrollment): Promise<EnrollmentRow[]> };
async function verifyReadbackForTest(reader: TestEnrollmentReader): Promise<void> {
  const enrollment = loadSourcePinnedAuthorityEnrollment(); await reader.attestSchema(enrollment); const rows = await reader.readExact(enrollment); fail(rows.length === 1, "H2_ENROLLMENT_READBACK", "D1 must return exactly one source-pinned enrollment row");
  const row = rows[0]; const document = enrollment.document; const d1 = document.d1 as ObjectJson; const authority = document.authority_document as ObjectJson; const launch = document.stage_launch_authority as ObjectJson;
  fail(row.enrollment_id === document.enrollment_id, "H2_ENROLLMENT_READBACK", "D1 enrollment id differs"); fail(row.enrollment_sha256 === enrollment.enrollmentSha256, "H2_ENROLLMENT_READBACK", "D1 enrollment digest differs"); fail(row.enrollment_bytes === enrollment.documentBytes.length, "H2_ENROLLMENT_READBACK", "D1 enrollment bytes differ"); fail(row.enrollment_document === enrollment.documentBytes.toString("utf8"), "H2_ENROLLMENT_READBACK", "D1 enrollment document differs");
  fail(row.source_descriptor_sha256 === enrollment.sourceDescriptorSha256, "H2_ENROLLMENT_READBACK", "D1 source descriptor differs"); fail(row.candidate_commit === document.candidate_commit, "H2_ENROLLMENT_READBACK", "D1 candidate commit differs"); fail(row.stage_launch_authority_sha256 === launch.sha256, "H2_ENROLLMENT_READBACK", "D1 launch authority differs"); fail(row.authority_document_sha256 === authority.sha256, "H2_ENROLLMENT_READBACK", "D1 authority document differs"); fail(row.d1_namespace_digest === d1.namespace_digest, "H2_ENROLLMENT_READBACK", "D1 namespace differs"); fail(row.production_status === "inactive", "H2_ENROLLMENT_READBACK", "D1 production status differs"); fail(canonicalRfc3339Ms(row.enrolled_at), "H2_ENROLLMENT_READBACK", "D1 enrolled_at differs");
}
function expectError(code: string, action: () => unknown): void { try { action(); } catch (error) { if (error instanceof PostBeginAuthorityEnrollmentError && error.code === code) return; throw error; } throw new Error(`expected ${code}`); }
async function expectAsyncError(code: string, action: () => Promise<unknown>): Promise<void> { try { await action(); } catch (error) { if (error instanceof PostBeginAuthorityEnrollmentError && error.code === code) return; throw error; } throw new Error(`expected ${code}`); }
function replacementEnrollment(enrollment: SourcePinnedEnrollment, key: crypto.KeyObject): SourcePinnedEnrollment { const document = structuredClone(enrollment.document); const spki = key.export({ format: "der", type: "spki" }) as Buffer; const verifier = document.verifier as ObjectJson; verifier.spki_der_base64 = spki.toString("base64"); verifier.spki_der_sha256 = sha256(spki); const documentBytes = canonicalLine(document); return { document, documentBytes, enrollmentSha256: sha256(documentBytes), sourceDescriptorSha256: enrollment.sourceDescriptorSha256 }; }
function testEvidence(enrollment: SourcePinnedEnrollment, request: Buffer): NativeRetainedCapabilityEvidence { const endpoint = enrollment.document.coordinator_endpoint as ObjectJson; const replay = enrollment.document.replay_journal as ObjectJson; const report = enrollment.document.report_channel as ObjectJson; const d1 = enrollment.document.d1 as ObjectJson; return { schema_version: "gate_h2_native_retained_fd_attestation_v1", request_descriptor_sha256: sha256(request), endpoint: { capability_id: endpoint.capability_id as string, capability_lineage_sha256: endpoint.capability_lineage_sha256 as string, native_descriptor_sha256: endpoint.native_descriptor_sha256 as string, observed_endpoint_sha256: endpoint.endpoint_identity_sha256 as string }, replay_journal: { namespace: replay.namespace as string, object_id: replay.object_id as string, exclusive_owner_id: replay.exclusive_owner_id as string, capability_lineage_sha256: replay.capability_lineage_sha256 as string, native_descriptor_sha256: replay.native_descriptor_sha256 as string, journal_state_sha256: replay.journal_state_sha256 as string }, report_channel: { channel_id: report.channel_id as string, capability_lineage_sha256: report.capability_lineage_sha256 as string, native_descriptor_sha256: report.native_descriptor_sha256 as string, completion_expectations_sha256: report.completion_expectations_sha256 as string }, d1: { account_id_sha256: d1.account_id_sha256 as string, database_id_sha256: d1.database_id_sha256 as string, endpoint_url_sha256: d1.endpoint_url_sha256 as string, coordinator_capability_lineage_sha256: d1.coordinator_capability_lineage_sha256 as string } }; }
function signedGrant(enrollment: SourcePinnedEnrollment, privateKey: crypto.KeyObject, request: Buffer): Buffer { const document = enrollment.document; const launch = document.stage_launch_authority as ObjectJson; const relay = document.relay_executable as ObjectJson; const d1 = document.d1 as ObjectJson; const endpoint = document.coordinator_endpoint as ObjectJson; const replay = document.replay_journal as ObjectJson; const report = document.report_channel as ObjectJson; const verifier = document.verifier as ObjectJson; const grant: ObjectJson = { candidate_commit: document.candidate_commit, canonicalization_version: document.canonicalization_version, completion_expectations_sha256: report.completion_expectations_sha256, coordinator_endpoint_capability_id: endpoint.capability_id, coordinator_endpoint_lineage_sha256: endpoint.capability_lineage_sha256, d1_namespace_digest: d1.namespace_digest, enrollment_id: document.enrollment_id, enrollment_sha256: enrollment.enrollmentSha256, grant_id: "", relay_executable_sha256: relay.sha256, replay_namespace: replay.namespace, replay_sequence: 1, report_channel_id: report.channel_id, request_sha256: sha256(request), signature_base64url: "", stage_launch_authority_sha256: launch.sha256, verifier_key_id: verifier.key_id }; const unsigned = structuredClone(grant); delete unsigned.grant_id; delete unsigned.signature_base64url; grant.grant_id = sha256(`${GRANT_DOMAIN}\0${jcs(unsigned)}`); const signed = structuredClone(grant); delete signed.signature_base64url; grant.signature_base64url = crypto.sign(null, Buffer.concat([Buffer.from(`${GRANT_DOMAIN}\0`), Buffer.from(jcs(signed))]), privateKey).toString("base64url"); return canonicalLine(grant); }
function sqlLiteral(value: unknown): string { return `'${String(value).replaceAll("'", "''")}'`; }
function migrationRow(enrollment: SourcePinnedEnrollment): Record<string, string | number> { const document = enrollment.document; const d1 = document.d1 as ObjectJson; const authority = document.authority_document as ObjectJson; const launch = document.stage_launch_authority as ObjectJson; return { enrollment_id: document.enrollment_id as string, enrollment_sha256: enrollment.enrollmentSha256, enrollment_bytes: enrollment.documentBytes.length, enrollment_document: enrollment.documentBytes.toString("utf8"), source_descriptor_sha256: enrollment.sourceDescriptorSha256, candidate_commit: document.candidate_commit as string, stage_launch_authority_sha256: launch.sha256 as string, authority_document_sha256: authority.sha256 as string, d1_namespace_digest: d1.namespace_digest as string, production_status: "inactive", enrolled_at: "2026-07-18T00:00:00.000Z" }; }
function insertSql(row: Record<string, string | number>, prefix = "INSERT"): string { const names = Object.keys(row); return `${prefix} INTO gate_h2_authority_enrollments (${names.join(",")}) VALUES (${names.map((name) => typeof row[name] === "number" ? row[name] : sqlLiteral(row[name])).join(",")});`; }
function reorderDocumentObject(document: string, path: readonly string[]): string {
  const value = JSON.parse(document) as Record<string, unknown>;
  let target: Record<string, unknown> = value;
  for (const key of path) target = target[key] as Record<string, unknown>;
  const [first, second, ...rest] = Object.keys(target);
  fail(first !== undefined && second !== undefined, "H2_ENROLLMENT_TEST", `cannot reorder ${path.join(".")}`);
  const reordered = Object.fromEntries([[second, target[second]], [first, target[first]], ...rest.map((key) => [key, target[key]])]);
  Object.keys(target).forEach((key) => delete target[key]); Object.assign(target, reordered);
  return `${JSON.stringify(value)}\n`;
}
function noncanonicalByteDocument(document: string, path: readonly string[], spelling: string): string {
  const value = JSON.parse(document) as Record<string, unknown>;
  let target: Record<string, unknown> = value;
  for (const key of path) target = target[key] as Record<string, unknown>;
  const bytes = target.bytes;
  fail(typeof bytes === "number" && Number.isSafeInteger(bytes), "H2_ENROLLMENT_TEST", `missing integer bytes at ${path.join(".")}`);
  const canonical = JSON.stringify(value);
  const canonicalTarget = JSON.stringify(target);
  const replacement = `"bytes":${bytes}${spelling}`;
  const needle = `"bytes":${bytes}`;
  const targetStart = canonical.indexOf(canonicalTarget);
  fail(targetStart >= 0, "H2_ENROLLMENT_TEST", `cannot find object at ${path.join(".")}`);
  const start = canonical.indexOf(needle, targetStart);
  fail(start >= 0, "H2_ENROLLMENT_TEST", `cannot find bytes at ${path.join(".")}`);
  return `${canonical.slice(0, start)}${replacement}${canonical.slice(start + needle.length)}\n`;
}
function escapedDocument(document: string, needle: string, replacement: string): string {
  const start = document.indexOf(needle);
  fail(start >= 0, "H2_ENROLLMENT_TEST", `cannot find escape mutation ${needle}`);
  return `${document.slice(0, start)}${replacement}${document.slice(start + needle.length)}`;
}
function migrationConstraintSelfTest(enrollment: SourcePinnedEnrollment): string[] {
  const sqlite = "/usr/bin/sqlite3"; const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h2-enrollment-migration-")); const database = path.join(directory, "test.sqlite3");
  const migration = readFixed(ROOT, ENROLLMENT_MIGRATION_PATH, "H2_ENROLLMENT_TEST").toString("utf8");
  const run = (sql: string, label: string, allowed = false, expectedError?: string): void => {
    let failed = false; let output = "";
    try { execFileSync(sqlite, [database], { input: sql, stdio: "pipe" }); } catch (error) {
      failed = true; const commandError = error as { message?: string; stderr?: Buffer | string };
      output = `${commandError.message ?? ""}\n${commandError.stderr?.toString() ?? ""}`;
    }
    fail(allowed ? !failed : failed, "H2_ENROLLMENT_TEST", `${label} unexpectedly ${failed ? "rejected" : "accepted"}`);
    if (expectedError) fail(output.includes(expectedError), "H2_ENROLLMENT_TEST", `${label} did not reach ${expectedError}`);
  };
  try {
    run(migration, "migration", true); const row = migrationRow(enrollment); run(insertSql(row), "valid row", true);
    const fresh = (label: string, changes: Partial<Record<string, string | number>> = {}): Record<string, string | number> => ({ ...row, enrollment_id: `gate_h2_${label}`, enrollment_sha256: sha256(label), ...changes });
    const invalid: Array<[string, Record<string, string | number>]> = [["uppercase_digest", fresh("uppercase_digest", { enrollment_sha256: "A".repeat(64) })], ["malformed_digest", fresh("malformed_digest", { source_descriptor_sha256: "g".repeat(64) })], ["uppercase_commit", fresh("uppercase_commit", { candidate_commit: "A".repeat(40) })], ["timestamp_offset", fresh("timestamp_offset", { enrolled_at: "2026-07-18T00:00:00.000+00:00" })], ["timestamp_calendar", fresh("timestamp_calendar", { enrolled_at: "2026-02-31T00:00:00.000Z" })], ["byte_mismatch", fresh("byte_mismatch", { enrollment_bytes: enrollment.documentBytes.length - 1 })], ["noncanonical_json", fresh("noncanonical_json", { enrollment_document: "{\"x\": 1}\n", enrollment_bytes: 9 })], ["nonascii_json", fresh("nonascii_json", { enrollment_document: "{\"x\":\"e\"}\n".replace("e", "\\u00e9"), enrollment_bytes: 10 })]];
    for (const [label, invalidRow] of invalid) run(insertSql(invalidRow), label);
    const document = row.enrollment_document as string;
    const objectPaths: Array<[string, readonly string[]]> = [["top_level", []], ["authority_document", ["authority_document"]], ["coordinator_endpoint", ["coordinator_endpoint"]], ["d1", ["d1"]], ["d1_enrollment_table_schema", ["d1", "enrollment_table_schema"]], ["d1_migration", ["d1", "migration"]], ["relay_executable", ["relay_executable"]], ["replay_journal", ["replay_journal"]], ["report_channel", ["report_channel"]], ["stage_launch_authority", ["stage_launch_authority"]], ["verifier", ["verifier"]]];
    for (const [label, objectPath] of objectPaths) run(insertSql(fresh(`reordered_${label}`, { enrollment_document: reorderDocumentObject(document, objectPath), enrollment_bytes: Buffer.byteLength(reorderDocumentObject(document, objectPath)) })), `reordered_${label}`, false, "gate_h2_enrollment_document_not_canonical_v1");
    const bytePaths: Array<[string, readonly string[], string]> = [["authority_document", ["authority_document"], ".0"], ["d1_enrollment_table_schema", ["d1", "enrollment_table_schema"], "e0"], ["d1_migration", ["d1", "migration"], ".00"], ["relay_executable", ["relay_executable"], "e+0"]];
    for (const [label, objectPath, spelling] of bytePaths) { const noncanonical = noncanonicalByteDocument(document, objectPath, spelling); run(insertSql(fresh(`noncanonical_bytes_${label}`, { enrollment_document: noncanonical, enrollment_bytes: Buffer.byteLength(noncanonical) })), `noncanonical_bytes_${label}`, false, "gate_h2_enrollment_document_not_canonical_v1"); }
    const escapedCases: Array<[string, string, string]> = [
      ["escaped_ascii", '"principal":"gate-h2-authority-test-verifier-v1"', '"principal":"gate-h2-authority-test-verifier-v1"'.replace("g", "\\u0067")],
      ["escaped_nonascii", '"namespace":"gate-h2-post-begin-v1"', '"namespace":"gate-h2-post-begin-v1\\u00e9"'],
      ["escaped_slash", '"path":"/usr/local/libexec/gate-h2-broker"', '"path":"\\/usr/local/libexec/gate-h2-broker"'],
    ];
    for (const [label, needle, replacement] of escapedCases) {
      const escaped = escapedDocument(document, needle, replacement);
      run(insertSql(fresh(label, { enrollment_document: escaped, enrollment_bytes: Buffer.byteLength(escaped) })), label, false, "gate_h2_enrollment_document_not_canonical_v1");
    }
    run(insertSql(row, "INSERT OR REPLACE"), "insert_or_replace", false, "gate_h2_append_only");
    run(insertSql(row).replace(";", " ON CONFLICT(enrollment_id) DO UPDATE SET enrolled_at=excluded.enrolled_at;"), "upsert_update", false, "gate_h2_append_only");
    run(`UPDATE gate_h2_authority_enrollments SET enrolled_at='2026-07-18T00:00:01.000Z' WHERE enrollment_id=${sqlLiteral(row.enrollment_id)};`, "update", false, "gate_h2_append_only");
    run(`DELETE FROM gate_h2_authority_enrollments WHERE enrollment_id=${sqlLiteral(row.enrollment_id)};`, "delete", false, "gate_h2_append_only");
    return [...invalid.map(([label]) => label), ...objectPaths.map(([label]) => `reordered_${label}`), ...bytePaths.map(([label]) => `noncanonical_bytes_${label}`), ...escapedCases.map(([label]) => label), "insert_or_replace", "upsert_update", "update", "delete"];
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export async function postBeginAuthorityEnrollmentSelfTest(): Promise<{ status: string; cases: string[] }> {
  const enrollment = loadSourcePinnedAuthorityEnrollment(); const cases = ["source_pinned_fixture", "inactive_production_guard"];
  await expectAsyncError("H2_ENROLLMENT_INACTIVE", () => admitSourcePinnedPostBeginAuthority({} as SourcePinnedProductionAdmissionInput));
  expectError("H2_ENROLLMENT_SOURCE_PIN", () => validateSourceDescriptorBytes(Buffer.concat([readFixed(ROOT, SOURCE_DESCRIPTOR_PATH, "H2_ENROLLMENT_TEST"), Buffer.from(" ")]))) ; cases.push("source_descriptor_tamper");
  const trusted = crypto.generateKeyPairSync("ed25519"); const trustedEnrollment = replacementEnrollment(enrollment, trusted.publicKey); const requestA = Buffer.from("exact-request-A", "utf8"); const requestB = Buffer.from("exact-request-B", "utf8"); const evidence = testEvidence(trustedEnrollment, requestA); const grant = signedGrant(trustedEnrollment, trusted.privateKey, requestA); validateEnrollmentGrant(trustedEnrollment, grant, requestA, evidence); expectError("H2_ENROLLMENT_REQUEST", () => validateEnrollmentGrant(trustedEnrollment, grant, requestB, testEvidence(trustedEnrollment, requestB))); cases.push("trusted_grant_exact_request_bytes", "grant_a_request_b_rejected");
  const attacker = crypto.generateKeyPairSync("ed25519"); expectError("H2_ENROLLMENT_GRANT", () => validateEnrollmentGrant(trustedEnrollment, signedGrant(trustedEnrollment, attacker.privateKey, requestA), requestA, evidence)); cases.push("untrusted_key_rejected");
  expectError("H2_ENROLLMENT_NATIVE_CAPABILITY", () => validateEnrollmentGrant(trustedEnrollment, grant, requestA, { schema_version: "gate_h2_native_retained_fd_attestation_v1", endpoint: { capability_id: evidence.endpoint.capability_id, capability_lineage_sha256: evidence.endpoint.capability_lineage_sha256 }, replay_journal: {}, report_channel: {}, d1: {}, request_descriptor_sha256: sha256(requestA) } as unknown as NativeRetainedCapabilityEvidence)); cases.push("copied_public_labels_without_native_descriptors_rejected");
  expectError("H2_ENROLLMENT_ENDPOINT", () => validateNativeEvidence(trustedEnrollment, requestA, { ...evidence, endpoint: { ...evidence.endpoint, native_descriptor_sha256: "a".repeat(64) } })); expectError("H2_ENROLLMENT_REPLAY", () => validateNativeEvidence(trustedEnrollment, requestA, { ...evidence, replay_journal: { ...evidence.replay_journal, native_descriptor_sha256: "b".repeat(64) } })); expectError("H2_ENROLLMENT_REPLAY", () => validateNativeEvidence(trustedEnrollment, requestA, { ...evidence, replay_journal: { ...evidence.replay_journal, journal_state_sha256: "c".repeat(64) } })); expectError("H2_ENROLLMENT_REPORT", () => validateNativeEvidence(trustedEnrollment, requestA, { ...evidence, report_channel: { ...evidence.report_channel, native_descriptor_sha256: "d".repeat(64) } })); expectError("H2_ENROLLMENT_REPORT", () => validateNativeEvidence(trustedEnrollment, requestA, { ...evidence, report_channel: { ...evidence.report_channel, completion_expectations_sha256: "e".repeat(64) } })); for (const field of ["account_id_sha256", "database_id_sha256", "endpoint_url_sha256", "coordinator_capability_lineage_sha256"] as const) expectError("H2_ENROLLMENT_D1_CAPABILITY", () => validateNativeEvidence(trustedEnrollment, requestA, { ...evidence, d1: { ...evidence.d1, [field]: "f".repeat(64) } })); cases.push("endpoint_replay_reset_report_expectations_d1_substitution_rejected");
  cases.push(...migrationConstraintSelfTest(enrollment)); const expected: CompletionRow = { candidate_commit: enrollment.document.candidate_commit as string, authority_hash: "a".repeat(64), stage_id: "visual_predict", attempt_id: "00000000-0000-4000-8000-000000000001", completion_sha256: "c".repeat(64) }; fail(reconcileExactCompletion(expected, []) === "indeterminate_no_completion", "H2_ENROLLMENT_TEST", "lost D1 completion response must remain indeterminate"); fail(reconcileExactCompletion(expected, [expected]) === "completion_recorded", "H2_ENROLLMENT_TEST", "exact completion reconciliation failed"); expectError("H2_ENROLLMENT_COMPLETION", () => reconcileExactCompletion(expected, [{ ...expected, completion_sha256: "d".repeat(64) }])); cases.push("lost_completion_indeterminate_and_reconcilable"); return { status: "ok", cases };
}
export async function postBeginAuthorityEnrollmentIntegrationTest(): Promise<{ status: string; cases: string[] }> {
  const source = loadSourcePinnedAuthorityEnrollment(); const d1 = source.document.d1 as ObjectJson; const authority = source.document.authority_document as ObjectJson; const launch = source.document.stage_launch_authority as ObjectJson; const schema = gateH2AuthorityEnrollmentSchemaAttestation(); const valid = migrationRow(source);
  const reader: TestEnrollmentReader = { async attestSchema(enrollment) { const expected = (enrollment.document.d1 as ObjectJson).enrollment_table_schema as ObjectJson; fail(schema.sha256 === expected.sha256 && schema.bytes === expected.bytes, "H2_ENROLLMENT_TEST", "local D1 schema mismatch"); }, async readExact() { return [valid]; } }; await verifyReadbackForTest(reader);
  const fields = ["enrollment_id", "enrollment_sha256", "enrollment_bytes", "enrollment_document", "source_descriptor_sha256", "candidate_commit", "stage_launch_authority_sha256", "authority_document_sha256", "d1_namespace_digest", "production_status", "enrolled_at"] as const;
  for (const field of fields) { const value = field === "enrollment_bytes" ? 0 : field === "enrolled_at" ? "2026-07-18T00:00:00Z" : "substituted"; await expectAsyncError("H2_ENROLLMENT_READBACK", () => verifyReadbackForTest({ ...reader, async readExact() { return [{ ...valid, [field]: value }]; } })); }
  await expectAsyncError("H2_ENROLLMENT_READBACK", () => verifyReadbackForTest({ ...reader, async readExact() { return []; } })); await expectAsyncError("H2_ENROLLMENT_READBACK", () => verifyReadbackForTest({ ...reader, async readExact() { return [valid, valid]; } })); await expectAsyncError("H2_ENROLLMENT_D1_SCHEMA", async () => { const changed = schemaRows([{ ...schema.rows[0], sql: "changed" }]); const expected = (source.document.d1 as ObjectJson).enrollment_table_schema as ObjectJson; fail(changed.sha256 === expected.sha256, "H2_ENROLLMENT_D1_SCHEMA", "schema attestation changed"); });
  return { status: "ok", cases: ["exact_d1_readback", "all_readback_field_substitutions_rejected", "missing_duplicate_malformed_rows_rejected", "schema_attestation_substitution_rejected"] };
}
async function main(): Promise<void> { const mode = process.argv[2] ?? "self-test"; const result = mode === "self-test" ? await postBeginAuthorityEnrollmentSelfTest() : mode === "integration-test" ? await postBeginAuthorityEnrollmentIntegrationTest() : (() => { throw new Error("usage: post-begin-authority-enrollment-v1 [self-test|integration-test]"); })(); console.log(JSON.stringify(result)); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
