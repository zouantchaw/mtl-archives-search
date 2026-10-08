import { getRecord, imageBytes } from "@/lib/research/archive";
import { recordId } from "@/lib/research/schema";
export async function GET(request: Request) {
  const parsed = recordId.safeParse(
    new URL(request.url).searchParams.get("id"),
  );
  if (!parsed.success) return new Response("Invalid photo", { status: 400 });
  try {
    const record = await getRecord(parsed.data, request.signal);
    const bytes = await imageBytes(record, request.signal);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch (error) {
    console.error('research_image_failed', {
      recordId: parsed.data,
      error: error instanceof Error ? error.message : 'Unknown image error',
    });
    return new Response("Image unavailable", { status: 404 });
  }
}
