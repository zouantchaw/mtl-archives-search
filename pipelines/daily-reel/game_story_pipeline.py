#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from env_loader import repo_state_path
from story_publish import DEFAULT_LOG_PATH, StoryPublishError, publish_facebook_story, publish_instagram_story, status_command
from story_registry import existing_story_delivery, register_story_delivery
from token_manager import DEFAULT_STATE_PATH


DEFAULT_STORY_OUTPUT_DIR = Path.home() / "Desktop" / "mtl-game-stories"
DEFAULT_STORY_REGISTRY_PATH = repo_state_path(REPO_ROOT, "data/social/story-registry.jsonl")
DEFAULT_TIMEZONE = "America/Toronto"


class GameStoryPipelineError(RuntimeError):
    pass


def _fail(message: str) -> None:
    raise SystemExit(message)


def _today(timezone_name: str) -> str:
    return datetime.now(ZoneInfo(timezone_name)).date().isoformat()


def _default_story_path(story_date: str) -> Path:
    return DEFAULT_STORY_OUTPUT_DIR / f"{story_date}-daily-game-story.mp4"


def _run(command: list[str], *, cwd: Path) -> None:
    subprocess.run(command, cwd=str(cwd), check=True)


def _probe_video(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"valid": False, "reason": "missing"}
    if path.stat().st_size <= 0:
        return {"valid": False, "reason": "zero_byte", "path": str(path)}
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,avg_frame_rate,duration:format=duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        completed = subprocess.run(command, check=True, text=True, capture_output=True)
        payload = json.loads(completed.stdout or "{}")
    except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        return {"valid": False, "reason": "ffprobe_failed", "error": str(exc), "path": str(path)}
    streams = payload.get("streams") or []
    stream = streams[0] if streams else {}
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    duration = _floatish(stream.get("duration")) or _floatish((payload.get("format") or {}).get("duration")) or 0.0
    fps = _fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
    valid = width == 1080 and height == 1920 and abs(fps - 30.0) < 0.05 and duration > 0
    return {
        "valid": valid,
        "reason": None if valid else "invalid_video_shape",
        "path": str(path),
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
    }


