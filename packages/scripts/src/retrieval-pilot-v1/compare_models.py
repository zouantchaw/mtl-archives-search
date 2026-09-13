"""Summarize measured model runs; require identical image bytes for comparison."""

import argparse
import json
import math
import statistics
from pathlib import Path

from core import digest

p = argparse.ArgumentParser()
p.add_argument("--root", required=True)
p.add_argument("--publish", required=True)
a = p.parse_args()
root = Path(a.root)
pub = Path(a.publish)
pub.mkdir(exist_ok=True)
names = {
    "mistral": "mtl-issue139-pilot-cpu-v3",
    "scout": "mtl-vision-compare-scout-v1",
    "gemma": "mtl-vision-compare-gemma-v2",
}
owner = json.loads(
    (pub.parent / "quality-baseline-v1/owner-review-summary.json").read_text()
)["rows"]


def read(path):
    return json.loads(path.read_text())


def distribution(v):
    return {
        "n": len(v),
        "p50": statistics.median(v),
        "p95": sorted(v)[math.ceil(0.95 * len(v)) - 1],
    }


results = {}
reference = None
for model, folder in names.items():
    run = root / folder
    rows = {
        r["id"]: r
        for r in [
            read(p)
            for p in (run / "enrichment").glob("*.json")
            if not p.name.endswith(".failure.json")
        ]
    }
    images = {k: r["image_sha256"] for k, r in rows.items()}
    if reference is None:
        reference = images
    assert images == reference, "Model inputs differ"
    comparisons = read(run / "comparison.json")
    errors = []
    for gold in owner:
        value = rows[gold["record_id"]]["visual"]["viewpoint"]
        coarse = (
            "aerial / from above"
            if value.startswith("aerial")
            else "ground level"
            if value == "ground"
            else value
        )
        if coarse != gold["viewpoint"]:
            errors.append(gold["audit_id"])
    results[model] = {
        "completed": len(rows),
        "latency_ms": distribution([r["elapsed_ms"] for r in rows.values()]),
        "estimated_generation_usd": sum(r["estimated_usd"] for r in rows.values())
        if all(r["estimated_usd"] is not None for r in rows.values())
        else None,
        "owner_coarse_viewpoint": {
            "correct": len(owner) - len(errors),
            "n": len(owner),
            "disagreements": errors,
        },
        "retrieval": [
            {
                "id": c["id"],
                "split": c["split"],
                "candidate_caption_bge": c["metrics"]["sample_bge_candidate"],
                "feature_filtered": c["metrics"]["live_variants_filtered"],
            }
            for c in comparisons
        ],
    }
orientation = {}
for model, folder in names.items():
    original = read(root / folder / "enrichment/mtl_archives_metadata_12519.json")
    upright = read(
        root
        / ("mtl-vision-upright-" + model)
        / "enrichment/mtl_archives_metadata_12519.json"
    )
    orientation[model] = {
        "original": original["visual"]["viewpoint"],
        "upright": upright["visual"]["viewpoint"],
        "original_image_sha256": original["image_sha256"],
        "upright_image_sha256": upright["image_sha256"],
    }
fresh = read(root / "mtl-vision-fresh-v1/judgments.json")
judgments = []
for gold in fresh["labels"]:
    r = read(root / "mtl-vision-fresh-gemma-v1/enrichment" / gold["id"])
    v = r["visual"]["viewpoint"]
    coarse = "aerial" if v.startswith("aerial") else v
    judgments.append(
        {
            "audit_id": gold["audit_id"],
            "expected": gold["viewpoint"],
            "actual": coarse,
            "correct": coarse == gold["viewpoint"],
            "quarantined": gold["quarantined"],
        }
    )
moondream = []
for f in (root / "mtl-vision-compare-moondream-v1/raw").glob("*.json"):
    r = read(f)
    value = json.loads(r["result"]["answer"])
    moondream.append(
        {
            "id": f.stem,
            "missing_description": "description" not in value,
            "helicopter_prediction": value["features"].get("helicopter"),
            "usage": r["usage"],
        }
    )
summary = {
    "protocol": "vision-comparison-v1",
    "models": results,
    "orientation_diagnostic": orientation,
    "fresh_gemma": {
        "correct": sum(x["correct"] for x in judgments if not x["quarantined"]),
        "n": sum(not x["quarantined"] for x in judgments),
        "authority": "Assistant visual judgments frozen before inference; not independent human gold. One near-overlapping scene excluded. Coarse viewpoint only.",
        "rows": judgments,
    },
    "moondream": {
        "full_run": False,
        "smoke_rows": moondream,
        "decision": "Reject for this unchanged structured caption contract after two invalid, factually wrong outputs; not a general capability verdict.",
    },
    "production_promotable": False,
    "cost_limitations": "Published token-rate estimates for successful generation only; exclude embedding, failed probes, infrastructure and total API cost.",
    "retrieval_limitations": "Local 50-record indexes and frozen live candidates from the prior run; no new traffic/latency experiment. Missing features abstain. Existing historical tests remain report-only.",
}
(pub / "results.json").write_text(json.dumps(summary, indent=2) + "\n")
# Per-run portable private manifests bind raw responses, vectors, plans and generation receipts.
bundles = []
folders = (
    list(names.values())
    + [
        "mtl-vision-compare-gemma-v1",
        "mtl-vision-compare-moondream-v1",
        "mtl-vision-fresh-v1",
        "mtl-vision-fresh-gemma-v1",
    ]
    + ["mtl-vision-upright-" + k for k in names]
)
for name in folders:
    run = root / name
    entries = [
        {
            "path": str(f.relative_to(run)),
            "bytes": f.stat().st_size,
            "sha256": digest(f.read_bytes()),
        }
        for f in sorted(run.rglob("*"))
        if f.is_file() and f.name != "comparison-evidence.json"
    ]
    encoded = json.dumps(entries, sort_keys=True).encode()
    (run / "comparison-evidence.json").write_bytes(encoded)
    bundles.append(
        {"directory": name, "files": len(entries), "manifest_sha256": digest(encoded)}
    )
(pub / "evidence.json").write_text(json.dumps(bundles, indent=2) + "\n")
print(
    "Verified identical image hashes for",
    len(reference),
    "records across three models; fresh result",
    summary["fresh_gemma"]["correct"],
    "/",
    summary["fresh_gemma"]["n"],
)
