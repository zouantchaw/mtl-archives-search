from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse, urlunparse

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional at import time for metadata-only tests
    Image = None


USAGE_STATUSES = {"generated", "published", "published_inferred", "prepared", "scheduled"}
GENERIC_TITLE_WORDS = {
    "a",
    "an",
    "and",
    "au",
    "aux",
    "de",
    "des",
    "du",
    "en",
    "et",
    "from",
    "la",
    "le",
    "les",
    "l",
    "of",
    "sur",
    "the",
    "to",
    "vers",
    "view",
    "vue",
    "aerial",
    "aerienne",
    "oblique",
}


@dataclass(frozen=True)
class SocialImageIdentity:
    metadata_filename: str | None
    image_filename: str | None
    cote: str | None
    external_url: str | None
    title_key: str | None
    subject_family_key: str | None
    series_keys: tuple[str, ...]
    perceptual_hash: str | None = None

    @property
    def exact_keys(self) -> set[str]:
        keys = {
            _scoped("metadata", self.metadata_filename),
            _scoped("image", self.image_filename),
            _scoped("cote", self.cote),
            _scoped("url", self.external_url),
            _scoped("phash", self.perceptual_hash),
        }
        return {key for key in keys if key}

    @property
    def family_keys(self) -> set[str]:
        keys = {_scoped("subject", self.subject_family_key)}
        keys.update(_scoped("series", key) for key in self.series_keys)
        return {key for key in keys if key}

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["series_keys"] = list(self.series_keys)
        payload["exact_keys"] = sorted(self.exact_keys)
        payload["family_keys"] = sorted(self.family_keys)
        return payload


@dataclass(frozen=True)
class ReusePolicyConfig:
    exact_cooldown_days: int = 90
    family_cooldown_days: int = 90
    family_min_gap_days: int = 30
    max_lifetime_exact_reuse: int = 2
    max_lifetime_family_reuse: int = 3
    perceptual_hamming_threshold: int = 4


def identity_from_record(record: dict[str, Any] | None, *, image_path: str | Path | None = None) -> SocialImageIdentity:
    record = record or {}
    title = _first_text(
        record.get("name"),
        record.get("title"),
        record.get("source_title"),
        record.get("portal_title"),
    )
    metadata_filename = _filename_key(
        _first_text(record.get("metadata_filename"), record.get("metadataFilename"), record.get("id"))
    )
    image_filename = _filename_key(
        _first_text(
            record.get("filename"),
            record.get("imageFilename"),
            record.get("image_filename"),
            record.get("resolved_image_filename"),
            record.get("resolvedImageFilename"),
        )
    )
    cote = _normalize_cote(_first_text(record.get("cote"), record.get("portal_cote")))
    external_url = _normalize_url(_first_text(record.get("external_url"), record.get("externalUrl")))
    title_key = normalize_text(title)
    subject_family_key = _subject_family_key(title_key)
    series_keys = tuple(sorted(_series_keys(record, title_key, subject_family_key)))
    perceptual_hash = _perceptual_hash(image_path) if image_path else None
    return SocialImageIdentity(
        metadata_filename=metadata_filename,
        image_filename=image_filename,
        cote=cote,
        external_url=external_url,
        title_key=title_key or None,
        subject_family_key=subject_family_key,
        series_keys=series_keys,
        perceptual_hash=perceptual_hash,
    )


def build_story_angle_key(
    *,
    record: dict[str, Any] | None = None,
    research: dict[str, Any] | None = None,
    manifest: dict[str, Any] | None = None,
    override: str | None = None,
) -> str:
    if override:
        return normalize_text(override)
    manifest = manifest or {}
    research = research or {}
    record = record or (manifest.get("selected_photo") or {})
    candidates = [
        manifest.get("story_angle_key"),
        research.get("story_angle_key"),
        research.get("hook_fr"),
        research.get("most_striking_fr"),
        research.get("what_changed_fr"),
        research.get("what_survived_fr"),
        ((research.get("public_story") or {}).get("static") or {}).get("hook_fr"),
        ((research.get("public_story") or {}).get("reel") or {}).get("hook_fr"),
        ((research.get("public_story") or {}).get("static") or {}).get("caption_fr"),
        record.get("name"),
    ]
    theme = manifest.get("theme_key") or research.get("theme_key") or manifest.get("theme")
    base = _first_text(*candidates)
    return normalize_text(" ".join(part for part in [str(theme or ""), base] if part))[:160]


