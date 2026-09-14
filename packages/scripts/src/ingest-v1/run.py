"""CLI for ingest-v1. Does not publish to production D1, R2, or Vectorize."""

import argparse
import json
from pathlib import Path

from indexes import activate, rollback
from pipeline import IngestRun


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["run", "status", "activate", "rollback"])
    p.add_argument("--source", default="mtl")
    p.add_argument("--input", default="")
    p.add_argument("--out", required=True)
    p.add_argument("--version", default="idx-1")
    p.add_argument("--publish", action="store_true")
    args = p.parse_args()
    run = IngestRun(args.out, adapter=args.source)
    if args.command == "run":
        result = run.run(args.input, version=args.version, publish=args.publish)
        print(json.dumps({"errors": result["errors"], "published": result["published"], "n": result["manifest"]["n"]}, indent=2))
        return
    if args.command == "status":
        print(json.dumps(run.status(), indent=2))
        return
    records = []
    for path in (Path(args.out) / "canonical").glob("*.json"):
        if path.name == "relations.json":
            continue
        records.append(json.loads(path.read_text()))
    failed = run.failed_ids()
    if args.command == "activate":
        print(json.dumps(activate(args.out, args.version, records, failed), indent=2))
        return
    print(json.dumps(rollback(args.out), indent=2))


if __name__ == "__main__":
    main()
