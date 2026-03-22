"""Experimental v2 archival research pipeline using chained Gemini prompts."""
import argparse
import base64
import json
import os
from pathlib import Path

import requests


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set. Add it to .env or export it.")

DEFAULT_MODEL = os.environ.get("GEMINI_RESEARCH_MODEL", "gemini-3.1-pro-preview")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

THEME_GUIDANCE = {
    "nostalgia": (
        "Prioritize lived experience, neighborhood routine, seasonality, and emotional texture. "
        "Good nostalgia output makes the image feel inhabited: heat, shade, pool culture, balconies, laundry, "
        "radios, alleyways, corner stores, and the rhythm of an ordinary Montreal day."
    ),
    "detective": (
        "Prioritize visual clues, social tension, architectural contrast, class signals, and street-level deduction. "
        "Good detective output notices scale, vantage point, signage, vehicles, awnings, and what they imply "
        "about a neighborhood in transition without pretending uncertain clues are solved."
    ),
    "erased history": (
        "Prioritize displacement, demolition, expropriation, and what was sacrificed or overwritten by change. "
        "Good erased-history output identifies the visual contrast between what remains and what is being cut through or lost."
    ),
    "mystery": (
        "Prioritize secrecy, anomalies, hidden stories, and visual details that feel unresolved. "
        "Good mystery output makes the audience curious without leaning on false certainty."
    ),
}


def generate_research_package(
    image_path: str,
    metadata: str,
    *,
    theme: str,
    model: str = DEFAULT_MODEL,
    editorial_brief: str | None = None,
) -> dict:
    """Run the v2 chained research flow and return all intermediate outputs."""
    metadata_block = _normalize_metadata(metadata)
    draft_evidence = _extract_evidence(
        image_path,
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
    )
    audited_evidence = _audit_evidence(
        draft_evidence,
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
    )
    memo = _write_memo(
        audited_evidence,
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
    )
    payload = _write_payload(
        audited_evidence,
        memo,
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
    )
    payload["evidence_ladder"] = {
        "verified_facts": audited_evidence.get("verified_facts", []),
        "probable_context": audited_evidence.get("probable_context", []),
        "open_questions": audited_evidence.get("open_questions", []),
    }
    payload["anti_hallucination_notes"] = audited_evidence.get("anti_hallucination_notes", [])
    payload["verification_summary"] = _verification_summary(audited_evidence)
    payload["editorial_memo"] = memo
    payload["research_model"] = model
    return {
        "model": model,
        "theme": theme,
        "metadata": metadata_block,
        "editorial_brief": editorial_brief,
        "draft_evidence": draft_evidence,
        "audited_evidence": audited_evidence,
        "memo": memo,
        "payload": payload,
    }


def research(image_path: str | Path, context: str = "") -> dict:
    """Drop-in compatible research entrypoint for the live OpenClaw pipeline."""
    parsed = _parse_context(context)
    package = generate_research_package(
        str(image_path),
        parsed["metadata"],
        theme=parsed["theme"],
        model=DEFAULT_MODEL,
        editorial_brief=parsed["editorial_brief"],
    )
    return package["payload"]


