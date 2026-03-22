#!/usr/bin/env python3
"""Format captions from research output for Instagram posts."""

import argparse
import json
import sys
from pathlib import Path

NOIR_MARKERS = (
    "forteresse",
    "mystere architectural",
    "cache bien son jeu",
    "secret",
    "ombre",
    "monolithe",
    "enigme",
)

OFF_BRAND_MARKERS = NOIR_MARKERS + (
    "anomalie",
    "cicatrice",
    "vide parfait",
    "infrastructure silencieuse",
    "chantier fantome",
    "dossier cache",
    "secret mtl",
)


def _evidence_ladder_lines(research: dict) -> list[str]:
    summary = research.get("verification_summary", {}) if research else {}
    if not summary:
        return []
    return [
        "",
        "Evidence Ladder:",
        f"✅ Verified fact: {summary.get('verified_count', 0)}",
        f"🟨 Probable context: {summary.get('probable_count', 0)}",
        f"❓ Open question: {summary.get('open_question_count', 0)}",
    ]


def format_static_caption(research: dict) -> str:
    """Format a bilingual carousel caption using the proven house structure."""
    static_story = ((research or {}).get("public_story") or {}).get("static") or {}
    direct_fr = _clean_public_caption(static_story.get("caption_fr"))
    direct_en = _clean_public_caption(static_story.get("caption_en"))
    direct_fr_ok = bool(
        direct_fr
        and _story_quality_pass(research, "static")
        and _is_static_caption_usable(direct_fr, research, lang="fr")
        and not _looks_off_brand(direct_fr)
    )
    direct_en_ok = bool(
        direct_en
        and _story_quality_pass(research, "static")
        and _is_static_caption_usable(direct_en, research, lang="en")
        and not _looks_off_brand(direct_en)
    )
    if direct_fr_ok and direct_en_ok:
        return "\n\n".join([direct_fr, "—", direct_en])
    if direct_fr_ok:
        return direct_fr

    fr_lines = _format_static_section(research, lang="fr")
    en_lines = _format_static_section(research, lang="en")

    if not fr_lines:
        fallback = []
        if research.get("caption_fr"):
            fallback.append(_clean_public_text(research["caption_fr"]))
        if research.get("caption_en"):
            fallback.append(_clean_public_text(research["caption_en"]))
        if fallback:
            return "\n\n".join(fallback)

    if en_lines:
        return "\n\n".join(fr_lines + ["—"] + en_lines)
    return "\n\n".join(fr_lines)


REEL_CAPTION_STYLE = """You are writing a French caption for an @mtlarchives reel.

VOICE:
- French first, no English translation.
- Sound like a local archivist: precise, warm, image-led, clearly Montreal.
- No hashtags. No evidence ladder. No filler.
- Avoid generic "mystery object" phrasing unless the metadata is genuinely thin.

REFERENCE TEMPERATURE:
Parc Baldwin, entre Rachel et Sherbrooke, Montréal, 25 août 1970
Regardez le rectangle blanc au centre du parc. En 1970, l’été du quartier passait par là.

La piscine Baldwin, c’était le vrai centre de gravité du coin. Avant la clim, avant les écrans, avant qu’on passe l’après-midi enfermés à l’intérieur, les journées chaudes se vivaient dehors: au parc, à la piscine, dans les ruelles, sur les balcons.

Et regardez tout autour. Des rangées de plex à perte de vue. Escaliers, balcons partagés, voisins collés-serrés, fenêtres grandes ouvertes. Le quartier avait son propre bruit: cris d’enfants, radios AM, cordes à linge qui grincent, vaisselle qui cogne dans les cuisines, odeur de chlore et de bitume chaud.

Sous les arbres, les terrains devenaient des mondes entiers. C’était l’époque où les enfants partaient le matin, passaient la journée entre le parc et la ruelle, puis rentraient seulement quand les lumières de la rue s’allumaient.

Cette archive ne montre pas juste un parc. Elle montre un Montréal d’été vécu dehors, ensemble, à l’échelle du quartier.
Qui passait ses journées ici en août 1970?

mtlarchives.com

STRUCTURE:
1. Anchor line with location + date/era when known.
2. Tell the viewer what to look at.
3. Explain the strongest historical context in concrete, local terms.
4. Add the lived detail, change over time, or what survived.
5. End on what the archive reveals now, optionally with one question.
6. Final line: mtlarchives.com
"""


