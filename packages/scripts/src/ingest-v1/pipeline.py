"""Versioned, resumable ingest. Original source bytes are never overwritten."""

import json
from pathlib import Path

from adapters import load_adapter
from core import VERSION, attach_candidate, classify_relations, digest, now, receipt, stale
from indexes import activate, rollback, write_candidate_index

MAX_RETRIES = 3


class IngestRun:
    def __init__(self, run_dir, adapter="mtl", retention="tombstone"):
        self.run_dir = Path(run_dir)
        self.adapter_name = adapter
        self.retention = retention
        self.run_dir.mkdir(parents=True, exist_ok=True)
        for name in ("snapshot", "canonical", "candidate", "receipts", "failed"):
            (self.run_dir / name).mkdir(parents=True, exist_ok=True)
        self.expensive_calls = self.checkpoint().get("expensive_calls", 0)

    def _path(self, *parts):
        return self.run_dir.joinpath(*parts)

    def _load_json(self, path, default):
        if not path.is_file():
            return default
        return json.loads(path.read_text())

    def checkpoint(self):
        return self._load_json(self._path("checkpoint.json"), {})

    def save_checkpoint(self, **fields):
        body = {**self.checkpoint(), **fields, "at": now(), "version": VERSION}
        self._path("checkpoint.json").write_text(json.dumps(body, indent=2) + "\n")
        return body

    def _receipt_path(self, stage, record_id):
        safe = record_id.replace("/", "_")
        return self._path("receipts", f"{stage}-{safe}.json")

    def load_receipt(self, stage, record_id):
        return self._load_json(self._receipt_path(stage, record_id), None)

    def save_receipt(self, rec):
        record_id = rec["inputs"]["id"]
        path = self._receipt_path(rec["stage"], record_id)
        path.write_text(json.dumps(rec, indent=2) + "\n")
        return rec

    def fail(self, record_id, stage, error, retries=0):
        path = self._path("failed", "queue.jsonl")
        row = {
            "id": record_id,
            "stage": stage,
            "error": error,
            "retries": retries,
            "at": now(),
        }
        with path.open("a") as handle:
            handle.write(json.dumps(row) + "\n")
        return row

    def failed_ids(self):
        path = self._path("failed", "queue.jsonl")
        if not path.is_file():
            return set()
        return {json.loads(line)["id"] for line in path.read_text().splitlines() if line.strip()}

    def embed(self, text):
        """Stand-in for expensive embedding. Counted so resume tests can see skips."""
        self.expensive_calls += 1
        return digest(text or "")

    def snapshot(self, source_dir):
        adapter = load_adapter(self.adapter_name)
        records = adapter.list_records(source_dir)
        originals = []
        for rec in records:
            snap = self._path("snapshot", f"{rec['media_sha256']}.bin")
            if rec.get("source", {}).get("path"):
                original = Path(rec["source"]["path"])
                if original.is_file():
                    originals.append((original, original.read_bytes()))
            if not snap.is_file():
                snap.write_bytes(rec["media"])
            elif snap.read_bytes() != rec["media"] and rec["media"]:
                rec["conflict_media"] = True
            rec["snapshot_sha256"] = digest(snap.read_bytes()) if snap.is_file() else rec["media_sha256"]
        for path, bytes_ in originals:
            if path.read_bytes() != bytes_:
                raise ValueError("original overwritten")
        manifest = {
            "adapter": self.adapter_name,
            "n": len(records),
            "ids": [r["id"] for r in records],
            "sha256": digest([r["media_sha256"] for r in records]),
        }
        self._path("snapshot", "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        self.save_checkpoint(stage="snapshot", n=len(records))
        return records, manifest

    def canonicalize(self, records):
        relations = classify_relations(records)
        out = []
        for rec in records:
            inputs = {"id": rec["id"], "media": rec["media_sha256"]}
            existing = self.load_receipt("canonicalize", rec["id"])
            body = {
                "id": rec["id"],
                "media_sha256": rec["media_sha256"],
                "cote": rec.get("cote"),
                "canonical": rec["canonical"],
                "tombstone": False,
            }
            if not stale(existing, inputs):
                rec["canonical_record"] = body
                out.append(body)
                continue
            recpt = receipt("canonicalize", inputs, body, review_state="accepted")
            self.save_receipt({**recpt, "inputs": {**inputs, "id": rec["id"]}})
            rec["canonical_record"] = body
            path = self._path("canonical", f"{digest(rec['id'])}.json")
            path.write_text(json.dumps(body, indent=2) + "\n")
            out.append(body)
        self._path("canonical", "relations.json").write_text(
            json.dumps(relations, indent=2) + "\n"
        )
        self.save_checkpoint(stage="canonicalize", relations=len(relations))
        return out, relations

    def enrich(self, records, sidecars=None, fail_after=None):
        sidecars = sidecars or {}
        done = 0
        for rec in records:
            if fail_after is not None and done >= fail_after:
                raise RuntimeError("interrupt")
            sidecar = sidecars.get(rec["id"]) or {
                "description": "Candidate visual description is inactive.",
                "uncertainties": ["no model run"],
            }
            inputs = {
                "id": rec["id"],
                "media": rec["media_sha256"],
                "sidecar": digest(sidecar),
            }
            existing = self.load_receipt("enrich", rec["id"])
            if not stale(existing, inputs):
                rec["candidate"] = json.loads(
                    self._path("candidate", f"{digest(rec['id'])}.json").read_text()
                )
                continue
            try:
                attach_candidate(rec["canonical"], sidecar)
                embedding = self.embed(sidecar.get("description"))
                candidate = {
                    **sidecar,
                    "embedding_sha256": embedding,
                    "review_state": "generated_unreviewed",
                    "pipeline": VERSION,
                }
                recpt = receipt(
                    "enrich",
                    inputs,
                    candidate,
                    model="none",
                    prompt="ingest-v1-no-model",
                    cost_usd=0,
                    ms=0,
                )
                self.save_receipt({**recpt, "inputs": inputs})
                path = self._path("candidate", f"{digest(rec['id'])}.json")
                path.write_text(json.dumps(candidate, indent=2) + "\n")
                rec["candidate"] = candidate
                self.save_checkpoint(stage="enrich", expensive_calls=self.expensive_calls)
            except (ValueError, OSError) as error:
                retries = int((existing or {}).get("retries") or 0)
                if retries + 1 > MAX_RETRIES:
                    self.fail(rec["id"], "enrich", str(error), retries + 1)
                else:
                    self.fail(rec["id"], "enrich", str(error), retries + 1)
            done += 1
        self.save_checkpoint(stage="enrich", expensive_calls=self.expensive_calls)
        return records

    def apply_retention(self, current, previous_ids):
        current_ids = {r["id"] for r in current}
        removed = previous_ids - current_ids
        if self.retention != "tombstone":
            return current, removed
        extras = []
        for rid in sorted(removed):
            extras.append(
                {
                    "id": rid,
                    "media_sha256": digest(rid),
                    "cote": None,
                    "canonical": {},
                    "tombstone": True,
                    "candidate": {"review_state": "rejected", "pipeline": VERSION},
                }
            )
        return current + extras, removed

    def build_index(self, records, version):
        failed = self.failed_ids()
        live = [r for r in records if r["id"] not in failed or r.get("tombstone")]
        payload = write_candidate_index(self.run_dir, live, version)
        recpt = receipt(
            "index",
            {"version": version, "id": "index"},
            payload,
            review_state="generated_unreviewed",
        )
        self.save_receipt({**recpt, "inputs": {"id": "index", "version": version}})
        self.save_checkpoint(stage="index", index=version)
        return payload

    def status(self):
        checkpoint = self.checkpoint()
        receipts = list(self._path("receipts").glob("*.json"))
        failed = []
        queue = self._path("failed", "queue.jsonl")
        if queue.is_file():
            failed = [json.loads(line) for line in queue.read_text().splitlines() if line.strip()]
        costs = 0
        timings = []
        for path in receipts:
            rec = json.loads(path.read_text())
            costs += rec.get("cost_usd") or 0
            timings.append(rec.get("elapsed_ms") or 0)
        pointer = self._load_json(self._path("indexes", "active.json"), None)
        return {
            "pipeline": VERSION,
            "adapter": self.adapter_name,
            "checkpoint": checkpoint,
            "receipts": len(receipts),
            "failed": failed,
            "cost_usd": costs,
            "elapsed_ms_total": sum(timings),
            "expensive_calls": self.expensive_calls,
            "active_index": pointer,
            "production": False,
        }

    def run(self, source_dir, version="idx-1", sidecars=None, fail_after=None, previous_ids=None, publish=False):
        records, manifest = self.snapshot(source_dir)
        canonical, relations = self.canonicalize(records)
        try:
            self.enrich(records, sidecars=sidecars, fail_after=fail_after)
        except RuntimeError:
            self.save_checkpoint(
                stage="enrich",
                interrupted=True,
                expensive_calls=self.expensive_calls,
            )
            raise
        records, removed = self.apply_retention(records, previous_ids or set())
        payload = self.build_index(records, version)
        errors = []
        from indexes import validate_index

        errors = validate_index(payload, records, self.failed_ids())
        recpt = receipt(
            "validate",
            {"id": "index", "version": version},
            {"errors": errors},
            review_state="accepted" if not errors else "rejected",
        )
        self.save_receipt({**recpt, "inputs": {"id": "index", "version": version}})
        published = None
        if publish:
            if errors:
                raise ValueError("refusing to activate invalid index")
            published = activate(self.run_dir, version, records, self.failed_ids())
        self.save_checkpoint(stage="publish" if published else "validate", index=version)
        return {
            "manifest": manifest,
            "relations": relations,
            "removed": sorted(removed),
            "index": payload,
            "errors": errors,
            "published": published,
            "status": self.status(),
        }
