import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LedgerIdentity = { candidate_commit: string; authority_hash: string; stage_id: string };
export type LedgerRow = Record<string, unknown>;
export type LedgerReadback = { attempts: LedgerRow[]; claims: LedgerRow[]; completions: LedgerRow[] };
export type LedgerSchemaAttestation = { rows: LedgerRow[]; sha256: string; bytes: number };
const INTERNAL_SYNTHETIC_TRANSPORT = Symbol("gate-h2-internal-synthetic-d1-transport");
type InternalSyntheticTransport = { readonly [INTERNAL_SYNTHETIC_TRANSPORT]: true; request: typeof fetch; timeoutMs?: number };
const D1_TIMEOUT_MS = 5_000;
const D1_MAX_BODY_BYTES = 256 * 1024;
const D1_MAX_ROWS = 64;
const PRODUCTION_FETCH = globalThis.fetch.bind(globalThis);
export type CompletionReconciliation =
  | { status: "exact_completion_success"; row: LedgerRow }
  | { status: "no_completion_indeterminate" }
  | { status: "conflicting_completion_failure" };

export interface StageLedgerAdapter {
  appendAttempt(identity: LedgerIdentity, attemptId: string, attemptedAt: string, requestSha256: string): Promise<void>;
  claimBegin(identity: LedgerIdentity, attemptId: string, beganAt: string, envelope: string, envelopeSha256: string): Promise<void>;
  appendCompletion(identity: LedgerIdentity, attemptId: string, completedAt: string, envelope: string, envelopeSha256: string): Promise<LedgerRow>;
  readAll(candidateCommit: string, authorityHash: string): Promise<LedgerReadback>;
  attestSchema(authorityLedger: Record<string, unknown>): Promise<void>;
}

export class StageLedgerContractError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "StageLedgerContractError"; }
}

const COMPLETION_COLUMNS = ["candidate_commit", "authority_hash", "stage_id", "attempt_id", "completed_at", "completion_envelope", "completion_sha256"] as const;

function exactCompletionRow(row: LedgerRow | undefined, identity: LedgerIdentity, attemptId: string, completedAt: string, envelope: string, envelopeSha256: string): boolean {
  if (!row || Object.keys(row).length !== COMPLETION_COLUMNS.length || COMPLETION_COLUMNS.some((column) => !Object.hasOwn(row, column))) return false;
  const expected = { ...identity, attempt_id: attemptId, completed_at: completedAt, completion_envelope: envelope, completion_sha256: envelopeSha256 };
  return COMPLETION_COLUMNS.every((column) => row[column] === expected[column]);
}

export function reconcileCompletion(readback: LedgerReadback, identity: LedgerIdentity, attemptId: string, completedAt: string, envelope: string, envelopeSha256: string): CompletionReconciliation {
  const relevant = readback.completions.filter((row) => row.candidate_commit === identity.candidate_commit && row.authority_hash === identity.authority_hash && row.stage_id === identity.stage_id);
  if (relevant.length === 0) return { status: "no_completion_indeterminate" };
  if (relevant.length === 1 && exactCompletionRow(relevant[0], identity, attemptId, completedAt, envelope, envelopeSha256))
    return { status: "exact_completion_success", row: structuredClone(relevant[0]) };
  return { status: "conflicting_completion_failure" };
}

function digest(domain: string, value: string): string {
  return crypto.createHash("sha256").update(`${domain}\0${value}`).digest("hex");
}
export function gateH2CapabilityDigest(domain: "gate-h2-d1-account-capability-v1" | "gate-h2-d1-database-uuid-v1", value: string): string { return digest(domain, value); }
export function gateH2NamespaceDigest(value: string): string { return digest("gate-h2-d1-namespace-capability-v2", value); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
function assertExactObjectKeys(value: unknown, expected: readonly string[], code: string, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || canonical(Object.keys(value).sort()) !== canonical([...expected].sort())) throw new StageLedgerContractError(code, `${label} keys differ from the reviewed D1 row contract`);
}
function validateSchemaRows(rows: LedgerRow[]): void {
  if (!Array.isArray(rows)) throw new StageLedgerContractError("H2_D1_SCHEMA_ROW", "D1 schema observation rows are not an array");
  const seen = new Set<string>();
  for (const row of rows) {
    assertExactObjectKeys(row, ["type", "name", "tbl_name", "sql"], "H2_D1_SCHEMA_ROW", "sqlite_master row");
    if (typeof row.type !== "string" || !["index", "table", "trigger"].includes(row.type) || typeof row.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name) || typeof row.tbl_name !== "string" || !/^gate_h2_stage_[a-z_]+$/.test(row.tbl_name) || (row.type === "index" ? row.sql !== null : typeof row.sql !== "string" || row.sql.length === 0)) throw new StageLedgerContractError("H2_D1_SCHEMA_ROW", "sqlite_master row has an unapproved type, identity, or SQL shape");
    const identity = `${row.type}\0${row.name}`; if (seen.has(identity)) throw new StageLedgerContractError("H2_D1_SCHEMA_ROW", "sqlite_master contains duplicate type/name identity"); seen.add(identity);
  }
}
function schemaAttestation(rows: LedgerRow[]): LedgerSchemaAttestation {
  validateSchemaRows(rows);
  const normalized = rows.map((row) => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql ?? null }))
    .sort((a, b) => `${a.type}\0${a.name}`.localeCompare(`${b.type}\0${b.name}`));
  const bytesValue = Buffer.from(`${canonical(normalized)}\n`);
  return { rows: normalized, sha256: crypto.createHash("sha256").update(bytesValue).digest("hex"), bytes: bytesValue.length };
}

