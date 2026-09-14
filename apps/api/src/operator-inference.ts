/** Operator agent completions. Always Cloudflare AI Gateway Unified Billing. */
import { OPERATOR_MODEL } from "./operator-store";

export function resolveOperatorModel(requested: unknown) {
  return requested === OPERATOR_MODEL || requested === "openai/gpt-5.4"
    ? OPERATOR_MODEL
    : OPERATOR_MODEL;
}

export async function operatorInference(
  request: Request,
  env: { AI: Ai; RESEARCH_API_SECRET?: string; RESEARCH_AI_GATEWAY_ID?: string },
) {
  if (
    !env.RESEARCH_API_SECRET ||
    request.headers.get("Authorization") !== `Bearer ${env.RESEARCH_API_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 1_000_000)
    return Response.json({ error: "Input too large" }, { status: 413 });
  const input = JSON.parse(raw) as Record<string, any>;
  if (!Array.isArray(input.messages) || input.messages.length > 40)
    return Response.json({ error: "Invalid messages" }, { status: 400 });
  const model = resolveOperatorModel(input.model);
  const maxTokens = Math.min(Number(input.max_tokens) || 800, 2200);
  const result = (await env.AI.run(
    model as any,
    {
      messages: input.messages,
      tools: input.tools,
      tool_choice: input.tool_choice,
      stream: false,
      response_format: input.response_format,
      max_completion_tokens: maxTokens,
    } as any,
    {
      gateway: {
        id: env.RESEARCH_AI_GATEWAY_ID || "default",
        skipCache: true,
      },
      metadata: { feature: "operator-agent" },
    } as any,
  )) as any;
  const message = result.choices?.[0]?.message || {
    role: "assistant",
    content: result.response || "",
  };
  if (message.content == null) message.content = "";
  return Response.json({
    id: crypto.randomUUID(),
    created: Math.floor(Date.now() / 1000),
    model: OPERATOR_MODEL,
    object: "chat.completion",
    choices: [{ index: 0, message, finish_reason: "stop" }],
  });
}
