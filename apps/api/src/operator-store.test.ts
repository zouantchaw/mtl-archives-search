import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryOperatorStorage, OperatorStore } from "./operator-store";
import { operatorInference, resolveOperatorModel } from "./operator-inference";
import { OPERATOR_MODEL } from "./operator-store";

const records = [
  {
    id: "second:bss-1",
    canonical: { description: "Library hall", attribution: "CC BY 4.0" },
    image_kind: "photograph",
    ocr: [],
  },
];

test("jobs persist outside the Eve session and publish never writes captions", async () => {
  const storage = new MemoryOperatorStorage();
  const store = new OperatorStore(storage);
  const job = "job-1";
  await store.invoke({
    tool: "inspect_source",
    args: { records },
    job_id: job,
    idempotency_key: "i",
    session_id: "eve-a",
  });
  const plan = await store.invoke({
    tool: "plan_import",
    args: { records },
    job_id: job,
    idempotency_key: "p",
  });
  await store.invoke({
    tool: "run_pilot",
    args: { records, version: "idx-1" },
    job_id: job,
    idempotency_key: "r",
  });
  await store.invoke({
    tool: "request_review",
    args: {},
    job_id: job,
    idempotency_key: "v",
  });
  await assert.rejects(
    () =>
      store.invoke({
        tool: "publish",
        args: {},
        job_id: job,
        idempotency_key: "pub",
      }),
    /approval required/,
  );
  await store.approve(job, plan.result.plan_hash);
  const published = await store.invoke({
    tool: "publish",
    args: {},
    job_id: job,
    idempotency_key: "pub",
    approval: {
      status: "approved",
      job_id: job,
      plan_hash: plan.result.plan_hash,
    },
  });
  assert.equal(published.result.captions_written, 0);
  assert.equal(storage.captionWrites.length, 0);
  assert.equal((await storage.getPointer("operator"))?.version, "idx-1");
  const replay = await store.invoke({
    tool: "run_pilot",
    args: { records, version: "idx-1" },
    job_id: job,
    idempotency_key: "r",
    session_id: "eve-b",
  });
  assert.equal(replay.replay, true);
  assert.equal(store.expensive, 1);
});

test("cancelled and competing orchestrators cannot publish", async () => {
  const store = new OperatorStore(new MemoryOperatorStorage());
  await store.invoke({
    tool: "plan_import",
    args: { records },
    job_id: "job-2",
    idempotency_key: "p",
  });
  await store.cancel("job-2");
  await assert.rejects(
    () =>
      store.invoke({
        tool: "publish",
        args: {},
        job_id: "job-2",
        idempotency_key: "pub",
        approval: { status: "approved", job_id: "job-2", plan_hash: "x" },
      }),
    /cancelled/,
  );
  await assert.rejects(
    () =>
      store.invoke({
        tool: "inspect_source",
        args: { records },
        job_id: "job-3",
        idempotency_key: "x",
        orchestrator: "eve-workflow",
      }),
    /Eve must not own job retries/,
  );
});

test("operator inference always uses AI Gateway and allowlists GPT-5.4", async () => {
  assert.equal(resolveOperatorModel("mistral"), OPERATOR_MODEL);
  let call: any;
  const env = {
    RESEARCH_API_SECRET: "private-test",
    RESEARCH_AI_GATEWAY_ID: "default",
    AI: {
      run: async (model: string, input: unknown, options?: unknown) => {
        call = { model, input, options };
        return { choices: [{ message: { role: "assistant", content: "ok" } }] };
      },
    } as unknown as Ai,
  };
  const result = await operatorInference(
    new Request("https://worker.test/api/operator/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer private-test" },
      body: JSON.stringify({
        model: "not-allowed",
        messages: [{ role: "user", content: "Plan a second-source import." }],
        max_tokens: 200,
      }),
    }),
    env,
  );
  assert.equal(result.status, 200);
  assert.equal(call.model, OPERATOR_MODEL);
  assert.equal(call.options.gateway.id, "default");
  assert.equal(call.options.gateway.skipCache, true);
  assert.equal(call.options.metadata.feature, "operator-agent");
  assert.equal(call.input.max_completion_tokens, 200);
});

test("rollback keeps the prior pointer", async () => {
  const storage = new MemoryOperatorStorage();
  const store = new OperatorStore(storage);
  const job = "job-4";
  const plan = await store.invoke({
    tool: "plan_import",
    args: { records },
    job_id: job,
    idempotency_key: "p",
  });
  await store.invoke({
    tool: "run_pilot",
    args: { records, version: "idx-1" },
    job_id: job,
    idempotency_key: "r1",
  });
  await store.approve(job, plan.result.plan_hash);
  await store.invoke({
    tool: "publish",
    args: {},
    job_id: job,
    idempotency_key: "pub1",
    approval: {
      status: "approved",
      job_id: job,
      plan_hash: plan.result.plan_hash,
    },
  });
  await store.invoke({
    tool: "run_pilot",
    args: { records, version: "idx-2" },
    job_id: job,
    idempotency_key: "r2",
  });
  const jobRow = await storage.getJob(job);
  assert.equal(jobRow?.version, "idx-2");
  await store.invoke({
    tool: "publish",
    args: {},
    job_id: job,
    idempotency_key: "pub2",
    approval: {
      status: "approved",
      job_id: job,
      plan_hash: plan.result.plan_hash,
    },
  });
  const rolled = await store.rollback();
  assert.equal(rolled.version, "idx-1");
  assert.equal(rolled.previous, "idx-2");
});
