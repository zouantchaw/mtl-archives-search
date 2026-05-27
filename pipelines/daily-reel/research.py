"""Experimental v2 archival research pipeline using chained Gemini prompts."""
import argparse
import base64
import json
import os
import re
import unicodedata
from collections import Counter
from pathlib import Path

import requests


class GeminiRequestError(RuntimeError):
    """Raised when a Gemini API request fails in a user-facing pipeline context."""


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set. Add it to .env or export it.")

DEFAULT_MODEL = os.environ.get("GEMINI_RESEARCH_MODEL", "gemini-3.1-pro-preview")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GROUNDING_MODEL = os.environ.get("GEMINI_GROUNDING_MODEL", DEFAULT_MODEL)
GEMINI_REQUEST_TIMEOUT_SECONDS = max(15, int(os.environ.get("GEMINI_REQUEST_TIMEOUT_SECONDS", "90")))
GEMINI_GROUNDING_TIMEOUT_SECONDS = max(
    15, int(os.environ.get("GEMINI_GROUNDING_TIMEOUT_SECONDS", "45"))
)
SEARCH_GROUNDING_ENABLED = os.environ.get("GEMINI_GOOGLE_SEARCH_GROUNDING", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
GROUNDING_TOOLS = [{"google_search": {}}]
MAX_GROUNDING_SOURCES = max(1, int(os.environ.get("GEMINI_GROUNDING_MAX_SOURCES", "6")))

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
    "beauty": (
        "Prioritize composition, atmosphere, and the strongest visible Montreal anchor. "
        "Good beauty output stays image-led, elegant, and concrete while teaching one thing "
        "the viewer might miss at first glance."
    ),
    "weekend archive": (
        "Prioritize a slower, more reflective reading of the image. Good weekend output stays place-first, "
        "lightly atmospheric, and useful without becoming vague or sentimental."
    ),
    "civic memory": (
        "Prioritize the public role of the place in Montreal life. Good civic-memory output explains "
        "how a landmark, institution, or street scene helped structure the city and what that memory still holds."
    ),
}

THEME_BADGE_HINTS = {
    "nostalgia": "Prefer restrained badge ideas like 'Memoire de quartier', 'Ete montrealais', or 'Quartier vecu'.",
    "detective": "Prefer restrained badge ideas like 'Lecture d'archive', 'Indice montrealais', or 'Scene urbaine'.",
    "erased history": "Prefer restrained badge ideas like 'Histoire effacee', 'Trace perdue', or 'Lieu transforme'.",
    "mystery": "Prefer restrained badge ideas like 'Indice montrealais', 'Lecture d'archive', or 'Mystere urbain'.",
    "beauty": "Prefer restrained badge ideas like 'Beaute d'archive', 'Vue montreal', or 'Image de ville'.",
    "weekend archive": "Prefer restrained badge ideas like 'Week-end d'archive', 'Vue de ville', or 'Montreal en pause'.",
    "civic memory": "Prefer restrained badge ideas like 'Memoire civique', 'Repere montrealais', or 'Ville archive'.",
}

OFF_BRAND_MARKERS = (
    "forteresse",
    "mystere architectural",
    "cache bien son jeu",
    "secret",
    "ombre",
    "monolithe",
    "enigme",
    "anomalie",
    "cicatrice",
    "vide parfait",
    "infrastructure silencieuse",
    "chantier fantome",
    "dossier cache",
    "secret mtl",
    "bastion",
    "bastions",
    "question en suspens",
)

SPECULATION_MARKERS = (
    "suggere",
    "suggerant",
    "suggesting",
    "probable",
    "probables",
    "dissimul",
    "barricad",
    "securis",
    "souterrain",
    "souterraines",
    "station de taxis dediee",
    "poste d'attente",
    "subterranean",
    "secured",
    "barricaded",
)

MINOR_DETAIL_MARKERS = (
    "taxi",
    "taxis",
    "diamond",
    "dedicated taxi stand",
    "taxi stand",
    "transit company",
    "stationnement",
    "parking",
    "chevalet",
    "panneau",
    "bulletin board",
    "bulletin",
    "chauffeur",
    "chauffeurs",
    "voitures",
    "automobiles",
    "curbside",
    "trottoir",
    "sidewalk",
    "drivers",
)

NOSTALGIA_LIVED_MARKERS = (
    "ete",
    "quartier",
    "voisin",
    "voisins",
    "balcon",
    "balcons",
    "ruelle",
    "ruelles",
    "piscine",
    "parc",
    "enfant",
    "enfants",
    "triplex",
    "plex",
    "fenetre",
    "fenetres",
    "linge",
    "radio",
    "depanneur",
    "famille",
    "familles",
    "trottoir",
)

NOSTALGIA_HARD_INFRA_MARKERS = (
    "rond point",
    "carrefour",
    "autoroute",
    "autoroutiere",
    "infrastructure",
    "viaduc",
    "echangeur",
    "traffic circle",
    "highway",
)

TITLE_STOPWORDS = {
    "the",
    "and",
    "des",
    "de",
    "du",
    "la",
    "le",
    "les",
    "angle",
    "corner",
    "avenue",
    "rue",
    "street",
    "at",
    "au",
    "aux",
    "et",
    "entre",
    "sur",
    "old",
    "photo",
}

PUBLIC_LOCATION_STOPWORDS = {
    "montreal",
    "montréal",
    "sector",
    "secteur",
    "intersection",
    "corner",
    "west",
    "ouest",
    "east",
    "est",
    "north",
    "nord",
    "south",
    "sud",
    "street",
    "rue",
    "avenue",
    "boulevard",
    "chemin",
    "road",
    "autoroute",
    "highway",
    "metro",
    "métro",
    "station",
    "years",
    "annees",
    "années",
    "late",
    "early",
    "montrealais",
    "montrealer",
}

STATIC_STYLE_REFERENCE = """Vers 1969, Parc Kent (aujourd'hui Parc Martin-Luther-King Jr.)

Une vue aerienne fascinante d'un parc de quartier en pleine vie.
A droite, on reconnait la piscine Kent, toujours au meme emplacement aujourd'hui.

Le detail le plus marquant:
Parc Kent possedait alors une piste d'athletisme complete (400 m), clairement visible en ovale.
Cette piste a disparu: l'espace a ete transforme en terrain de soccer et en surface verte polyvalente.

Ce qui a survecu:
La piscine est restee en place.
La forme du deck et la position du chalet correspondent encore aux vues actuelles.

Lien en bio pour explorer plus -> mtlarchives.com

-

Circa 1969, Parc Kent (now Martin-Luther-King Jr. Park)

A fascinating aerial view of a busy neighborhood park.
On the right, you can spot Kent Pool, still in the same location today.

Most striking detail:
Parc Kent had a full 400m athletics track, visible as a large oval.
That track is gone today, replaced by soccer and flexible green space.

What survived:
The pool stayed put.
Its deck shape and chalet position still align with modern views.

Link in bio for more -> mtlarchives.com"""

REEL_STYLE_REFERENCE = """Parc Baldwin, entre Rachel et Sherbrooke, Montreal, 25 aout 1970

Regardez le rectangle blanc au centre du parc. En 1970, l'ete du quartier passait par la.

La piscine Baldwin, c'etait le vrai centre de gravite du coin. Avant la clim, avant les ecrans, avant qu'on passe l'apres-midi enfermes a l'interieur, les journees chaudes se vivaient dehors: au parc, a la piscine, dans les ruelles, sur les balcons.

Et regardez tout autour. Des rangees de plex a perte de vue. Escaliers, balcons partages, voisins colles-serres, fenetres grandes ouvertes. Le quartier avait son propre bruit: cris d'enfants, radios AM, cordes a linge qui grincent, vaisselle qui cogne dans les cuisines, odeur de chlore et de bitume chaud.

Sous les arbres, les terrains devenaient des mondes entiers. C'etait l'epoque ou les enfants partaient le matin, passaient la journee entre le parc et la ruelle, puis rentraient seulement quand les lumieres de la rue s'allumaient.

Cette archive ne montre pas juste un parc. Elle montre un Montreal d'ete vecu dehors, ensemble, a l'echelle du quartier.
Qui passait ses journees ici en aout 1970?

mtlarchives.com"""


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
    metadata_fields = _parse_metadata_fields(metadata_block)
    metadata_assessment = _assess_metadata_grounding(metadata_fields)
    grounded_context = _default_grounding_context(reason="not_needed", assessment=metadata_assessment)
    if _should_use_search_grounding(metadata_fields, theme):
        try:
            grounded_context = _ground_with_google_search(
                image_path,
                metadata_block,
                metadata_fields,
                theme=theme,
                model=GROUNDING_MODEL,
                editorial_brief=editorial_brief,
            )
        except Exception as exc:
            grounded_context = _default_grounding_context(
                reason=f"grounding_failed:{type(exc).__name__}",
                assessment=metadata_assessment,
            )
    draft_evidence = _extract_evidence(
        image_path,
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
        grounded_context=grounded_context,
    )
    audited_evidence = _audit_evidence(
        draft_evidence,
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
        grounded_context=grounded_context,
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
        metadata_block,
        theme=theme,
        model=model,
        editorial_brief=editorial_brief,
    )
    payload["theme_key"] = theme
    payload["verification_summary"] = _verification_summary(audited_evidence, grounded_context)
    payload["research_model"] = model
    payload["grounded_context"] = grounded_context
    payload["metadata_assessment"] = metadata_assessment
    payload = _apply_public_confidence_guards(payload, metadata_fields, grounded_context)
    story_quality = {}
    static_story = {}
    reel_story = {}
    static_quality = {"pass": False, "error": "candidate_selection_failed"}
    reel_quality = {"pass": False, "error": "candidate_selection_failed"}
    public_story = {}
    try:
        static_story, static_quality = _select_static_public_story(
            payload,
            audited_evidence,
            metadata_block,
            theme=theme,
            model=model,
            editorial_brief=editorial_brief,
        )
    except Exception:
        static_story = {}
        static_quality = {"pass": False, "error": "candidate_selection_failed"}
    try:
        reel_story, reel_quality = _select_reel_public_story(
            payload,
            audited_evidence,
            metadata_block,
            theme=theme,
            model=model,
            editorial_brief=editorial_brief,
        )
    except Exception:
        reel_story = {}
        reel_quality = {"pass": False, "error": "candidate_selection_failed"}
    public_story = {
        "static": static_story,
        "reel": reel_story,
    }
    story_quality = {
        "static": static_quality,
        "reel": reel_quality,
        "pass": bool(static_quality.get("pass")) and bool(reel_quality.get("pass")),
    }
    payload["evidence_ladder"] = {
        "verified_facts": audited_evidence.get("verified_facts", []),
        "probable_context": audited_evidence.get("probable_context", []),
        "open_questions": audited_evidence.get("open_questions", []),
    }
    payload["anti_hallucination_notes"] = audited_evidence.get("anti_hallucination_notes", [])
    payload["editorial_memo"] = memo
    payload["public_story"] = public_story
    payload["story_quality"] = story_quality
    if static_story.get("caption_fr"):
        payload["caption_fr"] = static_story["caption_fr"]
    if static_story.get("caption_en"):
        payload["caption_en"] = static_story["caption_en"]
    if reel_story.get("caption_fr"):
        payload["reel_caption_fr"] = reel_story["caption_fr"]
    if reel_story.get("cards_fr"):
        payload["reel_cards_fr"] = reel_story["cards_fr"]
    if reel_story.get("badge_fr"):
        payload["reel_badge_fr"] = reel_story["badge_fr"]
    if reel_story.get("subhead_fr"):
        payload["reel_subhead_fr"] = reel_story["subhead_fr"]
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


def refresh_public_story_from_payload(
    payload: dict,
    metadata: str,
    *,
    theme: str,
) -> dict:
    """Rebuild deterministic public story fields from saved research payload.

    This is used by the local fallback when iterating on copy/design from an
    existing package without paying the cost of a fresh Gemini run.
    """
    metadata_block = _normalize_metadata(metadata)
    metadata_fields = _parse_metadata_fields(metadata_block)
    refreshed = json.loads(json.dumps(payload))
    refreshed["theme_key"] = theme
    refreshed["metadata_assessment"] = refreshed.get("metadata_assessment") or _assess_metadata_grounding(metadata_fields)
    refreshed = _apply_public_confidence_guards(
        refreshed,
        metadata_fields,
        refreshed.get("grounded_context") or {},
    )

    static_story = _build_static_template_candidate(refreshed, metadata_fields)
    static_score = _score_static_candidate(static_story, refreshed, metadata_fields)
    static_story["_source"] = "template_refresh"

    reel_story = _build_reel_template_candidate(refreshed, metadata_fields, theme)
    reel_score = _score_reel_candidate(reel_story, refreshed, metadata_fields)
    reel_story["_source"] = "template_refresh"

    refreshed["public_story"] = {
        "static": static_story,
        "reel": reel_story,
    }
    beauty_thin_metadata = "beauty" in _normalize_match(theme or "") and _is_thin_metadata_case(refreshed, metadata_fields)
    refreshed["story_quality"] = {
        "static": {
            "selected_source": "template_refresh",
            "selected_score": static_score["score"],
            "pass": (
                static_score["score"] >= 8
                and not static_score["minor_detail_dominance"]
                and static_score["off_brand_hits"] == 0
                and static_score["unsupported_location_hits"] == 0
                and not beauty_thin_metadata
            ),
            "candidates": [
                {
                    "source": "template_refresh",
                    "score": static_score["score"],
                    "anchor_ok": static_score["anchor_ok"],
                    "off_brand_hits": static_score["off_brand_hits"],
                    "minor_detail_dominance": static_score["minor_detail_dominance"],
                    "unsupported_location_hits": static_score["unsupported_location_hits"],
                }
            ],
        },
        "reel": {
            "selected_source": "template_refresh",
            "selected_score": reel_score["score"],
            "pass": (
                reel_score["score"] >= 9
                and not reel_score["minor_detail_dominance"]
                and reel_score["off_brand_hits"] == 0
                and reel_score["unsupported_location_hits"] == 0
                and not beauty_thin_metadata
            ),
            "candidates": [
                {
                    "source": "template_refresh",
                    "score": reel_score["score"],
                    "anchor_ok": reel_score["anchor_ok"],
                    "off_brand_hits": reel_score["off_brand_hits"],
                    "minor_detail_dominance": reel_score["minor_detail_dominance"],
                    "unsupported_location_hits": reel_score["unsupported_location_hits"],
                }
            ],
        },
        "pass": bool(
            static_score["score"] >= 8
            and reel_score["score"] >= 9
            and static_score["off_brand_hits"] == 0
            and reel_score["off_brand_hits"] == 0
            and not static_score["minor_detail_dominance"]
            and not reel_score["minor_detail_dominance"]
            and static_score["unsupported_location_hits"] == 0
            and reel_score["unsupported_location_hits"] == 0
            and not beauty_thin_metadata
        ),
    }
    if static_story.get("caption_fr"):
        refreshed["caption_fr"] = static_story["caption_fr"]
    if static_story.get("caption_en"):
        refreshed["caption_en"] = static_story["caption_en"]
    if reel_story.get("caption_fr"):
        refreshed["reel_caption_fr"] = reel_story["caption_fr"]
    if reel_story.get("cards_fr"):
        refreshed["reel_cards_fr"] = reel_story["cards_fr"]
    if reel_story.get("badge_fr"):
        refreshed["reel_badge_fr"] = reel_story["badge_fr"]
    if reel_story.get("subhead_fr"):
        refreshed["reel_subhead_fr"] = reel_story["subhead_fr"]
    return refreshed


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
    grounded_context: dict | None = None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    grounding_block = _grounding_context_block(grounded_context)
    prompt = f"""You are an editorial researcher for @mtlarchives.

The ARCHIVE METADATA below is ground truth.
Do not contradict it.
Do not invent precise landmarks, flags, car makes, neighboring buildings, or historical events unless they are directly supported by the metadata or unmistakable in the image.

ARCHIVE METADATA
{metadata}
{grounding_block}

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
- treat any web-grounded context as support for probable_context or open_questions only, never as direct archive metadata
- for basis="visible_in_image", use only literal visual descriptions a cautious human could state from pixels alone:
  shape, scale, position, contrast, count, railing, awning, tree canopy, car present, flag present
- do NOT use basis="visible_in_image" for semantic interpretation such as:
  church, parish, borough, Union Jack, pool, terrace, cafe, specific street name, exact vehicle make
- if an object seems likely but not certain, put it in probable_context using cautious language like "likely" or "appears to"
- probable context is where sensory detail and neighborhood life belong
- if you are tempted to name a district, building, flag, vehicle make, or exact function without strong support, do not
- if the metadata `name` identifies a building, institution, park, bridge, church, or street corner, treat that named subject as primary
- if the metadata `description` highlights a small operational detail like parking, waiting taxis, bulletin boards, machinery hints, or curbside signage, keep it as supporting evidence unless it clearly dominates the frame"""
    return _generate_json(model, [{"text": prompt}, _image_part(image_path)], temperature=0.45)


