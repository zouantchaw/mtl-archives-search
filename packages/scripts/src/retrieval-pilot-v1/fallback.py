"""Bounded frontier fallback. Does not write production captions or indexes."""

import argparse
import base64
import json
import time
import urllib.request
from pathlib import Path

from core import digest, validate_enrichment_v2
from escalate import escalation_reasons
from vision_adapters import (
    OPENAI_GPT_54,
    estimate_usd,
    gateway_headers,
    gateway_run_url,
    normalize_response,
    prepare_body,
)

PROMPT = """Classify the image object first, then describe it for retrieval.
image_kind is photograph, map, document, or unknown. A scanned sheet with a title block, legend, or neatline is document even if it shows streets from above. A drawn or printed cartographic sheet is map. Do not call those aerial photographs.
viewpoint is camera pose for photographs only (ground, aerial_oblique, aerial_nadir, interior, unknown). For map or document use unknown.
A sideways photograph can still be ground-level.
Return JSON only with exactly: image_kind, viewpoint, description (2-3 factual sentences), features (storefronts, signs, church_exterior, church_interior, helicopter, people_beside_helicopter, flying_helicopter, trees, water; each present/absent/unknown), uncertainties (array of strings).
Do not invent sign text. Use unknown for water when dark channels might be streets or canals."""


def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def infer(account, token, jpeg_bytes):
    body = prepare_body(
        OPENAI_GPT_54,
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/jpeg;base64,"
                                + base64.b64encode(jpeg_bytes).decode()
                            },
                        },
                    ],
                }
            ],
            "max_tokens": 4096,
            "temperature": 0,
        },
    )
    req = urllib.request.Request(
        gateway_run_url(account),
        data=json.dumps(body).encode(),
        headers=gateway_headers(
            token, {"issue": "fallback-v1", "skip_cache": True}
        ),
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        raw = json.loads(response.read())
    return normalize_response(OPENAI_GPT_54, raw)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--images", required=True, help="Directory of {id}.jpg or audit_id.jpg")
    p.add_argument("--cheap-enrichment", required=True)
    p.add_argument("--review", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--env-file", required=True)
    p.add_argument("--budget-usd", type=float, default=2.0)
    p.add_argument("--max-n", type=int, default=8)
    args = p.parse_args()
    env = load_env(args.env_file)
    account = env.get("CLOUDFLARE_ACCOUNT_ID") or env.get("CLOUDFLARE_R2_ACCOUNT_ID")
    token = env.get("CLOUDFLARE_API_TOKEN") or env.get("CLOUDFLARE_AI_TOKEN")
    review = json.loads(Path(args.review).read_text())
    out = Path(args.output)
    (out / "enrichment").mkdir(parents=True, exist_ok=True)
    cheap = {}
    for path in Path(args.cheap_enrichment).glob("*.json"):
        if path.name.endswith(".failure.json"):
            continue
        row = json.loads(path.read_text())
        cheap[row["id"]] = row
    selected = []
    skipped = []
    flags_by_id = review["records"] if "records" in review else review
    image_dir = Path(args.images)
    for rec_id, flags in flags_by_id.items():
        jpeg_path = image_dir / rec_id.replace(".json", ".jpg")
        if not jpeg_path.exists():
            jpeg_path = image_dir / f"{flags.get('audit_id', rec_id)}.jpg"
        if not jpeg_path.exists():
            skipped.append({"id": rec_id, "status": "missing_image"})
            continue
        jpeg = jpeg_path.read_bytes()
        visual = (cheap.get(rec_id) or {}).get("visual") or {}
        reasons = escalation_reasons(jpeg, visual, flags)
        if not reasons:
            skipped.append({"id": rec_id, "status": "not_selected", "reasons": []})
            continue
        selected.append((rec_id, jpeg, jpeg_path, reasons, flags))
    selected = selected[: args.max_n]
    spent = 0.0
    results = []
    for rec_id, jpeg, jpeg_path, reasons, flags in selected:
        if spent >= args.budget_usd:
            results.append({"id": rec_id, "status": "skipped_budget"})
            continue
        started = time.monotonic()
        response = infer(account, token, jpeg)
        value = json.loads(response["response"])
        validate_enrichment_v2(value)
        cost = estimate_usd(OPENAI_GPT_54, response.get("usage")) or 0
        spent += cost
        artifact = {
            "id": rec_id,
            "status": "generated_unreviewed",
            "model": OPENAI_GPT_54,
            "fallback": True,
            "reasons": reasons,
            "prompt_sha256": digest(PROMPT),
            "image_sha256": digest(jpeg),
            "elapsed_ms": (time.monotonic() - started) * 1000,
            "usage": response.get("usage"),
            "estimated_usd": cost,
            "visual": value,
        }
        (out / "enrichment" / rec_id).write_text(
            json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"
        )
        results.append({"id": rec_id, "status": "generated", "reasons": reasons, "usd": cost})
        print(rec_id, "generated", reasons, round(cost, 4), flush=True)
    (out / "fallback-run.json").write_text(
        json.dumps(
            {
                "model": OPENAI_GPT_54,
                "spent_usd": spent,
                "budget_usd": args.budget_usd,
                "selected": results,
                "skipped": skipped,
                "production_promotable": False,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
