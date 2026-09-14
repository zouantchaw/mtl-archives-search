import json
import tempfile
import unittest
from pathlib import Path

from policy import (
    APPROVAL_REQUIRED,
    SCOPES,
    TOOLS,
    CompetingOrchestratorError,
    EveSession,
    JobStore,
)


def mtl_fixture(root):
    root = Path(root)
    (root / "images").mkdir(parents=True)
    (root / "images" / "a.jpg").write_bytes(b"photo-a")
    (root / "records.jsonl").write_text(
        json.dumps(
            {
                "metadata_filename": "mtl_archives_metadata_0.json",
                "resolved_image_filename": "a.jpg",
                "image_filename": "a.jpg",
                "cote": "VM0",
                "description": "Archive street view.",
                "name": "Untitled",
                "attribution": "Archives de la Ville de Montreal",
            }
        )
        + "\n"
    )
    return root


class RuntimeSplit(unittest.TestCase):
    def test_typed_tools_cover_the_ingest_loop(self):
        self.assertEqual(
            TOOLS,
            (
                "inspect_source",
                "plan_import",
                "run_pilot",
                "validate_index",
                "request_review",
                "publish",
            ),
        )
        self.assertEqual(SCOPES["inspect_source"], "read")
        self.assertEqual(SCOPES["run_pilot"], "candidate")
        self.assertEqual(APPROVAL_REQUIRED, {"publish"})

    def test_pilot_and_publish_require_approval_and_do_not_hit_production(self):
        with tempfile.TemporaryDirectory() as temp:
            src = mtl_fixture(Path(temp) / "src")
            store = JobStore(Path(temp) / "jobs")
            session = EveSession(store, "eve-session-1")
            args = {"source_dir": str(src), "version": "idx-1"}
            inspect = session.call("inspect_source", args, job_id="job-1", idempotency_key="k-inspect")
            self.assertEqual(inspect["result"]["n"], 1)
            plan = session.call("plan_import", args, job_id="job-1", idempotency_key="k-plan")
            self.assertFalse(plan["result"]["publish"])
            session.call("run_pilot", args, job_id="job-1", idempotency_key="k-pilot")
            session.call("validate_index", args, job_id="job-1", idempotency_key="k-val")
            session.call("request_review", args, job_id="job-1", idempotency_key="k-rev")
            with self.assertRaises(ValueError):
                session.call("publish", args, job_id="job-1", idempotency_key="k-pub")
            pending = {"status": "pending", "job_id": "job-1", "plan_hash": plan["result"]["plan_hash"]}
            with self.assertRaises(ValueError):
                session.call(
                    "publish",
                    args,
                    job_id="job-1",
                    idempotency_key="k-pub-pending",
                    approval=pending,
                )
            store.approve("job-1", plan["result"]["plan_hash"])
            published = session.call(
                "publish",
                args,
                job_id="job-1",
                idempotency_key="k-pub",
                approval={
                    "status": "approved",
                    "job_id": "job-1",
                    "plan_hash": plan["result"]["plan_hash"],
                },
            )
            self.assertTrue(published["result"]["published"])
            self.assertFalse(published["result"]["production"])

    def test_replay_restart_and_duplicate_delivery_do_not_rerun_pilot(self):
        with tempfile.TemporaryDirectory() as temp:
            src = mtl_fixture(Path(temp) / "src")
            store = JobStore(Path(temp) / "jobs")
            args = {"source_dir": str(src), "version": "idx-1"}
            first = EveSession(store, "session-a").call(
                "run_pilot", args, job_id="job-2", idempotency_key="pilot"
            )
            calls = store.expensive
            replay = EveSession(store, "session-b").call(
                "run_pilot", args, job_id="job-2", idempotency_key="pilot"
            )
            self.assertTrue(replay["replay"])
            self.assertEqual(store.expensive, calls)
            self.assertEqual(replay["result"]["n"], first["result"]["n"])

    def test_cancelled_job_cannot_publish_after_interrupted_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            src = mtl_fixture(Path(temp) / "src")
            store = JobStore(Path(temp) / "jobs")
            args = {"source_dir": str(src), "version": "idx-1"}
            plan = store.invoke("plan_import", args, job_id="job-3", idempotency_key="p")
            store.invoke("request_review", args, job_id="job-3", idempotency_key="r")
            store.cancel("job-3")
            with self.assertRaises(ValueError):
                store.approve("job-3", plan["result"]["plan_hash"])
            with self.assertRaises(ValueError):
                store.invoke(
                    "publish",
                    args,
                    job_id="job-3",
                    idempotency_key="pub",
                    approval={
                        "status": "approved",
                        "job_id": "job-3",
                        "plan_hash": plan["result"]["plan_hash"],
                    },
                )

    def test_second_orchestrator_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            store = JobStore(Path(temp) / "jobs")
            with self.assertRaises(CompetingOrchestratorError):
                store.invoke(
                    "inspect_source",
                    {},
                    job_id="job-4",
                    idempotency_key="x",
                    orchestrator="eve-workflow",
                )


if __name__ == "__main__":
    unittest.main()
