import tempfile
import unittest
from pathlib import Path

from core import (
    CAMERA_VIEWPOINTS,
    enrichment_stage_inputs,
    stale_receipt,
    validate_enrichment_v2,
)
from eval_orientation import evaluate, jpeg_with_exif
from orientation import VERSION, derive_upright


class KindViewpoint(unittest.TestCase):
    def test_document_is_not_a_camera_viewpoint(self):
        self.assertNotIn("document", CAMERA_VIEWPOINTS)
        base = {
            "description": "A printed planning sheet with a title block along the margin.",
            "viewpoint": "document",
            "image_kind": "document",
            "features": {
                "storefronts": "unknown",
                "signs": "unknown",
                "church_exterior": "unknown",
                "church_interior": "unknown",
                "helicopter": "unknown",
                "people_beside_helicopter": "unknown",
                "flying_helicopter": "unknown",
                "trees": "unknown",
                "water": "unknown",
            },
            "uncertainties": [],
        }
        with self.assertRaises(ValueError):
            validate_enrichment_v2(base)
        with self.assertRaises(ValueError):
            validate_enrichment_v2({**base, "viewpoint": "aerial_nadir"})
        validate_enrichment_v2({**base, "viewpoint": "unknown"})


class OrientationEval(unittest.TestCase):
    def test_ambiguous_exif_enters_review(self):
        derived, rec = derive_upright(jpeg_with_exif(2))
        self.assertIsNone(derived)
        self.assertEqual(rec["review_state"], "review")

    def test_synthetic_exif_cases_and_no_promotion(self):
        report = evaluate({"version": "vision-eval-v1", "records": []})
        by_id = {r["audit_id"]: r for r in report["records"]}
        self.assertTrue(by_id["S1"]["passed"])
        self.assertTrue(by_id["S6"]["passed"])
        self.assertTrue(by_id["S8"]["passed"])
        self.assertTrue(by_id["S2"]["passed"])
        self.assertTrue(by_id["S0"]["passed"])
        self.assertFalse(report["production_promotable"])

    def test_labeled_files_are_not_overwritten(self):
        jpeg = jpeg_with_exif(None)
        labels = {
            "records": [
                {
                    "audit_id": "A44",
                    "id": "mtl_archives_metadata_12519.json",
                    "image_kind": "photograph",
                    "orientation": {"expected_review_state": "abstain"},
                }
            ]
        }
        with tempfile.TemporaryDirectory() as temp:
            images = Path(temp) / "images"
            images.mkdir()
            source = images / "A44.jpg"
            source.write_bytes(jpeg)
            derived_dir = Path(temp) / "derived"
            report = evaluate(labels, images, derived_dir)
            self.assertEqual(source.read_bytes(), jpeg)
            a44 = next(r for r in report["records"] if r["audit_id"] == "A44")
            self.assertTrue(a44["passed"])
            self.assertEqual(a44["orientation"]["review_state"], "abstain")

    def test_orientation_change_invalidates_enrichment_cache(self):
        original = "a" * 64
        before = enrichment_stage_inputs(
            original,
            {
                "version": VERSION,
                "derived_sha256": None,
                "review_state": "abstain",
                "degrees": None,
            },
        )
        after = enrichment_stage_inputs(
            original,
            {
                "version": VERSION,
                "derived_sha256": "b" * 64,
                "review_state": "accepted",
                "degrees": 90,
            },
        )
        self.assertTrue(
            stale_receipt({"version": VERSION, "inputs": before}, after, VERSION)
        )
        self.assertFalse(
            stale_receipt({"version": VERSION, "inputs": before}, before, VERSION)
        )
        self.assertTrue(
            stale_receipt({"version": "orientation-v0", "inputs": before}, before, VERSION)
        )


if __name__ == "__main__":
    unittest.main()
