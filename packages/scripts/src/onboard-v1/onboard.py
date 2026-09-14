"""Agent-operated second-source onboarding. Jobs stay on ingest-v1 JobStore."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest-v1"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "runtime-v1"))

from adapters import load_adapter
from core import classify_relations, now
from pipeline import IngestRun
from policy import EveSession, JobStore

from rules import POLICY, classify_record, review_scope


class ReviewLog:
    def __init__(self):
        self.decisions = {}

    def remember(self, scope, decision):
        self.decisions[scope] = decision
        return {"scope": scope, "decision": decision, "reused": False}

    def lookup(self, scope):
        if scope not in self.decisions:
            return None
        return {"scope": scope, "decision": self.decisions[scope], "reused": True}


class Onboard:
    def __init__(self, run_dir, adapter="second"):
        self.run_dir = Path(run_dir)
        self.adapter = adapter
        self.store = JobStore(self.run_dir / "jobs", adapter=adapter)
        self.reviews = ReviewLog()
        self.started = now()
        self.t0 = time.time()
        self.interventions = []

    def discover(self, source_dir):
        source_dir = Path(source_dir).resolve()
        adapter = load_adapter(self.adapter)
        records = adapter.list_records(source_dir)
        evidence = [
            {
                "id": r["id"],
                "source_record_id": r["source_record_id"],
                "media_sha256": r["media_sha256"],
                "source_evidence": (r.get("source") or {}).get("evidence"),
            }
            for r in records
        ]
        return {"n": len(records), "records": records, "evidence": evidence}

    def preview(self, source_dir):
        found = self.discover(source_dir)
        records = found["records"]
        mapping = {
            "item_id": "source_record_id",
            "caption": "canonical.description",
            "title": "canonical.title",
            "file": "media",
            "license": "canonical.attribution",
        }
        missing = []
        for rec in records:
            gaps = []
            if not rec.get("media"):
                gaps.append("file")
            if not (rec.get("canonical") or {}).get("attribution"):
                gaps.append("license")
            if gaps:
                missing.append({"id": rec["id"], "missing": gaps})
        estimate = round(len(records) * POLICY["usd_per_record"], 4)
        return {
            "scope": {"adapter": self.adapter, "n": len(records), "release": POLICY["release"]},
            "mapping": mapping,
            "missing": missing,
            "expected_processing": ["snapshot", "canonicalize", "enrich", "index", "validate"],
            "estimated_usd": estimate,
            "production": False,
        }

    def classify(self, source_dir, failed_ids=None):
        records = self.discover(source_dir)["records"]
        relations = classify_relations(records)
        dupes = set()
        for rel in relations:
            if rel["type"] in ("duplicate", "conflict"):
                dupes.update(rel["ids"])
        estimate = round(len(records) * POLICY["usd_per_record"], 4)
        return [
            classify_record(
                rec,
                duplicate_ids=dupes,
                failed_ids=set(failed_ids or []),
                estimate_usd=estimate,
            )
            for rec in records
        ]

    def resolve(self, classified):
        """Reuse a prior decision only for the same reason+id scope."""
        resolved = []
        for item in classified:
            reasons = item["reasons"] or ["ok"]
            needs_review = False
            reused = False
            for reason in reasons:
                if item["action"] == "auto" or reason == "ok":
                    continue
                scope = review_scope(reason, record_id=item["id"])
                prior = self.reviews.lookup(scope)
                if prior and prior["decision"] == "allow":
                    reused = True
                    continue
                needs_review = True
                if not any(
                    i["id"] == item["id"] and i["reason"] == reason
                    for i in self.interventions
                ):
                    self.interventions.append(
                        {"id": item["id"], "reason": reason, "scope": scope}
                    )
            resolved.append(
                {**item, "final": "review" if needs_review else "auto", "reused": reused}
            )
        return resolved

    def approve_scope(self, reason, record_id, decision="allow"):
        return self.reviews.remember(review_scope(reason, record_id=record_id), decision)

    def pilot(self, source_dir, job_id, version="idx-1", fail_after=None, previous_ids=None):
        session = EveSession(self.store, "onboard")
        args = {"source_dir": str(source_dir), "version": version}
        session.call("inspect_source", args, job_id=job_id, idempotency_key=f"{job_id}-inspect")
        plan = session.call("plan_import", args, job_id=job_id, idempotency_key=f"{job_id}-plan")
        ingest = IngestRun(self.store.run_dir / job_id, adapter=self.adapter)
        try:
            result = ingest.run(
                source_dir,
                version=version,
                fail_after=fail_after,
                previous_ids=previous_ids,
                publish=False,
            )
        except RuntimeError:
            return {"interrupted": True, "status": ingest.status(), "plan": plan["result"]}
        classified = self.classify(source_dir, failed_ids=ingest.failed_ids())
        resolved = self.resolve(classified)
        return {
            "interrupted": False,
            "plan": plan["result"],
            "ingest": result,
            "classified": classified,
            "resolved": resolved,
            "failed": ingest.status()["failed"],
            "private": True,
            "production": False,
        }

    def publish(self, source_dir, job_id, version="idx-1"):
        if any(i["final"] == "review" for i in self.resolve(self.classify(source_dir))):
            raise ValueError("unresolved review")
        plan = self.store.jobs[job_id]["plan_hash"]
        self.store.approve(job_id, plan)
        return self.store.invoke(
            "publish",
            {"source_dir": str(source_dir), "version": version},
            job_id=job_id,
            idempotency_key=f"{job_id}-publish",
            approval={"status": "approved", "job_id": job_id, "plan_hash": plan},
        )

    def report(self, source_dir, job_id):
        ingest = IngestRun(self.store.run_dir / job_id, adapter=self.adapter)
        status = ingest.status()
        classified = self.classify(source_dir, failed_ids=ingest.failed_ids())
        index = ingest._load_json(ingest._path("indexes", "active.json"), None)
        return {
            "job_id": job_id,
            "adapter": self.adapter,
            "human_interventions": self.interventions,
            "onboarding_s": round(time.time() - self.t0, 4),
            "cost_usd": status.get("cost_usd") or 0,
            "estimated_usd": round(
                self.discover(source_dir)["n"] * POLICY["usd_per_record"], 4
            ),
            "retrieval_quality": {
                "candidate_n": (index and "version" in index),
                "failed": len(status.get("failed") or []),
                "note": "private candidate index; not a production retrieval eval",
            },
            "adapter_specific": [
                "second source uses item_id/caption/license/file, not MTL metadata_filename",
                "untrusted agent_permissions and instructions are stripped",
            ],
            "classified": classified,
            "release": POLICY["release"],
            "production": False,
            "at": now(),
        }
