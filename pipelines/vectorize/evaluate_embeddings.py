#!/usr/bin/env python3
import argparse
import json
import math
import os
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote

import requests
import torch
from PIL import Image
from transformers import AutoProcessor, CLIPModel, SiglipModel

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


USER_AGENT = "mtl-archives-embedding-eval/1.0"

PROMPTS = [
    {"key": "aerial_general", "compatible": ["aerial_general"], "text": "aerial photograph of a city from above"},
    {"key": "aerial_waterfront", "compatible": ["aerial_waterfront"], "text": "aerial photograph of a waterfront, harbor, river, docks, ships, or port"},
    {"key": "aerial_residential", "compatible": ["aerial_residential"], "text": "aerial photograph of residential neighborhoods, houses, streets, and city blocks"},
    {"key": "aerial_industrial", "compatible": ["aerial_industrial"], "text": "aerial photograph of industrial buildings, factories, rail yards, warehouses, or port industry"},
    {"key": "document_map", "compatible": ["document_map"], "text": "scanned map, plan, document, index sheet, or technical drawing"},
    {"key": "ground_photo", "compatible": ["ground_photo", "street_commercial", "ground_transit", "civic_institutional", "people_event"], "text": "ground level historical street or building photograph"},
    {"key": "park_green_space", "compatible": ["aerial_general", "ground_photo"], "text": "parks, trees, green space, playgrounds, or gardens"},
    {"key": "transit", "compatible": ["ground_transit", "aerial_general"], "text": "streetcars, trains, tracks, stations, bridges, or transit infrastructure"},
    {"key": "construction", "compatible": ["aerial_general", "ground_photo"], "text": "construction site, demolition, roadwork, or building under construction"},
]

QUERY_EXPECTATIONS = {
    "aerial-1": {"categories": ["aerial_general", "aerial_residential", "aerial_industrial", "aerial_waterfront"], "themes": []},
    "aerial-2": {"categories": ["aerial_waterfront"], "themes": ["waterfront"]},
    "port-1": {"categories": ["aerial_waterfront"], "themes": ["waterfront", "industrial"]},
    "waterfront-1": {"categories": ["aerial_waterfront"], "themes": ["waterfront"]},
    "park-1": {"categories": ["aerial_general", "ground_photo"], "themes": ["park_green_space"]},
    "park-2": {"categories": ["ground_photo", "people_event", "aerial_general"], "themes": ["park_green_space", "crowd_event"]},
    "winter-1": {"categories": ["aerial_general", "ground_photo"], "themes": ["winter"]},
    "winter-2": {"categories": ["ground_photo", "street_commercial", "aerial_general"], "themes": ["winter"]},
    "streetcar-1": {"categories": ["ground_transit", "ground_photo"], "themes": ["transit"]},
    "factory-1": {"categories": ["aerial_industrial"], "themes": ["industrial"]},
    "residential-1": {"categories": ["aerial_residential"], "themes": ["residential"]},
    "demolition-1": {"categories": ["aerial_general", "ground_photo"], "themes": ["construction"]},
    "children-1": {"categories": ["people_event", "ground_photo"], "themes": ["crowd_event"]},
}

MODEL_IDS = {
    "clip": "openai/clip-vit-base-patch32",
    "siglip": "google/siglip-base-patch16-224",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_env(root: Path) -> None:
    if load_dotenv:
        load_dotenv(root / ".env.local")
        load_dotenv(root / ".env")


def parse_args() -> argparse.Namespace:
    root = repo_root()
    parser = argparse.ArgumentParser(description="Evaluate CLIP/SigLIP embeddings with a CUDA-capable PyTorch backend.")
    parser.add_argument("--taxonomy", default=str(root / "data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl"))
    parser.add_argument("--quality", default=str(root / "data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl"))
    parser.add_argument("--candidates", default=str(root / "data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl"))
    parser.add_argument("--collections", default=str(root / "data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl"))
    parser.add_argument("--queries", default=str(root / "experiments/autoresearch/search/queries.json"))
    parser.add_argument("--output-dir", default=str(root / "data/mtl_archives/reports/autoresearch_embedding_eval_gpu"))
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--models", default="clip,siglip")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--require-cuda", action="store_true", help="Exit if the selected device is not CUDA-backed.")
    parser.add_argument("--fp16", action="store_true", help="Load model weights in float16 on CUDA.")
    parser.add_argument("--public-domain", default=os.getenv("CLOUDFLARE_R2_PUBLIC_DOMAIN") or os.getenv("NEXT_PUBLIC_R2_PUBLIC_DOMAIN") or "")
    return parser.parse_args()


def resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else repo_root() / path


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"{path}:{index}: {exc}") from exc
    return rows


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def r2_url(image_path: str, public_domain: str) -> str:
    if not image_path or not public_domain:
        return ""
    domain = public_domain.replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://{domain}/{quote(image_path)}"


def group_by_id(rows: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("id"):
            grouped[str(row["id"])].append(row)
    return grouped


def pick_sample(
    taxonomy: List[Dict[str, Any]],
    quality_by_id: Dict[str, Dict[str, Any]],
    candidate_by_id: Dict[str, List[Dict[str, Any]]],
    collection_by_id: Dict[str, List[Dict[str, Any]]],
    limit: int,
    public_domain: str,
) -> List[Dict[str, Any]]:
    selected: Dict[str, Dict[str, Any]] = {}
    categories = [
        "aerial_general",
        "aerial_waterfront",
        "aerial_residential",
        "aerial_industrial",
        "document_map",
        "ground_photo",
        "people_event",
        "street_commercial",
        "uncertain",
    ]
    per_category = max(2, math.floor(limit / len(categories)))
    rows = [
        row for row in taxonomy
        if row.get("id")
        and row.get("imagePath")
        and float(row.get("primaryConfidence") or 0) >= 0.55
        and (not row.get("excludeFromDefaultVisualSearch") or row.get("primaryCategory") == "document_map")
        and quality_by_id.get(str(row["id"]), {}).get("recommendedAction") != "exclude_until_fixed"
    ]

    def add(row: Dict[str, Any], reason: str) -> None:
        row_id = str(row["id"])
        if len(selected) >= limit or row_id in selected:
            return
        item = dict(row)
        item["sampleReason"] = reason
        item["r2ImageUrl"] = r2_url(clean_text(row.get("imagePath")), public_domain) or clean_text(row.get("imageUrl"))
        item["candidateTypes"] = [clean_text(candidate.get("candidate_type")) for candidate in candidate_by_id.get(row_id, []) if clean_text(candidate.get("candidate_type"))]
        item["collectionIds"] = [clean_text(collection.get("collection_id")) for collection in collection_by_id.get(row_id, []) if clean_text(collection.get("collection_id"))]
        item["qualityLabels"] = quality_by_id.get(row_id, {}).get("labels") or []
        selected[row_id] = item

    for category in categories:
        bucket = [row for row in rows if row.get("primaryCategory") == category]
        bucket.sort(
            key=lambda row: (
                len(candidate_by_id.get(str(row["id"]), [])),
                len(collection_by_id.get(str(row["id"]), [])),
                float(row.get("primaryConfidence") or 0),
            ),
            reverse=True,
        )
        for row in bucket[:per_category]:
            add(row, f"category:{category}")

    for row in rows:
        if candidate_by_id.get(str(row["id"])):
            add(row, "candidate_report")
    for row in rows:
        if collection_by_id.get(str(row["id"])):
            add(row, "collection_report")
    for row in rows:
        add(row, "fill")
    return list(selected.values())[:limit]


def fetch_image(url: str, timeout: int = 30) -> Optional[Image.Image]:
    try:
        response = requests.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception:
        return None


def fetch_images(rows: List[Dict[str, Any]], workers: int) -> Tuple[List[Dict[str, Any]], List[Image.Image], List[Dict[str, str]]]:
    kept: List[Optional[Dict[str, Any]]] = [None] * len(rows)
    images: List[Optional[Image.Image]] = [None] * len(rows)
    failures: List[Dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {}
        for index, row in enumerate(rows):
            urls = [clean_text(row.get("r2ImageUrl")), clean_text(row.get("imageUrl"))]
            url = next((item for item in urls if item), "")
            if not url:
                failures.append({"id": clean_text(row.get("id")), "error": "Missing image URL"})
                continue
            futures[executor.submit(fetch_image, url)] = (index, row)
        for future in as_completed(futures):
            index, row = futures[future]
            image = future.result()
            if image is None:
                failures.append({"id": clean_text(row.get("id")), "error": "Image fetch failed"})
                continue
            kept[index] = row
            images[index] = image
    paired = [(row, image) for row, image in zip(kept, images) if row is not None and image is not None]
    return [row for row, _ in paired], [image for _, image in paired], failures


def normalize_tensor(tensor: torch.Tensor) -> torch.Tensor:
    return tensor / tensor.norm(dim=-1, keepdim=True).clamp_min(1e-12)


def cosine(a: List[float], b: List[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def mean(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def mrr(ranks: List[int]) -> float:
    return mean([(1 / rank) if rank > 0 else 0 for rank in ranks])


def precision_at(ranks: List[int], k: int) -> float:
    return mean([1 if 0 < rank <= k else 0 for rank in ranks])


def compatible_prompt(row: Dict[str, Any], prompt_key: str) -> bool:
    prompt = next((item for item in PROMPTS if item["key"] == prompt_key), None)
    if not prompt:
        return False
    return row.get("primaryCategory") in prompt["compatible"] or prompt_key in (row.get("themes") or [])


def expected_query_hit(row: Dict[str, Any], query: Dict[str, Any]) -> bool:
    expected = QUERY_EXPECTATIONS.get(query.get("id"))
    if not expected:
        category = clean_text(query.get("category")).replace("-", "_")
        return any(category in clean_text(facet) for facet in row.get("searchFacets") or []) or any(theme in category for theme in row.get("themes") or [])
    return row.get("primaryCategory") in expected["categories"] or any(theme in expected["themes"] for theme in row.get("themes") or [])


def count_by(values: Iterable[str]) -> Dict[str, int]:
    return dict(Counter(values).most_common())


def load_model(model_key: str, device: torch.device, fp16: bool) -> Tuple[str, Any, Any]:
    model_id = MODEL_IDS.get(model_key, model_key)
    dtype = torch.float16 if fp16 and device.type == "cuda" else None
    kwargs = {"dtype": dtype} if dtype is not None else {}
    model_class = SiglipModel if model_key == "siglip" or "siglip" in model_id.lower() else CLIPModel
    model = model_class.from_pretrained(model_id, **kwargs)
    processor = AutoProcessor.from_pretrained(model_id)
    model.to(device)
    model.eval()
    return model_id, model, processor


def feature_tensor(output: Any, *fields: str) -> torch.Tensor:
    if torch.is_tensor(output):
        return output
    for field in fields:
        value = getattr(output, field, None)
        if torch.is_tensor(value):
            return value
    raise TypeError(f"Model output does not contain a tensor feature in {fields}: {type(output).__name__}")


def image_embeddings(
    model: Any,
    processor: Any,
    images: List[Image.Image],
    device: torch.device,
    batch_size: int,
) -> List[List[float]]:
    vectors: List[List[float]] = []
    for start in range(0, len(images), batch_size):
        batch = images[start : start + batch_size]
        inputs = processor(images=batch, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.inference_mode():
            features = feature_tensor(model.get_image_features(**inputs), "image_embeds", "pooler_output")
            features = normalize_tensor(features.float())
        vectors.extend(features.cpu().tolist())
    return vectors


def text_embeddings(
    model: Any,
    processor: Any,
    texts: List[str],
    device: torch.device,
    batch_size: int,
) -> List[List[float]]:
    vectors: List[List[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        inputs = processor(text=batch, padding=True, truncation=True, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.inference_mode():
            features = feature_tensor(model.get_text_features(**inputs), "text_embeds", "pooler_output")
            features = normalize_tensor(features.float())
        vectors.extend(features.cpu().tolist())
    return vectors


def evaluate_prompt_alignment(rows: List[Dict[str, Any]], prompt_vectors: Dict[str, List[float]]) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    results = []
    for row in rows:
        ranked = sorted(
            [{"key": key, "score": cosine(row["vector"], vector)} for key, vector in prompt_vectors.items()],
            key=lambda item: item["score"],
            reverse=True,
        )
        rank = next((index + 1 for index, item in enumerate(ranked) if compatible_prompt(row, item["key"])), 0)
        results.append({
            "id": row["id"],
            "primaryCategory": row.get("primaryCategory"),
            "themes": row.get("themes") or [],
            "topPrompt": ranked[0]["key"] if ranked else None,
            "topScore": round(ranked[0]["score"], 4) if ranked else 0,
            "compatibleRank": rank,
            "compatibleAt1": rank == 1,
            "compatibleAt3": 0 < rank <= 3,
        })
    return results, {
        "prompt_p_at_1": round(mean([1 if row["compatibleAt1"] else 0 for row in results]), 4),
        "prompt_p_at_3": round(mean([1 if row["compatibleAt3"] else 0 for row in results]), 4),
        "prompt_mrr": round(mrr([int(row["compatibleRank"]) for row in results]), 4),
    }


def evaluate_neighbors(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    results = []
    for row in rows:
        ranked = sorted(
            [
                {
                    "id": other["id"],
                    "primaryCategory": other.get("primaryCategory"),
                    "themes": other.get("themes") or [],
                    "score": cosine(row["vector"], other["vector"]),
                }
                for other in rows
                if other["id"] != row["id"]
            ],
            key=lambda item: item["score"],
            reverse=True,
        )
        top5 = ranked[:5]
        same_category = mean([1 if other["primaryCategory"] == row.get("primaryCategory") else 0 for other in top5])
        shared_theme = mean([1 if set(other["themes"]).intersection(row.get("themes") or []) else 0 for other in top5])
        results.append({
            "id": row["id"],
            "primaryCategory": row.get("primaryCategory"),
            "themes": row.get("themes") or [],
            "nearest": [{**other, "score": round(other["score"], 4)} for other in top5],
            "sameCategoryAt5": round(same_category, 4),
            "sharedThemeAt5": round(shared_theme, 4),
        })
    pairs = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            pairs.append({
                "same": rows[i].get("primaryCategory") == rows[j].get("primaryCategory"),
                "sharedTheme": bool(set(rows[i].get("themes") or []).intersection(rows[j].get("themes") or [])),
                "score": cosine(rows[i]["vector"], rows[j]["vector"]),
            })
    return results, {
        "nn_same_category_at_5": round(mean([float(row["sameCategoryAt5"]) for row in results]), 4),
        "nn_shared_theme_at_5": round(mean([float(row["sharedThemeAt5"]) for row in results]), 4),
        "mean_same_category_cosine": round(mean([pair["score"] for pair in pairs if pair["same"]]), 4),
        "mean_different_category_cosine": round(mean([pair["score"] for pair in pairs if not pair["same"]]), 4),
        "mean_shared_theme_cosine": round(mean([pair["score"] for pair in pairs if pair["sharedTheme"]]), 4),
    }


def evaluate_queries(
    rows: List[Dict[str, Any]],
    queries: List[Dict[str, Any]],
    query_vectors: List[List[float]],
) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    evaluated = []
    ranks = []
    selected_queries = [query for query in queries if query.get("id") in QUERY_EXPECTATIONS][:16]
    for query, vector in zip(selected_queries, query_vectors):
        ranked = sorted(
            [
                {
                    "id": row["id"],
                    "title": row.get("title"),
                    "primaryCategory": row.get("primaryCategory"),
                    "themes": row.get("themes") or [],
                    "score": cosine(vector, row["vector"]),
                    "expectedHit": expected_query_hit(row, query),
                }
                for row in rows
            ],
            key=lambda item: item["score"],
            reverse=True,
        )
        rank = next((index + 1 for index, row in enumerate(ranked) if row["expectedHit"]), 0)
        ranks.append(rank)
        evaluated.append({
            "id": query["id"],
            "query": query.get("query"),
            "category": query.get("category"),
            "expected": QUERY_EXPECTATIONS[query["id"]],
            "firstHitRank": rank,
            "topResults": [{**row, "score": round(row["score"], 4)} for row in ranked[:8]],
        })
    return evaluated, {
        "query_p_at_1": round(precision_at(ranks, 1), 4),
        "query_p_at_3": round(precision_at(ranks, 3), 4),
        "query_p_at_5": round(precision_at(ranks, 5), 4),
        "query_mrr": round(mrr(ranks), 4),
    }


def evaluate_model(
    model_key: str,
    sample: List[Dict[str, Any]],
    images: List[Image.Image],
    queries: List[Dict[str, Any]],
    device: torch.device,
    batch_size: int,
    fp16: bool,
) -> Dict[str, Any]:
    start_time = time.time()
    model_id, model, processor = load_model(model_key, device, fp16)
    image_vectors = image_embeddings(model, processor, images, device, batch_size)
    embedded = [{**row, "vector": vector} for row, vector in zip(sample, image_vectors)]

    prompt_vectors_raw = text_embeddings(model, processor, [prompt["text"] for prompt in PROMPTS], device, batch_size)
    prompt_vectors = {prompt["key"]: vector for prompt, vector in zip(PROMPTS, prompt_vectors_raw)}
    selected_queries = [query for query in queries if query.get("id") in QUERY_EXPECTATIONS][:16]
    query_vectors = text_embeddings(model, processor, [query["query"] for query in selected_queries], device, batch_size)

    prompt_rows, prompt_metrics = evaluate_prompt_alignment(embedded, prompt_vectors)
    neighbor_rows, neighbor_metrics = evaluate_neighbors(embedded)
    query_rows, query_metrics = evaluate_queries(embedded, queries, query_vectors)

    if device.type == "cuda":
        torch.cuda.synchronize(device)
        peak_memory_mb = round(torch.cuda.max_memory_allocated(device) / 1024 / 1024, 1)
        torch.cuda.reset_peak_memory_stats(device)
    else:
        peak_memory_mb = 0

    return {
        "modelKey": model_key,
        "modelId": model_id,
        "completedRows": len(embedded),
        "failedRows": 0,
        "runtimeSeconds": round(time.time() - start_time, 2),
        "peakGpuMemoryMb": peak_memory_mb,
        "metrics": {**prompt_metrics, **neighbor_metrics, **query_metrics},
        "promptAlignment": prompt_rows,
        "nearestNeighbors": neighbor_rows,
        "queryResults": query_rows,
        "failures": [],
    }


def recommendation(models: List[Dict[str, Any]]) -> str:
    if len(models) < 2:
        return "Only one model completed; keep the issue open and run an alternative embedding model before changing production indexes."
    baseline = next((model for model in models if model["modelKey"] == "clip"), models[0])
    alternatives = [model for model in models if model is not baseline]
    best = max(alternatives, key=lambda model: model["metrics"].get("query_mrr", 0))
    delta = best["metrics"].get("query_mrr", 0) - baseline["metrics"].get("query_mrr", 0)
    if delta >= 0.03 and best["metrics"].get("query_p_at_5", 0) >= baseline["metrics"].get("query_p_at_5", 0):
        return f"{best['modelKey']} beats the CLIP baseline on query MRR by {delta:.4f}; run a deeper re-embedding experiment before replacing the production index."
    if delta <= -0.03:
        return f"CLIP remains stronger than {best['modelKey']} on query MRR by {abs(delta):.4f}; keep current embeddings unless a larger model family is tested."
    return f"{best['modelKey']} is within {abs(delta):.4f} query MRR of CLIP; evidence is too close for a production re-embed, so run a larger or more targeted experiment."


def render_markdown(report: Dict[str, Any]) -> str:
    lines = [
        "# Autoresearch CUDA Embedding Evaluation",
        "",
        f"Generated: {report['generated_at']}",
        "",
        "## Runtime",
        "",
        f"- Device: {report['runtime']['device']}",
        f"- CUDA available: {report['runtime']['cuda_available']}",
        f"- GPU: {report['runtime'].get('gpu_name') or 'none'}",
        "",
        "## Summary",
        "",
        f"- Sample rows: {report['summary']['sample_rows']}",
        f"- Fetched images: {report['summary']['fetched_images']}",
        f"- Models requested: {', '.join(report['summary']['models_requested'])}",
        f"- Models completed: {', '.join(report['summary']['models_completed'])}",
        f"- Model load failures: {report['summary']['model_load_failures']}",
        "",
        "## Sample Categories",
        "",
    ]
    for key, value in report["sample"]["distributions"]["primaryCategory"].items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Model Metrics", ""])
    for model in report["models"]:
        lines.append(f"### {model['modelKey']}")
        lines.append(f"- Model ID: `{model['modelId']}`")
        lines.append(f"- Completed rows: {model['completedRows']}")
        lines.append(f"- Runtime seconds: {model['runtimeSeconds']}")
        lines.append(f"- Peak GPU memory MB: {model['peakGpuMemoryMb']}")
        for key, value in model["metrics"].items():
            lines.append(f"- {key}: {value}")
        lines.append("")
    lines.extend(["## Recommendation", "", report["recommendation"], "", "## Artifacts", ""])
    lines.append("- `embedding_eval_report.json`: full metrics and row-level results.")
    lines.append("- `embedding_eval_report.md`: readable summary.")
    lines.append("- `embedding_eval_sample.jsonl`: selected records.")
    lines.append("- `embedding_eval_model_<model>.jsonl`: per-model prompt, neighbor, and query rows.")
    return "\n".join(lines) + "\n"


def write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    args = parse_args()
    root = repo_root()
    load_env(root)

    device = torch.device(args.device)
    if args.require_cuda and device.type != "cuda":
        raise SystemExit(f"--require-cuda was set but selected device is {device}")
    if args.require_cuda and not torch.cuda.is_available():
        raise SystemExit("--require-cuda was set but torch.cuda.is_available() is false")

    output_dir = resolve_path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    taxonomy = read_jsonl(resolve_path(args.taxonomy))
    quality = read_jsonl(resolve_path(args.quality))
    candidates = read_jsonl(resolve_path(args.candidates))
    collections = read_jsonl(resolve_path(args.collections))
    queries = read_json(resolve_path(args.queries))

    quality_by_id = {str(row["id"]): row for row in quality if row.get("id")}
    candidate_by_id = group_by_id(candidates)
    collection_by_id = group_by_id(collections)
    sample = pick_sample(taxonomy, quality_by_id, candidate_by_id, collection_by_id, args.limit, args.public_domain)
    fetched_sample, images, fetch_failures = fetch_images(sample, args.workers)

    models = [model.strip() for model in args.models.split(",") if model.strip()]
    model_reports = []
    model_load_failures = []
    for model_key in models:
        try:
            model_reports.append(evaluate_model(model_key, fetched_sample, images, queries, device, args.batch_size, args.fp16))
        except Exception as exc:
            model_load_failures.append({"modelKey": model_key, "error": str(exc)})

    runtime = {
        "device": str(device),
        "cuda_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(device) if device.type == "cuda" and torch.cuda.is_available() else None,
        "torch_version": torch.__version__,
    }
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "command": "python3 pipelines/vectorize/evaluate_embeddings.py",
        "runtime": runtime,
        "inputs": {
            "taxonomy": str(resolve_path(args.taxonomy).relative_to(root)),
            "quality": str(resolve_path(args.quality).relative_to(root)),
            "candidates": str(resolve_path(args.candidates).relative_to(root)),
            "collections": str(resolve_path(args.collections).relative_to(root)),
            "queries": str(resolve_path(args.queries).relative_to(root)),
        },
        "summary": {
            "sample_rows": len(sample),
            "fetched_images": len(fetched_sample),
            "image_fetch_failures": len(fetch_failures),
            "models_requested": models,
            "models_completed": [model["modelKey"] for model in model_reports],
            "model_load_failures": len(model_load_failures),
        },
        "sample": {
            "distributions": {
                "primaryCategory": count_by(clean_text(row.get("primaryCategory")) for row in fetched_sample),
                "themes": count_by(theme for row in fetched_sample for theme in row.get("themes") or []),
                "sampleReason": count_by(clean_text(row.get("sampleReason")) for row in fetched_sample),
            },
            "rows": fetched_sample,
            "fetchFailures": fetch_failures,
        },
        "models": model_reports,
        "model_load_failures": model_load_failures,
        "recommendation": recommendation(model_reports),
        "artifacts": {
            "report_json": "embedding_eval_report.json",
            "report_markdown": "embedding_eval_report.md",
            "sample_jsonl": "embedding_eval_sample.jsonl",
        },
    }

    (output_dir / "embedding_eval_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    (output_dir / "embedding_eval_report.md").write_text(render_markdown(report), encoding="utf-8")
    write_jsonl(output_dir / "embedding_eval_sample.jsonl", fetched_sample)
    for model in model_reports:
        rows = (
            [{"type": "prompt_alignment", **row} for row in model["promptAlignment"]]
            + [{"type": "nearest_neighbors", **row} for row in model["nearestNeighbors"]]
            + [{"type": "query_result", **row} for row in model["queryResults"]]
        )
        write_jsonl(output_dir / f"embedding_eval_model_{model['modelKey']}.jsonl", rows)

    print(f"[autoresearch:embedding-eval:gpu] output={output_dir}")
    print(f"[autoresearch:embedding-eval:gpu] runtime={json.dumps(runtime)}")
    print(f"[autoresearch:embedding-eval:gpu] summary={json.dumps(report['summary'])}")


if __name__ == "__main__":
    main()
