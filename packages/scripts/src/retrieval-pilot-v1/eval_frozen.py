"""Score model enrichments against frozen labels. Candidate captions stay inactive."""

import argparse
import json
import re
from pathlib import Path

from core import (
    INFERRED_CANONICAL_KEYS,
    reject_contradictory_features,
    validate_feature_basis,
    validate_ocr_evidence,
)

HEDGE_WATER = re.compile(
    r"waterways or streets|water vs\.? (?:roads|streets)|may be pavement|dark channels versus|canals? form|unfrozen",
    re.I,
)


def load_json(path):
    return json.loads(Path(path).read_text())


def contains_phrase(text, phrase):
    return phrase.lower() in (text or "").lower()


def ocr_blob(visual):
    items = visual.get("ocr")
    if not isinstance(items, list):
        return None
    return " ".join(
        item.get("text") or "" for item in items if isinstance(item, dict)
    )


def score_record(label, visual):
    description = visual.get("description") or ""
    features = visual.get("features") or {}
    rows = []
    inferred = [k for k in INFERRED_CANONICAL_KEYS if k in visual]
    rows.append(
        {
            "check": "inferred_canonical",
            "ok": not inferred,
            "actual": inferred,
        }
    )
    if label.get("viewpoint"):
        actual = visual.get("viewpoint")
        expected = label["viewpoint"]
        if expected == "ground":
            ok = actual == "ground"
        elif expected.startswith("aerial"):
            ok = isinstance(actual, str) and actual.startswith("aerial")
        else:
            ok = actual == expected
        rows.append({"check": "viewpoint", "ok": ok, "expected": expected, "actual": actual})
    if label.get("image_kind"):
        actual = visual.get("image_kind")
        expected = label["image_kind"]
        if actual is None:
            ok = expected == "photograph"
            note = "missing kind allowed only for ordinary photographs"
        elif expected in ("map", "document"):
            ok = actual in ("map", "document")
            note = None
        else:
            ok = actual == expected
            note = None
        rows.append(
            {
                "check": "image_kind",
                "ok": ok,
                "expected": expected,
                "actual": actual,
                "note": note,
            }
        )
    ocr_text = ocr_blob(visual)
    for ocr in label.get("ocr") or []:
        if ocr["status"] == "exact":
            rows.append(
                {
                    "check": "ocr_exact",
                    "ok": ocr_text is not None
                    and contains_phrase(ocr_text, ocr["text"]),
                    "expected": ocr["text"],
                    "stored_separately": ocr_text is not None,
                }
            )
        elif ocr["status"] == "unsupported":
            rows.append(
                {
                    "check": "ocr_unsupported",
                    "ok": not contains_phrase(description, ocr["text"])
                    and not contains_phrase(ocr_text or "", ocr["text"]),
                    "forbidden": ocr["text"],
                }
            )
    if label.get("ocr_empty"):
        items = visual.get("ocr")
        empty = items == [] or (
            isinstance(items, list)
            and all(
                isinstance(i, dict)
                and i.get("status") in ("unknown", "illegible")
                and not i.get("text")
                for i in items
            )
        )
        rows.append({"check": "ocr_empty", "ok": items is not None and empty})
    if isinstance(visual.get("ocr"), list):
        valid = True
        try:
            for item in visual["ocr"]:
                validate_ocr_evidence(item)
        except ValueError:
            valid = False
        rows.append({"check": "ocr_schema", "ok": valid})
    if visual.get("feature_basis") is not None:
        basis_ok = False
        try:
            if set(features) == set(visual["feature_basis"]):
                validate_feature_basis(features, visual["feature_basis"])
                basis_ok = True
        except ValueError:
            basis_ok = False
        rows.append({"check": "feature_basis", "ok": basis_ok})
    if "water" in (label.get("features") or {}):
        expected = label["features"]["water"]
        actual = features.get("water")
        hedged = bool(HEDGE_WATER.search(description))
        contradiction = False
        try:
            reject_contradictory_features(description, features)
        except ValueError:
            contradiction = True
        if hedged and actual == "present":
            contradiction = True
        ok = actual == expected if expected != "unknown" else actual in ("unknown", "absent") or (
            actual == "present" and not hedged
        )
        # Frozen unknown: asserting present while hedging fails; unknown/absent pass.
        if expected == "unknown":
            ok = actual == "unknown"
        rows.append(
            {
                "check": "water",
                "ok": ok and not contradiction,
                "expected": expected,
                "actual": actual,
                "hedged": hedged,
            }
        )
    return rows


def evaluate(labels, enrichments):
    by_id = {r["id"]: r for r in enrichments}
    report = []
    for label in labels["records"]:
        row = by_id.get(label["id"])
        visual = (row or {}).get("visual") or {}
        if not row:
            report.append(
                {
                    "audit_id": label["audit_id"],
                    "id": label["id"],
                    "skipped": True,
                    "passed": False,
                    "checks": [{"check": "missing", "ok": False}],
                }
            )
            continue
        checks = score_record(label, visual)
        report.append(
            {
                "audit_id": label["audit_id"],
                "id": label["id"],
                "skipped": False,
                "passed": all(c["ok"] for c in checks),
                "checks": checks,
            }
        )
    scored = [r for r in report if not r["skipped"]]
    return {
        "protocol": labels["version"],
        "n": len(scored),
        "passed": sum(r["passed"] for r in scored),
        "production_promotable": False,
        "records": report,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--labels", required=True)
    p.add_argument("--enrichment-dir", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    labels = load_json(a.labels)
    rows = []
    for path in Path(a.enrichment_dir).glob("*.json"):
        if path.name.endswith(".failure.json"):
            continue
        rows.append(load_json(path))
    report = evaluate(labels, rows)
    report["model"] = a.model
    Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    print(a.model, report["passed"], "/", report["n"])


if __name__ == "__main__":
    main()
