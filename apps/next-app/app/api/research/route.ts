import { createAgentUIStreamResponse } from "ai";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { createArchiveAgent } from "@/lib/research/agent";
import { recordId } from "@/lib/research/schema";
import { archiveOrigin } from "@/lib/research/archive";
export const maxDuration = 120;
const bodySchema = z.object({
  selectedId: recordId.optional(),
  messages: z
    .array(
      z.object({
        id: z.string().max(100),
        role: z.enum(["user", "assistant"]),
        parts: z.array(z.unknown()).max(60),
      }),
    )
    .min(1)
    .max(30),
});
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 100000)
    return Response.json(
      { error: "Conversation is too long. Start a new search." },
      { status: 413 },
    );
  try {
    const raw = await request.text();
    if (raw.length > 100000)
      return Response.json(
        { error: "Conversation is too long. Start a new search." },
        { status: 413 },
      );
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON." }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success)
      return Response.json({ error: "Invalid conversation." }, { status: 400 });
    const messages = parsed.data.messages
      .map((m) => ({
        ...m,
        parts: m.parts
          .filter(
            (p): p is { type: "text"; text: string } =>
              !!p &&
              typeof p === "object" &&
              "type" in p &&
              p.type === "text" &&
              "text" in p &&
              typeof p.text === "string",
          )
          .map((p) => ({ type: "text" as const, text: p.text.slice(0, 3000) })),
      }))
      .filter((m) => m.parts.length);
    if (
      messages.at(-1)?.role !== "user" ||
      !messages.at(-1)?.parts.some((p) => p.text.trim())
    )
      return Response.json({ error: "Enter a question." }, { status: 400 });
    const secret = process.env.RESEARCH_API_SECRET;
    if (!secret)
      return Response.json(
        { error: "The reading room is temporarily unavailable." },
        { status: 503 },
      );
    const ip =
      request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      "local";
    const key = createHmac("sha256", secret).update(ip.trim()).digest("hex");
    const budget = await fetch(new URL("/api/research/budget", archiveOrigin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(10000),
    });
    if (!budget.ok)
      return Response.json(
        {
          error:
            budget.status === 429
              ? "The daily reading-room limit has been reached. Please return tomorrow."
              : "The reading room is temporarily unavailable.",
        },
        { status: budget.status === 429 ? 429 : 503 },
      );
    return await createAgentUIStreamResponse({
      agent: createArchiveAgent(
        request.signal,
        messages
          .filter((m) => m.role === "user")
          .flatMap((m) => m.parts.map((p) => p.text))
          .join("\n"),
        parsed.data.selectedId,
      ),
      uiMessages: messages,
      abortSignal: request.signal,
      timeout: 110000,
      headers: { "Cache-Control": "no-store" },
      onError: () =>
        "The archive assistant could not finish. Please try again.",
    });
  } catch {
    return Response.json(
      { error: "The archive assistant could not finish. Please try again." },
      { status: 503 },
    );
  }
}
