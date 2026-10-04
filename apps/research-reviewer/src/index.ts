import pilot from "./pilot.json" with { type: "json" };
import { authenticate, sha } from "./auth";
import { validate, type Families } from "./validation";
import {
  handleHelp,
  runHelp,
  assistanceRefs,
  exportAssistance,
  externalGuidance,
  type HelpEnv,
} from "./assistance";
export type Env = HelpEnv & {
  REVIEW_DB: D1Database;
  SOURCES: R2Bucket;
  DERIVED: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
};
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });
type Row = {
  kind: string;
  entity_key: string;
  revision: number;
  payload_json: string;
  request_hash: string;
  save_id: string;
  created_at: string;
};
export const scope = pilot.snapshot;
export const ids = pilot.items.map((i) => i.sample_id);
async function latest(db: D1Database, actor: string) {
  return (
    await db
      .prepare(
        "SELECT kind,entity_key,revision,payload_json,created_at FROM latest_review WHERE snapshot_id=? AND actor=? ORDER BY kind,entity_key",
      )
      .bind(scope, actor)
      .all<Row>()
  ).results;
}
function publicRows(rows: Row[]) {
  return rows.map((r) => ({
    kind: r.kind,
    key: r.entity_key,
    revision: r.revision,
    payload: JSON.parse(r.payload_json),
    savedAt: r.created_at,
  }));
}
async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw Error("JSON required.");
  if (Number(request.headers.get("content-length") || 0) > 100000)
    throw Error("Request is too large.");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 100000) throw Error("Request is too large.");
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function save(request: Request, env: Env, actor: string) {
  const x = await readBody(request);
  if (x.snapshot !== scope)
    return json(
      { error: "This review belongs to another dataset version." },
      409,
    );
  if (
    !Number.isInteger(x.expectedRevision) ||
    x.expectedRevision < 0 ||
    !/^[-a-f0-9]{36}$/.test(x.saveId)
  )
    return json({ error: "Invalid save version." }, 400);
  const payload = validate(x.kind, x.key, x.payload, ids);
  const requestHash = await sha(
    JSON.stringify({ kind: x.kind, key: x.key, payload }),
  );
  const prior = await env.REVIEW_DB.prepare(
    "SELECT * FROM review_revision WHERE snapshot_id=? AND actor=? AND save_id=?",
  )
    .bind(scope, actor, x.saveId)
    .first<Row>();
  if (prior) {
    if (prior.request_hash !== requestHash)
      return json(
        { error: "This save identifier already contains a different review." },
        409,
      );
    return json({ review: publicRows([prior])[0] });
  }
  const rows = await latest(env.REVIEW_DB, actor);
  const images = rows.filter((r) => r.kind === "image");
  const family = rows.find((r) => r.kind === "families");
  if (
    x.kind === "families" &&
    (payload as Families).complete &&
    images.length !== ids.length
  )
    return json(
      { error: "Review all images before completing the family check." },
      409,
    );
  if (
    x.kind === "query" &&
    (!family || !JSON.parse(family.payload_json).complete)
  )
    return json(
      { error: "Finish image and family review before writing queries." },
      409,
    );
  const helpIds = ["image", "query"].includes(x.kind)
    ? await assistanceRefs(env, actor, x.kind === "image" ? x.key : undefined)
    : [];
  const savedPayload =
    x.kind === "query"
      ? {
          ...payload,
          corpusReviewRevision: family!.revision,
          imageAssistanceRunIds: helpIds,
          priorExternalGuidanceIds: (await externalGuidance(env, actor)).map(
            (e) => e.id,
          ),
        }
      : helpIds.length
        ? {
            ...payload,
            reviewerAssistance: {
              purpose: "preparation_only",
              runIds: helpIds,
            },
          }
        : payload;
  // This single statement checks the expected revision and writes atomically.
  // Query saves also require the same completed family revision at insert time.
  const queryGuard =
    x.kind === "query"
      ? ` AND EXISTS(SELECT 1 FROM latest_review WHERE snapshot_id=? AND actor=? AND kind='families' AND entity_key='corpus' AND revision=? AND json_extract(payload_json,'$.complete')=1)`
      : "";
  const params = [
    scope,
    actor,
    x.kind,
    x.key,
    x.expectedRevision + 1,
    JSON.stringify(savedPayload),
    requestHash,
    x.saveId,
    new Date().toISOString(),
    scope,
    actor,
    x.kind,
    x.key,
    x.expectedRevision,
    ...(x.kind === "query" ? [scope, actor, family!.revision] : []),
  ];
  const row = await env.REVIEW_DB.prepare(
    `INSERT INTO review_revision(snapshot_id,actor,kind,entity_key,revision,payload_json,request_hash,save_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM review_revision WHERE snapshot_id=? AND actor=? AND kind=? AND entity_key=?),0)=?${queryGuard} RETURNING *`,
  )
    .bind(...params)
    .first<Row>();
  if (!row) {
    const replay = await env.REVIEW_DB.prepare(
      "SELECT * FROM review_revision WHERE snapshot_id=? AND actor=? AND save_id=?",
    )
      .bind(scope, actor, x.saveId)
      .first<Row>();
    if (replay && replay.request_hash === requestHash)
      return json({ review: publicRows([replay])[0] });
    return json(
      {
        error:
          "This review changed in another tab. Reload the saved version before editing.",
      },
      409,
    );
  }
  return json({ review: publicRows([row])[0] });
}
async function media(request: Request, env: Env, id: string, size: string) {
  const item = pilot.items.find((i) => i.sample_id === id);
  if (!item || !["preview", "full"].includes(size))
    return json({ error: "Image not found." }, 404);
  const ref = size === "full" ? item.delivery : item.preview;
  const object = await (ref.area === "sources" ? env.SOURCES : env.DERIVED).get(
    ref.object_key,
  );
  if (!object)
    return json({ error: "The preserved image is unavailable." }, 404);
  if (object.size !== ref.size_bytes)
    return json(
      { error: "Image size differs from its frozen reference." },
      409,
    );
  // Preview bytes are small enough to verify on every read. Large, previously
  // verified delivery images stream from their immutable hash-addressed key.
  if (size === "preview") {
    const bytes = await object.arrayBuffer();
    if ((await sha(bytes)) !== ref.sha256)
      return json({ error: "Preview hash verification failed." }, 409);
    return new Response(bytes, {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Content-Length": String(object.size),
      },
    });
  }
  return new Response(object.body, {
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Length": String(object.size),
      "X-Image-SHA256": ref.sha256,
    },
  });
}
async function routeAuthenticated(
  request: Request,
  env: Env,
  actor: { id: string; email: string },
) {
  const url = new URL(request.url),
    path = url.pathname;
  const help = await handleHelp(request, env, actor.id);
  if (help) return help;
  if (request.method === "GET" && path === "/api/state")
    return json({
      snapshot: scope,
      packetSha256: pilot.packetSha256,
      reviewerId: actor.id,
      reviewerEmail: actor.email,
      items: ids.map((id) => ({ id })),
      reviews: publicRows(await latest(env.REVIEW_DB, actor.id)),
      queryTarget: 12,
      assistance: {
        enabled: true,
        model: "Moondream",
        purpose: "preparation_only",
      },
    });
  if (request.method === "POST" && path === "/api/save") {
    if (request.headers.get("origin") !== url.origin)
      return json({ error: "Save from this app only." }, 403);
    return save(request, env, actor.id);
  }
  if (request.method === "GET" && path === "/api/export") {
    const assistance = await exportAssistance(env, actor.id);
    const rows = await env.REVIEW_DB.prepare(
      "SELECT * FROM review_revision WHERE snapshot_id=? AND actor=? ORDER BY kind,entity_key,revision",
    )
      .bind(scope, actor.id)
      .all<Row>();
    return new Response(
      JSON.stringify(
        {
          schema: "mtl-research-review-export-v2",
          snapshot: scope,
          studyId: pilot.studyId,
          importId: pilot.importId,
          packetSha256: pilot.packetSha256,
          reviewerId: actor.id,
          reviewerType: "authenticated_human_declaration",
          exportedAt: new Date().toISOString(),
          referenceStatus: "pending_quality_review",
          benchmarkEligible: false,
          aiAssistance: assistance.aiAssistance,
          assistance,
          items: pilot.items,
          latest: publicRows(await latest(env.REVIEW_DB, actor.id)),
          history: publicRows(rows.results),
        },
        null,
        2,
      ),
      {
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="mtl-archives-pilot-review.json"',
        },
      },
    );
  }
  const match = path.match(/^\/api\/media\/(\d{3})\/(preview|full)$/);
  if (request.method === "GET" && match)
    return media(request, env, match[1], match[2]);
  if (path.startsWith("/api/")) return json({ error: "Route not found." }, 404);
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed." }, 405);
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}
export async function handleAuthenticated(
  request: Request,
  env: Env,
  actor: { id: string; email: string },
) {
  try {
    return await routeAuthenticated(request, env, actor);
  } catch (e) {
    return json(
      {
        error:
          e instanceof SyntaxError
            ? "The review could not be read."
            : e instanceof Error && e.message.startsWith("D1_")
              ? "Could not save. Your draft is still on this device."
              : e instanceof Error
                ? e.message
                : "Could not complete the request.",
      },
      400,
    );
  }
}
export default {
  async queue(batch: MessageBatch<{ runId: string }>, env: Env) {
    for (const message of batch.messages) {
      try {
        await runHelp(env, message.body.runId);
        message.ack();
      } catch (error) {
        console.error("reviewer_help_queue_failed", String(error));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async fetch(request: Request, env: Env) {
    let actor;
    try {
      actor = await authenticate(request, env);
    } catch {
      return json(
        {
          error:
            "Sign in to MTL Archives review. Reload this page to continue.",
        },
        401,
      );
    }
    try {
      return await handleAuthenticated(request, env, actor);
    } catch (e) {
      return json(
        {
          error:
            e instanceof SyntaxError
              ? "The review could not be read."
              : e instanceof Error && e.message.startsWith("D1_")
                ? "Could not save. Your draft is still on this device."
                : e instanceof Error
                  ? e.message
                  : "Could not complete the request.",
        },
        400,
      );
    }
  },
};
