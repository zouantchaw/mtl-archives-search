from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from social_identity import ReusePolicyConfig, evaluate_reuse_policy


class SocialIdentityPolicyTest(unittest.TestCase):
    def test_blocks_exact_duplicate_inside_cooldown(self) -> None:
        events = [
            {
                "source": "ledger",
                "status": "generated",
                "date": "2026-06-01",
                "package_id": "old",
                "source_title": "Rue McGill",
                "identity": {
                    "metadata_filename": "mtl_archives_metadata_17.json",
                    "image_filename": "mtl_archives_image_17.jpg",
                    "cote": "VM94,SY,SS1,SSS17,D23",
                    "external_url": None,
                    "title_key": "rue mcgill",
                    "subject_family_key": "rue mcgill",
                    "series_keys": [],
                    "perceptual_hash": None,
                },
            }
        ]
        decision = evaluate_reuse_policy(
            record={
                "metadata_filename": "mtl_archives_metadata_17.json",
                "filename": "mtl_archives_image_17.jpg",
                "name": "Rue McGill",
                "cote": "VM94,SY,SS1,SSS17,D23",
            },
            as_of=date(2026, 6, 15),
            events=events,
            config=ReusePolicyConfig(),
        )
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["blocked_reason"], "recent_exact_or_near_image_reuse")

    def test_blocks_variant_filename_same_subject_family(self) -> None:
        events = [
            {
                "source": "publish_registry",
                "status": "published",
                "date": "2026-06-03",
                "package_id": "2026-06-03::beauty::137",
                "source_title": "Vue aérienne oblique de l'Île Sainte-Hélène",
                "story_angle_key": "beauty ile sainte helene composition",
                "identity": {
                    "metadata_filename": "mtl_archives_metadata_137.json",
                    "image_filename": "mtl_archives_image_137.jpg",
                    "cote": None,
                    "external_url": None,
                    "title_key": "vue aerienne oblique de l ile sainte helene",
                    "subject_family_key": "ile sainte helene",
                    "series_keys": ["aerial ile sainte helene"],
                    "perceptual_hash": None,
                },
            }
        ]
        decision = evaluate_reuse_policy(
            record={
                "metadata_filename": "mtl_archives_metadata_180.json",
                "filename": "mtl_archives_image_180.jpg",
                "name": "Vue aérienne oblique de l'Île Sainte-Hélène",
                "cote": "VM97,S3,D01,P066",
            },
            as_of=date(2026, 6, 15),
            events=events,
            config=ReusePolicyConfig(),
            story_angle_key="mystery eastward island challenge",
            reuse_reason="different mystery angle",
            allow_intentional_reuse=True,
        )
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["blocked_reason"], "subject_family_minimum_gap")

    def test_allows_old_subject_family_reuse_with_different_story(self) -> None:
        events = [
            {
                "source": "publish_registry",
                "status": "published",
                "date": "2026-01-01",
                "package_id": "2026-01-01::beauty::137",
                "source_title": "Vue aérienne oblique de l'Île Sainte-Hélène",
                "story_angle_key": "beauty ile sainte helene composition",
                "identity": {
                    "metadata_filename": "mtl_archives_metadata_137.json",
                    "image_filename": "mtl_archives_image_137.jpg",
                    "cote": None,
                    "external_url": None,
                    "title_key": "vue aerienne oblique de l ile sainte helene",
                    "subject_family_key": "ile sainte helene",
                    "series_keys": ["aerial ile sainte helene"],
                    "perceptual_hash": None,
                },
            }
        ]
        decision = evaluate_reuse_policy(
            record={
                "metadata_filename": "mtl_archives_metadata_180.json",
                "filename": "mtl_archives_image_180.jpg",
                "name": "Vue aérienne oblique de l'Île Sainte-Hélène",
                "cote": "VM97,S3,D01,P066",
            },
            as_of=date(2026, 6, 15),
            events=events,
            config=ReusePolicyConfig(),
            story_angle_key="mystery eastward island challenge",
            reuse_reason="new orientation clue and mystery prompt after cooldown",
            allow_intentional_reuse=True,
        )
        self.assertTrue(decision["allowed"])
        self.assertEqual(decision["reuse_count"]["subject_family"], 1)


if __name__ == "__main__":
    unittest.main()