def format_reel_caption(research: dict) -> str:
    """Format caption for reel posts in the proven longform French style."""
    reel_story = ((research or {}).get("public_story") or {}).get("reel") or {}
    direct = _clean_public_caption(reel_story.get("caption_fr"))
    if direct and _is_reel_caption_brand_fit(direct, research):
        return direct

    import os
    api_key = os.environ.get("GEMINI_API_KEY", "")
    use_gemini = os.environ.get("GEMINI_REEL_CAPTION", "").lower() in ("1", "true", "yes")
    
    if use_gemini and api_key:
        try:
            text = _gemini_reel_caption(research, api_key)
            if _is_reel_caption_usable(text):
                return text
            print("   ⚠️ Gemini caption too thin, using template")
        except Exception as e:
            print(f"   ⚠️ Gemini caption failed ({e}), using template")
    
    return _template_reel_caption(research)


def _gemini_reel_caption(research: dict, api_key: str) -> str:
    """Generate reel caption via Gemini with franglais style guide."""
    import os
    import urllib.request

    model = os.environ.get("GEMINI_CAPTION_MODEL", "gemini-2.5-flash")

    # Build research summary for the prompt
    summary_parts = []
    if research.get("title_fr"):
        summary_parts.append(f"Title: {research['title_fr']}")
    if research.get("era"):
        summary_parts.append(f"Era: {research['era']}")
    if research.get("location"):
        summary_parts.append(f"Location: {research['location']}")
    if research.get("scene_fr"):
        summary_parts.append(f"Scene: {research['scene_fr']}")
    if research.get("most_striking_fr"):
        summary_parts.append(f"Most striking: {research['most_striking_fr']}")
    if research.get("lived_context_fr"):
        summary_parts.append(f"Lived context: {research['lived_context_fr']}")
    if research.get("what_changed_fr"):
        summary_parts.append(f"What changed: {research['what_changed_fr']}")
    if research.get("what_survived_fr"):
        summary_parts.append(f"What survived: {research['what_survived_fr']}")
    for d in research.get("details_fr", []):
        summary_parts.append(f"{d.get('name', '')}: {d.get('text', '')}")
    if research.get("closing_reflection_fr"):
        summary_parts.append(f"Closing reflection: {research['closing_reflection_fr']}")
    if research.get("editorial_memo"):
        summary_parts.append(f"Editorial memo: {research['editorial_memo']}")
    
    research_text = "\n".join(summary_parts)
    
    prompt = f"""{REEL_CAPTION_STYLE}

RESEARCH DATA:
{research_text}

Write the Instagram reel caption now. Return ONLY the caption text, nothing else.
Use 5 or 6 paragraphs and end with "mtlarchives.com"."""
    
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 500,
        },
    }
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
        text = result["candidates"][0]["content"]["parts"][0]["text"].strip()
        # Clean up any markdown formatting
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return text


