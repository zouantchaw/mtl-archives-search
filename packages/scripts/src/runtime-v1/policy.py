"""Single job authority for archive ingest tools. Eve may call these; it must not own job state."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest-v1"))

from core import digest, now
from pipeline import IngestRun

VERSION = "runtime-v1"
TOOLS = (
    "inspect_source",
    "plan_import",
    "run_pilot",
    "validate_index",
    "request_review",
    "publish",
)
SCOPES = {
    "inspect_source": "read",
    "plan_import": "read",
    "run_pilot": "candidate",
    "validate_index": "read",
    "request_review": "review",
    "publish": "publish",
}
APPROVAL_REQUIRED = {"publish"}


def _key(tool, job_id, idempotency_key):
    return digest({"tool": tool, "job": job_id, "idk": idempotency_key})


class CompetingOrchestratorError(RuntimeError):
    pass


class JobStore:
    """Authoritative owner of job state, retries, and approvals."""

    def __init__(self, run_dir, adapter="mtl"):
        self.run_dir = Path(run_dir)
        self.adapter = adapter
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.jobs = {}
        self.results = {}
        self.expensive = 0
        self.orchestrator = "jobstore"

    def _job(self, job_id):
        return self.jobs.setdefault(
            job_id,
            {
                "id": job_id,
                "state": "open",
                "approval": None,
                "plan_hash": None,
                "version": None,
            },
        )

    def invoke(
        self,
        tool,
        args,
        *,
        job_id,
        idempotency_key,
        approval=None,
        session_id=None,
        orchestrator="jobstore",
    ):
        if orchestrator != "jobstore":
            raise CompetingOrchestratorError("Eve must not own job retries")
        if tool not in TOOLS:
            raise ValueError("unknown tool")
        token = _key(tool, job_id, idempotency_key)
        cached = self.results.get(token)
        if cached:
            return {**cached, "replay": True}
        job = self._job(job_id)
        if job["state"] == "cancelled" and tool == "publish":
            raise ValueError("cancelled")
        if job["state"] == "running":
            return {"status": "in_progress", "job_id": job_id, "replay": True}
        if tool in APPROVAL_REQUIRED:
            if not approval or approval.get("status") != "approved":
                raise ValueError("approval required")
            if approval.get("job_id") != job_id:
                raise ValueError("approval job mismatch")
            if job["approval"] != "approved":
                raise ValueError("store has no approval")
            if approval.get("plan_hash") != job.get("plan_hash"):
                raise ValueError("stale plan")
        job["state"] = "running"
        result = self._execute(tool, args, job)
        job["state"] = "completed" if tool != "request_review" else "pending_review"
        stored = {
            "status": "ok",
            "tool": tool,
            "scope": SCOPES[tool],
            "job_id": job_id,
            "session_id": session_id,
            "result": result,
            "replay": False,
            "version": VERSION,
        }
        self.results[token] = stored
        return stored

    def approve(self, job_id, plan_hash):
        job = self._job(job_id)
        if job["state"] == "cancelled":
            raise ValueError("cancelled")
        if job.get("plan_hash") != plan_hash:
            raise ValueError("stale plan")
        job["approval"] = "approved"
        return {"status": "approved", "job_id": job_id, "plan_hash": plan_hash}

    def cancel(self, job_id):
        job = self._job(job_id)
        job["state"] = "cancelled"
        job["approval"] = None
        return {"status": "cancelled", "job_id": job_id}

    def _execute(self, tool, args, job):
        source = args.get("source_dir")
        version = args.get("version") or "idx-1"
        ingest = IngestRun(self.run_dir / job["id"], adapter=self.adapter)
        if tool == "inspect_source":
            records, manifest = ingest.snapshot(source)
            return {"n": manifest["n"], "sha256": manifest["sha256"], "ids": manifest["ids"]}
        if tool == "plan_import":
            records, manifest = ingest.snapshot(source)
            plan = {
                "n": manifest["n"],
                "adapter": self.adapter,
                "retention": ingest.retention,
                "publish": False,
            }
            job["plan_hash"] = digest(plan)
            return {**plan, "plan_hash": job["plan_hash"]}
        if tool == "run_pilot":
            self.expensive += 1
            result = ingest.run(source, version=version, publish=False)
            job["version"] = version
            return {
                "errors": result["errors"],
                "n": result["manifest"]["n"],
                "expensive_calls": ingest.expensive_calls,
            }
        if tool == "validate_index":
            status = ingest.status()
            return {"checkpoint": status.get("checkpoint"), "failed": status.get("failed")}
        if tool == "request_review":
            job["approval"] = "pending"
            return {"approval": "pending"}
        if tool == "publish":
            ingest.run(source, version=job["version"] or version, publish=True)
            return {"published": True, "version": job["version"] or version, "production": False}
        raise ValueError("tool")


class EveSession:
    """Control surface only. Forwards to JobStore with the caller's idempotency key."""

    def __init__(self, store, session_id):
        self.store = store
        self.session_id = session_id

    def call(self, tool, args, *, job_id, idempotency_key, approval=None):
        return self.store.invoke(
            tool,
            args,
            job_id=job_id,
            idempotency_key=idempotency_key,
            approval=approval,
            session_id=self.session_id,
            orchestrator="jobstore",
        )
