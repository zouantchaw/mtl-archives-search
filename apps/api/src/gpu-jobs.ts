/** Budgeted GPU jobs. Live Lambda calls require a Cloudflare Worker secret and owner authorization. */

export const GPU_SPEC_VERSION = "gpu-job-v1";
export const DEFAULT_BUDGET_USD = 8;
export const USD_PER_GPU_HOUR = 1.1; // gpu_1x_a10 class, documented estimate

export type GpuWorkload = "clip_gap_backfill" | "heavy_vision" | "other";

export type GpuSpec = {
  version: typeof GPU_SPEC_VERSION;
  workload: GpuWorkload;
  inputs: { source: string; n: number; checkpoint_sha?: string };
  runtime: { provider: "lambda"; instance_type: string; image: string };
  outputs: { bucket: string; prefix: string };
  gpu: { count: number };
  budget_usd: number;
  max_duration_s: number;
};

export type Alternative = {
  id: "workers_ai" | "cpu_ingest" | "lambda_gpu";
  ok: boolean;
  reason: string;
  estimated_usd: number;
};

export type GpuJob = {
  id: string;
  spec: GpuSpec;
  state: "draft" | "admitted" | "running" | "completed" | "cancelled" | "failed";
  instance_id: string | null;
  checkpoint_sha: string | null;
  artifacts: string[];
  metrics: Record<string, number> | null;
  spend_usd: number;
  owner_authorized: boolean;
  live: boolean;
};

export interface LambdaClient {
  launch(spec: GpuSpec): Promise<{ instance_id: string }>;
  list(): Promise<{ instance_id: string; status: string }[]>;
  terminate(instanceIds: string[]): Promise<string[]>;
}

export class MockLambdaClient implements LambdaClient {
  instances = new Map<string, string>();
  launches = 0;
  async launch(_spec: GpuSpec) {
    this.launches += 1;
    const instance_id = `mock-${this.launches}`;
    this.instances.set(instance_id, "running");
    return { instance_id };
  }
  async list() {
    return [...this.instances.entries()].map(([instance_id, status]) => ({
      instance_id,
      status,
    }));
  }
  async terminate(ids: string[]) {
    const killed: string[] = [];
    for (const id of ids) {
      if (this.instances.delete(id)) killed.push(id);
    }
    return killed;
  }
}

/** Real client. Never constructed unless LAMBDA_API_KEY is set AND live+authorized. */
export class LambdaCloudClient implements LambdaClient {
  constructor(private apiKey: string, private base = "https://cloud.lambda.ai/api/v1") {}
  private async rpc(path: string, init?: RequestInit) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`lambda ${res.status}`);
    return res.json() as Promise<any>;
  }
  async launch(spec: GpuSpec) {
    const body = await this.rpc("/instance-operations/launch", {
      method: "POST",
      body: JSON.stringify({
        instance_type_name: spec.runtime.instance_type,
        name: `mtl-${spec.workload}`,
      }),
    });
    const instance_id = body.data?.instance_ids?.[0] || body.instance_ids?.[0];
    if (!instance_id) throw new Error("lambda launch returned no id");
    return { instance_id };
  }
  async list() {
    const body = await this.rpc("/instances");
    const rows = body.data || body;
    return (Array.isArray(rows) ? rows : []).map((row: any) => ({
      instance_id: row.id || row.instance_id,
      status: row.status,
    }));
  }
  async terminate(instanceIds: string[]) {
    await this.rpc("/instance-operations/terminate", {
      method: "POST",
      body: JSON.stringify({ instance_ids: instanceIds }),
    });
    return instanceIds;
  }
}

export function compareAlternatives(workload: GpuWorkload, n: number): Alternative[] {
  const clipCpu = {
    id: "cpu_ingest" as const,
    ok: workload === "clip_gap_backfill" && n <= 200,
    reason: "Existing CLIP ingest on CPU/hosted Workers already covers small backfills.",
    estimated_usd: 0,
  };
  const workersAi = {
    id: "workers_ai" as const,
    ok: workload !== "heavy_vision",
    reason: "Workers AI / AI Gateway already runs cheap inspect and GPT-5.4 fallback.",
    estimated_usd: Number((n * 0.006).toFixed(4)),
  };
  const hours = Math.max(0.25, n / 400);
  const gpu = {
    id: "lambda_gpu" as const,
    ok: workload === "heavy_vision" || (workload === "clip_gap_backfill" && n > 200),
    reason: "GPU only when CPU/Workers AI cannot finish the bounded workload.",
    estimated_usd: Number((hours * USD_PER_GPU_HOUR).toFixed(4)),
  };
  return [clipCpu, workersAi, gpu];
}

export function estimateSpec(spec: GpuSpec) {
  const hours = spec.max_duration_s / 3600;
  return Number((hours * USD_PER_GPU_HOUR * spec.gpu.count).toFixed(4));
}