def load_usage_events(
    *,
    ledger_paths: Iterable[str | Path] = (),
    registry_paths: Iterable[str | Path] = (),
    story_registry_paths: Iterable[str | Path] = (),
    package_roots: Iterable[str | Path] = (),
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for path in ledger_paths:
        events.extend(_events_from_jsonl(path, source="ledger"))
    for path in registry_paths:
        events.extend(_events_from_jsonl(path, source="publish_registry"))
    for path in story_registry_paths:
        events.extend(_events_from_jsonl(path, source="story_registry"))
    for root in package_roots:
        events.extend(_events_from_package_root(root))
    return _dedupe_events(events)


def evaluate_reuse_policy(
    *,
    record: dict[str, Any] | None,
    as_of: date,
    events: Iterable[dict[str, Any]],
    config: ReusePolicyConfig | None = None,
    image_path: str | Path | None = None,
    story_angle_key: str | None = None,
    reuse_reason: str | None = None,
    allow_intentional_reuse: bool = False,
    current_package_id: str | None = None,
    current_output_dir: str | Path | None = None,
) -> dict[str, Any]:
    config = config or ReusePolicyConfig()
    identity = identity_from_record(record, image_path=image_path)
    current_angle = normalize_text(story_angle_key)
    exact_matches: list[dict[str, Any]] = []
    family_matches: list[dict[str, Any]] = []
    perceptual_matches: list[dict[str, Any]] = []

    for event in events:
        if not _event_active(event):
            continue
        if _is_same_current_event(event, current_package_id=current_package_id, current_output_dir=current_output_dir):
            continue
        event_identity = _event_identity(event)
        event_date = _event_date(event)
        gap_days = (as_of - event_date).days if event_date else None
        exact_keys = sorted(identity.exact_keys & event_identity.exact_keys)
        family_keys = sorted(identity.family_keys & event_identity.family_keys)
        phash_distance = _phash_distance(identity.perceptual_hash, event_identity.perceptual_hash)

        if exact_keys:
            exact_matches.append(_match_payload(event, "exact", exact_keys, gap_days, phash_distance))
        if phash_distance is not None and phash_distance <= config.perceptual_hamming_threshold:
            perceptual_matches.append(_match_payload(event, "perceptual", ["phash"], gap_days, phash_distance))
        if family_keys:
            family_matches.append(_match_payload(event, "subject_family", family_keys, gap_days, phash_distance))

    blocks: list[str] = []
    recent_exact = _recent_matches(exact_matches + perceptual_matches, config.exact_cooldown_days)
    if recent_exact:
        blocks.append("recent_exact_or_near_image_reuse")

    exact_use_count = _distinct_package_count(exact_matches + perceptual_matches)
    if exact_use_count >= config.max_lifetime_exact_reuse:
        blocks.append("exact_or_near_image_lifetime_limit")

    recent_family = _recent_matches(family_matches, config.family_cooldown_days)
    too_close_family = [
        match
        for match in family_matches
        if match.get("gap_days") is not None and 0 <= int(match["gap_days"]) < config.family_min_gap_days
    ]
    if too_close_family:
        blocks.append("subject_family_minimum_gap")
    elif recent_family:
        if not _intentional_reuse_allowed(
            matches=recent_family,
            current_angle=current_angle,
            reuse_reason=reuse_reason,
            allow_intentional_reuse=allow_intentional_reuse,
            max_reuse=config.max_lifetime_family_reuse,
        ):
            blocks.append("recent_subject_family_reuse")

    family_use_count = _distinct_package_count(family_matches)
    if family_use_count >= config.max_lifetime_family_reuse:
        blocks.append("subject_family_lifetime_limit")

    allowed = not blocks
    matches = sorted(_dedupe_matches(exact_matches + perceptual_matches + family_matches), key=_match_sort_key)[:20]
    return {
        "allowed": allowed,
        "status": "allowed" if allowed else "blocked",
        "blocked_reason": blocks[0] if blocks else None,
        "all_blocked_reasons": blocks,
        "story_angle_key": current_angle or None,
        "reuse_reason": reuse_reason,
        "allow_intentional_reuse": bool(allow_intentional_reuse),
        "reuse_count": {
            "exact_or_near_image": exact_use_count,
            "subject_family": family_use_count,
        },
        "identity": identity.to_dict(),
        "matches": matches,
        "policy": asdict(config),
    }


def format_reuse_block(decision: dict[str, Any]) -> str:
    reason = decision.get("blocked_reason") or "image_reuse_policy"
    lines = [f"Image reuse policy blocked this package: {reason}."]
    seen_packages: set[str] = set()
    for match in decision.get("matches") or []:
        package_key = str(match.get("package_id") or match.get("source_title") or "")
        if package_key in seen_packages:
            continue
        seen_packages.add(package_key)
        title = match.get("source_title") or "untitled"
        date_value = match.get("date") or "unknown date"
        package_id = match.get("package_id") or "unknown package"
        gap = match.get("gap_days")
        gap_text = f", {gap} days ago" if gap is not None else ""
        lines.append(f"- {date_value}{gap_text}: {title} ({package_id})")
        if len(lines) >= 4:
            break
    return "\n".join(lines)


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("’", "'")
    text = re.sub(r"\bste[.-]?\b", "sainte", text)
    text = re.sub(r"\bst[.-]?\b", "saint", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _subject_family_key(title_key: str | None) -> str | None:
    if not title_key:
        return None
    tokens = [
        token
        for token in title_key.split()
        if token not in GENERIC_TITLE_WORDS and not re.fullmatch(r"\d{3,4}", token)
    ]
    if not tokens:
        return None
    return " ".join(tokens[:10])


def _series_keys(record: dict[str, Any], title_key: str, subject_family_key: str | None) -> set[str]:
    keys: set[str] = set()
    datasets = record.get("aerial_datasets") or record.get("aerialDatasets") or []
    if isinstance(datasets, str):
        try:
            datasets = json.loads(datasets)
        except json.JSONDecodeError:
            datasets = [datasets]
    if isinstance(datasets, list):
        for item in datasets:
            if isinstance(item, dict):
                value = _first_text(item.get("id"), item.get("name"), item.get("dataset"), item.get("series"))
            else:
                value = str(item or "")
            normalized = normalize_text(value)
            if normalized:
                keys.add(normalized)
    if subject_family_key and ("aerienne" in title_key or "aerial" in title_key):
        keys.add(f"aerial {subject_family_key}")
    return keys


def _perceptual_hash(image_path: str | Path | None) -> str | None:
    if not image_path or Image is None:
        return None
    path = Path(image_path).expanduser()
    if not path.exists() or not path.is_file():
        return None
    try:
        img = Image.open(path).convert("L").resize((9, 8))
    except Exception:
        return None
    pixels = list(img.getdata())
    bits = []
    for row in range(8):
        offset = row * 9
        for col in range(8):
            bits.append("1" if pixels[offset + col] > pixels[offset + col + 1] else "0")
    return f"{int(''.join(bits), 2):016x}"


def _phash_distance(left: str | None, right: str | None) -> int | None:
    if not left or not right:
        return None
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        return None


def _events_from_jsonl(path: str | Path, *, source: str) -> list[dict[str, Any]]:
    jsonl_path = Path(path).expanduser()
    if not jsonl_path.exists():
        return []
    events = []
    for raw_line in jsonl_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            events.append(_event_from_entry(entry, source=source))
    return events


def _events_from_package_root(root: str | Path) -> list[dict[str, Any]]:
    package_root = Path(root).expanduser()
    if not package_root.exists():
        return []
    events = []
    for package_path in sorted(package_root.glob("*/package.json")):
        try:
            manifest = json.loads(package_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        package_dir = package_path.parent
        selected = manifest.get("selected_photo") or {}
        research = _read_json_if_exists(package_dir / "research.json")
        image_path = _resolve_package_image_path(package_dir, manifest)
        identity = identity_from_record(selected, image_path=image_path)
        events.append(
            {
                "source": "local_package",
                "status": "generated",
                "date": manifest.get("date") or package_dir.name[:10],
                "package_id": manifest.get("package_id"),
                "platform": None,
                "metadata_filename": selected.get("metadata_filename") or selected.get("metadataFilename"),
                "image_filename": selected.get("filename") or selected.get("imageFilename"),
                "source_title": selected.get("name"),
                "cote": selected.get("cote"),
                "output_dir": str(package_dir),
                "story_angle_key": build_story_angle_key(record=selected, research=research, manifest=manifest),
                "identity": identity.to_dict(),
            }
        )
    return events


def _event_from_entry(entry: dict[str, Any], *, source: str) -> dict[str, Any]:
    record = {
        "metadata_filename": entry.get("metadata_filename"),
        "filename": entry.get("image_filename"),
        "name": entry.get("source_title") or entry.get("title"),
        "cote": entry.get("cote"),
        "external_url": entry.get("external_url"),
    }
    identity_payload = entry.get("image_identity")
    identity = _identity_from_payload(identity_payload) if isinstance(identity_payload, dict) else identity_from_record(record)
    return {
        "source": source,
        "status": entry.get("status") or ("published" if source == "publish_registry" else None),
        "date": entry.get("date") or entry.get("published_at") or entry.get("prepared_at") or entry.get("recorded_at"),
        "package_id": entry.get("package_id") or entry.get("story_asset_id"),
        "platform": entry.get("platform"),
        "metadata_filename": entry.get("metadata_filename"),
        "image_filename": entry.get("image_filename"),
        "source_title": entry.get("source_title") or entry.get("title"),
        "cote": entry.get("cote"),
        "output_dir": entry.get("output_dir") or entry.get("package_dir"),
        "story_angle_key": normalize_text(entry.get("story_angle_key")),
        "identity": identity.to_dict(),
    }


def _identity_from_payload(payload: dict[str, Any]) -> SocialImageIdentity:
    return SocialImageIdentity(
        metadata_filename=payload.get("metadata_filename"),
        image_filename=payload.get("image_filename"),
        cote=payload.get("cote"),
        external_url=payload.get("external_url"),
        title_key=payload.get("title_key"),
        subject_family_key=payload.get("subject_family_key"),
        series_keys=tuple(payload.get("series_keys") or []),
        perceptual_hash=payload.get("perceptual_hash"),
    )


def _event_identity(event: dict[str, Any]) -> SocialImageIdentity:
    payload = event.get("identity") or {}
    if isinstance(payload, dict):
        return _identity_from_payload(payload)
    return identity_from_record(event)


def _event_active(event: dict[str, Any]) -> bool:
    status = str(event.get("status") or "").strip().lower()
    return status in USAGE_STATUSES


def _event_date(event: dict[str, Any]) -> date | None:
    raw = str(event.get("date") or event.get("recorded_at") or "").strip()
    if not raw:
        return None
    try:
        if "T" in raw:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _match_payload(
    event: dict[str, Any],
    match_type: str,
    matched_keys: list[str],
    gap_days: int | None,
    phash_distance: int | None,
) -> dict[str, Any]:
    return {
        "type": match_type,
        "source": event.get("source"),
        "date": str(event.get("date") or "")[:10] or None,
        "gap_days": gap_days,
        "package_id": event.get("package_id"),
        "platform": event.get("platform"),
        "source_title": event.get("source_title"),
        "cote": event.get("cote"),
        "matched_keys": matched_keys,
        "story_angle_key": event.get("story_angle_key"),
        "phash_distance": phash_distance,
    }


def _recent_matches(matches: list[dict[str, Any]], cooldown_days: int) -> list[dict[str, Any]]:
    if cooldown_days <= 0:
        return []
    return [
        match
        for match in matches
        if match.get("gap_days") is not None and 0 <= int(match["gap_days"]) <= cooldown_days
    ]


def _intentional_reuse_allowed(
    *,
    matches: list[dict[str, Any]],
    current_angle: str,
    reuse_reason: str | None,
    allow_intentional_reuse: bool,
    max_reuse: int,
) -> bool:
    if not allow_intentional_reuse or not current_angle or not str(reuse_reason or "").strip():
        return False
    if _distinct_package_count(matches) >= max_reuse:
        return False
    prior_angles = {normalize_text(match.get("story_angle_key")) for match in matches if match.get("story_angle_key")}
    return current_angle not in prior_angles


def _distinct_package_count(matches: list[dict[str, Any]]) -> int:
    keys = {
        str(match.get("package_id") or match.get("date") or match.get("source_title") or "").strip()
        for match in matches
    }
    return len({key for key in keys if key})


def _is_same_current_event(
    event: dict[str, Any],
    *,
    current_package_id: str | None,
    current_output_dir: str | Path | None,
) -> bool:
    if current_package_id and str(event.get("package_id") or "") == current_package_id:
        return True
    if current_output_dir:
        raw_event_dir = str(event.get("output_dir") or "").strip()
        if not raw_event_dir:
            return False
        try:
            event_dir = Path(raw_event_dir).expanduser().resolve()
            current_dir = Path(current_output_dir).expanduser().resolve()
            return event_dir == current_dir
        except OSError:
            return False
    return False


def _dedupe_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for event in events:
        key = "|".join(
            str(event.get(part) or "")
            for part in ("source", "status", "date", "package_id", "platform", "output_dir")
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(event)
    return deduped


def _dedupe_matches(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for match in matches:
        key = (str(match.get("package_id") or ""), str(match.get("type") or ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(match)
    return deduped


def _match_sort_key(match: dict[str, Any]) -> tuple[int, str]:
    gap = match.get("gap_days")
    return (999999 if gap is None else int(gap), str(match.get("package_id") or ""))


def _read_json_if_exists(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _resolve_package_image_path(package_dir: Path, manifest: dict[str, Any]) -> Path | None:
    source = manifest.get("source_image")
    if source:
        path = Path(str(source)).expanduser()
        if path.exists():
            return path
    for name in ("source.jpg", "source.jpeg", "source.png", "photo.jpg", "image.jpg"):
        path = package_dir / name
        if path.exists():
            return path
    return None


def _filename_key(value: str | None) -> str | None:
    if not value:
        return None
    return Path(value).name.strip().lower() or None


def _normalize_cote(value: str | None) -> str | None:
    if not value:
        return None
    normalized = re.sub(r"\s+", "", str(value).strip().upper())
    return normalized or None


def _normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(str(value).strip())
    if not parsed.scheme or not parsed.netloc:
        return normalize_text(value) or None
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", "", ""))


def _scoped(scope: str, value: str | None) -> str | None:
    if not value:
        return None
    return f"{scope}:{value}"


def _first_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""
