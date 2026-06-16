#!/usr/bin/env python3
"""Local fallback social pipeline for MTL Archives.

Builds a dual package:
- Instagram square carousel + caption
- Facebook reel + caption

This runner is designed to work when the remote OpenClaw/spruce host is unavailable.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]
from env_loader import load_repo_env, repo_state_path

load_repo_env(REPO_ROOT)

from caption import format_reel_caption, format_static_caption
from carousel import generate_story_carousel
from ledger import append_entry, blocked_keys, build_package_id, record_keys
from obsidian import export_package_note
from reel import generate_reel
from research import DEFAULT_MODEL, GeminiRequestError, generate_research_package, refresh_public_story_from_payload
from search import download_image, format_metadata, get_photo_by_id, get_random_images, search_images
from social_identity import (
    ReusePolicyConfig,
    build_story_angle_key,
    evaluate_reuse_policy,
    format_reuse_block,
    load_usage_events,
)
from story_pages import build_story_seed
from themes import resolve_theme


DEFAULT_OUTPUT_ROOT = Path.home() / "Downloads" / "mtl-daily"
DEFAULT_LEDGER_PATH = repo_state_path(REPO_ROOT, "data/social/publish-ledger.jsonl")
DEFAULT_PUBLISH_REGISTRY_PATH = repo_state_path(REPO_ROOT, "data/social/publish-registry.jsonl")
DEFAULT_STORY_REGISTRY_PATH = repo_state_path(REPO_ROOT, "data/social/story-registry.jsonl")
DEFAULT_OBSIDIAN_EXPORT_DIR = os.environ.get("MTL_OBSIDIAN_EXPORT_DIR")
DEFAULT_SOCIAL_TIMEZONE = os.environ.get("MTL_SOCIAL_TIMEZONE", "").strip()


def run_pipeline(
    *,
    run_date: date,
    timezone_name: str | None,
    output_root: Path,
    theme_override: str | None,
    editorial_brief: str | None,
    query: str | None,
    image_id: str | None,
    image_path: str | None,
    metadata_text: str | None,
    metadata_file: str | None,
    package_dir: str | None,
    reuse_research: bool,
    model: str,
    skip_reel: bool,
    skip_carousel: bool,
    max_rerolls: int,
    candidate_pool: int,
    ledger_path: Path,
    publish_registry_path: Path,
    story_registry_path: Path,
    cooldown_days: int,
    allow_intentional_image_reuse: bool,
    reuse_reason: str | None,
    story_angle_key: str | None,
    obsidian_dir: Path | None,
) -> dict:
    theme_spec = resolve_theme(theme_override, run_date)
    output_dir = output_root / run_date.isoformat()
    attempt_root = output_root / ".attempts" / run_date.isoformat()
    _reset_dir(attempt_root)
    output_dir.mkdir(parents=True, exist_ok=True)

    combined_brief = _combine_editorial_briefs(theme_spec.editorial_brief, editorial_brief)
    fixed_source = bool(package_dir or image_path or image_id)
    candidate_limit = max(1, max_rerolls + 1)
    reuse_policy = ReusePolicyConfig(
        exact_cooldown_days=cooldown_days,
        family_cooldown_days=cooldown_days,
    )
    usage_events = load_usage_events(
        ledger_paths=[ledger_path],
        registry_paths=[publish_registry_path],
        story_registry_paths=[story_registry_path],
        package_roots=_usage_package_roots(output_root),
    )
    candidates = _resolve_candidates(
        query=query,
        image_id=image_id,
        image_path=image_path,
        package_dir=package_dir,
        candidate_pool=max(candidate_pool, candidate_limit),
        ledger_path=ledger_path,
        cooldown_days=cooldown_days,
        run_date=run_date,
        usage_events=usage_events,
        reuse_policy=reuse_policy,
        allow_intentional_image_reuse=allow_intentional_image_reuse,
        reuse_reason=reuse_reason,
        story_angle_key=story_angle_key,
    )
    if not candidates:
        raise SystemExit("No candidate images available for this run.")

    attempts: list[dict] = []
    accepted_attempt: dict | None = None
    best_attempt: dict | None = None

    for index, candidate in enumerate(candidates[:candidate_limit], start=1):
        attempt_dir = attempt_root / f"attempt-{index:02d}"
        _reset_dir(attempt_dir)
        source = _materialize_candidate(candidate, attempt_dir)
        metadata = _resolve_metadata(
            source["record"],
            metadata_text=metadata_text,
            metadata_file=metadata_file,
        )
        manifest, inspection = _build_package_for_source(
            run_date=run_date,
            output_dir=attempt_dir,
            theme_spec=theme_spec,
            source=source,
            metadata=metadata,
            combined_brief=combined_brief,
            package_dir=package_dir,
            reuse_research=reuse_research,
            model=model,
            skip_reel=skip_reel,
            skip_carousel=skip_carousel,
            usage_events=usage_events,
            reuse_policy=reuse_policy,
            allow_intentional_image_reuse=allow_intentional_image_reuse,
            reuse_reason=reuse_reason,
            story_angle_key_override=story_angle_key,
        )
        attempt_summary = {
            "attempt": index,
            "brand_ready": bool(inspection.get("brand_ready")),
            "score": _attempt_score(inspection),
            "selected_photo": (manifest or {}).get("selected_photo") or source.get("record"),
            "inspection_summary": str(attempt_dir / "inspection_summary.json"),
            "inspection_report": str(attempt_dir / "inspection_report.txt"),
            "package_dir": str(attempt_dir),
        }
        attempts.append(attempt_summary)

        if best_attempt is None or attempt_summary["score"] > best_attempt["score"]:
            best_attempt = attempt_summary

        if inspection.get("brand_ready"):
            accepted_attempt = attempt_summary
            break

        if fixed_source:
            break

    selected_attempt = accepted_attempt or best_attempt
    if selected_attempt is None:
        raise SystemExit("Failed to build any candidate package.")

    selection_status = _selection_status(
        fixed_source=fixed_source,
        accepted_attempt=accepted_attempt,
        selected_attempt=selected_attempt,
    )
    _promote_attempt_dir(Path(selected_attempt["package_dir"]), output_dir)
    attempts_path = output_dir / "attempts_summary.json"
    attempts_payload = {
        "selection_status": selection_status,
        "selected_attempt": selected_attempt["attempt"],
        "accepted_attempt": accepted_attempt["attempt"] if accepted_attempt else None,
        "max_rerolls": max_rerolls,
        "candidate_pool": candidate_pool,
        "attempts": attempts,
    }
    attempts_path.write_text(
        json.dumps(attempts_payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    manifest_path = output_dir / "package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _canonicalize_manifest_paths(manifest, output_dir)
    manifest["selection_status"] = selection_status
    manifest["brand_ready"] = bool(accepted_attempt)
    manifest["reroll_attempts"] = len(attempts) - 1
    manifest["attempts_summary"] = str(attempts_path)
    manifest["attempts"] = attempts
    manifest["outputs"]["attempts_summary"] = str(attempts_path)
    manifest["ledger_path"] = str(ledger_path)
    manifest["resolved_timezone"] = timezone_name

    inspection_path = output_dir / "inspection_summary.json"
    inspection = json.loads(inspection_path.read_text(encoding="utf-8"))
    _canonicalize_inspection_paths(inspection, output_dir)
    inspection["selection_status"] = selection_status
    inspection["reroll_attempts"] = len(attempts) - 1
    inspection["attempts_considered"] = len(attempts)
    inspection["resolved_timezone"] = timezone_name
    inspection_path.write_text(
        json.dumps(inspection, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (output_dir / "inspection_report.txt").write_text(
        _format_inspection_report(inspection),
        encoding="utf-8",
    )
    if obsidian_dir:
        story_seed = json.loads((output_dir / "story_seed.json").read_text(encoding="utf-8"))
        ig_caption = (output_dir / "caption_instagram.txt").read_text(encoding="utf-8")
        fb_caption = (output_dir / "caption_facebook.txt").read_text(encoding="utf-8")
        obsidian_export = export_package_note(
            export_root=obsidian_dir,
            manifest=manifest,
            inspection=inspection,
            story_seed=story_seed,
            output_dir=output_dir,
            ig_caption=ig_caption,
            fb_caption=fb_caption,
        )
        manifest["outputs"]["obsidian_note"] = obsidian_export["note_path"]
        manifest["outputs"]["obsidian_export_dir"] = obsidian_export["export_dir"]
        inspection["obsidian"] = {
            "note_path": obsidian_export["note_path"],
            "export_dir": obsidian_export["export_dir"],
        }
        inspection_path.write_text(
            json.dumps(inspection, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (output_dir / "inspection_report.txt").write_text(
            _format_inspection_report(inspection),
            encoding="utf-8",
        )
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    _append_generation_ledger(
        ledger_path=ledger_path,
        run_date=run_date,
        manifest=manifest,
        selection_status=selection_status,
        output_dir=output_dir,
    )
    return manifest


def _resolve_source(
    *,
    output_dir: Path,
    package_dir: str | None,
    query: str | None,
    image_id: str | None,
    image_path: str | None,
) -> dict:
    if image_path:
        source_path = Path(image_path).expanduser().resolve()
        if not source_path.exists():
            raise FileNotFoundError(f"Image not found: {source_path}")
        copied = _copy_source_image(source_path, output_dir)
        return {"image_path": str(copied), "record": {"source": "manual-image", "filename": source_path.name}}

    if package_dir:
        return _resolve_source_from_package(Path(package_dir).expanduser().resolve(), output_dir)

    if image_id:
        record = get_photo_by_id(image_id)
        if not record:
            raise SystemExit(f"Photo ID not found: {image_id}")
    elif query:
        results = search_images(query, mode="smart", limit=5)
        if not results:
            raise SystemExit(f"No search results for query: {query}")
        record = results[0]
    else:
        results = get_random_images(limit=5)
        if not results:
            raise SystemExit("No random images returned from worker API.")
        record = results[0]

    image_url = (
        record.get("imageUrl")
        or record.get("image_url")
        or record.get("externalUrl")
        or record.get("external_url")
    )
    if not image_url:
        raise SystemExit("Selected record has no image URL.")

    source_path = output_dir / "source.jpg"
    download_image(image_url, str(source_path))
    return {"image_path": str(source_path), "record": record}


def _resolve_candidates(
    *,
    query: str | None,
    image_id: str | None,
    image_path: str | None,
    package_dir: str | None,
    candidate_pool: int,
    ledger_path: Path,
    cooldown_days: int,
    run_date: date,
    usage_events: list[dict],
    reuse_policy: ReusePolicyConfig,
    allow_intentional_image_reuse: bool,
    reuse_reason: str | None,
    story_angle_key: str | None,
) -> list[dict]:
    if image_path:
        source_path = Path(image_path).expanduser().resolve()
        if not source_path.exists():
            raise FileNotFoundError(f"Image not found: {source_path}")
        return [{"type": "local-image", "path": str(source_path), "record": {"source": "manual-image", "filename": source_path.name}}]

    if package_dir:
        return [{"type": "package", "path": str(Path(package_dir).expanduser().resolve())}]

    if image_id:
        record = get_photo_by_id(image_id)
        if not record:
            raise SystemExit(f"Photo ID not found: {image_id}")
        decision = evaluate_reuse_policy(
            record=record,
            as_of=run_date,
            events=usage_events,
            config=reuse_policy,
            story_angle_key=story_angle_key,
            reuse_reason=reuse_reason,
            allow_intentional_reuse=allow_intentional_image_reuse,
        )
        if not decision.get("allowed"):
            raise SystemExit(format_reuse_block(decision))
        return [{"type": "record", "record": record}]

    if query:
        results = search_images(query, mode="smart", limit=candidate_pool)
        if not results:
            raise SystemExit(f"No search results for query: {query}")
        deduped = _dedupe_records(results)
        filtered = _filter_recent_records(deduped, ledger_path=ledger_path, cooldown_days=cooldown_days, run_date=run_date)
        filtered = _filter_reuse_policy_records(
            filtered,
            run_date=run_date,
            usage_events=usage_events,
            reuse_policy=reuse_policy,
            allow_intentional_image_reuse=allow_intentional_image_reuse,
            reuse_reason=reuse_reason,
            story_angle_key=story_angle_key,
        )
        return [{"type": "record", "record": record} for record in filtered]

    results = get_random_images(limit=candidate_pool)
    if not results:
        raise SystemExit("No random images returned from worker API.")
    deduped = _dedupe_records(results)
    filtered = _filter_recent_records(deduped, ledger_path=ledger_path, cooldown_days=cooldown_days, run_date=run_date)
    filtered = _filter_reuse_policy_records(
        filtered,
        run_date=run_date,
        usage_events=usage_events,
        reuse_policy=reuse_policy,
        allow_intentional_image_reuse=allow_intentional_image_reuse,
        reuse_reason=reuse_reason,
        story_angle_key=story_angle_key,
    )
    return [{"type": "record", "record": record} for record in filtered]


def _materialize_candidate(candidate: dict, output_dir: Path) -> dict:
    kind = candidate.get("type")
    if kind == "local-image":
        source_path = Path(candidate["path"]).expanduser().resolve()
        copied = _copy_source_image(source_path, output_dir)
        return {"image_path": str(copied), "record": candidate.get("record")}
    if kind == "package":
        return _resolve_source_from_package(Path(candidate["path"]), output_dir)
    if kind == "record":
        record = candidate["record"]
        image_url = (
            record.get("imageUrl")
            or record.get("image_url")
            or record.get("externalUrl")
            or record.get("external_url")
        )
        if not image_url:
            raise SystemExit("Selected record has no image URL.")
        source_path = output_dir / "source.jpg"
        download_image(image_url, str(source_path))
        return {"image_path": str(source_path), "record": record}
    raise SystemExit(f"Unsupported candidate type: {kind}")


def _resolve_source_from_package(package_dir: Path, output_dir: Path) -> dict:
    if not package_dir.exists():
        raise FileNotFoundError(f"Package dir not found: {package_dir}")

    for pattern in ("source.*", "photo.*", "image.*"):
        matches = sorted(package_dir.glob(pattern))
        if matches:
            copied = _copy_source_image(matches[0], output_dir)
            record = _record_from_package_dir(package_dir)
            return {"image_path": str(copied), "record": record}

    record = _record_from_package_dir(package_dir)
    if record:
        resolved = _resolve_record_from_package(record)
        if resolved:
            image_url = (
                resolved.get("imageUrl")
                or resolved.get("image_url")
                or resolved.get("externalUrl")
                or resolved.get("external_url")
            )
            if image_url:
                source_path = output_dir / "source.jpg"
                download_image(image_url, str(source_path))
                return {"image_path": str(source_path), "record": resolved}

    raise SystemExit(
        "Package dir does not contain a local source image and could not be rehydrated from metadata."
    )


def _record_from_package_dir(package_dir: Path) -> dict | None:
    package_path = package_dir / "package.json"
    if package_path.exists():
        data = json.loads(package_path.read_text(encoding="utf-8"))
        return data.get("selected_photo") or None
    return None


def _load_existing_research(package_dir: str | None) -> dict | None:
    if not package_dir:
        return None
    candidate = Path(package_dir).expanduser().resolve() / "research.json"
    if not candidate.exists():
        return None
    try:
        return json.loads(candidate.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _resolve_record_from_package(record: dict) -> dict | None:
    metadata_id = record.get("metadata_filename") or record.get("metadataFilename")
    if metadata_id:
        found = get_photo_by_id(metadata_id)
        if found:
            return found

    filename = record.get("filename") or record.get("imageFilename") or ""
    digits = "".join(ch for ch in Path(filename).stem if ch.isdigit())
    if digits:
        found = get_photo_by_id(digits)
        if found:
            return found

    name = record.get("name")
    if name:
        results = search_images(name, mode="smart", limit=1)
        if results:
            return results[0]
    return None


def _filter_recent_records(
    records: list[dict],
    *,
    ledger_path: Path,
    cooldown_days: int,
    run_date: date,
) -> list[dict]:
    if cooldown_days <= 0:
        return records
    blocked = blocked_keys(ledger_path, cooldown_days=cooldown_days, as_of=run_date)
    if not blocked:
        return records
    filtered = [record for record in records if not (record_keys(record) & blocked)]
    return filtered or records


def _usage_package_roots(output_root: Path) -> list[Path]:
    roots: list[Path] = []
    for candidate in (output_root, DEFAULT_OUTPUT_ROOT):
        resolved = candidate.expanduser()
        if resolved not in roots:
            roots.append(resolved)
    return roots


def _filter_reuse_policy_records(
    records: list[dict],
    *,
    run_date: date,
    usage_events: list[dict],
    reuse_policy: ReusePolicyConfig,
    allow_intentional_image_reuse: bool,
    reuse_reason: str | None,
    story_angle_key: str | None,
) -> list[dict]:
    filtered: list[dict] = []
    for record in records:
        decision = evaluate_reuse_policy(
            record=record,
            as_of=run_date,
            events=usage_events,
            config=reuse_policy,
            story_angle_key=story_angle_key,
            reuse_reason=reuse_reason,
            allow_intentional_reuse=allow_intentional_image_reuse,
        )
        if decision.get("allowed"):
            filtered.append(record)
    return filtered


def _copy_source_image(source_path: Path, output_dir: Path) -> Path:
    destination = output_dir / f"source{source_path.suffix.lower() or '.jpg'}"
    shutil.copy2(source_path, destination)
    return destination


def _reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def _promote_attempt_dir(attempt_dir: Path, output_dir: Path) -> None:
    _reset_dir(output_dir)
    for child in attempt_dir.iterdir():
        destination = output_dir / child.name
        if child.is_dir():
            shutil.copytree(child, destination)
        else:
            shutil.copy2(child, destination)


def _dedupe_records(records: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for record in records:
        key = _record_identity(record)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def _record_identity(record: dict) -> str:
    return (
        str(record.get("metadata_filename") or record.get("metadataFilename") or "")
        or str(record.get("filename") or record.get("imageFilename") or "")
        or str(record.get("name") or "")
    )


def _attempt_score(inspection: dict) -> int:
    reel_score = ((inspection.get("reel") or {}).get("score")) or 0
    ig_score = ((inspection.get("instagram") or {}).get("score")) or 0
    return int(reel_score) + int(ig_score)


def _append_generation_ledger(
    *,
    ledger_path: Path,
    run_date: date,
    manifest: dict,
    selection_status: str,
    output_dir: Path,
) -> None:
    selected = manifest.get("selected_photo") or {}
    story_seed_path = ((manifest.get("outputs") or {}).get("story_seed")) or ""
    entry = {
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "date": run_date.isoformat(),
        "package_id": build_package_id(manifest, package_dir=output_dir),
        "status": "generated",
        "metadata_filename": selected.get("metadata_filename") or selected.get("metadataFilename"),
        "image_filename": selected.get("filename") or selected.get("imageFilename"),
        "theme_key": manifest.get("theme_key"),
        "theme_label": manifest.get("theme"),
        "delivery_plan": manifest.get("delivery_plan"),
        "selection_status": selection_status,
        "brand_ready": bool(manifest.get("brand_ready")),
        "source_title": selected.get("name"),
        "cote": selected.get("cote"),
        "output_dir": str(output_dir),
        "story_seed": story_seed_path,
        "story_angle_key": manifest.get("story_angle_key"),
        "image_identity": manifest.get("image_identity"),
        "image_reuse_policy": {
            "status": (manifest.get("image_reuse_policy") or {}).get("status"),
            "blocked_reason": (manifest.get("image_reuse_policy") or {}).get("blocked_reason"),
            "reuse_count": (manifest.get("image_reuse_policy") or {}).get("reuse_count"),
            "reuse_reason": (manifest.get("image_reuse_policy") or {}).get("reuse_reason"),
        },
    }
    append_entry(ledger_path, entry)


def _canonicalize_manifest_paths(manifest: dict, output_dir: Path) -> None:
    outputs = manifest.get("outputs") or {}
    file_map = {
        "research": "research.json",
        "research_full": "research_full.json",
        "metadata": "metadata.txt",
        "instagram_caption": "caption_instagram.txt",
        "facebook_caption": "caption_facebook.txt",
        "inspection_summary": "inspection_summary.json",
        "inspection_report": "inspection_report.txt",
        "story_seed": "story_seed.json",
    }
    for key, filename in file_map.items():
        candidate = output_dir / filename
        if candidate.exists():
            outputs[key] = str(candidate)

    carousel_dir = output_dir / "instagram_carousel"
    outputs["instagram_carousel"] = (
        [str(path) for path in sorted(carousel_dir.glob("*")) if path.is_file()]
        if carousel_dir.exists()
        else []
    )

    reel_path = output_dir / "facebook_reel.mp4"
    outputs["facebook_reel"] = str(reel_path) if reel_path.exists() else ""
    manifest["outputs"] = outputs

    source_image = output_dir / "source.jpg"
    if source_image.exists():
        manifest["source_image"] = str(source_image)


def _canonicalize_inspection_paths(inspection: dict, output_dir: Path) -> None:
    selected = inspection.get("selected_photo") or {}
    source_image = output_dir / "source.jpg"
    if source_image.exists():
        selected["source_image"] = str(source_image)
    inspection["selected_photo"] = selected

    reel = inspection.get("reel") or {}
    reel_path = output_dir / "facebook_reel.mp4"
    reel["output"] = str(reel_path) if reel_path.exists() else ""
    inspection["reel"] = reel

    instagram = inspection.get("instagram") or {}
    carousel_dir = output_dir / "instagram_carousel"
    instagram["slides"] = (
        [str(path) for path in sorted(carousel_dir.glob("*")) if path.is_file()]
        if carousel_dir.exists()
        else []
    )
    inspection["instagram"] = instagram


def _selection_status(*, fixed_source: bool, accepted_attempt: dict | None, selected_attempt: dict) -> str:
    if accepted_attempt and accepted_attempt["attempt"] == 1:
        return "accepted_first_candidate"
    if accepted_attempt:
        return "rerolled_to_brand_ready_candidate"
    if fixed_source:
        return "explicit_source_requires_review"
    return "no_brand_ready_candidate"


def _resolve_metadata(record: dict | None, *, metadata_text: str | None, metadata_file: str | None) -> str:
    if metadata_text:
        return metadata_text.strip()
    if metadata_file:
        return Path(metadata_file).expanduser().read_text(encoding="utf-8").strip()
    if record:
        formatted = format_metadata(record)
        if formatted:
            return formatted
    return (
        "This is definitely an archival Montreal image.\n"
        "Exact location, date, building name, and neighborhood are not independently verified by metadata.\n"
        "Treat Montreal as the only hard geographic anchor and avoid inventing specifics."
    )


def _combine_editorial_briefs(theme_brief: str, extra_brief: str | None) -> str:
    if extra_brief:
        return f"{theme_brief}\n\nAdditional brief:\n{extra_brief.strip()}"
    return theme_brief


def _build_package_for_source(
    *,
    run_date: date,
    output_dir: Path,
    theme_spec,
    source: dict,
    metadata: str,
    combined_brief: str,
    package_dir: str | None,
    reuse_research: bool,
    model: str,
    skip_reel: bool,
    skip_carousel: bool,
    usage_events: list[dict],
    reuse_policy: ReusePolicyConfig,
    allow_intentional_image_reuse: bool,
    reuse_reason: str | None,
    story_angle_key_override: str | None,
) -> tuple[dict, dict]:
    (output_dir / "metadata.txt").write_text(metadata, encoding="utf-8")
    existing_research = _load_existing_research(package_dir) if reuse_research else None
    if existing_research:
        research = refresh_public_story_from_payload(
            existing_research,
            metadata,
            theme=theme_spec.key,
        )
        package = {
            "model": model,
            "theme": theme_spec.key,
            "metadata": metadata,
            "editorial_brief": combined_brief,
            "payload": research,
        }
    else:
        package = generate_research_package(
            source["image_path"],
            metadata,
            theme=theme_spec.key,
            model=model,
            editorial_brief=combined_brief,
        )
        research = package["payload"]
        research["theme_key"] = theme_spec.key

    (output_dir / "research_full.json").write_text(
        json.dumps(package, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (output_dir / "research.json").write_text(
        json.dumps(research, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ig_caption = format_static_caption(research)
    fb_caption = format_reel_caption(research)
    (output_dir / "caption_instagram.txt").write_text(ig_caption, encoding="utf-8")
    (output_dir / "caption_facebook.txt").write_text(fb_caption, encoding="utf-8")

    carousel_paths: list[str] = []
    if not skip_carousel:
        carousel_paths = generate_story_carousel(
            research,
            source["image_path"],
            str(output_dir / "instagram_carousel"),
            selected_photo=source["record"] or {},
        )

    reel_path = ""
    if not skip_reel:
        reel_path = str(output_dir / "facebook_reel.mp4")
        generate_reel(
            research,
            source["image_path"],
            grid_images=None,
            output_path=reel_path,
            work_dir=str(output_dir / "_reel_work"),
        )

    inspection = _build_inspection_summary(
        run_date=run_date,
        theme_label=theme_spec.label,
        theme_description=theme_spec.description,
        source=source,
        research=research,
        carousel_paths=carousel_paths,
        reel_path=reel_path,
    )
    (output_dir / "inspection_summary.json").write_text(
        json.dumps(inspection, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (output_dir / "inspection_report.txt").write_text(
        _format_inspection_report(inspection),
        encoding="utf-8",
    )
    story_seed = build_story_seed(
        run_date=run_date,
        theme_key=theme_spec.key,
        theme_label=theme_spec.label,
        selected_photo=source.get("record") or {},
        research=research,
        package_dir=output_dir,
    )
    story_seed_path = output_dir / "story_seed.json"
    story_seed_path.write_text(
        json.dumps(story_seed, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    manifest = {
        "date": run_date.isoformat(),
        "day": run_date.strftime("%A").lower(),
        "content_type": "dual",
        "delivery_plan": {"instagram": "carousel", "facebook": "reel"},
        "theme": theme_spec.label,
        "theme_key": theme_spec.key,
        "theme_description": theme_spec.description,
        "editorial_brief": combined_brief,
        "selected_photo": source["record"],
        "source_image": source["image_path"],
        "research_model": model,
        "outputs": {
            "research": str(output_dir / "research.json"),
            "research_full": str(output_dir / "research_full.json"),
            "metadata": str(output_dir / "metadata.txt"),
            "instagram_caption": str(output_dir / "caption_instagram.txt"),
            "facebook_caption": str(output_dir / "caption_facebook.txt"),
            "instagram_carousel": carousel_paths,
            "facebook_reel": reel_path,
            "inspection_summary": str(output_dir / "inspection_summary.json"),
            "inspection_report": str(output_dir / "inspection_report.txt"),
            "story_seed": str(story_seed_path),
        },
    }
    manifest["package_id"] = build_package_id(manifest, package_dir=output_dir)
    story_angle_key = build_story_angle_key(
        record=source.get("record") or {},
        research=research,
        manifest=manifest,
        override=story_angle_key_override,
    )
    manifest["story_angle_key"] = story_angle_key
    reuse_decision = evaluate_reuse_policy(
        record=source.get("record") or {},
        as_of=run_date,
        events=usage_events,
        config=reuse_policy,
        image_path=source.get("image_path"),
        story_angle_key=story_angle_key,
        reuse_reason=reuse_reason,
        allow_intentional_reuse=allow_intentional_image_reuse,
        current_package_id=manifest["package_id"],
        current_output_dir=output_dir,
    )
    manifest["image_identity"] = reuse_decision.get("identity")
    manifest["image_reuse_policy"] = reuse_decision
    inspection["story_angle_key"] = story_angle_key
    inspection["image_reuse_policy"] = reuse_decision
    if not reuse_decision.get("allowed"):
        inspection["brand_ready"] = False
        inspection["reuse_blocked"] = True
        inspection["reuse_block_reason"] = reuse_decision.get("blocked_reason")
    (output_dir / "inspection_summary.json").write_text(
        json.dumps(inspection, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (output_dir / "inspection_report.txt").write_text(
        _format_inspection_report(inspection),
        encoding="utf-8",
    )
    (output_dir / "package.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return manifest, inspection


def _build_inspection_summary(
    *,
    run_date: date,
    theme_label: str,
    theme_description: str,
    source: dict,
    research: dict,
    carousel_paths: list[str],
    reel_path: str,
) -> dict:
    story_quality = research.get("story_quality", {}) or {}
    static_quality = story_quality.get("static", {}) or {}
    reel_quality = story_quality.get("reel", {}) or {}
    verification = research.get("verification_summary", {}) or {}
    grounding = research.get("grounded_context", {}) or {}

    return {
        "date": run_date.isoformat(),
        "theme": theme_label,
        "theme_description": theme_description,
        "brand_ready": bool(story_quality.get("pass", False)),
        "location_confidence": research.get("location_confidence") or "normal",
        "exact_location_public_safe": bool(research.get("exact_location_public_safe", True)),
        "selected_photo": {
            "title": (source.get("record") or {}).get("name"),
            "filename": (source.get("record") or {}).get("filename"),
            "cote": (source.get("record") or {}).get("cote"),
            "source_image": source.get("image_path"),
        },
        "reel": {
            "title": ((research.get("public_story") or {}).get("reel") or {}).get("title_fr") or research.get("title_fr"),
            "hook": ((research.get("public_story") or {}).get("reel") or {}).get("hook_fr") or research.get("most_striking_fr"),
            "badge": ((research.get("public_story") or {}).get("reel") or {}).get("badge_fr") or "",
            "score": reel_quality.get("selected_score"),
            "caption_ok": reel_quality.get("pass", False),
            "output": reel_path,
        },
        "instagram": {
            "score": static_quality.get("selected_score"),
            "caption_ok": static_quality.get("pass", False),
            "slides": carousel_paths,
        },
        "verification": verification,
        "grounding": {
            "used": bool(grounding.get("used")),
            "mode": grounding.get("mode"),
            "search_usefulness": grounding.get("search_usefulness"),
            "queries": grounding.get("queries") or [],
            "source_count": len(grounding.get("sources") or []),
        },
    }


def _format_inspection_report(summary: dict) -> str:
    selected = summary.get("selected_photo", {})
    reel = summary.get("reel", {})
    verification = summary.get("verification", {})
    grounding = summary.get("grounding", {})
    obsidian = summary.get("obsidian", {})
    reuse_policy = summary.get("image_reuse_policy") or {}
    lines = [
        f"Date: {summary.get('date')}",
        f"Resolved timezone: {summary.get('resolved_timezone') or 'Unknown'}",
        f"Theme: {summary.get('theme')}",
        f"Theme description: {summary.get('theme_description')}",
        f"Brand ready: {'yes' if summary.get('brand_ready') else 'no'}",
        f"Location confidence: {summary.get('location_confidence') or 'Unknown'}",
        f"Exact location public-safe: {'yes' if summary.get('exact_location_public_safe') else 'no'}",
        f"Selection status: {summary.get('selection_status') or 'Unknown'}",
        f"Reroll attempts: {summary.get('reroll_attempts') if summary.get('reroll_attempts') is not None else 'Unknown'}",
        f"Image reuse policy: {reuse_policy.get('status') or 'Unknown'}",
        f"Reuse block reason: {reuse_policy.get('blocked_reason') or 'None'}",
        f"Story angle key: {summary.get('story_angle_key') or reuse_policy.get('story_angle_key') or 'Unknown'}",
        "",
        f"Selected photo: {selected.get('title') or 'Unknown'}",
        f"Cote: {selected.get('cote') or 'Unknown'}",
        f"Source image: {selected.get('source_image')}",
        "",
        f"Reel title: {reel.get('title') or 'Unknown'}",
        f"Reel hook: {reel.get('hook') or 'Unknown'}",
        f"Reel badge: {reel.get('badge') or 'Unknown'}",
        f"Reel score: {reel.get('score') if reel.get('score') is not None else 'Unknown'}",
        f"Reel caption ok: {'yes' if reel.get('caption_ok') else 'no'}",
        f"Reel output: {reel.get('output') or 'Skipped'}",
        f"Instagram score: {summary.get('instagram', {}).get('score') if summary.get('instagram', {}).get('score') is not None else 'Unknown'}",
        f"Instagram caption ok: {'yes' if summary.get('instagram', {}).get('caption_ok') else 'no'}",
        "",
        "Evidence ladder:",
        f"  Verified: {verification.get('verified_count', 0)}",
        f"  Probable: {verification.get('probable_count', 0)}",
        f"  Open questions: {verification.get('open_question_count', 0)}",
    ]
    if grounding.get("used"):
        lines.extend(
            [
                "",
                "Grounding:",
                f"  Mode: {grounding.get('mode') or 'Unknown'}",
                f"  Usefulness: {grounding.get('search_usefulness') or 'Unknown'}",
                f"  Sources: {grounding.get('source_count', 0)}",
                f"  Queries: {', '.join(grounding.get('queries') or []) or 'Unknown'}",
            ]
        )
    if obsidian:
        lines.extend(
            [
                "",
                "Obsidian:",
                f"  Note: {obsidian.get('note_path') or 'Unknown'}",
                f"  Export dir: {obsidian.get('export_dir') or 'Unknown'}",
            ]
        )
    return "\n".join(lines).strip() + "\n"


def _package_ready_phrase(manifest: dict) -> str:
    run_date = manifest.get("date") or "Unknown date"
    if not manifest.get("brand_ready", False):
        status = manifest.get("selection_status") or "review_required"
        return f"Package for {run_date} requires review locally ({status})."
    day = str(manifest.get("day") or "").strip()
    if day:
        return f"{day.capitalize()} package is ready locally."
    return f"Package for {run_date} is ready locally."


def _story_source_label(manifest: dict) -> str:
    selected = manifest.get("selected_photo") or {}
    title = (
        selected.get("name")
        or selected.get("title")
        or selected.get("filename")
        or selected.get("imageFilename")
        or "Unknown archive image"
    )
    return str(title).strip()


def _format_cli_summary(manifest: dict) -> str:
    outputs = manifest.get("outputs") or {}
    theme = manifest.get("theme") or "Unknown theme"
    source = _story_source_label(manifest)
    package_dir = Path(outputs.get("research", "")).parent if outputs.get("research") else None
    lines = [
        _package_ready_phrase(manifest),
        f"It's a {theme} package built around {source}.",
        "",
        "Main outputs:",
    ]

    if package_dir:
        lines.append(f"- full package: {package_dir}")
    if outputs.get("facebook_reel"):
        lines.append(f"- FB reel: {outputs['facebook_reel']}")
    if outputs.get("instagram_caption"):
        lines.append(f"- IG caption: {outputs['instagram_caption']}")
    if outputs.get("facebook_caption"):
        lines.append(f"- FB caption: {outputs['facebook_caption']}")
    if outputs.get("inspection_report"):
        lines.append(f"- inspection report: {outputs['inspection_report']}")

    carousel = outputs.get("instagram_carousel") or []
    if carousel:
        lines.extend(["", "Carousel slides:"])
        for index, slide in enumerate(carousel, start=1):
            lines.append(f"- slide {index}: {slide}")
        lines.extend(["", "Preview:", carousel[0]])

    return "\n".join(lines).strip()


def _format_gemini_failure(*, run_date: date, timezone_name: str | None, output_root: Path, exc: Exception) -> str:
    message = str(exc).strip() or "Unknown Gemini request failure."
    lines = [
        "Today's social run failed during Gemini research.",
        "",
        f"Run date: {run_date.isoformat()}",
        f"Resolved timezone: {timezone_name or 'Unknown'}",
        f"Output root: {output_root}",
        "",
        "Reason:",
        f"- {message}",
        "",
        "What to do next:",
        "- Check that this Mac has working network access to generativelanguage.googleapis.com.",
        "- If you already have a saved package, rerun with `--package-dir ... --reuse-research`.",
        "- If the network outage persists, fall back to a manual curated package instead of trusting a partial run.",
    ]
    return "\n".join(lines).strip()


def _resolve_timezone(value: str | None) -> ZoneInfo:
    if value and value.strip():
        return ZoneInfo(value.strip())
    if DEFAULT_SOCIAL_TIMEZONE:
        return ZoneInfo(DEFAULT_SOCIAL_TIMEZONE)

    local_tz = datetime.now().astimezone().tzinfo
    if local_tz is None:
        return ZoneInfo("UTC")
    key = getattr(local_tz, "key", None)
    if key:
        return ZoneInfo(str(key))
    return ZoneInfo("UTC")


def _parse_date(value: str | None, *, timezone_name: str | None) -> date:
    if not value:
        return datetime.now(_resolve_timezone(timezone_name)).date()
    return datetime.strptime(value, "%Y-%m-%d").date()


def main() -> None:
    parser = argparse.ArgumentParser(description="Local fallback social pipeline for MTL Archives")
    parser.add_argument("query", nargs="?", help="Optional search query")
    parser.add_argument("--id", help="Specific photo identifier to fetch from the worker API")
    parser.add_argument("--image", help="Use a local image file instead of searching/downloading")
    parser.add_argument("--metadata", help="Inline metadata text")
    parser.add_argument("--metadata-file", help="Path to a metadata text file")
    parser.add_argument("--package-dir", help="Rerender from an existing local package directory")
    parser.add_argument("--reuse-research", action="store_true", help="Reuse research.json from --package-dir instead of calling Gemini again")
    parser.add_argument("--date", help="Run date in YYYY-MM-DD format (defaults to today)")
    parser.add_argument("--theme", help="Theme override (key, weekday, or label)")
    parser.add_argument("--brief", help="Additional editorial brief")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Gemini model (default: {DEFAULT_MODEL})")
    parser.add_argument("--output-root", help=f"Output root directory (default: {DEFAULT_OUTPUT_ROOT})")
    parser.add_argument(
        "--timezone",
        help=(
            "Timezone used when resolving 'today' if --date is omitted "
            f"(default: env MTL_SOCIAL_TIMEZONE or local system timezone{f' / {DEFAULT_SOCIAL_TIMEZONE}' if DEFAULT_SOCIAL_TIMEZONE else ''})"
        ),
    )
    parser.add_argument("--no-reel", action="store_true", help="Skip Facebook reel generation")
    parser.add_argument("--no-carousel", action="store_true", help="Skip Instagram carousel generation")
    parser.add_argument("--research-only", action="store_true", help="Skip both renderers and only write package files")
    parser.add_argument("--max-rerolls", type=int, default=4, help="Maximum additional candidates to try after the first weak package")
    parser.add_argument("--candidate-pool", type=int, default=8, help="How many search/random candidates to fetch before reroll selection")
    parser.add_argument("--ledger-path", help=f"Publish/generation ledger path (default: {DEFAULT_LEDGER_PATH})")
    parser.add_argument("--publish-registry-path", help=f"Publish registry path (default: {DEFAULT_PUBLISH_REGISTRY_PATH})")
    parser.add_argument("--story-registry-path", help=f"Story registry path (default: {DEFAULT_STORY_REGISTRY_PATH})")
    parser.add_argument("--cooldown-days", type=int, default=90, help="Skip recently used archive images for this many days when auto-selecting")
    parser.add_argument("--allow-intentional-image-reuse", action="store_true", help="Permit policy-bounded subject-family reuse when story angle and reason differ")
    parser.add_argument("--reuse-reason", help="Required explanation when --allow-intentional-image-reuse is used")
    parser.add_argument("--story-angle-key", help="Explicit story angle key for intentional image-family reuse audits")
    parser.add_argument("--obsidian-dir", help="Optional Obsidian export directory for mirrored package notes")
    parser.add_argument("--json", action="store_true", help="Print the final manifest as JSON instead of the operator summary")
    args = parser.parse_args()

    if args.research_only:
        args.no_reel = True
        args.no_carousel = True
    if args.allow_intentional_image_reuse and not args.reuse_reason:
        raise SystemExit("--allow-intentional-image-reuse requires --reuse-reason")

    resolved_timezone = _resolve_timezone(args.timezone).key
    run_date = _parse_date(args.date, timezone_name=args.timezone)
    output_root = Path(args.output_root).expanduser() if args.output_root else DEFAULT_OUTPUT_ROOT
    try:
        manifest = run_pipeline(
            run_date=run_date,
            timezone_name=resolved_timezone,
            output_root=output_root,
            theme_override=args.theme,
            editorial_brief=args.brief,
            query=args.query,
            image_id=args.id,
            image_path=args.image,
            metadata_text=args.metadata,
            metadata_file=args.metadata_file,
            package_dir=args.package_dir,
            reuse_research=args.reuse_research,
            model=args.model,
            skip_reel=args.no_reel,
            skip_carousel=args.no_carousel,
            max_rerolls=max(0, args.max_rerolls),
            candidate_pool=max(1, args.candidate_pool),
            ledger_path=Path(args.ledger_path).expanduser() if args.ledger_path else DEFAULT_LEDGER_PATH,
            publish_registry_path=(
                Path(args.publish_registry_path).expanduser()
                if args.publish_registry_path
                else DEFAULT_PUBLISH_REGISTRY_PATH
            ),
            story_registry_path=(
                Path(args.story_registry_path).expanduser()
                if args.story_registry_path
                else DEFAULT_STORY_REGISTRY_PATH
            ),
            cooldown_days=max(0, args.cooldown_days),
            allow_intentional_image_reuse=bool(args.allow_intentional_image_reuse),
            reuse_reason=args.reuse_reason,
            story_angle_key=args.story_angle_key,
            obsidian_dir=(
                Path(args.obsidian_dir).expanduser()
                if args.obsidian_dir
                else (Path(DEFAULT_OBSIDIAN_EXPORT_DIR).expanduser() if DEFAULT_OBSIDIAN_EXPORT_DIR else None)
            ),
        )
    except GeminiRequestError as exc:
        print(
            _format_gemini_failure(
                run_date=run_date,
                timezone_name=resolved_timezone,
                output_root=output_root,
                exc=exc,
            ),
            file=sys.stderr,
        )
        sys.exit(2)
    if args.json:
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    else:
        print(_format_cli_summary(manifest))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
