"""CLI for the second-source onboarding demo. Does not publish production indexes."""

import argparse
import json
from pathlib import Path

from onboard import Onboard


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["preview", "pilot", "report"])
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--job", default="second-1")
    args = p.parse_args()
    onboard = Onboard(args.out)
    if args.command == "preview":
        print(json.dumps(onboard.preview(args.input), indent=2))
        return
    if args.command == "pilot":
        print(json.dumps({"interrupted": onboard.pilot(args.input, args.job)["interrupted"], "private": True}, indent=2))
        return
    print(json.dumps(onboard.report(args.input, args.job), indent=2))


if __name__ == "__main__":
    main()
