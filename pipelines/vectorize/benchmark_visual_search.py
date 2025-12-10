#!/usr/bin/env python3
"""
Benchmark visual search quality by running test queries and measuring results.

Usage: python3 pipelines/vectorize/benchmark_visual_search.py
       python3 pipelines/vectorize/benchmark_visual_search.py --verbose
"""

import json
import os
import sys
from dataclasses import dataclass
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


# Benchmark test cases
# Each query has expected keywords that should appear in relevant results
BENCHMARK_QUERIES = [
    # Landscapes and nature
    {
        "query": "park with trees",
        "expected_keywords": ["parc", "park", "jardin", "garden"],
        "category": "nature",
    },
    {
        "query": "river water",
        "expected_keywords": ["fleuve", "rivière", "river", "eau", "water", "st-laurent", "saint-laurent"],
        "category": "nature",
    },
    # Architecture
    {
        "query": "church with steeple",
        "expected_keywords": ["église", "church", "chapel", "cathédrale", "cathedral"],
        "category": "architecture",
    },
    {
        "query": "tall building skyscraper",
        "expected_keywords": ["building", "tower", "édifice", "tour", "gratte-ciel"],
        "category": "architecture",
    },
    {
        "query": "bridge",
        "expected_keywords": ["pont", "bridge", "viaduc"],
        "category": "infrastructure",
    },
    # Urban scenes
    {
        "query": "street with cars",
        "expected_keywords": ["rue", "street", "avenue", "boulevard", "auto", "car", "voiture"],
        "category": "urban",
    },
    {
        "query": "downtown city buildings",
        "expected_keywords": ["centre-ville", "downtown", "ville", "city", "urbain"],
        "category": "urban",
    },
    # Transportation
    {
        "query": "train railway",
        "expected_keywords": ["train", "railway", "chemin de fer", "gare", "station", "rail"],
        "category": "transportation",
    },
    {
        "query": "harbor ships boats",
        "expected_keywords": ["port", "harbor", "bateau", "ship", "boat", "quai", "dock"],
        "category": "transportation",
    },
    # Aerial views
    {
        "query": "aerial view from above",
        "expected_keywords": ["aérien", "aerial", "vue", "view"],
        "category": "aerial",
    },
    # Specific Montreal landmarks (if in dataset)
    {
        "query": "mont royal mountain",
        "expected_keywords": ["mont-royal", "mont royal", "mountain", "montagne"],
        "category": "landmarks",
    },
    {
        "query": "old port historic",
        "expected_keywords": ["vieux-port", "old port", "historique", "historic"],
        "category": "landmarks",
    },
]


@dataclass
class QueryResult:
    query: str
    category: str
    expected_keywords: list[str]
    top_results: list[dict]
    avg_score: float
    max_score: float
    keyword_matches: int
    precision_at_5: float


def load_manifest_lookup() -> dict:
    """Load manifest to get metadata."""
    lookup = {}
    if MANIFEST_PATH.exists():
        for line in MANIFEST_PATH.read_text().splitlines():
            if line.strip():
                record = json.loads(line)
                lookup[record.get("metadata_filename")] = record
    return lookup


def load_clip_model():
    """Load CLIP model."""
    print("Loading CLIP model...")
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32", use_safetensors=True).to(device)
    tokenizer = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()
    return model, tokenizer, device


def generate_text_embedding(text: str, model, tokenizer, device) -> list[float]:
    """Generate CLIP text embedding."""
    with torch.no_grad():
        inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=77)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        text_features = model.get_text_features(**inputs)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        return text_features.cpu().tolist()[0]


def query_vectorize(embedding: list[float], top_k: int = 5) -> dict:
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


def check_keyword_match(text: str, keywords: list[str]) -> bool:
    """Check if any keyword appears in text (case-insensitive)."""
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in keywords)


def run_benchmark(verbose: bool = False) -> list[QueryResult]:
    """Run all benchmark queries and collect results."""
    model, tokenizer, device = load_clip_model()
    manifest = load_manifest_lookup()
    print(f"Loaded {len(manifest)} manifest records\n")

    results = []

    for i, test in enumerate(BENCHMARK_QUERIES, 1):
        query = test["query"]
        expected_keywords = test["expected_keywords"]
        category = test["category"]

        if verbose:
            print(f"[{i}/{len(BENCHMARK_QUERIES)}] Testing: \"{query}\"")

        # Generate embedding and query
        embedding = generate_text_embedding(query, model, tokenizer, device)
        response = query_vectorize(embedding, top_k=5)

        if not response.get("success"):
            print(f"  Error: {response.get('errors')}")
            continue

        matches = response.get("result", {}).get("matches", [])

        # Analyze results
        scores = [m.get("score", 0) for m in matches]
        avg_score = sum(scores) / len(scores) if scores else 0
        max_score = max(scores) if scores else 0

        # Check keyword matches in result names/metadata
        keyword_matches = 0
        top_results = []

        for match in matches:
            metadata_filename = match.get("id", "")
            record = manifest.get(metadata_filename, {})
            name = record.get("name", "")
            description = record.get("description", "")
            searchable_text = f"{name} {description} {metadata_filename}"

            is_match = check_keyword_match(searchable_text, expected_keywords)
            if is_match:
                keyword_matches += 1

            top_results.append({
                "id": metadata_filename,
                "name": name[:60] if name else "Unknown",
                "score": match.get("score", 0),
                "keyword_match": is_match,
            })

        precision_at_5 = keyword_matches / 5 if matches else 0

        result = QueryResult(
            query=query,
            category=category,
            expected_keywords=expected_keywords,
            top_results=top_results,
            avg_score=avg_score,
            max_score=max_score,
            keyword_matches=keyword_matches,
            precision_at_5=precision_at_5,
        )
        results.append(result)

        if verbose:
            print(f"  Max score: {max_score:.4f}, Keyword matches: {keyword_matches}/5")
            for r in top_results:
                match_indicator = "Y" if r["keyword_match"] else " "
                print(f"    [{match_indicator}] [{r['score']:.4f}] {r['name']}")
            print()

    return results


