"""Generate contextual grid crops from a source image."""

from __future__ import annotations

import math
import os
from collections import Counter

from PIL import Image, ImageFilter, ImageStat


HINT_REGIONS = {
    "signage": ["center-right", "right", "bottom-right"],
    "street": ["bottom-left", "bottom", "bottom-right"],
    "building": ["center", "center-right", "center-left"],
    "people": ["bottom-left", "bottom", "center-left"],
}

HINT_KEYWORDS = {
    "signage": ("enseigne", "sign", "vitrine", "store", "storefront", "advert", "caporal", "bank"),
    "street": ("tramway", "rail", "rails", "voiture", "voitures", "autos", "cars", "traffic", "trottoir", "street", "rue"),
    "building": ("façade", "facade", "hôpital", "hospital", "hotel", "banque", "bank", "building", "immeuble"),
    "people": ("piéton", "piétons", "pedestrian", "pedestrians", "passants", "crowd", "foule"),
}

REGION_CENTERS = {
    "top-left": (0.24, 0.24),
    "top": (0.50, 0.22),
    "top-right": (0.76, 0.24),
    "center-left": (0.32, 0.50),
    "center": (0.50, 0.50),
    "center-right": (0.68, 0.50),
    "bottom-left": (0.28, 0.72),
    "bottom": (0.50, 0.74),
    "bottom-right": (0.72, 0.72),
    "left": (0.20, 0.50),
    "right": (0.80, 0.50),
}


def generate_grids(
    image_path: str,
    output_dir: str,
    num_grids: int = 5,
    research: dict | None = None,
    selected_photo: dict | None = None,
) -> list[str]:
    """
    Generate contextual detail crops from a source image.

    Creates:
    - grid01: best cover crop preserving overall context
    - grid02-05: content-aware detail crops selected by image texture and story hints

    Returns list of output file paths.
    """
    os.makedirs(output_dir, exist_ok=True)
    img = Image.open(image_path).convert("RGB")
    w, h = img.size

    outputs = []
    cover_box = _best_cover_crop(img, research=research, selected_photo=selected_photo)
    cover = img.crop(cover_box).resize((1080, 1080), Image.LANCZOS)
    cover_path = os.path.join(output_dir, "grid01_cover.jpg")
    cover.save(cover_path, quality=92)
    outputs.append(cover_path)

    crop_regions = _select_contextual_regions(
        img,
        num_crops=max(0, num_grids - 1),
        research=research,
        selected_photo=selected_photo,
        cover_box=cover_box,
    )

    for i, (x1, y1, x2, y2) in enumerate(crop_regions, start=2):
        crop = img.crop((x1, y1, x2, y2)).resize((900, 900), Image.LANCZOS)
        crop_path = os.path.join(output_dir, f"grid{i:02d}_detail.jpg")
        crop.save(crop_path, quality=92)
        outputs.append(crop_path)

    return outputs


def _best_cover_crop(
    img: Image.Image,
    *,
    research: dict | None,
    selected_photo: dict | None,
) -> tuple[int, int, int, int]:
    w, h = img.size
    size = min(w, h)
    slack_x = max(0, w - size)
    slack_y = max(0, h - size)
    candidates = []
    for fx, fy in ((0.5, 0.5), (0.42, 0.5), (0.58, 0.5), (0.5, 0.42), (0.5, 0.58)):
        left = int(round(slack_x * fx))
        top = int(round(slack_y * fy))
        left = max(0, min(left, w - size))
        top = max(0, min(top, h - size))
        box = (left, top, left + size, top + size)
        score = _score_crop(img, box, research=research, selected_photo=selected_photo, cover=True)
        candidates.append((score, box))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _select_contextual_regions(
    img: Image.Image,
    *,
    num_crops: int,
    research: dict | None,
    selected_photo: dict | None,
    cover_box: tuple[int, int, int, int],
) -> list[tuple[int, int, int, int]]:
    if num_crops <= 0:
        return []

    candidates = _candidate_boxes(img, research=research, selected_photo=selected_photo)
    scored = []
    for box in candidates:
        score = _score_crop(img, box, research=research, selected_photo=selected_photo, cover=False)
        score -= _iou(box, cover_box) * 0.5
        scored.append((score, box))

    scored.sort(key=lambda item: item[0], reverse=True)

    chosen: list[tuple[int, int, int, int]] = []
    for _, box in scored:
        if any(_iou(box, existing) > 0.58 for existing in chosen):
            continue
        chosen.append(box)
        if len(chosen) >= num_crops:
            break

    if len(chosen) < num_crops:
        fallback = _fallback_regions(*img.size)
        for box in fallback:
            if any(_iou(box, existing) > 0.58 for existing in chosen):
                continue
            chosen.append(box)
            if len(chosen) >= num_crops:
                break

    return chosen[:num_crops]


def _candidate_boxes(
    img: Image.Image,
    *,
    research: dict | None,
    selected_photo: dict | None,
) -> list[tuple[int, int, int, int]]:
    w, h = img.size
    base = min(w, h)
    sizes = [int(base * ratio) for ratio in (0.72, 0.62, 0.52)]
    sizes = [max(220, min(base, s)) for s in sizes]

    boxes: list[tuple[int, int, int, int]] = []
    for size in sizes:
        slack_x = max(0, w - size)
        slack_y = max(0, h - size)
        for fx in (0.12, 0.28, 0.5, 0.72, 0.88):
            for fy in (0.18, 0.34, 0.5, 0.66, 0.82):
                left = int(round(slack_x * fx))
                top = int(round(slack_y * fy))
                boxes.append(_clamp_box(left, top, size, w, h))

    for region_name in _hint_regions_from_text(research, selected_photo):
        cx, cy = REGION_CENTERS[region_name]
        for size in sizes[:2]:
            left = int(round(cx * w - size / 2))
            top = int(round(cy * h - size / 2))
            boxes.append(_clamp_box(left, top, size, w, h))

    # preserve order while deduplicating
    return list(dict.fromkeys(boxes))


