#!/usr/bin/env python3
"""
Generate CLIP image embeddings and upsert to Cloudflare Vectorize.

Downloads images from R2 (via public domain or signed URLs), generates
512-dim CLIP embeddings using openai/clip-vit-base-patch32, and uploads
to the mtl-archives-clip Vectorize index.

Required environment variables:
- CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_R2_ACCOUNT_ID
- CLOUDFLARE_API_TOKEN or CLOUDFLARE_AI_TOKEN
- CLOUDFLARE_R2_PUBLIC_DOMAIN (for image downloads)

Optional:
- CLIP_BATCH_SIZE (default: 8)
- CLIP_LIMIT (limit records for testing)
- CLIP_OFFSET (start from record N)
"""

import json
import os
import sys
import time
from io import BytesIO
from pathlib import Path

import requests
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    # Fallback manual .env loading
    def _load_dotenv():
        env_path = Path(__file__).parent.parent.parent / ".env"
        if not env_path.exists():
            return
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # Remove quotes and handle corrupted lines
            if value.startswith('"'):
                end = value.find('"', 1)
                if end > 0:
                    value = value[1:end]
            elif value.startswith("'"):
                end = value.find("'", 1)
                if end > 0:
                    value = value[1:end]
            if key and key not in os.environ:
                os.environ[key] = value
    _load_dotenv()

# Configuration
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_R2_ACCOUNT_ID")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CLOUDFLARE_AI_TOKEN")
R2_PUBLIC_DOMAIN = os.environ.get("CLOUDFLARE_R2_PUBLIC_DOMAIN")
VECTORIZE_INDEX = os.environ.get("CLOUDFLARE_VECTORIZE_INDEX", "mtl-archives-clip")
BATCH_SIZE = int(os.environ.get("CLIP_BATCH_SIZE", "8"))
LIMIT = int(os.environ.get("CLIP_LIMIT", "0")) or None
OFFSET = int(os.environ.get("CLIP_OFFSET", "0"))

if not ACCOUNT_ID:
    print("Error: Set CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_R2_ACCOUNT_ID", file=sys.stderr)
    sys.exit(1)

if not API_TOKEN:
    print("Error: Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_AI_TOKEN", file=sys.stderr)
    sys.exit(1)

# R2_PUBLIC_DOMAIN is optional - will use external_url from manifest if not set
if not R2_PUBLIC_DOMAIN:
    print("Note: CLOUDFLARE_R2_PUBLIC_DOMAIN not set, using external_url from manifest")

# Find manifest file
MANIFEST_PATHS = [
    Path("data/mtl_archives/manifest_clean.jsonl"),
    Path("data/mtl_archives/export/manifest_enriched.ndjson"),
]
manifest_path = next((p for p in MANIFEST_PATHS if p.exists()), None)
if not manifest_path:
    print(f"Error: Cannot find manifest at {MANIFEST_PATHS}", file=sys.stderr)
    sys.exit(1)

# Load CLIP model
print("Loading CLIP model (openai/clip-vit-base-patch32)...")
device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Using device: {device}")
# Use safetensors format to avoid torch.load vulnerability in older PyTorch versions
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32", use_safetensors=True).to(device)
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
model.eval()

# Vectorize API endpoint
VECTORIZE_ENDPOINT = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/vectorize/v2/indexes/{VECTORIZE_INDEX}/upsert"


def load_records():
    """Load manifest records."""
    print(f"Loading manifest from: {manifest_path}")
    records = []
    for line in manifest_path.read_text().splitlines():
        if line.strip():
            records.append(json.loads(line))

    # Apply offset and limit
    if OFFSET:
        records = records[OFFSET:]
    if LIMIT:
        records = records[:LIMIT]

    return records


def download_image(record: dict) -> Image.Image | None:
    """Download image from external URL (Montreal archives) or R2."""
    # Prefer external_url (original Montreal archives source)
    url = record.get("external_url")
    if not url:
        # Fallback to R2 if configured
        image_filename = record.get("resolved_image_filename") or record.get("image_filename")
        if R2_PUBLIC_DOMAIN and image_filename:
            url = f"https://{R2_PUBLIC_DOMAIN}/{image_filename}"
        else:
            return None

    try:
        response = requests.get(url, timeout=30, headers={"User-Agent": "mtl-archives-search/1.0"})
        response.raise_for_status()
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception as e:
        print(f"  Failed to download {url}: {e}")
        return None


def generate_embeddings(images: list[Image.Image]) -> list[list[float]]:
    """Generate CLIP embeddings for a batch of images."""
    with torch.no_grad():
        inputs = processor(images=images, return_tensors="pt", padding=True)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        image_features = model.get_image_features(**inputs)
        # Normalize embeddings
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        return image_features.cpu().tolist()


def upsert_vectors(vectors: list[dict]):
    """Upsert vectors to Cloudflare Vectorize."""
    ndjson = "\n".join(json.dumps(v) for v in vectors)
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/x-ndjson",
    }
    response = requests.post(VECTORIZE_ENDPOINT, headers=headers, data=ndjson, timeout=60)
    if not response.ok:
        print(f"  Vectorize upsert failed: {response.status_code} {response.text[:200]}")
        return False
    return True


def main():
    records = load_records()
    total = len(records)
    if not total:
        print("No records to process.")
        return

    print(f"Processing {total} records (batch size: {BATCH_SIZE})...")

    processed = 0
    skipped = 0

    for i in range(0, total, BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]

        # Download images
        images = []
        valid_records = []
        for record in batch:
            # Need either external_url or image_filename
            if not record.get("external_url") and not record.get("image_filename"):
                skipped += 1
                continue

            img = download_image(record)
            if img:
                images.append(img)
                valid_records.append(record)
            else:
                skipped += 1

        if not images:
            continue

        # Generate embeddings
        try:
            embeddings = generate_embeddings(images)
        except Exception as e:
            print(f"  Embedding generation failed: {e}")
            skipped += len(images)
            continue

        # Build vectors for upsert
        vectors = []
        for record, embedding in zip(valid_records, embeddings):
            metadata = {}
            if record.get("name"):
                metadata["name"] = record["name"]
            if record.get("attributes_map", {}).get("Date"):
                metadata["date"] = record["attributes_map"]["Date"]
            image_key = record.get("resolved_image_filename") or record.get("image_filename")
            if image_key:
                metadata["image"] = image_key

            vector = {
                "id": record["metadata_filename"],
                "values": embedding,
            }
            if metadata:
                vector["metadata"] = metadata
            vectors.append(vector)

        # Upsert to Vectorize
        if upsert_vectors(vectors):
            processed += len(vectors)
            print(f"Upserted {min(i + BATCH_SIZE, total)}/{total} (processed: {processed}, skipped: {skipped})")
        else:
            skipped += len(vectors)

        # Rate limiting
        time.sleep(0.5)

    print(f"\nComplete! Processed: {processed}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
