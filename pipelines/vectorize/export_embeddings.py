#!/usr/bin/env python3
"""
Export CLIP embeddings from Vectorize and reduce to 2D using UMAP.

This script:
1. Reads manifest to get all vector IDs
2. Batch-fetches vectors from Cloudflare Vectorize API
3. Runs UMAP to reduce 512D → 2D
4. Exports JSON for web visualization

Usage: python3 pipelines/vectorize/export_embeddings.py
       python3 pipelines/vectorize/export_embeddings.py --skip-fetch  # Use cached vectors

Output: data/mtl_archives/embeddings_2d.json
"""

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import requests

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CLOUDFLARE_AI_TOKEN")
R2_PUBLIC_DOMAIN = os.environ.get("CLOUDFLARE_R2_PUBLIC_DOMAIN")
VECTORIZE_INDEX = "mtl-archives-clip"

MANIFEST_PATH = Path(__file__).parent.parent.parent / "data/mtl_archives/manifest_clean.jsonl"
VECTORS_CACHE_PATH = Path(__file__).parent.parent.parent / "data/mtl_archives/vectors_cache.npz"
OUTPUT_PATH = Path(__file__).parent.parent.parent / "data/mtl_archives/embeddings_2d.json"

BATCH_SIZE = 20  # Vectorize API limit per request (max 20)

if not ACCOUNT_ID or not API_TOKEN:
    print("Error: Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN", file=sys.stderr)
    sys.exit(1)


def load_manifest() -> list[dict]:
    """Load manifest records."""
    records = []
    if MANIFEST_PATH.exists():
        for line in MANIFEST_PATH.read_text().splitlines():
            if line.strip():
                records.append(json.loads(line))
    return records


def fetch_vectors_by_ids(ids: list[str]) -> dict:
    """Fetch vectors from Vectorize by IDs."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/vectorize/v2/indexes/{VECTORIZE_INDEX}/get_by_ids"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {"ids": ids}

    response = requests.post(url, headers=headers, json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def fetch_all_vectors(manifest: list[dict]) -> tuple[np.ndarray, list[str]]:
    """Fetch all vectors from Vectorize in batches."""
    ids = [r["metadata_filename"] for r in manifest if r.get("metadata_filename")]
    total = len(ids)

    print(f"Fetching {total} vectors from Vectorize...")

    all_vectors = []
    valid_ids = []

    for i in range(0, total, BATCH_SIZE):
        batch_ids = ids[i:i + BATCH_SIZE]

        try:
            result = fetch_vectors_by_ids(batch_ids)

            if not result.get("success"):
                print(f"  Batch {i//BATCH_SIZE + 1} failed: {result.get('errors')}")
                continue

            # result is directly a list of vectors
            vectors = result.get("result", [])

            for vec in vectors:
                if vec.get("values"):
                    all_vectors.append(vec["values"])
                    valid_ids.append(vec["id"])

            print(f"  Fetched {min(i + BATCH_SIZE, total)}/{total} ({len(all_vectors)} valid)")

            # Rate limiting
            time.sleep(0.2)

        except Exception as e:
            print(f"  Batch {i//BATCH_SIZE + 1} error: {e}")
            continue

    return np.array(all_vectors), valid_ids


def run_umap(vectors: np.ndarray, n_components: int = 2) -> np.ndarray:
    """Reduce dimensionality using UMAP."""
    try:
        import umap
    except ImportError:
        print("Error: umap-learn not installed. Run: pip install umap-learn")
        sys.exit(1)

    print(f"\nRunning UMAP reduction: {vectors.shape[1]}D → {n_components}D...")
    print(f"  This may take a few minutes for {len(vectors)} vectors...")

    reducer = umap.UMAP(
        n_components=n_components,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
        verbose=True,
    )

    embedding_2d = reducer.fit_transform(vectors)

    # Normalize to 0-1 range for easier visualization
    embedding_2d[:, 0] = (embedding_2d[:, 0] - embedding_2d[:, 0].min()) / (embedding_2d[:, 0].max() - embedding_2d[:, 0].min())
    embedding_2d[:, 1] = (embedding_2d[:, 1] - embedding_2d[:, 1].min()) / (embedding_2d[:, 1].max() - embedding_2d[:, 1].min())

    return embedding_2d


def build_output(
    embedding_2d: np.ndarray,
    valid_ids: list[str],
    manifest: list[dict],
) -> list[dict]:
    """Build output JSON with 2D coordinates and metadata."""
    # Create lookup from manifest
    manifest_lookup = {r["metadata_filename"]: r for r in manifest if r.get("metadata_filename")}

    output = []
    for i, vec_id in enumerate(valid_ids):
        record = manifest_lookup.get(vec_id, {})

        # Get image URL
        image_filename = record.get("resolved_image_filename") or record.get("image_filename", "")
        image_url = f"https://{R2_PUBLIC_DOMAIN}/{image_filename}" if R2_PUBLIC_DOMAIN and image_filename else ""

        output.append({
            "id": vec_id,
            "x": float(embedding_2d[i, 0]),
            "y": float(embedding_2d[i, 1]),
            "name": record.get("name", ""),
            "date": record.get("attributes_map", {}).get("Date", ""),
            "image_url": image_url,
        })

    return output


def main():
    skip_fetch = "--skip-fetch" in sys.argv

    # Load manifest
    print("Loading manifest...")
    manifest = load_manifest()
    print(f"  Loaded {len(manifest)} records")

    # Fetch or load cached vectors
    if skip_fetch and VECTORS_CACHE_PATH.exists():
        print(f"\nLoading cached vectors from {VECTORS_CACHE_PATH}...")
        data = np.load(VECTORS_CACHE_PATH, allow_pickle=True)
        vectors = data["vectors"]
        valid_ids = data["ids"].tolist()
        print(f"  Loaded {len(vectors)} vectors")
    else:
        vectors, valid_ids = fetch_all_vectors(manifest)

        if len(vectors) == 0:
            print("Error: No vectors fetched")
            sys.exit(1)

        # Cache vectors for future runs
        print(f"\nCaching vectors to {VECTORS_CACHE_PATH}...")
        np.savez(VECTORS_CACHE_PATH, vectors=vectors, ids=np.array(valid_ids))

    print(f"\nVector shape: {vectors.shape}")

    # Run UMAP
    embedding_2d = run_umap(vectors)

    # Build output
    print("\nBuilding output JSON...")
    output = build_output(embedding_2d, valid_ids, manifest)

    # Save
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"\nSaved {len(output)} points to {OUTPUT_PATH}")

    # Summary stats
    print("\nSummary:")
    print(f"  X range: {min(p['x'] for p in output):.3f} - {max(p['x'] for p in output):.3f}")
    print(f"  Y range: {min(p['y'] for p in output):.3f} - {max(p['y'] for p in output):.3f}")
    print(f"  With images: {sum(1 for p in output if p['image_url'])}")
    print(f"  With names: {sum(1 for p in output if p['name'])}")


if __name__ == "__main__":
    main()
