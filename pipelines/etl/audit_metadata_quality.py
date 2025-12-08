#!/usr/bin/env python3
"""Audit metadata completeness and quality metrics for manifest records."""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

try:
  from langdetect import DetectorFactory, LangDetectException, detect  # type: ignore

  DetectorFactory.seed = 0
except Exception:  # pragma: no cover - optional dependency
  detect = None  # type: ignore
  LangDetectException = Exception  # type: ignore


DEFAULT_INPUTS: Sequence[Path] = (
  Path("data/mtl_archives/manifest_clean.jsonl"),
  Path("data/mtl_archives/manifest_enriched.jsonl"),
)
DEFAULT_REPORT_DIR = Path("data/mtl_archives/reports")

FIELD_PATHS: Dict[str, List[Sequence[str]]] = {
  "name": [("name",)],
  "description": [("description",)],
  "portal_description": [("portalDescription",), ("portal_description",), ("portal_record", "Description")],
  "portal_title": [("portalTitle",), ("portal_title",), ("portal_record", "Titre")],
  "portal_date": [("portalDate",), ("portal_date",), ("portal_record", "Date")],
  "portal_cote": [("portalCote",), ("portal_cote",), ("portal_record", "Cote")],
  "credits": [("credits",), ("portal_record", "Mention de crédits")],
  "cote": [("cote",), ("attributes_map", "Cote")],
}

LANGUAGE_MIN_LENGTH = 24
SHORT_DESCRIPTION_THRESHOLD = 25
LONG_DESCRIPTION_THRESHOLD = 512
SAMPLE_LIMIT = 25


@dataclass
class FieldStats:
  total: int = 0
  present: int = 0
  non_empty: int = 0
  empty: int = 0
  missing: int = 0

  lengths: List[int] | None = None

  def add(self, value: Any) -> None:
    self.total += 1
    if value is None:
      self.missing += 1
      return
    self.present += 1
    if isinstance(value, str):
      stripped = value.strip()
      if stripped:
        self.non_empty += 1
        if self.lengths is not None:
          self.lengths.append(len(stripped))
      else:
        self.empty += 1
    elif isinstance(value, (list, tuple)):
      if value:
        self.non_empty += 1
      else:
        self.empty += 1
    else:
      self.non_empty += 1

  def to_dict(self) -> Dict[str, Any]:
    return {
      "total": self.total,
      "present": self.present,
      "non_empty": self.non_empty,
      "empty": self.empty,
      "missing": self.missing,
      "percent_present": percentage(self.present, self.total),
      "percent_non_empty": percentage(self.non_empty, self.total),
      "length_summary": summarize_lengths(self.lengths or []),
    }


def percentage(value: int, total: int) -> float:
  if total <= 0:
    return 0.0
  return round((value / total) * 100, 2)


def summarize_lengths(lengths: Iterable[int]) -> Optional[Dict[str, float]]:
  data = list(lengths)
  if not data:
    return None
  data.sort()
  median = statistics.median(data)
  mean = statistics.mean(data)
  return {
    "min": float(data[0]),
    "max": float(data[-1]),
    "mean": round(mean, 2),
    "median": round(median, 2),
    "p90": float(data[math.floor(0.90 * (len(data) - 1))]),
  }


def load_records(path: Path) -> Iterator[Dict[str, Any]]:
  with path.open(encoding="utf-8") as input_file:
    for line_number, line in enumerate(input_file, start=1):
      line = line.strip()
      if not line:
        continue
      try:
        record = json.loads(line)
      except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse JSON on line {line_number}: {exc}") from exc
      yield record


def resolve_field(record: Dict[str, Any], field: str) -> Any:
  paths = FIELD_PATHS.get(field, [(field,)])
  for path in paths:
    value: Any = record
    for key in path:
      if isinstance(value, dict):
        value = value.get(key)
      else:
        value = None
      if value is None:
        break
    if value is not None:
      return value
  return None


