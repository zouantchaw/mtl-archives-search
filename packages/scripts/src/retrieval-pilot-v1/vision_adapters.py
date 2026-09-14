"""Documented Cloudflare request/response differences; no semantic label repair."""

import json

GEMMA = "@cf/google/gemma-4-26b-a4b-it"
MOONDREAM = "@cf/moondream/moondream3.1-9B-A2B"
OPENAI_GPT_54 = "openai/gpt-5.4"
XAI_GROK_46 = "xai/grok-4.6"
# Verified 2026-09-13 against Unified Billing POST /ai/run with image_url parts.
PINNED_GATEWAY_MODELS = (OPENAI_GPT_54, XAI_GROK_46)
RATES = {
    "@cf/mistralai/mistral-small-3.1-24b-instruct": (0.351, 0.555),
    GEMMA: (0.10, 0.30),
    "@cf/meta/llama-4-scout-17b-16e-instruct": (0.27, 0.85),
    MOONDREAM: (0.30, 1.0),
    "gemini-2.5-flash": (0.30, 2.50),
    OPENAI_GPT_54: (2.50, 15.00),
    XAI_GROK_46: (3.00, 15.00),
}


def is_gateway_model(model):
    return model.startswith("openai/") or model.startswith("xai/")


def uses_max_completion_tokens(model):
    return model.startswith("openai/gpt-5") or "reasoning" in model


def gateway_run_url(account_id):
    return f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run"


def gateway_headers(token, metadata=None):
    headers = {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "cf-aig-skip-cache": "true",
        "cf-aig-collect-log": "true",
    }
    if metadata:
        headers["cf-aig-metadata"] = json.dumps(metadata, separators=(",", ":"))
    return headers


def ticks_to_usd(usage):
    ticks = (usage or {}).get("cost_in_usd_ticks")
    if not isinstance(ticks, (int, float)):
        return None
    return ticks / 1e10


def estimate_usd(model, usage):
    billed = ticks_to_usd(usage)
    if billed is not None:
        return billed
    rates = RATES.get(model)
    if not rates or not usage:
        return None
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    if prompt is None or completion is None:
        return None
    return (prompt * rates[0] + completion * rates[1]) / 1e6


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
    if is_gateway_model(model):
        inner = {
            "messages": body["messages"],
            "stream": False,
            "response_format": {"type": "json_object"},
        }
        if uses_max_completion_tokens(model):
            inner["max_completion_tokens"] = body["max_tokens"]
        else:
            inner["max_tokens"] = body["max_tokens"]
            inner["temperature"] = body.get("temperature", 0)
        return {"model": model, "input": inner}
    return body


def chat_text(result):
    choice = (result.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
            if not (isinstance(part, dict) and part.get("type") == "reasoning")
        )
    return content or result.get("response") or ""


def normalize_response(model, result):
    if model == MOONDREAM:
        nested = result.get("result", result)
        return {**result, "response": nested.get("answer", "")}
    if is_gateway_model(model):
        nested = result.get("result", result)
        return {
            **nested,
            "response": chat_text(nested),
            "usage": nested.get("usage") or result.get("usage"),
            "model": nested.get("model") or result.get("model") or model,
        }
    return result
