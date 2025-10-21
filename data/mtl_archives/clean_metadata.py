#!/usr/bin/env python3
"""Clean and normalize manifest metadata for downstream ingestion."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple

from audit_metadata_quality import heuristic_language_guess, detect_language_label  # type: ignore

DEFAULT_INPUT = Path("data/mtl_archives/manifest_enriched.jsonl")
DEFAULT_OUTPUT = Path("data/mtl_archives/manifest_clean.jsonl")
DEFAULT_SUMMARY = Path("data/mtl_archives/manifest_clean_summary.json")

ABBREVIATION_MAP = {
  "s/o": "Sans objet (aucune description fournie).",
  "sans objet": "Sans objet (aucune description fournie).",
  "n/d": "Donnée manquante (aucune description disponible).",
  "n.a.": "Information non disponible.",
  "n/a": "Information non disponible.",
}


def clean_text(value: Any) -> str:
  if value is None:
    return ""
  text = str(value)
  text = unicodedata.normalize("NFC", text)
  text = text.replace("\u2019", "'").replace("\u2013", "-").replace("\u2014", "-")
  text = re.sub(r"\s+", " ", text)
  return text.strip()


def expand_abbreviation(text: str) -> Tuple[str, bool]:
  key = text.lower()
  if key in ABBREVIATION_MAP:
    return ABBREVIATION_MAP[key], True
  return text, False


def merge_descriptions(primary: str, secondary: str) -> Tuple[str, str]:
  cleaned_primary = clean_text(primary)
  cleaned_secondary = clean_text(secondary)
  if cleaned_primary:
    expanded, changed = expand_abbreviation(cleaned_primary)
    if changed:
      return expanded, "expanded-abbreviation"
    return cleaned_primary, "original"
  if cleaned_secondary:
    expanded, changed = expand_abbreviation(cleaned_secondary)
    if changed:
      return expanded, "portal-expanded"
    return cleaned_secondary, "portal"
  return "", "missing"


def build_synthetic_description(record: Dict[str, Any]) -> str:
  name = clean_text(record.get("name"))
  attributes = record.get("attributes", [])
  attr_map = {attr.get("trait_type"): attr.get("value") for attr in attributes if isinstance(attr, dict)}
  date_value = clean_text(attr_map.get("Date"))
  cote_value = clean_text(attr_map.get("Cote"))
  portal = record.get("portal_record") or {}
  location_hint = clean_text(portal.get("Lieu"))

  fragments = []
  if name:
    fragments.append(name.rstrip('.') + '.')
  else:
    fragments.append("Photographie d'archive de Montréal.")
  if date_value:
    fragments.append(f"Capturée ou datée de {date_value}.")
  if location_hint:
    fragments.append(f"Localisation: {location_hint}.")
  if cote_value:
    fragments.append(f"Cote archivistique {cote_value}.")

  if not fragments or len(" ".join(fragments)) < 48:
    extra = clean_text(portal.get("Description"))
    if extra and extra not in fragments:
      fragments.append(extra.rstrip('.') + '.')

  composed = " ".join(fragments).strip()
  if len(composed) < 50:
    composed += " Détails supplémentaires non disponibles; description générée automatiquement."
  return composed


def enrich_record(record: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
  cleaned = dict(record)
  cleaned.setdefault("metadata_schema_version", 1)

  attributes = cleaned.get("attributes", [])
  attr_map = {attr.get("trait_type"): attr.get("value") for attr in attributes if isinstance(attr, dict)}
  cleaned["attributes_map"] = {key: clean_text(value) for key, value in attr_map.items() if value}

  portal_record = dict(cleaned.get("portal_record") or {})
  for key in ("Titre", "Description", "Date", "Cote", "Mention de crédits", "Lieu"):
    if key in portal_record:
      portal_record[key] = clean_text(portal_record.get(key))
  cleaned["portal_record"] = portal_record

  cleaned["name"] = clean_text(cleaned.get("name"))

  raw_description = clean_text(cleaned.get("description"))
  portal_description = portal_record.get("Description", "")

  description_value, description_source = merge_descriptions(raw_description, portal_description)
  synthetic_used = False
  if not description_value:
    description_value = build_synthetic_description(cleaned)
    description_source = "synthetic"
    synthetic_used = True
  elif len(description_value) < 50:
    synthetic_append = build_synthetic_description(cleaned)
    if synthetic_append and synthetic_append.lower() not in description_value.lower():
      description_value = f"{description_value} {synthetic_append}".strip()
      description_source = f"{description_source}+synthetic"
      synthetic_used = True

  cleaned["raw_description"] = record.get("description")
  cleaned["description"] = description_value
  cleaned["description_source"] = description_source
  language = detect_language_label(description_value)
  if language == "unknown":
    language = heuristic_language_guess(description_value)
  cleaned["description_language"] = language or "unknown"

  cleaned["portal_description_clean"] = portal_description

  credits = clean_text(cleaned.get("credits") or portal_record.get("Mention de crédits"))
  cleaned["credits"] = credits

  normalized_cote = clean_text(attr_map.get("Cote")) or clean_text(portal_record.get("Cote"))
  cleaned["cote"] = normalized_cote

  quality_flags = []
  if synthetic_used:
    quality_flags.append("synthetic-description")
  if len(description_value) < 50:
    quality_flags.append("short-description")
  if description_value.upper() == description_value and description_value:
    quality_flags.append("uppercase-description")

  cleaned["metadata_quality"] = {
    "description_source": description_source,
    "quality_flags": quality_flags,
  }

  return cleaned, {
    "description_source": description_source,
    "synthetic_used": synthetic_used,
    "quality_flags": quality_flags,
  }


def iterate_records(path: Path) -> Iterable[Dict[str, Any]]:
  with path.open(encoding="utf-8") as handle:
    for line in handle:
      line = line.strip()
      if not line:
        continue
      yield json.loads(line)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to manifest_enriched.jsonl")
  parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Destination path for cleaned manifest")
  parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY, help="Summary JSON path")
  args = parser.parse_args()

  input_path = args.input
  if not input_path.exists():
    raise SystemExit(f"Input manifest not found: {input_path}")

  output_path = args.output
  output_path.parent.mkdir(parents=True, exist_ok=True)

  summary = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "input_path": str(input_path),
    "output_path": str(output_path),
    "total_records": 0,
    "description_source_counts": Counter(),
    "quality_flag_counts": Counter(),
  }

  with output_path.open("w", encoding="utf-8") as output_file:
    for record in iterate_records(input_path):
      cleaned, quality = enrich_record(record)
      summary["total_records"] += 1
      summary["description_source_counts"].update([quality["description_source"]])
      summary["quality_flag_counts"].update(quality["quality_flags"])
      output_file.write(json.dumps(cleaned, ensure_ascii=False) + "\n")

  summary_path = args.summary
  summary_dump = {
    "generated_at": summary["generated_at"],
    "input_path": summary["input_path"],
    "output_path": summary["output_path"],
    "total_records": summary["total_records"],
    "description_source_counts": dict(summary["description_source_counts"]),
    "quality_flag_counts": dict(summary["quality_flag_counts"]),
  }
  summary_path.write_text(json.dumps(summary_dump, indent=2, ensure_ascii=False), encoding="utf-8")

  print(f"Wrote cleaned manifest to {output_path}")


if __name__ == "__main__":
  main()