def normalize_text(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


def detect_language_label(value: str) -> str:
  if not value or len(value) < LANGUAGE_MIN_LENGTH:
    return "unknown"
  if detect is None:
    return heuristic_language_guess(value)
  try:
    label = detect(value)
  except LangDetectException:  # type: ignore
    return "unknown"
  return label


def heuristic_language_guess(value: str) -> str:
  lower = value.lower()
  french_markers = sum(lower.count(marker) for marker in ("é", "è", "à", "ç", " qué", " montréal"))
  english_markers = sum(lower.count(marker) for marker in ("the ", " and ", "street", " avenue", "montreal"))
  if french_markers > english_markers and french_markers >= 1:
    return "fr"
  if english_markers > french_markers and english_markers >= 1:
    return "en"
  return "unknown"


def export_coverage_csv(path: Path, coverage: Dict[str, FieldStats]) -> None:
  with path.open("w", encoding="utf-8", newline="") as csv_file:
    writer = csv.writer(csv_file)
    writer.writerow(["field", "total", "present", "non_empty", "empty", "missing", "percent_present", "percent_non_empty"])
    for field, stats in coverage.items():
      stats_dict = stats.to_dict()
      writer.writerow([
        field,
        stats_dict["total"],
        stats_dict["present"],
        stats_dict["non_empty"],
        stats_dict["empty"],
        stats_dict["missing"],
        stats_dict["percent_present"],
        stats_dict["percent_non_empty"],
      ])


def render_markdown(report_path: Path, summary: Dict[str, Any]) -> None:
  lines = [
    "# Metadata Quality Report",
    "",
    f"- **Generated at:** {summary['generated_at']}",
    f"- **Input file:** `{summary['input_path']}`",
    f"- **Total records:** {summary['total_records']}",
    "",
    "## Field Coverage",
    "",
    "| Field | Present % | Non-empty % | Missing | Empty |",
    "| --- | --- | --- | --- | --- |",
  ]

  for field, stats in summary["field_coverage"].items():
    lines.append(
      f"| `{field}` | {stats['percent_present']}% | {stats['percent_non_empty']}% | {stats['missing']} | {stats['empty']} |"
    )

  def add_length_section(label: str, stats_key: str) -> None:
    stats = summary.get(stats_key)
    if not stats:
      return
    lines.extend(["", f"## {label}", ""])
    lines.extend([
      f"- **Average length:** {stats['mean']} characters",
      f"- **Median length:** {stats['median']} characters",
      f"- **Min length:** {stats['min']} characters",
      f"- **Max length:** {stats['max']} characters",
      f"- **P90 length:** {stats['p90']} characters",
    ])

  add_length_section("Description Length", "description_lengths")
  add_length_section("Portal Description Length", "portal_description_lengths")

  lines.extend(["", "## Language Distribution", "", "| Field | Label | Count |", "| --- | --- | --- |"])
  for field, counts in summary.get("language_distribution", {}).items():
    for label, count in counts.items():
      lines.append(f"| `{field}` | {label} | {count} |")

  lines.extend(["", "## Issue Summary", "", "| Issue | Count |", "| --- | --- |"])
  for issue, count in summary.get("issues", {}).items():
    lines.append(f"| {issue} | {count} |")

  lines.append("")
  lines.append("## Samples")
  lines.append("")
  for issue, samples in summary.get("issue_samples", {}).items():
    lines.append(f"### {issue}")
    lines.append("")
    if not samples:
      lines.append("(no samples recorded)\n")
      continue
    for sample in samples:
      lines.append(f"- `{sample['metadata_filename']}` — {sample['preview']}")
    lines.append("")

  report_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--input", type=Path, help="Path to manifest JSONL file")
  parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR, help="Directory to store generated reports")
  parser.add_argument("--issue-output", type=Path, help="Optional path for detailed issue NDJSON output")
  args = parser.parse_args()

  input_path = args.input
  if input_path is None:
    for candidate in DEFAULT_INPUTS:
      if candidate.exists():
        input_path = candidate
        break
  if input_path is None:
    raise SystemExit("No manifest input file found. Provide --input or ensure manifest_clean.jsonl exists.")
  if not input_path.exists():
    raise SystemExit(f"Input file not found: {input_path}")

  report_dir = args.report_dir
  report_dir.mkdir(parents=True, exist_ok=True)
  issue_output_path = args.issue_output or report_dir / "metadata_quality_issues.ndjson"

  coverage: Dict[str, FieldStats] = {}
  for field in FIELD_PATHS:
    coverage[field] = FieldStats(lengths=[])
  coverage["name"].lengths = []
  coverage["description"].lengths = []
  coverage["portal_description"].lengths = []

  language_counts: Dict[str, Counter[str]] = defaultdict(Counter)
  duplicates: Dict[str, List[str]] = defaultdict(list)
  issues = Counter()
  issue_samples: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

  detailed_issue_file = issue_output_path.open("w", encoding="utf-8")

  def record_issue(issue_key: str, metadata_filename: str, payload: Dict[str, Any]) -> None:
    issues[issue_key] += 1
    payload["issue"] = issue_key
    payload["metadata_filename"] = metadata_filename
    detailed_issue_file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    samples = issue_samples[issue_key]
    if len(samples) < SAMPLE_LIMIT:
      samples.append({
        "metadata_filename": metadata_filename,
        "preview": payload.get("preview") or payload.get("value", ""),
      })

  records = list(load_records(input_path))
  total_records = len(records)

  for record in records:
    metadata_filename = str(record.get("metadata_filename") or record.get("metadataFilename") or "")
    description = normalize_text(resolve_field(record, "description"))
    portal_description = normalize_text(resolve_field(record, "portal_description"))

    for field in coverage:
      value = resolve_field(record, field)
      coverage[field].add(value)

    if description:
      normalized = " ".join(description.lower().split())
      duplicates[normalized].append(metadata_filename)
      if len(description) < SHORT_DESCRIPTION_THRESHOLD:
        record_issue(
          "short_description",
          metadata_filename,
          {"value": description, "length": len(description)},
        )
      if len(description) > LONG_DESCRIPTION_THRESHOLD:
        record_issue(
          "long_description",
          metadata_filename,
          {"value": description[:200] + "...", "length": len(description)},
        )
    else:
      record_issue(
        "missing_description",
        metadata_filename,
        {"value": description, "preview": "(missing)"},
      )

    if not portal_description:
      record_issue(
        "missing_portal_description",
        metadata_filename,
        {"preview": "(missing)"},
      )

    language_label = detect_language_label(description)
    if language_label:
      language_counts["description"][language_label] += 1
    portal_language_label = detect_language_label(portal_description)
    if portal_language_label:
      language_counts["portal_description"][portal_language_label] += 1

    if description and description.isupper():
      record_issue(
        "uppercase_description",
        metadata_filename,
        {"value": description[:120] + ("..." if len(description) > 120 else "")},
      )

  for text, filenames in duplicates.items():
    if text and len(filenames) > 1:
      preview = text[:120] + ("..." if len(text) > 120 else "")
      deduped = list(dict.fromkeys(filenames))
      for filename in deduped:
        record_issue(
          "duplicate_description",
          filename,
          {"preview": preview, "duplicates": deduped},
        )

  detailed_issue_file.close()

  report = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "input_path": str(input_path),
    "total_records": total_records,
    "field_coverage": {field: stats.to_dict() for field, stats in coverage.items()},
    "description_lengths": coverage["description"].to_dict().get("length_summary"),
    "portal_description_lengths": coverage["portal_description"].to_dict().get("length_summary"),
    "language_distribution": {
      field: dict(counter) for field, counter in language_counts.items()
    },
    "issues": dict(issues),
    "issue_samples": {issue: samples for issue, samples in issue_samples.items()},
    "issue_output_path": str(issue_output_path),
  }

  json_path = report_dir / "metadata_quality_report.json"
  json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

  markdown_path = report_dir / "metadata_quality_report.md"
  render_markdown(markdown_path, report)

  coverage_csv_path = report_dir / "metadata_coverage_summary.csv"
  export_coverage_csv(coverage_csv_path, coverage)

  print(f"Wrote metadata quality reports to {report_dir}")


if __name__ == "__main__":
  main()