def _extract_evidence(
    image_path: str,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    prompt = f"""You are an editorial researcher for @mtlarchives.

The ARCHIVE METADATA below is ground truth.
Do not contradict it.
Do not invent precise landmarks, flags, car makes, neighboring buildings, or historical events unless they are directly supported by the metadata or unmistakable in the image.

ARCHIVE METADATA
{metadata}

Task: extract a research scaffold for a "{theme}" post about this archival Montreal image.
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}

Style target:
- concrete, human, Montreal-literate
- cautious about what is verified versus inferred
- emotionally useful for storytelling, not dry
- no museum-plaque language

Return strict JSON with exactly this structure:
{{
  "visual_anchor": "one sentence",
  "verified_facts": [
    {{
      "claim": "short fact grounded in metadata or obvious image evidence",
      "basis": "archive_metadata or visible_in_image"
    }}
  ],
  "probable_context": [
    {{
      "claim": "plausible contextual statement",
      "why_probable": "why this belongs in probable, not verified"
    }}
  ],
  "open_questions": [
    "question"
  ],
  "anti_hallucination_notes": [
    "things you deliberately refused to claim"
  ]
}}

Requirements:
- 3 or 4 verified_facts max
- 4 or 5 probable_context items
- 3 open_questions
- 2 or 3 anti_hallucination_notes
- verified facts should mostly come from metadata plus obvious visible evidence
- for basis="visible_in_image", use only literal visual descriptions a cautious human could state from pixels alone:
  shape, scale, position, contrast, count, railing, awning, tree canopy, car present, flag present
- do NOT use basis="visible_in_image" for semantic interpretation such as:
  church, parish, borough, Union Jack, pool, terrace, cafe, specific street name, exact vehicle make
- if an object seems likely but not certain, put it in probable_context using cautious language like "likely" or "appears to"
- probable context is where sensory detail and neighborhood life belong
- if you are tempted to name a district, building, flag, vehicle make, or exact function without strong support, do not"""
    return _generate_json(model, [{"text": prompt}, _image_part(image_path)], temperature=0.45)


def _audit_evidence(
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    prompt = f"""You are the fact-discipline editor for @mtlarchives.

Your job is to revise the JSON below without making it bland.
Keep the strongest storytelling material, but downgrade or remove any claim that is not grounded in the metadata or obvious visible evidence.

ARCHIVE METADATA
{metadata}

THEME
{theme}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}

EVIDENCE JSON TO AUDIT
{json.dumps(evidence, ensure_ascii=False, indent=2)}

Rules:
- Keep the same JSON schema.
- Keep vivid probable context when it is clearly framed as inference.
- Remove or soften weak specifics.
- Do not add new unsupported facts during the audit.
- If a verified fact is really just inference, move it to probable_context.
- Treat "visible_in_image" as literal description only, not interpretation.
- Downgrade any verified claim that names a church, parish, borough, flag identity, car make, or exact function of a space unless metadata explicitly supports it.
- Prefer "a flag hangs from the facade" over naming the flag, and "a large light rectangle" over calling it a pool, when certainty is limited.
- Preserve anti_hallucination_notes and add one more if the draft overreached."""
    return _generate_json(model, [{"text": prompt}], temperature=0.2)


def _write_memo(
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> str:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    prompt = f"""You are writing exactly the kind of research memo a human gets from the Gemini app for MTL Archives.

Write a "{theme}" memo using the AUDITED EVIDENCE JSON below as the truth boundary.
Do not promote probable context into verified fact.
Do not add new specifics that are not already supported.

ARCHIVE METADATA
{metadata}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}

AUDITED EVIDENCE JSON
{json.dumps(evidence, ensure_ascii=False, indent=2)}

Style target:
- warm, cinematic, specific, human
- like a smart local historian or architecture detective talking to a friend
- strong sensory detail without fake certainty
- no robotic phrasing

Format exactly like this:

Alright, detective, [1 short thematic intro paragraph].

### The Evidence Ladder: [short thematic title]

**✅ Verified fact**
* [bullet]
* [bullet]
* [bullet]

**🟨 Probable context**
* [bullet]
* [bullet]
* [bullet]

**❓ Open question**
* [bullet]
* [bullet]
* [bullet]

Requirements:
- Prefer the strongest 3 verified facts, strongest 3 probable context items, and strongest 3 open questions.
- Keep the voice lively.
- If the audited evidence uses literal visual phrasing, keep it literal instead of silently upgrading it.
- If the evidence is thin, be elegant instead of overconfident."""
    return _generate_text(model, [{"text": prompt}], temperature=0.55)


def _write_payload(
    evidence: dict,
    memo: str,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    prompt = f"""You are formatting archival research for the live @mtlarchives pipeline.

Use the AUDITED EVIDENCE JSON and EDITORIAL MEMO below as the truth boundary.
Do not add unsupported specifics.
Do not upgrade probable context into verified facts.

ARCHIVE METADATA
{metadata}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}

EDITORIAL MEMO
{memo}

AUDITED EVIDENCE JSON
{json.dumps(evidence, ensure_ascii=False, indent=2)}

Return strict JSON with exactly this shape:
{{
  "title_fr": "...",
  "title_en": "...",
  "era": "...",
  "location": "...",
  "location_short_fr": "...",
  "intro_fr": "...",
  "intro_en": "...",
  "details_fr": [
    {{"name": "...", "text": "..."}},
    {{"name": "...", "text": "..."}},
    {{"name": "...", "text": "..."}}
  ],
  "details_en": [
    {{"name": "...", "text": "..."}},
    {{"name": "...", "text": "..."}},
    {{"name": "...", "text": "..."}}
  ],
  "hook_fr": "...",
  "context_fr": "...",
  "detail_fr": "...",
  "date_clue_fr": "...",
  "legacy_fr": "...",
  "end_hook_fr": "...",
  "badge_fr": "...",
  "story_subhead_fr": "...",
  "meta_fr": "...",
  "credit_fr": "...",
  "music_mood": "nostalgic or editorial",
  "tags": ["..."]
}}

Rules:
- French should feel native, social, and punchy.
- English should feel natural, not mechanically translated.
- Use 3 detail cards only.
- Keep reel card fields short enough for on-screen text.
- For nostalgia themes, optimize for lived experience and community memory.
- For detective themes, optimize for clue-reading and architectural/social tension.
- Keep titles elegant, not clickbait.
- `meta_fr` should be compact and usable in the reel footer.
- `credit_fr` should be compact and archive-oriented."""
    return _generate_json(model, [{"text": prompt}], temperature=0.45)


def _generate_json(model: str, parts: list[dict], *, temperature: float) -> dict:
    text = _generate_content(
        model,
        parts,
        temperature=temperature,
        max_output_tokens=4096,
        response_mime_type="application/json",
    )
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1]
        clean = clean.rsplit("```", 1)[0]
    return json.loads(clean)


def _generate_text(model: str, parts: list[dict], *, temperature: float) -> str:
    return _generate_content(
        model,
        parts,
        temperature=temperature,
        max_output_tokens=4096,
        response_mime_type=None,
    ).strip()


def _generate_content(
    model: str,
    parts: list[dict],
    *,
    temperature: float,
    max_output_tokens: int,
    response_mime_type: str | None,
) -> str:
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }
    if response_mime_type:
        payload["generationConfig"]["responseMimeType"] = response_mime_type

    resp = requests.post(
        GEMINI_URL.format(model=model),
        params={"key": GEMINI_API_KEY},
        json=payload,
        timeout=240,
    )
    resp.raise_for_status()

    data = resp.json()
    parts = data["candidates"][0]["content"].get("parts", [])
    return "".join(part.get("text", "") for part in parts if "text" in part)


def _normalize_metadata(metadata: str) -> str:
    text = metadata.strip()
    if text.startswith("ARCHIVE METADATA"):
        text = text.split("\n", 1)[1].strip()
    return text


def _parse_context(context: str) -> dict:
    text = (context or "").strip()
    if not text:
        return {
            "theme": "MTL Archives",
            "metadata": "",
            "editorial_brief": None,
        }

    metadata = ""
    editorial_brief = None
    theme_block = text

    if "ARCHIVE METADATA" in text:
        before, after = text.split("ARCHIVE METADATA", 1)
        theme_block = before.strip()
        metadata = after.strip()
        if metadata.startswith("(verified"):
            metadata = metadata.split("\n", 1)[1].strip() if "\n" in metadata else ""

    if "EDITORIAL BRIEF" in metadata:
        metadata, editorial_brief = metadata.split("EDITORIAL BRIEF", 1)
        metadata = metadata.strip()
        editorial_brief = editorial_brief.strip(" :\n")
    elif "EDITORIAL BRIEF" in text:
        theme_block, editorial_brief = text.split("EDITORIAL BRIEF", 1)
        theme_block = theme_block.strip()
        editorial_brief = editorial_brief.strip(" :\n")

    theme_line = theme_block.splitlines()[0].strip() if theme_block else "MTL Archives"
    return {
        "theme": theme_line,
        "metadata": _normalize_metadata(metadata),
        "editorial_brief": editorial_brief or None,
    }


def _verification_summary(evidence: dict) -> dict:
    verified = evidence.get("verified_facts", []) or []
    probable = evidence.get("probable_context", []) or []
    questions = evidence.get("open_questions", []) or []
    status = "mixed" if verified and probable else "verified" if verified else "probable" if probable else "unverified"
    return {
        "status": status,
        "verified_count": len(verified),
        "probable_count": len(probable),
        "open_question_count": len(questions),
        "weak_source_domains": [],
        "requires_manual_review": True,
    }


def _theme_guidance(theme: str) -> str:
    lowered = theme.lower()
    for key, guidance in THEME_GUIDANCE.items():
        if key in lowered:
            return guidance
    return (
        "Prioritize a clear visual anchor, careful evidence boundaries, and historically plausible human context. "
        "When uncertain, prefer elegant restraint over flashy specificity."
    )


def _image_part(path: str) -> dict:
    ext = Path(path).suffix.lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }
    mime = mime_map.get(ext, "image/jpeg")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return {"inline_data": {"mime_type": mime, "data": b64}}


def _read_metadata_arg(value: str | None, metadata_file: str | None) -> str:
    if value:
        return value
    if metadata_file:
        return Path(metadata_file).read_text(encoding="utf-8")
    raise SystemExit("Provide --metadata or --metadata-file")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the experimental v2 Gemini research chain")
    parser.add_argument("--image", required=True, help="Path to archival image")
    parser.add_argument("--metadata", help="Metadata text block")
    parser.add_argument("--metadata-file", help="Path to text file with metadata block")
    parser.add_argument("--theme", required=True, help="Theme label for the research run")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Gemini model (default: {DEFAULT_MODEL})")
    parser.add_argument("--brief", help="Optional editorial brief or user-provided research angle")
    parser.add_argument("--output", help="Optional output JSON path")
    args = parser.parse_args()

    metadata = _read_metadata_arg(args.metadata, args.metadata_file)
    result = generate_research_package(
        args.image,
        metadata,
        theme=args.theme,
        model=args.model,
        editorial_brief=args.brief,
    )
    output = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(args.output)
    else:
        print(output)


if __name__ == "__main__":
    main()
