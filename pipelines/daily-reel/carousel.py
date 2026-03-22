#!/usr/bin/env python3
"""Render a branded square Instagram carousel from one archival image."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    from grids import generate_grids
except ImportError:
    from tools.mtl_archives.grids import generate_grids

SIZE = 1080

CHARCOAL = (17, 19, 24)
PAPER = (245, 242, 234)
STEEL = (200, 205, 212)
RIVER_BLUE = (15, 94, 168)
COPPER = (181, 106, 58)

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = WORKSPACE_ROOT / "assets" / "fonts"

FONT_PATHS = {
    "display": [
        FONT_DIR / "Spectral-Bold.ttf",
        Path("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Georgia Bold.ttf"),
    ],
    "brand": [
        FONT_DIR / "Figtree-Variable.ttf",
        Path("/System/Library/Fonts/Supplemental/Avenir Next.ttc"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ],
    "mono": [
        FONT_DIR / "IBMPlexMono-Medium.ttf",
        FONT_DIR / "IBMPlexMono-Regular.ttf",
        Path("/System/Library/Fonts/Supplemental/Menlo.ttc"),
        Path("/System/Library/Fonts/Supplemental/Courier New Bold.ttf"),
    ],
}

MAX_HEADLINE_CHARS = 82


def generate_story_carousel(
    research: dict,
    image_path: str,
    output_dir: str,
    selected_photo: dict | None = None,
) -> list[str]:
    """Build a five-slide branded carousel from a single image."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_dir = out_dir / "_raw"
    raw_paths = generate_grids(image_path, str(raw_dir), num_grids=5)
    slides = _build_slides(research, selected_photo or {})

    outputs: list[str] = []
    for index, slide in enumerate(slides, start=1):
        raw_image = raw_paths[min(index - 1, len(raw_paths) - 1)]
        output_path = out_dir / f"slide{index:02d}.jpg"
        _render_slide(raw_image, slide, output_path)
        outputs.append(str(output_path))

    return outputs


def _build_slides(research: dict, selected_photo: dict) -> list[dict]:
    public_story = (research.get("public_story") or {})
    static_story = public_story.get("static") or {}
    reel_story = public_story.get("reel") or {}
    badge = (
        static_story.get("badge_fr")
        or reel_story.get("badge_fr")
        or _default_badge(research.get("theme_key"))
        or "MTL ARCHIVES"
    ).strip().upper()
    meta = (
        static_story.get("meta_fr")
        or reel_story.get("meta_fr")
        or research.get("meta_fr")
        or selected_photo.get("cote")
        or selected_photo.get("date_value")
        or "archives de la ville de montréal"
    ).strip()

    explicit_slides = static_story.get("slides_fr") or []
    beats = []
    if len(explicit_slides) >= 5:
        for index, slide in enumerate(explicit_slides[:5]):
            style = "cover" if index == 0 else "outro" if index == 4 else "detail"
            beats.append(
                {
                    "style": style,
                    "badge": badge,
                    "headline": _slide_headline(slide.get("headline")),
                    "body": _slide_body(slide.get("body")),
                    "meta": meta,
                }
            )
    else:
        title = (
            static_story.get("title_fr")
            or reel_story.get("title_fr")
            or research.get("title_fr")
            or research.get("hook_fr")
            or "Montréal, en détail"
        ).strip()
        visual = _slide_headline(
            static_story.get("visual_fr")
            or reel_story.get("visual_fr")
            or research.get("hook_fr")
            or research.get("context_fr")
            or title
        )
        teach = _slide_headline(
            static_story.get("teach_fr")
            or reel_story.get("teach_fr")
            or research.get("detail_fr")
            or research.get("date_clue_fr")
            or title
        )
        change = _slide_headline(
            static_story.get("change_fr")
            or reel_story.get("change_fr")
            or reel_story.get("reflection_fr")
            or research.get("legacy_fr")
            or research.get("detail_fr")
            or title
        )
        outro = _slide_headline(
            static_story.get("cta_fr")
            or reel_story.get("cta_fr")
            or "Le contexte complet sur mtlarchives.com."
        )
        beats = [
            {"style": "cover", "badge": badge, "headline": title, "body": "", "meta": meta},
            {"style": "detail", "badge": badge, "headline": visual, "body": "", "meta": meta},
            {"style": "detail", "badge": badge, "headline": teach, "body": "", "meta": meta},
            {"style": "detail", "badge": badge, "headline": change, "body": "", "meta": meta},
            {"style": "outro", "badge": badge, "headline": outro, "body": "", "meta": meta},
        ]

    cleaned: list[dict] = []
    for beat in beats:
        cleaned.append(
            {
                "style": beat["style"],
                "badge": beat["badge"],
                "headline": _shorten(beat["headline"], MAX_HEADLINE_CHARS),
                "body": _shorten(beat["body"], 90),
                "meta": beat["meta"][:120],
            }
        )
    return cleaned


