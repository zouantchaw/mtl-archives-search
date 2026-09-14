/** D1-backed operator jobs. Eve sessions are correlators, not job state. */

export const OPERATOR_TOOLS = [
  "inspect_source",
  "plan_import",
  "run_pilot",
  "validate_index",
  "request_review",
  "publish",
] as const;
export type OperatorTool = (typeof OPERATOR_TOOLS)[number];
export const APPROVAL_REQUIRED: OperatorTool[] = ["publish"];
export const OPERATOR_MODEL = "openai/gpt-5.4";

export type JobRow = {
  id: string;
  state: string;
  adapter: string | null;
  plan_hash: string | null;
  approval: string | null;
  version: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateRow = {
  id: string;
  job_id: string;
  source_record_id: string | null;
  canonical_json: string;
  candidate_json: string | null;
  media_sha256: string | null;
  tombstone: number;
};

export type PointerRow = {
  name: string;
  version: string;
  previous: string | null;
  activated_at: string;
};

export interface OperatorStorage {
  getJob(id: string): Promise<JobRow | null>;
  putJob(job: JobRow): Promise<void>;
  getIdempotency(token: string): Promise<string | null>;
  putIdempotency(token: string, jobId: string, tool: string, result: string): Promise<void>;
  putReceipt(id: string, jobId: string, stage: string, payload: string): Promise<void>;
  putCandidate(row: CandidateRow): Promise<void>;
  listCandidates(jobId: string): Promise<CandidateRow[]>;
  getPointer(name: string): Promise<PointerRow | null>;
  putPointer(row: PointerRow): Promise<void>;
  captionWrites: string[];
}

export function digest(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0") + text.length.toString(16);
}

export class MemoryOperatorStorage implements OperatorStorage {
  jobs = new Map<string, JobRow>();
  idem = new Map<string, string>();
  receipts: string[] = [];
  candidates = new Map<string, CandidateRow>();
  pointers = new Map<string, PointerRow>();
  captionWrites: string[] = [];
  async getJob(id: string) {
    return this.jobs.get(id) || null;
  }
  async putJob(job: JobRow) {
    this.jobs.set(job.id, job);
  }
  async getIdempotency(token: string) {
    return this.idem.get(token) || null;
  }
  async putIdempotency(token: string, _jobId: string, _tool: string, result: string) {
    this.idem.set(token, result);
  }
  async putReceipt(_id: string, _jobId: string, _stage: string, payload: string) {
    this.receipts.push(payload);
  }
  async putCandidate(row: CandidateRow) {
    this.candidates.set(row.id, row);
  }
  async listCandidates(jobId: string) {
    return [...this.candidates.values()].filter((c) => c.job_id === jobId);
  }
  async getPointer(name: string) {
    return this.pointers.get(name) || null;
  }
  async putPointer(row: PointerRow) {
    this.pointers.set(row.name, row);
  }
}

export class D1OperatorStorage implements OperatorStorage {
  captionWrites: string[] = [];
  constructor(private db: D1Database) {}
  async getJob(id: string) {
    return this.db
      .prepare("SELECT * FROM operator_job WHERE id = ?")
      .bind(id)
      .first<JobRow>();
  }
  async putJob(job: JobRow) {
    await this.db
      .prepare(
        `INSERT INTO operator_job (id, state, adapter, plan_hash, approval, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state=excluded.state, adapter=excluded.adapter, plan_hash=excluded.plan_hash,
           approval=excluded.approval, version=excluded.version, updated_at=excluded.updated_at`,
      )
      .bind(
        job.id,
        job.state,
        job.adapter,
        job.plan_hash,
        job.approval,
        job.version,
        job.created_at,
        job.updated_at,
      )
      .run();
  }
  async getIdempotency(token: string) {
    const row = await this.db
      .prepare("SELECT result_json FROM operator_idempotency WHERE token = ?")
      .bind(token)
      .first<{ result_json: string }>();
    return row?.result_json || null;
  }
  async putIdempotency(token: string, jobId: string, tool: string, result: string) {
    await this.db
      .prepare(
        `INSERT INTO operator_idempotency (token, job_id, tool, result_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(token) DO NOTHING`,
      )
      .bind(token, jobId, tool, result, new Date().toISOString())
      .run();
  }
  async putReceipt(id: string, jobId: string, stage: string, payload: string) {
    await this.db
      .prepare(
        `INSERT INTO operator_receipt (id, job_id, stage, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, jobId, stage, payload, new Date().toISOString())
      .run();
  }
  async putCandidate(row: CandidateRow) {
    await this.db
      .prepare(
        `INSERT INTO operator_candidate (id, job_id, source_record_id, canonical_json, candidate_json, media_sha256, tombstone)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           canonical_json=excluded.canonical_json, candidate_json=excluded.candidate_json,
           media_sha256=excluded.media_sha256, tombstone=excluded.tombstone`,
      )
      .bind(
        row.id,
        row.job_id,
        row.source_record_id,
        row.canonical_json,
        row.candidate_json,
        row.media_sha256,
        row.tombstone,
      )
      .run();
  }
  async listCandidates(jobId: string) {
    const res = await this.db
      .prepare("SELECT * FROM operator_candidate WHERE job_id = ?")
      .bind(jobId)
      .all<CandidateRow>();
    return res.results || [];
  }
  async getPointer(name: string) {
    return this.db
      .prepare("SELECT * FROM operator_index_pointer WHERE name = ?")
      .bind(name)
      .first<PointerRow>();
  }
  async putPointer(row: PointerRow) {
    await this.db
      .prepare(
        `INSERT INTO operator_index_pointer (name, version, previous, activated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           version=excluded.version, previous=excluded.previous, activated_at=excluded.activated_at`,
      )
      .bind(row.name, row.version, row.previous, row.activated_at)
      .run();
  }
}

function now() {
  return new Date().toISOString();
}

export class OperatorStore {
  expensive = 0;
  constructor(private storage: OperatorStorage) {}

  async invoke(input: {
    tool: string;
    args?: Record<string, any>;
    job_id: string;
    idempotency_key: string;
    approval?: { status?: string; job_id?: string; plan_hash?: string };
    session_id?: string;
    orchestrator?: string;
  }) {
    if (input.orchestrator && input.orchestrator !== "jobstore")
      throw new Error("Eve must not own job retries");
    if (!OPERATOR_TOOLS.includes(input.tool as OperatorTool))
      throw new Error("unknown tool");
    const token = digest({
      tool: input.tool,
      job: input.job_id,
      idk: input.idempotency_key,
    });
    const cached = await this.storage.getIdempotency(token);
    if (cached) return { ...JSON.parse(cached), replay: true };
    const job =
      (await this.storage.getJob(input.job_id)) ||
      ({
        id: input.job_id,
        state: "open",
        adapter: input.args?.adapter || "second",
        plan_hash: null,
        approval: null,
        version: null,
        created_at: now(),
        updated_at: now(),
      } satisfies JobRow);
    if (job.state === "cancelled" && input.tool === "publish")
      throw new Error("cancelled");
    if (APPROVAL_REQUIRED.includes(input.tool as OperatorTool)) {
      if (input.approval?.status !== "approved") throw new Error("approval required");
      if (input.approval.job_id !== input.job_id) throw new Error("approval job mismatch");
      if (job.approval !== "approved") throw new Error("store has no approval");
      if (input.approval.plan_hash !== job.plan_hash) throw new Error("stale plan");
    }
    job.state = "running";
    job.updated_at = now();
    await this.storage.putJob(job);
    const result = await this.execute(input.tool as OperatorTool, input.args || {}, job);
    job.state = input.tool === "request_review" ? "pending_review" : "completed";
    job.updated_at = now();
    await this.storage.putJob(job);
    const body = {
      status: "ok",
      tool: input.tool,
      job_id: input.job_id,
      session_id: input.session_id || null,
      result,
      replay: false,
      production_captions_written: this.storage.captionWrites.length > 0,
    };
    await this.storage.putIdempotency(
      token,
      input.job_id,
      input.tool,
      JSON.stringify(body),
    );
    return body;
  }

  async approve(jobId: string, planHash: string) {
    const job = await this.storage.getJob(jobId);
    if (!job) throw new Error("missing job");
    if (job.state === "cancelled") throw new Error("cancelled");
    if (job.plan_hash !== planHash) throw new Error("stale plan");
    job.approval = "approved";
    job.updated_at = now();
    await this.storage.putJob(job);
    return { status: "approved", job_id: jobId, plan_hash: planHash };
  }

  async cancel(jobId: string) {
    const job = await this.storage.getJob(jobId);
    if (!job) throw new Error("missing job");
    job.state = "cancelled";
    job.approval = null;
    job.updated_at = now();
    await this.storage.putJob(job);
    return { status: "cancelled", job_id: jobId };
  }

  async rollback(name = "operator") {
    const pointer = await this.storage.getPointer(name);
    if (!pointer?.previous) throw new Error("no prior version");
    const next: PointerRow = {
      name,
      version: pointer.previous,
      previous: pointer.version,
      activated_at: now(),
    };
    await this.storage.putPointer(next);
    return next;
  }

  private async execute(tool: OperatorTool, args: Record<string, any>, job: JobRow) {
    const records: any[] = args.records || [];
    if (tool === "inspect_source") {
      return { n: records.length, ids: records.map((r) => r.id) };
    }
    if (tool === "plan_import") {
      const plan = {
        n: records.length,
        adapter: job.adapter,
        publish: false,
        usd_per_record: 0.006,
        estimated_usd: Number((records.length * 0.006).toFixed(4)),
      };
      job.plan_hash = digest(plan);
      return { ...plan, plan_hash: job.plan_hash };
    }
    if (tool === "run_pilot") {
      this.expensive += 1;
      job.version = args.version || "idx-1";
      for (const rec of records) {
        await this.storage.putCandidate({
          id: `${job.id}:${rec.id}`,
          job_id: job.id,
          source_record_id: rec.id,
          canonical_json: JSON.stringify(rec.canonical || {}),
          candidate_json: JSON.stringify({
            image_kind: rec.image_kind || "unknown",
            ocr: rec.ocr || [],
            review_state: "generated_unreviewed",
          }),
          media_sha256: rec.media_sha256 || null,
          tombstone: rec.tombstone ? 1 : 0,
        });
      }
      await this.storage.putReceipt(
        crypto.randomUUID(),
        job.id,
        "pilot",
        JSON.stringify({ n: records.length, version: job.version }),
      );
      return { n: records.length, version: job.version, private: true };
    }
    if (tool === "validate_index") {
      const rows = await this.storage.listCandidates(job.id);
      return { n: rows.length, failed: rows.filter((r) => !r.canonical_json).length };
    }
    if (tool === "request_review") {
      job.approval = "pending";
      return { approval: "pending" };
    }
    if (tool === "publish") {
      if (this.storage.captionWrites.length)
        throw new Error("caption write attempted");
      const current = await this.storage.getPointer("operator");
      await this.storage.putPointer({
        name: "operator",
        version: job.version || args.version || "idx-1",
        previous: current?.version || null,
        activated_at: now(),
      });
      return {
        published: true,
        version: job.version,
        production: false,
        captions_written: 0,
      };
    }
    throw new Error("tool");
  }
}
