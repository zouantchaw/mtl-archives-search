"""Inactive OCR fixtures for the frozen labels. Not production captions."""

import json
from pathlib import Path

from core import FEATURES, validate_enrichment_v3

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "docs/ocr-eval-v1/fixtures"

UNKNOWN = {k: "unknown" for k in FEATURES}
UNKNOWN_BASIS = {k: "unknown" for k in FEATURES}


def visual(kind, viewpoint, description, features, basis, ocr):
    body = {
        "description": description,
        "viewpoint": viewpoint,
        "image_kind": kind,
        "features": {**UNKNOWN, **features},
        "uncertainties": [],
        "ocr": ocr,
        "feature_basis": {**UNKNOWN_BASIS, **basis},
    }
    return validate_enrichment_v3(body)


def ocr(text, region, image_sha256):
    return {
        "text": text,
        "status": "exact",
        "method": "human-visual",
        "version": "ocr-v1",
        "region": region,
        "image_sha256": image_sha256,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = {
        "mtl_archives_metadata_0.json": {
            "id": "mtl_archives_metadata_0.json",
            "status": "generated_unreviewed",
            "production_promotable": False,
            "visual": visual(
                "photograph",
                "ground",
                "Ground-level street with painted wall advertisements and a rooftop tank. Sign wording is stored as OCR, not as archive metadata.",
                {"signs": "present", "water": "absent", "storefronts": "unknown"},
                {"signs": "pixels", "water": "pixels"},
                [
                    ocr(
                        "The Gazette",
                        "rooftop water tower, right",
                        "d1a40336b008d076d0ad7d3e5f18f459f931de14e8656a06bf9dae0a4d72c1f3",
                    ),
                    ocr(
                        "MAGIC BAKING POWDER",
                        "left billboard",
                        "d1a40336b008d076d0ad7d3e5f18f459f931de14e8656a06bf9dae0a4d72c1f3",
                    ),
                ],
            ),
        },
        "mtl_archives_metadata_16144.json": {
            "id": "mtl_archives_metadata_16144.json",
            "status": "generated_unreviewed",
            "production_promotable": False,
            "visual": visual(
                "photograph",
                "aerial_nadir",
                "Snow-covered roofs with dark channels between them. Those channels are not identified as water.",
                {"water": "unknown"},
                {},
                [],
            ),
        },
        "mtl_archives_metadata_12519.json": {
            "id": "mtl_archives_metadata_12519.json",
            "status": "generated_unreviewed",
            "production_promotable": False,
            "visual": visual(
                "photograph",
                "ground",
                "A helicopter sits above a paved area with buildings along one side and a bright cloudy sky.",
                {"helicopter": "present", "flying_helicopter": "present"},
                {"helicopter": "pixels", "flying_helicopter": "pixels"},
                [],
            ),
        },
        "mtl_archives_metadata_15507.json": {
            "id": "mtl_archives_metadata_15507.json",
            "status": "generated_unreviewed",
            "production_promotable": False,
            "visual": visual(
                "document",
                "unknown",
                "A scanned planning sheet shows a printed aerial of suburban streets and a title block along the lower right. Lettering in that block is OCR evidence, not a canonical photograph date.",
                {},
                {},
                [
                    ocr(
                        "SERVICE D'URBANISME",
                        "title block, lower right",
                        "9100d4f99269303d6c58a331b65b370127361b330af07a6913b172cfca814e76",
                    ),
                    ocr(
                        "PLANNING DEPARTMENT",
                        "title block, lower right",
                        "9100d4f99269303d6c58a331b65b370127361b330af07a6913b172cfca814e76",
                    ),
                    ocr(
                        "NOVEMBRE 1969",
                        "title block date line",
                        "9100d4f99269303d6c58a331b65b370127361b330af07a6913b172cfca814e76",
                    ),
                ],
            ),
        },
    }
    for name, row in rows.items():
        path = OUT / name
        path.write_text(json.dumps(row, indent=2) + "\n")
        print(path)


if __name__ == "__main__":
    main()