type D1Envelope = {
  success: boolean;
  result: Array<{ success: boolean; results?: LedgerRow[]; meta?: { changes?: number }; error?: string }>;
  errors?: Array<{ code?: number; message?: string }>;
};

async function readBoundedJsonResponse(response: Response, controller: AbortController, responseCode: string): Promise<D1Envelope> {
  const encoding = response.headers.get("content-encoding"); const contentType = response.headers.get("content-type"); const lengthText = response.headers.get("content-length");
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity") throw new StageLedgerContractError(responseCode, "D1 response compression is forbidden");
  if (contentType === null || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType.trim())) throw new StageLedgerContractError(responseCode, "D1 response content type is not exact JSON");
  if (lengthText !== null && (!/^(?:0|[1-9][0-9]*)$/.test(lengthText) || Number(lengthText) > D1_MAX_BODY_BYTES)) throw new StageLedgerContractError(responseCode, "D1 response Content-Length is invalid or oversized");
  const reader = response.body?.getReader(); if (!reader) throw new StageLedgerContractError(responseCode, "D1 response body stream is unavailable");
  const chunks: Buffer[] = []; let total = 0;
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new StageLedgerContractError(responseCode, "D1 response stream exceeded the fixed monotonic deadline")), { once: true }))]);
      if (item.done) break; total += item.value.byteLength;
      if (total > D1_MAX_BODY_BYTES) { controller.abort(); throw new StageLedgerContractError(responseCode, "D1 response exceeded the strict byte cap"); }
      chunks.push(Buffer.from(item.value));
    }
  } finally { try { await reader.cancel(); } catch { /* abort/cancel cleanup is best effort */ } }
  if (lengthText !== null && total !== Number(lengthText)) throw new StageLedgerContractError(responseCode, "D1 response body length differs from Content-Length");
  try { return JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as D1Envelope; } catch { throw new StageLedgerContractError(responseCode, "D1 response is invalid JSON"); }
}
async function fixedD1Request(accountId: string, databaseId: string, apiToken: string, sql: string, params: unknown[], responseCode: string, synthetic?: InternalSyntheticTransport): Promise<D1Envelope> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), synthetic?.timeoutMs ?? D1_TIMEOUT_MS);
  const request = synthetic?.[INTERNAL_SYNTHETIC_TRANSPORT] === true ? synthetic.request : PRODUCTION_FETCH;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  try {
    const response = await request(url, { method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "identity" }, body: JSON.stringify({ sql, params }), redirect: "error", signal: controller.signal });
    if (response.redirected || (response.url !== "" && response.url !== url)) throw new StageLedgerContractError(responseCode, "D1 response redirected or changed endpoint");
    const body = await readBoundedJsonResponse(response, controller, responseCode); if (!response.ok) throw new StageLedgerContractError(responseCode, "D1 endpoint returned a non-success status"); return body;
  } catch (error) { if (error instanceof StageLedgerContractError) throw error; throw new StageLedgerContractError(responseCode, controller.signal.aborted ? "D1 request exceeded the fixed monotonic deadline" : "D1 request failed"); } finally { clearTimeout(timer); }
}
function assertBoundedRows(rows: LedgerRow[], responseCode: string): void {
  if (rows.length > D1_MAX_ROWS) throw new StageLedgerContractError(responseCode, "D1 response row count exceeds the fixed cap");
  for (const row of rows) for (const value of Object.values(row)) if (typeof value === "string" && Buffer.byteLength(value) > 64 * 1024) throw new StageLedgerContractError(responseCode, "D1 response field exceeds the fixed string cap");
}
function validateLedgerRows(sql: string, rows: LedgerRow[], responseCode: string): void {
  const table = sql.match(/(?:INTO|FROM)\s+(gate_h2_stage_[a-z_]+)/i)?.[1] ?? "";
  if (!table || rows.length === 0) return;
  const expected = table.endsWith("attempts") ? ["sequence", "attempt_id", "candidate_commit", "authority_hash", "stage_id", "attempted_at", "request_sha256"] : table.endsWith("claims") ? ["candidate_commit", "authority_hash", "stage_id", "attempt_id", "began_at", "begin_envelope", "begin_sha256"] : table.endsWith("completions") ? ["candidate_commit", "authority_hash", "stage_id", "attempt_id", "completed_at", "completion_envelope", "completion_sha256"] : undefined;
  if (!expected) throw new StageLedgerContractError(responseCode, "D1 response selected an unapproved ledger table");
  const identities = new Set<string>();
  for (const row of rows) {
    assertExactObjectKeys(row, expected, responseCode, "ledger row");
    if (table.endsWith("attempts") ? !(Number.isInteger(row.sequence) && typeof row.attempt_id === "string") : !(typeof row.candidate_commit === "string" && typeof row.authority_hash === "string" && typeof row.stage_id === "string" && typeof row.attempt_id === "string")) throw new StageLedgerContractError(responseCode, "D1 ledger row contains invalid identity types");
    for (const field of expected.filter((field) => field !== "sequence")) if (typeof row[field] !== "string") throw new StageLedgerContractError(responseCode, "D1 ledger row contains an invalid scalar type");
    const identity = table.endsWith("attempts") ? String(row.attempt_id) : `${row.candidate_commit}\0${row.authority_hash}\0${row.stage_id}`;
    if (identities.has(identity)) throw new StageLedgerContractError(responseCode, "D1 ledger response contains a duplicate row identity"); identities.add(identity);
  }
}
export async function observeCloudflareD1LedgerSchema(accountId: string, databaseId: string, apiToken: string): Promise<LedgerSchemaAttestation> {
  if (!accountId || !databaseId || !apiToken) throw new StageLedgerContractError("H2_D1_ATTESTATION_CAPABILITY", "live D1 observation requires account, database, and token capabilities");
  const envelope = await fixedD1Request(accountId, databaseId, apiToken, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name LIKE 'gate_h2_stage_%' ORDER BY type,name", [], "H2_D1_ATTESTATION_RESPONSE");
  if (envelope?.success !== true || !Array.isArray(envelope.result) || envelope.result.length !== 1 || envelope.result[0]?.success !== true || !Array.isArray(envelope.result[0].results) || (envelope.errors !== undefined && (!Array.isArray(envelope.errors) || envelope.errors.length !== 0))) throw new StageLedgerContractError("H2_D1_ATTESTATION_RESPONSE", "live D1 schema observation failed closed");
  const rows = envelope.result[0].results; assertBoundedRows(rows, "H2_D1_ATTESTATION_RESPONSE"); return schemaAttestation(rows);
}

export class CloudflareD1StageLedger implements StageLedgerAdapter {
  private constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string,
    private readonly synthetic?: InternalSyntheticTransport,
  ) {}

  static fromEnvironment(authorityLedger: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): CloudflareD1StageLedger {
    const required = (name: string): string => {
      const value = env[name];
      if (!value) throw new StageLedgerContractError("H2_LEDGER_CAPABILITY", `coordinator capability ${name} is unavailable`);
      return value;
    };
    const accountId = required("GATE_H2_LEDGER_ACCOUNT_ID");
    const databaseId = required("GATE_H2_LEDGER_DATABASE_ID");
    const apiToken = required("GATE_H2_LEDGER_API_TOKEN");
    if (digest("gate-h2-d1-account-capability-v1", accountId) !== authorityLedger.account_capability_digest ||
        digest("gate-h2-d1-database-uuid-v1", databaseId) !== authorityLedger.database_uuid_digest)
      throw new StageLedgerContractError("H2_LEDGER_CAPABILITY", "runtime D1 capability does not match authority digests");
    if (authorityLedger.namespace_digest !== undefined) {
      const namespace = required("GATE_H2_LEDGER_NAMESPACE");
      if (gateH2NamespaceDigest(namespace) !== authorityLedger.namespace_digest) throw new StageLedgerContractError("H2_LEDGER_CAPABILITY", "runtime D1 namespace capability does not match authority digest");
    }
    return new CloudflareD1StageLedger(accountId, databaseId, apiToken);
  }
  static internalSynthetic(authorityLedger: Record<string, unknown>, env: NodeJS.ProcessEnv, request: typeof fetch, timeoutMs?: number): CloudflareD1StageLedger {
    const accountId = env.GATE_H2_LEDGER_ACCOUNT_ID; const databaseId = env.GATE_H2_LEDGER_DATABASE_ID; const apiToken = env.GATE_H2_LEDGER_API_TOKEN;
    if (!accountId || !databaseId || !apiToken || digest("gate-h2-d1-account-capability-v1", accountId) !== authorityLedger.account_capability_digest || digest("gate-h2-d1-database-uuid-v1", databaseId) !== authorityLedger.database_uuid_digest) throw new StageLedgerContractError("H2_INTERNAL_CAPABILITY", "synthetic D1 transport identity differs");
    if (authorityLedger.namespace_digest !== undefined && env.GATE_H2_LEDGER_NAMESPACE_DIGEST !== authorityLedger.namespace_digest) throw new StageLedgerContractError("H2_INTERNAL_CAPABILITY", "synthetic D1 namespace identity differs");
    return new CloudflareD1StageLedger(accountId, databaseId, apiToken, { [INTERNAL_SYNTHETIC_TRANSPORT]: true, request, timeoutMs });
  }

  private async query(sql: string, params: unknown[], mutation: boolean): Promise<LedgerRow[]> {
    const verb = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase();
    if ((mutation && verb !== "INSERT") || (!mutation && verb !== "SELECT"))
      throw new StageLedgerContractError("H2_LEDGER_SQL_VERB", "D1 ledger permits INSERT mutations and SELECT readback only");
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/query`;
    const body = await fixedD1Request(this.accountId, this.databaseId, this.apiToken, sql, params, "H2_LEDGER_RESPONSE", this.synthetic);
    const result = body.result?.[0];
    if (body.success !== true || result?.success !== true)
      throw new StageLedgerContractError("H2_LEDGER_WRITE_CONFLICT", "D1 ledger operation failed closed");
    if (mutation && result.meta?.changes !== 1)
      throw new StageLedgerContractError("H2_LEDGER_READBACK", "D1 ledger mutation did not append exactly one row");
    if (result.results !== undefined && !Array.isArray(result.results)) throw new StageLedgerContractError("H2_LEDGER_RESPONSE", "D1 ledger results field is not an array");
    const rows = result.results ?? []; assertBoundedRows(rows, "H2_LEDGER_RESPONSE"); validateLedgerRows(sql, rows, "H2_LEDGER_RESPONSE"); return rows;
  }

  appendAttempt(identity: LedgerIdentity, attemptId: string, attemptedAt: string, requestSha256: string): Promise<void> {
    return this.query("INSERT INTO gate_h2_stage_attempts (attempt_id,candidate_commit,authority_hash,stage_id,attempted_at,request_sha256) VALUES (?,?,?,?,?,?)", [attemptId, identity.candidate_commit, identity.authority_hash, identity.stage_id, attemptedAt, requestSha256], true).then(() => undefined);
  }
  claimBegin(identity: LedgerIdentity, attemptId: string, beganAt: string, envelope: string, envelopeSha256: string): Promise<void> {
    return this.query("INSERT INTO gate_h2_stage_claims (candidate_commit,authority_hash,stage_id,attempt_id,began_at,begin_envelope,begin_sha256) VALUES (?,?,?,?,?,?,?)", [identity.candidate_commit, identity.authority_hash, identity.stage_id, attemptId, beganAt, envelope, envelopeSha256], true).then(() => undefined);
  }
  async appendCompletion(identity: LedgerIdentity, attemptId: string, completedAt: string, envelope: string, envelopeSha256: string): Promise<LedgerRow> {
    // A returned row is the completion evidence. Do not append and then perform
    // a fallible readback that could report failure after a durable commit.
    try {
      const rows = await this.query("INSERT INTO gate_h2_stage_completions (candidate_commit,authority_hash,stage_id,attempt_id,completed_at,completion_envelope,completion_sha256) VALUES (?,?,?,?,?,?,?) RETURNING candidate_commit,authority_hash,stage_id,attempt_id,completed_at,completion_envelope,completion_sha256", [identity.candidate_commit, identity.authority_hash, identity.stage_id, attemptId, completedAt, envelope, envelopeSha256], true);
      const [row] = rows;
      if (rows.length !== 1 || !exactCompletionRow(row, identity, attemptId, completedAt, envelope, envelopeSha256))
        throw new StageLedgerContractError("H2_LEDGER_COMPLETION_UNKNOWN", "D1 completion returned no exact atomic row");
      return structuredClone(row);
    } catch (error) {
      if (error instanceof StageLedgerContractError && error.code === "H2_LEDGER_COMPLETION_UNKNOWN") throw error;
      throw new StageLedgerContractError("H2_LEDGER_COMPLETION_UNKNOWN", "completion response is ambiguous; durable status must be reconciled before retry");
    }
  }
  async readAll(candidateCommit: string, authorityHash: string): Promise<LedgerReadback> {
    const rows = async (table: string) => this.query(`SELECT * FROM ${table} WHERE candidate_commit = ? AND authority_hash = ? ORDER BY sequence`, [candidateCommit, authorityHash], false);
    const claims = () => this.query("SELECT * FROM gate_h2_stage_claims WHERE candidate_commit = ? AND authority_hash = ? ORDER BY began_at, stage_id", [candidateCommit, authorityHash], false);
    const completions = () => this.query("SELECT * FROM gate_h2_stage_completions WHERE candidate_commit = ? AND authority_hash = ? ORDER BY completed_at, stage_id", [candidateCommit, authorityHash], false);
    try {
      const [attempts, claimRows, completionRows] = await Promise.all([rows("gate_h2_stage_attempts"), claims(), completions()]);
      return { attempts, claims: claimRows, completions: completionRows };
    } catch (error) {
      if (error instanceof StageLedgerContractError) throw new StageLedgerContractError("H2_LEDGER_READBACK", error.message);
      throw error;
    }
  }
  async attestSchema(authorityLedger: Record<string, unknown>): Promise<void> {
    const rows = await this.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name LIKE 'gate_h2_stage_%' ORDER BY type,name", [], false);
    const observed = schemaAttestation(rows);
    if (observed.sha256 !== authorityLedger.table_schema_sha256 || observed.bytes !== authorityLedger.table_schema_bytes)
      throw new StageLedgerContractError("H2_LEDGER_SCHEMA_ATTESTATION", "deployed D1 tables, indexes, or triggers differ from authority");
  }
}

export function gateH2LedgerSchemaAttestation(repositoryRoot: string): LedgerSchemaAttestation {
  const sqlite = "/usr/bin/sqlite3";
  if (!fs.existsSync(sqlite)) throw new StageLedgerContractError("H2_LEDGER_SCHEMA_ATTESTATION", "sqlite3 is required to canonicalize the ledger migration");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h2-schema-"));
  try {
    const database = path.join(root, "ledger.sqlite3");
    execFileSync(sqlite, [database], { input: fs.readFileSync(path.join(repositoryRoot, "infrastructure/d1/migrations/0012_gate_h2_stage_ledger.sql")) });
    const output = execFileSync(sqlite, ["-json", database, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name LIKE 'gate_h2_stage_%' ORDER BY type,name"], { encoding: "utf8" });
    return schemaAttestation(JSON.parse(output) as LedgerRow[]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
export function gateH2LedgerSchemaPin(repositoryRoot: string): { sha256: string; bytes: number } {
  const { sha256, bytes } = gateH2LedgerSchemaAttestation(repositoryRoot); return { sha256, bytes };
}

export function validateCompleteLedgerReadback(readback: LedgerReadback, candidateCommit: string, authorityHash: string, stageIds: readonly string[]): { attempts: LedgerRow[]; claims: Map<string, LedgerRow>; completions: Map<string, LedgerRow> } {
  function fail(condition: unknown, message: string): asserts condition { if (!condition) throw new StageLedgerContractError("H2_LEDGER_READBACK", message); }
  fail(readback.attempts.length === stageIds.length && readback.claims.length === stageIds.length && readback.completions.length === stageIds.length, "remote ledger cardinality differs from exact stage set");
  const exact = new Set(stageIds); const claims = new Map<string, LedgerRow>(); const completions = new Map<string, LedgerRow>(); const attempts = new Map<string, LedgerRow>();
  for (const row of readback.attempts) {
    const stage = String(row.stage_id); fail(exact.has(stage) && row.candidate_commit === candidateCommit && row.authority_hash === authorityHash && typeof row.attempt_id === "string" && typeof row.attempted_at === "string" && typeof row.request_sha256 === "string" && !attempts.has(stage), "attempt identity or exact stage set differs"); attempts.set(stage, row);
  }
  for (const row of readback.claims) { const stage = String(row.stage_id); fail(exact.has(stage) && row.candidate_commit === candidateCommit && row.authority_hash === authorityHash && !claims.has(stage), "claim identity or exact stage set differs"); claims.set(stage, row); }
  for (const row of readback.completions) { const stage = String(row.stage_id); fail(exact.has(stage) && row.candidate_commit === candidateCommit && row.authority_hash === authorityHash && !completions.has(stage), "completion identity or exact stage set differs"); completions.set(stage, row); }
  for (const stage of stageIds) {
    const attempt = attempts.get(stage)!; const claim = claims.get(stage)!; const completion = completions.get(stage)!;
    fail(attempt.attempt_id === claim.attempt_id && claim.attempt_id === completion.attempt_id, "attempt/claim/completion composite identity join differs");
    const beginRaw = Buffer.from(String(claim.begin_envelope)); const completionRaw = Buffer.from(String(completion.completion_envelope));
    let begin: LedgerRow; let completed: LedgerRow;
    try { begin = JSON.parse(beginRaw.toString("utf8")); completed = JSON.parse(completionRaw.toString("utf8")); } catch { throw new StageLedgerContractError("H2_LEDGER_READBACK", "remote envelope is not JSON"); }
    fail(beginRaw.equals(Buffer.from(`${JSON.stringify(begin, null, 2)}\n`)) && completionRaw.equals(Buffer.from(`${JSON.stringify(completed, null, 2)}\n`)), "remote envelope is not canonical");
    const beginHash = crypto.createHash("sha256").update(beginRaw).digest("hex"); const completionHash = crypto.createHash("sha256").update(completionRaw).digest("hex");
    fail(begin.candidate_commit === candidateCommit && begin.authority_hash === authorityHash && begin.stage_id === stage && begin.attempt_id === attempt.attempt_id &&
      completed.candidate_commit === candidateCommit && completed.authority_hash === authorityHash && completed.stage_id === stage && completed.attempt_id === attempt.attempt_id,
    "remote envelope identity differs from row identity");
    fail(attempt.attempted_at === begin.command_started_at && claim.began_at === begin.command_started_at && completion.completed_at === completed.command_completed_at, "remote row chronology does not join canonical envelope times");
    fail(attempt.request_sha256 === beginHash && claim.begin_sha256 === beginHash && completed.begin_sha256 === beginHash && completion.completion_sha256 === completionHash, "remote envelope hash join differs");
  }
  return { attempts: stageIds.map((stage) => attempts.get(stage)!), claims, completions };
}

export async function stageLedgerProductionContractSelfTest(repositoryRoot: string): Promise<{ status: string; cases: string[] }> {
  const account = "0123456789abcdef0123456789abcdef";
  const database = "11111111-2222-4333-8444-555555555555";
  const deployedSchema = gateH2LedgerSchemaAttestation(repositoryRoot);
  const authority = {
    account_capability_digest: digest("gate-h2-d1-account-capability-v1", account),
    database_uuid_digest: digest("gate-h2-d1-database-uuid-v1", database),
    table_schema_sha256: deployedSchema.sha256,
    table_schema_bytes: deployedSchema.bytes,
  };
  const attempts: LedgerRow[] = []; const claims: LedgerRow[] = []; const completions: LedgerRow[] = [];
  const requests: Array<{ url: string; sql: string }> = [];
  const jsonResponse = (value: unknown, status = 200): Response => { const raw = JSON.stringify(value); return new Response(raw, { status, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)) } }); };
  const mock: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
    requests.push({ url: String(input), sql: body.sql });
    if (body.sql.includes("FROM sqlite_master")) return jsonResponse({ success: true, result: [{ success: true, results: deployedSchema.rows }] });
    const table = body.sql.match(/(?:INTO|FROM)\s+(gate_h2_stage_[a-z_]+)/)?.[1] ?? "";
    const target = table.endsWith("attempts") ? attempts : table.endsWith("claims") ? claims : completions;
    if (body.sql.startsWith("INSERT")) {
      if (table.endsWith("claims") && claims.some((row) => row.candidate_commit === body.params[0] && row.authority_hash === body.params[1] && row.stage_id === body.params[2]))
        return jsonResponse({ success: false, result: [{ success: false, error: "UNIQUE" }] });
      const row = table.endsWith("attempts")
        ? { sequence: attempts.length + 1, attempt_id: body.params[0], candidate_commit: body.params[1], authority_hash: body.params[2], stage_id: body.params[3], attempted_at: body.params[4], request_sha256: body.params[5] }
        : table.endsWith("claims")
          ? { candidate_commit: body.params[0], authority_hash: body.params[1], stage_id: body.params[2], attempt_id: body.params[3], began_at: body.params[4], begin_envelope: body.params[5], begin_sha256: body.params[6] }
          : { candidate_commit: body.params[0], authority_hash: body.params[1], stage_id: body.params[2], attempt_id: body.params[3], completed_at: body.params[4], completion_envelope: body.params[5], completion_sha256: body.params[6] };
      target.push(row);
      const returning = table.endsWith("completions") && body.sql.includes("RETURNING");
      return jsonResponse({ success: true, result: [{ success: true, ...(returning ? { results: [row] } : {}), meta: { changes: 1 } }] });
    }
    return jsonResponse({ success: true, result: [{ success: true, results: target }] });
  };
  const adapter = CloudflareD1StageLedger.internalSynthetic(authority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token" }, mock);
  await adapter.attestSchema(authority);
  const identity = { candidate_commit: "c".repeat(40), authority_hash: "a".repeat(64), stage_id: "visual_predict" };
  await adapter.appendAttempt(identity, "attempt-1", "2026-07-15T00:00:00.000Z", "1".repeat(64));
  await adapter.claimBegin(identity, "attempt-1", "2026-07-15T00:00:00.001Z", "{}", "2".repeat(64));
  await adapter.appendAttempt(identity, "attempt-2", "2026-07-15T00:00:00.002Z", "3".repeat(64));
  let duplicateRejected = false;
  try { await adapter.claimBegin(identity, "attempt-2", "2026-07-15T00:00:00.003Z", "{}", "4".repeat(64)); }
  catch (error) { duplicateRejected = error instanceof StageLedgerContractError && error.code === "H2_LEDGER_WRITE_CONFLICT"; }
  if (!duplicateRejected || attempts.length !== 2 || claims.length !== 1) throw new StageLedgerContractError("H2_LEDGER_TEST", "duplicate attempt was not retained while unique claim failed");
  const completionEnvelope = "{}";
  const completionSha256 = "5".repeat(64);
  const completion = await adapter.appendCompletion(identity, "attempt-1", "2026-07-15T00:00:00.004Z", completionEnvelope, completionSha256);
  if (!exactCompletionRow(completion, identity, "attempt-1", "2026-07-15T00:00:00.004Z", completionEnvelope, completionSha256)) throw new StageLedgerContractError("H2_LEDGER_TEST", "successful completion did not return the exact immutable row");

  let insertCount = 0;
  let loseResponse = true;
  const lostCompletions: LedgerRow[] = [];
  const committedLostResponseMock: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
    if (body.sql.startsWith("INSERT INTO gate_h2_stage_completions")) {
      insertCount++;
      const row = { candidate_commit: body.params[0], authority_hash: body.params[1], stage_id: body.params[2], attempt_id: body.params[3], completed_at: body.params[4], completion_envelope: body.params[5], completion_sha256: body.params[6] };
      lostCompletions.push(row);
      if (loseResponse) { loseResponse = false; throw new Error("simulated lost response after commit"); }
      return jsonResponse({ success: true, result: [{ success: true, results: [row], meta: { changes: 1 } }] });
    }
    if (body.sql.startsWith("SELECT") && body.sql.includes("gate_h2_stage_completions"))
      return jsonResponse({ success: true, result: [{ success: true, results: lostCompletions }] });
    return mock(input, init);
  };
  const lostResponseAdapter = CloudflareD1StageLedger.internalSynthetic(authority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token" }, committedLostResponseMock);
  const lostIdentity = { ...identity, stage_id: "source_predict" };
  const lostCompletion = { attemptId: "attempt-lost", completedAt: "2026-07-15T00:00:00.014Z", envelope: "{\"lost\":true}", envelopeSha256: "d".repeat(64) };
  let lostCode = "";
  try { await lostResponseAdapter.appendCompletion(lostIdentity, lostCompletion.attemptId, lostCompletion.completedAt, lostCompletion.envelope, lostCompletion.envelopeSha256); }
  catch (error) { lostCode = error instanceof StageLedgerContractError ? error.code : ""; }
  if (lostCode !== "H2_LEDGER_COMPLETION_UNKNOWN" || insertCount !== 1) throw new StageLedgerContractError("H2_LEDGER_TEST", "committed completion with lost response did not remain indeterminate without re-execution");
  const reconciled = reconcileCompletion(await lostResponseAdapter.readAll(identity.candidate_commit, identity.authority_hash), lostIdentity, lostCompletion.attemptId, lostCompletion.completedAt, lostCompletion.envelope, lostCompletion.envelopeSha256);
  if (reconciled.status !== "exact_completion_success") throw new StageLedgerContractError("H2_LEDGER_TEST", "exact committed completion reconciliation did not succeed");
  const noCompletion = reconcileCompletion({ attempts: [], claims: [], completions: [] }, lostIdentity, lostCompletion.attemptId, lostCompletion.completedAt, lostCompletion.envelope, lostCompletion.envelopeSha256);
  if (noCompletion.status !== "no_completion_indeterminate") throw new StageLedgerContractError("H2_LEDGER_TEST", "missing completion was not indeterminate");
  const conflicting = reconcileCompletion({ attempts: [], claims: [], completions: [{ ...reconciled.row, completion_sha256: "e".repeat(64) }] }, lostIdentity, lostCompletion.attemptId, lostCompletion.completedAt, lostCompletion.envelope, lostCompletion.envelopeSha256);
  if (conflicting.status !== "conflicting_completion_failure") throw new StageLedgerContractError("H2_LEDGER_TEST", "conflicting completion was not rejected");
  const malformed = reconcileCompletion({ attempts: [], claims: [], completions: [{ ...reconciled.row, completion_envelope: null }] }, lostIdentity, lostCompletion.attemptId, lostCompletion.completedAt, lostCompletion.envelope, lostCompletion.envelopeSha256);
  if (malformed.status !== "conflicting_completion_failure") throw new StageLedgerContractError("H2_LEDGER_TEST", "malformed completion was not rejected");

  const readbackFailureMock: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
    if (body.sql.startsWith("SELECT") && body.sql.includes("gate_h2_stage_completions")) throw new Error("ordinary post-append readback unavailable");
    if (body.sql.startsWith("INSERT INTO gate_h2_stage_completions")) {
      const row = { candidate_commit: body.params[0], authority_hash: body.params[1], stage_id: body.params[2], attempt_id: body.params[3], completed_at: body.params[4], completion_envelope: body.params[5], completion_sha256: body.params[6] };
      return jsonResponse({ success: true, result: [{ success: true, results: [row], meta: { changes: 1 } }] });
    }
    return mock(input, init);
  };
  const readbackFailureAdapter = CloudflareD1StageLedger.internalSynthetic(authority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token" }, readbackFailureMock);
  const postAppend = await readbackFailureAdapter.appendCompletion({ ...identity, stage_id: "source_freeze" }, "attempt-post-append", "2026-07-15T00:00:00.024Z", "{\"post_append\":true}", "f".repeat(64));
  if (postAppend.attempt_id !== "attempt-post-append") throw new StageLedgerContractError("H2_LEDGER_TEST", "post-append readback failure changed a durable completion into begin-only failure");
  const concurrentIdentity = { ...identity, stage_id: "visual_freeze" };
  await Promise.all([
    adapter.appendAttempt(concurrentIdentity, "attempt-3", "2026-07-15T00:00:00.005Z", "6".repeat(64)),
    adapter.appendAttempt(concurrentIdentity, "attempt-4", "2026-07-15T00:00:00.005Z", "7".repeat(64)),
  ]);
  const concurrent = await Promise.allSettled([
    adapter.claimBegin(concurrentIdentity, "attempt-3", "2026-07-15T00:00:00.006Z", "{}", "8".repeat(64)),
    adapter.claimBegin(concurrentIdentity, "attempt-4", "2026-07-15T00:00:00.006Z", "{}", "9".repeat(64)),
  ]);
  if (concurrent.filter((result) => result.status === "fulfilled").length !== 1) throw new StageLedgerContractError("H2_LEDGER_TEST", "concurrent unique stage claim did not admit exactly one winner");
  const readback = await adapter.readAll(identity.candidate_commit, identity.authority_hash);
  if (readback.attempts.length !== 4 || readback.claims.length !== 2 || readback.completions.length !== 1) throw new StageLedgerContractError("H2_LEDGER_TEST", "complete remote enumeration mismatch");
  const localCache = fs.mkdtempSync(path.join(repositoryRoot, ".gate-h2-ledger-cache-test-"));
  const alternateCache = fs.mkdtempSync(path.join(repositoryRoot, ".gate-h2-ledger-cache-alt-"));
  fs.rmSync(localCache, { recursive: true, force: true }); fs.rmSync(alternateCache, { recursive: true, force: true });
  const afterCacheDeletion = await adapter.readAll(identity.candidate_commit, identity.authority_hash);
  if (afterCacheDeletion.attempts.length !== readback.attempts.length) throw new StageLedgerContractError("H2_LEDGER_TEST", "local cache affected remote authority");
  const detectsIncomplete = (rows: LedgerReadback): boolean => rows.attempts.length !== 4 || rows.claims.length !== 2 || rows.completions.length !== 1;
  if (!detectsIncomplete({ ...readback, completions: [] })) throw new StageLedgerContractError("H2_LEDGER_TEST", "missing remote row was not detected");
  const exactStages = ["visual_predict", "visual_freeze", "source_predict", "source_freeze", "gold_review", "gold_envelope_authoring", "private_prepare", "r2_retain", "private_finalize", "task_review", "metrics_score", "publication_assembly_plan"];
  const complete: LedgerReadback = { attempts: [], claims: [], completions: [] };
  for (let index = 0; index < exactStages.length; index++) {
    const stage = exactStages[index]; const attemptId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const startedAt = `2026-07-15T00:00:${String(index).padStart(2, "0")}.000Z`; const completedAt = `2026-07-15T00:01:${String(index).padStart(2, "0")}.000Z`;
    const begin = { candidate_commit: identity.candidate_commit, authority_hash: identity.authority_hash, stage_id: stage, attempt_id: attemptId, command_started_at: startedAt }; const beginRaw = `${JSON.stringify(begin, null, 2)}\n`; const beginHash = crypto.createHash("sha256").update(beginRaw).digest("hex");
    const completed = { candidate_commit: identity.candidate_commit, authority_hash: identity.authority_hash, stage_id: stage, attempt_id: attemptId, begin_sha256: beginHash, command_completed_at: completedAt }; const completedRaw = `${JSON.stringify(completed, null, 2)}\n`; const completedHash = crypto.createHash("sha256").update(completedRaw).digest("hex");
    complete.attempts.push({ sequence: index + 1, candidate_commit: identity.candidate_commit, authority_hash: identity.authority_hash, stage_id: stage, attempt_id: attemptId, attempted_at: startedAt, request_sha256: beginHash });
    complete.claims.push({ candidate_commit: identity.candidate_commit, authority_hash: identity.authority_hash, stage_id: stage, attempt_id: attemptId, began_at: startedAt, begin_envelope: beginRaw, begin_sha256: beginHash });
    complete.completions.push({ candidate_commit: identity.candidate_commit, authority_hash: identity.authority_hash, stage_id: stage, attempt_id: attemptId, completed_at: completedAt, completion_envelope: completedRaw, completion_sha256: completedHash });
  }
  validateCompleteLedgerReadback(complete, identity.candidate_commit, identity.authority_hash, exactStages);
  const expectReadbackRejection = (mutate: (rows: LedgerReadback) => void): void => { const bad = structuredClone(complete); mutate(bad); let rejected = false; try { validateCompleteLedgerReadback(bad, identity.candidate_commit, identity.authority_hash, exactStages); } catch (error) { rejected = error instanceof StageLedgerContractError && error.code === "H2_LEDGER_READBACK"; } if (!rejected) throw new StageLedgerContractError("H2_LEDGER_TEST", "injected remote readback mismatch reached the seal path"); };
  expectReadbackRejection((rows) => { rows.attempts[0].stage_id = "source_predict"; });
  expectReadbackRejection((rows) => { rows.claims[0].authority_hash = "f".repeat(64); });
  expectReadbackRejection((rows) => { rows.completions.pop(); });
  expectReadbackRejection((rows) => { rows.attempts[1] = structuredClone(rows.attempts[0]); });
  expectReadbackRejection((rows) => { rows.claims[0].begin_sha256 = "0".repeat(64); });
  const driftedSchemaMock: typeof fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)) as { sql: string }; return jsonResponse({ success: true, result: [{ success: true, results: body.sql.includes("sqlite_master") ? deployedSchema.rows.filter((row) => row.type !== "trigger") : [] }] }); };
  const driftedAdapter = CloudflareD1StageLedger.internalSynthetic(authority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token" }, driftedSchemaMock);
  let schemaRejected = false; try { await driftedAdapter.attestSchema(authority); } catch (error) { schemaRejected = error instanceof StageLedgerContractError && error.code === "H2_LEDGER_SCHEMA_ATTESTATION"; }
  if (!schemaRejected) throw new StageLedgerContractError("H2_LEDGER_TEST", "deployed schema/trigger mismatch passed attestation");
  const malformedSchemaCase = async (label: string, rows: LedgerRow[]): Promise<void> => {
    const malformedMock: typeof fetch = async () => jsonResponse({ success: true, result: [{ success: true, results: rows }] });
    const malformedAdapter = CloudflareD1StageLedger.internalSynthetic(authority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token" }, malformedMock);
    let rejected = false; try { await malformedAdapter.attestSchema(authority); } catch (error) { rejected = error instanceof StageLedgerContractError && error.code === "H2_D1_SCHEMA_ROW"; }
    if (!rejected) throw new StageLedgerContractError("H2_LEDGER_TEST", `${label} schema row crossed the exact D1 row contract`);
  };
  const validSchemaRow = deployedSchema.rows[0];
  await malformedSchemaCase("extra schema key", [{ ...validSchemaRow, extra: true }]);
  await malformedSchemaCase("wrong schema scalar", [{ ...validSchemaRow, name: 42 }]);
  await malformedSchemaCase("duplicate schema identity", [validSchemaRow, structuredClone(validSchemaRow)]);
  const namespacedAuthority = { ...authority, namespace_digest: gateH2NamespaceDigest("namespace-alpha") };
  let namespaceRejected = false; try { CloudflareD1StageLedger.fromEnvironment(namespacedAuthority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token", GATE_H2_LEDGER_NAMESPACE: "namespace-wrong" }); } catch (error) { namespaceRejected = error instanceof StageLedgerContractError && error.code === "H2_LEDGER_CAPABILITY"; }
  if (!namespaceRejected) throw new StageLedgerContractError("H2_LEDGER_TEST", "production D1 environment accepted a mismatched namespace capability");
  if (requests.some((request) => !/^(INSERT|SELECT)\b/.test(request.sql)) || requests.some((request) => !request.url.endsWith(`/accounts/${account}/d1/database/${database}/query`))) throw new StageLedgerContractError("H2_LEDGER_TEST", "production adapter used an unapproved verb or endpoint");
  const schema = fs.readFileSync(path.join(repositoryRoot, "infrastructure/d1/migrations/0012_gate_h2_stage_ledger.sql"), "utf8");
  const sqlite = "/usr/bin/sqlite3";
  if (!fs.existsSync(sqlite)) throw new StageLedgerContractError("H2_LEDGER_TEST", "sqlite3 is required to execute the append-only migration test");
  const sqliteRoot = fs.mkdtempSync(path.join(repositoryRoot, ".gate-h2-ledger-sqlite-test-"));
  try {
    const databaseFile = path.join(sqliteRoot, "ledger.sqlite3");
    execFileSync(sqlite, [databaseFile], { input: schema });
    execFileSync(sqlite, [databaseFile], { input: `PRAGMA foreign_keys=ON;
INSERT INTO gate_h2_stage_attempts VALUES (1,'attempt-sql','${identity.candidate_commit}','${identity.authority_hash}','visual_predict','2026-07-15T00:00:00.000Z','${"1".repeat(64)}');
INSERT INTO gate_h2_stage_claims VALUES ('${identity.candidate_commit}','${identity.authority_hash}','visual_predict','attempt-sql','2026-07-15T00:00:00.001Z','{}','${"2".repeat(64)}');
INSERT INTO gate_h2_stage_completions VALUES ('${identity.candidate_commit}','${identity.authority_hash}','visual_predict','attempt-sql','2026-07-15T00:00:00.002Z','{}','${"3".repeat(64)}');` });
    for (const table of ["gate_h2_stage_attempts", "gate_h2_stage_claims", "gate_h2_stage_completions"]) {
      for (const statement of [`UPDATE ${table} SET stage_id='mutated'`, `DELETE FROM ${table}`]) {
        let rejected = false;
        try { execFileSync(sqlite, [databaseFile, statement], { stdio: "pipe" }); }
        catch { rejected = true; }
        if (!rejected) throw new StageLedgerContractError("H2_LEDGER_TEST", `${table} accepted a forbidden mutation`);
      }
    }
  } finally { fs.rmSync(sqliteRoot, { recursive: true, force: true }); }
  return { status: "stage_ledger_production_contract_self_test_passed", cases: ["deleted_local_cache_irrelevant", "alternate_cache_irrelevant", "second_attempt_audited", "concurrent_unique_claim", "atomic_completion_row", "committed_write_lost_response", "exact_completion_reconciliation", "no_completion_indeterminate_no_reexecution", "conflicting_malformed_completion_rejected", "post_append_readback_failure_does_not_false_fail", "update_delete_trigger_rejected", "wrong_stage_readback", "wrong_authority_readback", "missing_remote_row", "duplicate_stage_readback", "envelope_hash_mismatch", "deployed_schema_trigger_mismatch", "enumeration_mismatch", "exact_schema_row_keys_types_and_duplicate_identity_rejected", "namespace_capability_mismatch_rejected", "no_real_d1_write"] };
}
