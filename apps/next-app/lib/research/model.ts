import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { archiveOrigin } from "./archive";
// The Gateway remains selectable once paid capacity is configured. Workers AI uses
// the existing AI binding, without copying a Cloudflare account token to Vercel.
export function researchModel() {
  if (process.env.RESEARCH_PROVIDER === "gateway")
    return process.env.RESEARCH_MODEL || "mistral/mistral-large-3";
  return createOpenAICompatible({
    name: "archive-workers-ai",
    baseURL: new URL("/api/research/v1", archiveOrigin).href,
    apiKey: process.env.RESEARCH_API_SECRET,
    supportsStructuredOutputs: true,
  })("@cf/mistralai/mistral-small-3.1-24b-instruct");
}
