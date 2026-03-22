#!/usr/bin/env python3
"""Generate an editorial Instagram reel from a single archival photo."""

import argparse
import json
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Reel specs
WIDTH = 1080
HEIGHT = 1920
FPS = 30
PREP_W = 2160
PREP_H = 3840

# Paper-inspired palette
CHARCOAL = (17, 19, 24)
PAPER = (245, 242, 234)
STEEL = (200, 205, 212)
RIVER_BLUE = (15, 94, 168)
COPPER = (181, 106, 58)
LOGO_ORANGE = (255, 149, 0)
LOGO_YELLOW = (255, 214, 10)
LOGO_GREEN = (52, 199, 89)
LOGO_BLUE = (10, 132, 255)

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

# Semantic regions
REGION_PRESETS = {
    "full": (1.00, 0.50, 0.50),
    "top": (1.18, 0.50, 0.30),
    "center": (1.12, 0.50, 0.50),
    "bottom": (1.16, 0.50, 0.70),
    "left": (1.18, 0.18, 0.50),
    "center-left": (1.18, 0.36, 0.50),
    "center-right": (1.18, 0.64, 0.50),
    "right": (1.18, 0.82, 0.50),
    "top-left": (1.24, 0.22, 0.34),
    "top-right": (1.24, 0.78, 0.34),
    "bottom-left": (1.24, 0.22, 0.68),
    "bottom-right": (1.24, 0.78, 0.68),
}

_REGION_KEYWORDS = {
    "bottom": [
        "route",
        "autoroute",
        "asphalte",
        "chantier",
        "camions",
        "polo",
        "fermes",
        "road",
        "highway",
        "traffic",
        "truck",
        "farm",
    ],
    "top": [
        "silence",
        "rivière",
        "riviere",
        "river",
        "sanctuaire",
        "sœurs",
        "soeurs",
        "sisters",
        "maison",
        "convent",
    ],
    "center": [
        "cartierville",
        "laval",
        "pont",
        "bridge",
        "misericorde",
    ],
}

_DEFAULT_REGIONS = ["left", "center-left", "center-right", "right"]


