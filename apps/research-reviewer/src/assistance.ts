import pilot from "./pilot.json" with { type: "json" };
import manifest from "./inspection.json" with { type: "json" };
import { sha } from "./auth";
import {
  TEXT_MODEL,
  SECOND_READER,
  TEXT_PROMPT,
  TEXT_PROMPT_VERSION,
  parseTextEvidence,
} from "./text-evidence";

export const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
export const PROMPT_VERSION = "mtl-reviewer-help-v2";
export type Rect = { x: number; y: number; w: number; h: number };
export type HelpKind = "inspect" | "text" | "explain";
export type Spec = {
  imageId: string;
  kind: HelpKind;
  rect: Rect;
  rotation: number;
  reader?: "primary" | "second";
};
export type HelpEnv = {
  REVIEW_DB: D1Database;
  HELP_ARTIFACTS: R2Bucket;
  HELP_QUEUE: Queue<{ runId: string }>;
  AI: Ai;
  IMAGES: ImagesBinding;
  AI_GATEWAY_ID: string;
};
type Run = {
  id: string;
  snapshot_id: string;
  actor: string;
  image_id: string;
  kind: HelpKind;
  request_hash: string;
  spec_json: string;
  model: string;
  prompt_version: string;
  status: string;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  input_key: string | null;
  input_sha256: string | null;
  output_key: string | null;
  output_sha256: string | null;
  answer: string | null;
  error: string | null;
  metrics_json: string | null;
};
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const now = () => new Date().toISOString();

