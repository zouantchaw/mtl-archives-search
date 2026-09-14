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


class FrozenEval(unittest.TestCase):
    def test_gazette_exact_and_gazel_forbidden(self):
        report = evaluate(
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


if __name__ == "__main__":
    unittest.main()
