"""Documented Cloudflare request/response differences; no semantic label repair."""

GEMMA = "@cf/google/gemma-4-26b-a4b-it"
MOONDREAM = "@cf/moondream/moondream3.1-9B-A2B"
RATES = {
    "@cf/mistralai/mistral-small-3.1-24b-instruct": (0.351, 0.555),
    GEMMA: (0.10, 0.30),
    "@cf/meta/llama-4-scout-17b-16e-instruct": (0.27, 0.85),
    MOONDREAM: (0.30, 1.0),
    "gemini-2.5-flash": (0.30, 2.50),
}


def prepare_body(model, body):
    if model == GEMMA:
        return {**body, "chat_template_kwargs": {"enable_thinking": False}}
    if model == MOONDREAM:
        parts = body["messages"][0]["content"]
        return {
            "task": "query",
            "image": parts[1]["image_url"]["url"],
            "question": parts[0]["text"],
            "reasoning": False,
            "stream": False,
            "temperature": body["temperature"],
            "max_tokens": body["max_tokens"],
        }
    return body


def normalize_response(model, result):
    if model == MOONDREAM:
        nested = result.get("result", result)
        return {**result, "response": nested.get("answer", "")}
    return result