def _template_reel_caption(research: dict) -> str:
    """Fallback template-based reel caption."""
    reel_story = ((research or {}).get("public_story") or {}).get("reel") or {}
    if reel_story and _story_quality_pass(research, "reel"):
        paragraphs = [
            _build_anchor_line(research, lang="fr"),
            _clean_public_text(reel_story.get("visual_fr")),
            _clean_public_text(reel_story.get("teach_fr")),
            _clean_public_text(reel_story.get("change_fr")),
            _clean_public_text(reel_story.get("reflection_fr")),
            _clean_public_text(reel_story.get("closing_fr")),
            "mtlarchives.com",
        ]
        paragraphs = [p for p in paragraphs if p]
        return "\n\n".join(paragraphs)

    paragraphs = [
        _build_anchor_line(research, lang="fr"),
        _lead_with_regardez(_first_nonempty(research.get("most_striking_fr"), _detail_text(research.get("details_fr", []), 0))),
        _first_nonempty(
            _join_sentences(research.get("scene_fr"), research.get("lived_context_fr")),
            _details_block(research.get("details_fr", [])),
        ),
        _first_nonempty(
            _join_sentences(research.get("what_changed_fr"), research.get("what_survived_fr")),
            research.get("what_changed_fr"),
            research.get("what_survived_fr"),
        ),
        _first_nonempty(
            research.get("closing_reflection_fr"),
            _detail_text(research.get("details_fr", []), 2),
        ),
        "mtlarchives.com",
    ]
    paragraphs = [p for p in paragraphs if p]
    return "\n\n".join(paragraphs)


def _clean_public_text(text: str) -> str:
    collapsed = " ".join(str(text or "").replace("—", "-").split()).strip()
    if not collapsed:
        return ""

    tokens = collapsed.split()
    cleaned: list[str] = []
    for token in tokens:
        if cleaned:
            prev = cleaned[-1]
            prev_lower = prev.lower()
            token_lower = token.lower()
            if token_lower == prev_lower:
                continue
            if len(prev_lower) >= 4 and token_lower.startswith(prev_lower):
                cleaned[-1] = token
                continue
        cleaned.append(token)
    return " ".join(cleaned).strip()


def _clean_public_caption(text: str) -> str:
    raw = str(text or "").replace("\r\n", "\n").strip()
    if not raw:
        return ""
    paragraphs = []
    for paragraph in raw.split("\n\n"):
        clean = _clean_public_text(paragraph)
        if clean:
            paragraphs.append(clean)
    return "\n\n".join(paragraphs)


def _story_quality_pass(research: dict, channel: str) -> bool:
    quality = ((research or {}).get("story_quality") or {}).get(channel) or {}
    return bool(quality.get("pass"))


def _looks_too_noir(text: str) -> bool:
    lowered = _clean_public_text(text).lower()
    hits = sum(1 for marker in NOIR_MARKERS if marker in lowered)
    return hits >= 2


def _looks_off_brand(text: str) -> bool:
    lowered = _clean_public_text(text).lower()
    hits = sum(1 for marker in OFF_BRAND_MARKERS if marker in lowered)
    return hits >= 2


def _is_static_caption_usable(text: str, research: dict, lang: str = "fr") -> bool:
    clean = _clean_public_caption(text)
    if not clean or "mtlarchives.com" not in clean.lower():
        return False
    lowered = clean.lower()
    paragraphs = [p for p in clean.split("\n\n") if p.strip()]
    if len(paragraphs) < 4:
        return False
    if lang == "fr":
        has_detail = "le detail le plus marquant" in lowered or "le détail le plus marquant" in lowered
        has_closing_shape = any(
            marker in lowered
            for marker in (
                "ce qui a change",
                "ce qui a changé",
                "ce qui a survecu",
                "ce qui a survécu",
                "ce que l'archive garde",
                "ce que l'image revele",
                "ce que l'image révèle",
                "ce qu'on peut lire",
                "ce qu’on peut lire",
                "ce qu'on ne sait pas encore",
                "ce qu’on ne sait pas encore",
                "ce qui tient encore",
                "ce qui a disparu",
                "la memoire civique",
                "la mémoire civique",
                "le vrai paysage du quartier",
                "autre indice",
            )
        )
        if not has_detail or not has_closing_shape:
            return False
    else:
        has_detail = "most striking detail" in lowered
        has_closing_shape = any(
            marker in lowered
            for marker in (
                "what changed",
                "what survived",
                "what the archive keeps",
                "what the image reveals",
                "what we can read",
                "what remains unresolved",
                "what still holds",
                "what disappeared",
                "civic memory",
                "the feel of the neighborhood",
                "another clue",
            )
        )
        if not has_detail or not has_closing_shape:
            return False
    return _starts_with_anchor(clean, research)