def generate_reel(
    research: dict,
    main_image: str,
    grid_images: list[str] | None = None,
    output_path: str = "reel.mp4",
    work_dir: str | None = None,
    **kwargs,
) -> str:
    """Generate an editorial reel with Paper-inspired chrome."""
    if work_dir is None:
        work_dir = tempfile.mkdtemp(prefix="reel_")

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)

    story = _build_story(research)

    photo_src = str(work / "photo_2x.jpg")
    _prepare_photo(main_image, photo_src)
    full_frame_src = str(work / "photo_full_2x.jpg")
    _prepare_full_frame(main_image, full_frame_src)
    story_panels = _generate_story_panels(main_image, str(work), count=4)
    print("   📐 Prepared 2x source from full image")

    use_vertical_grids = _has_vertical_grids(grid_images)
    use_story_panels = bool(story_panels) and not use_vertical_grids
    if use_vertical_grids:
        print("   🧩 Using vertical grids for photo reveals")
    elif use_story_panels:
        print("   🪟 Using portrait story panels to traverse the full image")
    else:
        region_1 = _match_region(story["hook"], 0)
        region_2 = _match_region(story["context"], 1, exclude=[region_1])
        region_3 = _match_region(story["detail"], 2, exclude=[region_1, region_2])
        region_4 = _match_region(story["date_clue"], 3, exclude=[region_1, region_2, region_3])
        print(f"   🎯 Regions: r1={region_1}, r2={region_2}, r3={region_3}, r4={region_4}")

    if use_story_panels:
        segments = [
            ("seg00", "text", story["hook"], _text_duration(story["hook"]), *_panel_pair(full_frame=True, is_text=True)),
            ("seg01", "photo", None, 2.6, *_panel_pair(index=0)),
            ("seg02", "text", story["context"], _text_duration(story["context"]), *_panel_pair(index=1, is_text=True)),
            ("seg03", "photo", None, 2.6, *_panel_pair(index=1)),
            ("seg04", "text", story["detail"], _text_duration(story["detail"]), *_panel_pair(index=2, is_text=True)),
            ("seg05", "photo", None, 2.6, *_panel_pair(index=2)),
            ("seg06", "text", story["date_clue"], _text_duration(story["date_clue"]), *_panel_pair(index=3, is_text=True)),
            ("seg07", "photo", None, 2.6, *_panel_pair(index=3)),
            ("seg08", "text", story["legacy"], _text_duration(story["legacy"]), *_panel_pair(full_frame=True, is_text=True)),
            ("seg09", "text", story["end_hook"], _text_duration(story["end_hook"], minimum=3.4, maximum=4.6), *_panel_pair(full_frame=True, closing=True, is_text=True)),
        ]
    else:
        segments = [
            ("seg00", "text", story["hook"], _text_duration(story["hook"]), (1.08, 0.50, 0.48), (1.12, 0.50, 0.46)),
            ("seg01", "photo", None, 2.6, *_region_pair("bottom" if use_vertical_grids else region_1, zoom_bump=0.00)),
            ("seg02", "text", story["context"], _text_duration(story["context"]), *_region_pair("center" if use_vertical_grids else region_2, is_text=True)),
            ("seg03", "photo", None, 2.6, *_region_pair("center" if use_vertical_grids else region_2, zoom_bump=0.04)),
            ("seg04", "text", story["detail"], _text_duration(story["detail"]), *_region_pair("center-left" if use_vertical_grids else region_3, is_text=True)),
            ("seg05", "photo", None, 2.6, *_region_pair("center-left" if use_vertical_grids else region_3, zoom_bump=0.05)),
            ("seg06", "text", story["date_clue"], _text_duration(story["date_clue"]), *_region_pair("top" if use_vertical_grids else region_4, is_text=True)),
            ("seg07", "photo", None, 2.6, *_region_pair("top" if use_vertical_grids else region_4, zoom_bump=0.05)),
            ("seg08", "text", story["legacy"], _text_duration(story["legacy"]), (1.06, 0.50, 0.50), (1.08, 0.50, 0.48)),
            ("seg09", "text", story["end_hook"], _text_duration(story["end_hook"], minimum=3.4, maximum=4.6), (1.04, 0.50, 0.50), (1.02, 0.50, 0.50)),
        ]

    segment_videos = []
    durations = []

    grid_for_segment = {}
    if use_vertical_grids:
        grid_for_segment = {
            "seg01": grid_images[0],
            "seg03": grid_images[1],
            "seg05": grid_images[2],
            "seg07": grid_images[3],
        }

    panel_for_segment = {}
    if use_story_panels:
        panel_for_segment = {
            "seg00": full_frame_src,
            "seg01": story_panels[0],
            "seg02": story_panels[1],
            "seg03": story_panels[1],
            "seg04": story_panels[2],
            "seg05": story_panels[2],
            "seg06": story_panels[3],
            "seg07": story_panels[3],
            "seg08": full_frame_src,
            "seg09": full_frame_src,
        }

    for name, seg_type, text, dur, start, end in segments:
        source = panel_for_segment.get(name) or grid_for_segment.get(name, photo_src)
        seg_path = str(work / f"{name}.mp4")
        seg_story = dict(story)
        if name == "seg09" and story.get("cta"):
            seg_story["subhead"] = story["cta"]
        _render_segment(
            photo_path=source,
            output_path=seg_path,
            duration=dur,
            start_region=start,
            end_region=end,
            seg_type=seg_type,
            text=text,
            story=seg_story,
            work_dir=str(work),
            name=name,
        )
        segment_videos.append(seg_path)
        durations.append(dur)

    xfade_dur = 0.28
    raw_path = str(work / "raw_composed.mp4")
    _compose_with_xfade(segment_videos, durations, xfade_dur, raw_path)
    _finalize(raw_path, output_path)
    assert_reel_dimensions(output_path)
    return output_path


def _has_vertical_grids(grid_images: list[str] | None) -> bool:
    if not grid_images or len(grid_images) < 4:
        return False
    try:
        for path in grid_images[:4]:
            with Image.open(path) as img:
                if img.height <= img.width:
                    return False
        return True
    except OSError:
        return False


