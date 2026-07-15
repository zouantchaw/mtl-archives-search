import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type LedgerIdentity = { candidate_commit: string; authority_hash: string; stage_id: string };
export type LedgerRow = Record<string, unknown>;
export type LedgerReadback = { attempts: LedgerRow[]; claims: LedgerRow[]; completions: LedgerRow[] };

export interface StageLedgerAdapter {
  appendAttempt(identity: LedgerIdentity, attemptId: string, attemptedAt: string, requestSha256: string): Promise<void>;
  claimBegin(identity: LedgerIdentity, attemptId: string, beganAt: string, envelope: string, envelopeSha256: string): Promise<void>;
  appendCompletion(identity: LedgerIdentity, attemptId: string, completedAt: string, envelope: string, envelopeSha256: string): Promise<void>;
  readAll(candidateCommit: string, authorityHash: string): Promise<LedgerReadback>;
}

export class StageLedgerContractError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "StageLedgerContractError"; }
}

function digest(domain: string, value: string): string {
  return crypto.createHash("sha256").update(`${domain}\0${value}`).digest("hex");
}

type D1Envelope = {
  success: boolean;
  result: Array<{ success: boolean; results?: LedgerRow[]; meta?: { changes?: number }; error?: string }>;
  errors?: Array<{ code?: number; message?: string }>;
};