def _slide_headline(text: str) -> str:
    clean = " ".join(str(text or "").split()).strip()
    if not clean:
        return ""
    if clean.lower().startswith("regardez "):
        return clean
    return clean


def _slide_body(text: str) -> str:
    clean = " ".join(str(text or "").split()).strip()
    return clean[:120]


def _render_slide(raw_image_path: str, slide: dict, output_path: Path) -> None:
    image = Image.open(raw_image_path).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    canvas = image.convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    _apply_chrome(canvas, draw, slide)

    rgb = canvas.convert("RGB")
    rgb.save(output_path, quality=94)


def _apply_chrome(canvas: Image.Image, draw: ImageDraw.ImageDraw, slide: dict) -> None:
    style = slide["style"]
    _draw_vertical_gradient(draw, 0, 64, (17, 19, 24, 52), (17, 19, 24, 0))
    _draw_vertical_gradient(draw, 988, SIZE, (17, 19, 24, 0), (17, 19, 24, 118))

    _draw_badge(draw, slide["badge"])

    if style == "cover":
        _draw_text_card(draw, slide, x=46, y=834, max_width=740, max_height=86)
    elif style == "outro":
        _draw_text_card(draw, slide, x=46, y=888, max_width=860, max_height=60)
    else:
        _draw_text_card(draw, slide, x=46, y=896, max_width=820, max_height=52)

    _draw_footer(draw, slide["meta"])


def _draw_badge(draw: ImageDraw.ImageDraw, badge: str) -> None:
    mono = _get_font("mono", 18)
    draw.rectangle((44, 34, 92, 40), fill=RIVER_BLUE)
    draw.rectangle((98, 34, 146, 40), fill=COPPER)
    label_width = int(draw.textlength(badge, font=mono)) + 34
    draw.rounded_rectangle((44, 48, 44 + label_width, 80), radius=9, fill=(17, 19, 24, 138))
    draw.text((61, 55), badge, fill=PAPER, font=mono)


def _default_badge(theme_key: str | None) -> str:
    badges = {
        "nostalgia": "MÉMOIRE DE QUARTIER",
        "detective": "LECTURE D'ARCHIVE",
        "erased history": "HISTOIRE EFFACÉE",
        "mystery": "MYSTÈRE MONTRÉAL",
    }
    return badges.get(theme_key or "", "MTL ARCHIVES")


def _draw_text_card(
    draw: ImageDraw.ImageDraw,
    slide: dict,
    x: int,
    y: int,
    max_width: int,
    max_height: int,
    *,
    fill_alpha: int = 150,
) -> None:
    headline_font, headline_lines, headline_line_height = _fit_block(
        slide["headline"],
        max_width=max_width,
        max_height=max_height if not slide["body"] else int(max_height * 0.72),
        start_size=56 if slide["style"] == "cover" else 40,
        min_size=24,
        role="display",
        max_lines=2,
    )
    body = slide["body"].strip()

    current_y = y + 22
    line_widths = [int(draw.textlength(line, font=headline_font)) for line in headline_lines]
    content_width = max(line_widths) if line_widths else 0
    content_height = headline_line_height * len(headline_lines)

    body_layout = None
    if body:
        body_font, body_lines, body_line_height = _fit_block(
            body,
            max_width=max_width,
            max_height=max(40, max_height - content_height - 18),
            start_size=22,
            min_size=16,
            role="brand",
            max_lines=1,
        )
        body_width = max(int(draw.textlength(line, font=body_font)) for line in body_lines)
        content_width = max(content_width, body_width)
        content_height += 14 + body_line_height * len(body_lines)
        body_layout = (body_font, body_lines, body_line_height)

    card_width = min(max_width + 48, content_width + 56)
    card_height = content_height + 42
    draw.rounded_rectangle(
        (x, y, x + card_width, y + card_height),
        radius=22,
        fill=(17, 19, 24, fill_alpha),
    )

    for line in headline_lines:
        line_x = x + 28
        draw.text((line_x + 2, current_y + 3), line, fill=(0, 0, 0, 110), font=headline_font)
        draw.text((line_x, current_y), line, fill=PAPER, font=headline_font)
        current_y += headline_line_height

    if body and body_layout:
        current_y += 18
        body_font, body_lines, body_line_height = body_layout
        for line in body_lines:
            line_x = x + 28
            draw.text((line_x, current_y), line, fill=STEEL, font=body_font)
            current_y += body_line_height


