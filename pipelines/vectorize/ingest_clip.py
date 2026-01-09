#!/usr/bin/env python3
import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

USER_AGENT = "mtl-archives-clip/1.0"


def load_env(repo_root: Path) -> None:
    if load_dotenv:
        load_dotenv(repo_root / ".env")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate CLIP image embeddings and upsert to Cloudflare Vectorize.")
    parser.add_argument(
        "--input",
        default=None,
        help="Path to manifest JSONL (default: data/mtl_archives/manifest_vlm_complete.jsonl)",
    )
    parser.add_argument("--limit", type=int, default=0, help="Process only first N records.")
    parser.add_argument("--offset", type=int, default=0, help="Skip first N records.")
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("CLIP_BATCH_SIZE", "64")))
    parser.add_argument("--workers", type=int, default=int(os.getenv("CLIP_DOWNLOAD_WORKERS", "8")))
    parser.add_argument("--prefer-r2", action="store_true", default=os.getenv("CLIP_PREFER_R2", "0") == "1")
    parser.add_argument("--device", default=os.getenv("CLIP_DEVICE", "cuda" if torch.cuda.is_available() else "cpu"))
    return parser.parse_args()


def get_image_url(record: Dict[str, Any], prefer_r2: bool, r2_domain: Optional[str]) -> Optional[str]:
    filename = record.get("resolved_image_filename") or record.get("image_filename")
    if prefer_r2 and r2_domain and filename:
        return f"https://{r2_domain}/{quote(str(filename))}"

    if record.get("external_url"):
        return str(record["external_url"])

    if r2_domain and filename:
        return f"https://{r2_domain}/{quote(str(filename))}"

    return None


def get_metadata(record: Dict[str, Any]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}
    if record.get("name"):
        metadata["name"] = record["name"]
    date = record.get("date_value") or record.get("attributes_map", {}).get("Date")
    if date:
        metadata["date"] = date
    image_key = record.get("resolved_image_filename") or record.get("image_filename")
    if image_key:
        metadata["image"] = image_key
    return metadata


def build_vector(record: Dict[str, Any], embedding: Any) -> Dict[str, Any]:
    values = embedding.tolist() if hasattr(embedding, "tolist") else embedding
    return {
        "id": record["metadata_filename"],
        "values": values,
        "metadata": get_metadata(record) or None,
    }


def fetch_image(url: str, timeout: int = 30) -> Optional[Image.Image]:
    try:
        response = requests.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
        return image
    except Exception:
        return None


def fetch_batch(records: List[Dict[str, Any]], prefer_r2: bool, r2_domain: Optional[str], workers: int) -> Tuple[List[Dict[str, Any]], List[Image.Image]]:
    images: List[Image.Image] = []
    kept_records: List[Dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {}
        for record in records:
            url = get_image_url(record, prefer_r2, r2_domain)
            if not url:
                continue
            futures[executor.submit(fetch_image, url)] = record

        for future in as_completed(futures):
            record = futures[future]
            image = future.result()
            if image is None:
                continue
            kept_records.append(record)
            images.append(image)

    return kept_records, images


def upsert_vectors(endpoint: str, api_token: str, vectors: List[Dict[str, Any]], retries: int = 3) -> bool:
    if not vectors:
        return True
    ndjson = "\n".join(json.dumps(vector) for vector in vectors)

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/x-ndjson",
    }

    for attempt in range(1, retries + 1):
        try:
            response = requests.post(endpoint, headers=headers, data=ndjson, timeout=60)
            if response.ok:
                return True
            print(f"Vectorize upsert failed (attempt {attempt}): {response.status_code} {response.text[:200]}")
        except Exception as exc:
            print(f"Vectorize upsert error (attempt {attempt}): {exc}")
        time.sleep(2 * attempt)

    return False


def main() -> None:
    args = parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    load_env(repo_root)

    input_path = Path(args.input) if args.input else repo_root / "data/mtl_archives/manifest_vlm_complete.jsonl"
    if not input_path.exists():
        raise SystemExit(f"Manifest not found: {input_path}")

    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID") or os.getenv("CLOUDFLARE_R2_ACCOUNT_ID")
    api_token = os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CLOUDFLARE_AI_TOKEN") or os.getenv("CF_AI_TOKEN")
    r2_domain = os.getenv("CLOUDFLARE_R2_PUBLIC_DOMAIN")
    vectorize_index = os.getenv("CLOUDFLARE_VECTORIZE_INDEX", "mtl-archives-clip")

    if not account_id or not api_token:
        raise SystemExit("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN.")

    endpoint = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/vectorize/v2/indexes/"
        f"{quote(vectorize_index)}/upsert"
    )

    print(f"Reading manifest: {input_path}")
    with input_path.open("r", encoding="utf-8") as handle:
        records = [json.loads(line) for line in handle if line.strip()]

    if args.offset:
        records = records[args.offset:]
    if args.limit:
        records = records[: args.limit]

    device = torch.device(args.device)
    print(f"Loading CLIP model on {device}...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.to(device)
    model.eval()

    total = len(records)
    processed = 0
    skipped = 0

    for start in range(0, total, args.batch_size):
        batch = records[start : start + args.batch_size]
        kept_records, images = fetch_batch(batch, args.prefer_r2, r2_domain, args.workers)

        if not images:
            skipped += len(batch)
            print(f"Processed: {processed}, Skipped: {skipped}")
            continue

        inputs = processor(images=images, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.inference_mode():
            features = model.get_image_features(**inputs)
            features = features / features.norm(dim=-1, keepdim=True)

        vectors = []
        for record, embedding in zip(kept_records, features.cpu().tolist()):
            vectors.append(build_vector(record, embedding))

        if upsert_vectors(endpoint, api_token, vectors):
            processed += len(vectors)
            skipped += len(batch) - len(vectors)
        else:
            skipped += len(batch)

        print(f"Processed: {processed}, Skipped: {skipped}")

    print(f"Complete. Processed: {processed}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
