from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from post_publish import _platform_already_published
from story_registry import existing_story_delivery


class PublishIdempotencyTest(unittest.TestCase):
    def test_post_platform_already_published_uses_package_and_platform(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            registry = Path(tmpdir) / "publish-registry.jsonl"
            registry.write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "package_id": "pkg-1",
                                "platform": "instagram",
                                "status": "published",
                                "post_id": "ig-1",
                            }
                        ),
                        json.dumps(
                            {
                                "package_id": "pkg-1",
                                "platform": "facebook",
                                "status": "prepared",
                                "post_id": "fb-prep",
                            }
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(
                _platform_already_published(
                    registry_path=registry,
                    package_id="pkg-1",
                    platform="instagram",
                )["post_id"],
                "ig-1",
            )
            self.assertIsNone(
                _platform_already_published(
                    registry_path=registry,
                    package_id="pkg-1",
                    platform="facebook",
                )
            )

    def test_story_registry_treats_prepared_as_delivered_for_platform_date(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            registry = Path(tmpdir) / "story-registry.jsonl"
            registry.write_text(
                json.dumps(
                    {
                        "date": "2026-06-16",
                        "platform": "instagram",
                        "status": "prepared",
                        "creation_id": "container-1",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(
                existing_story_delivery(
                    registry_path=registry,
                    story_date="2026-06-16",
                    platform="instagram",
                )["creation_id"],
                "container-1",
            )
            self.assertIsNone(
                existing_story_delivery(
                    registry_path=registry,
                    story_date="2026-06-16",
                    platform="facebook",
                )
            )


if __name__ == "__main__":
    unittest.main()
