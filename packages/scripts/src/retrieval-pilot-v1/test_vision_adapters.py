import unittest

from vision_adapters import (
    GEMMA,
    MOONDREAM,
    OPENAI_GPT_54,
    XAI_GROK_46,
    estimate_usd,
    gateway_run_url,
    gateway_headers,
    normalize_response,
    prepare_body,
    uses_max_completion_tokens,
)


class VisionAdapters(unittest.TestCase):
    def test_moondream_uses_documented_image_query(self):
        body = {
            "messages": [
                {
                    "content": [
                        {"type": "text", "text": "unchanged prompt"},
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/jpeg;base64,AA=="},
                        },
                    ]
                }
            ],
            "temperature": 0,
            "max_tokens": 650,
        }
        adapted = prepare_body(MOONDREAM, body)
        self.assertEqual(adapted["question"], "unchanged prompt")
        self.assertEqual(adapted["image"], "data:image/jpeg;base64,AA==")
        self.assertFalse(adapted["stream"])
        self.assertFalse(adapted["reasoning"])
        self.assertEqual(adapted["max_tokens"], 650)

    def test_nested_result_keeps_usage(self):
        value = normalize_response(
            MOONDREAM,
            {
                "result": {"answer": '{"missing":"fields"}'},
                "usage": {"prompt_tokens": 7},
            },
        )
        self.assertEqual(value["response"], '{"missing":"fields"}')
        self.assertEqual(value["usage"]["prompt_tokens"], 7)

    def test_gemma_disables_reasoning_without_changing_prompt(self):
        body = {"messages": [{"content": "original"}], "max_tokens": 650}
        value = prepare_body(GEMMA, body)
        self.assertFalse(value["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual(value["messages"], body["messages"])
        self.assertNotIn("chat_template_kwargs", body)

    def test_generic_passthrough(self):
        x = {"response": "value"}
        self.assertEqual(normalize_response("other", x), x)

    def test_openai_reasoning_uses_max_completion_tokens(self):
        body = {
            "messages": [{"role": "user", "content": "prompt"}],
            "max_tokens": 4096,
            "temperature": 0,
        }
        adapted = prepare_body(OPENAI_GPT_54, body)
        self.assertEqual(adapted["model"], OPENAI_GPT_54)
        self.assertEqual(adapted["input"]["max_completion_tokens"], 4096)
        self.assertNotIn("max_tokens", adapted["input"])
        self.assertEqual(adapted["input"]["response_format"], {"type": "json_object"})
        self.assertTrue(uses_max_completion_tokens(OPENAI_GPT_54))
        self.assertFalse(uses_max_completion_tokens(XAI_GROK_46))

    def test_grok_keeps_max_tokens_and_does_not_truncate_to_650(self):
        body = {
            "messages": [{"role": "user", "content": "prompt"}],
            "max_tokens": 4096,
            "temperature": 0,
        }
        adapted = prepare_body(XAI_GROK_46, body)
        self.assertEqual(adapted["input"]["max_tokens"], 4096)
        self.assertNotIn("max_completion_tokens", adapted["input"])

    def test_gateway_headers_skip_cache_and_keep_receipt_metadata(self):
        headers = gateway_headers("token", {"issue": "148"})
        self.assertEqual(headers["cf-aig-skip-cache"], "true")
        self.assertIn("148", headers["cf-aig-metadata"])
        self.assertTrue(gateway_run_url("acct").endswith("/accounts/acct/ai/run"))

    def test_openai_chat_completion_text_and_ticks_cost(self):
        result = normalize_response(
            OPENAI_GPT_54,
            {
                "result": {
                    "model": OPENAI_GPT_54,
                    "choices": [{"message": {"content": '{"viewpoint":"ground"}'}}],
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 20,
                        "cost_in_usd_ticks": 100000000,
                    },
                }
            },
        )
        self.assertEqual(result["response"], '{"viewpoint":"ground"}')
        self.assertEqual(estimate_usd(OPENAI_GPT_54, result["usage"]), 0.01)
