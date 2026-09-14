"""Candidate indexes. Validation happens before activation; rollback keeps the prior version."""

import json
from pathlib import Path

from core import VERSION, digest, now


def index_dir(run_dir):
    path = Path(run_dir) / "indexes"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_candidate_index(run_dir, records, version):
    items = [
        {
            "id": rec["id"],
            "media_sha256": rec["media_sha256"],
            "canonical_sha256": digest(rec["canonical"]),
            "candidate_sha256": digest(rec.get("candidate") or {}),
            "tombstone": bool(rec.get("tombstone")),
        }
        for rec in records
    ]
    payload = {
        "version": version,
        "pipeline": VERSION,
        "n": len(items),
        "items": items,
        "sha256": digest(items),
        "production_promotable": False,
    }
    path = index_dir(run_dir) / f"{version}.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def load_index(run_dir, version):
    path = index_dir(run_dir) / f"{version}.json"
    if not path.is_file():
        raise ValueError("missing index")
    return json.loads(path.read_text())


def validate_index(payload, records, failed_ids):
    by_id = {r["id"]: r for r in records}
    errors = []
    if payload.get("production_promotable") is True:
        errors.append("promotable")
    if payload.get("sha256") != digest(payload.get("items")):
        errors.append("index hash")
    for item in payload.get("items") or []:
        rec = by_id.get(item["id"])
        if rec is None:
            errors.append(f"missing {item['id']}")
            continue
        if item["id"] in failed_ids and not item.get("tombstone"):
            errors.append(f"failed {item['id']}")
        if item["media_sha256"] != rec["media_sha256"]:
            errors.append(f"media {item['id']}")
        if item["canonical_sha256"] != digest(rec["canonical"]):
            errors.append(f"canonical {item['id']}")
    return errors


def pointer_path(run_dir):
    return index_dir(run_dir) / "active.json"


def activate(run_dir, version, records, failed_ids):
    payload = load_index(run_dir, version)
    errors = validate_index(payload, records, failed_ids)
    if errors:
        raise ValueError("invalid index: " + ",".join(errors))
    pointer = pointer_path(run_dir)
    previous = None
    if pointer.is_file():
        previous = json.loads(pointer.read_text()).get("version")
    body = {
        "version": version,
        "previous": previous,
        "activated_at": now(),
        "production": False,
    }
    pointer.write_text(json.dumps(body, indent=2) + "\n")
    return body


def rollback(run_dir):
    pointer = pointer_path(run_dir)
    if not pointer.is_file():
        raise ValueError("no active index")
    current = json.loads(pointer.read_text())
    previous = current.get("previous")
    if not previous:
        raise ValueError("no prior version")
    load_index(run_dir, previous)
    body = {
        "version": previous,
        "previous": current["version"],
        "activated_at": now(),
        "rolled_back_from": current["version"],
        "production": False,
    }
    pointer.write_text(json.dumps(body, indent=2) + "\n")
    return body