def _is_reel_caption_brand_fit(text: str, research: dict) -> bool:
    if not _is_reel_caption_usable(text):
        return False
    if _looks_off_brand(text):
        return False
    return _starts_with_anchor(text, research)


def _starts_with_anchor(text: str, research: dict) -> bool:
    first_para = _clean_public_text((text or "").split("\n\n", 1)[0])
    if not first_para:
        return False
    location = _clean_public_text(research.get("location"))
    location_short = _clean_public_text(research.get("location_short_fr") or research.get("location_short_en"))
    title = _clean_public_text(research.get("title_fr") or research.get("title_en"))
    era = _clean_public_text(research.get("era"))
    if location and location.lower() in first_para.lower():
        return True
    if location_short and location_short.lower() in first_para.lower():
        return True
    if title and title.lower() in first_para.lower():
        return True
    if era and era.lower() in first_para.lower() and ("montreal" in first_para.lower() or "montréal" in first_para.lower() or location or location_short):
        return True
    return False


def _lead_with_regardez(text: str) -> str:
    sentence = _clean_public_text(text)
    if not sentence:
        return ""
    if sentence.lower().startswith("regardez"):
        return sentence
    sentence = sentence[:1].lower() + sentence[1:] if sentence else sentence
    if sentence and sentence[-1] not in ".!?":
        sentence += "."
    return f"Regardez {sentence}"


def _card_sentence(card: dict | None, lead_with_regardez: bool = False) -> str:
    if not card:
        return ""
    headline = _clean_public_text(card.get("headline"))
    subhead = _clean_public_text(card.get("subhead"))
    if not headline:
        return ""
    sentence = headline
    if lead_with_regardez and not sentence.lower().startswith("regardez"):
        sentence = f"Regardez {sentence[:1].lower()}{sentence[1:]}"
    if subhead:
        sentence = f"{sentence} {subhead}"
    if sentence and sentence[-1] not in ".!?":
        sentence += "."
    return sentence


def _combine_card_sentences(first: dict | None, second: dict | None) -> str:
    parts = [_card_sentence(first), _card_sentence(second)]
    return " ".join(part for part in parts if part).strip()


def _strip_label_prefix(text: str) -> str:
    clean = _clean_public_text(text)
    prefixes = (
        "DOSSIER CACHÉ :",
        "DOSSIER CACHÉ:",
        "DOSSIER CACHE :",
        "DOSSIER CACHE:",
        "SECRET MTL :",
        "SECRET MTL:",
        "MYSTÈRE URBAIN :",
        "MYSTÈRE URBAIN:",
        "MYSTERE URBAIN :",
        "MYSTERE URBAIN:",
        "MÉMOIRE DE QUARTIER :",
        "MEMOIRE DE QUARTIER :",
    )
    for prefix in prefixes:
        if clean.upper().startswith(prefix):
            return clean[len(prefix):].strip()
    return clean


def _build_anchor_line(research: dict, lang: str = "fr") -> str:
    location = _clean_public_text(research.get("location"))
    era = _clean_public_text(research.get("era"))
    title_key = "title_fr" if lang == "fr" else "title_en"
    title = _clean_public_text(research.get(title_key) or research.get("title_fr") or research.get("title_en"))

    if title and title.lower() not in {"montreal", "montréal"}:
        if era and era.lower() not in title.lower():
            return f"{title}, {era}"
        return title
    if location and "inconnu" not in location.lower():
        if era and era in location:
            return location
        return f"{location}, {era}" if era else location
    if title:
        return title
    return "Montréal, couche par couche."


