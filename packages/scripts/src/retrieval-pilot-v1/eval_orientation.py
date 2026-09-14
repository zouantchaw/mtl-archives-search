"""Labeled orientation eval. Never overwrites originals or production captions."""

import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

from core import (
    digest,
    enrichment_stage_inputs,
    stale_receipt,
    stage_cache_id,
)
from orientation import (
    VERSION,
    derive_upright,
    read_exif_orientation_raw,
    reviewed_rotate,
    write_derived,
)


def jpeg_with_exif(orientation, size=(48, 32)):
    image = Image.new("RGB", size, (20, 40, 80))
    ImageDraw.Draw(image).rectangle([0, 0, size[0], 6], fill=(255, 0, 0))
    buf = io.BytesIO()
    kwargs = {"format": "JPEG", "quality": 95}
    if orientation is not None:
        exif = image.getexif()
        exif[274] = orientation
        kwargs["exif"] = exif
    image.save(buf, **kwargs)
    return buf.getvalue()


def reencode(jpeg_bytes):
    buf = io.BytesIO()
    Image.open(io.BytesIO(jpeg_bytes)).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def find_image(images_dir, record_id, audit_id):
    if not images_dir:
        return None
    for name in (
        f"{audit_id}.jpg",
        record_id.replace(".json", ".jpg"),
        record_id,
    ):
        path = images_dir / name
        if path.is_file():
            return path
    return None


def score_bytes(jpeg_bytes, expected_review=None, label=None):
    original_sha = digest(jpeg_bytes)
    derived, rec = derive_upright(jpeg_bytes)
    resaved = reencode(jpeg_bytes)
    checks = [
        {
            "check": "original_hash_stable",
            "ok": digest(jpeg_bytes) == original_sha,
        },
        {
            "check": "reencode_control_changes_bytes",
            "ok": resaved != jpeg_bytes,
        },
        {
            "check": "identity_does_not_resave",
            "ok": rec["review_state"] != "accepted"
            or rec.get("degrees") != 0
            or derived == jpeg_bytes,
        },
        {
            "check": "transform_changes_bytes",
            "ok": rec.get("degrees") in (None, 0) or derived != jpeg_bytes,
        },
    ]
    if expected_review:
        checks.append(
            {
                "check": "review_state",
                "ok": rec["review_state"] == expected_review,
                "expected": expected_review,
                "actual": rec["review_state"],
            }
        )
    if label and label.get("image_kind") in ("map", "document"):
        checks.append(
            {
                "check": "sheet_does_not_invent_exif_rotation",
                "ok": rec["review_state"] in ("abstain", "review")
                or rec.get("degrees") == 0,
            }
        )
    return {
        "original_sha256": original_sha,
        "exif": read_exif_orientation_raw(jpeg_bytes),
        "orientation": rec,
        "reencode_sha256": digest(resaved),
        "checks": checks,
        "passed": all(c["ok"] for c in checks),
    }


def synthetic_cases():
    return [
        {"audit_id": "S1", "exif": 1, "expected_review": "accepted"},
        {"audit_id": "S3", "exif": 3, "expected_review": "accepted"},
        {"audit_id": "S6", "exif": 6, "expected_review": "accepted"},
        {"audit_id": "S8", "exif": 8, "expected_review": "accepted"},
        {"audit_id": "S2", "exif": 2, "expected_review": "review"},
        {"audit_id": "S0", "exif": None, "expected_review": "abstain"},
    ]


def evaluate(labels, images_dir=None, output_dir=None):
    records = []
    for label in labels.get("records") or []:
        path = find_image(images_dir, label["id"], label["audit_id"])
        expected = (label.get("orientation") or {}).get("expected_review_state")
        if path is None:
            records.append(
                {
                    "audit_id": label["audit_id"],
                    "id": label["id"],
                    "skipped": True,
                    "passed": False,
                    "checks": [{"check": "missing_image", "ok": False}],
                }
            )
            continue
        original = path.read_bytes()
        scored = score_bytes(original, expected, label)
        if output_dir is not None and scored["orientation"].get("degrees"):
            write_derived(path, derive_upright(original)[0], output_dir)
        if path.read_bytes() != original:
            scored["checks"].append({"check": "source_not_overwritten", "ok": False})
            scored["passed"] = False
        else:
            scored["checks"].append({"check": "source_not_overwritten", "ok": True})
        records.append(
            {
                "audit_id": label["audit_id"],
                "id": label["id"],
                "skipped": False,
                **scored,
            }
        )
    for case in synthetic_cases():
        jpeg = jpeg_with_exif(case["exif"])
        scored = score_bytes(jpeg, case["expected_review"])
        records.append(
            {
                "audit_id": case["audit_id"],
                "id": None,
                "skipped": False,
                "synthetic": True,
                **scored,
            }
        )
    if images_dir:
        a44 = find_image(images_dir, "mtl_archives_metadata_12519.json", "A44")
        if a44:
            original = a44.read_bytes()
            derived, rec = reviewed_rotate(original, 90)
            stale = stale_receipt(
                {
                    "version": VERSION,
                    "inputs": enrichment_stage_inputs(digest(original), rec),
                },
                enrichment_stage_inputs(
                    digest(original),
                    derive_upright(original)[1],
                ),
                VERSION,
            )
            records.append(
                {
                    "audit_id": "A44_reviewed_rotate",
                    "id": "mtl_archives_metadata_12519.json",
                    "skipped": False,
                    "orientation": rec,
                    "checks": [
                        {
                            "check": "reviewed_transform_changes_bytes",
                            "ok": derived != original,
                        },
                        {
                            "check": "source_not_overwritten",
                            "ok": a44.read_bytes() == original,
                        },
                        {
                            "check": "enrichment_stale_after_orientation_change",
                            "ok": stale,
                        },
                    ],
                    "passed": derived != original
                    and a44.read_bytes() == original
                    and stale,
                }
            )
    scored = [r for r in records if not r.get("skipped")]
    return {
        "protocol": "orientation-eval-v1",
        "n": len(scored),
        "passed": sum(1 for r in scored if r["passed"]),
        "production_promotable": False,
        "records": records,
        "enrichment_cache_example": stage_cache_id(
            enrichment_stage_inputs("a" * 64, {"version": VERSION, "review_state": "abstain"})
        ),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--labels", required=True)
    p.add_argument("--images", default="")
    p.add_argument("--derived-dir", default="")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    labels = json.loads(Path(a.labels).read_text())
    report = evaluate(
        labels,
        Path(a.images) if a.images else None,
        Path(a.derived_dir) if a.derived_dir else None,
    )
    Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    print(report["passed"], "/", report["n"], "production_promotable", report["production_promotable"])


if __name__ == "__main__":
    main()
