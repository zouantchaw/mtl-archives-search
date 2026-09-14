import {
  D1OperatorStorage,
  OperatorStore,
} from "./operator-store";
import { operatorInference } from "./operator-inference";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function store(env: { DB: D1Database }) {
  return new OperatorStore(new D1OperatorStorage(env.DB));
}

async function readJson(request: Request) {
  return request.json() as Promise<Record<string, any>>;
}

export async function handleOperator(
  request: Request,
  env: {
    DB: D1Database;
    AI: Ai;
    RESEARCH_API_SECRET?: string;
    RESEARCH_AI_GATEWAY_ID?: string;
  },
  pathname: string,
) {
  if (
    !env.RESEARCH_API_SECRET ||
    request.headers.get("Authorization") !== `Bearer ${env.RESEARCH_API_SECRET}`
  )
    return json({ error: "Unauthorized" }, 401);
  try {
    if (pathname === "/api/operator/v1/chat/completions") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return operatorInference(request, env);
    }
    const jobs = store(env);
    if (pathname === "/api/operator/v1/invoke" && request.method === "POST") {
      const body = await readJson(request);
      return json(await jobs.invoke(body as any));
    }
    if (pathname === "/api/operator/v1/approve" && request.method === "POST") {
      const body = await readJson(request);
      return json(await jobs.approve(body.job_id, body.plan_hash));
    }
    if (pathname === "/api/operator/v1/cancel" && request.method === "POST") {
      const body = await readJson(request);
      return json(await jobs.cancel(body.job_id));
    }
    if (pathname === "/api/operator/v1/rollback" && request.method === "POST") {
      return json(await jobs.rollback());
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "operator error" },
      400,
    );
  }
}
