#!/usr/bin/env python3
"""Produce ML- and web-friendly exports from the enriched manifest."""

from __future__ import annotations

import json
from pathlib import Path

try:
  import pyarrow as pa  # type: ignore
  import pyarrow.parquet as pq  # type: ignore
except Exception as exc:  # pylint: disable=broad-except
  pa = None  # type: ignore
  pq = None  # type: ignore
  PARQUET_ERROR = str(exc)
else:
  PARQUET_ERROR = ""

DEFAULT_INPUTS = (
  Path("data/mtl_archives/manifest_clean.jsonl"),
  Path("data/mtl_archives/manifest_enriched.jsonl"),
)
EXPORT_DIR = Path("data/mtl_archives/export")
PARQUET_PATH = EXPORT_DIR / "manifest_enriched.parquet"
NDJSON_PATH = EXPORT_DIR / "manifest_enriched.ndjson"
SUMMARY_PATH = EXPORT_DIR / "export_summary.json"


def resolve_input_path() -> Path:
  for candidate in DEFAULT_INPUTS:
    if candidate.exists():
      return candidate
  raise FileNotFoundError(
    "No manifest found. Run data/mtl_archives/clean_metadata.py or ensure manifest_enriched.jsonl exists."
  )


def main() -> None:
  EXPORT_DIR.mkdir(parents=True, exist_ok=True)
  records = []
  input_path = resolve_input_path()
  with input_path.open() as f:
    for line in f:
      record = json.loads(line)
      record["aerial_dataset_labels"] = [m["dataset"] for m in record.get("aerial_matches", [])]
      records.append(record)
  flat_rows = []
  for record in records:
    attr_map = {attr.get("trait_type"): attr.get("value") for attr in record.get("attributes", [])}
    portal_rec = record.get("portal_record") or {}
    flat_rows.append({
      "metadata_filename": record.get("metadata_filename") or record.get("metadataFilename"),
      "image_filename": record.get("image_filename"),
      "resolved_image_filename": record.get("resolved_image_filename") or record.get("image_filename"),
      "image_size_bytes": record.get("image_size_bytes") or 0,
      "name": record.get("name") or "",
      "description": record.get("description") or "",
      "date_value": "" if attr_map.get("Date") in (None, "", "None") else str(attr_map.get("Date")),
      "credits": "" if attr_map.get("Credits") in (None, "") else str(attr_map.get("Credits")),
      "cote": "" if attr_map.get("Cote") in (None, "") else str(attr_map.get("Cote")),
      "external_url": record.get("external_url"),
      "portal_match": bool(record.get("portal_match")),
      "portal_title": portal_rec.get("Titre") or portal_rec.get("title") or "",
      "portal_description": portal_rec.get("Description") or portal_rec.get("description") or "",
      "portal_date": portal_rec.get("Date") or portal_rec.get("date") or "",
      "portal_cote": portal_rec.get("Cote") or portal_rec.get("cote") or "",
      "aerial_datasets": record.get("aerial_dataset_labels", []),
    })
  if pa is not None and pq is not None:
    table = pa.Table.from_pylist(flat_rows)
    pq.write_table(table, PARQUET_PATH)
    with NDJSON_PATH.open("w", encoding="utf-8") as ndjson_file:
      for row in flat_rows:
        ndjson_file.write(json.dumps(row, ensure_ascii=False) + "\n")
    summary = {
      "rows": table.num_rows,
      "columns": table.schema.names,
      "parquet_path": str(PARQUET_PATH),
      "ndjson_path": str(NDJSON_PATH),
      "parquet_status": "written (pyarrow)",
    }
  else:
    with NDJSON_PATH.open("w", encoding="utf-8") as ndjson_file:
      for row in flat_rows:
        ndjson_file.write(json.dumps(row, ensure_ascii=False) + "\n")
    summary = {
      "rows": len(records),
      "columns": list(records[0].keys()) if records else [],
      "parquet_path": None,
      "ndjson_path": str(NDJSON_PATH),
      "parquet_status": f"skipped (pyarrow error: {PARQUET_ERROR or 'n/a'})",
    }
  summary["input_path"] = str(input_path)
  SUMMARY_PATH.write_text(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
  main()
