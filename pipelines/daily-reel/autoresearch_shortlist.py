"""Build a review-only social/story shortlist from autoresearch artifacts."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CANDIDATES = REPO_ROOT / "data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl"
DEFAULT_COLLECTION_RECORDS = (
    REPO_ROOT / "data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl"
)
DEFAULT_COLLECTIONS = REPO_ROOT / "data/mtl_archives/reports/autoresearch_collections/collections_downstream.jsonl"
DEFAULT_TAXONOMY = REPO_ROOT / "data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl"
DEFAULT_QUALITY = REPO_ROOT / "data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data/social/autoresearch_shortlist"
DEFAULT_LEDGER = REPO_ROOT / "data/social/publish-ledger.jsonl"

EXCLUSION_ACTIONS = {"exclude_until_fixed"}
QUALITY_PENALTIES = {
    "none": 0.0,
    "rotate": 0.12,
    "crop": 0.16,
    "lower_rank": 0.2,
    "review": 0.25,
    "exclude_until_fixed": 1.0,
}
CANDIDATE_BONUSES = {
    "social": 0.42,
    "rare_find": 0.24,
    "sequence": 0.2,
    "print": 0.1,
}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL in {path} on line {line_number}: {exc}") from exc
    return rows


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def _clean_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _clean_list(values: Any, *, limit: int | None = None) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned = []
    for value in values:
        text = _clean_string(value)
        if text and text not in cleaned:
            cleaned.append(text)
        if limit is not None and len(cleaned) >= limit:
            break
    return cleaned


def _score_value(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    if numeric > 1:
        return min(numeric / 10, 1.0)
    return max(0.0, min(numeric, 1.0))


def _display_title(record_id: str, *sources: dict[str, Any] | None) -> str:
    for source in sources:
        if not source:
            continue
        title = _clean_string(source.get("title"))
        if title:
            return title
    return record_id


def _display_field(field: str, *sources: dict[str, Any] | None) -> str:
    for source in sources:
        if not source:
            continue
        value = _clean_string(source.get(field))
        if value:
            return value
    return ""


def _build_collection_maps(
    collection_rows: list[dict[str, Any]], collection_record_rows: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    collections_by_id = {row["collection_id"]: row for row in collection_rows if row.get("collection_id")}
    records_by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in collection_record_rows:
        record_id = row.get("id")
        if not record_id:
            continue
        collection_id = row.get("collection_id")
        collection = collections_by_id.get(collection_id, {})
        enriched = dict(row)
        enriched["collection_title"] = row.get("collection_title") or collection.get("title") or collection_id
        enriched["collection_type"] = row.get("collection_type") or collection.get("collection_type") or ""
        enriched["collection_tags"] = collection.get("tags") or []
        records_by_id[record_id].append(enriched)
    return collections_by_id, records_by_id


def _quality_reason(quality: dict[str, Any] | None) -> tuple[str, bool, float]:
    if not quality:
        return "quality:unknown", False, 0.08
    action = _clean_string(quality.get("recommendedAction")) or "none"
    severity = _clean_string(quality.get("severity")) or "none"
    if action == "none" and severity in {"none", ""}:
        return "quality:pass", True, 0.0
    return f"quality:{action}", False, QUALITY_PENALTIES.get(action, 0.18)


def _aggregate_candidates(candidate_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for row in candidate_rows:
        record_id = row.get("id")
        if not record_id:
            continue
        entry = by_id.setdefault(
            record_id,
            {
                "id": record_id,
                "candidateTypes": set(),
                "candidateReasons": [],
                "candidateScore": 0.0,
                "sourceRows": [],
            },
        )
        candidate_type = _clean_string(row.get("candidate_type"))
        if candidate_type:
            entry["candidateTypes"].add(candidate_type)
        for reason in _clean_list(row.get("reasons")):
            if reason not in entry["candidateReasons"]:
                entry["candidateReasons"].append(reason)
        entry["candidateScore"] = max(entry["candidateScore"], _score_value(row.get("score")))
        entry["sourceRows"].append(row)
    return by_id


def _parse_date(value: Any) -> date | None:
    text = _clean_string(value)
    if not text:
        return None
    try:
        if "T" in text:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
        return date.fromisoformat(text)
    except ValueError:
        return None


def _recent_ledger_keys(ledger_rows: list[dict[str, Any]], *, cooldown_days: int, as_of: date) -> set[str]:
    if cooldown_days <= 0:
        return set()
    keys: set[str] = set()
    for row in ledger_rows:
        entry_date = _parse_date(row.get("date") or row.get("recorded_at"))
        if not entry_date:
            continue
        delta = (as_of - entry_date).days
        if delta < 0 or delta > cooldown_days:
            continue
        keys.update(
            {
                _clean_string(row.get("metadata_filename")),
                _clean_string(row.get("image_filename")),
            }
        )
    return {key for key in keys if key}


def _record_keys(record_id: str, *sources: dict[str, Any] | None) -> set[str]:
    keys = {record_id}
    for source in sources:
        if not source:
            continue
        keys.update(
            {
                _clean_string(source.get("id")),
                _clean_string(source.get("metadata_filename")),
                _clean_string(source.get("metadataFilename")),
                _clean_string(source.get("imagePath")),
                _clean_string(source.get("filename")),
                _clean_string(source.get("imageFilename")),
            }
        )
    return {key for key in keys if key}


def _make_shortlist(
    *,
    candidate_rows: list[dict[str, Any]],
    collection_rows: list[dict[str, Any]],
    collection_record_rows: list[dict[str, Any]],
    taxonomy_rows: list[dict[str, Any]],
    quality_rows: list[dict[str, Any]],
    ledger_rows: list[dict[str, Any]],
    limit: int,
    include_excluded: bool,
    include_recent: bool,
    cooldown_days: int,
    as_of: date,
    ledger_path: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    candidates_by_id = _aggregate_candidates(candidate_rows)
    collections_by_id, collection_records_by_id = _build_collection_maps(collection_rows, collection_record_rows)
    taxonomy_by_id = {row["id"]: row for row in taxonomy_rows if row.get("id")}
    quality_by_id = {row["id"]: row for row in quality_rows if row.get("id")}

    candidate_ids = set(candidates_by_id)
    candidate_ids.update(collection_records_by_id)
    recent_keys = set() if include_recent else _recent_ledger_keys(ledger_rows, cooldown_days=cooldown_days, as_of=as_of)

    rows: list[dict[str, Any]] = []
    excluded_count = 0
    recent_excluded_count = 0
    for record_id in sorted(candidate_ids):
        candidate = candidates_by_id.get(record_id, {})
        candidate_sources = candidate.get("sourceRows") or []
        primary_candidate = candidate_sources[0] if candidate_sources else None
        collections = sorted(
            collection_records_by_id.get(record_id, []),
            key=lambda row: float(row.get("matchScore") or row.get("score") or 0),
            reverse=True,
        )
        primary_collection = collections[0] if collections else None
        taxonomy = taxonomy_by_id.get(record_id)
        quality = quality_by_id.get(record_id)
        quality_code, quality_pass, quality_penalty = _quality_reason(quality)
        quality_action = _clean_string((quality or {}).get("recommendedAction")) or "unknown"
        taxonomy_excluded = bool((taxonomy or {}).get("excludeFromDefaultVisualSearch"))
        is_excluded = quality_action in EXCLUSION_ACTIONS or taxonomy_excluded
        if is_excluded and not include_excluded:
            excluded_count += 1
            continue
        record_keys = _record_keys(record_id, primary_candidate, primary_collection, taxonomy, quality)
        recent_matches = sorted(record_keys & recent_keys)
        if recent_matches and not include_recent:
            recent_excluded_count += 1
            continue

        candidate_types = sorted(candidate.get("candidateTypes") or [])
        social_tags = _clean_list((taxonomy or {}).get("socialTags"), limit=4)
        themes = _clean_list((taxonomy or {}).get("themes"), limit=4)
        collection_ids = [row["collection_id"] for row in collections if row.get("collection_id")]
        collection_ids = list(dict.fromkeys(collection_ids))
        collection_titles = [_clean_string(row.get("collection_title")) for row in collections if row.get("collection_title")]
        collection_titles = list(dict.fromkeys(collection_titles))

        reason_codes: list[str] = []
        for candidate_type in candidate_types:
            reason_codes.append(f"candidate:{candidate_type}")
        reason_codes.append(quality_code)
        for collection_id in collection_ids[:3]:
            reason_codes.append(f"collection:{collection_id}")
        for theme in themes[:3]:
            reason_codes.append(f"theme:{theme}")
        primary_category = _clean_string((taxonomy or {}).get("primaryCategory"))
        if primary_category:
            reason_codes.append(f"taxonomy:{primary_category}")
        if social_tags:
            reason_codes.extend(f"social_tag:{tag}" for tag in social_tags[:2])
        reason_codes = list(dict.fromkeys(reason_codes))

        candidate_bonus = sum(CANDIDATE_BONUSES.get(candidate_type, 0.05) for candidate_type in candidate_types)
        collection_bonus = min(0.28, 0.14 * len(collection_ids))
        theme_bonus = min(0.16, 0.04 * (len(themes) + len(social_tags)))
        quality_bonus = 0.16 if quality_pass else 0.0
        story_bonus = 0.08 if primary_category and primary_category != "uncertain" else 0.0
        score = (
            float(candidate.get("candidateScore") or 0.0)
            + candidate_bonus
            + collection_bonus
            + theme_bonus
            + quality_bonus
            + story_bonus
            - quality_penalty
            - (0.18 if taxonomy_excluded else 0.0)
        )

        rows.append(
            {
                "id": record_id,
                "title": _display_title(record_id, primary_candidate, primary_collection, taxonomy, quality),
                "date": _display_field("date", primary_candidate, primary_collection, taxonomy, quality),
                "cote": _display_field("cote", primary_candidate, primary_collection),
                "imageUrl": _display_field("imageUrl", primary_candidate, primary_collection, taxonomy, quality),
                "imagePath": _display_field("imagePath", primary_candidate, primary_collection, taxonomy, quality),
                "score": round(score, 4),
                "candidateScore": round(float(candidate.get("candidateScore") or 0.0), 4),
                "candidateTypes": candidate_types,
                "collectionIds": collection_ids,
                "collectionTitles": collection_titles,
                "primaryCategory": primary_category,
                "themes": themes,
                "socialTags": social_tags,
                "quality": {
                    "pass": quality_pass,
                    "recommendedAction": quality_action,
                    "severity": _clean_string((quality or {}).get("severity")) or "unknown",
                    "labels": _clean_list((quality or {}).get("labels")),
                },
                "reasonCodes": reason_codes,
                "candidateReasons": _clean_list(candidate.get("candidateReasons"), limit=6),
                "collectionReasons": _clean_list((primary_collection or {}).get("matchReasons"), limit=6),
                "vlmCaption": _display_field("vlmCaption", primary_candidate, primary_collection),
                "socialHook": _display_field("socialHook", primary_candidate, primary_collection),
                "recentLedgerMatches": recent_matches,
            }
        )

    rows.sort(key=lambda row: (-row["score"], row["id"]))
    selected_rows = rows[:limit]
    selected_ids = {row["id"] for row in selected_rows}
    sequence_candidate = next(
        (
            row
            for row in rows
            if row["id"] not in selected_ids
            and (
                "candidate:sequence" in row["reasonCodes"]
                or any(collection_id.startswith("sequence-") for collection_id in row["collectionIds"])
            )
        ),
        None,
    )
    if limit >= 5 and sequence_candidate and not any(
        "candidate:sequence" in row["reasonCodes"]
        or any(collection_id.startswith("sequence-") for collection_id in row["collectionIds"])
        for row in selected_rows
    ):
        pinned = dict(sequence_candidate)
        pinned["selectionNote"] = "diversity_pin:sequence"
        selected_rows = selected_rows[:-1] + [pinned]
        selected_rows.sort(key=lambda row: (-row["score"], row["id"]))

    selected = []
    for index, row in enumerate(selected_rows, start=1):
        item = dict(row)
        item["rank"] = index
        selected.append(item)

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "candidateRows": len(candidate_rows),
            "collectionRows": len(collection_rows),
            "collectionRecordRows": len(collection_record_rows),
            "taxonomyRows": len(taxonomy_rows),
            "qualityRows": len(quality_rows),
            "collectionsIndexed": len(collections_by_id),
        },
        "eligibleRecords": len(rows),
        "excludedRecords": excluded_count,
        "recentlyUsedExcludedRecords": recent_excluded_count,
        "selectedRecords": len(selected),
        "includeExcluded": include_excluded,
        "includeRecent": include_recent,
        "cooldownDays": cooldown_days,
        "ledgerPath": str(ledger_path),
        "asOf": as_of.isoformat(),
        "reasonCodeCounts": Counter(code for row in selected for code in row["reasonCodes"]),
        "candidateTypeCounts": Counter(candidate_type for row in selected for candidate_type in row["candidateTypes"]),
        "qualityActionCounts": Counter(row["quality"]["recommendedAction"] for row in selected),
        "collectionCoverage": Counter(collection_id for row in selected for collection_id in row["collectionIds"]),
    }
    return summary, selected


def _markdown_table(rows: list[dict[str, Any]]) -> str:
    lines = [
        "| Rank | Record | Score | Reasons | Quality | Collections |",
        "| ---: | --- | ---: | --- | --- | --- |",
    ]
    for row in rows:
        reasons = ", ".join(row["reasonCodes"][:6])
        collections = ", ".join(row["collectionTitles"][:2] or row["collectionIds"][:2])
        quality = row["quality"]["recommendedAction"]
        record = f"{row['id']}<br>{row['title']}"
        lines.append(f"| {row['rank']} | {record} | {row['score']:.4f} | {reasons} | {quality} | {collections} |")
    return "\n".join(lines)


def _write_markdown_report(path: Path, summary: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    reason_counts = dict(summary["reasonCodeCounts"].most_common(12))
    candidate_counts = dict(summary["candidateTypeCounts"].most_common())
    quality_counts = dict(summary["qualityActionCounts"].most_common())
    lines = [
        "# Autoresearch Social/Story Shortlist",
        "",
        "Review-only shortlist generated from autoresearch candidate, collection, taxonomy, and image-quality artifacts.",
        "",
        "## Summary",
        "",
        f"- Generated at: `{summary['generatedAt']}`",
        f"- Eligible records: `{summary['eligibleRecords']}`",
        f"- Excluded records: `{summary['excludedRecords']}`",
        f"- Recently used records excluded: `{summary['recentlyUsedExcludedRecords']}`",
        f"- Selected records: `{summary['selectedRecords']}`",
        f"- Include excluded: `{summary['includeExcluded']}`",
        f"- Include recent: `{summary['includeRecent']}`",
        f"- Cooldown days: `{summary['cooldownDays']}`",
        f"- Ledger path: `{summary['ledgerPath']}`",
        f"- Candidate types: `{json.dumps(candidate_counts, ensure_ascii=False)}`",
        f"- Quality actions: `{json.dumps(quality_counts, ensure_ascii=False)}`",
        f"- Top reason codes: `{json.dumps(reason_counts, ensure_ascii=False)}`",
        "",
        "## Shortlist",
        "",
        _markdown_table(rows),
        "",
        "## Operator Notes",
        "",
        "- This report does not publish, render, or modify daily package output.",
        "- Records with `exclude_until_fixed` or taxonomy visual-search exclusion are omitted unless `--include-excluded` is passed.",
        "- Records found in the recent generation ledger are omitted unless `--include-recent` is passed.",
        "- Use the reason codes to pick a record for the normal social pipeline with `npm run social:today -- --id <record-id>`.",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a review-only autoresearch shortlist for social/story selection.")
    parser.add_argument("--limit", type=int, default=20, help="Number of records to include in the shortlist.")
    parser.add_argument("--include-excluded", action="store_true", help="Include quality/taxonomy excluded records.")
    parser.add_argument("--include-recent", action="store_true", help="Include records seen in the recent generation ledger.")
    parser.add_argument("--cooldown-days", type=int, default=90, help="Recent-use cooldown window in days.")
    parser.add_argument("--as-of", help="Reference date for recent-use filtering in YYYY-MM-DD format.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for shortlist artifacts.")
    parser.add_argument("--ledger", default=str(DEFAULT_LEDGER), help="Generation ledger JSONL path.")
    parser.add_argument("--candidates", default=str(DEFAULT_CANDIDATES), help="Candidates JSONL path.")
    parser.add_argument("--collection-records", default=str(DEFAULT_COLLECTION_RECORDS), help="Collection records JSONL path.")
    parser.add_argument("--collections", default=str(DEFAULT_COLLECTIONS), help="Collections JSONL path.")
    parser.add_argument("--taxonomy", default=str(DEFAULT_TAXONOMY), help="Taxonomy JSONL path.")
    parser.add_argument("--quality", default=str(DEFAULT_QUALITY), help="Quality labels JSONL path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser()
    as_of = date.fromisoformat(args.as_of) if args.as_of else datetime.now().date()
    ledger_path = Path(args.ledger).expanduser()
    summary, rows = _make_shortlist(
        candidate_rows=_read_jsonl(Path(args.candidates).expanduser()),
        collection_rows=_read_jsonl(Path(args.collections).expanduser()),
        collection_record_rows=_read_jsonl(Path(args.collection_records).expanduser()),
        taxonomy_rows=_read_jsonl(Path(args.taxonomy).expanduser()),
        quality_rows=_read_jsonl(Path(args.quality).expanduser()),
        ledger_rows=_read_jsonl(ledger_path),
        limit=max(1, args.limit),
        include_excluded=args.include_excluded,
        include_recent=args.include_recent,
        cooldown_days=max(0, args.cooldown_days),
        as_of=as_of,
        ledger_path=ledger_path,
    )
    report = {"summary": summary, "shortlist": rows}
    _write_json(output_dir / "shortlist_report.json", report)
    _write_jsonl(output_dir / "shortlist.jsonl", rows)
    _write_markdown_report(output_dir / "shortlist_report.md", summary, rows)
    print(f"Wrote {len(rows)} shortlist records to {output_dir}")


if __name__ == "__main__":
    main()
