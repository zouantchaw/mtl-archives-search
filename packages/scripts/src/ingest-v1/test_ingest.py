import json
import tempfile
import unittest
from pathlib import Path

from adapters import MtlAdapter, OtherAdapter
from core import attach_candidate, classify_relations, digest, record_id
from indexes import activate, rollback, validate_index, write_candidate_index
from pipeline import IngestRun


def write_mtl_fixture(root, rows):
    root = Path(root)
    (root / "images").mkdir(parents=True, exist_ok=True)
    lines = []
    for row in rows:
        (root / "images" / row["image"]).write_bytes(row["bytes"])
        lines.append(
            json.dumps(
                {
                    "metadata_filename": row["id"],
                    "resolved_image_filename": row["image"],
                    "image_filename": row["image"],
                    "cote": row.get("cote"),
                    "description": row["description"],
                    "name": row.get("title") or row["id"],
                    "attribution": "Archives de la Ville de Montreal",
                }
            )
        )
    (root / "records.jsonl").write_text("\n".join(lines) + "\n")
    return root


class Identities(unittest.TestCase):
    def test_stable_ids_hashes_and_relations(self):
        same = b"jpeg-a"
        records = [
            {"id": "mtl:a.json", "media_sha256": digest(same), "cote": "VM1"},
            {"id": "mtl:b.json", "media_sha256": digest(same), "cote": "VM1"},
            {"id": "mtl:c.json", "media_sha256": digest(b"jpeg-c"), "cote": "VM1"},
            {"id": "mtl:a.json", "media_sha256": digest(b"other"), "cote": "VM2"},
        ]
        rel = {r["type"]: r for r in classify_relations(records)}
        self.assertEqual(rel["duplicate"]["ids"], ["mtl:a.json", "mtl:b.json"])
        self.assertEqual(rel["conflict"]["ids"], ["mtl:a.json"])
        self.assertEqual(set(rel["variant"]["ids"]), {"mtl:a.json", "mtl:b.json", "mtl:c.json"})
        self.assertEqual(record_id("mtl", "mtl_archives_metadata_0.json"), "mtl:mtl_archives_metadata_0.json")

    def test_enrichment_cannot_overwrite_canonical_facts(self):
        canonical = {"description": "Archival description", "date": "1969"}
        candidate = {"description": "AI caption", "uncertainties": []}
        split = attach_candidate(canonical, candidate)
        self.assertEqual(split["canonical"]["description"], "Archival description")
        self.assertEqual(split["candidate"]["description"], "AI caption")
        with self.assertRaises(ValueError):
            attach_candidate(canonical, {"location": "Montreal"})
        with self.assertRaises(ValueError):
            attach_candidate(canonical, {"canonical": {"description": "pwned"}})


