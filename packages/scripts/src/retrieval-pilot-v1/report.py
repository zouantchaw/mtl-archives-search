"""Publish safe, reproducible summaries; no caption text, raw provider output or pixels."""

import argparse
import json
import math
import statistics
from pathlib import Path

from core import digest, promotion_receipt

p = argparse.ArgumentParser()
p.add_argument("--output", required=True)
p.add_argument("--publish", required=True)
a = p.parse_args()
out = Path(a.output)
pub = Path(a.publish)
pub.mkdir(parents=True, exist_ok=True)


def read(name):
    return json.loads((out / name).read_text())


def dist(values):
    values = sorted(values)
    return {
        "n": len(values),
        "p50": statistics.median(values) if values else None,
        "p95": values[math.ceil(0.95 * len(values)) - 1] if values else None,
    }


rows = read("records.json")
generated = [
    read("enrichment/" + r["metadata_filename"])
    for r in rows
    if (out / "enrichment" / r["metadata_filename"]).exists()
]
search = read("search-results.json")
comparison = read("comparison.json")
owner = json.loads(
    (pub.parent / "quality-baseline-v1/owner-review-summary.json").read_text()
)
by = {r["id"]: r for r in generated}
checks = []
for r in owner["rows"]:
    v = by[r["record_id"]]["visual"]["viewpoint"]
    v = (
        "aerial / from above"
        if v.startswith("aerial")
        else "ground level"
        if v == "ground"
        else v
    )
    checks.append(
        {
            "audit_id": r["audit_id"],
            "agrees_with_owner_coarse_viewpoint": v == r["viewpoint"],
            "candidate_viewpoint": by[r["record_id"]]["visual"]["viewpoint"],
        }
    )
summary = {
    "version": "retrieval-pilot-v1",
    "scope": "50-record local candidate index plus live full-corpus retrieval variants. No production promotion.",
    "generation": {
        "selected": len(rows),
        "completed": len(generated),
        "latency_ms": dist([r["elapsed_ms"] for r in generated]),
        "estimated_model_usd": sum(r["estimated_usd"] for r in generated)
        if all(r["estimated_usd"] is not None for r in generated)
        else None,
        "price_basis": "Cloudflare published input/output token rates, not invoice attribution. Other providers, failures, embedding and search costs excluded.",
    },
    "owner_viewpoint_comparison": {
        "n": len(checks),
        "disagreements": sum(
            not x["agrees_with_owner_coarse_viewpoint"] for x in checks
        ),
        "rows": checks,
        "limitation": "Coarse aerial/ground agreement does not validate nadir versus oblique, objects, OCR or caption accuracy.",
    },
    "traffic": {
        "requests": len(search),
        "successful": sum(r["status"] == "ok" for r in search),
        "latency_ms": dist([r["elapsed_ms"] for r in search if r["status"] == "ok"]),
        "rounds": [
            {
                "repeat": i,
                "concurrency": [1, 2, 2][i],
                "latency_ms": dist(
                    [
                        r["elapsed_ms"]
                        for r in search
                        if r["repeat"] == i and r["status"] == "ok"
                    ]
                ),
            }
            for i in range(3)
        ],
        "limitation": "Scripted pilot mix, not production load or browser end-to-end latency. API cache state unknown.",
        "search_inference_usd": None,
    },
    "cpu_planner_ms": dist([v["elapsed_ms"] for v in read("plans.json").values()]),
    "comparisons": [
        {k: v for k, v in r.items() if k not in ["rankings", "constraints"]}
        for r in comparison
    ],
    "promotion": promotion_receipt(
        {
            "caption_review": False,
            "constraint_violations": False,
            "constraint_retention": True,
            "heldout_precision": None,
            "heldout_recall": None,
            "completion": all(r["status"] == "ok" for r in search),
            "search_latency": dist(
                [r["elapsed_ms"] for r in search if r["status"] == "ok"]
            )["p95"]
            <= 2000,
            "research_latency": None,
            "cost": None,
            "worst_slice_regression": False,
            "full_corpus_coverage": False,
            "rollback_verified": True,
        }
    ),
}
(pub / "results.json").write_text(json.dumps(summary, indent=2) + "\n")
manifest = []
for p in sorted(out.rglob("*.json")):
    manifest.append(
        {
            "path": str(p.relative_to(out)),
            "sha256": digest(p.read_bytes()),
            "bytes": p.stat().st_size,
        }
    )
(pub / "evidence-manifest.json").write_text(
    json.dumps({"private_directory_name": out.name, "files": manifest}, indent=2) + "\n"
)
print(
    json.dumps(
        {
            k: v
            for k, v in summary.items()
            if k in ["generation", "traffic", "cpu_planner_ms", "promotion"]
        },
        indent=2,
    )
)
