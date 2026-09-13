import unittest

from vision_adapters import GEMMA, MOONDREAM, normalize_response, prepare_body


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
