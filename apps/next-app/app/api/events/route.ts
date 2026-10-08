import { getCloudflareContext } from "@opennextjs/cloudflare";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const text = await request.text();
  if (text.length > 8192) return new Response(null, { status: 413 });
  let event;
  try { event = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  if (!event || typeof event !== "object") return new Response(null, { status: 400 });
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(event.name ?? "") || typeof event.path !== "string" || event.path.length > 256) return new Response(null, { status: 400 });
  // No search text, user identifiers, order IDs, cookies or personal data in telemetry.
  const p = event.properties ?? {};
  const dimensions = ["mode", "lang", "size", "frame", "variant", "source", "medium", "year", "method", "status", "experiment"].map(k => typeof p[k] === "string" ? p[k].slice(0, 64) : "");
  const metrics = ["resultCount", "currentCount", "itemCount", "quantity", "total", "score", "distance", "dwellTimeMs", "taps", "windowMs"].map(k => typeof p[k] === "number" && Number.isFinite(p[k]) ? Math.max(-1e9, Math.min(1e9, p[k])) : 0);
  const path = event.path.replace(/^\/package\/[^/]+/, "/package/[id]");
  const { env } = await getCloudflareContext({ async: true });
  env.ANALYTICS.writeDataPoint({ blobs: [event.name, path, ...dimensions], doubles: [1, ...metrics], indexes: [event.name] });
  return new Response(null, { status: 204 });
}