def _panel_pair(index: int = 0, *, full_frame: bool = False, is_text: bool = False, closing: bool = False):
    if full_frame:
        if closing:
            return ((1.00, 0.50, 0.50), (0.98, 0.50, 0.50))
        if is_text:
            return ((1.00, 0.50, 0.50), (1.03, 0.50, 0.50))
        return ((1.02, 0.50, 0.50), (1.08, 0.50, 0.50))

    starts = [1.04, 1.05, 1.05, 1.04]
    ends = [1.12, 1.14, 1.14, 1.12]
    start = starts[min(index, len(starts) - 1)]
    end = ends[min(index, len(ends) - 1)]
    if is_text:
        end = min(end, start + 0.05)
    return ((start, 0.50, 0.50), (end, 0.50, 0.50))


def _build_story(research: dict) -> dict:
    public_reel = ((research or {}).get("public_story") or {}).get("reel") or {}
    quality = ((research or {}).get("story_quality") or {}).get("reel") or {}
    public_reel_ok = bool(quality.get("pass"))
    cards = (public_reel.get("cards_fr") or []) if public_reel_ok else []
    meta = public_reel.get("meta_fr") or research.get("meta_fr") or _build_meta_label({}, research)
    hook = _story_text(public_reel.get("hook_fr"), research.get("most_striking_fr") or "Regardez bien cette archive.") if public_reel_ok else _story_text(research.get("most_striking_fr"), "Regardez bien cette archive.")
    visual = _story_text(public_reel.get("visual_fr"), research.get("scene_fr") or "On voit ici un lieu bien ancre dans le tissu montrealais.") if public_reel_ok else _story_text(research.get("scene_fr"), "On voit ici un lieu bien ancre dans le tissu montrealais.")
    teach = _story_text(public_reel.get("teach_fr"), research.get("lived_context_fr") or research.get("most_striking_fr") or "Ce qui frappe, c'est la vie du lieu.") if public_reel_ok else _story_text(research.get("lived_context_fr"), research.get("most_striking_fr") or "Ce qui frappe, c'est la vie du lieu.")
    change = _story_text(public_reel.get("change_fr"), research.get("what_changed_fr") or research.get("what_survived_fr") or "Aujourd'hui, le quartier ne se lit plus tout a fait pareil.") if public_reel_ok else _story_text(research.get("what_changed_fr"), research.get("what_survived_fr") or "Aujourd'hui, le quartier ne se lit plus tout a fait pareil.")
    reflection = _story_text(public_reel.get("reflection_fr"), research.get("closing_reflection_fr") or "Une partie de cette memoire reste visible.") if public_reel_ok else _story_text(research.get("closing_reflection_fr"), "Une partie de cette memoire reste visible.")
    closing = _story_text(public_reel.get("closing_fr"), research.get("closing_reflection_fr") or "Cette archive aide a voir Montreal autrement.") if public_reel_ok else _story_text(research.get("closing_reflection_fr"), "Cette archive aide a voir Montreal autrement.")
    cta = _story_text(public_reel.get("cta_fr"), "Le contexte complet sur mtlarchives.com.") if public_reel_ok else "Le contexte complet sur mtlarchives.com."

    return {
        "badge": (public_reel.get("badge_fr") if public_reel_ok else "") or _default_badge(research.get("theme_key")),
        "title": (public_reel.get("title_fr") if public_reel_ok else "") or research.get("title_fr") or research.get("title") or "Montreal, couche par couche.",
        "subhead": (public_reel.get("subhead_fr") if public_reel_ok else "") or meta,
        "hook": hook if public_reel_ok else _card_text(cards, 0, hook),
        "context": visual if public_reel_ok else _card_text(cards, 1, visual),
        "detail": teach if public_reel_ok else _card_text(cards, 2, teach),
        "date_clue": change if public_reel_ok else _card_text(cards, 3, change),
        "legacy": reflection if public_reel_ok else _card_text(cards, 4, reflection),
        "end_hook": closing if public_reel_ok else _card_text(cards, 5, closing),
        "meta": meta,
        "cta": cta,
        "credit": research.get("credit_fr") or "Archives de la Ville de Montreal",
        "location_short": research.get("location_short_fr") or "Montreal",
    }


def _build_meta_label(original: dict, research: dict) -> str:
    location = original.get("location_short_fr") or original.get("location") or research.get("location") or "Montreal"
    era = original.get("era") or research.get("era") or ""
    compact_era = _compact_era(era)
    return f"{location}, {compact_era}" if compact_era else str(location)


