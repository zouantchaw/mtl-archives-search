#!/usr/bin/env python3
"""Enrich the manifest with multiple Montréal aerial datasets."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List

MANIFEST_PATH = Path("data/mtl_archives/manifest.jsonl")
OUTPUT_PATH = Path("data/mtl_archives/manifest_enriched.jsonl")
SUMMARY_PATH = Path("data/mtl_archives/manifest_enriched_summary.json")


@dataclass
class DatasetConfig:
  label: str
  path: Path
  url_fields: List[str]


DATASETS: Iterable[DatasetConfig] = [
  DatasetConfig("aerial_1925_1935", Path("data/mtl_archives/vues_aeriennes_1925_1935.json"), ["Fichier tiff - 600 dpi"]),
  DatasetConfig("aerial_1947_1949", Path("data/mtl_archives/vues_aeriennes_1947_1949.json"), ["Fichier jpg - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1958", Path("data/mtl_archives/vues_aeriennes_1958.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1962", Path("data/mtl_archives/vues_aeriennes_1962.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1964", Path("data/mtl_archives/vues_aeriennes_1964.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1966", Path("data/mtl_archives/vues_aeriennes_1966.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1969", Path("data/mtl_archives/vues_aeriennes_1969.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1971", Path("data/mtl_archives/vues_aeriennes_1971.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1973", Path("data/mtl_archives/vues_aeriennes_1973.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig("aerial_1975", Path("data/mtl_archives/vues_aeriennes_1975.json"), ["Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"]),
  DatasetConfig(
      "aerial_obliques_1960_1992",
      Path("data/mtl_archives/vues_aeriennes_obliques_1960_1992.json"),
      ["Fichiers TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)", "Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)"],
  ),
]


def normalize_url(url: str) -> str:
  return url.strip().lower()


def extract_urls(record: Dict[str, Any], fields: Iterable[str]) -> List[str]:
  urls: List[str] = []
  for field in fields:
    value = record.get(field)
    if not value:
      continue
    if isinstance(value, str):
      text = value.replace("\r", "\n")
      for chunk in text.splitlines():
        candidate = chunk.strip()
        if candidate:
          urls.append(candidate)
    elif isinstance(value, list):
      for item in value:
        if isinstance(item, str) and item.strip():
          urls.append(item.strip())
  return urls


def load_dataset(config: DatasetConfig) -> Dict[str, Dict[str, Any]]:
  if not config.path.exists():
    return {}
  data = json.loads(config.path.read_text())
  records = data.get("result", {}).get("records", [])
  mapping: Dict[str, Dict[str, Any]] = {}
  for rec in records:
    for url in extract_urls(rec, config.url_fields):
      normalized = normalize_url(url)
      if normalized:
        mapping[normalized] = {"dataset": config.label, "record": rec}
  return mapping


def main() -> None:
  lookup: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
  dataset_counts = Counter()
  total_dataset_entries = Counter()

  for config in DATASETS:
    dataset_map = load_dataset(config)
    for url, payload in dataset_map.items():
      lookup[url].append(payload)
      total_dataset_entries[config.label] += 1

  manifest_records = 0
  matched_records = 0
  unmatched_records = 0

  with OUTPUT_PATH.open("w", encoding="utf-8") as output, MANIFEST_PATH.open() as manifest:
    for line in manifest:
      manifest_records += 1
      entry = json.loads(line)
      url = normalize_url(entry.get("external_url", ""))
      matches = lookup.get(url, [])
      if matches:
        matched_records += 1
        for match in matches:
          dataset_counts[match["dataset"]] += 1
      else:
        unmatched_records += 1
      entry["aerial_matches"] = matches
      output.write(json.dumps(entry, ensure_ascii=False) + "\n")

  summary = {
    "manifest_records": manifest_records,
    "matched_records": matched_records,
    "unmatched_records": unmatched_records,
    "dataset_match_counts": dict(dataset_counts.most_common()),
    "dataset_entry_counts": dict(total_dataset_entries.most_common()),
  }

  SUMMARY_PATH.write_text(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
  main()