def _format_static_section(research: dict, lang: str) -> list[str]:
    is_fr = lang == "fr"
    scene_key = "scene_fr" if is_fr else "scene_en"
    detail_key = "details_fr" if is_fr else "details_en"
    most_striking_key = "most_striking_fr" if is_fr else "most_striking_en"
    changed_key = "what_changed_fr" if is_fr else "what_changed_en"
    survived_key = "what_survived_fr" if is_fr else "what_survived_en"
    title_key = "title_fr" if is_fr else "title_en"

    intro = _strip_label_prefix(research.get(scene_key) or "")

    details = research.get(detail_key, []) or []
    first_detail = _first_nonempty(research.get(most_striking_key), _detail_text(details, 0))

    close_label = "Ce qui a survécu:" if is_fr else "What survived:"
    close = _clean_public_text(research.get(survived_key))
    if not close:
        close = _clean_public_text(research.get(changed_key))
        if close:
            close_label = "Ce qui a changé:" if is_fr else "What changed:"
    if not close:
        close = _detail_text(details, 1)
        if close:
            close_label = "Autre indice:" if is_fr else "Another clue:"

    if not any([intro, first_detail, close, research.get(title_key)]):
        return []

    most_striking = "Le détail le plus marquant:" if is_fr else "Most striking detail:"
    cta = "Lien en bio pour explorer plus -> mtlarchives.com" if is_fr else "Link in bio for more -> mtlarchives.com"

    lines = [_build_anchor_line(research, lang=lang)]
    if intro:
        lines.append(intro)
    if first_detail:
        lines.append(f"{most_striking}\n{first_detail}")
    if close:
        lines.append(f"{close_label}\n{close}")
    lines.append(cta)
    return [line for line in lines if _clean_public_text(line)]


def _detail_text(details: list[dict], index: int) -> str:
    if index >= len(details):
        return ""
    name = _clean_public_text(details[index].get("name"))
    text = _clean_public_text(details[index].get("text"))
    normalized = name.lower().rstrip(":")
    if normalized in {
        "le détail le plus marquant",
        "most striking detail",
        "ce qui a survécu",
        "what survived",
    }:
        name = ""
    if name and text:
        return f"{name}: {text}"
    return text


def _join_sentences(*parts: str) -> str:
    return " ".join(_clean_public_text(part) for part in parts if _clean_public_text(part)).strip()


def _first_nonempty(*parts):
    for part in parts:
        clean = _clean_public_text(part)
        if clean:
            return clean
    return ""


def _details_block(details: list[dict]) -> str:
    phrases = []
    for detail in details[:2]:
        name = _clean_public_text(detail.get("name"))
        text = _clean_public_text(detail.get("text"))
        if name and text:
            phrases.append(f"{name}: {text}")
        elif text:
            phrases.append(text)
    return " ".join(phrases).strip()


def _is_reel_caption_usable(text: str) -> bool:
    if not text:
        return False
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(paragraphs) < 5:
        return False
    if len(text.strip()) < 220:
        return False
    return text.rstrip().endswith("mtlarchives.com")


# --- CLI ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Format caption from research JSON")
    parser.add_argument("--research", "-r", required=True, help="Path to research.json")
    parser.add_argument("--format", "-f", choices=["static", "reel"], default="static", help="Caption format")
    parser.add_argument("--output", "-o", help="Output path (default: stdout)")
    args = parser.parse_args()

    research_path = Path(args.research)
    if not research_path.exists():
        print(f"❌ Research not found: {research_path}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(research_path.read_text())

    if args.format == "static":
        caption = format_static_caption(data)
    else:
        caption = format_reel_caption(data)

    if args.output:
        Path(args.output).write_text(caption, encoding="utf-8")
        print(f"💾 Saved: {args.output}")
    else:
        print(caption)
