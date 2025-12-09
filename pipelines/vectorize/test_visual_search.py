#!/usr/bin/env python3
"""
Test visual search by generating CLIP text embedding locally
and querying Vectorize directly via API.

Usage: python3 pipelines/vectorize/test_visual_search.py "park with trees"
       python3 pipelines/vectorize/test_visual_search.py "park with trees" --open
"""

import json
import os
import sys
import webbrowser
from pathlib import Path

import requests
import torch
from transformers import CLIPModel, CLIPTokenizer

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CLOUDFLARE_AI_TOKEN")
VECTORIZE_INDEX = "mtl-archives-clip"
MANIFEST_PATH = Path(__file__).parent.parent.parent / "data/mtl_archives/manifest_clean.jsonl"

if not ACCOUNT_ID or not API_TOKEN:
    print("Error: Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN", file=sys.stderr)
    sys.exit(1)

# Load CLIP model
print("Loading CLIP model...")
device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32", use_safetensors=True).to(device)
tokenizer = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
model.eval()


def load_manifest_lookup() -> dict:
    """Load manifest to get external URLs."""
    lookup = {}
    if MANIFEST_PATH.exists():
        for line in MANIFEST_PATH.read_text().splitlines():
            if line.strip():
                record = json.loads(line)
                lookup[record.get("metadata_filename")] = record
    return lookup


def generate_text_embedding(text: str) -> list[float]:
    """Generate CLIP text embedding."""
    with torch.no_grad():
        inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=77)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        text_features = model.get_text_features(**inputs)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        return text_features.cpu().tolist()[0]


def query_vectorize(embedding: list[float], top_k: int = 5):
    """Query Vectorize for similar vectors."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/vectorize/v2/indexes/{VECTORIZE_INDEX}/query"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "vector": embedding,
        "topK": top_k,
        "returnMetadata": "all",
    }
    response = requests.post(url, headers=headers, json=payload, timeout=30)
    response.raise_for_status()
    return response.json()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    open_browser = "--open" in flags

    if not args:
        print("Usage: python3 test_visual_search.py \"your query\" [--open]")
        print("  --open  Open top result in browser")
        sys.exit(1)

    query = " ".join(args)
    print(f"\nQuery: \"{query}\"")
    print("-" * 50)

    # Load manifest for external URLs
    print("Loading manifest...")
    manifest = load_manifest_lookup()
    print(f"Loaded {len(manifest)} records")

    # Generate text embedding
    print("Generating CLIP text embedding...")
    embedding = generate_text_embedding(query)
    print(f"Embedding dims: {len(embedding)}")

    # Query Vectorize
    print("\nQuerying Vectorize...")
    result = query_vectorize(embedding)

    if not result.get("success"):
        print(f"Error: {result.get('errors', 'Unknown error')}")
        sys.exit(1)

    matches = result.get("result", {}).get("matches", [])
    print(f"\nFound {len(matches)} matches:\n")

    urls_to_open = []

    for i, match in enumerate(matches, 1):
        score = match.get("score", 0)
        metadata_filename = match.get("id", "")
        vec_metadata = match.get("metadata", {})

        # Get full record from manifest
        record = manifest.get(metadata_filename, {})
        name = record.get("name") or vec_metadata.get("name", "Unknown")
        date = record.get("attributes_map", {}).get("Date") or vec_metadata.get("date", "")
        external_url = record.get("external_url", "")

        print(f"{i}. [{score:.4f}] {name}")
        if date:
            print(f"   Date: {date}")
        if external_url:
            print(f"   URL: {external_url}")
            urls_to_open.append(external_url)
        print()

    if open_browser and urls_to_open:
        print(f"Opening top result in browser...")
        webbrowser.open(urls_to_open[0])


if __name__ == "__main__":
    main()
