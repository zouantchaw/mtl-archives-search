"""Compare Gateway OpenAI/xAI runs against retained Mistral/Gemma on identical image bytes."""

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
pub.mkdir(parents=True, exist_ok=True)
names = {
    "mistral": "mtl-issue139-pilot-cpu-v3",
    "gemma": "mtl-vision-compare-gemma-v2",
    "openai_gpt_54": "mtl-vision-gateway-openai-v1",
    "xai_grok_46": "mtl-vision-gateway-grok-v1",
}
owner = json.loads(
    (pub.parent / "quality-baseline-v1/owner-review-summary.json").read_text()
)["rows"]


def read(path):
    return json.loads(path.read_text())


def distribution(v):
    if not v:
        return {"n": 0}
    return {
        "n": len(v),
        "p50": statistics.median(v),
        "p95": sorted(v)[math.ceil(0.95 * len(v)) - 1],
    }


def coarse(value):
    if value.startswith("aerial"):
        return "aerial / from above"
    if value == "ground":
        return "ground level"
    return value


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
    else:
        shared = set(reference) & set(images)
        assert all(reference[k] == images[k] for k in shared), "Model inputs differ"
    errors = []
    for gold in owner:
        row = rows.get(gold["record_id"])
        if not row:
            continue
        if coarse(row["visual"]["viewpoint"]) != gold["viewpoint"]:
            errors.append(gold["audit_id"])
    costs = [r["estimated_usd"] for r in rows.values() if r.get("estimated_usd") is not None]
    results[model] = {
        "completed": len(rows),
        "latency_ms": distribution([r["elapsed_ms"] for r in rows.values()]),
        "estimated_generation_usd": sum(costs) if costs else None,
        "owner_coarse_viewpoint": {
            "correct": sum(1 for gold in owner if gold["record_id"] in rows)
            - len(errors),
            "n": sum(1 for gold in owner if gold["record_id"] in rows),
            "disagreements": errors,
        },
        "image_sha256_match": True,
    }

heli = "mtl_archives_metadata_12519.json"
orientation = {}
for model, folder in names.items():
    path = root / folder / "enrichment" / heli
    if path.exists():
        row = read(path)
        orientation[model] = {
            "viewpoint": row["visual"]["viewpoint"],
            "image_sha256": row["image_sha256"],
        }

summary = {
    "protocol": "vision-gateway-v1",
    "models": results,
    "orientation_diagnostic_unchanged_bytes": orientation,
    "production_promotable": False,
    "cost_limitations": "Unified Billing receipts where cost_in_usd_ticks is present; otherwise published token-rate estimates. No full-corpus recaptioning.",
}
(pub / "results.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary["models"], indent=2))