def _audit_evidence(
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
    grounded_context: dict | None = None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    grounding_block = _grounding_context_block(grounded_context)
    prompt = f"""You are the fact-discipline editor for @mtlarchives.

Your job is to revise the JSON below without making it bland.
Keep the strongest storytelling material, but downgrade or remove any claim that is not grounded in the metadata or obvious visible evidence.

ARCHIVE METADATA
{metadata}
{grounding_block}

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
- If a probable claim depends on web-grounded context, keep it clearly framed as inference unless archive metadata or the image itself corroborates it.
- Treat "visible_in_image" as literal description only, not interpretation.
- Downgrade any verified claim that names a church, parish, borough, flag identity, car make, or exact function of a space unless metadata explicitly supports it.
- Prefer "a flag hangs from the facade" over naming the flag, and "a large light rectangle" over calling it a pool, when certainty is limited.
- Preserve anti_hallucination_notes and add one more if the draft overreached.
- When metadata includes both a named subject and a smaller descriptive clue, keep the named subject as primary unless the image overwhelmingly centers the smaller clue."""
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
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    prompt = f"""You are formatting neutral archival ingredients for the live @mtlarchives pipeline.

Use the AUDITED EVIDENCE JSON as the truth boundary.
Do not add unsupported specifics.
Do not upgrade probable context into verified facts.
Do not write public-ready dramatic copy here.
Do not imitate the themed memo voice.

ARCHIVE METADATA
{metadata}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}

AUDITED EVIDENCE JSON
{json.dumps(evidence, ensure_ascii=False, indent=2)}

Return strict JSON with exactly this shape:
{{
  "title_fr": "...",
  "title_en": "...",
  "era": "...",
  "location": "...",
  "location_short_fr": "...",
  "scene_fr": "...",
  "scene_en": "...",
  "lived_context_fr": "...",
  "lived_context_en": "...",
  "most_striking_fr": "...",
  "most_striking_en": "...",
  "what_changed_fr": "...",
  "what_changed_en": "...",
  "what_survived_fr": "...",
  "what_survived_en": "...",
  "closing_reflection_fr": "...",
  "closing_reflection_en": "...",
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
  "meta_fr": "...",
  "credit_fr": "...",
  "music_mood": "nostalgic or editorial",
  "tags": ["..."]
}}

Rules:
- French should feel native, specific, and usable by a human editor.
- English should feel natural, not mechanically translated.
- These are ingredients, not finished social captions.
- Use 3 detail cards only.
- `scene_*` should plainly describe what the image shows.
- `most_striking_*` should identify one strong visible clue or contrast.
- `what_changed_*` and `what_survived_*` should stay concrete and local.
- `closing_reflection_*` should be brief and grounded, not rhetorical noir.
- If metadata names a building or institution and also mentions a small curbside or operational detail, the building or institution remains the subject and the small detail is secondary.
- Keep titles elegant, not clickbait.
- `meta_fr` should be compact and usable in the reel footer.
- `credit_fr` should be compact and archive-oriented."""
    return _generate_json(model, [{"text": prompt}], temperature=0.35)


def _write_static_public_story(
    payload: dict,
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
    variant_note: str | None = None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    variant_block = f"\nVARIANT FOCUS\n{variant_note}\n" if variant_note else ""
    prompt = f"""You are the final Instagram static-caption editor for @mtlarchives.

Your voice is The Archivist:
- curator, not lecturer
- precise, concise, warm
- nostalgic but not sentimental
- confidently local, globally readable
- evidence over hype

Write public static captions from the neutral archival ingredients below.
Do not imitate the Gemini detective memo voice.
Do not expose research structure.
Do not overplay the theme.

ARCHIVE METADATA
{metadata}
THEME
{theme}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}
{variant_block}

NEUTRAL INGREDIENTS JSON
{json.dumps(payload, ensure_ascii=False, indent=2)}

AUDITED EVIDENCE JSON
{json.dumps(evidence, ensure_ascii=False, indent=2)}

HOUSE STYLE REFERENCE
{STATIC_STYLE_REFERENCE}

Return strict JSON:
{{
  "caption_fr": "...",
  "caption_en": "...",
  "badge_fr": "...",
  "meta_fr": "...",
  "slides_fr": [
    {{"headline": "...", "body": "..."}},
    {{"headline": "...", "body": "..."}},
    {{"headline": "...", "body": "..."}},
    {{"headline": "...", "body": "..."}},
    {{"headline": "...", "body": "..."}}
  ]
}}

Rules:
- Follow the historical MTL Archives structure exactly:
  1. anchor line with Montreal place + date/era
  2. short image-led intro
  3. "Le detail le plus marquant:"
  4. "Ce qui a change:" or "Ce qui a survecu:"
  5. CTA line ending with mtlarchives.com
- Teach one or two concrete things the viewer likely did not notice at first.
- Start from the named Montreal subject, not from a metaphor.
- If metadata names a building or institution and the description mentions a small operational clue, that clue may appear as one detail but not as the main takeaway.
- Use the theme only as a light framing device.
- This is for an Instagram carousel, so the image should do most of the work.
- `slides_fr` must be five concise carousel beats:
  1. cover anchor
  2. visible clue
  3. teachable fact
  4. what changed or survived
  5. site CTA
- Slide headlines should be short, concrete, and image-led.
- Slide bodies are optional and should stay brief.
- No hashtags.
- No noir/thriller vocabulary.
- French first should feel authored, not generated.
- English should preserve the meaning naturally, not word-for-word."""
    return _generate_json(model, [{"text": prompt}], temperature=0.25)


def _write_reel_public_story(
    payload: dict,
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
    variant_note: str | None = None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    variant_block = f"\nVARIANT FOCUS\n{variant_note}\n" if variant_note else ""
    badge_hint = THEME_BADGE_HINTS.get(theme, "Prefer restrained, editorial badge language.")
    prompt = f"""You are the final reel editor for @mtlarchives.

Your voice is The Archivist:
- precise, warm, image-led
- clearly Montreal
- theme as lens, not costume
- evidence over hype

Write a reel package from the neutral archival ingredients below.
Do not imitate the Gemini detective memo voice.
Do not expose research structure.
This reel is optimized for Facebook, where the opening hook and thumbnail matter.

ARCHIVE METADATA
{metadata}
THEME
{theme}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}
{variant_block}

NEUTRAL INGREDIENTS JSON
{json.dumps(payload, ensure_ascii=False, indent=2)}

AUDITED EVIDENCE JSON
{json.dumps(evidence, ensure_ascii=False, indent=2)}

HOUSE STYLE REFERENCE
{REEL_STYLE_REFERENCE}

Return strict JSON:
{{
  "caption_fr": "...",
  "badge_fr": "...",
  "title_fr": "...",
  "subhead_fr": "...",
  "meta_fr": "...",
  "cards_fr": [
    {{"headline": "...", "subhead": "..."}},
    {{"headline": "...", "subhead": "..."}},
    {{"headline": "...", "subhead": "..."}},
    {{"headline": "...", "subhead": "..."}},
    {{"headline": "...", "subhead": "..."}},
    {{"headline": "...", "subhead": "..."}}
  ]
}}

Rules:
- The reel caption must be French only and end with "mtlarchives.com".
- Card 1 is the thumbnail hook. It should be strong, compact, and memorable.
- Facebook hook logic: lead with a place-specific surprise, disappearance, contrast, or civic stake.
- By card 2 or 3, teach one concrete Montreal fact tied to the image.
- The reel caption should feel like an archivist guiding the eye through the image and teaching something concrete about Montreal.
- Start from the named Montreal subject, not from a metaphor.
- Never let one weak probable clue outrank the verified subject named in metadata.
- If a clue is only probable and somewhat obscure, it may appear as support but not as the spine.
- If metadata names a building or institution and the description mentions a small operational clue, that clue may appear once as support but must not dominate the reel cards or caption.
- The reel cards are for on-screen reading: keep them concise, readable, and locally grounded.
- Reel card headlines should be 3-12 words each.
- Reel card subheads should be 4-12 words each.
- Prioritize dominant architectural or spatial clues before small operational details.
- Avoid noir vocabulary such as "ombre", "enigme", "forteresse", "secret", "cache bien son jeu", or "mystere architectural".
- Prefer concrete viewer language like "Regardez", "On voit", "Au coin de", "Ce qui frappe", and "Aujourd'hui".
- Reel card headlines should be declarative observations, not teaser questions.
- Use at most one question mark in the reel caption, ideally only in the closing line.
- Keep `title_fr` plain and location-led, not poetic.
- Keep `subhead_fr` plain and descriptive, ideally location/date or scene descriptor.
- {badge_hint}
- Do not include hashtags.
- Do not use the words "verified", "probable", "open question", or "Evidence Ladder" in public copy."""
    return _generate_json(model, [{"text": prompt}], temperature=0.25)


def _select_static_public_story(
    payload: dict,
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> tuple[dict, dict]:
    metadata_fields = _parse_metadata_fields(metadata)
    candidates: list[tuple[str, dict]] = [
        ("template", _build_static_template_candidate(payload, metadata_fields)),
    ]
    variant_prompts = [
        ("model_balanced", None),
        (
            "model_subject_first",
            "Keep the named Montreal subject firmly at the center. Choose one architectural or spatial clue as the main takeaway, and keep curbside or operational details secondary.",
        ),
        (
            "model_ig_platform_fit",
            "Write this like a historically successful MTL Archives Instagram carousel: place-and-date first, one visible clue early, one teachable fact, then what changed or what survived. Theme stays light and the image stays primary.",
        ),
    ]
    for source, note in variant_prompts:
        try:
            candidate = _write_static_public_story(
                payload,
                evidence,
                metadata,
                theme=theme,
                model=model,
                editorial_brief=editorial_brief,
                variant_note=note,
            )
            candidates.append((source, candidate))
        except Exception:
            continue

    scored = []
    for source, candidate in candidates:
        score = _score_static_candidate(candidate, payload, metadata_fields)
        scored.append({"source": source, "candidate": candidate, **score})
    best = max(scored, key=lambda item: item["score"])
    selected = dict(best["candidate"])
    selected["_source"] = best["source"]
    quality = {
        "selected_source": best["source"],
        "selected_score": best["score"],
        "pass": (
            best["score"] >= 8
            and not best["minor_detail_dominance"]
            and best["off_brand_hits"] == 0
            and best["unsupported_location_hits"] == 0
        ),
        "candidates": [
            {
                "source": item["source"],
                "score": item["score"],
                "anchor_ok": item["anchor_ok"],
                "off_brand_hits": item["off_brand_hits"],
                "minor_detail_dominance": item["minor_detail_dominance"],
                "unsupported_location_hits": item["unsupported_location_hits"],
            }
            for item in scored
        ],
    }
    return selected, quality


def _select_reel_public_story(
    payload: dict,
    evidence: dict,
    metadata: str,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> tuple[dict, dict]:
    metadata_fields = _parse_metadata_fields(metadata)
    candidates: list[tuple[str, dict]] = [
        ("template", _build_reel_template_candidate(payload, metadata_fields, theme)),
    ]
    variant_prompts = [
        ("model_balanced", None),
        (
            "model_subject_first",
            "Keep the named Montreal subject firmly at the center. Choose one architectural or spatial clue as the main takeaway, and keep curbside or operational details secondary. The reel should teach one real thing about the place, not just create intrigue.",
        ),
        (
            "model_fb_hook_first",
            "Write this like a historically strong MTL Archives Facebook reel: a stronger first-card hook for the thumbnail, but still anchored to a real Montreal place by the opening caption and first two cards. The hook should create tension without drifting into generic noir.",
        ),
    ]
    for source, note in variant_prompts:
        try:
            candidate = _write_reel_public_story(
                payload,
                evidence,
                metadata,
                theme=theme,
                model=model,
                editorial_brief=editorial_brief,
                variant_note=note,
            )
            candidates.append((source, candidate))
        except Exception:
            continue

    scored = []
    for source, candidate in candidates:
        score = _score_reel_candidate(candidate, payload, metadata_fields)
        scored.append({"source": source, "candidate": candidate, **score})
    best = max(scored, key=lambda item: item["score"])
    selected = dict(best["candidate"])
    selected["_source"] = best["source"]
    quality = {
        "selected_source": best["source"],
        "selected_score": best["score"],
        "pass": (
            best["score"] >= 9
            and not best["minor_detail_dominance"]
            and best["off_brand_hits"] == 0
            and best["unsupported_location_hits"] == 0
        ),
        "candidates": [
            {
                "source": item["source"],
                "score": item["score"],
                "anchor_ok": item["anchor_ok"],
                "off_brand_hits": item["off_brand_hits"],
                "minor_detail_dominance": item["minor_detail_dominance"],
                "unsupported_location_hits": item["unsupported_location_hits"],
            }
            for item in scored
        ],
    }
    return selected, quality


def _build_static_template_candidate(payload: dict, metadata_fields: dict) -> dict:
    family = _subject_family(metadata_fields, payload)
    theme_key = _normalize_match(payload.get("theme_key") or "")
    anchor_fr = _build_static_anchor_from_payload(payload, metadata_fields, lang="fr")
    anchor_en = _build_static_anchor_from_payload(payload, metadata_fields, lang="en")
    legacy_hook_fr = _clean_sentence(payload.get("hook_fr"))
    legacy_hook_en = _clean_sentence(payload.get("hook_en"))
    legacy_context_fr = _clean_sentence(payload.get("context_fr"))
    legacy_context_en = _clean_sentence(payload.get("context_en"))
    legacy_detail_fr = _clean_sentence(payload.get("detail_fr"))
    legacy_detail_en = _clean_sentence(payload.get("detail_en"))
    legacy_date_fr = _clean_sentence(payload.get("date_clue_fr"))
    legacy_date_en = _clean_sentence(payload.get("date_clue_en"))
    legacy_reflection_fr = _clean_sentence(payload.get("legacy_fr"))
    legacy_reflection_en = _clean_sentence(payload.get("legacy_en"))
    details_fr = payload.get("details_fr") or []
    details_en = payload.get("details_en") or []
    if "beauty" in theme_key:
        beauty_anchor_fr = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _beauty_place_label(payload, metadata_fields, lang="fr")) if part)
        beauty_anchor_en = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _beauty_place_label(payload, metadata_fields, lang="en")) if part)
        intro_fr = _beauty_intro_line(payload, metadata_fields, lang="fr")
        intro_en = _beauty_intro_line(payload, metadata_fields, lang="en")
        detail_fr = _beauty_detail_line(payload, metadata_fields, lang="fr")
        detail_en = _beauty_detail_line(payload, metadata_fields, lang="en")
        hold_fr = _beauty_hold_line(payload, metadata_fields, lang="fr")
        hold_en = _beauty_hold_line(payload, metadata_fields, lang="en")
        reflection_fr = _beauty_reflection_line(payload, metadata_fields, lang="fr")
        reflection_en = _beauty_reflection_line(payload, metadata_fields, lang="en")
        fr_parts = [
            beauty_anchor_fr or anchor_fr,
            intro_fr,
            f"Le détail le plus marquant :\n{detail_fr}" if detail_fr else "",
            f"Ce qui tient encore :\n{hold_fr}" if hold_fr else "",
            reflection_fr,
            "Lien en bio pour explorer plus -> mtlarchives.com",
        ]
        en_parts = [
            beauty_anchor_en or anchor_en,
            intro_en,
            f"Most striking detail:\n{detail_en}" if detail_en else "",
            f"What still holds:\n{hold_en}" if hold_en else "",
            reflection_en,
            "Link in bio for more -> mtlarchives.com",
        ]
        slides_fr = [
            {
                "headline": _carousel_headline(beauty_anchor_fr or anchor_fr),
                "body": _short_card_subhead(intro_fr),
            },
            {
                "headline": "Un détail à voir",
                "body": _short_card_subhead(detail_fr),
            },
            {
                "headline": "Ce qui tient encore",
                "body": _short_card_subhead(hold_fr),
            },
            {
                "headline": "Pourquoi l'image tient",
                "body": _short_card_subhead(reflection_fr),
            },
            {
                "headline": "Voir l'archive entière",
                "body": _short_card_subhead("Le contexte complet sur mtlarchives.com"),
            },
        ]
        return {
            "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
            "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
            "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
            "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
            "slides_fr": slides_fr,
        }
    if "mystery" in theme_key and _is_thin_metadata_case(payload, metadata_fields):
        mystery_anchor_fr = _mystery_anchor_label(payload, metadata_fields, lang="fr")
        mystery_anchor_en = _mystery_anchor_label(payload, metadata_fields, lang="en")
        intro_fr = _mystery_intro_line(payload, metadata_fields, lang="fr")
        intro_en = _mystery_intro_line(payload, metadata_fields, lang="en")
        detail_fr = _mystery_detail_line(payload, metadata_fields, lang="fr")
        detail_en = _mystery_detail_line(payload, metadata_fields, lang="en")
        context_fr = _mystery_context_line(payload, metadata_fields, lang="fr")
        context_en = _mystery_context_line(payload, metadata_fields, lang="en")
        unresolved_fr = _mystery_unresolved_line(payload, metadata_fields, lang="fr")
        unresolved_en = _mystery_unresolved_line(payload, metadata_fields, lang="en")
        fr_parts = [
            mystery_anchor_fr,
            intro_fr,
            f"Le détail le plus marquant :\n{detail_fr}" if detail_fr else "",
            f"Ce qu'on peut lire :\n{context_fr}" if context_fr else "",
            f"Ce qu'on ne sait pas encore :\n{unresolved_fr}" if unresolved_fr else "",
            "Lien en bio pour explorer plus -> mtlarchives.com",
        ]
        en_parts = [
            mystery_anchor_en,
            intro_en,
            f"Most striking detail:\n{detail_en}" if detail_en else "",
            f"What we can read:\n{context_en}" if context_en else "",
            f"What remains unresolved:\n{unresolved_en}" if unresolved_en else "",
            "Link in bio for more -> mtlarchives.com",
        ]
        slides_fr = [
            {
                "headline": _carousel_headline(mystery_anchor_fr),
                "body": _short_card_subhead(intro_fr),
            },
            {
                "headline": "La frontière visible",
                "body": _short_card_subhead(detail_fr),
            },
            {
                "headline": "Ce qu'on peut lire",
                "body": _short_card_subhead(context_fr),
            },
            {
                "headline": "Ce qui manque encore",
                "body": _short_card_subhead(unresolved_fr),
            },
            {
                "headline": "Poursuivre l'enquête",
                "body": _short_card_subhead("Le contexte complet sur mtlarchives.com"),
            },
        ]
        return {
            "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
            "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
            "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
            "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
            "slides_fr": slides_fr,
        }
    if "weekend archive" in theme_key:
        weekend_anchor_fr = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _weekend_place_label(payload, metadata_fields, lang="fr")) if part)
        weekend_anchor_en = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _weekend_place_label(payload, metadata_fields, lang="en")) if part)
        intro_fr = _weekend_intro_line(payload, metadata_fields, lang="fr")
        intro_en = _weekend_intro_line(payload, metadata_fields, lang="en")
        detail_fr = _weekend_detail_line(payload, metadata_fields, lang="fr")
        detail_en = _weekend_detail_line(payload, metadata_fields, lang="en")
        place_line_fr = _weekend_place_context_line(payload, metadata_fields, lang="fr")
        place_line_en = _weekend_place_context_line(payload, metadata_fields, lang="en")
        hold_line_fr = _weekend_enduring_line(payload, metadata_fields, lang="fr")
        hold_line_en = _weekend_enduring_line(payload, metadata_fields, lang="en")
        reflection_fr = _weekend_reflection_line(payload, metadata_fields, lang="fr")
        reflection_en = _weekend_reflection_line(payload, metadata_fields, lang="en")
        fr_parts = [
            weekend_anchor_fr or anchor_fr,
            intro_fr,
            f"Le détail le plus marquant :\n{detail_fr}" if detail_fr else "",
            f"Ce que l'image révèle :\n{place_line_fr}" if place_line_fr else "",
            f"Ce qui tient encore :\n{hold_line_fr}" if hold_line_fr else "",
            reflection_fr,
            "Lien en bio pour explorer plus -> mtlarchives.com",
        ]
        en_parts = [
            weekend_anchor_en or anchor_en,
            intro_en,
            f"Most striking detail:\n{detail_en}" if detail_en else "",
            f"What the image reveals:\n{place_line_en}" if place_line_en else "",
            f"What still holds:\n{hold_line_en}" if hold_line_en else "",
            reflection_en,
            "Link in bio for more -> mtlarchives.com",
        ]
        slides_fr = [
            {
                "headline": _carousel_headline(weekend_anchor_fr or anchor_fr),
                "body": _short_card_subhead(intro_fr or detail_fr),
            },
            {
                "headline": "Un détail à relire",
                "body": _short_card_subhead(detail_fr),
            },
            {
                "headline": "Le paysage du quartier",
                "body": _short_card_subhead(place_line_fr),
            },
            {
                "headline": "Ce qui tient encore",
                "body": _short_card_subhead(hold_line_fr),
            },
            {
                "headline": "Voir plus loin",
                "body": _short_card_subhead(reflection_fr or "Le contexte complet sur mtlarchives.com"),
            },
        ]
        return {
            "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
            "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
            "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
            "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
            "slides_fr": slides_fr,
        }
    if "civic memory" in theme_key:
        civic_anchor_fr = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _civic_place_label(payload, metadata_fields, lang="fr")) if part)
        civic_anchor_en = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _civic_place_label(payload, metadata_fields, lang="en")) if part)
        intro_fr = _civic_intro_line(payload, metadata_fields, lang="fr")
        intro_en = _civic_intro_line(payload, metadata_fields, lang="en")
        detail_fr = _civic_detail_line(payload, metadata_fields, lang="fr")
        detail_en = _civic_detail_line(payload, metadata_fields, lang="en")
        survived_fr = _civic_survival_line(payload, metadata_fields, lang="fr")
        survived_en = _civic_survival_line(payload, metadata_fields, lang="en")
        changed_fr = _civic_change_line(payload, metadata_fields, lang="fr")
        changed_en = _civic_change_line(payload, metadata_fields, lang="en")
        reflection_fr = _civic_reflection_line(payload, metadata_fields, lang="fr")
        reflection_en = _civic_reflection_line(payload, metadata_fields, lang="en")
        fr_parts = [
            civic_anchor_fr or anchor_fr,
            intro_fr,
            f"Le détail le plus marquant :\n{detail_fr}" if detail_fr else "",
            f"Ce qui a survécu :\n{survived_fr}" if survived_fr else "",
            f"Ce qui a changé :\n{changed_fr}" if changed_fr else "",
            reflection_fr,
            "Lien en bio pour explorer plus -> mtlarchives.com",
        ]
        en_parts = [
            civic_anchor_en or anchor_en,
            intro_en,
            f"Most striking detail:\n{detail_en}" if detail_en else "",
            f"What survived:\n{survived_en}" if survived_en else "",
            f"What changed:\n{changed_en}" if changed_en else "",
            reflection_en,
            "Link in bio for more -> mtlarchives.com",
        ]
        slides_fr = [
            {
                "headline": _carousel_headline(civic_anchor_fr or anchor_fr),
                "body": _short_card_subhead(intro_fr or detail_fr),
            },
            {
                "headline": "La place publique",
                "body": _short_card_subhead(detail_fr),
            },
            {
                "headline": "Ce qui tient encore",
                "body": _short_card_subhead(survived_fr),
            },
            {
                "headline": "Ce qui a disparu",
                "body": _short_card_subhead(changed_fr),
            },
            {
                "headline": "La mémoire civique",
                "body": _short_card_subhead(reflection_fr or "Le contexte complet sur mtlarchives.com"),
            },
        ]
        return {
            "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
            "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
            "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
            "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
            "slides_fr": slides_fr,
        }
    if family == "infrastructure" and "erased" in theme_key and any(
        (legacy_hook_fr, legacy_context_fr, legacy_detail_fr, legacy_date_fr, legacy_reflection_fr)
    ):
        anchor_fr = ", ".join(
            part for part in (_clean_sentence(payload.get("location_short_fr")), _clean_sentence(payload.get("era"))) if part
        ) or anchor_fr
        anchor_en = ", ".join(
            part for part in (_clean_sentence(payload.get("location_short_en") or payload.get("location_short_fr")), _clean_sentence(payload.get("era"))) if part
        ) or anchor_en
        sanctuary_fr = _clean_sentence((details_fr[0] or {}).get("text") if details_fr else "") or _clean_sentence(payload.get("context_fr")) or _best_primary_detail(payload, metadata_fields, lang="fr")
        sanctuary_en = _clean_sentence((details_en[0] or {}).get("text") if details_en else "") or _clean_sentence(payload.get("context_en")) or _best_primary_detail(payload, metadata_fields, lang="en")
        buried_fr = _clean_sentence((details_fr[1] or {}).get("text") if len(details_fr) > 1 else "") or legacy_detail_fr
        buried_en = _clean_sentence((details_en[1] or {}).get("text") if len(details_en) > 1 else "") or legacy_detail_en
        roar_fr = _clean_sentence((details_fr[2] or {}).get("text") if len(details_fr) > 2 else "") or legacy_date_fr
        roar_en = _clean_sentence((details_en[2] or {}).get("text") if len(details_en) > 2 else "") or legacy_date_en
        legacy_line_fr = legacy_reflection_fr or _best_reflection(payload, metadata_fields, lang="fr")
        legacy_line_en = legacy_reflection_en or _best_reflection(payload, metadata_fields, lang="en")
        intro_fr = sanctuary_fr
        if sanctuary_fr and "grand ensemble au bord de l'eau" not in _normalize_match(sanctuary_fr):
            intro_fr = _join_clean("Regardez le grand ensemble au bord de l'eau.", sanctuary_fr)
        intro_en = sanctuary_en
        if sanctuary_en and "large complex by the water" not in _normalize_match(sanctuary_en) and "large riverside complex" not in _normalize_match(sanctuary_en):
            intro_en = _join_clean("Look at the large complex by the water.", sanctuary_en)
        fr_parts = [
            anchor_fr,
            intro_fr,
            f"Le detail le plus marquant :\n{buried_fr}" if buried_fr else "",
            f"Le basculement du lieu :\n{roar_fr}" if roar_fr else "",
            f"Ce que l'archive garde :\n{legacy_line_fr}" if legacy_line_fr else "",
            "Lien en bio pour explorer plus -> mtlarchives.com",
        ]
        en_parts = [
            anchor_en,
            intro_en,
            f"Most striking detail:\n{buried_en}" if buried_en else "",
            f"The turning point:\n{roar_en}" if roar_en else "",
            f"What the archive keeps:\n{legacy_line_en}" if legacy_line_en else "",
            "Link in bio for more -> mtlarchives.com",
        ]
        slides_fr = [
            {
                "headline": _carousel_headline(anchor_fr),
                "body": _short_card_subhead(legacy_hook_fr or sanctuary_fr),
            },
            {
                "headline": "Le sanctuaire fracture",
                "body": _short_card_subhead(sanctuary_fr),
            },
            {
                "headline": "Les traces enterrees",
                "body": _short_card_subhead(buried_fr),
            },
            {
                "headline": "Le silence bascule",
                "body": _short_card_subhead(roar_fr),
            },
            {
                "headline": "Ce qui a ete sacrifie",
                "body": _short_card_subhead(legacy_line_fr or "Le contexte complet sur mtlarchives.com"),
            },
        ]
        return {
            "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
            "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
            "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
            "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
            "slides_fr": slides_fr,
        }
    if family == "park" and "nostalgia" in theme_key and any(
        (legacy_hook_fr, legacy_context_fr, legacy_detail_fr, legacy_date_fr, legacy_reflection_fr)
    ):
        intro_fr = _join_clean(legacy_hook_fr, legacy_context_fr)
        intro_en = _join_clean(legacy_hook_en, legacy_context_en)
        detail_fr = _best_primary_detail(payload, metadata_fields, lang="fr") or legacy_detail_fr
        detail_en = _best_primary_detail(payload, metadata_fields, lang="en") or legacy_detail_en
        close_fr = legacy_date_fr or _best_lived_context(payload, metadata_fields, lang="fr")
        close_en = legacy_date_en or _best_lived_context(payload, metadata_fields, lang="en")
        follow_fr = legacy_reflection_fr or _best_reflection(payload, metadata_fields, lang="fr")
        follow_en = legacy_reflection_en or _best_reflection(payload, metadata_fields, lang="en")
        close_label_fr = "Le vrai paysage du quartier :"
        close_label_en = "The feel of the neighborhood:"
        follow_label_fr = "Ce que l'archive garde :"
        follow_label_en = "What the archive keeps:"
        fr_parts = [
            anchor_fr,
            intro_fr,
            f"Le détail le plus marquant :\n{detail_fr}" if detail_fr else "",
            f"{close_label_fr}\n{close_fr}" if close_fr else "",
            f"{follow_label_fr}\n{follow_fr}" if follow_fr else "",
            "Lien en bio pour explorer plus -> mtlarchives.com",
        ]
        en_parts = [
            anchor_en,
            intro_en,
            f"Most striking detail:\n{detail_en}" if detail_en else "",
            f"{close_label_en}\n{close_en}" if close_en else "",
            f"{follow_label_en}\n{follow_en}" if follow_en else "",
            "Link in bio for more -> mtlarchives.com",
        ]
        slides_fr = [
            {
                "headline": _carousel_headline(anchor_fr),
                "body": _short_card_subhead(legacy_hook_fr or legacy_context_fr or detail_fr),
            },
            {
                "headline": _detail_slide_headline(payload, metadata_fields, lang="fr"),
                "body": _short_card_subhead(detail_fr),
            },
            {
                "headline": _context_slide_headline(payload, metadata_fields, lang="fr"),
                "body": _short_card_subhead(legacy_context_fr or close_fr),
            },
            {
                "headline": "Le son de l'été",
                "body": _short_card_subhead(close_fr),
            },
            {
                "headline": "La mémoire du quartier",
                "body": _short_card_subhead(follow_fr or "Le contexte complet sur mtlarchives.com"),
            },
        ]
        return {
            "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
            "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
            "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
            "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
            "slides_fr": slides_fr,
        }
    if family == "institution":
        intro_fr = _institution_intro_line(payload, metadata_fields, lang="fr")
        intro_en = _institution_intro_line(payload, metadata_fields, lang="en")
        detail_fr = _institution_teaching_detail(payload, metadata_fields, lang="fr") or _best_primary_detail(payload, metadata_fields, lang="fr")
        detail_en = _institution_teaching_detail(payload, metadata_fields, lang="en") or _best_primary_detail(payload, metadata_fields, lang="en")
    else:
        intro_fr = _join_clean(
            _best_scene_line(payload, metadata_fields, lang="fr"),
            _best_lived_context(payload, metadata_fields, lang="fr"),
        )
        intro_en = _join_clean(
            _best_scene_line(payload, metadata_fields, lang="en"),
            _best_lived_context(payload, metadata_fields, lang="en"),
        )
        detail_fr = _best_primary_detail(payload, metadata_fields, lang="fr")
        detail_en = _best_primary_detail(payload, metadata_fields, lang="en")
    close_fr, close_label_fr = _best_change_or_survival(payload, metadata_fields, lang="fr", avoid=detail_fr)
    close_en, close_label_en = _best_change_or_survival(payload, metadata_fields, lang="en", avoid=detail_en)
    follow_fr, follow_label_fr = _secondary_change_or_survival(
        payload,
        metadata_fields,
        lang="fr",
        primary_label=close_label_fr,
        avoid=(detail_fr, close_fr),
    )
    follow_en, follow_label_en = _secondary_change_or_survival(
        payload,
        metadata_fields,
        lang="en",
        primary_label=close_label_en,
        avoid=(detail_en, close_en),
    )
    reflection_fr = _best_reflection(payload, metadata_fields, lang="fr")
    reflection_en = _best_reflection(payload, metadata_fields, lang="en")

    fr_parts = [
        anchor_fr,
        intro_fr,
        f"Le détail le plus marquant :\n{detail_fr}" if detail_fr else "",
        f"{close_label_fr}\n{close_fr}" if close_fr else "",
        f"{follow_label_fr}\n{follow_fr}" if follow_fr else "",
        reflection_fr if not follow_fr else "",
        "Lien en bio pour explorer plus -> mtlarchives.com",
    ]
    en_parts = [
        anchor_en,
        intro_en,
        f"Most striking detail:\n{detail_en}" if detail_en else "",
        f"{close_label_en}\n{close_en}" if close_en else "",
        f"{follow_label_en}\n{follow_en}" if follow_en else "",
        reflection_en if not follow_en else "",
        "Link in bio for more -> mtlarchives.com",
    ]
    slides_fr = [
        {
            "headline": _carousel_headline(anchor_fr),
            "body": _short_card_subhead(intro_fr or detail_fr),
        },
        {
            "headline": _detail_slide_headline(payload, metadata_fields, lang="fr"),
            "body": _short_card_subhead(_visual_focus_line(payload, metadata_fields, lang="fr")),
        },
        {
            "headline": _context_slide_headline(payload, metadata_fields, lang="fr"),
            "body": _short_card_subhead(_teaching_line(payload, metadata_fields, lang="fr")),
        },
        {
            "headline": _change_slide_headline(payload, metadata_fields, close_fr, lang="fr"),
            "body": _short_card_subhead(close_fr),
        },
        {
            "headline": _closing_slide_headline(payload, metadata_fields, follow_label_fr, lang="fr"),
            "body": _short_card_subhead(follow_fr or reflection_fr or "Le contexte complet sur mtlarchives.com"),
        },
    ]
    return {
        "caption_fr": "\n\n".join(part for part in fr_parts if part).strip(),
        "caption_en": "\n\n".join(part for part in en_parts if part).strip(),
        "badge_fr": _default_public_badge(payload.get("theme_key") or ""),
        "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
        "slides_fr": slides_fr,
    }


