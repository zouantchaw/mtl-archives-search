from __future__ import annotations

import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

from ledger import build_package_id


def export_package_note(
    *,
    export_root: str | Path,
    manifest: dict,
    inspection: dict,
    story_seed: dict,
    output_dir: str | Path,
    ig_caption: str,
    fb_caption: str,
    stage: str = "experiments",
    publish_entries: list[dict] | None = None,
) -> dict:
    export_base = Path(export_root).expanduser().resolve()
    date_value = str(manifest.get("date") or story_seed.get("date") or "undated")
    slug = str(story_seed.get("slug") or manifest.get("theme_key") or "social-package").strip() or "social-package"
    package_dir = export_base / _stage_folder(stage) / date_value / slug
    package_dir.mkdir(parents=True, exist_ok=True)

    note_path = package_dir / "package.md"
    copied = _copy_artifacts(
        source_dir=Path(output_dir).expanduser().resolve(),
        destination_dir=package_dir,
        filenames=[
            "inspection_summary.json",
            "inspection_report.txt",
            "story_seed.json",
            "package.json",
            "research.json",
            "caption_instagram.txt",
            "caption_facebook.txt",
            "publish_state.json",
        ],
    )
    note_path.write_text(
        _build_note_content(
            manifest=manifest,
            inspection=inspection,
            story_seed=story_seed,
            output_dir=Path(output_dir).expanduser().resolve(),
            ig_caption=ig_caption,
            fb_caption=fb_caption,
            copied=copied,
            stage=stage,
            publish_entries=publish_entries or [],
        ),
        encoding="utf-8",
    )
    return {
        "note_path": str(note_path),
        "export_dir": str(package_dir),
        "copied_files": copied,
    }


def promote_package_note(
    *,
    export_root: str | Path,
    manifest: dict,
    inspection: dict,
    story_seed: dict,
    output_dir: str | Path,
    ig_caption: str,
    fb_caption: str,
    publish_entries: list[dict],
) -> dict:
    return export_package_note(
        export_root=export_root,
        manifest=manifest,
        inspection=inspection,
        story_seed=story_seed,
        output_dir=output_dir,
        ig_caption=ig_caption,
        fb_caption=fb_caption,
        stage="final",
        publish_entries=publish_entries,
    )


def _copy_artifacts(*, source_dir: Path, destination_dir: Path, filenames: list[str]) -> list[str]:
    copied: list[str] = []
    for filename in filenames:
        source = source_dir / filename
        if not source.exists():
            continue
        destination = destination_dir / filename
        shutil.copy2(source, destination)
        copied.append(str(destination))
    return copied


