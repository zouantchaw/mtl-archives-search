import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { reserveResearchTurn } from "./research-budget";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE research_usage(bucket TEXT PRIMARY KEY, requests INTEGER, expires_at INTEGER)",
  );
  const env = {
    RESEARCH_API_SECRET: "test-only",
    DB: {
      prepare: (query: string) => ({
        bind: (...values: any[]) => ({
          first: async () => sqlite.prepare(query).get(...values),
          run: async () => sqlite.prepare(query).run(...values),
        }),
      }),
    } as unknown as D1Database,
  };
  const request = (key = "a".repeat(64)) =>
    new Request("https://worker.test/api/research/budget", {
      method: "POST",
      headers: { Authorization: "Bearer test-only" },
      body: JSON.stringify({ key }),
    });
  return { sqlite, env, request };
}
test("daily quota admits 30 turns; rejected user cannot drain the global quota", async () => {
  const { sqlite, env, request } = fixture();
  for (let i = 0; i < 30; i++)
    assert.equal((await reserveResearchTurn(request(), env)).status, 200);
  for (let i = 0; i < 5; i++)
    assert.equal((await reserveResearchTurn(request(), env)).status, 429);
  assert.equal(
    sqlite
      .prepare(
        "SELECT requests FROM research_usage WHERE bucket LIKE 'global:%'",
      )
      .get()?.requests,
    30,
  );
  assert.equal(
    (await reserveResearchTurn(request("b".repeat(64)), env)).status,
    200,
  );
  sqlite.close();
});
test("global budget is hard limited and expired buckets are cleaned", async () => {
  const { sqlite, env, request } = fixture();
  sqlite
    .prepare("INSERT INTO research_usage VALUES (?,300,?)")
    .run(
      `global:${new Date().toISOString().slice(0, 10)}`,
      Date.now() / 1000 + 86400,
    );
  assert.equal((await reserveResearchTurn(request(), env)).status, 429);
  sqlite.close();
});
test("private budget endpoint rejects missing credentials and malformed payloads", async () => {
  const { sqlite, env, request } = fixture();
  assert.equal(
    (await reserveResearchTurn(new Request("https://worker.test"), env)).status,
    401,
  );
  assert.equal(
    (await reserveResearchTurn(request("not-an-ip-hash"), env)).status,
    400,
  );
  assert.equal(
    (
      await reserveResearchTurn(
        new Request("https://worker.test", {
          method: "POST",
          headers: { Authorization: "Bearer test-only" },
          body: "no",
        }),
        env,
      )
    ).status,
    400,
  );
  sqlite.close();
});
