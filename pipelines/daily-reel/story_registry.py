from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


DELIVERED_STATUSES = {"prepared", "published"}


def asset_sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).expanduser().open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_story_asset_id(*, story_date: str, story_path: str | Path, asset_hash: str | None = None) -> str:
    digest = asset_hash or asset_sha256(story_path)
    return f"{story_date}::{digest[:16]}"


def read_story_entries(path: str | Path) -> list[dict[str, Any]]:
    registry_path = Path(path).expanduser()
    if not registry_path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for raw_line in registry_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            entries.append(payload)
    return entries


def append_story_entry(path: str | Path, entry: dict[str, Any]) -> None:
    registry_path = Path(path).expanduser()
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    with registry_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def existing_story_delivery(
    *,
    registry_path: str | Path,
    story_date: str,
    platform: str,
) -> dict[str, Any] | None:
    matches = [
        entry
        for entry in read_story_entries(registry_path)
        if str(entry.get("date") or "") == story_date
        and str(entry.get("platform") or "") == platform
        and str(entry.get("status") or "") in DELIVERED_STATUSES
    ]
    return matches[-1] if matches else None


def register_story_delivery(
    *,
    registry_path: str | Path,
    story_date: str,
    platform: str,
    status: str,
    story_path: str | Path,
    result: dict[str, Any],
) -> dict[str, Any]:
    story_asset_hash = asset_sha256(story_path)
    entry = {
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "date": story_date,
        "story_asset_id": build_story_asset_id(
            story_date=story_date,
            story_path=story_path,
            asset_hash=story_asset_hash,
        ),
        "story_asset_sha256": story_asset_hash,
        "story_path": str(Path(story_path).expanduser().resolve()),
        "platform": platform,
        "status": status,
        "created_at": result.get("created_at"),
        "prepared_at": result.get("created_at") if status == "prepared" else None,
        "published_at": result.get("published_at") if status == "published" else None,
        "public_media_url": result.get("public_media_url"),
        "r2_object_key": result.get("r2_object_key"),
        "creation_id": result.get("creation_id"),
        "published_media_id": result.get("published_media_id"),
        "video_id": result.get("video_id"),
        "post_id": result.get("post_id"),
        "permalink": result.get("permalink"),
    }
    append_story_entry(registry_path, entry)
    return entry