def _build_reel_template_candidate(payload: dict, metadata_fields: dict, theme: str) -> dict:
    family = _subject_family(metadata_fields, payload)
    theme_key = _normalize_match(theme or payload.get("theme_key") or "")
    anchor = _build_anchor_from_payload(payload, metadata_fields, lang="fr")
    hook = _hook_thumbnail_line(payload, metadata_fields, theme, lang="fr")
    visual = _visual_focus_line(payload, metadata_fields, lang="fr")
    teach = _teaching_line(payload, metadata_fields, lang="fr")
    close = _change_line(payload, metadata_fields, lang="fr")
    reflection = _reflection_line(payload, metadata_fields, lang="fr")
    closing = _closing_prompt_line(payload, metadata_fields, theme, lang="fr")
    details_fr = payload.get("details_fr") or []
    if "beauty" in theme_key:
        anchor = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _beauty_place_label(payload, metadata_fields, lang="fr")) if part) or anchor
        hook = _beauty_hook_line(payload, metadata_fields, lang="fr")
        visual = _beauty_detail_line(payload, metadata_fields, lang="fr")
        teach = _beauty_intro_line(payload, metadata_fields, lang="fr")
        close = _beauty_hold_line(payload, metadata_fields, lang="fr")
        reflection = _beauty_reflection_line(payload, metadata_fields, lang="fr")
        closing = "Le contexte complet sur mtlarchives.com."
    if "mystery" in theme_key and _is_thin_metadata_case(payload, metadata_fields):
        anchor = _mystery_anchor_label(payload, metadata_fields, lang="fr")
        hook = _mystery_hook_line(payload, metadata_fields, lang="fr")
        visual = _mystery_detail_line(payload, metadata_fields, lang="fr")
        teach = _mystery_context_line(payload, metadata_fields, lang="fr")
        close = _mystery_unresolved_line(payload, metadata_fields, lang="fr")
        reflection = "Le contexte complet sur mtlarchives.com."
        closing = "Ce relief vous rappelle-t-il un coin précis de Montréal ?"
    if "weekend archive" in theme_key:
        anchor = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _weekend_place_label(payload, metadata_fields, lang="fr")) if part) or anchor
        hook = _weekend_hook_line(payload, metadata_fields, lang="fr")
        visual = _weekend_detail_line(payload, metadata_fields, lang="fr")
        teach = _weekend_place_context_line(payload, metadata_fields, lang="fr")
        close = _weekend_enduring_line(payload, metadata_fields, lang="fr")
        reflection = _weekend_reflection_line(payload, metadata_fields, lang="fr")
        closing = "Le contexte complet sur mtlarchives.com."
    if "civic memory" in theme_key:
        anchor = ", ".join(part for part in (_display_era_label(payload, metadata_fields), _civic_place_label(payload, metadata_fields, lang="fr")) if part) or anchor
        hook = _civic_hook_line(payload, metadata_fields, lang="fr")
        visual = _civic_detail_line(payload, metadata_fields, lang="fr")
        teach = _civic_intro_line(payload, metadata_fields, lang="fr")
        close = _civic_change_line(payload, metadata_fields, lang="fr")
        reflection = _civic_survival_line(payload, metadata_fields, lang="fr")
        closing = "Le contexte complet sur mtlarchives.com."
    if family == "infrastructure" and "erased" in theme_key:
        anchor = ", ".join(
            part for part in (_clean_sentence(payload.get("location_short_fr")), _clean_sentence(payload.get("era"))) if part
        ) or anchor
        hook = "À Cartierville, ce chantier a effacé un paysage entier."
        visual = _clean_sentence((details_fr[0] or {}).get("text") if details_fr else "") or _clean_sentence(payload.get("context_fr")) or visual
        if visual and "grand ensemble au bord de l'eau" not in _normalize_match(visual):
            visual = _join_clean("Regardez le grand ensemble au bord de l'eau.", visual)
        teach = _clean_sentence((details_fr[1] or {}).get("text") if len(details_fr) > 1 else "") or _clean_sentence(payload.get("detail_fr")) or teach
        close = _clean_sentence((details_fr[2] or {}).get("text") if len(details_fr) > 2 else "") or _clean_sentence(payload.get("date_clue_fr")) or close
        reflection = _clean_sentence(payload.get("legacy_fr")) or reflection
        closing = "Qui se souvient encore de ce bord de riviere avant l'autoroute ?"
    if family == "park" and "nostalgia" in theme_key:
        hook = _clean_sentence(payload.get("hook_fr")) or hook
        visual = _best_primary_detail(payload, metadata_fields, lang="fr") or visual
        teach = _clean_sentence(payload.get("detail_fr")) or teach
        close = _clean_sentence(payload.get("date_clue_fr")) or close
        reflection = _clean_sentence(payload.get("legacy_fr")) or reflection
        closing = _clean_sentence(payload.get("end_hook_fr")) or closing

    caption_parts = [
        anchor,
        hook,
        visual,
        teach,
        close,
        reflection,
        closing,
        "mtlarchives.com",
    ]

    cards = [
        {
            "headline": _short_card_headline(hook, fallback="Montréal, couche par couche"),
            "subhead": _short_card_subhead(anchor),
        },
        {
            "headline": _detail_card_headline(visual, metadata_fields, payload),
            "subhead": _short_card_subhead(visual),
        },
        {
            "headline": _context_card_headline(metadata_fields, payload),
            "subhead": _short_card_subhead(teach),
        },
        {
            "headline": _change_card_headline(metadata_fields, payload),
            "subhead": _short_card_subhead(close),
        },
        {
            "headline": _support_card_headline(metadata_fields, payload),
            "subhead": _short_card_subhead(reflection),
        },
        {
            "headline": _short_card_headline(closing, fallback="Montréal, couche par couche"),
            "subhead": "Le contexte complet sur mtlarchives.com",
        },
    ]
    if family == "infrastructure" and "erased" in theme_key:
        cards = [
            {
                "headline": _short_card_headline(hook, fallback="Montréal, couche par couche"),
                "subhead": _short_card_subhead(anchor),
            },
            {
                "headline": "Le refuge au bord de l'eau",
                "subhead": _short_card_subhead(visual),
            },
            {
                "headline": "Les traces enterrees",
                "subhead": _short_card_subhead(teach),
            },
            {
                "headline": "Le silence bascule",
                "subhead": _short_card_subhead(close),
            },
            {
                "headline": "Ce qui a ete sacrifie",
                "subhead": _short_card_subhead(reflection),
            },
            {
                "headline": _short_card_headline(closing, fallback="Montréal, couche par couche"),
                "subhead": "Le contexte complet sur mtlarchives.com",
            },
        ]

    return {
        "caption_fr": "\n\n".join(part for part in caption_parts if part).strip(),
        "badge_fr": _default_public_badge(theme),
        "title_fr": _plain_title(metadata_fields, payload),
        "subhead_fr": _plain_subhead(payload, metadata_fields),
        "meta_fr": payload.get("meta_fr") or metadata_fields.get("archive reference") or "",
        "cta_fr": "Le contexte complet sur mtlarchives.com.",
        "hook_fr": hook,
        "visual_fr": visual,
        "teach_fr": teach,
        "change_fr": close,
        "reflection_fr": reflection,
        "closing_fr": closing,
        "cards_fr": cards,
    }


