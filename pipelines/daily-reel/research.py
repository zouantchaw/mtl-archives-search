"""Research an archival image using Gemini Vision API."""
import os
import base64
import json
import requests
from pathlib import Path

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set. Add it to .env or export it.")
GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

RESEARCH_PROMPT = """You are a Montreal history researcher analyzing an archival photograph.

Analyze this image and any provided metadata. Return a JSON object with these fields:

{
  "title": "A compelling title for this image (max 10 words)",
  "era": "Approximate decade or year range",
  "who": "Who or what organization is depicted (1-2 sentences)",
  "what": "What is happening / what is shown (2-3 sentences)",
  "context": "Historical context - why this matters to Montreal's story (2-3 sentences)",
  "materials": "What materials, infrastructure, or industry is visible (1-2 sentences)",
  "legacy": "What happened to this place/thing - its legacy today (1-2 sentences)",
  "fun_fact": "One surprising or lesser-known fact about this subject",
  "location": "Best guess at the location in Montreal",
  "tags": ["list", "of", "relevant", "tags"]
}

Be specific and factual. If you're uncertain, say so. Focus on details that would be engaging for a Montreal nostalgia audience on Instagram.
"""


def research_image(
    image_path: str,
    grid_paths: list[str] | None = None,
    metadata: str | None = None,
) -> dict:
    """
    Send image + grids + metadata to Gemini for historical research.

    Args:
        image_path: Path to the main archival image
        grid_paths: Optional list of detail crop paths
        metadata: Optional D1 metadata string for additional context

    Returns:
        Parsed research dict from Gemini
    """
    # Build the prompt with metadata context
    prompt = RESEARCH_PROMPT
    if metadata:
        prompt += f"\n\nArchival metadata for context:\n{metadata}"

    # Encode images
    parts = [{"text": prompt}]

    # Main image
    parts.append(_image_part(image_path))

    # Grid detail crops
    if grid_paths:
        parts.append({"text": "Detail crops from the same image:"})
        for gp in grid_paths:
            if os.path.exists(gp):
                parts.append(_image_part(gp))

    # Call Gemini API
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.7,
            "topP": 0.9,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }

    resp = requests.post(
        GEMINI_URL,
        params={"key": GEMINI_API_KEY},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()

    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]

    # Parse JSON response
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to extract JSON from markdown code block
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        return json.loads(text.strip())


def _image_part(path: str) -> dict:
    """Encode an image file as a Gemini inline_data part."""
    ext = Path(path).suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    mime = mime_map.get(ext, "image/jpeg")

    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    return {"inline_data": {"mime_type": mime, "data": b64}}
