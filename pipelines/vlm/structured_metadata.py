"""Structured VLM metadata helpers for archive image captioning."""

from __future__ import annotations

import json
import re
from typing import Any


SCHEMA_VERSION = 1
STRUCTURED_FIELDS = {
    "caption",
    "scene_type",
    "visual_subjects",
    "setting",
    "season",
    "aerial_ground_document",
    "search_terms",
    "social_hook",
    "print_quality",
    "quality_notes",
}
ARRAY_FIELDS = {"visual_subjects", "search_terms"}
TEXT_FIELDS = STRUCTURED_FIELDS - ARRAY_FIELDS
QUALITY_VALUES = {"excellent", "good", "fair", "poor", "unknown"}
VIEW_VALUES = {"aerial", "ground", "document", "mixed", "unknown"}
SCENE_TYPES = {
    "street_scene",
    "building",
    "park",
    "waterfront",
    "industrial",
    "residential",
    "aerial_view",
    "map_or_document",
    "event",
    "portrait",
    "interior",
    "unknown",
}


def build_structured_prompt(context: str, variant: str = "detailed") -> str:
    """Wrap record context in the structured JSON task."""
    if variant == "compact":
        return " ".join(
            [
                context,
                "Output only JSON. No markdown. No escaped underscores.",
                'Keys: "caption", "scene_type", "visual_subjects", "setting", "season",',
                '"aerial_ground_document", "search_terms", "social_hook", "print_quality", "quality_notes".',
                "caption: 1-2 factual sentences.",
                "scene_type: street_scene, building, park, waterfront, industrial, residential, aerial_view, map_or_document, event, portrait, interior, or unknown.",
                "visual_subjects: array of up to 8 visible things.",
                "setting: short visible setting.",
                "season: winter, spring, summer, autumn, or unknown.",
                "aerial_ground_document: aerial, ground, document, mixed, or unknown.",
                "search_terms: array of up to 12 concise keywords.",
                "social_hook: one short reason the image may interest Montreal history readers.",
                "print_quality: excellent, good, fair, poor, or unknown.",
                "quality_notes: short note on sharpness, damage, borders, legibility, or composition.",
                "Use unknown when unsure.",
            ]
        )

    return " ".join(
        [
            context,
            "Return ONLY valid JSON with this exact schema:",
            "{",
            '"caption": "2-3 sentence factual visual caption",',
            '"scene_type": "street_scene | building | park | waterfront | industrial | residential | aerial_view | map_or_document | event | portrait | interior | unknown",',
            '"visual_subjects": ["up to 8 visible subjects, objects, places, or activities"],',
            '"setting": "short visible setting description",',
            '"season": "winter | spring | summer | autumn | unknown",',
            '"aerial_ground_document": "aerial | ground | document | mixed | unknown",',
            '"search_terms": ["up to 12 concise search keywords"],',
            '"social_hook": "one short public-facing reason this image may be interesting",',
            '"print_quality": "excellent | good | fair | poor | unknown",',
            '"quality_notes": "short note on sharpness, damage, borders, legibility, or composition"',
            "}",
            "Rules:",
            "- Use only what is visible or strongly implied by the title/date.",
            "- Use unknown when unsure.",
            "- Keep arrays concise and lower-case except proper nouns.",
            "- Do not include markdown, comments, or extra text outside JSON.",
        ]
    )


def extract_json_object(raw_text: str) -> dict[str, Any]:
    """Extract the first JSON object from a model response."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    # LLaVA sometimes markdown-escapes underscores inside JSON keys. That is not
    # valid JSON, but the intent is unambiguous and safe to normalize before parse.
    text = text.replace("\\_", "_")

    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        value = json.loads(text[start : end + 1])

    if not isinstance(value, dict):
        raise ValueError("structured response is not a JSON object")
    return value


def _clean_text(value: Any, default: str = "unknown") -> str:
    if value is None:
        return default
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or default


def _clean_array(value: Any, limit: int) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    cleaned: list[str] = []
    for item in value:
        text = _clean_text(item, "").strip(" .")
        if text and text not in cleaned:
            cleaned.append(text)
        if len(cleaned) >= limit:
            break
    return cleaned


def _normalize_enum(value: Any, allowed: set[str], aliases: dict[str, str] | None = None) -> str:
    text = _clean_text(value).lower().strip()
    text = text.replace(" ", "_").replace("-", "_")
    if aliases and text in aliases:
        text = aliases[text]
    return text if text in allowed else "unknown"


def normalize_structured_metadata(raw_value: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize the structured VLM object."""
    missing = sorted(STRUCTURED_FIELDS - set(raw_value))
    metadata = {
        "caption": _clean_text(raw_value.get("caption")),
        "scene_type": _normalize_enum(raw_value.get("scene_type"), SCENE_TYPES, {
            "aerial": "aerial_view",
            "aerial_ground": "aerial_view",
            "aerial_ground_document": "aerial_view",
            "map": "map_or_document",
            "document": "map_or_document",
        }),
        "visual_subjects": _clean_array(raw_value.get("visual_subjects"), 8),
        "setting": _clean_text(raw_value.get("setting")),
        "season": _normalize_enum(raw_value.get("season"), {"winter", "spring", "summer", "autumn", "unknown"}, {
            "fall": "autumn",
        }),
        "aerial_ground_document": _normalize_enum(raw_value.get("aerial_ground_document"), VIEW_VALUES),
        "search_terms": _clean_array(raw_value.get("search_terms"), 12),
        "social_hook": _clean_text(raw_value.get("social_hook")),
        "print_quality": _normalize_enum(raw_value.get("print_quality"), QUALITY_VALUES),
        "quality_notes": _clean_text(raw_value.get("quality_notes")),
    }

    if not metadata["visual_subjects"]:
        metadata["visual_subjects"] = ["unknown"]
    if not metadata["search_terms"]:
        metadata["search_terms"] = ["unknown"]

    metadata["schema_version"] = SCHEMA_VERSION
    metadata["missing_fields"] = missing
    return metadata


def parse_structured_metadata(raw_text: str) -> tuple[dict[str, Any] | None, str | None]:
    """Parse a model response into normalized metadata, returning an error instead of raising."""
    try:
        return normalize_structured_metadata(extract_json_object(raw_text)), None
    except Exception as exc:
        return None, str(exc)


def apply_model_response(record: dict[str, Any], raw_text: str, generated_at: str) -> bool:
    """Attach structured metadata and backward-compatible caption fields to a record."""
    metadata, error = parse_structured_metadata(raw_text)
    record["vlm_raw_response"] = raw_text
    record["vlm_captioned_at"] = generated_at

    if metadata is None:
        record["vlm_caption"] = _clean_text(raw_text, "")
        record["vlm_metadata"] = None
        record["vlm_metadata_schema_version"] = SCHEMA_VERSION
        record["vlm_metadata_valid"] = False
        record["vlm_metadata_error"] = f"invalid_structured_response: {error}"
        return False

    record["vlm_caption"] = metadata["caption"]
    record["vlm_metadata"] = metadata
    record["vlm_metadata_schema_version"] = SCHEMA_VERSION
    record["vlm_metadata_valid"] = True
    record["vlm_metadata_error"] = None
    return True
