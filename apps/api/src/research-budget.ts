export async function reserveResearchTurn(
  request: Request,
  env: { DB: D1Database; RESEARCH_API_SECRET?: string },
) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (
    !env.RESEARCH_API_SECRET ||
    request.headers.get("Authorization") !== `Bearer ${env.RESEARCH_API_SECRET}`
  )
    return json({ error: "Unauthorized" }, 401);
  let body: { key?: unknown };
  try {
    body = (await request.json()) as { key?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object")
    return json({ error: "Invalid key" }, 400);
  if (typeof body.key !== "string" || !/^[a-f0-9]{64}$/.test(body.key))
    return json({ error: "Invalid key" }, 400);
  const day = new Date().toISOString().slice(0, 10),
    expiry = Math.floor(Date.now() / 1000) + 172800;
  // Atomic conditional UPSERTs. A blocked user cannot consume the shared quota.
  const reserve = async (bucket: string, limit: number) =>
    env.DB.prepare(
      "INSERT INTO research_usage (bucket, requests, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 WHERE requests < ? RETURNING requests",
    )
      .bind(bucket, expiry, limit)
      .first();
  if (!(await reserve(`${body.key}:${day}`, 30)))
    return json(
      {
        error:
          "You have reached today’s 30-message limit. Please return tomorrow.",
      },
      429,
    );
  if (!(await reserve(`global:${day}`, 300)))
    return json(
      {
        error:
          "The reading room has reached its daily limit. Please return tomorrow.",
      },
      429,
    );
  await env.DB.prepare("DELETE FROM research_usage WHERE expires_at < ?")
    .bind(Math.floor(Date.now() / 1000))
    .run();
  return json({ allowed: true });
}