class Pipeline(unittest.TestCase):
    def fixture(self, temp):
        return write_mtl_fixture(
            Path(temp) / "src",
            [
                {
                    "id": "mtl_archives_metadata_0.json",
                    "image": "mtl_archives_image_0.jpg",
                    "bytes": b"photo-0",
                    "cote": "VM0",
                    "description": "Street photograph from the archive.",
                },
                {
                    "id": "mtl_archives_metadata_1.json",
                    "image": "mtl_archives_image_1.jpg",
                    "bytes": b"photo-0",
                    "cote": "VM0",
                    "description": "Duplicate street photograph.",
                },
                {
                    "id": "mtl_archives_metadata_2.json",
                    "image": "mtl_archives_image_2.jpg",
                    "bytes": b"photo-2",
                    "cote": "VM2",
                    "description": "A second distinct photograph.",
                },
            ],
        )

    def test_idempotent_resume_skips_completed_expensive_work(self):
        with tempfile.TemporaryDirectory() as temp:
            src = self.fixture(temp)
            out = Path(temp) / "run"
            first = IngestRun(out)
            try:
                first.run(src, version="idx-1", fail_after=1)
                self.fail("expected interrupt")
            except RuntimeError:
                pass
            self.assertEqual(first.expensive_calls, 1)
            original = (src / "images" / "mtl_archives_image_0.jpg").read_bytes()
            second = IngestRun(out)
            result = second.run(src, version="idx-1")
            self.assertEqual((src / "images" / "mtl_archives_image_0.jpg").read_bytes(), original)
            self.assertEqual(second.expensive_calls, 3)
            again = IngestRun(out)
            again.run(src, version="idx-1")
            self.assertEqual(again.expensive_calls, 3)
            self.assertEqual(result["manifest"]["n"], 3)
            self.assertFalse(result["status"]["production"])
            duplicates = [r for r in result["relations"] if r["type"] == "duplicate"]
            self.assertEqual(len(duplicates), 1)
            enrich = json.loads(next((out / "receipts").glob("enrich-*.json")).read_text())
            self.assertEqual(enrich["pipeline"], "ingest-v1")
            self.assertEqual(enrich["review_state"], "generated_unreviewed")
            self.assertTrue(enrich["prompt_sha256"])
            self.assertEqual(enrich["model"], "none")

    def test_failed_queue_and_bounded_retries(self):
        with tempfile.TemporaryDirectory() as temp:
            src = self.fixture(temp)
            out = Path(temp) / "run"
            run = IngestRun(out)
            run.run(
                src,
                version="idx-1",
                sidecars={"mtl:mtl_archives_metadata_2.json": {"location": "Montreal"}},
            )
            self.assertIn("mtl:mtl_archives_metadata_2.json", run.failed_ids())
            failed = run.status()["failed"]
            self.assertEqual(failed[0]["stage"], "enrich")
            self.assertLessEqual(failed[0]["retries"], 3)

    def test_index_validates_before_activation_and_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            src = self.fixture(temp)
            out = Path(temp) / "run"
            run = IngestRun(out)
            run.run(src, version="idx-1", publish=True)
            first = json.loads((out / "indexes" / "active.json").read_text())
            self.assertEqual(first["version"], "idx-1")
            run.run(src, version="idx-2", publish=True)
            self.assertEqual(json.loads((out / "indexes" / "active.json").read_text())["previous"], "idx-1")
            rolled = rollback(out)
            self.assertEqual(rolled["version"], "idx-1")
            self.assertEqual(rolled["rolled_back_from"], "idx-2")
            self.assertTrue((out / "indexes" / "idx-2.json").is_file())
            with self.assertRaises(ValueError):
                activate(out, "idx-missing", [], set())

    def test_add_change_remove_tombstones(self):
        with tempfile.TemporaryDirectory() as temp:
            src = self.fixture(temp)
            out = Path(temp) / "run"
            run = IngestRun(out)
            first = run.run(src, version="idx-1")
            previous = set(first["manifest"]["ids"])
            rows = json.loads((src / "records.jsonl").read_text().splitlines()[0])
            (src / "records.jsonl").write_text(json.dumps(rows) + "\n")
            (src / "images" / "mtl_archives_image_0.jpg").write_bytes(b"photo-0-changed")
            second = run.run(src, version="idx-2", previous_ids=previous)
            self.assertIn("mtl:mtl_archives_metadata_1.json", second["removed"])
            live_ids = {item["id"] for item in second["index"]["items"]}
            self.assertIn("mtl:mtl_archives_metadata_1.json", live_ids)
            tomb = next(i for i in second["index"]["items"] if i["id"] == "mtl:mtl_archives_metadata_1.json")
            self.assertTrue(tomb["tombstone"])

    def test_status_is_inspectable_without_chat_logs(self):
        with tempfile.TemporaryDirectory() as temp:
            src = self.fixture(temp)
            run = IngestRun(Path(temp) / "run")
            run.run(src, version="idx-1")
            status = run.status()
            self.assertEqual(status["pipeline"], "ingest-v1")
            self.assertIn("cost_usd", status)
            self.assertIn("elapsed_ms_total", status)
            self.assertIn("receipts", status)
            self.assertNotIn("messages", status)
            self.assertNotIn("conversation", status)

    def test_adapter_mapping_is_isolated_and_mtl_is_reproducible(self):
        with tempfile.TemporaryDirectory() as temp:
            src = self.fixture(temp)
            a = IngestRun(Path(temp) / "a")
            b = IngestRun(Path(temp) / "b")
            one = a.run(src, version="idx-1")
            two = b.run(src, version="idx-1")
            self.assertEqual(one["manifest"]["sha256"], two["manifest"]["sha256"])
            other_src = Path(temp) / "other"
            other_src.mkdir()
            (other_src / "records.jsonl").write_text(
                json.dumps({"id": "x", "body": "hello", "description": "other"}) + "\n"
            )
            other = OtherAdapter().list_records(other_src)
            mtl = MtlAdapter().list_records(src)
            self.assertTrue(all(r["id"].startswith("other:") for r in other))
            self.assertTrue(all(r["id"].startswith("mtl:") for r in mtl))
            self.assertNotEqual(other[0]["canonical"], mtl[0]["canonical"])


class IndexGuard(unittest.TestCase):
    def test_invalid_index_is_not_activated(self):
        with tempfile.TemporaryDirectory() as temp:
            records = [
                {
                    "id": "mtl:a",
                    "media_sha256": "a" * 64,
                    "canonical": {"description": "x"},
                    "candidate": {},
                }
            ]
            payload = write_candidate_index(temp, records, "idx-1")
            payload["items"][0]["media_sha256"] = "b" * 64
            (Path(temp) / "indexes" / "idx-1.json").write_text(json.dumps(payload))
            errors = validate_index(payload, records, set())
            self.assertTrue(errors)
            with self.assertRaises(ValueError):
                activate(temp, "idx-1", records, set())


if __name__ == "__main__":
    unittest.main()
