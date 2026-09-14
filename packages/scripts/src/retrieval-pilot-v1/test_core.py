import unittest

from core import *


class Contracts(unittest.TestCase):
    def test_failed_unknown_never_matches(self):
        c = [{"field": "viewpoint", "value": "ground"}]
        self.assertEqual(constraint_status({}, c), "unknown")
        self.assertEqual(
            constraint_status({"viewpoint": "aerial_oblique"}, c), "rejected"
        )
        self.assertEqual(constraint_status({"viewpoint": "ground"}, c), "eligible")

    def test_absence_is_not_unknown(self):
        self.assertEqual(
            constraint_status(
                {"features": {"helicopter": "unknown"}},
                [{"field": "helicopter", "value": "absent"}],
            ),
            "unknown",
        )

    def test_corrections_keep_subjects(self):
        previous = [{"field": "signs", "value": "present"}]
        current = [{"field": "viewpoint", "value": "ground"}]
        self.assertEqual(
            retain_constraints(previous, current)["constraints"], previous + current
        )

    def test_conflict_requires_clarification(self):
        self.assertEqual(
            retain_constraints(
                [{"field": "viewpoint", "value": "ground"}],
                [{"field": "viewpoint", "value": "aerial_nadir"}],
            )["status"],
            "clarification_required",
        )

    def test_variants_cannot_erase_original(self):
        p = validate_plan(
            {"variants": ["storefronts"], "constraints": [], "unsupported": False},
            "street view businesses brands",
        )
        self.assertEqual(p["variants"][0], "street view businesses brands")

    def test_unquoted_constraint_rejected(self):
        with self.assertRaises(ValueError):
            validate_plan(
                {
                    "variants": [],
                    "constraints": [
                        {
                            "field": "viewpoint",
                            "value": "ground",
                            "evidence": "invented",
                        }
                    ],
                    "unsupported": False,
                },
                "church",
            )

    def test_rank_duplicates_do_not_inflate(self):
        self.assertEqual(fuse([["a", "a", "b"], ["b"]]), ["b", "a"])

    def test_unknown_promotion_fails(self):
        self.assertFalse(promotion({"precision": True, "cost": None}))
        self.assertFalse(promotion({}))
        self.assertFalse(promotion({"precision": True, "cost": True}))
        self.assertTrue(promotion(dict.fromkeys(REQUIRED_GATES, True)))

    def test_unjudged_not_negative(self):
        m = metrics(["x", "a"], {"positive_ids": ["a"], "reviewed_pool_ids": ["a"]})
        self.assertEqual(m["precision_at_6"], 1)
        self.assertEqual(m["coverage_at_6"], 0.5)

    def test_vectors_dimensions_and_nan(self):
        for a, b in [([1], [1, 2]), ([float("nan")], [1])]:
            with self.assertRaises(ValueError):
                cosine(a, b)


class GrammarRegression(unittest.TestCase):
    def test_french_niveau_not_water(self):
        p = concrete_plan(
            "Des photographies prises depuis le trottoir, au niveau du sol, avec des commerces et des enseignes. Pas de vues aériennes."
        )
        self.assertFalse(p["unsupported"])
        self.assertNotIn("water", [c["field"] for c in p["constraints"]])

    def test_negations_and_unsupported_subjects_abstain(self):
        for q in [
            "no trees beside water",
            "purple elephant beside helicopter",
            "why did the tramways disappear",
            "Inside a church looking toward the altar",
        ]:
            self.assertTrue(concrete_plan(q)["unsupported"])

    def test_tree_water_adjacency_not_cooccurrence(self):
        self.assertTrue(
            concrete_plan(
                "Trees beside water, photographed from the ground, not aerial views."
            )["unsupported"]
        )

    def test_flying_object_not_camera_viewpoint(self):
        p = concrete_plan("helicopter flying above the ground")
        self.assertFalse(any(c["field"] == "viewpoint" for c in p["constraints"]))

    def test_subjects_survive_french_and_correction(self):
        for q in [
            "ground-level street photographs with businesses and signs, not aerial views",
            "street view images with businesses and brands",
        ]:
            p = concrete_plan(q)
            self.assertFalse(p["unsupported"])
            self.assertEqual(
                {c["field"] for c in p["constraints"]},
                {"viewpoint", "storefronts", "signs"},
            )

    def test_provider_echo_must_match(self):
        with self.assertRaises(ValueError):
            validate_plan(
                {
                    "original_query": "changed",
                    "variants": [],
                    "constraints": [],
                    "unsupported": False,
                },
                "original",
            )

    def test_filter_after_diversification(self):
        first = [f"x{i}" for i in range(36)]
        second = [f"y{i}" for i in range(36)]
        pool = fuse([first, second], 108)
        self.assertEqual(len(pool), 72)
        self.assertIn("y35", pool)

    def test_image_kind_is_not_viewpoint(self):
        self.assertEqual(validate_image_kind("map"), "map")
        with self.assertRaises(ValueError):
            validate_image_kind("aerial_oblique")

    def test_orientation_keeps_original_bytes_and_abstains(self):
        original = "a" * 64
        rotated = "b" * 64
        ident = orientation_provenance(
            original, original, 0, "exif", "v1", "accepted"
        )
        self.assertEqual(ident["derived_sha256"], original)
        rotated_rec = orientation_provenance(
            original, rotated, 90, "exif", "v1", "accepted"
        )
        self.assertNotEqual(rotated_rec["derived_sha256"], original)
        abstain = orientation_provenance(
            original, None, None, "exif", "v1", "abstain"
        )
        self.assertIsNone(abstain["degrees"])
        with self.assertRaises(ValueError):
            orientation_provenance(original, original, 90, "exif", "v1", "accepted")

    def test_ocr_does_not_invent_illegible_words(self):
        validate_ocr_evidence(
            {
                "text": "",
                "status": "illegible",
                "method": "pilot",
                "version": "v1",
                "region": None,
            }
        )
        with self.assertRaises(ValueError):
            validate_ocr_evidence(
                {
                    "text": "GAZETTE",
                    "status": "unknown",
                    "method": "pilot",
                    "version": "v1",
                    "region": None,
                }
            )
        with self.assertRaises(ValueError):
            reject_contradictory_features("no water is visible", {"water": "present"})
        with self.assertRaises(ValueError):
            reject_contradictory_features(
                "dark waterways or streets between roofs", {"water": "present"}
            )


if __name__ == "__main__":
    unittest.main()