def _compact_era(text: str) -> str:
    clean = " ".join(str(text).split())
    if not clean:
        return ""
    replacements = {
        "septembre": "sept.",
        "octobre": "oct.",
        "novembre": "nov.",
        "decembre": "dec.",
        "décembre": "dec.",
    }
    lowered = clean.lower()
    for src, dest in replacements.items():
        lowered = lowered.replace(src, dest)
    return lowered[:36]


def _story_text(text: str, fallback: str) -> str:
    base = _clean(text) if text else ""
    return base or fallback


def _default_badge(theme_key: str | None) -> str:
    badges = {
        "nostalgia": "Memoire de quartier",
        "detective": "Lecture d'archive",
        "erased history": "Histoire effacee",
        "mystery": "Lecture d'archive",
    }
    return badges.get(theme_key or "", "MTL Archives")


def _text_duration(text: str, minimum: float = 3.2, maximum: float = 5.2) -> float:
    clean = _clean(text)
    if not clean:
        return minimum
    duration = 2.2 + (len(clean) / 18.0)
    return max(minimum, min(maximum, duration))


def _card_text(cards: list[dict], index: int, fallback: str) -> str:
    if index >= len(cards):
        return fallback
    headline = _clean(cards[index].get("headline", ""))
    return headline or fallback


def _match_region(text: str, index: int, exclude: list[str] | None = None) -> str:
    lower = text.lower()
    exclude = exclude or []

    for region_name, keywords in _REGION_KEYWORDS.items():
        if region_name in exclude:
            continue
        if any(keyword in lower for keyword in keywords):
            return region_name

    for region in _DEFAULT_REGIONS:
        if region not in exclude:
            return region
    return "center"


def _region_pair(region_name: str, zoom_bump: float = 0.0, is_text: bool = False):
    z, fx, fy = REGION_PRESETS.get(region_name, REGION_PRESETS["center"])
    z_start = z + zoom_bump

    if is_text:
        z_end = z_start + 0.04
    else:
        z_end = z_start + 0.08

    return (
        (z_start, fx, fy),
        (z_end, fx, fy),
    )