def _hook_thumbnail_line(payload: dict, metadata_fields: dict, theme: str, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    subject = _french_subject_label(metadata_fields, payload) if lang == "fr" else _short_subject(metadata_fields, payload, lang=lang)
    subject_open = _sentence_opening(subject) if lang == "fr" else subject
    place = _hook_place_phrase(payload, metadata_fields, lang=lang)
    theme_key = _normalize_match(theme)
    if lang == "fr":
        if family == "park":
            if "nostalgia" in theme_key:
                return f"{place}, l'été du quartier passait par ici." if place else "En 1970, l'été du quartier passait par ici."
            return f"{place}, {subject_open.lower()} tenait le quartier en mouvement." if place else f"{subject_open} tenait le quartier en mouvement."
        if family == "institution":
            title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
            if "ymca" in title:
                if any(token in theme_key for token in ("mystery", "detective")):
                    return f"{place}, ce YMCA était plus qu'un gymnase." if place else "Ce YMCA était plus qu'un gymnase."
                return f"{place}, le YMCA structurait déjà la vie du quartier." if place else "Le YMCA structurait déjà la vie du quartier."
            if any(token in theme_key for token in ("mystery", "detective")):
                return f"{place}, {subject_open.lower()} occupait déjà une place clé." if place else f"{subject_open} occupait déjà une place clé."
            return f"{place}, {subject_open.lower()} marquait déjà la vie du quartier." if place else f"{subject_open} marquait déjà la vie du quartier."
        if family == "hotel":
            return f"{place}, une nouvelle façade bousculait déjà l'ancienne rue." if place else "Deux immeubles. Deux époques. Une rue qui change."
        if family == "church":
            return f"{place}, {subject_open.lower()} dominait encore le secteur." if place else f"{subject_open} dominait encore le secteur."
        if family == "infrastructure":
            if "erased" in theme_key:
                return f"{place}, ce chantier a effacé un paysage entier." if place else "Ce chantier a effacé un paysage entier."
            if place and _place_duplicates_subject(place, subject_open):
                return f"{place}, le territoire changeait déjà de forme."
            return f"{place}, {subject_open.lower()} redessinait déjà le territoire." if place else f"{subject_open} redessinait déjà le territoire."
        if family == "market":
            changed = _clean_sentence(payload.get("what_changed_fr"))
            if _is_strong_loss_line(changed):
                return f"{place}, ce marché a disparu en 1966." if place else "Ce marché a disparu en 1966."
            if "erased" in theme_key:
                return f"{place}, ce marché a disparu, mais pas sa trace." if place else "Ce marché a disparu, mais pas sa trace."
            return f"{place}, {subject_open.lower()} faisait battre le quartier." if place else f"{subject_open} faisait battre le quartier."
        return f"{place}, un morceau de Montréal est en train de changer." if place else f"{subject_open} révèle un Montréal en pleine transformation."
    if family == "park":
        return f"{place}, the neighborhood moved to the rhythm of {subject}." if place else f"{subject} moved to the rhythm of the neighborhood."
    if family == "institution":
        return f"{place}, {subject} already anchored this block." if place else f"{subject} already anchored this block."
    if family == "hotel":
        return f"{place}, two eras met on the same street." if place else "Two eras. One street in transition."
    if family == "church":
        return f"{place}, {subject} still dominated the district." if place else f"{subject} still dominated the district."
    if family == "infrastructure":
        return f"{place}, {subject} was already reshaping the territory." if place else f"{subject} was already reshaping the territory."
    if family == "market":
        return f"{place}, {subject} pulsed at the center of local life." if place else f"{subject} pulsed at the center of local life."
    return f"{subject} reveals a changing Montreal."


def _visual_focus_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if family == "institution":
        sign_claim = _find_evidence_claim(payload, ("y.m.c.a.", "ymca", "sign"))
        if sign_claim:
            if lang == "fr":
                return "Regardez l'enseigne Y.M.C.A. sur la façade."
            return "Look at the Y.M.C.A. sign on the façade."
    detail = _visible_detail_line(_best_primary_detail(payload, metadata_fields, lang=lang))
    if not detail or _is_minor_detail_line(detail, metadata_fields) or _is_overwrought_line(detail):
        detail = _best_scene_line(payload, metadata_fields, lang=lang)
    if lang == "fr":
        return _lead_with_regardez_local(detail)
    sentence = _clean_sentence(detail)
    if not sentence:
        return ""
    lowered = sentence[:1].lower() + sentence[1:] if sentence else sentence
    if lowered and lowered[-1] not in ".!?":
        lowered += "."
    return f"Look at {lowered}"


def _teaching_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if family == "institution":
        special = _institution_teaching_detail(payload, metadata_fields, lang=lang)
        if special:
            return special
    primary = _best_lived_context(payload, metadata_fields, lang=lang)
    supporting = _best_supporting_detail(
        payload,
        metadata_fields,
        lang=lang,
        avoid=_best_primary_detail(payload, metadata_fields, lang=lang),
    )
    if supporting and (_is_minor_detail_line(supporting, metadata_fields) or _is_overwrought_line(supporting)):
        supporting = ""
    if supporting and _subject_hits(supporting, metadata_fields) == 0:
        supporting = ""
    return _join_clean(primary, supporting)


def _change_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    text, _label = _best_change_or_survival(
        payload,
        metadata_fields,
        lang=lang,
        avoid=_best_primary_detail(payload, metadata_fields, lang=lang),
    )
    sentence = _clean_sentence(text)
    if not sentence:
        sentence = _generic_change_line(metadata_fields, payload, lang=lang)
    return sentence


def _reflection_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    sentence = _clean_sentence(_best_reflection(payload, metadata_fields, lang=lang))
    if sentence:
        return sentence
    return _generic_reflection(metadata_fields, payload, lang=lang)


def _closing_prompt_line(payload: dict, metadata_fields: dict, theme: str, *, lang: str) -> str:
    subject = _french_subject_label(metadata_fields, payload) if lang == "fr" else _short_subject(metadata_fields, payload, lang=lang)
    theme_key = _normalize_match(theme)
    family = _subject_family(metadata_fields, payload)
    if lang == "fr":
        if "erased" in theme_key:
            return f"Que reste-t-il aujourd'hui {_french_subject_after_de(subject)} ?"
        if "nostalgia" in theme_key and family == "park":
            return "Qui passait ses journees ici a l'epoque ?"
        return f"Qui se souvient encore {_french_subject_after_de(subject)} ?"
    if "erased" in theme_key:
        return f"What remains today of {subject}?"
    return f"Who still remembers {subject}?"


def _find_evidence_claim(payload: dict, needles: tuple[str, ...]) -> str:
    ladder = payload.get("evidence_ladder") or {}
    buckets = list(ladder.get("verified_facts") or []) + list(ladder.get("probable_context") or [])
    for item in buckets:
        claim = _clean_sentence((item or {}).get("claim"))
        lowered = _normalize_match(claim)
        if claim and any(needle in lowered for needle in needles):
            return claim
    return ""


def _institution_teaching_detail(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if "ymca" in title:
        if lang == "fr":
            return "À l'époque, il réunissait sport, hébergement et vie communautaire dans un même bâtiment."
        return "At the time, it combined sport, lodging, and community life in one building."
    return ""


def _institution_intro_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if "ymca" in title:
        if lang == "fr":
            return "En façade, l'enseigne Y.M.C.A. rappelle qu'on est devant bien plus qu'un simple gymnase sur l'avenue du Parc."
        return "On the façade, the Y.M.C.A. sign makes it clear this was more than a simple gym on Parc Avenue."
    return _join_clean(
        _best_scene_line(payload, metadata_fields, lang=lang),
        _best_lived_context(payload, metadata_fields, lang=lang),
    )


def _institution_primary_detail(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if "ymca" in title:
        claim = _find_evidence_claim(payload, ("y.m.c.a", "ymca", "enseigne", "facade", "façade"))
        if lang == "fr":
            if claim:
                return "L'enseigne Y.M.C.A. visible sur la façade rappelle que le bâtiment affichait clairement sa fonction dans la rue."
            return "La façade du YMCA, avec son enseigne bien visible, annonçait clairement sa présence sur l'avenue du Parc."
        if claim:
            return "The Y.M.C.A. sign on the facade shows that the building clearly announced its role to the street."
        return "The YMCA facade, with its visible sign, clearly announced the building's role on Parc Avenue."
    return ""


def _institution_change_or_survival(payload: dict, metadata_fields: dict, *, lang: str) -> tuple[str, str] | None:
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if "ymca" in title:
        if lang == "fr":
            return (
                "Le coin a changé de rythme, mais cette façade rappelle encore l'époque où de grandes institutions animaient directement la rue.",
                "Ce qui a changé :",
            )
        return (
            "The corner has changed its rhythm, but this facade still points back to a time when large institutions animated the street directly.",
            "What changed:",
        )
    return None


def _institution_reflection(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if "ymca" in title:
        if lang == "fr":
            return "Cette archive rappelle comment, à Montréal, une institution de quartier pouvait structurer tout un coin de rue."
        return "This archive shows how a neighborhood institution could shape the life of an entire Montreal street corner."
    return ""


def _score_static_candidate(candidate: dict, payload: dict, metadata_fields: dict) -> dict:
    text = str(candidate.get("caption_fr", "")).strip()
    lowered = _normalize_match(text)
    theme_key = _normalize_match(payload.get("theme_key") or "")
    anchor_ok = _starts_with_anchor(text, payload, metadata_fields)
    off_brand_hits = _off_brand_hits(text)
    minor_detail_dominance = _minor_detail_dominance(text, metadata_fields)
    speculative_hits = _speculation_hits(text)
    has_detail = "le detail le plus marquant" in lowered
    has_change = "ce qui a change" in lowered or "ce qui a survecu" in lowered
    subject_hits = _subject_hits(text, metadata_fields)
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    early_text = " ".join(paragraphs[:2])
    early_minor = _minor_detail_hits(early_text) > 0
    slides = candidate.get("slides_fr") or []
    slide_count_ok = len(slides) == 5
    slide_anchor_ok = bool(slides and _starts_with_anchor(str(slides[0].get("headline", "")), payload, metadata_fields))
    slide_cta_ok = bool(slides and "mtlarchives.com" in _normalize_match(f"{slides[-1].get('headline', '')} {slides[-1].get('body', '')}"))
    unsupported_location_hits = _unsupported_location_hits(
        " ".join(
            [
                text,
                " ".join(f"{slide.get('headline', '')} {slide.get('body', '')}" for slide in slides),
                str(candidate.get("meta_fr", "")),
                str(candidate.get("title_fr", "")),
            ]
        ),
        payload,
    )

    score = 0
    score += 3 if anchor_ok else 0
    score += 2 if "mtlarchives.com" in lowered else 0
    score += 2 if has_detail else 0
    score += 2 if has_change else 0
    score += 2 if subject_hits > 0 else 0
    score += 1 if 4 <= len(paragraphs) <= 6 else 0
    score += 2 if slide_count_ok else 0
    score += 1 if slide_anchor_ok else 0
    score += 1 if slide_cta_ok else 0
    score -= off_brand_hits * 2
    score -= 3 if minor_detail_dominance else 0
    score -= speculative_hits * 2
    score -= 3 if early_minor else 0
    score -= 8 if "beauty" in theme_key and _is_thin_metadata_case(payload, metadata_fields) else 0
    score -= unsupported_location_hits * 5
    nostalgia_penalty = _nostalgia_theme_penalty(text, payload, metadata_fields)
    score -= nostalgia_penalty

    return {
        "score": score,
        "anchor_ok": anchor_ok,
        "off_brand_hits": off_brand_hits,
        "minor_detail_dominance": minor_detail_dominance,
        "nostalgia_penalty": nostalgia_penalty,
        "unsupported_location_hits": unsupported_location_hits,
    }


def _score_reel_candidate(candidate: dict, payload: dict, metadata_fields: dict) -> dict:
    caption = str(candidate.get("caption_fr", "")).strip()
    lowered = _normalize_match(caption)
    theme_key = _normalize_match(payload.get("theme_key") or "")
    anchor_ok = _starts_with_anchor(caption, payload, metadata_fields)
    cards = candidate.get("cards_fr") or []
    card_text = " ".join(f"{card.get('headline', '')} {card.get('subhead', '')}" for card in cards)
    extra_text = " ".join(
        str(candidate.get(key, "")).strip()
        for key in ("title_fr", "subhead_fr", "hook_fr", "visual_fr", "teach_fr", "change_fr", "reflection_fr", "closing_fr")
    )
    off_brand_hits = _off_brand_hits(" ".join(part for part in (caption, extra_text, card_text) if part))
    minor_detail_dominance = _minor_detail_dominance(caption + " " + card_text, metadata_fields)
    speculative_hits = _speculation_hits(caption + " " + card_text)
    subject_hits = _subject_hits(caption + " " + candidate.get("title_fr", "") + " " + card_text, metadata_fields)
    paragraphs = [p for p in caption.split("\n\n") if p.strip()]
    readable_cards = sum(1 for card in cards if 4 <= len((card.get("headline", "") or "").split()) <= 16)
    restrained_badge = 4 <= len((candidate.get("badge_fr", "") or "").strip()) <= 24
    hook_words = len(_clean_sentence(candidate.get("hook_fr", "")).split())
    strong_hook = 4 <= hook_words <= 12
    hook_text = _clean_sentence(candidate.get("hook_fr", ""))
    hook_distinct = _normalize_match(hook_text) != _normalize_match(candidate.get("title_fr", ""))
    hook_subject_hits = _subject_hits(" ".join([hook_text, candidate.get("title_fr", ""), candidate.get("subhead_fr", "")]), metadata_fields)
    hook_place_phrase = _hook_place_phrase(payload, metadata_fields, lang="fr")
    hook_place_ok = bool(hook_place_phrase and _normalize_match(hook_place_phrase) in _normalize_match(hook_text))
    hook_minor = _minor_detail_hits(hook_text) > 0
    teaches = len(_clean_sentence(candidate.get("teach_fr", "")).split()) >= 7
    early_text = " ".join(paragraphs[:3])
    early_minor = _minor_detail_hits(early_text) > 0
    closing_cta_ok = "mtlarchives.com" in _normalize_match(" ".join([
        str(candidate.get("cta_fr", "")),
        str((cards[-1] or {}).get("headline", "")) if cards else "",
        str((cards[-1] or {}).get("subhead", "")) if cards else "",
    ]))
    question_marks = caption.count("?") + sum(str(card.get("headline", "")).count("?") + str(card.get("subhead", "")).count("?") for card in cards)
    unsupported_location_hits = _unsupported_location_hits(
        " ".join(
            part
            for part in (
                caption,
                card_text,
                extra_text,
                str(candidate.get("meta_fr", "")),
                str(candidate.get("title_fr", "")),
                str(candidate.get("subhead_fr", "")),
            )
            if part
        ),
        payload,
    )

    score = 0
    score += 3 if anchor_ok else 0
    score += 2 if len(paragraphs) >= 5 else 0
    score += 1 if "mtlarchives.com" in lowered else 0
    score += 2 if len(cards) == 6 else 0
    score += 2 if subject_hits > 0 else 0
    score += 1 if readable_cards >= 5 else 0
    score += 1 if restrained_badge else 0
    score += 2 if strong_hook else 0
    score += 1 if hook_distinct else 0
    score += 1 if hook_subject_hits > 0 else 0
    score += 1 if hook_place_ok else 0
    score += 1 if teaches else 0
    score += 1 if closing_cta_ok else 0
    score += 1 if question_marks <= 1 else 0
    score -= off_brand_hits * 2
    score -= 4 if minor_detail_dominance else 0
    score -= speculative_hits * 2
    score -= 3 if early_minor else 0
    score -= 2 if hook_minor else 0
    score -= 8 if "beauty" in theme_key and _is_thin_metadata_case(payload, metadata_fields) else 0
    score -= unsupported_location_hits * 5
    nostalgia_penalty = _nostalgia_theme_penalty(" ".join(part for part in (caption, card_text, extra_text) if part), payload, metadata_fields)
    score -= nostalgia_penalty

    return {
        "score": score,
        "anchor_ok": anchor_ok,
        "off_brand_hits": off_brand_hits,
        "minor_detail_dominance": minor_detail_dominance,
        "nostalgia_penalty": nostalgia_penalty,
        "unsupported_location_hits": unsupported_location_hits,
    }


def _nostalgia_theme_penalty(text: str, payload: dict, metadata_fields: dict) -> int:
    theme_key = _normalize_match(payload.get("theme_key") or "")
    if "nostalgia" not in theme_key:
        return 0

    lowered = _normalize_match(text)
    family = _subject_family(metadata_fields, payload)
    lived_hits = sum(1 for marker in NOSTALGIA_LIVED_MARKERS if marker in lowered)
    infra_hits = sum(1 for marker in NOSTALGIA_HARD_INFRA_MARKERS if marker in lowered)
    thin_metadata = _is_thin_metadata_case(payload, metadata_fields)

    penalty = 0
    if lived_hits < 2:
        penalty += 4
    if infra_hits > 0 and lived_hits < 4:
        penalty += 4
    if family == "infrastructure":
        penalty += 4
    if thin_metadata and lived_hits < 3:
        penalty += 3
    return penalty


def _parse_metadata_fields(metadata: str) -> dict:
    fields: dict[str, str] = {}
    for raw_line in str(metadata or "").splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip().lower()] = value.strip()
    return fields


def _normalize_match(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or ""))
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return ascii_text.lower()


def _tokenize(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9']+", _normalize_match(text)) if token]


def _subject_keywords(metadata_fields: dict, payload: dict) -> list[str]:
    title = metadata_fields.get("title") or payload.get("title_fr") or payload.get("title_en") or ""
    keywords: list[str] = []
    uppercase_codes = re.findall(r"\(([A-Z0-9]{2,})\)", str(title))
    for code in uppercase_codes:
        keywords.append(code.lower())
    base = re.split(r"\s+\(", str(title), maxsplit=1)[0]
    for token in _tokenize(base):
        if token in TITLE_STOPWORDS:
            continue
        if len(token) >= 4:
            keywords.append(token)
    deduped = []
    for token in keywords:
        if token not in deduped:
            deduped.append(token)
    return deduped[:6]


def _subject_hits(text: str, metadata_fields: dict) -> int:
    lowered = _normalize_match(text)
    hits = 0
    for keyword in _subject_keywords(metadata_fields, {}):
        if keyword and keyword in lowered:
            hits += 1
    return hits


def _minor_detail_dominance(text: str, metadata_fields: dict) -> bool:
    lowered = _normalize_match(text)
    minor_hits = _minor_detail_hits(text)
    subject_hits = max(1, _subject_hits(text, metadata_fields))
    title = _normalize_match(metadata_fields.get("title", ""))
    named_subject = any(marker in title for marker in ("ymca", "hotel", "hôtel", "eglise", "parc", "pont", "church", "market", "marche", "maison"))
    return named_subject and minor_hits > subject_hits


def _off_brand_hits(text: str) -> int:
    lowered = _normalize_match(text)
    return sum(1 for marker in OFF_BRAND_MARKERS if marker in lowered) + _speculation_hits(text)


def _minor_detail_hits(text: str) -> int:
    lowered = _normalize_match(text)
    return sum(lowered.count(marker) for marker in MINOR_DETAIL_MARKERS)


def _speculation_hits(text: str) -> int:
    lowered = _normalize_match(text)
    return sum(1 for marker in SPECULATION_MARKERS if marker in lowered)


def _is_minor_detail_line(text: str, metadata_fields: dict) -> bool:
    clean = _clean_sentence(text)
    if not clean:
        return False
    minor_hits = _minor_detail_hits(clean)
    if minor_hits == 0:
        return False
    return _minor_detail_dominance(clean, metadata_fields) or _subject_hits(clean, metadata_fields) == 0


def _is_overwrought_line(text: str) -> bool:
    clean = _clean_sentence(text)
    if not clean:
        return False
    return _speculation_hits(clean) >= 2


def _starts_with_anchor(text: str, payload: dict, metadata_fields: dict) -> bool:
    first_para = str(text or "").split("\n\n", 1)[0]
    lowered = _normalize_match(first_para)
    location = _normalize_match(payload.get("location") or "")
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    era = _normalize_match(payload.get("era") or metadata_fields.get("date") or "")
    if location and location in lowered:
        return True
    if title and any(token in lowered for token in _subject_keywords(metadata_fields, payload)):
        return True
    if era and era in lowered and ("montreal" in lowered or "montreal" in location):
        return True
    return False


def _unsupported_location_hits(text: str, payload: dict) -> int:
    if payload.get("exact_location_public_safe", True):
        return 0
    lowered = _normalize_match(text)
    hits = 0
    for term in payload.get("suppressed_location_terms") or []:
        normalized = _normalize_match(term)
        if normalized and normalized in lowered:
            hits += 1
    return hits


def _carousel_headline(text: str) -> str:
    sentence = _clean_sentence(text)
    if not sentence:
        return ""
    sentence = sentence.replace("Le détail le plus marquant :", "").replace("Le détail le plus marquant:", "").strip()
    sentence = sentence.replace("Ce qui a changé :", "").replace("Ce qui a changé:", "").strip()
    sentence = sentence.replace("Ce qui a survécu :", "").replace("Ce qui a survécu:", "").strip()
    return sentence[:120]


def _detail_slide_headline(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if lang == "fr" and family == "market":
        return "L'enseigne du marché"
    if lang == "en" and family == "market":
        return "The market sign"
    detail_key = "details_fr" if lang == "fr" else "details_en"
    details = payload.get(detail_key) or []
    for item in details:
        name = _clean_sentence((item or {}).get("name"))
        if name and 3 <= len(name) <= 40:
            return name
    if lang == "fr":
        return {
            "market": "Le marché dans la rue",
            "institution": "La façade parle",
            "park": "Un détail à repérer",
            "hotel": "Deux époques face à face",
            "infrastructure": "Un chantier à lire",
        }.get(family, "Un détail à repérer")
    return {
        "market": "The market spills outside",
        "institution": "The facade speaks",
        "park": "A clue to spot",
        "hotel": "Two eras face to face",
        "infrastructure": "Reading the worksite",
    }.get(family, "A clue to spot")


def _context_slide_headline(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if lang == "fr":
        return {
            "market": "Au coeur de la Main",
            "institution": "Une institution de quartier",
            "park": "La vie du quartier",
            "hotel": "Une rue qui bascule",
            "infrastructure": "Le territoire change",
        }.get(family, "Le contexte du lieu")
    return {
        "market": "At the heart of the Main",
        "institution": "A neighborhood institution",
        "park": "Neighborhood life",
        "hotel": "A street in transition",
        "infrastructure": "The territory shifts",
    }.get(family, "Local context")


def _change_slide_headline(payload: dict, metadata_fields: dict, text: str, *, lang: str) -> str:
    sentence = _clean_sentence(text)
    normalized = _normalize_match(sentence)
    years = re.findall(r"\b(?:18|19|20)\d{2}\b", sentence)
    year = years[-1] if years else ""
    if lang == "fr":
        if "demoli" in normalized and year:
            return f"Démoli en {year}"
        if "disparu" in normalized and year:
            return f"Disparu en {year}"
        if "efface" in normalized:
            return "Un lieu effacé"
        return "Ce qui a changé"
    if "demolished" in normalized and year:
        return f"Demolished in {year}"
    if "disappeared" in normalized and year:
        return f"Gone by {year}"
    return "What changed"


def _closing_slide_headline(payload: dict, metadata_fields: dict, label: str, *, lang: str) -> str:
    normalized = _normalize_match(label)
    if lang == "fr":
        if "surv" in normalized:
            return "Ce qui a survécu"
        return "Pourquoi ça compte encore"
    if "surv" in normalized:
        return "What survived"
    return "Why it still matters"


def _normalize_subject_case(text: str) -> str:
    clean = _clean_sentence(text)
    lowered = _normalize_match(clean)
    replacements = (
        ("parc ", "Parc "),
        ("marché ", "Marché "),
        ("marche ", "Marché "),
        ("hôtel ", "Hôtel "),
        ("hotel ", "Hôtel "),
        ("église ", "Église "),
        ("eglise ", "Église "),
        ("pont ", "Pont "),
        ("canal ", "Canal "),
        ("ymca", "YMCA"),
    )
    for prefix, replacement in replacements:
        if lowered.startswith(prefix):
            return replacement + clean[len(prefix):]
    return clean


def _trim_subject_noise(text: str) -> str:
    clean = _clean_sentence(text)
    if not clean:
        return ""
    first_segment = re.split(r"\s+-\s+", clean, maxsplit=1)[0].strip()
    for marker in (" entre ", " secteur ", " quartier ", " angle ", " au coin ", " à l'angle ", " a l'angle "):
        lowered = _normalize_match(first_segment)
        idx = lowered.find(marker.strip())
        if idx > 0:
            first_segment = first_segment[:idx].strip(" ,-/")
            break
    return first_segment


def _extract_subject_candidate(text: str) -> str:
    clean = _clean_sentence(text)
    if not clean:
        return ""
    direct = _trim_subject_noise(clean)
    lowered_direct = _normalize_match(direct)
    if "ymca" in lowered_direct:
        if "avenue du parc" in lowered_direct:
            return "YMCA, avenue du Parc"
        return "YMCA"
    if direct.lower().startswith(("boulevard ", "avenue ", "rue ", "route ", "autoroute ")):
        direct = ""
    if direct and any(
        token in lowered_direct
        for token in ("parc ", "marché ", "marche ", "hôtel ", "hotel ", "église ", "eglise ", "pont ", "canal ")
    ):
        return _normalize_subject_case(direct)

    pattern_specs = (
        r"(Parc\s+[A-Za-zÀ-ÿ0-9'’.-]+(?:\s+[A-Za-zÀ-ÿ0-9'’.-]+){0,3})",
        r"(March[ée]\s+[A-Za-zÀ-ÿ0-9'’.-]+(?:\s+[A-Za-zÀ-ÿ0-9'’.-]+){0,4})",
        r"(H[ôo]tel\s+[A-Za-zÀ-ÿ0-9'’.-]+(?:\s+[A-Za-zÀ-ÿ0-9'’.-]+){0,3})",
        r"(É?glise\s+[A-Za-zÀ-ÿ0-9'’.-]+(?:\s+[A-Za-zÀ-ÿ0-9'’.-]+){0,4})",
        r"(Pont\s+[A-Za-zÀ-ÿ0-9'’.-]+(?:\s+[A-Za-zÀ-ÿ0-9'’.-]+){0,4})",
        r"(Canal\s+[A-Za-zÀ-ÿ0-9'’.-]+(?:\s+[A-Za-zÀ-ÿ0-9'’.-]+){0,3})",
    )
    for pattern in pattern_specs:
        match = re.search(pattern, clean, flags=re.IGNORECASE)
        if match:
            return _normalize_subject_case(_trim_subject_noise(match.group(1)))

    return ""


def _best_subject_name(metadata_fields: dict, payload: dict) -> str:
    candidates = [
        payload.get("location_short_fr"),
        payload.get("title_fr"),
        payload.get("location"),
        metadata_fields.get("title"),
    ]
    for raw in candidates:
        clean = _clean_sentence(raw)
        if not clean:
            continue
        for candidate in (clean.split("/", 1)[0].strip(), clean):
            subject = _extract_subject_candidate(candidate)
            if subject:
                return subject

    fallback = _clean_sentence(payload.get("title_fr") or metadata_fields.get("title") or "Montréal")
    fallback = re.split(r"\s+\(", fallback, maxsplit=1)[0].strip()
    fallback = re.split(r"\s+-\s+", fallback, maxsplit=1)[0].strip()
    return fallback[:72] if fallback else "Montréal"


def _subject_location_context(payload: dict, subject: str) -> str:
    location = _clean_sentence(payload.get("location") or "")
    if not location:
        return ""
    subject_clean = _clean_sentence(subject)
    if subject_clean and _normalize_match(location).startswith(_normalize_match(subject_clean)):
        trimmed = location[len(subject_clean):].lstrip(" ,-/")
        if trimmed.startswith("(") and trimmed.endswith(")") and len(trimmed) > 2:
            trimmed = trimmed[1:-1].strip()
        return trimmed
    return location


def _place_duplicates_subject(place: str, subject: str) -> bool:
    place_clean = _normalize_match(place)
    subject_clean = _normalize_match(subject)
    if not place_clean or not subject_clean:
        return False

    stripped_place = re.sub(r"^(a|au|aux|sur|dans|in|at|on)\s+", "", place_clean).strip()
    return subject_clean in stripped_place or stripped_place in subject_clean


def _hook_place_phrase(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    subject = _best_subject_name(metadata_fields, payload)
    subject_lower = _normalize_match(subject)
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    location = _clean_sentence(payload.get("location_short_fr") or payload.get("location") or "")
    location_lower = _normalize_match(location)

    if "parc baldwin" in subject_lower or "parc baldwin" in title or "parc baldwin" in location_lower:
        return "Au parc Baldwin" if lang == "fr" else "At Parc Baldwin"
    if "parc kent" in subject_lower or "parc kent" in title or "parc kent" in location_lower:
        return "Au parc Kent" if lang == "fr" else "At Parc Kent"
    if "avenue du parc" in title or "avenue du parc" in location_lower:
        return "Sur l'avenue du Parc" if lang == "fr" else "On Parc Avenue"
    if "sherbrooke" in title or "sherbrooke" in location_lower:
        return "Sur Sherbrooke Ouest" if lang == "fr" else "On Sherbrooke Street West"
    if "saint-laurent" in title or "boulevard saint-laurent" in location_lower:
        return "Sur le boulevard Saint-Laurent" if lang == "fr" else "On Saint-Laurent Boulevard"
    if "cartierville" in title or "cartierville" in location_lower:
        return "À Cartierville" if lang == "fr" else "In Cartierville"
    if "lachine" in title or "lachine" in location_lower:
        return "À Lachine" if lang == "fr" else "In Lachine"
    if "westmount" in title or "westmount" in location_lower:
        return "À Westmount" if lang == "fr" else "In Westmount"
    if any(token in title or token in location_lower for token in ("vieux-montreal", "vieux-montréal", "notre-dame est", "palais de justice", "vauquelin")):
        return "Dans le Vieux-Montréal" if lang == "fr" else "In Old Montreal"

    source = location or _plain_title(metadata_fields, payload)
    source = re.split(r"\s+\(", str(source), maxsplit=1)[0].strip()
    lowered = _normalize_match(source)
    if not source:
        return ""
    if lowered.startswith(("avenue ", "boulevard ", "rue ", "route ", "autoroute ")):
        return f"Sur {source}" if lang == "fr" else f"On {source}"
    if lowered.startswith("parc "):
        return f"Au {source}" if lang == "fr" else f"At {source}"
    return f"À {source}" if lang == "fr" else f"In {source}"


def _extract_era_fragment(text: str) -> str:
    clean = _clean_sentence(text)
    if not clean:
        return ""
    patterns = (
        r"(\d{4}-\d{4})",
        r"(Vers\s+\d{4}(?:-\d{4})?)",
        r"((?:Janvier|Février|Fevrier|Mars|Avril|Mai|Juin|Juillet|Ao[uû]t|Septembre|Octobre|Novembre|Décembre|Decembre)\s+\d{4})",
        r"(\d{1,2}\s+[A-Za-zéûôîàç]+\s+\d{4})",
        r"(Ann[ée]es?\s+\d{4})",
        r"(\d{4}s(?:-\d{4}s)?)",
        r"(\d{4})",
    )
    for pattern in patterns:
        match = re.search(pattern, clean, flags=re.IGNORECASE)
        if match:
            return _clean_sentence(match.group(1))
    return ""


def _display_era_label(payload: dict, metadata_fields: dict) -> str:
    raw = _clean_sentence(payload.get("era") or metadata_fields.get("date") or "")
    lowered = _normalize_match(raw)
    if raw and not any(marker in lowered for marker in ("based on car models", "film style", "based on", "suggest", "likely")):
        extracted = _extract_era_fragment(raw)
        return extracted or raw
    fallback_sources = (
        payload.get("title_fr"),
        payload.get("title_en"),
        metadata_fields.get("title"),
        payload.get("date_value"),
    )
    for source in fallback_sources:
        extracted = _extract_era_fragment(source or "")
        if extracted:
            return extracted
    return raw


def _weekend_place_label(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    short = _clean_sentence(payload.get("location_short_fr") or payload.get("location_short_en") or "")
    if short:
        title = " ".join(filter(None, [payload.get("title_fr"), metadata_fields.get("title"), payload.get("location")]))
        if "berkeley" in _normalize_match(title):
            return "Sherbrooke Ouest" if lang == "fr" else "Sherbrooke Street West"
        return short
    subject = _plain_title(metadata_fields, payload)
    title = _clean_sentence(payload.get("title_fr") or payload.get("title_en") or metadata_fields.get("title") or "")
    if "westmount" in _normalize_match(" ".join(filter(None, [subject, title, payload.get("location") or ""]))):
        return "Westmount" if lang == "fr" else "Westmount"
    if "berkeley" in _normalize_match(" ".join(filter(None, [subject, title, payload.get("location") or ""]))):
        return "Sherbrooke Ouest" if lang == "fr" else "Sherbrooke Street West"
    if subject and subject != "Montréal":
        return subject
    location = _clean_sentence(payload.get("location") or "")
    if location:
        return re.split(r"\s+\(", location, maxsplit=1)[0].strip()
    return "Montréal" if lang == "fr" else "Montreal"


def _weekend_intro_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title_blob = " ".join(filter(None, [payload.get("title_fr"), payload.get("location"), metadata_fields.get("title")]))
    lowered = _normalize_match(title_blob)
    if "berkeley" in lowered:
        if lang == "fr":
            return "Sur Sherbrooke Ouest, le Berkeley n'a que huit ans en 1936, mais il domine déjà une rue qui portait encore la mémoire de ses anciennes demeures."
        return "On Sherbrooke Street West, the Berkeley is only eight years old in 1936, yet it already dominates a street that still carried the memory of its older houses."
    if "westmount" in lowered and "saint leon" in lowered:
        if lang == "fr":
            return "Au centre de l'image, Westmount Park ouvre une respiration verte pendant que l'église Saint-Léon tient encore l'horizon du quartier."
        return "At the center of the image, Westmount Park opens a green pause while Saint-Léon church still holds the neighborhood horizon."
    place = _weekend_place_label(payload, metadata_fields, lang=lang)
    if lang == "fr":
        return f"Cette vue de {place} se lit d'abord comme un paysage de quartier avant de devenir un document sur la manière d'habiter Montréal."
    return f"This view of {place} first reads as a neighborhood landscape before it becomes a document of how Montreal was lived."


def _weekend_detail_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title_blob = " ".join(filter(None, [payload.get("title_fr"), payload.get("location"), metadata_fields.get("title")]))
    lowered = _normalize_match(title_blob)
    if "berkeley" in lowered:
        if lang == "fr":
            return "Le face-à-face entre l'hôtel neuf et la maison victorienne voisine suffit à raconter le basculement de Sherbrooke."
        return "The clearest detail is the face-off between the new hotel and the neighboring Victorian house: in one facade, you can read Sherbrooke's shift."
    if "westmount" in lowered and "saint leon" in lowered:
        if lang == "fr":
            return "L'église Saint-Léon et le grand parc public permettent d'ancrer la scène dans un Westmount déjà structuré par ses repères civiques et résidentiels."
        return "Saint-Léon church and the large public park anchor the scene in a Westmount already structured by civic and residential landmarks."
    return _best_primary_detail(payload, metadata_fields, lang=lang) or _best_supporting_detail(payload, metadata_fields, lang=lang)


def _weekend_place_context_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title_blob = " ".join(filter(None, [payload.get("title_fr"), payload.get("location"), metadata_fields.get("title")]))
    lowered = _normalize_match(title_blob)
    if "berkeley" in lowered:
        if lang == "fr":
            return "Cette image montre le moment où le Golden Square Mile cesse d'être seulement résidentiel: les hôtels et les usages commerciaux prennent la rue."
        return "This image catches the moment when the Golden Square Mile stops being purely residential: hotels and commercial uses begin taking the street."
    if "westmount" in lowered and "westmount park" in lowered:
        if lang == "fr":
            return "Entre les maisons, le parc donne à la vue son rythme: une clairière publique au milieu d'un tissu résidentiel déjà très stable."
        return "Between the houses, the park sets the rhythm of the view: a public clearing inside an already stable residential fabric."
    return _best_lived_context(payload, metadata_fields, lang=lang)


def _weekend_enduring_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title_blob = " ".join(filter(None, [payload.get("title_fr"), payload.get("location"), metadata_fields.get("title")]))
    lowered = _normalize_match(title_blob)
    if "berkeley" in lowered:
        if lang == "fr":
            return "L'archive garde surtout le choc visuel entre deux époques: l'ancienne Sherbrooke résidentielle et la ville plus dense qui s'annonce déjà."
        return "What the archive keeps best is the visual shock between two eras: the older residential Sherbrooke and the denser city already on its way."
    if "westmount" in lowered and "westmount park" in lowered:
        if lang == "fr":
            return "Le parc et l'église restent aujourd'hui deux repères forts du paysage de Westmount, même si la circulation et les usages du quartier ont évolué."
        return "The park and church still remain strong landmarks in Westmount, even if circulation and neighborhood uses have changed."
    close, _label = _best_change_or_survival(payload, metadata_fields, lang=lang)
    return close


def _weekend_reflection_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title_blob = " ".join(filter(None, [payload.get("title_fr"), payload.get("location"), metadata_fields.get("title")]))
    lowered = _normalize_match(title_blob)
    if "berkeley" in lowered:
        if lang == "fr":
            return "Le week-end, cette archive se lit comme une promenade lente dans une rue montréalaise qui changeait déjà d'époque."
        return "On a weekend, this archive reads like a slow walk along a Montreal street that was already changing eras."
    if lang == "fr":
        return f"Le week-end, ce genre d'image rappelle que Montréal se raconte aussi par ses respirations: un parc, une église, un morceau de ville resté lisible."
    return f"On a weekend, this kind of image reminds us that Montreal is also told through its breathing spaces: a park, a church, a part of the city that remains legible."


def _weekend_hook_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    title_blob = " ".join(filter(None, [payload.get("title_fr"), payload.get("location"), metadata_fields.get("title")]))
    lowered = _normalize_match(title_blob)
    if "berkeley" in lowered:
        return "Sur Sherbrooke Ouest, la rue change déjà d'époque." if lang == "fr" else "On Sherbrooke Street West, the street is already changing eras."
    if "westmount" in lowered and "saint leon" in lowered:
        return "À Westmount, le parc et l'église donnent encore son rythme au quartier." if lang == "fr" else "In Westmount, the park and church still set the rhythm of the neighborhood."
    place = _weekend_place_label(payload, metadata_fields, lang=lang)
    return f"À {place}, une image calme en dit long sur la ville." if lang == "fr" else f"In {place}, a quiet image says a lot about the city."


def _beauty_place_label(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [payload.get("location_short_fr"), payload.get("location"), metadata_fields.get("title"), payload.get("title_fr")]))
    if any(token in _normalize_match(blob) for token in ("palais de justice", "vauquelin", "notre-dame est")):
        return "rue Notre-Dame Est" if lang == "fr" else "Notre-Dame Street East"
    if any(token in _normalize_match(blob) for token in ("berkeley", "sherbrooke ouest", "sherbrooke west")):
        return "Sherbrooke Ouest" if lang == "fr" else "Sherbrooke Street West"
    return _civic_place_label(payload, metadata_fields, lang=lang)


def _beauty_intro_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "Entre le monument Vauquelin, le feuillage d'été, les fils du tramway et la masse du palais, toute une rue Notre-Dame tient dans le même cadre."
        return "Between the Vauquelin monument, the summer foliage, the streetcar wires, and the bulk of the courthouse, an entire stretch of Notre-Dame fits in one frame."
    if "berkeley" in _normalize_match(blob):
        if lang == "fr":
            return "La façade du Berkeley et la maison de pierre voisine suffisent à faire lire deux Sherbrooke dans la même image."
        return "The Berkeley facade and the stone house beside it are enough to make two eras of Sherbrooke legible in the same frame."
    return _best_scene_line(payload, metadata_fields, lang=lang)


def _beauty_detail_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "Le plus beau contraste est peut-être celui entre la pierre lourde du palais et le flou de mouvement saisi au premier plan."
        return "The strongest contrast may be between the courthouse's heavy stone and the blur of movement caught in the foreground."
    if "berkeley" in _normalize_match(blob):
        if lang == "fr":
            return "Le plus beau contraste est celui entre l'hôtel neuf de 1928 et la vieille maison victorienne qui tient encore à ses côtés."
        return "The strongest contrast is between the new 1928 hotel and the older Victorian house still holding its place beside it."
    return _best_primary_detail(payload, metadata_fields, lang=lang)


def _beauty_hold_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "L'ancien palais, devenu l'édifice Lucien-Saulnier, et le monument Vauquelin maintiennent encore aujourd'hui l'ossature visuelle de ce coin du Vieux-Montréal."
        return "The old courthouse, now the Lucien-Saulnier building, and the Vauquelin monument still hold the visual structure of this Old Montreal corner."
    if "berkeley" in _normalize_match(blob):
        if lang == "fr":
            return "Le tracé de Sherbrooke et les vieilles maisons encore conservées dans le secteur permettent toujours de lire cette bascule de la rue."
        return "Sherbrooke's line and the old houses that still survive nearby still make that shift in the street readable today."
    text, _label = _best_change_or_survival(payload, metadata_fields, lang=lang)
    return text


def _beauty_reflection_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "C'est le genre d'image qui rappelle que certaines vues de Montréal restent aussi belles parce qu'elles sont encore lisibles, couche par couche."
        return "It is the kind of image that reminds us some Montreal views remain beautiful because they are still readable, layer by layer."
    if "berkeley" in _normalize_match(blob):
        if lang == "fr":
            return "Les plus belles archives de rue sont souvent celles où deux époques restent visibles sans qu'on ait besoin de les souligner."
        return "The most beautiful street archives are often the ones where two eras remain visible without needing to be underlined."
    return _best_reflection(payload, metadata_fields, lang=lang)


def _beauty_hook_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        return "Sur la rue Notre-Dame, la pierre et le mouvement tiennent dans la même image." if lang == "fr" else "On Notre-Dame Street, stone and motion hold together in the same frame."
    if "berkeley" in _normalize_match(blob):
        return "Sur Sherbrooke Ouest, deux époques tiennent encore dans le même cadre." if lang == "fr" else "On Sherbrooke Street West, two eras still hold inside the same frame."
    place = _beauty_place_label(payload, metadata_fields, lang=lang)
    return f"À {place}, la composition fait déjà le récit." if lang == "fr" else f"In {place}, the composition already tells the story."


def _civic_place_label(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    short = _clean_sentence(payload.get("location_short_fr") or "")
    if short:
        return short
    blob = " ".join(filter(None, [payload.get("location"), metadata_fields.get("title"), payload.get("title_fr")]))
    if any(token in _normalize_match(blob) for token in ("vauquelin", "palais de justice", "notre-dame est")):
        return "Vieux-Montréal" if lang == "fr" else "Old Montreal"
    return _weekend_place_label(payload, metadata_fields, lang=lang)


def _civic_intro_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "Derrière le monument Vauquelin, l'ancien Palais de justice encadrait un coin où se croisaient tramways, passants et vie publique."
        return "Behind the Vauquelin monument, the old courthouse framed a corner where streetcars, pedestrians, and public life crossed paths."
    subject = _clean_sentence(_plain_title(metadata_fields, payload)) or _civic_place_label(payload, metadata_fields, lang=lang)
    if lang == "fr":
        return f"Cette image montre comment {subject} structurait la vie publique montréalaise bien au-delà de sa façade."
    return f"This image shows how {subject} structured public life in Montreal well beyond its facade."


def _civic_detail_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "Les fils du tramway, le petit kiosque et l'automobile rappellent que la vie civique se jouait aussi dans le mouvement ordinaire de la rue."
        return "The streetcar wires, small kiosk, and automobile show that civic life also played out in the ordinary movement of the street."
    return _best_primary_detail(payload, metadata_fields, lang=lang)


def _civic_survival_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "L'ancien palais, devenu l'édifice Lucien-Saulnier, et le monument Vauquelin restent deux repères majeurs de la rue Notre-Dame."
        return "The old courthouse, now the Lucien-Saulnier building, and the Vauquelin monument remain major landmarks on Notre-Dame Street."
    explicit = _clean_sentence(payload.get("what_survived_fr" if lang == "fr" else "what_survived_en"))
    if explicit:
        return explicit
    text, _label = _best_change_or_survival(payload, metadata_fields, lang=lang)
    return text


def _civic_change_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "Les fils aériens du tramway et le petit kiosque utilitaire ont disparu, ce qui change complètement la lecture de ce coin de rue aujourd'hui."
        return "The overhead streetcar wires and small utility kiosk have disappeared, completely changing how this corner reads today."
    explicit = _clean_sentence(payload.get("what_changed_fr" if lang == "fr" else "what_changed_en"))
    if explicit:
        return explicit
    text, _label = _best_change_or_survival(payload, metadata_fields, lang=lang)
    return text


def _civic_reflection_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        if lang == "fr":
            return "Cette archive rappelle que la mémoire civique de Montréal se construisait autant dans la rue que derrière les murs de ses institutions."
        return "This archive shows that Montreal's civic memory was built as much in the street as behind the walls of its institutions."
    explicit = _clean_sentence(payload.get("closing_reflection_fr" if lang == "fr" else "closing_reflection_en"))
    if explicit:
        return explicit
    return _best_reflection(payload, metadata_fields, lang=lang)


def _civic_hook_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    blob = " ".join(filter(None, [metadata_fields.get("title"), payload.get("title_fr"), payload.get("location")]))
    if "palais de justice" in _normalize_match(blob):
        return "Dans le Vieux-Montréal, ce palais réglait le tempo de la vie publique." if lang == "fr" else "In Old Montreal, this courthouse set the tempo of public life."
    subject = _clean_sentence(_plain_title(metadata_fields, payload)) or _civic_place_label(payload, metadata_fields, lang=lang)
    return f"{subject} donnait encore son rythme à la ville." if lang == "fr" else f"{subject} still set the city's rhythm."


def _is_thin_metadata_case(payload: dict, metadata_fields: dict) -> bool:
    location = _normalize_match(payload.get("location") or payload.get("location_short_fr") or "")
    title = _normalize_match(metadata_fields.get("title") or "")
    subject = _normalize_match(_plain_title(metadata_fields, payload))
    has_archive_title = bool(_clean_sentence(metadata_fields.get("title") or payload.get("source_title") or payload.get("title") or ""))
    has_archive_description = bool(_clean_sentence(metadata_fields.get("description") or payload.get("source_description") or ""))
    has_archive_date = bool(_clean_sentence(metadata_fields.get("date") or payload.get("date_value") or ""))
    has_archive_cote = bool(_clean_sentence(metadata_fields.get("cote") or metadata_fields.get("archive reference") or ""))
    has_grounded_metadata = has_archive_title or has_archive_description or has_archive_date or has_archive_cote
    inferred_era = _normalize_match(payload.get("era") or "")
    if "inconnu" in location or "unknown" in location:
        return True
    if not has_grounded_metadata:
        return True
    if re.fullmatch(r"vm\d+[-_a-z0-9.]+", title):
        return True
    if "based on" in inferred_era or "selon" in inferred_era:
        return True
    if subject in {"la frontiere oubliee", "the forgotten frontier", "montreal"} and not metadata_fields.get("description"):
        return True
    return False


def _mystery_anchor_label(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    era = _display_era_label(payload, metadata_fields) or _clean_sentence(payload.get("date_value") or "")
    if lang == "fr":
        return f"{era}, marges de Montréal (secteur non identifié)".strip(", ")
    return f"{era}, Montreal fringe (unidentified sector)".strip(", ")


def _mystery_intro_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    if lang == "fr":
        return "La photo montre une lisière nette entre champs défrichés et masse boisée, dans un secteur des marges de Montréal que l'archive ne nomme pas encore."
    return "The photograph shows a sharp edge between cleared fields and dense woods in a fringe sector of Montreal the archive still does not name."


def _mystery_detail_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    if lang == "fr":
        return "Le détail le plus parlant est cette coupure sombre qui arrête net les parcelles géométriques."
    return "The clearest visual clue is the dark break that abruptly halts the geometric parcels."


def _mystery_context_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    if lang == "fr":
        return "Les parcelles évoquent un paysage agricole saisi juste avant l'étalement d'après-guerre, quand les marges de Montréal restaient encore très rurales."
    return "The parcels suggest a rural landscape caught just before postwar sprawl, when Montreal's edges were still largely agricultural."


def _mystery_unresolved_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    if lang == "fr":
        return "Le lieu exact reste à confirmer, tout comme la fonction précise de cette frontière sombre et des cavités visibles dans les champs."
    return "The exact location still needs confirmation, along with the precise function of the dark boundary and the cavities visible in the fields."


def _mystery_hook_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    if lang == "fr":
        return "À la lisière de Montréal, le paysage change d'un seul coup."
    return "On Montreal's edge, the landscape changes all at once."


def _build_anchor_from_payload(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    subject = _plain_title(metadata_fields, payload)
    location = payload.get("location") or metadata_fields.get("title") or "Montréal"
    era = _display_era_label(payload, metadata_fields)
    if subject and _normalize_match(subject) not in {"montreal", "montréal"} and not _place_duplicates_subject(str(location), subject):
        return f"{subject}, {era}".strip(", ")
    if lang == "fr":
        return f"{location}, {era}".strip(", ")
    return f"{location}, {era}".strip(", ")


def _build_static_anchor_from_payload(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    subject = _plain_title(metadata_fields, payload)
    location = _subject_location_context(payload, subject)
    era = _display_era_label(payload, metadata_fields)
    subject_duplicates_location = bool(subject and location and _place_duplicates_subject(location, subject))
    if lang == "fr":
        if subject and location and not subject_duplicates_location:
            return f"{era}, {subject} ({location})".strip(", ")
        if subject:
            return f"{era}, {subject}".strip(", ")
        return f"{era}, {location}".strip(", ")
    if subject and location and not subject_duplicates_location:
        return f"{era}, {subject} ({location})".strip(", ")
    if subject:
        return f"{era}, {subject}".strip(", ")
    return f"{era}, {location}".strip(", ")


def _short_subject(metadata_fields: dict, payload: dict, *, lang: str) -> str:
    title = _best_subject_name(metadata_fields, payload) or payload.get("title_fr") or payload.get("title_en") or metadata_fields.get("title") or "Montréal"
    if "YMCA" in title:
        return "le YMCA" if lang == "fr" else "the YMCA"
    base = re.split(r"\s+\(", str(title), maxsplit=1)[0].strip()
    return base or ("Montréal" if lang == "fr" else "Montreal")


def _starts_with_vowel_sound(text: str) -> bool:
    return _normalize_match(text[:1]) in {"a", "e", "i", "o", "u", "y", "h"}


def _sentence_opening(text: str) -> str:
    clean = _clean_sentence(text)
    if not clean:
        return ""
    return clean[:1].upper() + clean[1:]


def _french_subject_label(metadata_fields: dict, payload: dict) -> str:
    title = _plain_title(metadata_fields, payload)
    lowered = _normalize_match(title)
    if "ymca" in lowered:
        if "avenue du parc" in lowered:
            return "le YMCA de l'avenue du Parc"
        return "le YMCA"
    if lowered.startswith("parc "):
        return f"le {title}"
    if lowered.startswith("hotel ") or lowered.startswith("hôtel "):
        return f"l'{title}" if _starts_with_vowel_sound(title) else f"le {title}"
    if lowered.startswith("eglise ") or lowered.startswith("église "):
        return f"l'{title}"
    return title


def _french_subject_after_de(text: str) -> str:
    clean = _clean_sentence(text)
    lowered = _normalize_match(clean)
    if lowered.startswith("le "):
        return "du " + clean[3:]
    if lowered.startswith("les "):
        return "des " + clean[4:]
    if lowered.startswith("l'"):
        return "de " + clean
    return "de " + clean


def _subject_family(metadata_fields: dict, payload: dict) -> str:
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or payload.get("title_en") or "")
    if any(token in title for token in ("ymca", "association", "hopital", "hospital", "universit", "college", "maison", "couvent", "convent")):
        return "institution"
    if any(token in title for token in ("parc", "pool", "piscine", "playground")):
        return "park"
    if any(token in title for token in ("hotel", "hôtel")):
        return "hotel"
    if any(token in title for token in ("eglise", "church", "oratoire", "chapel")):
        return "church"
    if any(token in title for token in ("pont", "bridge", "autoroute", "canal", "rail", "gare")):
        return "infrastructure"
    if any(token in title for token in ("marche", "market")):
        return "market"
    return "place"


def _best_scene_line(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    key = "scene_fr" if lang == "fr" else "scene_en"
    text = _clean_sentence(payload.get(key))
    theme_key = str(payload.get("theme_key") or "").lower()
    family = _subject_family(metadata_fields, payload)
    strict_subject_mode = family == "institution" and theme_key in {"mystery", "detective"}
    if text and not strict_subject_mode and _off_brand_hits(text) == 0 and not _minor_detail_dominance(text, metadata_fields) and not _is_overwrought_line(text):
        return text
    if family == "market":
        if lang == "fr":
            return "Sous la grande marquise, des charrettes, des sacs de marchandises et la rue débordent encore autour du marché."
        return "Under the broad canopy, carts, sacks of goods, and the street itself still crowd around the market."
    subject = _short_subject(metadata_fields, payload, lang=lang)
    if family == "institution" and "ymca" in _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or ""):
        if lang == "fr":
            return "Au coin de l'avenue du Parc et de Saint-Viateur, le YMCA occupait déjà une place importante dans le paysage du quartier."
        return "At the corner of Parc Avenue and Saint-Viateur, the YMCA already held an important place in the neighborhood streetscape."
    if lang == "fr":
        return f"On voit ici {subject} tel qu'il se présentait dans le Montréal de l'époque."
    return f"A view of {subject} as it stood in Montreal at the time."


def _best_lived_context(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    key = "lived_context_fr" if lang == "fr" else "lived_context_en"
    text = _clean_sentence(payload.get(key))
    theme_key = str(payload.get("theme_key") or "").lower()
    family = _subject_family(metadata_fields, payload)
    if family == "market":
        if lang == "fr":
            return "Dans les années 1930, ce marché alimentait encore la Main à une époque où chevaux et premiers moteurs se partageaient la rue."
        return "In the 1930s, this market still fed the Main at a moment when horses and early motors shared the street."
    strict_subject_mode = family == "institution" and theme_key in {"mystery", "detective"}
    if text and not strict_subject_mode and _off_brand_hits(text) == 0 and not _minor_detail_dominance(text, metadata_fields) and not _is_overwrought_line(text):
        return text
    subject = _short_subject(metadata_fields, payload, lang=lang)
    if "ymca" in _normalize_match(subject):
        if lang == "fr":
            return "Au-delà du sport, le YMCA réunissait hébergement, services et vie communautaire dans un même bâtiment."
        return "At the time, the YMCA combined sport, lodging, and community life under one roof."
    if lang == "fr":
        return "Le lieu s'inscrivait dans la vie quotidienne du quartier et dans ses usages collectifs."
    return "The site was woven into everyday neighborhood life and its shared routines."


def _best_primary_detail(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if family == "institution":
        primary = _institution_primary_detail(payload, metadata_fields, lang=lang)
        if primary:
            return primary
        special = _institution_teaching_detail(payload, metadata_fields, lang=lang)
        if special:
            return special
    key = "most_striking_fr" if lang == "fr" else "most_striking_en"
    detail_key = "details_fr" if lang == "fr" else "details_en"
    candidates = [payload.get(key), payload.get("what_survived_fr" if lang == "fr" else "what_survived_en")]
    candidates.extend((item or {}).get("text") for item in (payload.get(detail_key) or []))
    best_text = ""
    best_score = -999
    for raw in candidates:
        text = _clean_sentence(raw)
        if not text:
            continue
        score = 0
        score -= _off_brand_hits(text) * 3
        score -= sum(_normalize_match(text).count(marker) for marker in MINOR_DETAIL_MARKERS) * 2
        score -= _speculation_hits(text) * 3
        if any(marker in _normalize_match(text) for marker in ("fenetr", "facade", "brique", "architecture", "sous-sol", "souterrain", "rideau", "grill", "balcon", "piscin", "track", "ovale", "pont", "eglise", "parc")):
            score += 3
        score += _subject_hits(text, metadata_fields)
        if score > best_score:
            best_score = score
            best_text = text
    return best_text or (payload.get(key) or "")


def _best_supporting_detail(payload: dict, metadata_fields: dict, *, lang: str, avoid: str = "") -> str:
    theme_key = str(payload.get("theme_key") or "").lower()
    family = _subject_family(metadata_fields, payload)
    if family == "institution" and theme_key in {"mystery", "detective"}:
        return ""
    detail_key = "details_fr" if lang == "fr" else "details_en"
    candidates = [(item or {}).get("text") for item in (payload.get(detail_key) or [])]
    best_text = ""
    best_score = -999
    for raw in candidates:
        text = _clean_sentence(raw)
        if not text or text == avoid:
            continue
        score = 0
        score -= _off_brand_hits(text) * 3
        minor_hits = sum(_normalize_match(text).count(marker) for marker in MINOR_DETAIL_MARKERS)
        score -= minor_hits * 3
        score -= _speculation_hits(text) * 3
        score += 1 if _subject_hits(text, metadata_fields) > 0 else 0
        if score > best_score:
            best_score = score
            best_text = text
    if best_score < 0:
        return ""
    return best_text


def _best_change_or_survival(payload: dict, metadata_fields: dict, *, lang: str, avoid: str = "") -> tuple[str, str]:
    survived_key = "what_survived_fr" if lang == "fr" else "what_survived_en"
    changed_key = "what_changed_fr" if lang == "fr" else "what_changed_en"
    family = _subject_family(metadata_fields, payload)
    if family == "institution":
        special = _institution_change_or_survival(payload, metadata_fields, lang=lang)
        if special:
            return special
    survived = _clean_sentence(payload.get(survived_key))
    changed = _clean_sentence(payload.get(changed_key))
    if changed and changed != avoid and family == "market" and _is_strong_loss_line(changed) and _off_brand_hits(changed) == 0:
        return changed, ("Ce qui a changé :" if lang == "fr" else "What changed:")
    if survived and survived != avoid and _off_brand_hits(survived) == 0 and not _is_minor_detail_line(survived, metadata_fields) and not _is_overwrought_line(survived):
        return survived, ("Ce qui a survécu :" if lang == "fr" else "What survived:")
    if changed and changed != avoid and _off_brand_hits(changed) == 0 and not _is_minor_detail_line(changed, metadata_fields) and not _is_overwrought_line(changed):
        return changed, ("Ce qui a changé :" if lang == "fr" else "What changed:")
    return _generic_change_line(metadata_fields, payload, lang=lang), ("Ce qui a changé :" if lang == "fr" else "What changed:")


def _secondary_change_or_survival(
    payload: dict,
    metadata_fields: dict,
    *,
    lang: str,
    primary_label: str,
    avoid: tuple[str, ...] = (),
) -> tuple[str, str]:
    survived_key = "what_survived_fr" if lang == "fr" else "what_survived_en"
    changed_key = "what_changed_fr" if lang == "fr" else "what_changed_en"
    survived = _clean_sentence(payload.get(survived_key))
    changed = _clean_sentence(payload.get(changed_key))
    avoided = {_clean_sentence(item) for item in avoid if item}

    def _usable(text: str) -> bool:
        return bool(text) and text not in avoided and _off_brand_hits(text) == 0 and not _is_minor_detail_line(text, metadata_fields) and not _is_overwrought_line(text)

    normalized_label = _normalize_match(primary_label)
    if "a change" in normalized_label or "changed" in normalized_label:
        if _usable(survived):
            return survived, ("Ce qui a survécu :" if lang == "fr" else "What survived:")
    if "a surv" in normalized_label or "survived" in normalized_label:
        if _usable(changed):
            return changed, ("Ce qui a changé :" if lang == "fr" else "What changed:")
    return "", ""


def _best_reflection(payload: dict, metadata_fields: dict, *, lang: str) -> str:
    key = "closing_reflection_fr" if lang == "fr" else "closing_reflection_en"
    text = _clean_sentence(payload.get(key))
    family = _subject_family(metadata_fields, payload)
    if family == "institution":
        special = _institution_reflection(payload, metadata_fields, lang=lang)
        if special:
            return special
    if family == "market":
        if lang == "fr":
            return "La disparition de ce marché en 1966 rappelle à quel point Montréal a remplacé ses grands marchés de quartier par d'autres formes de commerce."
        return "The demolition of this market in 1966 shows how Montreal replaced its neighborhood public markets with other forms of commerce."
    if text and _off_brand_hits(text) == 0 and not _is_minor_detail_line(text, metadata_fields) and not _is_overwrought_line(text):
        return text
    return _generic_reflection(metadata_fields, payload, lang=lang)


def _is_strong_loss_line(text: str) -> bool:
    lowered = _normalize_match(text)
    return any(marker in lowered for marker in ("demoli", "demolie", "demoli en", "disparu", "efface", "sacrif", "detruit", "demolished", "erased", "destroyed"))


def _plain_title(metadata_fields: dict, payload: dict) -> str:
    title = _best_subject_name(metadata_fields, payload)
    if "YMCA" in title:
        return "YMCA, avenue du Parc"
    base = re.split(r"\s+\(", str(title), maxsplit=1)[0].strip()
    return base[:72] if base else "Montréal"


def _plain_subhead(payload: dict, metadata_fields: dict) -> str:
    parts = []
    subject = _plain_title(metadata_fields, payload)
    location = _subject_location_context(payload, subject)
    if location:
        parts.append(str(location))
    elif payload.get("location"):
        parts.append(str(payload["location"]))
    elif metadata_fields.get("title"):
        parts.append(str(metadata_fields["title"]))
    era = _display_era_label(payload, metadata_fields)
    if era:
        parts.append(str(era))
    return ", ".join(parts[:2])[:96]


def _default_public_badge(theme: str) -> str:
    lowered = str(theme or "").lower()
    if "nostalgia" in lowered:
        return "Memoire de quartier"
    if "detective" in lowered:
        return "Lecture d'archive"
    if "erased" in lowered:
        return "Histoire effacee"
    if "mystery" in lowered:
        return "Lecture d'archive"
    if "weekend" in lowered:
        return "Week-end d'archive"
    if "civic" in lowered:
        return "Memoire civique"
    return "MTL Archives"


def _visible_detail_line(text: str) -> str:
    sentence = _clean_sentence(text)
    if not sentence:
        return ""
    for marker in (" demeure ", " reste ", " remains ", " still "):
        if marker in sentence:
            sentence = sentence.split(marker, 1)[0].strip(",;: ")
            break
    return sentence


def _generic_change_line(metadata_fields: dict, payload: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if lang == "fr":
        lines = {
            "institution": "Les usages de la rue ont évolué, mais ce type de grande institution reste un repère fort dans la mémoire du quartier.",
            "park": "Les usages du parc ont évolué, mais il reste un repère central de la vie de quartier.",
            "hotel": "La rue a changé de visage, mais l'archive garde la trace de cette transition urbaine.",
            "church": "Le quartier a changé autour d'elle, mais l'église reste un repère dans le paysage montréalais.",
            "infrastructure": "Le territoire a été transformé, et l'archive aide à mesurer ce que ces aménagements ont reconfiguré.",
            "market": "Le quartier a changé, mais l'archive rappelle la place qu'occupait ce marché dans la vie locale.",
            "place": "Le quartier a évolué, et l'archive aide à mesurer ce qui a changé dans ce coin de Montréal.",
        }
    else:
        lines = {
            "institution": "Street use has evolved, but this kind of large institution still anchors the neighborhood's memory.",
            "park": "The park has changed over time, but it still sits at the center of neighborhood life.",
            "hotel": "The street changed its character, and the archive preserves that urban transition.",
            "church": "The neighborhood changed around it, but the church still reads as a landmark in Montreal's landscape.",
            "infrastructure": "The territory was transformed, and the archive helps measure what that infrastructure reconfigured.",
            "market": "The neighborhood changed, but the archive recalls the place this market held in local life.",
            "place": "The neighborhood evolved, and the archive helps measure what changed in this corner of Montreal.",
        }
    return lines.get(family, lines["place"])


def _generic_reflection(metadata_fields: dict, payload: dict, *, lang: str) -> str:
    family = _subject_family(metadata_fields, payload)
    if lang == "fr":
        lines = {
            "institution": "Cette archive rappelle la place que tenaient les grandes institutions de quartier dans le Montréal d'alors.",
            "park": "Cette archive montre comment un parc pouvait concentrer la vie du quartier.",
            "hotel": "Cette archive raconte une rue de Montréal en train de changer de visage.",
            "church": "Cette archive montre comment un repère religieux structurait encore le quartier.",
            "infrastructure": "Cette archive montre comment les grands aménagements redessinaient déjà le territoire.",
            "market": "Cette archive rappelle comment un marché structurait la vie locale au quotidien.",
            "place": "Cette archive aide à relire ce coin de Montréal autrement.",
        }
    else:
        lines = {
            "institution": "This archive recalls the place large neighborhood institutions held in Montreal life.",
            "park": "This archive shows how a park could concentrate the life of a neighborhood.",
            "hotel": "This archive captures a Montreal street in the middle of a transition.",
            "church": "This archive shows how a religious landmark still structured the neighborhood.",
            "infrastructure": "This archive shows how major projects were already redrawing the territory.",
            "market": "This archive recalls how a market structured everyday local life.",
            "place": "This archive helps us read this corner of Montreal differently.",
        }
    return lines.get(family, lines["place"])


def _detail_card_headline(text: str, metadata_fields: dict, payload: dict) -> str:
    lowered = _normalize_match(text)
    family = _subject_family(metadata_fields, payload)
    if "y.m.c.a" in lowered or "ymca" in lowered:
        return "Regardez l'enseigne Y.M.C.A."
    if any(token in lowered for token in ("brique", "brick", "pierre", "stone", "facade", "façade")):
        if family == "institution":
            return "Une façade monumentale"
        if family == "hotel":
            return "Une façade imposante"
        return "Un détail d'architecture"
    if any(token in lowered for token in ("piscin", "pool")):
        return "La piscine au coeur du lieu"
    if any(token in lowered for token in ("piste", "track", "ovale")):
        return "Une forme aujourd'hui disparue"
    if any(token in lowered for token in ("pont", "bridge", "chantier")):
        return "Un territoire en transformation"
    return _short_card_headline(text, fallback="Regardez le détail principal")


def _context_card_headline(metadata_fields: dict, payload: dict) -> str:
    family = _subject_family(metadata_fields, payload)
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if family == "institution" and "ymca" in title:
        return "Plus qu'un gymnase"
    mapping = {
        "institution": "Une institution du quartier",
        "park": "Au coeur de la vie de quartier",
        "hotel": "Une rue en train de changer",
        "church": "Un repère du quartier",
        "infrastructure": "Le territoire se transforme",
        "market": "Au coeur de la vie locale",
        "place": "Le lieu dans son contexte",
    }
    return mapping.get(family, "Le lieu dans son contexte")


def _change_card_headline(metadata_fields: dict, payload: dict) -> str:
    family = _subject_family(metadata_fields, payload)
    mapping = {
        "institution": "Le coin a changé",
        "park": "Le parc a évolué",
        "hotel": "La rue change de visage",
        "church": "Le quartier a changé",
        "infrastructure": "Le territoire a changé",
        "market": "Le quartier s'est transformé",
        "place": "Ce coin a changé",
    }
    return mapping.get(family, "Ce coin a changé")


def _support_card_headline(metadata_fields: dict, payload: dict) -> str:
    family = _subject_family(metadata_fields, payload)
    title = _normalize_match(metadata_fields.get("title") or payload.get("title_fr") or "")
    if family == "institution" and "ymca" in title:
        return "Un carrefour du quartier"
    mapping = {
        "institution": "Un repère montréalais",
        "park": "Un repère du quartier",
        "hotel": "Une trace de transition",
        "church": "Une mémoire toujours visible",
        "infrastructure": "Une trace du territoire",
        "market": "Une mémoire du quotidien",
        "place": "Une mémoire du lieu",
    }
    return mapping.get(family, "Une mémoire du lieu")


def _lead_with_regardez_local(text: str) -> str:
    sentence = _clean_sentence(text)
    if not sentence:
        return ""
    if _normalize_match(sentence).startswith("regardez"):
        return sentence
    if sentence.startswith("Des "):
        sentence = "Les " + sentence[4:]
    lowered = sentence[:1].lower() + sentence[1:] if sentence else sentence
    if lowered and lowered[-1] not in ".!?":
        lowered += "."
    return f"Regardez {lowered}"


def _short_card_headline(text: str, fallback: str) -> str:
    sentence = _clean_sentence(text) or fallback
    sentence = re.split(r"[.!?]", sentence, maxsplit=1)[0].strip()
    words = sentence.split()
    if len(words) > 10:
        sentence = " ".join(words[:10]).rstrip(",;:")
    return sentence


def _short_card_subhead(text: str) -> str:
    sentence = _clean_sentence(text)
    if not sentence:
        return ""
    sentence = re.split(r"[.!?]", sentence, maxsplit=1)[0].strip()
    words = sentence.split()
    if len(words) > 8:
        sentence = " ".join(words[:8]).rstrip(",;:")
    return sentence


def _join_clean(*parts: str) -> str:
    cleaned = [_clean_sentence(part) for part in parts if _clean_sentence(part)]
    return " ".join(cleaned).strip()


def _clean_sentence(text: str | None) -> str:
    clean = " ".join(str(text or "").split()).strip()
    return clean


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
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        repaired = _repair_json(model, clean)
        return json.loads(repaired)


def _generate_text(model: str, parts: list[dict], *, temperature: float) -> str:
    return _generate_content(
        model,
        parts,
        temperature=temperature,
        max_output_tokens=4096,
        response_mime_type=None,
    ).strip()


def _generate_json_with_response(
    model: str,
    parts: list[dict],
    *,
    temperature: float,
    tools: list[dict] | None = None,
) -> tuple[dict, dict]:
    data = _generate_content_response(
        model,
        parts,
        temperature=temperature,
        max_output_tokens=4096,
        response_mime_type="application/json",
        tools=tools,
    )
    text = _extract_text_from_response(data)
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1]
        clean = clean.rsplit("```", 1)[0]
    try:
        parsed = json.loads(clean)
    except json.JSONDecodeError:
        repaired = _repair_json(model, clean)
        parsed = json.loads(repaired)
    return parsed, data


def _repair_json(model: str, broken_json: str) -> str:
    prompt = f"""Repair the following malformed JSON.

Requirements:
- Return valid JSON only.
- Preserve the original keys and values as closely as possible.
- Do not add commentary.
- Escape internal quotes and newlines correctly.

BROKEN JSON
{broken_json}
"""
    repaired = _generate_content(
        model,
        [{"text": prompt}],
        temperature=0.0,
        max_output_tokens=4096,
        response_mime_type="application/json",
    ).strip()
    if repaired.startswith("```"):
        repaired = repaired.split("\n", 1)[1]
        repaired = repaired.rsplit("```", 1)[0]
    return repaired


def _generate_content(
    model: str,
    parts: list[dict],
    *,
    temperature: float,
    max_output_tokens: int,
    response_mime_type: str | None,
) -> str:
    data = _generate_content_response(
        model,
        parts,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type=response_mime_type,
        tools=None,
    )
    return _extract_text_from_response(data)


def _generate_content_response(
    model: str,
    parts: list[dict],
    *,
    temperature: float,
    max_output_tokens: int,
    response_mime_type: str | None,
    tools: list[dict] | None,
) -> dict:
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }
    if response_mime_type:
        payload["generationConfig"]["responseMimeType"] = response_mime_type
    if tools:
        payload["tools"] = tools

    timeout_seconds = GEMINI_GROUNDING_TIMEOUT_SECONDS if tools else GEMINI_REQUEST_TIMEOUT_SECONDS

    try:
        resp = requests.post(
            GEMINI_URL.format(model=model),
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=timeout_seconds,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as exc:
        raise GeminiRequestError(str(exc)) from exc


def _extract_text_from_response(data: dict) -> str:
    parts = data["candidates"][0]["content"].get("parts", [])
    return "".join(part.get("text", "") for part in parts if "text" in part)


def _default_grounding_context(*, reason: str, assessment: dict | None = None) -> dict:
    return {
        "used": False,
        "mode": "gemini_google_search",
        "reason": reason,
        "search_usefulness": "none",
        "summary": "",
        "candidate_subjects": [],
        "probable_context": [],
        "unresolved_questions": [],
        "notes": [],
        "queries": [],
        "sources": [],
        "metadata_assessment": assessment or {},
    }


def _assess_metadata_grounding(metadata_fields: dict) -> dict:
    title = _clean_sentence(metadata_fields.get("title") or "")
    description = _clean_sentence(metadata_fields.get("description") or "")
    official_title = _clean_sentence(metadata_fields.get("official title") or "")
    official_description = _clean_sentence(metadata_fields.get("official description") or "")
    date_value = _clean_sentence(metadata_fields.get("date") or metadata_fields.get("date/era") or metadata_fields.get("date_value") or "")
    cote = _clean_sentence(metadata_fields.get("cote") or metadata_fields.get("archive reference") or "")
    portal_match = _normalize_match(metadata_fields.get("portal match") or "") in {"true", "yes", "1"}
    normalized_title = _normalize_match(title)
    title_code_like = bool(normalized_title and re.fullmatch(r"vm\d+[-_a-z0-9.]+", normalized_title))
    official_title_specific = bool(official_title and len(_tokenize(official_title)) >= 2)
    official_description_specific = bool(official_description and len(_tokenize(official_description)) >= 5)
    title_specific = bool((title and not title_code_like and len(_tokenize(title)) >= 2) or official_title_specific)
    description_specific = bool((description and len(_tokenize(description)) >= 5) or official_description_specific)
    score = sum(
        [
            2 if title_specific else 0,
            1 if description_specific else 0,
            1 if bool(date_value) else 0,
            1 if bool(cote) else 0,
            1 if portal_match else 0,
        ]
    )
    return {
        "title_present": bool(title),
        "title_specific": title_specific,
        "title_code_like": title_code_like,
        "description_present": bool(description),
        "description_specific": description_specific,
        "official_title_present": bool(official_title),
        "official_title_specific": official_title_specific,
        "official_description_present": bool(official_description),
        "official_description_specific": official_description_specific,
        "date_present": bool(date_value),
        "cote_present": bool(cote),
        "portal_match": portal_match,
        "score": score,
        "thin": score <= 2 or (not title_specific and not description_specific),
    }


def _contains_exact_place_markers(text: str) -> bool:
    clean = _normalize_match(text or "")
    if not clean:
        return False
    if any(marker in clean for marker in (" & ", "/", "intersection", "between ", " coin ", " angle ")):
        return True
    if clean.count(",") >= 1 and any(token in clean for token in ("street", "rue", "avenue", "boulevard", "chemin")):
        return True
    return False


def _location_support_is_weak(payload: dict, metadata_fields: dict, grounded_context: dict | None) -> bool:
    assessment = payload.get("metadata_assessment") or _assess_metadata_grounding(metadata_fields)
    location = _clean_sentence(payload.get("location") or payload.get("location_short_fr") or "")
    if not location:
        return False
    if not assessment.get("thin"):
        return False
    if assessment.get("portal_match"):
        return False
    grounded_used = bool((grounded_context or {}).get("used"))
    if not grounded_used:
        return False
    return True


def _grounding_place_counts(payload: dict, grounded_context: dict | None) -> list[tuple[str, str, int]]:
    texts: list[str] = []
    texts.extend(str(query) for query in ((grounded_context or {}).get("queries") or []))
    texts.extend(str(item.get("name") or "") for item in ((grounded_context or {}).get("candidate_subjects") or []))
    texts.extend(str(item) for item in ((grounded_context or {}).get("notes") or []))
    texts.extend(str(item) for item in ((grounded_context or {}).get("probable_context") or []))
    texts.extend(
        str(value or "")
        for value in (
            (grounded_context or {}).get("summary"),
            payload.get("location"),
            payload.get("location_short_fr"),
            payload.get("title_fr"),
        )
    )
    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    for text in texts:
        for raw in re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]{3,}", text):
            normalized = _normalize_match(raw).strip(".-'")
            if not normalized or normalized in PUBLIC_LOCATION_STOPWORDS:
                continue
            counts[normalized] += 1
            display.setdefault(normalized, raw)
    ranked = sorted(((key, display[key], count) for key, count in counts.items()), key=lambda item: (-item[2], item[0]))
    return ranked


def _best_query_corridor_token(grounded_context: dict | None) -> str:
    queries = [str(query) for query in ((grounded_context or {}).get("queries") or []) if str(query).strip()]
    if not queries:
        return ""
    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    for query in queries:
        seen: set[str] = set()
        for raw in re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]{3,}", query):
            normalized = _normalize_match(raw).strip(".-'")
            if not normalized or normalized in PUBLIC_LOCATION_STOPWORDS or normalized in seen:
                continue
            seen.add(normalized)
            counts[normalized] += 1
            display.setdefault(normalized, raw)
    threshold = max(2, min(3, len(queries)))
    for normalized, count in counts.most_common():
        if count >= threshold:
            return _clean_sentence(display[normalized])
    return ""


def _best_broad_location_label(payload: dict, metadata_fields: dict, grounded_context: dict | None, *, lang: str) -> tuple[str, str]:
    broad_token = _best_query_corridor_token(grounded_context)
    if not broad_token:
        ranked = _grounding_place_counts(payload, grounded_context)
        for normalized, original, count in ranked:
            if count >= 2:
                broad_token = original
                break
    broad_token = _clean_sentence(broad_token)
    if broad_token:
        if lang == "fr":
            return (f"secteur {broad_token}", f"secteur {broad_token}, Montréal")
        return (f"{broad_token} sector", f"{broad_token} sector, Montreal")
    if lang == "fr":
        return ("secteur à confirmer", "secteur à confirmer, Montréal")
    return ("sector to confirm", "Montreal sector to confirm")


def _suppressed_location_terms(payload: dict, grounded_context: dict | None, broad_short_fr: str) -> list[str]:
    broad_normalized = _normalize_match(broad_short_fr)
    candidates: list[str] = []
    for value in (
        payload.get("location"),
        payload.get("location_short_fr"),
        payload.get("title_fr"),
        payload.get("title_en"),
    ):
        clean = _clean_sentence(value or "")
        if clean:
            candidates.append(clean)
    for query in ((grounded_context or {}).get("queries") or []):
        candidates.extend(re.findall(r'"([^"]+)"', str(query)))
    for item in ((grounded_context or {}).get("candidate_subjects") or []):
        clean = _clean_sentence((item or {}).get("name") or "")
        if clean:
            candidates.append(clean)
    terms: list[str] = []
    for candidate in candidates:
        for fragment in re.split(r"[,&/()]| and | et ", candidate):
            clean = _clean_sentence(fragment)
            normalized = _normalize_match(clean)
            if not clean or not normalized or normalized in PUBLIC_LOCATION_STOPWORDS:
                continue
            if re.search(r"\d", clean) or any(marker in normalized for marker in ("annee", "années", "annees", "years")):
                continue
            if broad_normalized and normalized in broad_normalized:
                continue
            if any(term == normalized for term in map(_normalize_match, terms)):
                continue
            if len(normalized) < 5:
                continue
            terms.append(clean)
    return terms[:8]


def _apply_public_confidence_guards(payload: dict, metadata_fields: dict, grounded_context: dict | None) -> dict:
    sanitized = json.loads(json.dumps(payload))
    assessment = sanitized.get("metadata_assessment") or _assess_metadata_grounding(metadata_fields)
    sanitized["metadata_assessment"] = assessment
    weak_location = _location_support_is_weak(sanitized, metadata_fields, grounded_context)
    exact_markers = _contains_exact_place_markers(sanitized.get("location") or "") or _contains_exact_place_markers(sanitized.get("location_short_fr") or "")

    if weak_location:
        short_fr, location_fr = _best_broad_location_label(sanitized, metadata_fields, grounded_context, lang="fr")
        short_en, location_en = _best_broad_location_label(sanitized, metadata_fields, grounded_context, lang="en")
        sanitized["original_inferred_location"] = _clean_sentence(sanitized.get("location") or "")
        sanitized["original_inferred_location_short_fr"] = _clean_sentence(sanitized.get("location_short_fr") or "")
        sanitized["location_short_fr"] = short_fr
        sanitized["location_short_en"] = short_en
        sanitized["location"] = location_fr
        sanitized["location_en"] = location_en
        sanitized["location_confidence"] = "low"
        sanitized["exact_location_public_safe"] = False
        sanitized["suppressed_location_terms"] = _suppressed_location_terms(sanitized, grounded_context, short_fr)
        era = _display_era_label(sanitized, metadata_fields)
        title_fr = _clean_sentence(sanitized.get("title_fr") or "")
        title_en = _clean_sentence(sanitized.get("title_en") or "")
        old_location_terms = {
            _normalize_match(sanitized.get("original_inferred_location") or ""),
            _normalize_match(sanitized.get("original_inferred_location_short_fr") or ""),
        }
        if not title_fr or _normalize_match(title_fr) in old_location_terms or exact_markers:
            sanitized["title_fr"] = short_fr
        if not title_en or _normalize_match(title_en) in old_location_terms or exact_markers:
            sanitized["title_en"] = short_en
        meta_fr = _clean_sentence(sanitized.get("meta_fr") or "")
        if not meta_fr or _contains_exact_place_markers(meta_fr):
            sanitized["meta_fr"] = ", ".join(part for part in (short_fr, era) if part)
    else:
        sanitized["location_confidence"] = "normal"
        sanitized["exact_location_public_safe"] = True
        sanitized["suppressed_location_terms"] = []

    return sanitized


def _should_use_search_grounding(metadata_fields: dict, theme: str) -> bool:
    if not SEARCH_GROUNDING_ENABLED:
        return False
    assessment = _assess_metadata_grounding(metadata_fields)
    if assessment["thin"]:
        return True
    lowered_theme = _normalize_match(theme or "")
    if any(key in lowered_theme for key in ("mystery", "beauty", "weekend")) and assessment["score"] <= 3:
        return True
    return False


def _ground_with_google_search(
    image_path: str,
    metadata: str,
    metadata_fields: dict,
    *,
    theme: str,
    model: str,
    editorial_brief: str | None,
) -> dict:
    brief_block = f"\nEDITORIAL BRIEF\n{editorial_brief}\n" if editorial_brief else ""
    assessment = _assess_metadata_grounding(metadata_fields)
    prompt = f"""You are helping research an archival Montreal image with weak or incomplete archive metadata.

This image is definitely from Montreal, but the exact place or subject may be thinly described.
Use Google Search grounding to look for Montreal-specific public context that can help an editor narrow the field.

ARCHIVE METADATA
{metadata or "(No reliable archive metadata provided beyond: archival Montreal image.)"}

THEME
{theme}
THEME GUIDANCE
{_theme_guidance(theme)}
{brief_block}

METADATA ASSESSMENT
{json.dumps(assessment, ensure_ascii=False, indent=2)}

Return strict JSON with exactly this structure:
{{
  "summary": "one or two sentences",
  "candidate_subjects": [
    {{
      "name": "...",
      "confidence": "low or medium or high",
      "why": "short reason"
    }}
  ],
  "probable_context": [
    "..."
  ],
  "unresolved_questions": [
    "..."
  ],
  "search_usefulness": "none or low or medium or high",
  "notes": [
    "..."
  ]
}}

Rules:
- Keep the search Montreal-specific.
- Never treat search results as archive metadata.
- Only propose exact identities when multiple strong signals converge.
- If search is weak, generic, or contradictory, say so.
- Candidate subjects max 3.
- probable_context max 4.
- unresolved_questions max 3.
- notes max 3.
- This grounded output can support probable context and open questions later, not verified facts."""
    grounded, response = _generate_json_with_response(
        model,
        [{"text": prompt}, _image_part(image_path)],
        temperature=0.2,
        tools=GROUNDING_TOOLS,
    )
    meta = _extract_grounding_metadata(response)
    grounded["used"] = bool(meta["sources"] or meta["queries"])
    grounded["mode"] = "gemini_google_search"
    grounded["queries"] = meta["queries"]
    grounded["sources"] = meta["sources"]
    grounded["metadata_assessment"] = assessment
    grounded.setdefault("search_usefulness", "low" if grounded["used"] else "none")
    return grounded


def _extract_grounding_metadata(response: dict) -> dict:
    candidate = ((response or {}).get("candidates") or [{}])[0]
    metadata = candidate.get("groundingMetadata") or {}
    queries = [str(query).strip() for query in metadata.get("webSearchQueries") or [] if str(query).strip()]
    sources = []
    seen = set()
    for chunk in metadata.get("groundingChunks") or []:
        web = chunk.get("web") or {}
        uri = str(web.get("uri") or "").strip()
        title = str(web.get("title") or "").strip()
        if not uri or uri in seen:
            continue
        seen.add(uri)
        sources.append({"title": title or uri, "uri": uri})
        if len(sources) >= MAX_GROUNDING_SOURCES:
            break
    return {"queries": queries[:6], "sources": sources}


def _grounding_context_block(grounded_context: dict | None) -> str:
    if not grounded_context or not grounded_context.get("used"):
        return ""
    grounding_payload = {
        "summary": grounded_context.get("summary"),
        "candidate_subjects": grounded_context.get("candidate_subjects") or [],
        "probable_context": grounded_context.get("probable_context") or [],
        "unresolved_questions": grounded_context.get("unresolved_questions") or [],
        "notes": grounded_context.get("notes") or [],
        "queries": grounded_context.get("queries") or [],
        "sources": grounded_context.get("sources") or [],
    }
    return (
        "\nWEB-GROUNDED CONTEXT (supporting only, not archive metadata)\n"
        "Use this only to strengthen probable_context or open_questions.\n"
        "Do not turn it into verified fact unless the archive metadata or image itself clearly supports it.\n"
        f"{json.dumps(grounding_payload, ensure_ascii=False, indent=2)}\n"
    )


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


def _verification_summary(evidence: dict, grounded_context: dict | None = None) -> dict:
    verified = evidence.get("verified_facts", []) or []
    probable = evidence.get("probable_context", []) or []
    questions = evidence.get("open_questions", []) or []
    status = "mixed" if verified and probable else "verified" if verified else "probable" if probable else "unverified"
    sources = (grounded_context or {}).get("sources") or []
    queries = (grounded_context or {}).get("queries") or []
    return {
        "status": status,
        "verified_count": len(verified),
        "probable_count": len(probable),
        "open_question_count": len(questions),
        "grounding_used": bool((grounded_context or {}).get("used")),
        "grounding_mode": (grounded_context or {}).get("mode"),
        "grounding_source_count": len(sources),
        "grounding_queries": queries,
        "weak_source_domains": [source.get("uri") for source in sources],
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
