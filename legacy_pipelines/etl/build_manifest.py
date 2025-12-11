#!/usr/bin/env python3
"""Generate a manifest linking backup images, legacy metadata, and portal records."""

from __future__ import annotations

import json
import statistics
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib.parse import urlparse

BACKUP_IMAGE_DIR = Path("/Volumes/FREE SPACE/mtl_archives_photographs")
BACKUP_METADATA_DIR = Path("/Volumes/FREE SPACE/mtl_archives_photographs_metadata")
PORTAL_DATA_PATH = Path("data/mtl_archives/phototheque_datastore.json")

OUTPUT_DIR = Path("data/mtl_archives")
MANIFEST_PATH = OUTPUT_DIR / "manifest.jsonl"
SUMMARY_PATH = OUTPUT_DIR / "manifest_summary.json"


def load_portal_lookup(path: Path) -> Dict[str, Dict[str, Any]]:
  if not path.exists():
    return {}
  data = json.loads(path.read_text())
  records = data.get("result", {}).get("records", [])
  lookup: Dict[str, Dict[str, Any]] = {}
  for rec in records:
    for key in ("Fichier jpg - 200 dpi", "Fichier tif - 300 dpi"):
      url = str(rec.get(key, "")).strip()
      if url:
        lookup[url.lower()] = rec
  return lookup


@dataclass
class RecordStats:
  metadata_files: int = 0
  image_found: int = 0
  image_missing: int = 0
  zero_byte_images: int = 0
  portal_matched: int = 0
  portal_unmatched: int = 0
  name_present: int = 0
  description_present: int = 0
  date_present: int = 0
  domains: Counter[str] = field(default_factory=Counter)
  extensions: Counter[str] = field(default_factory=Counter)
  image_size_bytes: list[int] = field(default_factory=list)

  def to_dict(self) -> Dict[str, Any]:
    size_stats: Dict[str, Optional[float]]
    if self.image_size_bytes:
      size_stats = {
        "min": min(self.image_size_bytes),
        "max": max(self.image_size_bytes),
        "median": statistics.median(self.image_size_bytes),
        "mean": statistics.mean(self.image_size_bytes),
        "total": sum(self.image_size_bytes),
      }
    else:
      size_stats = {"min": None, "max": None, "median": None, "mean": None, "total": 0}
    return {
      "metadata_files": self.metadata_files,
      "image_found": self.image_found,
      "image_missing": self.image_missing,
      "zero_byte_images": self.zero_byte_images,
      "portal_matched": self.portal_matched,
      "portal_unmatched": self.portal_unmatched,
      "name_present": self.name_present,
      "description_present": self.description_present,
      "date_present": self.date_present,
      "domains": dict(self.domains.most_common()),
      "extensions": dict(self.extensions.most_common()),
      "image_size_bytes": size_stats,
    }


def iter_metadata_files(directory: Path) -> Iterable[Path]:
  return sorted(p for p in directory.iterdir() if p.is_file() and p.suffix == ".json")


def normalize_url(url: str) -> str:
  return url.strip().lower()


def extract_filename_from_ipfs(image_value: str) -> Optional[str]:
  if not image_value:
    return None
  parts = image_value.split("/")
  return parts[-1] if parts else None


def resolve_image_path(expected_filename: str) -> tuple[Optional[Path], Optional[str]]:
  if not expected_filename:
    return None, None
  candidate = BACKUP_IMAGE_DIR / expected_filename
  if candidate.exists():
    return candidate, candidate.name
  stem = Path(expected_filename).stem
  original_ext = Path(expected_filename).suffix.lower()
  alternate_names = []
  if original_ext == ".jpg":
    alternate_names.append(f"{stem}.jpeg")
  elif original_ext == ".jpeg":
    alternate_names.append(f"{stem}.jpg")
  alternate_names.extend([f"{stem}.tif", f"{stem}.tiff"])
  for alt_name in alternate_names:
    alt_path = BACKUP_IMAGE_DIR / alt_name
    if alt_path.exists():
      return alt_path, alt_name
  return None, None


def main() -> None:
  OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
  portal_lookup = load_portal_lookup(PORTAL_DATA_PATH)
  stats = RecordStats()

  with MANIFEST_PATH.open("w", encoding="utf-8") as manifest_file:
    for meta_path in iter_metadata_files(BACKUP_METADATA_DIR):
      stats.metadata_files += 1
      try:
        data = json.loads(meta_path.read_text())
      except json.JSONDecodeError:
        manifest_file.write(
          json.dumps({"metadata_filename": meta_path.name, "error": "json_decode_error"}, ensure_ascii=False)
          + "\n"
        )
        continue

      image_filename = extract_filename_from_ipfs(str(data.get("image", "")))
      image_path, resolved_name = resolve_image_path(image_filename) if image_filename else (None, None)
      image_exists = bool(image_path)
      size_bytes = image_path.stat().st_size if image_exists else None

      if image_exists:
        stats.image_found += 1
        stats.image_size_bytes.append(size_bytes or 0)
        if size_bytes == 0:
          stats.zero_byte_images += 1
      else:
        stats.image_missing += 1

      name_present = bool(data.get("name"))
      description_present = bool(data.get("description"))
      stats.name_present += int(name_present)
      stats.description_present += int(description_present)

      date_value = next((attr.get("value") for attr in data.get("attributes", []) if attr.get("trait_type") == "Date"), None)
      if date_value not in (None, "", "None"):
        stats.date_present += 1

      external_url = str(data.get("external_url", "")).strip()
      parsed = urlparse(external_url) if external_url else None
      if parsed and parsed.netloc:
        stats.domains[parsed.netloc] += 1
        parts = [part for part in parsed.path.split("/") if part]
        if parts:
          suffix = parts[-1]
          if "." in suffix:
            stats.extensions[suffix.split(".")[-1].lower()] += 1
          else:
            stats.extensions["noext"] += 1
        else:
          stats.extensions["noext"] += 1

      portal_record = portal_lookup.get(normalize_url(external_url))
      if portal_record:
        stats.portal_matched += 1
      else:
        stats.portal_unmatched += 1

      manifest_entry = {
        "metadata_filename": meta_path.name,
        "image_filename": image_filename,
        "image_exists": image_exists,
        "image_size_bytes": size_bytes,
        "resolved_image_filename": resolved_name,
        "name": data.get("name"),
        "description": data.get("description"),
        "attributes": data.get("attributes", []),
        "external_url": external_url,
        "portal_match": bool(portal_record),
        "portal_record": portal_record,
      }
      manifest_file.write(json.dumps(manifest_entry, ensure_ascii=False) + "\n")

  SUMMARY_PATH.write_text(json.dumps(stats.to_dict(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
  main()