def _draw_footer(draw: ImageDraw.ImageDraw, meta: str) -> None:
    brand_font = _get_font("brand", 21)
    mono_font = _get_font("mono", 17)
    draw.text((45, 1027), "mtl archives", fill=(0, 0, 0, 120), font=brand_font)
    draw.text((44, 1026), "mtl archives", fill=PAPER, font=brand_font)
    if meta:
        width = int(draw.textlength(meta, font=mono_font))
        meta_x = SIZE - 44 - width
        draw.text((meta_x + 1, 1031), meta, fill=(0, 0, 0, 120), font=mono_font)
        draw.text((meta_x, 1030), meta, fill=STEEL, font=mono_font)


def _draw_vertical_gradient(
    draw: ImageDraw.ImageDraw,
    y0: int,
    y1: int,
    top_rgba: tuple[int, int, int, int],
    bottom_rgba: tuple[int, int, int, int],
) -> None:
    span = max(1, y1 - y0)
    for step, y in enumerate(range(y0, y1)):
        t = step / max(1, span - 1)
        fill = tuple(int(top_rgba[index] + (bottom_rgba[index] - top_rgba[index]) * t) for index in range(4))
        draw.line((0, y, SIZE, y), fill=fill)


def _shorten(text: str, limit: int) -> str:
    clean = " ".join(text.split())
    if len(clean) <= limit:
        return clean
    clipped = clean[: limit - 1].rsplit(" ", 1)[0].strip()
    return (clipped or clean[: limit - 1]).rstrip(" ,.;:!?") + "…"


def _fit_block(
    text: str,
    *,
    max_width: int,
    max_height: int,
    start_size: int,
    min_size: int,
    role: str,
    max_lines: int,
) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    for size in range(start_size, min_size - 1, -2):
        font = _get_font(role, size)
        lines = _wrap_text(text, font, max_width, max_lines=max_lines)
        line_height = int(size * 1.14)
        if len(lines) * line_height <= max_height:
            return font, lines, line_height
    font = _get_font(role, min_size)
    return font, _wrap_text(text, font, max_width, max_lines=max_lines), int(min_size * 1.14)


def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int, max_lines: int) -> list[str]:
    words = text.split()
    if not words:
        return [""]

    lines: list[str] = []
    current = words[0]
    word_index = 1
    while word_index < len(words):
        word = words[word_index]
        candidate = f"{current} {word}"
        width = font.getbbox(candidate)[2]
        if width <= max_width:
            current = candidate
            word_index += 1
            continue
        lines.append(current)
        current = word
        if len(lines) >= max_lines - 1:
            break

        word_index += 1

    remainder_words = words[word_index + 1 :] if len(lines) >= max_lines - 1 else []
    if remainder_words:
        current = f"{current} {' '.join(remainder_words)}".strip()
    lines.append(current)

    clipped = lines[:max_lines]
    if len(lines) > max_lines:
        clipped[-1] = _ellipsize(clipped[-1], font, max_width)
    elif len(clipped) == max_lines and font.getbbox(clipped[-1])[2] > max_width:
        clipped[-1] = _ellipsize(clipped[-1], font, max_width)
    return clipped


def _ellipsize(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> str:
    base = text.strip()
    while base:
        candidate = f"{base}…"
        if font.getbbox(candidate)[2] <= max_width:
            return candidate
        base = base[:-1].rstrip()
    return "…"


@lru_cache(maxsize=64)
def _get_font(role: str, size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS[role]:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except Exception:
                continue
    return ImageFont.load_default()
