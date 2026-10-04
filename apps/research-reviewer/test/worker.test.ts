import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, {
  handleAuthenticated,
  scope,
  ids,
  type Env,
} from "../src/index";
import {
  runHelp,
  cropPixels,
  MODEL,
  PROMPT_VERSION,
  unreliableAnswer,
} from "../src/assistance";
import { sha } from "../src/auth";
import {
  TEXT_MODEL,
  TEXT_PROMPT_VERSION,
  SECOND_READER,
  textRegions,
  parseTextEvidence,
} from "../src/text-evidence";
import { pointInImage, rectBetween } from "../client/inspection";
import { initialImage, validate } from "../src/validation";
import { authenticate } from "../src/auth";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const migration = readFileSync("migrations/0001.sql", "utf8");
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  db.exec(readFileSync("migrations/0002_assistance.sql", "utf8"));
  db.exec(readFileSync("migrations/0003_external_guidance.sql", "utf8"));
  const binding = {
    prepare(sql: string) {
      return {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          this.values = values;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...(this.values as never[])) ?? null;
        },
        async run() {
          return {
            success: true,
            meta: db.prepare(sql).run(...(this.values as never[])),
          };
        },
        async all() {
          return { results: db.prepare(sql).all(...(this.values as never[])) };
        },
      };
    },
  };
  let reads = 0;
  const bucket = {
    async get() {
      reads++;
      return null;
    },
  };
  const env = {
    REVIEW_DB: binding,
    SOURCES: bucket,
    DERIVED: bucket,
    HELP_ARTIFACTS: bucket,
    HELP_QUEUE: { async send() {} },
    AI_GATEWAY_ID: "synthetic-test-gateway",
    ASSETS: {
      async fetch() {
        return new Response("<main>review</main>");
      },
    },
    ACCESS_ISSUER: "https://wiel-agent-first.cloudflareaccess.com",
    ACCESS_AUD: "test-audience",
  } as unknown as Env;
  return { db, env, reads: () => reads };
}
const actor = { id: "test-reviewer", email: "qa@example.invalid" };
const image = {
  ...initialImage(),
  type: "aerial",
  usable: "yes",
  text: "no",
  seconds: 7,
};
test("Access identity requires a valid signature, issuer, audience and expiry", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
  const env = {
    ACCESS_ISSUER: "https://auth-qa.cloudflareaccess.com",
    ACCESS_AUD: "correct-audience",
  };
  try {
    const token = await new SignJWT({ email: "qa@example.invalid" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("synthetic-qa")
      .setIssuer(env.ACCESS_ISSUER)
      .setAudience(env.ACCESS_AUD)
      .setExpirationTime("2m")
      .sign(privateKey);
    const req = new Request("https://review.example", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    assert.match((await authenticate(req, env)).id, /^[a-f0-9]{64}$/);
    await assert.rejects(() =>
      authenticate(req, { ...env, ACCESS_AUD: "wrong" }),
    );
    await assert.rejects(() =>
      authenticate(
        new Request("https://review.example", {
          headers: { "Cf-Access-Jwt-Assertion": token.slice(0, -8) + "bad" },
        }),
        env,
      ),
    );
    const expired = await new SignJWT({ email: "qa@example.invalid" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("synthetic-qa")
      .setIssuer(env.ACCESS_ISSUER)
      .setAudience(env.ACCESS_AUD)
      .setExpirationTime(1)
      .sign(privateKey);
    await assert.rejects(() =>
      authenticate(
        new Request("https://review.example", {
          headers: { "Cf-Access-Jwt-Assertion": expired },
        }),
        env,
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});
function request(body: unknown, origin = "https://review.example") {
  return new Request("https://review.example/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
function body(
  payload: unknown = image,
  expectedRevision = 0,
  key = "001",
  kind = "image",
  saveId = crypto.randomUUID(),
) {
  return { snapshot: scope, kind, key, payload, expectedRevision, saveId };
}
test("authentication fails closed for app, API and image bytes", async () => {
  const s = setup();
  for (const p of ["/", "/api/state", "/api/media/001/full"])
    assert.equal(
      (await worker.fetch(new Request("https://review.example" + p), s.env))
        .status,
      401,
    );
  assert.equal(s.reads(), 0);
  s.db.close();
});
test("required choices and uncertainty cannot become invented human decisions", () => {
  assert.throws(() => validate("image", "001", initialImage(), ids));
  assert.throws(() =>
    validate("image", "001", { ...image, usable: "unsure" }, ids),
  );
  assert.throws(() => validate("image", "999", image, ids));
  assert.throws(() =>
    validate("image", "001", { ...image, rotation: 45 }, ids),
  );
});
test("save history is append-only, versioned, idempotent and conflict checked", async () => {
  const s = setup(),
    b = body();
  assert.equal(
    (await handleAuthenticated(request(b), s.env, actor)).status,
    200,
  );
  assert.equal(
    (await handleAuthenticated(request(b), s.env, actor)).status,
    200,
  );
  assert.equal(
    s.db.prepare("SELECT count(*) n FROM review_revision").get()!.n,
    1,
  );
  assert.equal(
    (
      await handleAuthenticated(
        request(body({ ...image, note: "edited" })),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await handleAuthenticated(
        request(body({ ...image, note: "edited" }, 1)),
        s.env,
        actor,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handleAuthenticated(
        request({ ...b, payload: { ...image, note: "different" } }),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  assert.throws(
    () => s.db.exec("UPDATE review_revision SET revision=99"),
    /immutable/,
  );
  assert.throws(() => s.db.exec("DELETE FROM review_revision"), /immutable/);
  s.db.close();
});
test("two simultaneous writers cannot overwrite each other", async () => {
  const s = setup();
  const results = await Promise.all([
    handleAuthenticated(request(body()), s.env, actor),
    handleAuthenticated(
      request(body({ ...image, note: "another tab" })),
      s.env,
      actor,
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    s.db.prepare("SELECT count(*) n FROM review_revision").get()!.n,
    1,
  );
  s.db.close();
});
test("cross-origin and cross-snapshot writes are rejected", async () => {
  const s = setup();
  assert.equal(
    (
      await handleAuthenticated(
        request(body(), "https://other.example"),
        s.env,
        actor,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleAuthenticated(
        request({ ...body(), snapshot: "wrong" }),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  assert.equal(
    s.db.prepare("SELECT count(*) n FROM review_revision").get()!.n,
    0,
  );
  s.db.close();
});
test("family groups reject overlaps, outsiders and nonmember representatives", () => {
  const a = {
      id: "a",
      name: "scene",
      members: ["001", "002"],
      representative: "001",
      note: "",
    },
    f = { groups: [a], complete: false, singletonDeclaration: false };
  assert.throws(() =>
    validate(
      "families",
      "corpus",
      { ...f, groups: [a, { ...a, id: "b" }] },
      ids,
    ),
  );
  assert.throws(() =>
    validate(
      "families",
      "corpus",
      { ...f, groups: [{ ...a, representative: "003" }] },
      ids,
    ),
  );
  assert.throws(() =>
    validate("families", "corpus", { ...f, complete: true }, ids),
  );
});
test("queries require a completed corpus review and retain its revision", async () => {
  const s = setup();
  const q = {
    fr: "Une rivière",
    en: "A river",
    criterion: "Water is visible.",
    cluster: "",
    note: "",
    equivalence: "pending",
    bilingualReviewer: "",
    authorDeclaration: true,
  };
  const f = { groups: [], complete: true, singletonDeclaration: true };
  assert.equal(
    (
      await handleAuthenticated(
        request(body(f, 0, "corpus", "families")),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await handleAuthenticated(
        request(body(q, 0, "dev-01", "query")),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  for (const id of ids)
    await handleAuthenticated(request(body(image, 0, id)), s.env, actor);
  assert.equal(
    (
      await handleAuthenticated(
        request(body(f, 0, "corpus", "families")),
        s.env,
        actor,
      )
    ).status,
    200,
  );
  const result = await handleAuthenticated(
    request(body(q, 0, "dev-01", "query")),
    s.env,
    actor,
  );
  assert.equal(result.status, 200);
  assert.equal(
    (
      (await result.json()) as {
        review: { payload: { corpusReviewRevision: number } };
      }
    ).review.payload.corpusReviewRevision,
    1,
  );
  await handleAuthenticated(
    request(body({ ...f, complete: false }, 1, "corpus", "families")),
    s.env,
    actor,
  );
  assert.equal(
    (
      await handleAuthenticated(
        request(body(q, 1, "dev-01", "query")),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  s.db.close();
});
test("state is blinded and reviewers cannot see each other’s judgments", async () => {
  const s = setup();
  await handleAuthenticated(request(body()), s.env, actor);
  const state = (await (
    await handleAuthenticated(
      new Request("https://review.example/api/state"),
      s.env,
      { id: "someone-else", email: "other@example.invalid" },
    )
  ).json()) as { reviews: unknown[]; items: unknown[] };
  assert.deepEqual(state.reviews, []);
  assert.deepEqual(state.items[0], { id: "001" });
  assert.doesNotMatch(
    JSON.stringify(state.items),
    /caption|title|record_id|description|source_url/,
  );
  s.db.close();
});
test("only allowlisted image refs can be read", async () => {
  const s = setup();
  assert.equal(
    (
      await handleAuthenticated(
        new Request("https://review.example/api/media/999/full"),
        s.env,
        actor,
      )
    ).status,
    404,
  );
  assert.equal(s.reads(), 0);
  assert.equal(
    (
      await handleAuthenticated(
        new Request("https://review.example/api/media/001/preview"),
        s.env,
        actor,
      )
    ).status,
    404,
  );
  assert.equal(s.reads(), 1);
  s.db.close();
});
test("export binds history to exact inputs and preserves pending quality status", async () => {
  const s = setup();
  await handleAuthenticated(request(body()), s.env, actor);
  await handleAuthenticated(
    request(body({ ...image, note: "new" }, 1)),
    s.env,
    actor,
  );
  const out = (await (
    await handleAuthenticated(
      new Request("https://review.example/api/export"),
      s.env,
      actor,
    )
  ).json()) as {
    snapshot: string;
    benchmarkEligible: boolean;
    referenceStatus: string;
    history: unknown[];
    latest: unknown[];
    items: unknown[];
  };
  assert.equal(out.snapshot, scope);
  assert.equal(out.referenceStatus, "pending_quality_review");
  assert.equal(out.benchmarkEligible, false);
  assert.equal(out.history.length, 2);
  assert.equal(out.latest.length, 1);
  assert.equal(out.items.length, 100);
  s.db.close();
});

function helpRequest(
  x: Record<string, unknown> = {},
  path = "/api/help",
  origin = "https://review.example",
) {
  return new Request("https://review.example" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      snapshot: scope,
      requestId: crypto.randomUUID(),
      imageId: "003",
      kind: "text",
      reader: "primary",
      rotation: 0,
      rect: { x: 0, y: 8500, w: 1400, h: 1500 },
      ...x,
    }),
  });
}
test("assistance rejects wrong origin, snapshot, region and outside images before queueing", async () => {
  const s = setup();
  let sent = 0;
  s.env.HELP_QUEUE = {
    async send() {
      sent++;
    },
  } as any;
  for (const req of [
    helpRequest({}, "/api/help", "https://other.example"),
    helpRequest({ snapshot: "other" }),
    helpRequest({ imageId: "999" }),
    helpRequest({ rect: { x: 9999, y: 0, w: 100, h: 100 } }),
    helpRequest({ rotation: 45 }),
    helpRequest({ kind: "query" }),
  ])
    assert.ok((await handleAuthenticated(req, s.env, actor)).status >= 400);
  assert.equal(sent, 0);
  s.db.close();
});
test("same help request is replayed without a second queue delivery; foreign results are private", async () => {
  const s = setup();
  let sent = 0;
  s.env.HELP_QUEUE = {
    async send() {
      sent++;
    },
  } as any;
  const requestId = crypto.randomUUID();
  const a = await handleAuthenticated(helpRequest({ requestId }), s.env, actor);
  assert.equal(a.status, 202);
  const b = await handleAuthenticated(helpRequest({ requestId }), s.env, actor);
  assert.equal(b.status, 200);
  const c = await handleAuthenticated(helpRequest(), s.env, actor);
  assert.equal(c.status, 200);
  assert.equal(sent, 1);
  for (const suffix of ["", "/input"]) {
    const r = await handleAuthenticated(
      new Request(`https://review.example/api/help/${requestId}${suffix}`),
      s.env,
      { ...actor, id: "foreign" },
    );
    assert.equal(r.status, 404);
  }
  assert.equal(
    (
      await handleAuthenticated(
        helpRequest({ requestId, rotation: 90 }),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  s.db.close();
});
test("queue, model failure and quotas never change human reviews", async () => {
  const s = setup();
  await handleAuthenticated(request(body()), s.env, actor);
  const before = s.db.prepare("SELECT * FROM review_revision").all();
  s.env.HELP_QUEUE = {
    async send() {
      throw Error("network");
    },
  } as any;
  assert.equal(
    (await handleAuthenticated(helpRequest(), s.env, actor)).status,
    503,
  );
  s.env.HELP_QUEUE = { async send() {} } as any;
  for (let i = 1; i < 40; i++) {
    const r = await handleAuthenticated(
      helpRequest({
        rotation: (i % 4) * 90,
        rect: { x: i * 100, y: 8500, w: 1400, h: 1500 },
      }),
      s.env,
      actor,
    );
    assert.equal(r.status, 202);
    s.db.exec("UPDATE assistance_run SET status='failed'");
  }
  assert.equal(
    (await handleAuthenticated(helpRequest({ rotation: 270 }), s.env, actor))
      .status,
    429,
  );
  assert.deepEqual(s.db.prepare("SELECT * FROM review_revision").all(), before);
  s.db.close();
});
test("completed model output is retained, delivered exposure follows saving, and decisions are append-only", async () => {
  const s = setup();
  const bytes = new TextEncoder().encode("synthetic image input").buffer;
  const digest = await sha(bytes);
  let calls = 0,
    puts = 0;
  s.env.HELP_ARTIFACTS = {
    async get(key: string) {
      return key.startsWith("views/")
        ? {
            size: bytes.byteLength,
            customMetadata: { sha256: digest },
            arrayBuffer: async () => bytes,
          }
        : null;
    },
    async put() {
      puts++;
    },
  } as any;
  s.env.AI = {
    async run(model: any, input: any, options: any) {
      calls++;
      assert.equal(model, TEXT_MODEL);
      assert.equal(input.max_tokens, 500);
      assert.equal(input.messages[0].content[1].image_url.detail, "high");
      assert.equal(options.gateway.collectLog, false);
      return {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                status: "text_candidates",
                candidates: [
                  {
                    text: "13-?1",
                    location: "left margin",
                    kind: "annotation",
                    uncertain: true,
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 7 },
      };
    },
  } as any;
  const reqId = crypto.randomUUID();
  await handleAuthenticated(helpRequest({ requestId: reqId }), s.env, actor);
  await runHelp(s.env, reqId);
  await runHelp(s.env, reqId);
  assert.equal(calls, 1);
  assert.equal(puts, 2); // Exact input bytes plus the raw model output.
  let out: any = await (
    await handleAuthenticated(
      new Request("https://review.example/api/export"),
      s.env,
      actor,
    )
  ).json();
  assert.equal(out.aiAssistance, false);
  const fetched = await handleAuthenticated(
    new Request("https://review.example/api/help/" + reqId),
    s.env,
    actor,
  );
  assert.equal(fetched.status, 200);
  await handleAuthenticated(request(body(image, 0, "003")), s.env, actor);
  out = await (
    await handleAuthenticated(
      new Request("https://review.example/api/export"),
      s.env,
      actor,
    )
  ).json();
  assert.equal(out.schema, "mtl-research-review-export-v2");
  assert.equal(out.aiAssistance, true);
  assert.match(
    out.assistance.runs[0].inputKey,
    /^inputs\/sha256\/[a-f0-9]{64}\.jpg$/,
  );
  assert.equal(out.benchmarkEligible, false);
  assert.deepEqual(out.latest[0].payload.reviewerAssistance.runIds, [reqId]);
  assert.equal(out.assistance.runs[0].promptVersion, TEXT_PROMPT_VERSION);
  const event = {
    eventId: crypto.randomUUID(),
    runId: reqId,
    action: "dismissed",
    reason: "Text seems incorrect",
  };
  assert.equal(
    (
      await handleAuthenticated(
        helpRequest(event, "/api/help/events"),
        s.env,
        actor,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handleAuthenticated(
        helpRequest(event, "/api/help/events"),
        s.env,
        actor,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handleAuthenticated(
        helpRequest({ ...event, reason: "different" }, "/api/help/events"),
        s.env,
        actor,
      )
    ).status,
    409,
  );
  assert.throws(
    () => s.db.exec("UPDATE assistance_event SET action='accepted_note'"),
    /immutable/,
  );
  assert.throws(
    () => s.db.exec("UPDATE assistance_run SET model='different'"),
    /immutable/,
  );
  s.db.close();
});
test("rotated selections map to source coordinates; crops include right/bottom edges", () => {
  const p = pointInImage(50, -100, 200, 100, 270);
  assert.ok(Math.abs(p.x - 1) < 1e-8);
  assert.ok(Math.abs(p.y - 1) < 1e-8);
  assert.deepEqual(rectBetween({ x: -1, y: 0.85 }, { x: 0.14, y: 2 }), {
    x: 0,
    y: 8500,
    w: 1400,
    h: 1500,
  });
  assert.deepEqual(
    cropPixels({ x: 7500, y: 7500, w: 2500, h: 2500 }, 101, 103),
    { left: 75, top: 77, width: 26, height: 26 },
  );
});

test("truncated or repetitive model text is retained as failure, never adopted as a review", async () => {
  assert.equal(unreliableAnswer("unclear " + "[?] ".repeat(9)), true);
  assert.equal(unreliableAnswer("plausible but truncated", {}, "length"), true);
  const s = setup();
  const bytes = new TextEncoder().encode("synthetic input").buffer,
    digest = await sha(bytes);
  let outputs = 0;
  s.env.HELP_ARTIFACTS = {
    async get(key: string) {
      return key.startsWith("views/")
        ? { customMetadata: { sha256: digest }, arrayBuffer: async () => bytes }
        : null;
    },
    async put() {
      outputs++;
    },
  } as any;
  s.env.AI = {
    async run() {
      return {
        choices: [
          { finish_reason: "length", message: { content: "[?] ".repeat(20) } },
        ],
        usage: { completion_tokens: 500 },
      };
    },
  } as any;
  const id = crypto.randomUUID();
  await handleAuthenticated(helpRequest({ requestId: id }), s.env, actor);
  await runHelp(s.env, id);
  const run: any = await (
    await handleAuthenticated(
      new Request("https://review.example/api/help/" + id),
      s.env,
      actor,
    )
  ).json();
  assert.equal(run.run.status, "failed");
  assert.match(run.run.error, /smaller area/);
  assert.equal(outputs, 2); // Failed raw response and exact input both remain.
  assert.equal(
    s.db.prepare("SELECT count(*) n FROM review_revision").get()!.n,
    0,
  );
  assert.equal(
    s.db.prepare("SELECT count(*) n FROM assistance_event").get()!.n,
    0,
  );
  s.db.close();
});

test("known conversation guidance is scoped and truthful without rewriting legacy reviews", async () => {
  const s = setup();
  await handleAuthenticated(request(body()), s.env, actor);
  const original = s.db.prepare("SELECT * FROM review_revision").all();
  const evidence = {
    kind: "assistant_conversation_guidance",
    sampleIds: ["001", "002", "003", "004", "005"],
    sourceReceiptSha256: "a".repeat(64),
    sourceReceiptKey: "calibration/" + "a".repeat(64) + ".json",
  };
  s.db
    .prepare("INSERT INTO external_guidance VALUES(?,?,?,?,?)")
    .run(
      "synthetic-guidance-evidence",
      scope,
      actor.id,
      JSON.stringify(evidence),
      new Date().toISOString(),
    );
  const out: any = await (
    await handleAuthenticated(
      new Request("https://review.example/api/export"),
      s.env,
      actor,
    )
  ).json();
  assert.equal(out.aiAssistance, true);
  assert.equal(out.assistance.runs.length, 0);
  assert.equal(out.assistance.externalGuidance.length, 1);
  const other: any = await (
    await handleAuthenticated(
      new Request("https://review.example/api/export"),
      s.env,
      { ...actor, id: "foreign" },
    )
  ).json();
  assert.equal(other.aiAssistance, false);
  assert.equal(other.assistance.externalGuidance.length, 0);
  assert.deepEqual(
    s.db.prepare("SELECT * FROM review_revision").all(),
    original,
  );
  assert.throws(
    () => s.db.exec("UPDATE external_guidance SET actor='foreign'"),
    /immutable/,
  );
  s.db.close();
});

test("text coverage includes every source pixel and unknown writing cannot become absence", () => {
  for (let y = 0; y <= 10000; y += 100)
    for (let x = 0; x <= 10000; x += 100)
      assert.ok(
        textRegions.some(
          (t) =>
            x >= t.rect.x &&
            x <= t.rect.x + t.rect.w &&
            y >= t.rect.y &&
            y <= t.rect.y + t.rect.h,
        ),
      );
  assert.equal(
    parseTextEvidence(
      '```json\n{"status":"none_detected","candidates":[]}\n```',
    ).status,
    "none_detected",
  );
  assert.throws(() =>
    parseTextEvidence(
      '{"status":"none_detected","candidates":[{"text":"28","location":"left","kind":"scene","uncertain":false}]}',
    ),
  );
  assert.throws(() =>
    parseTextEvidence('{"status":"text_candidates","candidates":[]}'),
  );
  assert.throws(
    () =>
      validate(
        "image",
        "003",
        {
          ...image,
          inspection: {
            planVersion: "overlap-grid-v1",
            checkedRegions: [],
            noTextConfirmed: false,
          },
        },
        ids,
      ),
    /Confirm/,
  );
  const reviewed = validate(
    "image",
    "003",
    {
      ...image,
      inspection: {
        planVersion: "overlap-grid-v1",
        checkedRegions: ["Bottom left"],
        noTextConfirmed: true,
      },
    },
    ids,
  ) as any;
  assert.equal(reviewed.text, "no");
  assert.deepEqual(reviewed.inspection.checkedRegions, ["Bottom left"]);
});
test("text readers keep separate provenance and the legacy caption recipe remains reproducible", async () => {
  const s = setup();
  const primary = crypto.randomUUID(),
    second = crypto.randomUUID();
  await handleAuthenticated(helpRequest({ requestId: primary }), s.env, actor);
  await handleAuthenticated(
    helpRequest({ requestId: second, reader: "second" }),
    s.env,
    actor,
  );
  const a = s.db
    .prepare("SELECT model,request_hash FROM assistance_run WHERE id=?")
    .get(primary) as any;
  const b = s.db
    .prepare("SELECT model,request_hash FROM assistance_run WHERE id=?")
    .get(second) as any;
  const legacy=crypto.randomUUID();
  await handleAuthenticated(helpRequest({requestId:legacy,reader:undefined}),s.env,actor);
  const old=s.db.prepare("SELECT model,prompt_version FROM assistance_run WHERE id=?").get(legacy) as any;
  assert.equal(old.model,MODEL);assert.equal(old.prompt_version,PROMPT_VERSION);
  assert.equal(a.model, TEXT_MODEL);
  assert.equal(b.model, SECOND_READER);
  assert.notEqual(a.request_hash, b.request_hash);
  assert.equal(
    (
      await handleAuthenticated(
        helpRequest({ reader: "unknown" }),
        s.env,
        actor,
      )
    ).status,
    400,
  );
  s.db.close();
});
