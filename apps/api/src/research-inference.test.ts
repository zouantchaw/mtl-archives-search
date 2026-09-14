import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_CHEAP_MODEL,
  RESEARCH_FALLBACK_MODEL,
  researchInference,
  resolveResearchModel,
} from "./research-inference";
const request = (body: unknown) =>
  new Request("https://worker.test/api/research/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer private-test" },
    body: JSON.stringify(body),
  });
test("AI adapter preserves schema and bounds tokens; tool-only responses never render null", async () => {
  let call: any;
  const env = {
    RESEARCH_API_SECRET: "private-test",
    AI: {
      run: async (model: string, input: unknown) => {
        call = { model, input };
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call12345",
                    type: "function",
                    function: { name: "searchArchive", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        };
      },
    } as unknown as Ai,
  };
  const schema = {
    type: "json_schema",
    json_schema: { name: "test", schema: { type: "object" } },
  };
  const result = await researchInference(
    request({
      messages: [{ role: "user", content: "Find helicopters" }],
      stream: true,
      max_tokens: 99999,
      response_format: schema,
      model: "not-allowed",
    }),
    env,
  );
  assert.equal(result.status, 200);
  assert.equal(call.model, "@cf/mistralai/mistral-small-3.1-24b-instruct");
  assert.equal(call.input.max_tokens, 2200);
  assert.deepEqual(call.input.response_format, schema);
  const stream = await result.text();
  assert.match(stream, /"content":""/);
  assert.doesNotMatch(stream, /"content":"null"/);
  assert.match(stream, /"finish_reason":"tool_calls"/);
  assert.match(stream, /data: \[DONE\]/);
});
test("AI adapter is private even though the reading room is public", async () => {
  const result = await researchInference(new Request("https://worker.test"), {
    RESEARCH_API_SECRET: "private-test",
    AI: {} as Ai,
  });
  assert.equal(result.status, 401);
});
test("unknown model names stay on cheap Mistral; only GPT-5.4 is allowlisted", () => {
  assert.equal(resolveResearchModel("not-allowed"), RESEARCH_CHEAP_MODEL);
  assert.equal(resolveResearchModel(undefined), RESEARCH_CHEAP_MODEL);
  assert.equal(
    resolveResearchModel(RESEARCH_FALLBACK_MODEL),
    RESEARCH_FALLBACK_MODEL,
  );
});
test("inspect fallback uses GPT-5.4 through AI Gateway and never max_tokens", async () => {
  let call: any;
  const env = {
    RESEARCH_API_SECRET: "private-test",
    RESEARCH_AI_GATEWAY_ID: "reading-room",
    AI: {
      run: async (model: string, input: unknown, options?: unknown) => {
        call = { model, input, options };
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"verdict":"match","observation":"A helicopter sits on a paved apron beside two people."}',
              },
            },
          ],
        };
      },
    } as unknown as Ai,
  };
  const result = await researchInference(
    request({
      messages: [{ role: "user", content: "Inspect this image" }],
      stream: false,
      max_tokens: 350,
      model: RESEARCH_FALLBACK_MODEL,
    }),
    env,
  );
  assert.equal(result.status, 200);
  assert.equal(call.model, RESEARCH_FALLBACK_MODEL);
  assert.equal(call.input.max_completion_tokens, 350);
  assert.equal(call.input.max_tokens, undefined);
  assert.equal(call.input.guided_json, undefined);
  assert.deepEqual(call.options, {
    gateway: { id: "reading-room", skipCache: true },
    metadata: { feature: "research-inspect-fallback" },
  });
});