export class CloudflareD1StageLedger implements StageLedgerAdapter {
  private constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string,
    private readonly request: typeof fetch,
  ) {}

  static fromEnvironment(authorityLedger: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): CloudflareD1StageLedger {
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
    return new CloudflareD1StageLedger(accountId, databaseId, apiToken, request);
  }

  private async query(sql: string, params: unknown[], mutation: boolean): Promise<LedgerRow[]> {
    const verb = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase();
    if ((mutation && verb !== "INSERT") || (!mutation && verb !== "SELECT"))
      throw new StageLedgerContractError("H2_LEDGER_SQL_VERB", "D1 ledger permits INSERT mutations and SELECT readback only");
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/query`;
    const response = await this.request(url, { method: "POST", headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }), redirect: "error" });
    let body: D1Envelope;
    try { body = await response.json() as D1Envelope; }
    catch { throw new StageLedgerContractError("H2_LEDGER_RESPONSE", "D1 ledger returned invalid JSON"); }
    const result = body.result?.[0];
    if (!response.ok || body.success !== true || result?.success !== true)
      throw new StageLedgerContractError("H2_LEDGER_WRITE_CONFLICT", "D1 ledger operation failed closed");
    if (mutation && result.meta?.changes !== 1)
      throw new StageLedgerContractError("H2_LEDGER_READBACK", "D1 ledger mutation did not append exactly one row");
    return result.results ?? [];
  }

  appendAttempt(identity: LedgerIdentity, attemptId: string, attemptedAt: string, requestSha256: string): Promise<void> {
    return this.query("INSERT INTO gate_h2_stage_attempts (attempt_id,candidate_commit,authority_hash,stage_id,attempted_at,request_sha256) VALUES (?,?,?,?,?,?)", [attemptId, identity.candidate_commit, identity.authority_hash, identity.stage_id, attemptedAt, requestSha256], true).then(() => undefined);
  }
  claimBegin(identity: LedgerIdentity, attemptId: string, beganAt: string, envelope: string, envelopeSha256: string): Promise<void> {
    return this.query("INSERT INTO gate_h2_stage_claims (candidate_commit,authority_hash,stage_id,attempt_id,began_at,begin_envelope,begin_sha256) VALUES (?,?,?,?,?,?,?)", [identity.candidate_commit, identity.authority_hash, identity.stage_id, attemptId, beganAt, envelope, envelopeSha256], true).then(() => undefined);
  }
  appendCompletion(identity: LedgerIdentity, attemptId: string, completedAt: string, envelope: string, envelopeSha256: string): Promise<void> {
    return this.query("INSERT INTO gate_h2_stage_completions (candidate_commit,authority_hash,stage_id,attempt_id,completed_at,completion_envelope,completion_sha256) VALUES (?,?,?,?,?,?,?)", [identity.candidate_commit, identity.authority_hash, identity.stage_id, attemptId, completedAt, envelope, envelopeSha256], true).then(() => undefined);
  }
  async readAll(candidateCommit: string, authorityHash: string): Promise<LedgerReadback> {
    const rows = async (table: string) => this.query(`SELECT * FROM ${table} WHERE candidate_commit = ? AND authority_hash = ? ORDER BY sequence`, [candidateCommit, authorityHash], false);
    const claims = () => this.query("SELECT * FROM gate_h2_stage_claims WHERE candidate_commit = ? AND authority_hash = ? ORDER BY began_at, stage_id", [candidateCommit, authorityHash], false);
    const completions = () => this.query("SELECT * FROM gate_h2_stage_completions WHERE candidate_commit = ? AND authority_hash = ? ORDER BY completed_at, stage_id", [candidateCommit, authorityHash], false);
    const [attempts, claimRows, completionRows] = await Promise.all([rows("gate_h2_stage_attempts"), claims(), completions()]);
    return { attempts, claims: claimRows, completions: completionRows };
  }
}

export function gateH2LedgerSchemaPin(repositoryRoot: string): { sha256: string; bytes: number } {
  const raw = fs.readFileSync(path.join(repositoryRoot, "infrastructure/d1/migrations/0012_gate_h2_stage_ledger.sql"));
  return { sha256: crypto.createHash("sha256").update(raw).digest("hex"), bytes: raw.length };
}

export async function stageLedgerProductionContractSelfTest(repositoryRoot: string): Promise<{ status: string; cases: string[] }> {
  const account = "0123456789abcdef0123456789abcdef";
  const database = "11111111-2222-4333-8444-555555555555";
  const authority = {
    account_capability_digest: digest("gate-h2-d1-account-capability-v1", account),
    database_uuid_digest: digest("gate-h2-d1-database-uuid-v1", database),
  };
  const attempts: LedgerRow[] = []; const claims: LedgerRow[] = []; const completions: LedgerRow[] = [];
  const requests: Array<{ url: string; sql: string }> = [];
  const mock: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
    requests.push({ url: String(input), sql: body.sql });
    const table = body.sql.match(/(?:INTO|FROM)\s+(gate_h2_stage_[a-z]+)/)?.[1] ?? "";
    const target = table.endsWith("attempts") ? attempts : table.endsWith("claims") ? claims : completions;
    if (body.sql.startsWith("INSERT")) {
      if (table.endsWith("claims") && claims.some((row) => row.candidate_commit === body.params[0] && row.authority_hash === body.params[1] && row.stage_id === body.params[2]))
        return new Response(JSON.stringify({ success: false, result: [{ success: false, error: "UNIQUE" }] }), { status: 409 });
      const row = table.endsWith("attempts")
        ? { sequence: attempts.length + 1, attempt_id: body.params[0], candidate_commit: body.params[1], authority_hash: body.params[2], stage_id: body.params[3], attempted_at: body.params[4], request_sha256: body.params[5] }
        : table.endsWith("claims")
          ? { candidate_commit: body.params[0], authority_hash: body.params[1], stage_id: body.params[2], attempt_id: body.params[3], began_at: body.params[4], begin_envelope: body.params[5], begin_sha256: body.params[6] }
          : { candidate_commit: body.params[0], authority_hash: body.params[1], stage_id: body.params[2], attempt_id: body.params[3], completed_at: body.params[4], completion_envelope: body.params[5], completion_sha256: body.params[6] };
      target.push(row); return new Response(JSON.stringify({ success: true, result: [{ success: true, meta: { changes: 1 } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, result: [{ success: true, results: target }] }), { status: 200 });
  };
  const adapter = CloudflareD1StageLedger.fromEnvironment(authority, { GATE_H2_LEDGER_ACCOUNT_ID: account, GATE_H2_LEDGER_DATABASE_ID: database, GATE_H2_LEDGER_API_TOKEN: "test-only-token" }, mock);
  const identity = { candidate_commit: "c".repeat(40), authority_hash: "a".repeat(64), stage_id: "visual_predict" };
  await adapter.appendAttempt(identity, "attempt-1", "2026-07-15T00:00:00.000Z", "1".repeat(64));
  await adapter.claimBegin(identity, "attempt-1", "2026-07-15T00:00:00.001Z", "{}", "2".repeat(64));
  await adapter.appendAttempt(identity, "attempt-2", "2026-07-15T00:00:00.002Z", "3".repeat(64));
  let duplicateRejected = false;
  try { await adapter.claimBegin(identity, "attempt-2", "2026-07-15T00:00:00.003Z", "{}", "4".repeat(64)); }
  catch (error) { duplicateRejected = error instanceof StageLedgerContractError && error.code === "H2_LEDGER_WRITE_CONFLICT"; }
  if (!duplicateRejected || attempts.length !== 2 || claims.length !== 1) throw new StageLedgerContractError("H2_LEDGER_TEST", "duplicate attempt was not retained while unique claim failed");
  await adapter.appendCompletion(identity, "attempt-1", "2026-07-15T00:00:00.004Z", "{}", "5".repeat(64));
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
  const mismatched = structuredClone(readback); mismatched.claims[0].begin_sha256 = "0".repeat(64);
  if (mismatched.claims[0].begin_sha256 === readback.claims[0].begin_sha256) throw new StageLedgerContractError("H2_LEDGER_TEST", "readback mismatch fixture was ineffective");
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
  return { status: "stage_ledger_production_contract_self_test_passed", cases: ["deleted_local_cache_irrelevant", "alternate_cache_irrelevant", "second_attempt_audited", "concurrent_unique_claim", "update_delete_trigger_rejected", "missing_remote_row", "readback_mismatch", "enumeration_mismatch", "no_real_d1_write"] };
}
