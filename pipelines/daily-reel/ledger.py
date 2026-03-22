from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path


LEDGER_STATUSES = {"generated", "published", "published_inferred"}


@dataclass(frozen=True)
class LedgerWindow:
    cooldown_days: int
    as_of: date


def build_package_id_from_fields(
    *,
    date_value: str | None,
    theme_key: str | None,
    metadata_filename: str | None,
    image_filename: str | None,
) -> str:
    parts = [
        str(date_value or "").strip() or "undated",
        str(theme_key or "").strip() or "unthemed",
        str(metadata_filename or "").strip() or "unknown-metadata",
        str(image_filename or "").strip() or "unknown-image",
    ]
    return "::".join(parts)


def build_package_id(manifest: dict | None, *, package_dir: str | Path | None = None) -> str:
    manifest = manifest or {}
    selected = manifest.get("selected_photo") or {}
    return build_package_id_from_fields(
        date_value=manifest.get("date"),
        theme_key=manifest.get("theme_key"),
        metadata_filename=selected.get("metadata_filename") or selected.get("metadataFilename"),
        image_filename=selected.get("filename") or selected.get("imageFilename"),
    )


def record_keys(record: dict | None) -> set[str]:
    if not record:
        return set()

    keys = {
        str(record.get("metadata_filename") or record.get("metadataFilename") or "").strip(),
        str(record.get("filename") or record.get("imageFilename") or "").strip(),
    }
    return {key for key in keys if key}


def read_entries(path: str | Path) -> list[dict]:
    ledger_path = Path(path).expanduser()
    if not ledger_path.exists():
        return []

    entries: list[dict] = []
    for raw_line in ledger_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            entries.append(entry)
    return entries


def blocked_keys(path: str | Path, *, cooldown_days: int, as_of: date) -> set[str]:
    if cooldown_days <= 0:
        return set()

    keys: set[str] = set()
    for entry in read_entries(path):
        if str(entry.get("status") or "").strip() not in LEDGER_STATUSES:
            continue
        entry_date = _parse_entry_date(entry)
        if entry_date is None:
            continue
        delta = (as_of - entry_date).days
        if delta < 0 or delta > cooldown_days:
            continue
        keys.update(
            {
                str(entry.get("metadata_filename") or "").strip(),
                str(entry.get("image_filename") or "").strip(),
            }
        )
    return {key for key in keys if key}


def append_entry(path: str | Path, entry: dict) -> None:
    ledger_path = Path(path).expanduser()
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    with ledger_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _parse_entry_date(entry: dict) -> date | None:
    raw = str(entry.get("date") or entry.get("recorded_at") or "").strip()
    if not raw:
        return None
    try:
        if "T" in raw:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        return date.fromisoformat(raw)
    except ValueError:
        return None
