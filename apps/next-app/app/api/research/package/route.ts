import { archiveOrigin } from "@/lib/research/archive";
import { recordId } from "@/lib/research/schema";
import { z } from "zod";

const bodySchema = z.object({
  ids: z.array(recordId).min(1).max(24),
  intendedUse: z.enum(["hotel_wall", "print", "research", "client_review"]),
  title: z.string().max(200).optional(),
  query: z.string().max(240).optional(),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const secret = process.env.RESEARCH_API_SECRET;
  if (!secret)
    return Response.json(
      { error: "Packages are temporarily unavailable." },
      { status: 503 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Select photographs and a use." }, { status: 400 });
  const response = await fetch(new URL("/api/packages", archiveOrigin), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({ error: "Package create failed." }));
  return Response.json(data, { status: response.status });
}
