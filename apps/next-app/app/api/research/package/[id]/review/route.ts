import { archiveOrigin } from "@/lib/research/archive";
import { z } from "zod";

const bodySchema = z.object({
  state: z.enum(["draft", "client-ok", "rejected"]),
  note: z.string().max(2000).optional(),
});
const idSchema = z.string().regex(/^pkg_[0-9a-f]{32}$/);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const secret = process.env.RESEARCH_API_SECRET;
  if (!secret)
    return Response.json(
      { error: "Packages are temporarily unavailable." },
      { status: 503 },
    );
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success)
    return Response.json({ error: "Invalid package." }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Invalid review." }, { status: 400 });
  const response = await fetch(
    new URL(`/api/packages/${id}/review`, archiveOrigin),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    },
  );
  const data = await response.json().catch(() => ({ error: "Review failed." }));
  return Response.json(data, { status: response.status });
}
