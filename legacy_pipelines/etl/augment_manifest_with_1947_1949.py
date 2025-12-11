#!/usr/bin/env python3
"""Join manifest entries with the 1947-1949 aerial dataset."""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Any

MANIFEST_PATH = Path("data/mtl_archives/manifest.jsonl")
AERIAL_JSON_PATH = Path("data/mtl_archives/vues_aeriennes_1947_1949.json")
OUTPUT_PATH = Path("data/mtl_archives/manifest_1947_1949_matches.jsonl")
SUMMARY_PATH = Path("data/mtl_archives/manifest_1947_1949_summary.json")


def normalize_url(url: str) -> str:
  return url.strip().lower()


@dataclass
class Summary:
  aerial_records: int = 0
  manifest_records: int = 0
  matched_records: int = 0
  unmatched_records: int = 0
  unmatched_archivesdemontreal: int = 0

  def to_dict(self) -> Dict[str, Any]:
    return asdict(self)


def main() -> None:
  aerial_data = json.loads(AERIAL_JSON_PATH.read_text())
  aerial_records = aerial_data.get("result", {}).get("records", [])
  aerial_lookup = {}
  for rec in aerial_records:
    url = normalize_url(str(rec.get("Fichier jpg - 300 dpi (CLIQUEZ SUR LE LIEN)", "")))
    if url:
      aerial_lookup[url] = rec

  summary = Summary(aerial_records=len(aerial_lookup))

  with OUTPUT_PATH.open("w", encoding="utf-8") as out_file, MANIFEST_PATH.open() as manifest_file:
    for line in manifest_file:
      summary.manifest_records += 1
      entry = json.loads(line)
      url = normalize_url(entry.get("external_url", ""))
      match = aerial_lookup.get(url)
      if match:
        summary.matched_records += 1
        merged = dict(entry)
        merged["aerial_1947_1949_record"] = match
        out_file.write(json.dumps(merged, ensure_ascii=False) + "\n")
      else:
        summary.unmatched_records += 1
        if "archivesdemontreal.com" in url:
          summary.unmatched_archivesdemontreal += 1

  SUMMARY_PATH.write_text(json.dumps(summary.to_dict(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
  main()
