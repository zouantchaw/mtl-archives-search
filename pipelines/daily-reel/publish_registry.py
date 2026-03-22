#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from ledger import append_entry, build_package_id, read_entries
from obsidian import promote_package_note


DEFAULT_PUBLISH_REGISTRY_PATH = Path(
    os.environ.get("MTL_PUBLISH_REGISTRY", str(REPO_ROOT / "data" / "social" / "publish-registry.jsonl"))
).expanduser()
DEFAULT_OBSIDIAN_EXPORT_DIR = os.environ.get("MTL_OBSIDIAN_EXPORT_DIR")
PLATFORMS = {"instagram", "facebook"}
STATUSES = {"published", "scheduled", "failed", "draft", "deleted"}


def register_publish(
    *,
    package_dir: str | Path,
    platform: str,
    permalink: str | None,
    post_id: str | None,
    status: str,
    published_at: str | None,
    registry_path: str | Path,
    obsidian_dir: str | Path | None,
    format_override: str | None = None,
) -> dict:
    package_root = Path(package_dir).expanduser().resolve()
    manifest, inspection, story_seed, ig_caption, fb_caption = _load_package_context(package_root)
    package_id = build_package_id(manifest, package_dir=package_root)
    selected = manifest.get("selected_photo") or {}
    platform_key = _normalize_platform(platform)
    status_value = _normalize_status(status)
    publish_timestamp = _normalize_timestamp(published_at)
    output_dir = str(package_root)

    entry = {
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "package_id": package_id,
        "date": manifest.get("date"),
        "theme_key": manifest.get("theme_key"),
        "theme_label": manifest.get("theme"),
        "platform": platform_key,
        "format": format_override or _default_format(platform_key),
        "status": status_value,
        "published_at": publish_timestamp,
        "permalink": (permalink or "").strip() or None,
        "post_id": (post_id or "").strip() or None,
        "hook": _select_hook(platform_key, inspection, ig_caption, fb_caption),
        "metadata_filename": selected.get("metadata_filename") or selected.get("metadataFilename"),
        "image_filename": selected.get("filename") or selected.get("imageFilename"),
        "source_title": selected.get("name"),
        "cote": selected.get("cote"),
        "brand_ready": bool(manifest.get("brand_ready", inspection.get("brand_ready", False))),
        "selection_status": manifest.get("selection_status") or inspection.get("selection_status"),
        "package_dir": output_dir,
        "story_seed": ((manifest.get("outputs") or {}).get("story_seed")) or str(package_root / "story_seed.json"),
    }

    registry_file = Path(registry_path).expanduser()
    append_entry(registry_file, entry)

    publish_entries = _package_publish_entries(registry_file, package_id=package_id)
    publish_state = {
        "package_id": package_id,
        "date": manifest.get("date"),
        "theme": manifest.get("theme"),
        "package_dir": output_dir,
        "entries": publish_entries,
        "platforms": _latest_entries_by_platform(publish_entries),
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    publish_state_path = package_root / "publish_state.json"
    publish_state_path.write_text(
        json.dumps(publish_state, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    _sync_package_metadata(
        package_root=package_root,
        manifest=manifest,
        publish_state=publish_state,
        publish_state_path=publish_state_path,
    )

    obsidian_export = None
    if obsidian_dir:
        obsidian_export = promote_package_note(
            export_root=obsidian_dir,
            manifest=manifest,
            inspection=inspection,
            story_seed=story_seed,
            output_dir=package_root,
            ig_caption=ig_caption,
            fb_caption=fb_caption,
            publish_entries=publish_entries,
        )

    result = {
        "registry_path": str(registry_file),
        "package_id": package_id,
        "package_dir": output_dir,
        "publish_state": str(publish_state_path),
        "entry": entry,
        "platforms": publish_state["platforms"],
    }
    if obsidian_export:
        result["obsidian"] = obsidian_export
    return result


def _sync_package_metadata(*, package_root: Path, manifest: dict, publish_state: dict, publish_state_path: Path) -> None:
    latest_platforms = publish_state.get("platforms") or {}
    manifest["package_id"] = publish_state.get("package_id") or manifest.get("package_id")
    manifest["outputs"] = manifest.get("outputs") or {}
    manifest["outputs"]["publish_state"] = str(publish_state_path)
    manifest["published_platforms"] = sorted(latest_platforms.keys())
    manifest["publish_status"] = {
        platform: {
            "status": entry.get("status"),
            "permalink": entry.get("permalink"),
            "post_id": entry.get("post_id"),
            "published_at": entry.get("published_at"),
        }
        for platform, entry in latest_platforms.items()
    }
    (package_root / "package.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    summary_path = package_root / "summary.json"
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            summary = {}
        if isinstance(summary, dict):
            summary["published_platforms"] = sorted(latest_platforms.keys())
            summary["publish_status"] = manifest["publish_status"]
            summary["publish_state"] = str(publish_state_path)
            summary_path.write_text(
                json.dumps(summary, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )


def _load_package_context(package_dir: Path) -> tuple[dict, dict, dict, str, str]:
    package_path = package_dir / "package.json"
    if not package_path.exists():
        raise FileNotFoundError(f"Missing package.json in {package_dir}")

    manifest = json.loads(package_path.read_text(encoding="utf-8"))
    inspection_path = package_dir / "inspection_summary.json"
    story_seed_path = package_dir / "story_seed.json"
    inspection = json.loads(inspection_path.read_text(encoding="utf-8")) if inspection_path.exists() else {}
    story_seed = json.loads(story_seed_path.read_text(encoding="utf-8")) if story_seed_path.exists() else {}
    ig_caption = (package_dir / "caption_instagram.txt").read_text(encoding="utf-8") if (package_dir / "caption_instagram.txt").exists() else ""
    fb_caption = (package_dir / "caption_facebook.txt").read_text(encoding="utf-8") if (package_dir / "caption_facebook.txt").exists() else ""
    return manifest, inspection, story_seed, ig_caption, fb_caption


def _package_publish_entries(registry_path: Path, *, package_id: str) -> list[dict]:
    entries = [
        entry
        for entry in read_entries(registry_path)
        if str(entry.get("package_id") or "").strip() == package_id
    ]
    return sorted(entries, key=lambda entry: str(entry.get("recorded_at") or ""))


def _latest_entries_by_platform(entries: list[dict]) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for entry in entries:
        platform = str(entry.get("platform") or "").strip()
        if not platform:
            continue
        latest[platform] = entry
    return latest


def _normalize_platform(platform: str) -> str:
    value = str(platform or "").strip().lower()
    if value not in PLATFORMS:
        raise SystemExit(f"Unsupported platform: {platform}")
    return value


def _normalize_status(status: str) -> str:
    value = str(status or "").strip().lower()
    if value not in STATUSES:
        raise SystemExit(f"Unsupported status: {status}")
    return value


def _normalize_timestamp(raw: str | None) -> str:
    if not raw:
        return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    value = str(raw).strip()
    try:
        if value.endswith("Z"):
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return value
        datetime.fromisoformat(value)
        return value
    except ValueError as exc:
        raise SystemExit(f"Invalid timestamp: {raw}") from exc


def _default_format(platform: str) -> str:
    return "carousel" if platform == "instagram" else "reel"


def _select_hook(platform: str, inspection: dict, ig_caption: str, fb_caption: str) -> str:
    if platform == "facebook":
        return str(((inspection.get("reel") or {}).get("hook")) or _first_nonempty_paragraph(fb_caption))
    return _first_nonempty_paragraph(ig_caption)


def _first_nonempty_paragraph(text: str) -> str:
    for block in str(text or "").split("\n\n"):
        line = block.strip()
        if line:
            return line
    return ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Register published MTL Archives posts and mirror them to final Obsidian notes.")
    parser.add_argument("--package-dir", required=True, help="Canonical generated package directory")
    parser.add_argument("--platform", required=True, choices=sorted(PLATFORMS), help="Platform being registered")
    parser.add_argument("--permalink", help="Published permalink URL")
    parser.add_argument("--post-id", help="Platform-specific post/media ID")
    parser.add_argument("--status", default="published", choices=sorted(STATUSES), help="Publish status to register")
    parser.add_argument("--published-at", help="Publish timestamp (ISO-8601). Defaults to now (UTC)")
    parser.add_argument("--format", dest="format_override", help="Override inferred format (default: carousel/reel)")
    parser.add_argument(
        "--registry-path",
        default=str(DEFAULT_PUBLISH_REGISTRY_PATH),
        help=f"Publish registry path (default: {DEFAULT_PUBLISH_REGISTRY_PATH})",
    )
    parser.add_argument(
        "--obsidian-dir",
        help="Optional Obsidian Daily Social Packages root to mirror the package into final/",
    )
    args = parser.parse_args()

    result = register_publish(
        package_dir=args.package_dir,
        platform=args.platform,
        permalink=args.permalink,
        post_id=args.post_id,
        status=args.status,
        published_at=args.published_at,
        registry_path=args.registry_path,
        obsidian_dir=args.obsidian_dir or DEFAULT_OBSIDIAN_EXPORT_DIR,
        format_override=args.format_override,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
