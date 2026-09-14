/** Private AI SDK adapter. Credentials stay between the Next server and Worker. */
export const RESEARCH_CHEAP_MODEL =
  "@cf/mistralai/mistral-small-3.1-24b-instruct";
export const RESEARCH_FALLBACK_MODEL = "openai/gpt-5.4";

export function resolveResearchModel(requested: unknown) {
  return requested === RESEARCH_FALLBACK_MODEL
    ? RESEARCH_FALLBACK_MODEL
    : RESEARCH_CHEAP_MODEL;
}

export async function researchInference(
  request: Request,
  env: { AI: Ai; RESEARCH_API_SECRET?: string; RESEARCH_AI_GATEWAY_ID?: string },
) {
  if (
    !env.RESEARCH_API_SECRET ||
    request.headers.get("Authorization") !== `Bearer ${env.RESEARCH_API_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 5_000_000)
    return Response.json({ error: "Input too large" }, { status: 413 });
  const input = JSON.parse(raw) as Record<string, any>;
  if (!Array.isArray(input.messages) || input.messages.length > 40)
    return Response.json({ error: "Invalid messages" }, { status: 400 });
  const model = resolveResearchModel(input.model);
  const fallback = model === RESEARCH_FALLBACK_MODEL;
  const maxTokens = Math.min(Number(input.max_tokens) || 800, 2200);
  const result = (await env.AI.run(
    model as any,
    {
      messages: input.messages,
      tools: input.tools,
      tool_choice: input.tool_choice,
      stream: false,
      response_format: input.response_format,
      ...(fallback
        ? { max_completion_tokens: maxTokens }
        : {
            max_tokens: maxTokens,
            ...(input.response_format?.json_schema?.schema
              ? { guided_json: input.response_format.json_schema.schema }
              : {}),
          }),
    } as any,
    fallback
      ? ({
          gateway: {
            id: env.RESEARCH_AI_GATEWAY_ID || "default",
            skipCache: true,
          },
          metadata: { feature: "research-inspect-fallback" },
        } as any)
      : undefined,
  )) as any;
  const calls = result.tool_calls?.map((call: any, index: number) => ({
    index,
    id:
      call.id || `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}`,
    type: "function",
    function: call.function || {
      name: call.name,
      arguments:
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments),
    },
  }));
  const message = result.choices?.[0]?.message || {
    role: "assistant",
    content: result.response || "",
    ...(calls?.length ? { tool_calls: calls } : {}),
  };
  if (message.content == null) message.content = "";
  else if (typeof message.content !== "string")
    message.content = JSON.stringify(message.content);
  const base = {
    id: crypto.randomUUID(),
    created: Math.floor(Date.now() / 1000),
    model: fallback ? RESEARCH_FALLBACK_MODEL : "mistral-small-3.1-24b-instruct",
  };
  const finish_reason = message.tool_calls?.length
    ? "tool_calls"
    : result.choices?.[0]?.finish_reason || "stop";
  if (message.tool_calls?.length)
    message.tool_calls = message.tool_calls.map((call: any, index: number) => ({
      ...call,
      index,
    }));
  if (!input.stream)
    return Response.json(
      {
        ...base,
        object: "chat.completion",
        choices: [{ index: 0, message, finish_reason }],
        usage: result.usage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  // Workers AI returns a complete tool-call object. Frame it as a standard SSE chunk.
  return new Response(
    `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason }] })}\n\ndata: [DONE]\n\n`,
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      },
    },
  );
}