def _hint_regions_from_text(research: dict | None, selected_photo: dict | None) -> list[str]:
    text_parts = []
    if research:
        text_parts.extend(
            str(research.get(key) or "")
            for key in (
                "scene_fr",
                "most_striking_fr",
                "lived_context_fr",
                "what_changed_fr",
                "what_survived_fr",
                "title_fr",
            )
        )
        for detail in research.get("details_fr") or []:
            text_parts.append(str(detail.get("text") or ""))
    if selected_photo:
        text_parts.extend(
            str(selected_photo.get(key) or "")
            for key in ("name", "description", "portalTitle", "portalDescription")
        )

    text = " ".join(text_parts).lower()
    hints: list[str] = []
    for hint_key, keywords in HINT_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            hints.extend(HINT_REGIONS[hint_key])
    if not hints:
        hints.extend(["center", "center-right", "bottom"])
    counts = Counter(hints)
    return [name for name, _ in counts.most_common()]


def _score_crop(
    img: Image.Image,
    box: tuple[int, int, int, int],
    *,
    research: dict | None,
    selected_photo: dict | None,
    cover: bool,
) -> float:
    crop = img.crop(box)
    gray = crop.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    gray_stats = ImageStat.Stat(gray)
    edge_stats = ImageStat.Stat(edges)

    stddev = gray_stats.stddev[0] / 64.0
    edge_mean = edge_stats.mean[0] / 32.0
    edge_std = edge_stats.stddev[0] / 40.0
    brightness = gray_stats.mean[0] / 255.0
    active_ratio, row_coverage, col_coverage = _content_coverage(edges)

    score = stddev + edge_mean + edge_std
    score += active_ratio * 6.0
    score += row_coverage * 1.6
    score += col_coverage * 1.2
    if brightness > 0.82 and stddev < 0.25:
        score -= 1.8
    if brightness < 0.12 and stddev < 0.20:
        score -= 0.8
    if row_coverage < 0.40:
        score -= 2.0
    if active_ratio < 0.05:
        score -= 1.4

    x1, y1, x2, y2 = box
    w, h = img.size
    cx = ((x1 + x2) / 2) / w
    cy = ((y1 + y2) / 2) / h
    score += _region_alignment_bonus(cx, cy, research=research, selected_photo=selected_photo)

    if cover:
        score += 0.18 - abs(0.5 - cx) * 0.16
        score += 0.18 - abs(0.48 - cy) * 0.14
    else:
        score += 0.10 * (1.0 - abs(0.62 - cy))

    return score


def _content_coverage(edges: Image.Image) -> tuple[float, float, float]:
    edge_map = edges.point(lambda p: 255 if p > 24 else 0)
    hist = edge_map.histogram()
    total = max(1, sum(hist))
    active = total - hist[0]
    active_ratio = active / total

    width, height = edge_map.size
    pixels = edge_map.load()

    active_rows = 0
    for y in range(height):
        row_hits = 0
        for x in range(width):
            if pixels[x, y] > 0:
                row_hits += 1
        if row_hits / max(1, width) > 0.03:
            active_rows += 1

    active_cols = 0
    for x in range(width):
        col_hits = 0
        for y in range(height):
            if pixels[x, y] > 0:
                col_hits += 1
        if col_hits / max(1, height) > 0.03:
            active_cols += 1

    row_coverage = active_rows / max(1, height)
    col_coverage = active_cols / max(1, width)
    return active_ratio, row_coverage, col_coverage


def _region_alignment_bonus(
    cx: float,
    cy: float,
    *,
    research: dict | None,
    selected_photo: dict | None,
) -> float:
    bonus = 0.0
    for region_name in _hint_regions_from_text(research, selected_photo)[:4]:
        rx, ry = REGION_CENTERS[region_name]
        distance = math.hypot(cx - rx, cy - ry)
        bonus += max(0.0, 0.22 - distance * 0.35)
    return bonus


def _fallback_regions(w: int, h: int) -> list[tuple[int, int, int, int]]:
    size = int(min(w, h) * 0.58)
    anchors = [
        REGION_CENTERS["center"],
        REGION_CENTERS["center-right"],
        REGION_CENTERS["bottom-right"],
        REGION_CENTERS["bottom-left"],
        REGION_CENTERS["top-right"],
    ]
    return [_clamp_box(int(cx * w - size / 2), int(cy * h - size / 2), size, w, h) for cx, cy in anchors]


def _clamp_box(left: int, top: int, size: int, w: int, h: int) -> tuple[int, int, int, int]:
    left = max(0, min(left, w - size))
    top = max(0, min(top, h - size))
    return (left, top, left + size, top + size)


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union else 0.0


def prepare_for_reel(image_path: str, output_path: str, target_w: int = 2160, target_h: int = 3840) -> str:
    """Prepare an image for 9:16 reel format with zoom headroom."""
    img = Image.open(image_path)
    w, h = img.size

    target_aspect = 9 / 16
    current_aspect = w / h

    if current_aspect > target_aspect:
        new_w = int(h * target_aspect)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_aspect)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))

    img = img.resize((target_w, target_h), Image.LANCZOS)
    img.save(output_path, quality=95)
    return output_path