def print_report(results: list[QueryResult]):
    """Print benchmark summary report."""
    print("\n" + "=" * 70)
    print("VISUAL SEARCH BENCHMARK REPORT")
    print("=" * 70)

    # Overall metrics
    total_queries = len(results)
    avg_max_score = sum(r.max_score for r in results) / total_queries
    avg_precision = sum(r.precision_at_5 for r in results) / total_queries
    total_keyword_matches = sum(r.keyword_matches for r in results)

    print(f"\nOverall Metrics ({total_queries} queries)")
    print("-" * 40)
    print(f"Average max score:     {avg_max_score:.4f}")
    print(f"Average precision@5:   {avg_precision:.2%}")
    print(f"Total keyword matches: {total_keyword_matches}/{total_queries * 5}")

    # Score distribution
    print(f"\nScore Distribution")
    print("-" * 40)
    strong = sum(1 for r in results if r.max_score >= 0.25)
    moderate = sum(1 for r in results if 0.15 <= r.max_score < 0.25)
    weak = sum(1 for r in results if r.max_score < 0.15)
    print(f"Strong (>=0.25):   {strong:2d} queries ({strong/total_queries:.0%})")
    print(f"Moderate (0.15-0.25): {moderate:2d} queries ({moderate/total_queries:.0%})")
    print(f"Weak (<0.15):      {weak:2d} queries ({weak/total_queries:.0%})")

    # By category
    print(f"\nResults by Category")
    print("-" * 40)
    categories = {}
    for r in results:
        if r.category not in categories:
            categories[r.category] = []
        categories[r.category].append(r)

    for cat, cat_results in sorted(categories.items()):
        cat_avg_score = sum(r.max_score for r in cat_results) / len(cat_results)
        cat_precision = sum(r.precision_at_5 for r in cat_results) / len(cat_results)
        print(f"{cat:15s}: avg_score={cat_avg_score:.4f}, precision@5={cat_precision:.2%}")

    # Best and worst queries
    print(f"\nBest Performing Queries (by max score)")
    print("-" * 40)
    sorted_by_score = sorted(results, key=lambda r: r.max_score, reverse=True)
    for r in sorted_by_score[:3]:
        print(f"  [{r.max_score:.4f}] \"{r.query}\" (matches: {r.keyword_matches}/5)")

    print(f"\nWorst Performing Queries (by max score)")
    print("-" * 40)
    for r in sorted_by_score[-3:]:
        print(f"  [{r.max_score:.4f}] \"{r.query}\" (matches: {r.keyword_matches}/5)")

    # Recommendations
    print(f"\nRecommendations")
    print("-" * 40)
    if avg_max_score < 0.15:
        print("- Low overall scores suggest domain gap between CLIP training data")
        print("  and historical archive photos. Consider fine-tuning or using")
        print("  a model trained on historical imagery.")
    if avg_precision < 0.3:
        print("- Low precision suggests keyword matching may not reflect visual")
        print("  similarity well. Consider manual evaluation of top results.")
    if weak > total_queries * 0.5:
        print("- Many weak matches. The dataset may not contain content for")
        print("  these query types, or queries need to be more specific.")

    print("\n" + "=" * 70)


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv

    print("Visual Search Benchmark")
    print(f"Running {len(BENCHMARK_QUERIES)} test queries...\n")

    results = run_benchmark(verbose=verbose)
    print_report(results)

    # Save detailed results to JSON
    output_path = Path(__file__).parent / "benchmark_results.json"
    output_data = [
        {
            "query": r.query,
            "category": r.category,
            "max_score": r.max_score,
            "avg_score": r.avg_score,
            "precision_at_5": r.precision_at_5,
            "keyword_matches": r.keyword_matches,
            "top_results": r.top_results,
        }
        for r in results
    ]
    output_path.write_text(json.dumps(output_data, indent=2))
    print(f"\nDetailed results saved to: {output_path}")


if __name__ == "__main__":
    main()
