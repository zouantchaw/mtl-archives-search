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
import { initialImage, validate } from "../src/validation";
import { authenticate } from "../src/auth";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const migration = readFileSync("migrations/0001.sql", "utf8");
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
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