def _render_segment(
    photo_path: str,
    output_path: str,
    duration: float,
    start_region: tuple[float, float, float],
    end_region: tuple[float, float, float],
    seg_type: str,
    text: str | None,
    story: dict,
    work_dir: str,
    name: str,
):
    """Render one reel segment."""
    frames = int(duration * FPS)
    z0, fx0, fy0 = start_region
    z1, fx1, fy1 = end_region

    z_expr = f"{z0}+({z1}-{z0})*(on/{frames})"
    fx_expr = f"{fx0}+({fx1}-{fx0})*(on/{frames})"
    fy_expr = f"{fy0}+({fy1}-{fy0})*(on/{frames})"
    x_expr = f"trunc(({fx_expr})*iw - (iw/zoom/2))"
    y_expr = f"trunc(({fy_expr})*ih - (ih/zoom/2))"

    zoompan_filter = (
        f"zoompan=z='{z_expr}'"
        f":x='{x_expr}':y='{y_expr}'"
        f":d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS}"
    )

    overlay_path = Path(work_dir) / f"{name}_overlay.png"
    if seg_type == "text":
        _render_text_overlay_png(text or "", story, str(overlay_path))
        background_fx = "gblur=sigma=10,eq=brightness=-0.08:saturation=0.72:contrast=1.04"
    else:
        _render_photo_overlay_png(story, str(overlay_path))
        background_fx = "eq=brightness=-0.02:saturation=0.94:contrast=1.05"

    filter_complex = (
        f"[0:v]{zoompan_filter},{background_fx}[bg];"
        f"[1:v]format=rgba[ovr];"
        f"[bg][ovr]overlay=0:0:format=auto,format=yuv420p[v]"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        photo_path,
        "-loop",
        "1",
        "-t",
        str(duration),
        "-i",
        str(overlay_path),
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
        "-t",
        str(duration),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg segment {name} failed:\n{result.stderr[-1800:]}")


def _render_text_overlay_png(text: str, story: dict, output_path: str):
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    draw.rectangle([(0, 0), (WIDTH, HEIGHT)], fill=(17, 19, 24, 118))
    _draw_vertical_gradient(draw, 0, 480, (17, 19, 24, 210), (17, 19, 24, 90))
    _draw_vertical_gradient(draw, 1360, HEIGHT, (17, 19, 24, 10), (17, 19, 24, 240))

    badge_font = _get_font("mono", 24)
    draw.text((64, 98), story["badge"].upper(), fill=STEEL, font=badge_font)
    draw.rounded_rectangle((64, 140, 202, 148), radius=4, fill=RIVER_BLUE + (255,))
    draw.rounded_rectangle((212, 140, 322, 148), radius=4, fill=COPPER + (255,))

    title_font, lines, line_height = _fit_display_block(text, max_width=952, max_height=720)
    total_text_height = line_height * len(lines)
    text_top = max(460, 520 - total_text_height // 4)
    shadow_fill = (0, 0, 0, 120)

    for index, line in enumerate(lines):
        bbox = title_font.getbbox(line)
        text_width = bbox[2] - bbox[0]
        x = (WIDTH - text_width) // 2
        y = text_top + index * line_height
        draw.text((x + 2, y + 3), line, fill=shadow_fill, font=title_font)
        draw.text((x, y), line, fill=PAPER, font=title_font)

    subhead_font = _get_font("brand", 34)
    sub_lines = _wrap_text(story["subhead"], subhead_font, 840, max_lines=2)
    sub_y = text_top + total_text_height + 54
    for index, line in enumerate(sub_lines):
        bbox = subhead_font.getbbox(line)
        text_width = bbox[2] - bbox[0]
        x = (WIDTH - text_width) // 2
        y = sub_y + index * 44
        draw.text((x, y), line, fill=STEEL, font=subhead_font)

    credit_font = _get_font("mono", 22)
    draw.text((64, 1608), story["credit"].upper(), fill=(200, 205, 212, 225), font=credit_font)

    _draw_bottom_bar(draw, story)
    img.save(output_path)


def _render_photo_overlay_png(story: dict, output_path: str):
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    _draw_vertical_gradient(draw, 0, 300, (17, 19, 24, 150), (17, 19, 24, 0))
    _draw_vertical_gradient(draw, 1500, HEIGHT, (17, 19, 24, 0), (17, 19, 24, 220))

    badge_font = _get_font("mono", 22)
    label_w = int(draw.textlength(story["badge"].upper(), font=badge_font)) + 34
    draw.rounded_rectangle((40, 54, 40 + label_w, 104), radius=16, fill=(17, 19, 24, 158), outline=(245, 242, 234, 90), width=1)
    draw.text((58, 67), story["badge"].upper(), fill=PAPER, font=badge_font)

    meta_font = _get_font("mono", 22)
    draw.text((40, 128), story["meta"].upper(), fill=(245, 242, 234, 210), font=meta_font)

    _draw_bottom_bar(draw, story)
    img.save(output_path)


def _draw_bottom_bar(draw: ImageDraw.ImageDraw, story: dict):
    _draw_vertical_gradient(draw, 1680, HEIGHT, (17, 19, 24, 0), (17, 19, 24, 242))

    logo_x = 40
    logo_y = 1804
    _draw_logo_mark(draw, logo_x, logo_y)

    brand_font = _get_font("brand", 32)
    draw.text((90, 1798), "mtl archives", fill=PAPER, font=brand_font, stroke_width=1, stroke_fill=(245, 242, 234, 20))

    meta_font = _get_font("mono", 20)
    meta_width = int(draw.textlength(story["meta"], font=meta_font))
    meta_x = WIDTH - 40 - meta_width
    draw.text((meta_x, 1808), story["meta"], fill=STEEL, font=meta_font)


def _draw_logo_mark(draw: ImageDraw.ImageDraw, x: int, y: int):
    dots = [
        ((18, 18), 2.2, PAPER),
        ((18, 11), 2.0, RIVER_BLUE),
        ((18, 6), 1.5, RIVER_BLUE),
        ((15, 8.5), 1.5, RIVER_BLUE),
        ((21, 8.5), 1.5, RIVER_BLUE),
        ((25, 18), 2.0, LOGO_ORANGE),
        ((30, 18), 1.5, LOGO_ORANGE),
        ((27.5, 15), 1.5, LOGO_ORANGE),
        ((27.5, 21), 1.5, LOGO_ORANGE),
        ((18, 25), 2.0, LOGO_GREEN),
        ((18, 30), 1.5, LOGO_GREEN),
        ((15, 27.5), 1.5, LOGO_GREEN),
        ((21, 27.5), 1.5, LOGO_GREEN),
        ((11, 18), 2.0, LOGO_YELLOW),
        ((6, 18), 1.5, LOGO_YELLOW),
        ((8.5, 15), 1.5, LOGO_YELLOW),
        ((8.5, 21), 1.5, LOGO_YELLOW),
    ]

    for (cx, cy), radius, fill in dots:
        left = x + cx - radius
        top = y + cy - radius
        right = x + cx + radius
        bottom = y + cy + radius
        draw.ellipse((left, top, right, bottom), fill=fill)


def _draw_vertical_gradient(draw: ImageDraw.ImageDraw, y0: int, y1: int, top_rgba: tuple[int, int, int, int], bottom_rgba: tuple[int, int, int, int]):
    span = max(1, y1 - y0)
    for step, y in enumerate(range(y0, y1)):
        t = step / max(1, span - 1)
        fill = tuple(int(top_rgba[index] + (bottom_rgba[index] - top_rgba[index]) * t) for index in range(4))
        draw.line((0, y, WIDTH, y), fill=fill)


def _compose_with_xfade(segment_paths: list[str], durations: list[float], xfade_dur: float, output_path: str):
    if len(segment_paths) < 2:
        raise RuntimeError("Need at least 2 segments")

    inputs = []
    for segment in segment_paths:
        inputs.extend(["-i", segment])

    filter_parts = []
    running_offset = durations[0] - xfade_dur

    for index in range(1, len(segment_paths)):
        previous = f"[v{index - 2:02d}]" if index > 1 else "[0:v]"
        current = f"[{index}:v]"
        out_label = f"[v{index - 1:02d}]" if index < len(segment_paths) - 1 else "[vfinal]"
        filter_parts.append(
            f"{previous}{current}xfade=transition=fade:duration={xfade_dur}:offset={running_offset:.2f}{out_label}"
        )
        if index < len(segment_paths) - 1:
            running_offset += durations[index] - xfade_dur

    cmd = [
        "ffmpeg",
        "-y",
        *inputs,
        "-filter_complex",
        ";\n".join(filter_parts),
        "-map",
        "[vfinal]",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg compose failed:\n{result.stderr[-1800:]}")


def _finalize(input_path: str, output_path: str):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-vf",
        f"scale={WIDTH}:{HEIGHT}:flags=lanczos,setsar=1",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        "-movflags",
        "+faststart",
        "-an",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg finalize failed:\n{result.stderr[-1800:]}")


def assert_reel_dimensions(video_path: str) -> None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for reel validation:\n{result.stderr[-1000:]}")

    try:
        payload = json.loads(result.stdout)
        stream = (payload.get("streams") or [])[0]
        width = int(stream.get("width", 0))
        height = int(stream.get("height", 0))
    except Exception as exc:
        raise RuntimeError(f"Invalid ffprobe output during reel validation: {exc}") from exc

    if (width, height) != (WIDTH, HEIGHT):
        raise RuntimeError(
            f"Invalid reel dimensions for {video_path}: expected {WIDTH}x{HEIGHT}, got {width}x{height}"
        )


def _clean(text: str) -> str:
    return " ".join(_strip_emoji(text).strip().split())


def _strip_emoji(text: str) -> str:
    import re

    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\U0000FE00-\U0000FE0F"
        "\U0000200D"
        "]+",
        flags=re.UNICODE,
    )
    return emoji_pattern.sub("", text)


@lru_cache(maxsize=64)
def _get_font(role: str, size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS.get(role, []):
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:
                continue
    return ImageFont.load_default()


def _fit_display_block(text: str, max_width: int, max_height: int, max_lines: int = 5):
    for size in range(94, 55, -4):
        font = _get_font("display", size)
        lines = _wrap_text(text, font, max_width, max_lines=max_lines)
        line_height = int(size * 1.16)
        if len(lines) <= max_lines and (len(lines) * line_height) <= max_height:
            return font, lines, line_height

    font = _get_font("display", 56)
    lines = _wrap_text(text, font, max_width, max_lines=max_lines)
    return font, lines, int(56 * 1.16)


def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int, max_lines: int | None = None) -> list[str]:
    words = text.split()
    if not words:
        return [""]

    lines = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        bbox = font.getbbox(candidate)
        width = bbox[2] - bbox[0]
        if width <= max_width or not current:
            current = candidate
            continue
        lines.append(current)
        current = word

    if current:
        lines.append(current)

    if max_lines and len(lines) > max_lines:
        kept = lines[: max_lines - 1]
        remainder = " ".join(lines[max_lines - 1 :])
        kept.append(_ellipsize(remainder, font, max_width))
        return kept
    return lines


def _ellipsize(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> str:
    candidate = text
    while candidate:
        bbox = font.getbbox(candidate + "…")
        width = bbox[2] - bbox[0]
        if width <= max_width:
            return candidate + "…"
        candidate = " ".join(candidate.split()[:-1])
    return "…"


def _prepare_photo(image_path: str, output_path: str) -> str:
    img = Image.open(image_path)
    if img.mode == "RGBA":
        img = img.convert("RGB")

    width, height = img.size
    target_aspect = 9 / 16
    current_aspect = width / height

    if current_aspect > target_aspect:
        new_width = int(height * target_aspect)
        left = (width - new_width) // 2
        img = img.crop((left, 0, left + new_width, height))
    else:
        new_height = int(width / target_aspect)
        top = (height - new_height) // 2
        img = img.crop((0, top, width, top + new_height))

    img = img.resize((PREP_W, PREP_H), Image.LANCZOS)
    img.save(output_path, quality=95)
    return output_path


def _prepare_full_frame(image_path: str, output_path: str) -> str:
    img = Image.open(image_path).convert("RGB")
    background = img.resize((PREP_W, PREP_H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(radius=28))
    background = Image.blend(background, Image.new("RGB", (PREP_W, PREP_H), CHARCOAL), 0.28)

    canvas = Image.new("RGB", (PREP_W, PREP_H), CHARCOAL)
    canvas.paste(background, (0, 0))

    fitted = img.copy()
    fitted.thumbnail((PREP_W - 240, PREP_H - 320), Image.LANCZOS)
    x = (PREP_W - fitted.width) // 2
    y = (PREP_H - fitted.height) // 2
    canvas.paste(fitted, (x, y))
    canvas.save(output_path, quality=95)
    return output_path


def _generate_story_panels(image_path: str, work_dir: str, count: int = 4) -> list[str]:
    img = Image.open(image_path).convert("RGB")
    width, height = img.size
    target_aspect = WIDTH / HEIGHT
    work = Path(work_dir)
    paths: list[str] = []

    if width / height >= target_aspect:
        crop_width = max(1, min(width, int(height * target_aspect)))
        crop_height = height
        travel = max(0, width - crop_width)
        positions = _evenly_spaced_positions(travel, count)
        for idx, left in enumerate(positions, start=1):
            crop = img.crop((left, 0, left + crop_width, crop_height)).resize((PREP_W, PREP_H), Image.LANCZOS)
            path = work / f"panel_{idx:02d}.jpg"
            crop.save(path, quality=95)
            paths.append(str(path))
    else:
        crop_width = width
        crop_height = max(1, min(height, int(width / target_aspect)))
        travel = max(0, height - crop_height)
        positions = _evenly_spaced_positions(travel, count)
        for idx, top in enumerate(positions, start=1):
            crop = img.crop((0, top, crop_width, top + crop_height)).resize((PREP_W, PREP_H), Image.LANCZOS)
            path = work / f"panel_{idx:02d}.jpg"
            crop.save(path, quality=95)
            paths.append(str(path))

    return paths


def _evenly_spaced_positions(travel: int, count: int) -> list[int]:
    if count <= 1:
        return [max(0, travel // 2)]
    if travel <= 0:
        return [0 for _ in range(count)]
    return [round((travel * idx) / (count - 1)) for idx in range(count)]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate reel video")
    parser.add_argument("--research", "-r", required=True, help="Path to research.json")
    parser.add_argument("--image", "-i", required=True, help="Main image path")
    parser.add_argument("--grids", "-g", nargs="*", default=[], help="Grid image paths")
    parser.add_argument("--output", "-o", required=True, help="Output video path")
    parser.add_argument("--work-dir", "-w", help="Working directory")
    args = parser.parse_args()

    research_data = json.loads(Path(args.research).read_text())
    result = generate_reel(research_data, args.image, args.grids, args.output, args.work_dir)
    print(f"✅ Reel generated: {result}")
