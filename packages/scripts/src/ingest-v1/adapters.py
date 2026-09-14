"""Adapter-specific mapping only. Shared pipeline never reads source-native keys."""

import json
from pathlib import Path

from core import digest, record_id


class SourceAdapter:
    name = "base"

    def list_records(self, source_dir):
        raise NotImplementedError


def _read_jsonl(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


class MtlAdapter(SourceAdapter):
    """Maps the existing MTL canonical manifest fields into shared SourceRecords."""

    name = "mtl"

    def list_records(self, source_dir):
        source_dir = Path(source_dir)
        manifest = source_dir / "records.jsonl"
        images = source_dir / "images"
        rows = []
        for raw in _read_jsonl(manifest):
            image_name = raw.get("resolved_image_filename") or raw.get("image_filename")
            image_path = images / image_name if image_name else None
            media = image_path.read_bytes() if image_path and image_path.is_file() else b""
            source_record_id = raw.get("metadata_filename") or raw.get("identity")
            rows.append(
                {
                    "id": record_id(self.name, source_record_id),
                    "adapter": self.name,
                    "source_record_id": source_record_id,
                    "cote": raw.get("cote") or raw.get("portalCote"),
                    "media_sha256": digest(media) if media else digest(source_record_id),
                    "media": media,
                    "canonical": {
                        "description": raw.get("description") or raw.get("portalDescription"),
                        "title": raw.get("name") or raw.get("portalTitle"),
                        "date": raw.get("date_value") or raw.get("dateValue"),
                        "attribution": raw.get("attribution")
                        or (raw.get("rights") or {}).get("attribution"),
                    },
                    "source": {
                        "path": str(image_path) if image_path else None,
                        "image_filename": image_name,
                    },
                }
            )
        return rows


class OtherAdapter(SourceAdapter):
    """Second-source shape for adapter isolation tests; not MTL."""

    name = "other"

    def list_records(self, source_dir):
        rows = []
        for raw in _read_jsonl(Path(source_dir) / "records.jsonl"):
            media = str(raw["body"]).encode()
            rows.append(
                {
                    "id": record_id(self.name, raw["id"]),
                    "adapter": self.name,
                    "source_record_id": raw["id"],
                    "cote": raw.get("cote"),
                    "media_sha256": digest(media),
                    "media": media,
                    "canonical": {"description": raw.get("description")},
                    "source": {"path": None},
                }
            )
        return rows


class SecondAdapter(SourceAdapter):
    """Small non-MTL collection (item_id / caption / license / file)."""

    name = "second"
    ALLOWED_FILES = frozenset({"records.jsonl"})
    UNTRUSTED = frozenset(
        {"agent_permissions", "instructions", "grant", "policy", "orchestrator"}
    )

    def list_records(self, source_dir):
        source_dir = Path(source_dir).resolve()
        manifest = source_dir / "records.jsonl"
        if manifest.name not in self.ALLOWED_FILES:
            raise ValueError("source file")
        images = source_dir / "images"
        rows = []
        for raw in _read_jsonl(manifest):
            raw = {k: v for k, v in raw.items() if k not in self.UNTRUSTED}
            file_name = raw.get("file")
            if file_name:
                image_path = (images / Path(file_name).name).resolve()
                if images not in image_path.parents and image_path.parent != images:
                    raise ValueError("path escape")
                if not str(image_path).startswith(str(images)):
                    raise ValueError("path escape")
            else:
                image_path = None
            media = image_path.read_bytes() if image_path and image_path.is_file() else b""
            source_record_id = raw.get("item_id")
            rows.append(
                {
                    "id": record_id(self.name, source_record_id),
                    "adapter": self.name,
                    "source_record_id": source_record_id,
                    "cote": raw.get("shelfmark") or raw.get("cote"),
                    "media_sha256": digest(media) if media else digest(source_record_id or ""),
                    "media": media,
                    "canonical": {
                        "description": raw.get("caption") or raw.get("description"),
                        "title": raw.get("title"),
                        "date": raw.get("date"),
                        "attribution": raw.get("license") or raw.get("attribution"),
                    },
                    "source": {
                        "path": str(image_path) if image_path else None,
                        "image_filename": Path(file_name).name if file_name else None,
                        "evidence": digest(raw),
                    },
                }
            )
        return rows


ADAPTERS = {"mtl": MtlAdapter, "other": OtherAdapter, "second": SecondAdapter}


def load_adapter(name):
    if name not in ADAPTERS:
        raise ValueError("adapter")
    return ADAPTERS[name]()
