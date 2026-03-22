from __future__ import annotations

import argparse
import json
import re
from datetime import UTC, date, datetime
from pathlib import Path


SITE_URL = "https://www.mtlarchives.com"


def build_story_seed(
    *,
    run_date: date,
    theme_key: str,
    theme_label: str,
    selected_photo: dict | None,
    research: dict,
    package_dir: str | Path,
    site_url: str = SITE_URL,
) -> dict:
    photo = selected_photo or {}
    public_story = research.get("public_story") or {}
    static_story = public_story.get("static") or {}
    reel_story = public_story.get("reel") or {}

    metadata_filename = str(photo.get("metadata_filename") or photo.get("metadataFilename") or "").strip()
    image_filename = str(photo.get("filename") or photo.get("imageFilename") or "").strip()
    photo_id = _photo_id(metadata_filename or image_filename)
    title = (
        static_story.get("title_fr")
        or reel_story.get("title_fr")
        or research.get("title_fr")
        or photo.get("name")
        or "Archive Story"
    )
    dek = (
        static_story.get("caption_fr")
        or reel_story.get("subhead_fr")
        or research.get("most_striking_fr")
        or research.get("summary_fr")
        or ""
    )
    dek = _first_sentence(dek)
    slug = build_story_slug(title, photo_id=photo_id)

    hero_image = f"/images/{image_filename}" if image_filename else None
    photo_url = f"{site_url}/photo/{photo_id}" if photo_id else None
    story_url = f"{site_url}/stories/{slug}"
    cta = static_story.get("cta_fr") or reel_story.get("cta_fr") or "Explorez plus sur mtlarchives.com"

    sections = [
        {
            "id": "what-you-see",
            "title": "Ce que l'image montre",
            "body": (
                static_story.get("visual_fr")
                or reel_story.get("hook_fr")
                or research.get("most_striking_fr")
                or ""
            ).strip(),
        },
        {
            "id": "why-it-matters",
            "title": "Pourquoi ça compte",
            "body": (
                static_story.get("teach_fr")
                or reel_story.get("context_fr")
                or research.get("reason_fr")
                or ""
            ).strip(),
        },
        {
            "id": "what-changed",
            "title": "Ce qui a changé",
            "body": (
                static_story.get("change_fr")
                or reel_story.get("detail_fr")
                or research.get("legacy_fr")
                or ""
            ).strip(),
        },
        {
            "id": "still-open",
            "title": "Ce qu'on cherche encore",
            "body": (
                static_story.get("reflection_fr")
                or reel_story.get("end_hook_fr")
                or ""
            ).strip(),
        },
    ]
    sections = [section for section in sections if section["body"]]

    related_queries = [
        query
        for query in {
            str(photo.get("name") or "").strip(),
            str(photo.get("cote") or "").strip(),
            title.strip(),
            _first_clause(title),
        }
        if query
    ]

    seed = {
        "slug": slug,
        "story_url": story_url,
        "theme_key": theme_key,
        "theme_label": theme_label,
        "date": run_date.isoformat(),
        "status": "draft",
        "promotable": bool(research.get("story_quality", {}).get("pass")),
        "title": title,
        "dek": dek,
        "metadata_filename": metadata_filename or None,
        "image_filename": image_filename or None,
        "photo_id": photo_id or None,
        "photo_url": photo_url,
        "hero_image": hero_image,
        "selected_photo": {
            "name": photo.get("name"),
            "description": photo.get("description"),
            "cote": photo.get("cote"),
            "date_value": photo.get("date_value") or photo.get("dateValue"),
        },
        "cta": cta,
        "sections": sections,
        "related_queries": related_queries,
        "source_package_dir": str(Path(package_dir).expanduser().resolve()),
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    return seed


def build_story_slug(title: str, *, photo_id: str | None = None) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", title.lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    if photo_id:
        return f"{normalized or 'archive-story'}-{photo_id}"
    return normalized or "archive-story"


def promote_story_seed(seed_path: str | Path, *, content_root: str | Path) -> Path:
    seed_file = Path(seed_path).expanduser().resolve()
    seed = json.loads(seed_file.read_text(encoding="utf-8"))
    content_dir = Path(content_root).expanduser().resolve()
    content_dir.mkdir(parents=True, exist_ok=True)
    destination = content_dir / f"{seed['slug']}.json"
    destination.write_text(json.dumps(seed, indent=2, ensure_ascii=False), encoding="utf-8")
    return destination


def _photo_id(value: str) -> str:
    stem = Path(value).stem
    digits = "".join(char for char in stem if char.isdigit())
    return digits


def _first_sentence(text: str) -> str:
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return ""
    for delimiter in (". ", "! ", "? "):
        if delimiter in cleaned:
            return cleaned.split(delimiter, 1)[0].strip() + delimiter.strip()
    return cleaned


def _first_clause(text: str) -> str:
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return ""
    for delimiter in (":", "—", "-", ","):
        if delimiter in cleaned:
            return cleaned.split(delimiter, 1)[0].strip()
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote a daily package story seed into app content.")
    parser.add_argument("--package-dir", required=True, help="Package directory containing story_seed.json")
    parser.add_argument(
        "--content-root",
        default=str(Path(__file__).resolve().parents[2] / "apps" / "next-app" / "content" / "stories"),
        help="Destination content directory for promoted story JSON",
    )
    args = parser.parse_args()

    package_dir = Path(args.package_dir).expanduser().resolve()
    seed_path = package_dir / "story_seed.json"
    if not seed_path.exists():
        raise SystemExit(f"Missing story seed: {seed_path}")

    destination = promote_story_seed(seed_path, content_root=args.content_root)
    print(json.dumps({"story_seed": str(seed_path), "promoted_to": str(destination)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
