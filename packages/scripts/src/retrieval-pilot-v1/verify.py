"""Verify published evidence and replay ranking/metrics entirely on CPU, offline."""

import argparse
import json
from pathlib import Path

from core import (
    concrete_plan,
    constraint_status,
    cosine,
    digest,
    fuse,
    lexical,
    metrics,
)

p = argparse.ArgumentParser()
p.add_argument("--output", required=True)
p.add_argument("--baseline", required=True)
p.add_argument("--published", required=True)
a = p.parse_args()
out = Path(a.output).resolve()
pub = Path(a.published)


def read(name):
    return json.loads((out / name).read_text())


manifest = json.loads((pub / "evidence-manifest.json").read_text())
for entry in manifest["files"]:
    path = (out / entry["path"]).resolve()
    if not path.is_relative_to(out):
        raise ValueError("Evidence path traversal")
    data = path.read_bytes()
    if digest(data) != entry["sha256"] or len(data) != entry["bytes"]:
        raise ValueError("Evidence bytes changed: " + entry["path"])
cases = json.loads((Path(a.baseline) / "evaluation-cases.json").read_text())
assert (
    digest((Path(a.baseline) / "evaluation-cases.json").read_bytes())
    == read("manifest.json")["cases_sha256"]
)
index = read("candidate-index.json")
vectors = index["vectors"]
documents = index["documents"]
plans = read("plans.json")
search = read("search-results.json")
saved = {r["id"]: r for r in read("comparison.json")}
rows = read("records.json")
enriched = {
    r["metadata_filename"]: read("enrichment/" + r["metadata_filename"]) for r in rows
}
for c in cases:
    plan = plans[c["id"]]["value"]["plan"]
    assert concrete_plan(c["query"]) == plan, "CPU plan drift: " + c["id"]
    ranks = {}
    for version in ["legacy", "candidate"]:
        docs = {
            k.split(":", 1)[1]: v
            for k, v in documents.items()
            if k.startswith(version + ":")
        }
        ranks["cpu_lexical_" + version] = lexical(c["query"], docs)[:36]
        q = vectors[c["id"] + ":0"]
        ranks["sample_bge_" + version] = sorted(
            docs, key=lambda k: -cosine(q, vectors[version + ":" + k])
        )[:36]
    results = [r for r in search if r["case"] == c["id"] and r["repeat"] == 0]
    ranks["live_original"] = next(
        r["value"]["ids"] for r in results if r["variant"] == 0 and r["status"] == "ok"
    )
    lists = [r["value"]["ids"] for r in results if r["status"] == "ok"]
    ranks["live_variants"] = fuse(lists)
    ranks["live_candidate_pool"] = fuse(lists, 108)
    for name, source in [
        ("sample_bge_filtered", "sample_bge_candidate"),
        ("live_variants_filtered", "live_candidate_pool"),
    ]:
        ranks[name] = [
            k
            for k in ranks[source]
            if not plan["unsupported"]
            and k in enriched
            and constraint_status(enriched[k]["visual"], plan["constraints"])
            == "eligible"
        ][:36]
    assert ranks == saved[c["id"]]["rankings"], "Ranking drift: " + c["id"]
    assert {k: metrics(v, c) for k, v in ranks.items()} == saved[c["id"]]["metrics"], (
        "Metric drift: " + c["id"]
    )
print(
    f"Verified {len(manifest['files'])} artifact hashes; replayed all rankings and metrics for {len(cases)} queries with no network calls."
)