export function admit(spec: GpuSpec, ownerAuthorized: boolean) {
  if (spec.version !== GPU_SPEC_VERSION) throw new Error("spec version");
  if (!spec.inputs?.source || !spec.runtime?.instance_type) throw new Error("spec fields");
  if (spec.max_duration_s <= 0 || spec.budget_usd <= 0) throw new Error("budget");
  const estimated_usd = estimateSpec(spec);
  const alts = compareAlternatives(spec.workload, spec.inputs.n);
  const cheaper = alts.find((a) => a.ok && a.id !== "lambda_gpu");
  if (cheaper) {
    return {
      admitted: false,
      reason: "use_cpu_or_workers_ai",
      alternative: cheaper.id,
      estimated_usd,
    };
  }
  if (estimated_usd > spec.budget_usd) {
    if (!ownerAuthorized) {
      return {
        admitted: false,
        reason: "over_budget_needs_owner",
        estimated_usd,
      };
    }
  }
  return { admitted: true, estimated_usd, reason: "admitted" };
}

export class GpuController {
  jobs = new Map<string, GpuJob>();
  constructor(private lambda: LambdaClient) {}

  create(spec: GpuSpec, ownerAuthorized = false): GpuJob {
    const job: GpuJob = {
      id: crypto.randomUUID(),
      spec,
      state: "draft",
      instance_id: null,
      checkpoint_sha: spec.inputs.checkpoint_sha || null,
      artifacts: [],
      metrics: null,
      spend_usd: 0,
      owner_authorized: ownerAuthorized,
      live: false,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  admitJob(id: string) {
    const job = this.require(id);
    const decision = admit(job.spec, job.owner_authorized);
    if (!decision.admitted) return { ...decision, job_id: id };
    job.state = "admitted";
    return { ...decision, job_id: id };
  }

  async run(id: string, opts: { live?: boolean; apiKey?: string } = {}) {
    const job = this.require(id);
    if (job.state !== "admitted") throw new Error("not admitted");
    if (opts.live) {
      if (!job.owner_authorized) throw new Error("owner authorization required");
      if (!opts.apiKey) throw new Error("LAMBDA_API_KEY missing on Cloudflare");
      throw new Error("live GPU run is not enabled in this deploy");
    }
    const launched = await this.lambda.launch(job.spec);
    job.instance_id = launched.instance_id;
    job.state = "running";
    job.live = false;
    return { job_id: id, instance_id: job.instance_id, live: false };
  }

  checkpoint(id: string, sha: string) {
    const job = this.require(id);
    job.checkpoint_sha = sha;
    return { job_id: id, checkpoint_sha: sha };
  }

  async complete(
    id: string,
    payload: { artifacts: string[]; metrics: Record<string, number>; spend_usd: number },
  ) {
    const job = this.require(id);
    if (!payload.artifacts?.length || !payload.metrics) {
      throw new Error("completion requires artifacts and metrics");
    }
    if (job.instance_id) await this.lambda.terminate([job.instance_id]);
    job.instance_id = null;
    job.artifacts = payload.artifacts;
    job.metrics = payload.metrics;
    job.spend_usd = payload.spend_usd;
    job.state = "completed";
    return { job_id: id, state: job.state, spend_usd: job.spend_usd };
  }

  async cancel(id: string) {
    const job = this.require(id);
    if (job.instance_id) await this.lambda.terminate([job.instance_id]);
    job.instance_id = null;
    job.state = "cancelled";
    return { job_id: id, state: job.state };
  }

  /** Agent crash / timeout / lost callback: kill instances not owned by a running job. */
  async sweepOrphans() {
    const live = await this.lambda.list();
    const owned = new Set(
      [...this.jobs.values()]
        .filter((j) => j.state === "running" && j.instance_id)
        .map((j) => j.instance_id as string),
    );
    const orphans = live.map((i) => i.instance_id).filter((id) => !owned.has(id));
    const killed = orphans.length ? await this.lambda.terminate(orphans) : [];
    return { killed, remaining: (await this.lambda.list()).length };
  }

  resume(id: string) {
    const job = this.require(id);
    if (!job.checkpoint_sha) throw new Error("no checkpoint");
    return {
      job_id: id,
      checkpoint_sha: job.checkpoint_sha,
      lineage: job.spec.outputs,
    };
  }

  private require(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("missing gpu job");
    return job;
  }
}

export async function handleGpu(
  request: Request,
  env: { LAMBDA_API_KEY?: string; RESEARCH_API_SECRET?: string },
  pathname: string,
) {
  if (
    !env.RESEARCH_API_SECRET ||
    request.headers.get("Authorization") !== `Bearer ${env.RESEARCH_API_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = request.method === "POST" ? await request.json<any>() : {};
  if (pathname.endsWith("/compare")) {
    return Response.json({
      alternatives: compareAlternatives(body.workload || "clip_gap_backfill", body.n || 40),
      live_key_present: Boolean(env.LAMBDA_API_KEY),
    });
  }
  if (pathname.endsWith("/admit")) {
    return Response.json(admit(body.spec || defaultClipGapSpec(), Boolean(body.owner_authorized)));
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}

export function defaultClipGapSpec(n = 40): GpuSpec {
  return {
    version: GPU_SPEC_VERSION,
    workload: "clip_gap_backfill",
    inputs: { source: "r2://mtl-archives/canonical", n },
    runtime: {
      provider: "lambda",
      instance_type: "gpu_1x_a10",
      image: "lambda-stack",
    },
    outputs: { bucket: "mtl-archives", prefix: "gpu-jobs/clip-gap/" },
    gpu: { count: 1 },
    budget_usd: DEFAULT_BUDGET_USD,
    max_duration_s: 1800,
  };
}
