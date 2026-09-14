import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GpuController,
  MockLambdaClient,
  admit,
  compareAlternatives,
  defaultClipGapSpec,
} from "./gpu-jobs";

test("CPU and Workers AI beat GPU for the 40-image CLIP gap", () => {
  const alts = compareAlternatives("clip_gap_backfill", 40);
  assert.equal(alts.find((a) => a.id === "cpu_ingest")?.ok, true);
  assert.equal(alts.find((a) => a.id === "lambda_gpu")?.ok, false);
  const decision = admit(defaultClipGapSpec(40), false);
  assert.equal(decision.admitted, false);
  assert.equal(decision.reason, "use_cpu_or_workers_ai");
});

test("heavy vision admits only with a complete spec and stays off live Lambda", async () => {
  const spec = defaultClipGapSpec(500);
  spec.workload = "heavy_vision";
  spec.inputs.n = 500;
  const decision = admit(spec, false);
  assert.equal(decision.admitted, true);
  const lambda = new MockLambdaClient();
  const gpu = new GpuController(lambda);
  const job = gpu.create(spec, false);
  gpu.admitJob(job.id);
  const ran = await gpu.run(job.id, { live: false });
  assert.equal(ran.live, false);
  assert.equal(lambda.launches, 1);
  await assert.rejects(
    () => gpu.run(job.id, { live: true, apiKey: "x" }),
    /not admitted|owner authorization|not enabled/,
  );
});

test("live launch without Cloudflare secret or owner auth is refused", async () => {
  const spec = defaultClipGapSpec(500);
  spec.workload = "heavy_vision";
  const gpu = new GpuController(new MockLambdaClient());
  const job = gpu.create(spec, false);
  gpu.admitJob(job.id);
  await assert.rejects(() => gpu.run(job.id, { live: true }), /owner authorization/);
  const authorized = gpu.create(spec, true);
  gpu.admitJob(authorized.id);
  await assert.rejects(
    () => gpu.run(authorized.id, { live: true }),
    /LAMBDA_API_KEY missing on Cloudflare/,
  );
  await assert.rejects(
    () => gpu.run(authorized.id, { live: true, apiKey: "secret" }),
    /not enabled/,
  );
});

test("over-budget needs an owner decision", () => {
  const spec = defaultClipGapSpec(500);
  spec.workload = "heavy_vision";
  spec.budget_usd = 0.01;
  spec.max_duration_s = 3600;
  const denied = admit(spec, false);
  assert.equal(denied.admitted, false);
  assert.equal(denied.reason, "over_budget_needs_owner");
  const allowed = admit(spec, true);
  assert.equal(allowed.admitted, true);
});

test("crash sweep kills orphaned mock instances", async () => {
  const lambda = new MockLambdaClient();
  const gpu = new GpuController(lambda);
  const spec = defaultClipGapSpec(500);
  spec.workload = "heavy_vision";
  const job = gpu.create(spec, false);
  gpu.admitJob(job.id);
  await gpu.run(job.id);
  await lambda.launch(spec);
  assert.equal((await lambda.list()).length, 2);
  const sweep = await gpu.sweepOrphans();
  assert.equal(sweep.killed.length, 1);
  assert.equal(sweep.remaining, 1);
  await gpu.cancel(job.id);
  const after = await gpu.sweepOrphans();
  assert.equal(after.remaining, 0);
});

test("completion requires artifacts and metrics; resume keeps checkpoint lineage", async () => {
  const gpu = new GpuController(new MockLambdaClient());
  const spec = defaultClipGapSpec(500);
  spec.workload = "heavy_vision";
  spec.inputs.checkpoint_sha = "abc";
  const job = gpu.create(spec, false);
  gpu.admitJob(job.id);
  await gpu.run(job.id);
  gpu.checkpoint(job.id, "def");
  await assert.rejects(
    () => gpu.complete(job.id, { artifacts: [], metrics: { n: 1 }, spend_usd: 0 }),
    /artifacts and metrics/,
  );
  const done = await gpu.complete(job.id, {
    artifacts: ["r2://mtl-archives/gpu-jobs/clip-gap/out.npz"],
    metrics: { n: 40, recall: 1 },
    spend_usd: 0,
  });
  assert.equal(done.state, "completed");
  const resumed = gpu.resume(job.id);
  assert.equal(resumed.checkpoint_sha, "def");
  assert.equal(resumed.lineage.prefix, "gpu-jobs/clip-gap/");
});