// This pilot is preparation. Never enable this handler for a blind/heldout packet.
export function preparationOnly() {
  if (
    manifest.purpose !== "assisted_preparation_only" ||
    manifest.snapshot !== pilot.snapshot
  )
    throw Error("Model help is unavailable for this review packet.");
}
export function validateSpec(x: any): Spec {
  preparationOnly();
  const item = manifest.items.find((i) => i.id === x.imageId);
  if (
    !item ||
    !["inspect", "text", "explain"].includes(x.kind) ||
    ![0, 90, 180, 270].includes(x.rotation)
  )
    throw Error("Choose an image, help type and valid rotation.");
  if (x.reader !== undefined && !["primary", "second"].includes(x.reader))
    throw Error("Choose a valid text reader.");
  if (x.reader && x.kind !== "text")
    throw Error("Text reader is only available for text inspection.");
  const r = x.rect;
  if (
    !r ||
    !["x", "y", "w", "h"].every((k) => Number.isInteger(r[k])) ||
    r.x < 0 ||
    r.y < 0 ||
    r.w < 50 ||
    r.h < 50 ||
    r.x + r.w > 10000 ||
    r.y + r.h > 10000
  )
    throw Error("Select an area inside the image.");
  return {
    imageId: item.id,
    kind: x.kind,
    rotation: x.rotation,
    rect: { x: r.x, y: r.y, w: r.w, h: r.h },
    ...(x.kind === "text" && x.reader ? { reader: x.reader } : {}),
  };
}
export function cropPixels(rect: Rect, width: number, height: number) {
  const left = Math.floor((rect.x * width) / 10000),
    top = Math.floor((rect.y * height) / 10000);
  const right = Math.min(width, Math.ceil(((rect.x + rect.w) * width) / 10000));
  const bottom = Math.min(
    height,
    Math.ceil(((rect.y + rect.h) * height) / 10000),
  );
  return { left, top, width: right - left, height: bottom - top };
}
function isStale(r: Run) {
  return (
    ["queued", "running"].includes(r.status) &&
    Date.now() - Date.parse(r.created_at) > 10 * 60 * 1000
  );
}
export function unreliableAnswer(
  answer: string,
  metrics: any = {},
  finishReason = "",
) {
  return (
    !answer.trim() ||
    answer.length > 10000 ||
    /length|max_tokens|token_limit/i.test(finishReason) ||
    metrics.output_tokens >= 500 ||
    (answer.match(/\[\?\]/g)?.length ?? 0) > 8 ||
    answer.split(/\s+/).length > 180
  );
}
function publicRun(r: Run) {
  const unreliable =
    r.status === "complete" &&
    unreliableAnswer(
      r.answer ?? "",
      r.metrics_json ? JSON.parse(r.metrics_json) : {},
    );
  return {
    id: r.id,
    imageId: r.image_id,
    kind: r.kind,
    spec: JSON.parse(r.spec_json),
    model: r.model,
    promptVersion: r.prompt_version,
    status: isStale(r) || unreliable ? "failed" : r.status,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    answer: unreliable ? null : r.answer,
    error: unreliable
      ? "The model could not give a reliable short answer. Rotate the detail or select a smaller area, then try again."
      : isStale(r)
        ? "This request timed out. Try again; your review is safe."
        : r.error,
    inputSha256: r.input_sha256,
    outputSha256: r.output_sha256,
    inputUrl: r.input_key ? `/api/help/${r.id}/input` : null,
    metrics: r.metrics_json ? JSON.parse(r.metrics_json) : null,
  };
}
async function delivered(env: HelpEnv, r: Run) {
  if (
    r.status !== "complete" ||
    unreliableAnswer(
      r.answer ?? "",
      r.metrics_json ? JSON.parse(r.metrics_json) : {},
    )
  )
    return;
  await env.REVIEW_DB.prepare(
    `INSERT OR IGNORE INTO assistance_event(id,run_id,snapshot_id,actor,action,reason,created_at) VALUES(?,?,?,?, 'output_delivered','',?)`,
  )
    .bind("delivered:" + r.id, r.id, pilot.snapshot, r.actor, now())
    .run();
}
export async function assistanceRefs(
  env: HelpEnv,
  actor: string,
  imageId?: string,
) {
  const rows = await env.REVIEW_DB.prepare(
    `SELECT DISTINCT r.id FROM assistance_run r JOIN assistance_event e ON r.id=e.run_id WHERE r.snapshot_id=? AND r.actor=? ${imageId ? "AND r.image_id=?" : ""} AND e.action='output_delivered' ORDER BY r.id`,
  )
    .bind(pilot.snapshot, actor, ...(imageId ? [imageId] : []))
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}
export async function externalGuidance(env: HelpEnv, actor: string) {
  const rows = await env.REVIEW_DB.prepare(
    "SELECT id,payload_json,created_at FROM external_guidance WHERE snapshot_id=? AND actor=? ORDER BY created_at,id",
  )
    .bind(pilot.snapshot, actor)
    .all<{ id: string; payload_json: string; created_at: string }>();
  return rows.results.map((r) => ({
    id: r.id,
    ...JSON.parse(r.payload_json),
    recordedAt: r.created_at,
  }));
}
export async function exportAssistance(env: HelpEnv, actor: string) {
  const external = await externalGuidance(env, actor);
  const runs = await env.REVIEW_DB.prepare(
    "SELECT * FROM assistance_run WHERE snapshot_id=? AND actor=? ORDER BY created_at,id",
  )
    .bind(pilot.snapshot, actor)
    .all<Run>();
  const events = await env.REVIEW_DB.prepare(
    "SELECT id,run_id,action,reason,created_at FROM assistance_event WHERE snapshot_id=? AND actor=? ORDER BY created_at,id",
  )
    .bind(pilot.snapshot, actor)
    .all();
  return {
    schema: "mtl-reviewer-assistance-v1",
    purpose: "preparation_only",
    trackingStarted: "2026-10-04",
    priorExternalGuidance: external.length
      ? "Guided calibration is recorded with its receipt; original review payloads remain unchanged."
      : "Earlier unrecorded external exposure is unknown.",
    externalGuidance: external,
    aiAssistance:
      external.length > 0 ||
      events.results.some((e: any) => e.action === "output_delivered"),
    runs: runs.results.map((r) => ({
      ...publicRun(r),
      status: r.status,
      answer: r.answer,
      sourceSha256: manifest.items.find((i) => i.id === r.image_id)!
        .sourceSha256,
      renderSha256: manifest.items.find((i) => i.id === r.image_id)!.sha256,
      inputKey: r.input_key,
      outputKey: r.output_key,
      renderRecipe: manifest.recipe,
    })),
    events: events.results,
  };
}
export async function handleHelp(
  request: Request,
  env: HelpEnv,
  actor: string,
): Promise<Response | null> {
  const url = new URL(request.url),
    p = url.pathname;
  if (!p.startsWith("/api/help") && !p.startsWith("/api/inspection/"))
    return null;
  preparationOnly();
  if (request.method === "POST") {
    if (request.headers.get("origin") !== url.origin)
      return reply({ error: "Request help from this app only." }, 403);
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return reply({ error: "JSON required." }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 10000)
      return reply({ error: "Help request is too large." }, 400);
    const x = JSON.parse(new TextDecoder().decode(bytes));
    if (x.snapshot !== pilot.snapshot)
      return reply(
        { error: "This help request belongs to another dataset version." },
        409,
      );
    if (p === "/api/help") {
      if (!uuid(x.requestId))
        return reply({ error: "Invalid help identifier." }, 400);
      const spec = validateSpec(x);
      if (
        spec.kind === "inspect" &&
        (spec.rect.w !== 10000 || spec.rect.h !== 10000)
      )
        return reply(
          {
            error:
              "Review guidance uses the whole image. Use Read text or Explain detail for a selected area.",
          },
          400,
        );
      const render = manifest.items.find((i) => i.id === spec.imageId)!;
      const model =
        spec.kind === "text" && spec.reader
          ? spec.reader === "second"
            ? SECOND_READER
            : TEXT_MODEL
          : MODEL;
      const promptVersion =
        spec.kind === "text" && spec.reader ? TEXT_PROMPT_VERSION : PROMPT_VERSION;
      const hash = await sha(
        JSON.stringify({
          scope: pilot.snapshot,
          spec,
          render: render.sha256,
          model,
          prompt: promptVersion,
        }),
      );
      const sameId = await env.REVIEW_DB.prepare(
        "SELECT * FROM assistance_run WHERE id=?",
      )
        .bind(x.requestId)
        .first<Run>();
      if (sameId) {
        if (sameId.actor !== actor || sameId.request_hash !== hash)
          return reply({ error: "Help identifier already used." }, 409);
        await delivered(env, sameId);
        return reply({ run: publicRun(sameId) });
      }
      const cached = await env.REVIEW_DB.prepare(
        `SELECT * FROM assistance_run WHERE snapshot_id=? AND actor=? AND request_hash=? AND status IN ('queued','running','complete') AND (status='complete' OR created_at>?) ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(
          pilot.snapshot,
          actor,
          hash,
          new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        )
        .first<Run>();
      if (cached) {
        await delivered(env, cached);
        return reply({ run: publicRun(cached), reused: true });
      }
      const created = now();
      // Atomic quotas, including queued work. Failed attempts count toward cost limits.
      const row = await env.REVIEW_DB.prepare(
        `INSERT INTO assistance_run(id,snapshot_id,actor,image_id,kind,request_hash,spec_json,model,prompt_version,status,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,'queued',? WHERE
    (SELECT count(*) FROM assistance_run WHERE snapshot_id=? AND actor=? AND created_at>=?)<600 AND
    (SELECT count(*) FROM assistance_run WHERE snapshot_id=? AND actor=? AND image_id=?)<40 AND
    (SELECT count(*) FROM assistance_run WHERE snapshot_id=? AND actor=? AND status IN ('queued','running') AND created_at>?)<12 RETURNING *`,
      )
        .bind(
          x.requestId,
          pilot.snapshot,
          actor,
          spec.imageId,
          spec.kind,
          hash,
          JSON.stringify(spec),
          model,
          promptVersion,
          created,
          pilot.snapshot,
          actor,
          created.slice(0, 10),
          pilot.snapshot,
          actor,
          spec.imageId,
          pilot.snapshot,
          actor,
          new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        )
        .first<Run>();
      if (!row)
        return reply(
          {
            error:
              "Help limit reached (12 pending, 40 per image, 600 per day). You can continue reviewing manually.",
          },
          429,
        );
      try {
        await env.HELP_QUEUE.send({ runId: row.id });
      } catch {
        await env.REVIEW_DB.prepare(
          "UPDATE assistance_run SET status='failed',error=?,finished_at=? WHERE id=? AND status='queued'",
        )
          .bind("Could not queue help. Try again.", now(), row.id)
          .run();
        return reply(
          { error: "Could not queue help. Your review is safe; try again." },
          503,
        );
      }
      return reply({ run: publicRun(row) }, 202);
    }
    if (p === "/api/help/events") {
      if (
        !uuid(x.eventId) ||
        !uuid(x.runId) ||
        !["accepted_note", "dismissed"].includes(x.action) ||
        typeof x.reason !== "string" ||
        x.reason.length > 500 ||
        (x.action === "dismissed" && !x.reason.trim())
      )
        return reply({ error: "Choose a decision and a short reason." }, 400);
      const r = await env.REVIEW_DB.prepare(
        "SELECT * FROM assistance_run WHERE id=? AND snapshot_id=? AND actor=?",
      )
        .bind(x.runId, pilot.snapshot, actor)
        .first<Run>();
      if (
        !r ||
        r.status !== "complete" ||
        unreliableAnswer(
          r.answer ?? "",
          r.metrics_json ? JSON.parse(r.metrics_json) : {},
        )
      )
        return reply({ error: "Usable completed help result not found." }, 404);
      const prior = await env.REVIEW_DB.prepare(
        "SELECT * FROM assistance_event WHERE id=?",
      )
        .bind(x.eventId)
        .first<any>();
      if (
        prior &&
        (prior.actor !== actor ||
          prior.run_id !== r.id ||
          prior.action !== x.action ||
          prior.reason !== x.reason.trim())
      )
        return reply({ error: "Decision identifier already used." }, 409);
      await env.REVIEW_DB.prepare(
        "INSERT OR IGNORE INTO assistance_event(id,run_id,snapshot_id,actor,action,reason,created_at) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(
          x.eventId,
          r.id,
          pilot.snapshot,
          actor,
          x.action,
          x.reason.trim(),
          now(),
        )
        .run();
      return reply({ ok: true });
    }
  }
  if (request.method === "GET" && p === "/api/help") {
    const id = url.searchParams.get("imageId");
    if (!manifest.items.some((i) => i.id === id))
      return reply({ error: "Image not found." }, 404);
    const rows = await env.REVIEW_DB.prepare(
      "SELECT id,kind,status,created_at FROM assistance_run WHERE snapshot_id=? AND actor=? AND image_id=? ORDER BY created_at DESC LIMIT 40",
    )
      .bind(pilot.snapshot, actor, id)
      .all();
    return reply({ runs: rows.results });
  }
  const m = p.match(/^\/api\/help\/([a-f0-9-]{36})(\/input)?$/);
  if (request.method === "GET" && m) {
    const r = await env.REVIEW_DB.prepare(
      "SELECT * FROM assistance_run WHERE id=? AND snapshot_id=? AND actor=?",
    )
      .bind(m[1], pilot.snapshot, actor)
      .first<Run>();
    if (!r) return reply({ error: "Help request not found." }, 404);
    if (m[2]) {
      if (!r.input_key) return reply({ error: "Input not ready." }, 404);
      const o = await env.HELP_ARTIFACTS.get(r.input_key);
      if (!o) return reply({ error: "Input unavailable." }, 404);
      const b = await o.arrayBuffer();
      if ((await sha(b)) !== r.input_sha256)
        throw Error("Help input verification failed.");
      return new Response(b, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
        },
      });
    }
    await delivered(env, r);
    return reply({ run: publicRun(r) });
  }
  const im = p.match(/^\/api\/inspection\/(\d{3})$/);
  if (request.method === "GET" && im) {
    const spec = validateSpec({
      imageId: im[1],
      kind: "text",
      rotation: Number(url.searchParams.get("rotation") || 0),
      rect: {
        x: Number(url.searchParams.get("x") || 0),
        y: Number(url.searchParams.get("y") || 0),
        w: Number(url.searchParams.get("w") || 10000),
        h: Number(url.searchParams.get("h") || 10000),
      },
    });
    const view = await renderInput(env, spec);
    return new Response(view.bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Image-SHA256": view.sha256,
      },
    });
  }
  return reply({ error: "Help route not found." }, 404);
}
export async function renderInput(env: HelpEnv, spec: Spec) {
  const ref = manifest.items.find((i) => i.id === spec.imageId)!;
  const source = pilot.items.find((i) => i.sample_id === spec.imageId)!;
  if (ref.sourceSha256 !== source.delivery.sha256)
    throw Error("Inspection/source association mismatch.");
  const recipe = {
    source: ref.sha256,
    rect: spec.rect,
    rotation: spec.rotation,
    limit: 2048,
    quality: 92,
    version: 1,
  };
  const key = "views/v1/" + (await sha(JSON.stringify(recipe))) + ".jpg";
  const cached = await env.HELP_ARTIFACTS.get(key);
  if (cached) {
    const bytes = await cached.arrayBuffer(),
      digest = await sha(bytes);
    if (digest !== cached.customMetadata?.sha256)
      throw Error("Cached inspection verification failed.");
    return { key, bytes, sha256: digest, recipe };
  }
  const object = await env.HELP_ARTIFACTS.get(ref.key);
  if (!object || object.size !== ref.size)
    throw Error(
      "Inspection image unavailable. Use Full image to review manually.",
    );
  const bytes = await object.arrayBuffer();
  if ((await sha(bytes)) !== ref.sha256)
    throw Error("Inspection image verification failed.");
  const stream = new Response(bytes).body!;
  const response = (
    await env.IMAGES.input(stream)
      .transform({ trim: cropPixels(spec.rect, ref.width, ref.height) })
      .transform({
        rotate: spec.rotation as 0 | 90 | 180 | 270,
        width: 2048,
        height: 2048,
        fit: "scale-down",
      })
      .output({ format: "image/jpeg", quality: 92 })
  ).response();
  if (!response.ok)
    throw Error(
      "Could not render this area. Use Full image to inspect manually.",
    );
  const rendered = await response.arrayBuffer(),
    digest = await sha(rendered);
  await env.HELP_ARTIFACTS.put(key, rendered, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { sha256: digest, recipe: JSON.stringify(recipe) },
  });
  return { key, bytes: rendered, sha256: digest, recipe };
}
export function prompt(kind: HelpKind) {
  const common =
    "Inspect only the visible pixels of this archival image. Do not guess locations, dates, identities or unseen details. Be brief and acknowledge uncertainty. ";
  return (
    common +
    (kind === "text"
      ? "Read the few legible words or numbers in this crop. If letters or numbers are unclear, say they are unclear instead of guessing. Identify a watermark or margin annotation separately if visible. Keep the answer under 50 words."
      : kind === "explain"
        ? "Describe the main visible structures in this detail. Mention what you cannot determine. Use at most 80 words."
        : "Briefly describe the image type, the main visible scene features, and any serious blur, darkness or accidentally missing scan content. A scan notch or normal camera boundary alone is not a crop defect. Small text may need a separate close-up. Use at most 100 words.")
  );
}
function base64(bytes: ArrayBuffer) {
  let s = "";
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
}
export async function runHelp(env: HelpEnv, runId: string) {
  preparationOnly();
  const lease = crypto.randomUUID();
  const row = await env.REVIEW_DB.prepare(
    `UPDATE assistance_run SET status='running',started_at=?,attempts=attempts+1 WHERE id=? AND snapshot_id=? AND attempts<2 AND (status='queued' OR (status='running' AND started_at<?)) RETURNING *`,
  )
    .bind(
      now(),
      runId,
      pilot.snapshot,
      new Date(Date.now() - 180000).toISOString(),
    )
    .first<Run>();
  if (!row) return;
  const started = Date.now();
  try {
    const spec = validateSpec(JSON.parse(row.spec_json));
    const typedText =
      row.prompt_version === TEXT_PROMPT_VERSION &&
      row.kind === "text" &&
      [TEXT_MODEL, SECOND_READER].includes(row.model);
    const legacy = row.model === MODEL && row.prompt_version === PROMPT_VERSION;
    if (!typedText && !legacy) throw Error("Unsupported help recipe.");
    const input = await renderInput(env, spec);
    // Pin model bytes separately from the recipe-keyed inspection cache. A
    // future renderer/cache refill cannot replace an earlier model's input.
    const retainedInputKey = `inputs/sha256/${input.sha256}.jpg`;
    await env.HELP_ARTIFACTS.put(retainedInputKey, input.bytes, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { sha256: input.sha256 },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    await env.REVIEW_DB.prepare(
      "UPDATE assistance_run SET input_key=?,input_sha256=? WHERE id=? AND status='running' AND started_at=?",
    )
      .bind(retainedInputKey, input.sha256, row.id, row.started_at)
      .run();
    const question = typedText ? TEXT_PROMPT : prompt(spec.kind);
    const image = "data:image/jpeg;base64," + base64(input.bytes);
    const parameters = typedText
      ? {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: question },
                {
                  type: "image_url",
                  image_url: { url: image, detail: "high" },
                },
              ],
            },
          ],
          max_tokens: 500,
          temperature: 0,
          enable_thinking: false,
          chat_template_kwargs: { enable_thinking: false },
          ...(row.model === SECOND_READER ? { reasoning_effort: "low" } : {}),
          stream: false,
        }
      : {
          task: "query",
          image,
          question,
          max_tokens: 500,
          temperature: 0,
          reasoning: false,
          stream: false,
        };
    const raw: any = await env.AI.run(row.model as any, parameters as any, {
      gateway: { id: env.AI_GATEWAY_ID, collectLog: false, skipCache: true },
    });
    const result = raw?.result ?? raw;
    const answer = typedText
      ? result?.choices?.[0]?.message?.content
      : (result?.answer ?? result?.response);
    const metrics = typedText
      ? {
          input_tokens: result.usage?.prompt_tokens,
          output_tokens: result.usage?.completion_tokens,
        }
      : result.metrics;
    const finishReason = typedText
      ? result.choices?.[0]?.finish_reason
      : result.finish_reason;
    const record = {
      schema: "mtl-help-output-v1",
      runId: row.id,
      sourceSha256: manifest.items.find((i) => i.id === row.image_id)!
        .sourceSha256,
      model: row.model,
      promptVersion: row.prompt_version,
      question,
      spec,
      inputSha256: input.sha256,
      inputKey: retainedInputKey,
      inputRecipe: input.recipe,
      requestedMaxTokens: 500,
      raw,
      finishedAt: now(),
      latencyMs: Date.now() - started,
    };
    const output = new TextEncoder().encode(JSON.stringify(record));
    const digest = await sha(output.buffer);
    const key = "runs/" + row.id + "/" + digest + ".json";
    await env.HELP_ARTIFACTS.put(key, output, {
      httpMetadata: { contentType: "application/json" },
    });
    await env.REVIEW_DB.prepare(
      "UPDATE assistance_run SET output_key=?,output_sha256=?,metrics_json=? WHERE id=? AND status='running' AND started_at=?",
    )
      .bind(
        key,
        digest,
        JSON.stringify({
          ...(metrics ?? {}),
          latency_ms: Date.now() - started,
          finish_reason: finishReason ?? null,
        }),
        row.id,
        row.started_at,
      )
      .run();
    if (
      typeof answer !== "string" ||
      unreliableAnswer(answer, metrics, finishReason)
    )
      throw Error("MODEL_OUTPUT_UNRELIABLE");
    if (typedText) parseTextEvidence(answer);
    await env.REVIEW_DB.prepare(
      `UPDATE assistance_run SET status='complete',answer=?,output_key=?,output_sha256=?,metrics_json=?,finished_at=? WHERE id=? AND status='running' AND started_at=?`,
    )
      .bind(
        answer.trim(),
        key,
        digest,
        JSON.stringify({
          ...(metrics ?? {}),
          latency_ms: Date.now() - started,
        }),
        now(),
        row.id,
        row.started_at,
      )
      .run();
  } catch (e) {
    // The error is visible and terminal. Retry is a deliberate new user request.
    console.error("reviewer_help_failed", {
      runId: row.id,
      error: String(e).slice(0, 800),
      lease,
    });
    await env.REVIEW_DB.prepare(
      `UPDATE assistance_run SET status='failed',error=?,finished_at=? WHERE id=? AND status='running' AND started_at=?`,
    )
      .bind(
        String(e).includes("MODEL_OUTPUT_UNRELIABLE")
          ? "The model could not give a reliable short answer. Rotate the detail or select a smaller area, then try again."
          : "Help could not finish. Try again or continue manually; your review is safe.",
        now(),
        row.id,
        row.started_at,
      )
      .run();
  }
}