def _floatish(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fps(value: Any) -> float:
    raw = str(value or "0/1")
    if "/" in raw:
        numerator, denominator = raw.split("/", 1)
        den = _floatish(denominator) or 1.0
        return (_floatish(numerator) or 0.0) / den if den else 0.0
    return _floatish(raw) or 0.0


def ensure_story_asset(
    *,
    story_date: str,
    story_path: Path,
    render_missing: bool,
    force_render: bool,
) -> dict[str, Any]:
    probe = _probe_video(story_path)
    if probe.get("valid") and not force_render:
        return {"rendered": False, "probe": probe, "story_path": str(story_path)}
    if not render_missing and not force_render:
        return {"rendered": False, "probe": probe, "story_path": str(story_path)}
    story_path.parent.mkdir(parents=True, exist_ok=True)
    _run(
        ["npm", "run", "story:render", "--", "--today", "--out", str(story_path)],
        cwd=REPO_ROOT,
    )
    probe = _probe_video(story_path)
    if not probe.get("valid"):
        raise GameStoryPipelineError(f"Rendered Story video failed validation for {story_date}: {probe}")
    return {"rendered": True, "probe": probe, "story_path": str(story_path)}


def run_game_story_pipeline(
    *,
    story_date: str,
    platforms: list[str],
    story_path: Path,
    state_path: Path,
    log_path: Path,
    registry_path: Path,
    mode: str,
    force: bool,
    force_render: bool,
    object_key_prefix: str | None,
    link_url: str | None,
    timeout_seconds: int,
    poll_interval: int,
) -> dict[str, Any]:
    existing_by_platform = {
        platform: existing_story_delivery(
            registry_path=registry_path,
            story_date=story_date,
            platform=platform,
        )
        for platform in platforms
    }
    pending_platforms = [
        platform for platform in platforms if force or existing_by_platform.get(platform) is None
    ]
    render_missing = mode in {"prepare", "publish"}
    asset = ensure_story_asset(
        story_date=story_date,
        story_path=story_path,
        render_missing=render_missing,
        force_render=force_render,
    )
    probe = asset["probe"]
    if not probe.get("valid"):
        return {
            "mode": mode,
            "date": story_date,
            "story_path": str(story_path),
            "asset": asset,
            "results": [
                {
                    "mode": "blocked",
                    "platform": platform,
                    "reason": "story_asset_invalid_or_missing",
                    "existing": existing_by_platform.get(platform),
                }
                for platform in platforms
            ],
        }
    if link_url and mode in {"prepare", "publish"}:
        return {
            "mode": "manual_handoff",
            "date": story_date,
            "story_path": str(story_path),
            "asset": asset,
            "reason": "server_side_story_link_stickers_not_supported",
            "link_url": link_url,
            "results": [],
        }

    capability = status_command(state_path=state_path)
    results: list[dict[str, Any]] = []
    for platform in platforms:
        existing = existing_by_platform.get(platform)
        if existing and not force:
            results.append({"mode": "skip", "platform": platform, "reason": "already_prepared_or_published", "entry": existing})
            continue
        supported = bool((capability.get(platform) or {}).get("publish_supported"))
        if mode == "check":
            results.append(
                {
                    "mode": "check",
                    "platform": platform,
                    "publish_supported": supported,
                    "story_path": str(story_path),
                    "probe": probe,
                }
            )
            continue
        if not supported:
            results.append({"mode": "blocked", "platform": platform, "reason": "publish_not_supported"})
            continue

        object_key = None
        if object_key_prefix:
            object_key = f"{object_key_prefix.rstrip('/')}/{story_date}/{story_path.name}"
        if platform == "instagram":
            publish_result = publish_instagram_story(
                story_path=story_path,
                state_path=state_path,
                log_path=log_path,
                prepare_only=(mode == "prepare"),
                object_key=object_key,
                media_url=None,
                timeout_seconds=timeout_seconds,
                poll_interval=poll_interval,
                link_url=None,
            )
        else:
            publish_result = publish_facebook_story(
                story_path=story_path,
                state_path=state_path,
                log_path=log_path,
                prepare_only=(mode == "prepare"),
                object_key=object_key,
                media_url=None,
                link_url=None,
            )
        status = "prepared" if mode == "prepare" else "published"
        registry_entry = register_story_delivery(
            registry_path=registry_path,
            story_date=story_date,
            platform=platform,
            status=status,
            story_path=story_path,
            result=publish_result,
        )
        results.append({**publish_result, "registry_entry": registry_entry})

    return {
        "mode": mode,
        "date": story_date,
        "story_path": str(story_path),
        "asset": asset,
        "capability": capability,
        "registry_path": str(registry_path),
        "results": results,
    }


def _build_summary(result: dict[str, Any]) -> str:
    if result.get("mode") == "manual_handoff":
        return (
            "Daily game Story requires manual handoff.\n"
            f"- Reason: {result.get('reason')}\n"
            f"- Asset: {result.get('story_path')}\n"
            "- Meta server-side Story publishing cannot add link stickers."
        )
    lines = [f"Daily game Story pipeline {result.get('mode')} complete."]
    asset = result.get("asset") or {}
    probe = asset.get("probe") or {}
    lines.append(f"- Asset: {result.get('story_path')}")
    lines.append(
        f"- Video: {probe.get('width')}x{probe.get('height')} @ {probe.get('fps')}fps, {probe.get('duration')}s"
    )
    if asset.get("rendered"):
        lines.append("- Render: created or repaired")
    else:
        lines.append("- Render: reused existing valid MP4")
    for item in result.get("results") or []:
        platform = item.get("platform")
        mode = item.get("mode")
        if mode == "skip":
            lines.append(f"- {platform}: skipped ({item.get('reason')})")
        elif mode == "check":
            lines.append(f"- {platform}: check-only ready={item.get('publish_supported')}")
        elif mode == "blocked":
            lines.append(f"- {platform}: blocked ({item.get('reason')})")
        else:
            status = "prepared" if item.get("prepare_only") else "published"
            lines.append(f"- {platform}: {status}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render and safely deliver the daily MTL game Story video.")
    parser.add_argument("--date", help="Story date in YYYY-MM-DD. Defaults to today's date in --timezone.")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE, help=f"Date timezone (default: {DEFAULT_TIMEZONE})")
    parser.add_argument("--story-path", help="Override Story MP4 path")
    parser.add_argument("--platform", choices=["instagram", "facebook"], help="Single platform")
    parser.add_argument("--all", action="store_true", help="Use both Instagram and Facebook")
    parser.add_argument("--check-only", action="store_true", help="Validate asset/auth/idempotency without rendering or uploading")
    parser.add_argument("--prepare-only", action="store_true", help="Render if needed and prepare Story containers without live publishing")
    parser.add_argument("--publish", action="store_true", help="Live publish. Use only with explicit user approval.")
    parser.add_argument("--force", action="store_true", help="Ignore existing prepared/published Story registry entries")
    parser.add_argument("--force-render", action="store_true", help="Render even if today's MP4 already validates")
    parser.add_argument("--link-url", help="Requested Story link sticker URL. This forces manual handoff because Meta API does not support it.")
    parser.add_argument("--object-key-prefix", default="social-stories/game", help="R2 object key prefix for prepare/publish uploads")
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--poll-interval", type=int, default=5)
    parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH), help="Meta token state path")
    parser.add_argument("--log-path", default=str(DEFAULT_LOG_PATH), help="Story publish log path")
    parser.add_argument("--registry-path", default=str(DEFAULT_STORY_REGISTRY_PATH), help="Story registry path")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.all and not args.platform:
        _fail("Pass --all or --platform")
    selected_modes = [bool(args.check_only), bool(args.prepare_only), bool(args.publish)]
    if sum(1 for item in selected_modes if item) > 1:
        _fail("Choose only one of --check-only, --prepare-only, or --publish")
    mode = "publish" if args.publish else "prepare" if args.prepare_only else "check"
    story_date = args.date or _today(args.timezone)
    story_path = Path(args.story_path).expanduser().resolve() if args.story_path else _default_story_path(story_date)
    platforms = ["instagram", "facebook"] if args.all else [args.platform]

    result = run_game_story_pipeline(
        story_date=story_date,
        platforms=[str(platform) for platform in platforms],
        story_path=story_path,
        state_path=Path(args.state_path).expanduser(),
        log_path=Path(args.log_path).expanduser(),
        registry_path=Path(args.registry_path).expanduser(),
        mode=mode,
        force=bool(args.force),
        force_render=bool(args.force_render),
        object_key_prefix=args.object_key_prefix,
        link_url=args.link_url,
        timeout_seconds=int(args.timeout_seconds),
        poll_interval=int(args.poll_interval),
    )
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(_build_summary(result))


if __name__ == "__main__":
    try:
        main()
    except (GameStoryPipelineError, StoryPublishError) as exc:
        _fail(str(exc))
