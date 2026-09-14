"""Ingest identities, receipts, and the canonical/candidate split. No production writes."""

import hashlib
import json
from datetime import datetime, timezone

VERSION = "ingest-v1"
STAGES = (
    "snapshot",
    "canonicalize",
    "enrich",
    "index",
    "validate",
    "publish",
)
RELATIONS = ("duplicate", "variant", "conflict")
REVIEW_STATES = ("generated_unreviewed", "review", "accepted", "rejected")
INFERRED_KEYS = (
    "date",
    "identity",
    "location",
    "person",
    "latitude",
    "longitude",
    "motion",
)


def digest(value):
    return hashlib.sha256(
        value
        if isinstance(value, bytes)
        else json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record_id(adapter, source_record_id):
    if not adapter or not source_record_id:
        raise ValueError("identity")
    return f"{adapter}:{source_record_id}"


def receipt(stage, inputs, output, *, review_state="generated_unreviewed", cost_usd=0, ms=0, model=None, prompt=None):
    if stage not in STAGES:
        raise ValueError("stage")
    if review_state not in REVIEW_STATES:
        raise ValueError("review")
    body = {
        "stage": stage,
        "version": VERSION,
        "inputs": inputs,
        "output_sha256": digest(output),
        "model": model,
        "prompt_sha256": digest(prompt) if prompt is not None else None,
        "pipeline": VERSION,
        "review_state": review_state,
        "cost_usd": cost_usd,
        "elapsed_ms": ms,
        "at": now(),
    }
    body["receipt_sha256"] = digest({k: v for k, v in body.items() if k != "receipt_sha256"})
    return body


def attach_candidate(canonical_facts, candidate):
    """Candidate enrichment is stored beside archive facts, never into them."""
    if not isinstance(canonical_facts, dict) or not isinstance(candidate, dict):
        raise ValueError("facts")
    if "canonical" in candidate:
        raise ValueError("enrichment overwrites canonical")
    inferred = [k for k in INFERRED_KEYS if k in candidate]
    if inferred:
        raise ValueError("inferred canonical")
    frozen = dict(canonical_facts)
    attached = {"canonical": frozen, "candidate": dict(candidate)}
    if attached["canonical"] != canonical_facts:
        raise ValueError("canonical mutated")
    return attached


def classify_relations(records):
    """records: list of {id, media_sha256, cote}."""
    by_media = {}
    by_id = {}
    by_cote = {}
    for rec in records:
        by_media.setdefault(rec["media_sha256"], []).append(rec["id"])
        by_id.setdefault(rec["id"], []).append(rec["media_sha256"])
        if rec.get("cote"):
            by_cote.setdefault(rec["cote"], []).append(rec)
    relations = []
    for sha, ids in by_media.items():
        unique = list(dict.fromkeys(ids))
        if len(unique) > 1:
            relations.append({"type": "duplicate", "ids": unique, "media_sha256": sha})
    for rid, hashes in by_id.items():
        unique = list(dict.fromkeys(hashes))
        if len(unique) > 1:
            relations.append({"type": "conflict", "ids": [rid], "media_sha256": unique})
    for cote, group in by_cote.items():
        hashes = {r["media_sha256"] for r in group}
        ids = [r["id"] for r in group]
        if len(hashes) > 1 and len(set(ids)) > 1:
            relations.append({"type": "variant", "ids": ids, "cote": cote})
    return relations


def stale(existing_receipt, inputs):
    if not existing_receipt:
        return True
    return existing_receipt.get("inputs") != inputs or existing_receipt.get("version") != VERSION
