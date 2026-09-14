import unittest

from eval_frozen import evaluate


LABELS = {
    "version": "vision-eval-v1",
    "records": [
        {
            "audit_id": "A25",
            "id": "a25.json",
            "image_kind": "photograph",
            "viewpoint": "ground",
            "ocr": [
                {"text": "The Gazette", "status": "exact"},
                {"text": "The Gazel", "status": "unsupported"},
            ],
            "features": {"water": "absent"},
        },
        {
            "audit_id": "A40",
            "id": "a40.json",
            "viewpoint": "aerial_nadir",
            "features": {"water": "unknown"},
        },
    ],
}


def ocr_item(text, status="exact"):
    return {
        "text": text,
        "status": status,
        "method": "pilot",
        "version": "ocr-v1",
        "region": "sign",
    }


class FrozenEval(unittest.TestCase):
    def test_gazette_must_live_in_ocr_not_the_caption(self):
        caption_only = evaluate(
            LABELS,
            [
                {
                    "id": "a25.json",
                    "visual": {
                        "description": "Ground view. The Gazette tower and MAGIC BAKING POWDER.",
                        "viewpoint": "ground",
                        "image_kind": "photograph",
                        "features": {"water": "absent", "signs": "present"},
                    },
                }
            ],
        )
        self.assertFalse(
            next(r for r in caption_only["records"] if r["audit_id"] == "A25")["passed"]
        )
        report = evaluate(
            LABELS,
            [
                {
                    "id": "a25.json",
                    "visual": {
                        "description": "Ground-level street with painted wall advertisements. Wording is stored as OCR.",
                        "viewpoint": "ground",
                        "image_kind": "photograph",
                        "features": {"water": "absent", "signs": "present"},
                        "ocr": [
                            ocr_item("The Gazette"),
                            ocr_item("MAGIC BAKING POWDER"),
                        ],
                    },
                }
            ],
        )
        a25 = next(r for r in report["records"] if r["audit_id"] == "A25")
        self.assertTrue(a25["passed"])
        bad = evaluate(
            LABELS,
            [
                {
                    "id": "a25.json",
                    "visual": {
                        "description": "A rooftop sign reads The Gazel.",
                        "viewpoint": "ground",
                        "image_kind": "photograph",
                        "features": {"water": "absent"},
                        "ocr": [ocr_item("The Gazel")],
                    },
                }
            ],
        )
        self.assertFalse(next(r for r in bad["records"] if r["audit_id"] == "A25")["passed"])

    def test_hedged_water_cannot_be_present(self):
        report = evaluate(
            LABELS,
            [
                {
                    "id": "a40.json",
                    "visual": {
                        "description": "Dark waterways or streets between snowy roofs.",
                        "viewpoint": "aerial_oblique",
                        "features": {"water": "present"},
                    },
                }
            ],
        )
        a40 = next(r for r in report["records"] if r["audit_id"] == "A40")
        self.assertFalse(a40["passed"])

    def test_inactive_fixtures_pass_frozen_gazette_water_and_fresh_title_block(self):
        from pathlib import Path
        import json
        from eval_frozen import load_json

        root = Path(__file__).resolve().parents[4]
        labels = load_json(root / "docs/vision-eval-v1/frozen-labels.json")
        rows = [
            json.loads(path.read_text())
            for path in (root / "docs/ocr-eval-v1/fixtures").glob("*.json")
        ]
        report = evaluate(labels, rows)
        self.assertEqual(report["passed"], 4)
        self.assertEqual(report["n"], 4)
        self.assertFalse(report["production_promotable"])


if __name__ == "__main__":
    unittest.main()
