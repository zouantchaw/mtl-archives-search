import { getCloudflareContext } from "@opennextjs/cloudflare";

// Runtime requests use the existing API Worker directly. Static build generation
// and ordinary Node development can fetch the same project-owned public origin.
export async function archiveApiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let api: CloudflareEnv["ARCHIVE_API"] | undefined;
  if (process.env.NODE_ENV === "production") {
    try {
      api = getCloudflareContext().env.ARCHIVE_API;
    } catch {
      // Static generation has no request context. Do not instantiate a local
      // Wrangler proxy with an unresolved service binding during the build.
    }
  }
  if (api) return api.fetch(input, init);
  return fetch(input, init);
}
