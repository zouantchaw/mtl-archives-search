import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { archiveOrigin } from "./archive";
import {
  RESEARCH_CHEAP_MODEL,
  RESEARCH_FALLBACK_MODEL,
} from "./inspect-fallback";
// Cheap inspect uses the existing Workers AI binding. Fallback GPT-5.4 is also
// routed through that Worker; the site never needs a Cloudflare account token.
function workersAi() {
  return createOpenAICompatible({
    name: "archive-workers-ai",
    baseURL: new URL("/api/research/v1", archiveOrigin).href,
    apiKey: process.env.RESEARCH_API_SECRET,
    supportsStructuredOutputs: true,
  });
}
export function researchModel() {
  return workersAi()(RESEARCH_CHEAP_MODEL);
}
export function researchInspectFallbackModel() {
  return workersAi()(RESEARCH_FALLBACK_MODEL);
}
