#!/usr/bin/env python3
"""
SAM Bureaucracy Stripping Experiment

Hypothesis: CLIP separates "Urban Planning Documents" from "Raw Aerials"
because of the official borders, stamps, and index numbers - not the content.

This experiment:
1. Takes images from the Urban Planning Documents cluster
2. Uses SAM to detect and mask the border regions
3. Re-embeds just the aerial photo content with CLIP
4. Compares embedding positions before/after

If the stripped images move closer to the raw aerials cluster,
we've proven CLIP was responding to bureaucratic formatting.
"""

import os
import sys
import json
import requests
from io import BytesIO
from pathlib import Path

import torch
import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
from transformers import CLIPProcessor, CLIPModel

# Check for SAM availability
try:
    from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
    SAM_AVAILABLE = True
except ImportError:
    SAM_AVAILABLE = False
    print("SAM not installed. Install with: pip install segment-anything")
    print("Also download model: wget https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth")


# Sample images from Urban Planning Documents cluster (from our analysis)
PLANNING_DOC_SAMPLES = [
    "https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/mtl_archives_image_10005.jpg",
    "https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/mtl_archives_image_10006.jpg",
    "https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/mtl_archives_image_10007.jpg",
]

# Cluster centers from our analysis
CLUSTER_CENTERS = {
    "raw_aerials": (0.58, 0.28),      # Yellow - 1940s aerial survey
    "planning_docs": (0.73, 0.78),     # Green - Urban planning documents
}


def download_image(url: str) -> Image.Image:
    """Download an image from URL."""
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return Image.open(BytesIO(response.content)).convert("RGB")


def get_clip_embedding(image: Image.Image, model, processor) -> np.ndarray:
    """Get CLIP embedding for an image."""
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        features = model.get_image_features(**inputs)
    return features.numpy().flatten()


def detect_border_mask(image: np.ndarray, sam_generator) -> np.ndarray:
    """
    Use SAM to detect border regions.
    Strategy: The border is typically the largest mask that touches all edges.
    """
    masks = sam_generator.generate(image)

    if not masks:
        return None

    h, w = image.shape[:2]

    # Find masks that touch edges (likely border/frame)
    border_masks = []
    for mask_data in masks:
        mask = mask_data["segmentation"]

        # Check if mask touches edges
        touches_top = np.any(mask[0, :])
        touches_bottom = np.any(mask[-1, :])
        touches_left = np.any(mask[:, 0])
        touches_right = np.any(mask[:, -1])

        edge_count = sum([touches_top, touches_bottom, touches_left, touches_right])

        if edge_count >= 3:  # Touches at least 3 edges = likely border
            border_masks.append(mask)

    if not border_masks:
        # Fallback: use simple edge detection
        # Assume border is the outer 5% on each side
        border_mask = np.ones((h, w), dtype=bool)
        margin_h = int(h * 0.05)
        margin_w = int(w * 0.05)
        border_mask[margin_h:-margin_h, margin_w:-margin_w] = False
        return border_mask

    # Combine all border masks
    combined_border = np.zeros((h, w), dtype=bool)
    for mask in border_masks:
        combined_border |= mask

    return combined_border


def strip_borders(image: Image.Image, border_mask: np.ndarray) -> Image.Image:
    """Remove borders by cropping to the content area."""
    img_array = np.array(image)

    # Find the bounding box of the non-border region
    content_mask = ~border_mask
    rows = np.any(content_mask, axis=1)
    cols = np.any(content_mask, axis=0)

    if not np.any(rows) or not np.any(cols):
        return image  # No content found, return original

    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    # Crop to content
    cropped = img_array[rmin:rmax+1, cmin:cmax+1]
    return Image.fromarray(cropped)


def simple_border_strip(image: Image.Image, margin_percent: float = 0.08) -> Image.Image:
    """Simple border stripping by cropping margins."""
    w, h = image.size
    margin_w = int(w * margin_percent)
    margin_h = int(h * margin_percent)

    return image.crop((margin_w, margin_h, w - margin_w, h - margin_h))


def run_experiment():
    """Run the border stripping experiment."""
    print("=" * 70)
    print("SAM BUREAUCRACY STRIPPING EXPERIMENT")
    print("=" * 70)
    print()

    # Load CLIP model
    print("Loading CLIP model...")
    clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    print("CLIP loaded.")

    # Load SAM if available
    sam_generator = None
    if SAM_AVAILABLE:
        sam_checkpoint = Path(__file__).parent / "sam_vit_h_4b8939.pth"
        if sam_checkpoint.exists():
            print("Loading SAM model...")
            sam = sam_model_registry["vit_h"](checkpoint=str(sam_checkpoint))
            sam_generator = SamAutomaticMaskGenerator(sam)
            print("SAM loaded.")
        else:
            print(f"SAM checkpoint not found at {sam_checkpoint}")
            print("Using simple margin cropping instead.")
    else:
        print("SAM not available. Using simple margin cropping instead.")

    print()
    print("Processing images...")
    print("-" * 70)

    results = []

    for i, url in enumerate(PLANNING_DOC_SAMPLES):
        print(f"\nImage {i+1}: {url.split('/')[-1]}")

        try:
            # Download image
            image = download_image(url)
            print(f"  Downloaded: {image.size}")

            # Get original embedding
            original_embedding = get_clip_embedding(image, clip_model, clip_processor)

            # Strip borders
            if sam_generator:
                img_array = np.array(image)
                border_mask = detect_border_mask(img_array, sam_generator)
                if border_mask is not None:
                    stripped_image = strip_borders(image, border_mask)
                else:
                    stripped_image = simple_border_strip(image)
            else:
                stripped_image = simple_border_strip(image)

            print(f"  Stripped: {stripped_image.size}")

            # Get stripped embedding
            stripped_embedding = get_clip_embedding(stripped_image, clip_model, clip_processor)

            # Calculate distances to cluster centers
            # Note: We're working in 512D CLIP space, not 2D UMAP space
            # But we can measure embedding shift
            embedding_shift = np.linalg.norm(stripped_embedding - original_embedding)
            cosine_sim = np.dot(original_embedding, stripped_embedding) / (
                np.linalg.norm(original_embedding) * np.linalg.norm(stripped_embedding)
            )

            results.append({
                "url": url,
                "original_size": image.size,
                "stripped_size": stripped_image.size,
                "embedding_shift": float(embedding_shift),
                "cosine_similarity": float(cosine_sim),
            })

            print(f"  Embedding shift: {embedding_shift:.4f}")
            print(f"  Cosine similarity (original vs stripped): {cosine_sim:.4f}")

        except Exception as e:
            print(f"  Error: {e}")
            continue

    print()
    print("=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)

    if results:
        avg_shift = np.mean([r["embedding_shift"] for r in results])
        avg_cosine = np.mean([r["cosine_similarity"] for r in results])

        print(f"\nAverage embedding shift: {avg_shift:.4f}")
        print(f"Average cosine similarity: {avg_cosine:.4f}")
        print()
        print("INTERPRETATION:")
        print("-" * 40)

        if avg_cosine > 0.95:
            print("High similarity (>0.95): Border removal had MINIMAL impact.")
            print("CLIP's separation is likely based on CONTENT, not framing.")
        elif avg_cosine > 0.85:
            print("Moderate similarity (0.85-0.95): Border removal had SOME impact.")
            print("CLIP responds to BOTH content and framing.")
        else:
            print("Low similarity (<0.85): Border removal had SIGNIFICANT impact.")
            print("CLIP was heavily influenced by bureaucratic formatting!")
            print("This supports our hypothesis.")

    return results


if __name__ == "__main__":
    results = run_experiment()
