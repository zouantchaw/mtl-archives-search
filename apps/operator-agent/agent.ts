/**
 * Eve control-surface agent. Model calls go to the archive Worker, which
 * always runs them through Cloudflare AI Gateway Unified Billing.
 * Job retries stay on D1 OperatorStore — do not set Eve as orchestrator.
 */
export const operatorAgent = {
  name: "mtl-operator",
  model: "openai/gpt-5.4",
  provider: "cloudflare-ai-gateway",
  baseURL: "/api/operator/v1",
  tools: [
    "inspect_source",
    "plan_import",
    "run_pilot",
    "validate_index",
    "request_review",
    "publish",
  ],
  env: {
    OPENAI_BASE_URL: "${OPERATOR_ORIGIN}/api/operator/v1",
    OPENAI_API_KEY: "${RESEARCH_API_SECRET}",
  },
};

export default operatorAgent;
