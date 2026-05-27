#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from token_manager import DEFAULT_STATE_PATH, _load_state
from story_publish import (
    StoryPublishError,
    _default_r2_key,
    _graph_get,
    _graph_post,
    _post_binary_url,
    _upload_file_to_r2,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from ledger import build_package_id, read_entries
from publish_registry import DEFAULT_PUBLISH_REGISTRY_PATH, register_publish


DEFAULT_LOG_PATH = Path(
    os.environ.get("MTL_POST_PUBLISH_LOG", str(REPO_ROOT / "data" / "social" / "post-publish-log.jsonl"))
).expanduser()


class PostPublishError(RuntimeError):
    pass


def _iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fail(message: str) -> None:
    raise SystemExit(message)


def _append_log(log_path: Path, entry: dict[str, Any]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _load_context(state_path: Path) -> dict[str, Any]:
    state = _load_state(state_path)
    permissions = {
        str(item.get("permission") or "").strip()
        for item in (state.get("permissions") or [])
        if str(item.get("status") or "").strip().lower() == "granted"
    }
    context = {
        "user_token": str(((state.get("user_token") or {}).get("access_token")) or "").strip(),
        "page_token": str(((state.get("page") or {}).get("access_token")) or "").strip(),
        "page_id": str(((state.get("page") or {}).get("id")) or "").strip(),
        "page_name": str(((state.get("page") or {}).get("name")) or "").strip(),
        "ig_id": str(((state.get("instagram") or {}).get("id")) or "").strip(),
        "ig_username": str(((state.get("instagram") or {}).get("username")) or "").strip(),
        "permissions": permissions,
    }
    if not context["user_token"] or not context["page_token"] or not context["page_id"]:
        _fail(f"Meta token state is incomplete in {state_path}")
    return context


def _read_text(path: Path) -> str:
    if not path.exists():
        _fail(f"Missing required file: {path}")
    return path.read_text(encoding="utf-8").strip()


def _load_package(package_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest_path = package_dir / "package.json"
    inspection_path = package_dir / "inspection_summary.json"
    if not manifest_path.exists():
        _fail(f"Missing package.json in {package_dir}")
    if not inspection_path.exists():
        _fail(f"Missing inspection_summary.json in {package_dir}")
    return (
        json.loads(manifest_path.read_text(encoding="utf-8")),
        json.loads(inspection_path.read_text(encoding="utf-8")),
    )


def _require_publishable_package(package_dir: Path, manifest: dict[str, Any], inspection: dict[str, Any]) -> None:
    manifest_brand_ready = manifest.get("brand_ready")
    manifest_exact_safe = manifest.get("exact_location_public_safe")
    brand_ready = bool(
        inspection.get("brand_ready", False) if manifest_brand_ready is None else manifest_brand_ready
    )
    exact_safe = bool(
        inspection.get("exact_location_public_safe", True) if manifest_exact_safe is None else manifest_exact_safe
    )
    if not brand_ready:
        _fail(f"Package is not brand_ready: {package_dir}")
    if not exact_safe:
        _fail(f"Package exact location is not public safe: {package_dir}")


def _platform_already_published(
    *,
    registry_path: Path,
    package_id: str,
    platform: str,
) -> dict[str, Any] | None:
    entries = [
        entry
        for entry in read_entries(registry_path)
        if str(entry.get("package_id") or "") == package_id
        and str(entry.get("platform") or "") == platform
        and str(entry.get("status") or "") == "published"
    ]
    return entries[-1] if entries else None


def _upload_public_asset(*, local_path: Path, platform: str, object_key: str | None) -> tuple[str, str | None]:
    if not local_path.exists():
        _fail(f"Missing asset: {local_path}")
    resolved_key = object_key or _default_r2_key(local_path=local_path, prefix=f"social-posts/{platform}")
    return _upload_file_to_r2(local_path=local_path, object_key=resolved_key), resolved_key


def publish_instagram_carousel(
    *,
    package_dir: Path,
    state_path: Path,
    registry_path: Path,
    log_path: Path,
    prepare_only: bool,
    check_only: bool,
    force: bool,
) -> dict[str, Any]:
    manifest, inspection = _load_package(package_dir)
    _require_publishable_package(package_dir, manifest, inspection)
    package_id = build_package_id(manifest, package_dir=package_dir)
    existing = _platform_already_published(registry_path=registry_path, package_id=package_id, platform="instagram")
    if existing and not force:
        return {"mode": "skip", "platform": "instagram", "reason": "already_published", "entry": existing}

    context = _load_context(state_path)
    if "instagram_content_publish" not in context["permissions"]:
        _fail("The stored Meta token is missing instagram_content_publish")
    if not context["ig_id"]:
        _fail("No Instagram business account is linked in the stored Meta token state")

    caption = _read_text(package_dir / "caption_instagram.txt")
    slides = sorted((package_dir / "instagram_carousel").glob("slide*.jpg"))
    if not slides:
        _fail(f"No Instagram carousel slides found in {package_dir / 'instagram_carousel'}")
    if check_only:
        return {
            "mode": "check",
            "platform": "instagram",
            "package_id": package_id,
            "package_dir": str(package_dir),
            "slide_count": len(slides),
            "caption_chars": len(caption),
            "publish_supported": True,
        }

    children: list[str] = []
    uploaded: list[dict[str, str]] = []
    for slide in slides:
        image_url, object_key = _upload_public_asset(local_path=slide, platform="instagram", object_key=None)
        uploaded.append({"path": str(slide), "url": image_url, "object_key": object_key or ""})
        child = _graph_post(
            f"{context['ig_id']}/media",
            data={
                "access_token": context["user_token"],
                "image_url": image_url,
                "is_carousel_item": "true",
            },
        )
        child_id = str(child.get("id") or "").strip()
        if not child_id:
            raise PostPublishError(f"Instagram carousel child container did not return an id: {child}")
        children.append(child_id)

    parent = _graph_post(
        f"{context['ig_id']}/media",
        data={
            "access_token": context["user_token"],
            "media_type": "CAROUSEL",
            "children": ",".join(children),
            "caption": caption,
        },
    )
    creation_id = str(parent.get("id") or "").strip()
    if not creation_id:
        raise PostPublishError(f"Instagram carousel parent container did not return an id: {parent}")

    result: dict[str, Any] = {
        "mode": "publish",
        "platform": "instagram",
        "prepare_only": prepare_only,
        "package_id": package_id,
        "package_dir": str(package_dir),
        "uploaded_assets": uploaded,
        "child_container_ids": children,
        "creation_id": creation_id,
        "created_at": _iso_now(),
    }

    if not prepare_only:
        publish = _graph_post(
            f"{context['ig_id']}/media_publish",
            data={
                "access_token": context["user_token"],
                "creation_id": creation_id,
            },
        )
        media_id = str(publish.get("id") or "").strip()
        result["post_id"] = media_id
        if media_id:
            media = _graph_get(
                media_id,
                params={
                    "access_token": context["user_token"],
                    "fields": "id,media_type,permalink,timestamp",
                },
            )
            result["permalink"] = media.get("permalink")
            result["timestamp"] = media.get("timestamp")
            result["media_type"] = media.get("media_type")
        result["published_at"] = _iso_now()
        register_publish(
            package_dir=package_dir,
            platform="instagram",
            permalink=result.get("permalink"),
            post_id=result.get("post_id"),
            status="published",
            published_at=result["published_at"],
            registry_path=registry_path,
            obsidian_dir=None,
            format_override="carousel",
        )

    _append_log(log_path, {"recorded_at": _iso_now(), **result})
    return result


def publish_facebook_reel(
    *,
    package_dir: Path,
    state_path: Path,
    registry_path: Path,
    log_path: Path,
    prepare_only: bool,
    check_only: bool,
    force: bool,
) -> dict[str, Any]:
    manifest, inspection = _load_package(package_dir)
    _require_publishable_package(package_dir, manifest, inspection)
    package_id = build_package_id(manifest, package_dir=package_dir)
    existing = _platform_already_published(registry_path=registry_path, package_id=package_id, platform="facebook")
    if existing and not force:
        return {"mode": "skip", "platform": "facebook", "reason": "already_published", "entry": existing}

    context = _load_context(state_path)
    if "pages_manage_posts" not in context["permissions"]:
        _fail("The stored Meta token is missing pages_manage_posts")

    caption = _read_text(package_dir / "caption_facebook.txt")
    reel_path = package_dir / "facebook_reel.mp4"
    if not reel_path.exists():
        _fail(f"Missing asset: {reel_path}")
    if check_only:
        return {
            "mode": "check",
            "platform": "facebook",
            "package_id": package_id,
            "package_dir": str(package_dir),
            "asset": str(reel_path),
            "caption_chars": len(caption),
            "publish_supported": True,
        }
    video_url, object_key = _upload_public_asset(local_path=reel_path, platform="facebook", object_key=None)

    start = _graph_post(
        f"{context['page_id']}/video_reels",
        data={
            "access_token": context["page_token"],
            "upload_phase": "start",
        },
    )
    video_id = str(start.get("video_id") or "").strip()
    upload_url = str(start.get("upload_url") or "").strip()
    if not video_id or not upload_url:
        raise PostPublishError(f"Facebook Reel upload start did not return video_id/upload_url: {start}")

    upload = _post_binary_url(
        upload_url,
        local_path=reel_path,
        headers={
            "Authorization": f"OAuth {context['page_token']}",
            "offset": "0",
            "file_size": str(reel_path.stat().st_size),
            "Content-Type": "application/octet-stream",
        },
    )

    result: dict[str, Any] = {
        "mode": "publish",
        "platform": "facebook",
        "prepare_only": prepare_only,
        "package_id": package_id,
        "package_dir": str(package_dir),
        "public_media_url": video_url,
        "r2_object_key": object_key,
        "video_id": video_id,
        "upload_result": upload,
        "created_at": _iso_now(),
    }

    if not prepare_only:
        finish = _graph_post(
            f"{context['page_id']}/video_reels",
            data={
                "access_token": context["page_token"],
                "upload_phase": "finish",
                "video_id": video_id,
                "video_state": "PUBLISHED",
                "description": caption,
            },
        )
        result["finish_result"] = finish
        result["post_id"] = finish.get("post_id") or finish.get("id") or video_id
        result["published_at"] = _iso_now()
        register_publish(
            package_dir=package_dir,
            platform="facebook",
            permalink=None,
            post_id=str(result.get("post_id") or ""),
            status="published",
            published_at=result["published_at"],
            registry_path=registry_path,
            obsidian_dir=None,
            format_override="reel",
        )

    _append_log(log_path, {"recorded_at": _iso_now(), **result})
    return result


def _build_summary(results: list[dict[str, Any]]) -> str:
    lines = ["Post publish run complete."]
    for result in results:
        platform = result.get("platform")
        mode = result.get("mode")
        if mode == "skip":
            lines.append(f"- {platform}: skipped ({result.get('reason')})")
            continue
        if mode == "check":
            lines.append(f"- {platform}: ready")
            continue
        action = "prepared" if result.get("prepare_only") else "published"
        lines.append(f"- {platform}: {action}")
        if result.get("post_id"):
            lines.append(f"  post_id: {result.get('post_id')}")
        if result.get("permalink"):
            lines.append(f"  permalink: {result.get('permalink')}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish MTL Archives daily IG carousel and Facebook reel posts.")
    parser.add_argument("--package-dir", required=True, help="Generated daily package directory")
    parser.add_argument("--platform", choices=["instagram", "facebook"], help="Single platform to publish")
    parser.add_argument("--all", action="store_true", help="Publish both Instagram and Facebook")
    parser.add_argument("--prepare-only", action="store_true", help="Upload/create containers but do not publish live")
    parser.add_argument("--check-only", action="store_true", help="Validate package/auth readiness without uploading or creating containers")
    parser.add_argument("--force", action="store_true", help="Ignore existing published registry entries")
    parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH), help="Meta token state path")
    parser.add_argument("--registry-path", default=str(DEFAULT_PUBLISH_REGISTRY_PATH), help="Publish registry path")
    parser.add_argument("--log-path", default=str(DEFAULT_LOG_PATH), help="Post publish log path")
    parser.add_argument("--json", action="store_true", help="Print raw JSON")
    args = parser.parse_args()

    if not args.all and not args.platform:
        _fail("Pass --all or --platform")

    package_dir = Path(args.package_dir).expanduser().resolve()
    state_path = Path(args.state_path).expanduser()
    registry_path = Path(args.registry_path).expanduser()
    log_path = Path(args.log_path).expanduser()
    platforms = ["instagram", "facebook"] if args.all else [args.platform]

    results: list[dict[str, Any]] = []
    for platform in platforms:
        if platform == "instagram":
            results.append(
                publish_instagram_carousel(
                    package_dir=package_dir,
                    state_path=state_path,
                    registry_path=registry_path,
                    log_path=log_path,
                    prepare_only=bool(args.prepare_only),
                    check_only=bool(args.check_only),
                    force=bool(args.force),
                )
            )
        elif platform == "facebook":
            results.append(
                publish_facebook_reel(
                    package_dir=package_dir,
                    state_path=state_path,
                    registry_path=registry_path,
                    log_path=log_path,
                    prepare_only=bool(args.prepare_only),
                    check_only=bool(args.check_only),
                    force=bool(args.force),
                )
            )

    if args.json:
        print(json.dumps({"results": results}, indent=2, ensure_ascii=False))
    else:
        print(_build_summary(results))


if __name__ == "__main__":
    try:
        main()
    except (PostPublishError, StoryPublishError) as exc:
        _fail(str(exc))
