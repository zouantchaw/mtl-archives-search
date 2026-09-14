import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { archiveOrigin } from "./archive";
import {
  RESEARCH_CHEAP_MODEL,
  RESEARCH_FALLBACK_MODEL,
} from "./inspect-fallback";
// Cheap inspect uses the existing Workers AI binding. Fallback GPT-5.4 is also
// routed through that Worker so Vercel never receives a Cloudflare account token.
function workersAi() {
  return createOpenAICompatible({
    name: "archive-workers-ai",
    baseURL: new URL("/api/research/v1", archiveOrigin).href,
    apiKey: process.env.RESEARCH_API_SECRET,
    supportsStructuredOutputs: true,
  });
}
export function researchModel() {
  if (process.env.RESEARCH_PROVIDER === "gateway")
    return process.env.RESEARCH_MODEL || "mistral/mistral-large-3";
  return workersAi()(RESEARCH_CHEAP_MODEL);
}
export function researchInspectFallbackModel() {
  return workersAi()(RESEARCH_FALLBACK_MODEL);
}