def _build_note_content(
    *,
    manifest: dict,
    inspection: dict,
    story_seed: dict,
    output_dir: Path,
    ig_caption: str,
    fb_caption: str,
    copied: list[str],
    stage: str,
    publish_entries: list[dict],
) -> str:
    selected = manifest.get("selected_photo") or {}
    reel = inspection.get("reel") or {}
    instagram = inspection.get("instagram") or {}
    grounding = inspection.get("grounding") or {}
    verification = inspection.get("verification") or {}
    title = (
        story_seed.get("title")
        or reel.get("title")
        or selected.get("name")
        or "MTL Archives Social Package"
    )
    theme_label = manifest.get("theme") or inspection.get("theme") or "Unknown"
    theme_key = manifest.get("theme_key") or story_seed.get("theme_key") or ""
    package_id = manifest.get("package_id") or build_package_id(manifest, package_dir=output_dir)
    selection_status = inspection.get("selection_status") or manifest.get("selection_status") or "unknown"
    tags = [
        "#mtlarchives",
        "#social-pipeline",
        f"#theme-{_slug(theme_key or theme_label)}",
        "#brand-ready" if inspection.get("brand_ready") else "#review-required",
        f"#stage-{_slug(stage)}",
    ]
    if publish_entries:
        tags.append("#published")
    copied_block = "\n".join(f"- `{Path(path).name}`" for path in copied) if copied else "- None"
    grounding_block = ""
    if grounding.get("used"):
        queries = grounding.get("queries") or []
        grounding_block = (
            "\n## Grounding\n"
            f"- Mode: `{grounding.get('mode') or 'unknown'}`\n"
            f"- Usefulness: `{grounding.get('search_usefulness') or 'unknown'}`\n"
            f"- Source count: `{grounding.get('source_count', 0)}`\n"
            f"- Queries: {', '.join(f'`{query}`' for query in queries) if queries else 'None'}\n"
        )

    publish_block = ""
    if publish_entries:
        lines = []
        for entry in publish_entries:
            platform = entry.get("platform") or "unknown"
            lines.append(f"- {platform.title()}: `{entry.get('status') or 'unknown'}`")
            if entry.get("permalink"):
                lines.append(f"  - Permalink: {entry['permalink']}")
            if entry.get("published_at"):
                lines.append(f"  - Published at: `{entry['published_at']}`")
            if entry.get("post_id"):
                lines.append(f"  - Post ID: `{entry['post_id']}`")
        publish_block = "## Publish State\n" + "\n".join(lines) + "\n\n"

    return (
        f"---\n"
        f"type: mtl-social-package\n"
        f"stage: {stage}\n"
        f"date: {manifest.get('date') or story_seed.get('date')}\n"
        f"theme: {theme_label}\n"
        f"theme_key: {theme_key}\n"
        f"package_id: {package_id}\n"
        f"brand_ready: {str(bool(inspection.get('brand_ready'))).lower()}\n"
        f"selection_status: {selection_status}\n"
        f"metadata_filename: {selected.get('metadata_filename') or selected.get('metadataFilename') or ''}\n"
        f"image_filename: {selected.get('filename') or selected.get('imageFilename') or ''}\n"
        f"story_slug: {story_seed.get('slug') or ''}\n"
        f"generated_at: {datetime.now(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')}\n"
        f"---\n\n"
        f"[[MTL Archives]]\n\n"
        f"# {title}\n\n"
        f"{' '.join(tags)}\n\n"
        f"## Package\n"
        f"- Theme: `{theme_label}`\n"
        f"- Brand ready: `{'yes' if inspection.get('brand_ready') else 'no'}`\n"
        f"- Selection status: `{selection_status}`\n"
        f"- Reroll attempts: `{inspection.get('reroll_attempts', manifest.get('reroll_attempts', 0))}`\n"
        f"- Output dir: `{output_dir}`\n"
        f"- Photo: {selected.get('name') or 'Unknown'}\n"
        f"- Cote: `{selected.get('cote') or 'Unknown'}`\n\n"
        f"## Reel\n"
        f"- Hook: {reel.get('hook') or 'Unknown'}\n"
        f"- Title: {reel.get('title') or 'Unknown'}\n"
        f"- Badge: `{reel.get('badge') or ''}`\n"
        f"- Score: `{reel.get('score') if reel.get('score') is not None else 'Unknown'}`\n"
        f"- Caption OK: `{'yes' if reel.get('caption_ok') else 'no'}`\n\n"
        f"## Instagram\n"
        f"- Score: `{instagram.get('score') if instagram.get('score') is not None else 'Unknown'}`\n"
        f"- Caption OK: `{'yes' if instagram.get('caption_ok') else 'no'}`\n"
        f"- Slides: `{len(instagram.get('slides') or [])}`\n\n"
        f"## Evidence\n"
        f"- Verified: `{verification.get('verified_count', 0)}`\n"
        f"- Probable: `{verification.get('probable_count', 0)}`\n"
        f"- Open questions: `{verification.get('open_question_count', 0)}`\n"
        f"{grounding_block}\n"
        f"## IG Caption\n\n"
        f"{ig_caption.strip()}\n\n"
        f"## FB Caption\n\n"
        f"{fb_caption.strip()}\n\n"
        f"{publish_block}"
        f"## Story Seed\n"
        f"- Slug: `{story_seed.get('slug') or ''}`\n"
        f"- Story URL: {story_seed.get('story_url') or ''}\n"
        f"- Photo URL: {story_seed.get('photo_url') or ''}\n"
        f"- Promotable: `{'yes' if story_seed.get('promotable') else 'no'}`\n\n"
        f"## Mirrored Artifacts\n"
        f"{copied_block}\n"
    )


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower())
    return re.sub(r"-{2,}", "-", cleaned).strip("-") or "unknown"


def _stage_folder(stage: str) -> str:
    normalized = _slug(stage)
    if normalized == "final":
        return "final"
    return "experiments"
