#!/usr/bin/env python3
"""Daily reel pipeline: search → grids → research → reel → caption."""
import argparse
import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

# Load .env from repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
_env_file = REPO_ROOT / ".env"
if _env_file.exists():
    with open(_env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                val = val.strip().strip('"').strip("'")
                os.environ.setdefault(key.strip(), val)

from search import search_images, get_random_images, download_image, format_metadata
from grids import generate_grids
from research import research_image
from reel import generate_reel
from caption import generate_caption


OUTPUT_DIR = Path.home() / "Downloads" / "Recents"


def run_pipeline(
    query: str | None = None,
    image_id: str | None = None,
    output_dir: str | None = None,
    num_grids: int = 5,
    skip_reel: bool = False,
) -> dict:
    """
    Run the full daily reel pipeline.

    Args:
        query: Search query for finding an image (uses random if None)
        image_id: Specific photo ID to use (overrides query)
        output_dir: Where to save outputs (defaults to ~/Downloads/Recents)
        num_grids: Number of grid crops to generate
        skip_reel: If True, skip video generation (useful for research-only runs)

    Returns:
        Dict with paths and metadata for all outputs
    """
    out_dir = Path(output_dir) if output_dir else OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    today = date.today().isoformat()
    work_dir = tempfile.mkdtemp(prefix=f"reel_{today}_")

    print(f"🔍 Working directory: {work_dir}")

    # --- Step 1: Find an image ---
    print("\n📷 Step 1: Finding image...")
    if image_id:
        from search import get_photo_by_id
        record = get_photo_by_id(image_id)
        if not record:
            print(f"  ❌ Photo ID '{image_id}' not found")
            sys.exit(1)
        results = [record]
    elif query:
        results = search_images(query, mode="smart", limit=5)
    else:
        results = get_random_images(limit=5)

    if not results:
        print("  ❌ No images found")
        sys.exit(1)

    # Pick the first result (or could add selection logic)
    record = results[0]
    print(f"  ✓ Selected: {record.get('name', record.get('metadata_filename', 'unknown'))}")

    # Download the image
    image_url = record.get("imageUrl") or record.get("externalUrl")
    if not image_url:
        print("  ❌ No image URL in record")
        sys.exit(1)

    main_image = os.path.join(work_dir, "source.jpg")
    print(f"  ⬇ Downloading image...")
    download_image(image_url, main_image)
    print(f"  ✓ Downloaded to {main_image}")

    # --- Step 2: Generate grids ---
    print("\n🔲 Step 2: Generating grid crops...")
    grid_dir = os.path.join(work_dir, "grids")
    grid_paths = generate_grids(main_image, grid_dir, num_grids=num_grids)
    print(f"  ✓ Generated {len(grid_paths)} grid crops")

    # --- Step 3: Research via Gemini ---
    print("\n🔬 Step 3: Researching image with Gemini...")
    metadata = format_metadata(record)
    if metadata:
        print(f"  📋 Using D1 metadata as context")

    research = research_image(main_image, grid_paths, metadata)
    # Handle edge case where Gemini returns a list
    if isinstance(research, list):
        research = research[0] if research else {}
    print(f"  ✓ Research complete: {research.get('title', 'untitled')}")

    # Save research JSON
    research_path = os.path.join(work_dir, "research.json")
    with open(research_path, "w") as f:
        json.dump(research, f, indent=2, ensure_ascii=False)

    # --- Step 4: Generate reel ---
    reel_path = None
    if not skip_reel:
        print("\n🎬 Step 4: Generating reel video...")
        slug = research.get("title", "reel").lower().replace(" ", "_")[:30]
        reel_path = str(out_dir / f"mtl_archives_{slug}_{today}.mp4")
        generate_reel(research, main_image, grid_paths, reel_path, work_dir)
        print(f"  ✓ Reel saved: {reel_path}")
    else:
        print("\n⏭ Step 4: Skipping reel generation")

    # --- Step 5: Generate caption ---
    print("\n✍️  Step 5: Generating caption...")
    cap = generate_caption(research)
    caption_path = os.path.join(work_dir, "caption.txt")
    with open(caption_path, "w") as f:
        f.write(cap)
    print(f"  ✓ Caption saved: {caption_path}")

    # Also save to output dir
    caption_out = str(out_dir / f"mtl_archives_{today}_caption.txt")
    with open(caption_out, "w") as f:
        f.write(cap)

    # --- Summary ---
    print("\n" + "=" * 50)
    print("✅ Pipeline complete!")
    print(f"  📁 Work dir:  {work_dir}")
    if reel_path:
        print(f"  🎬 Reel:      {reel_path}")
    print(f"  ✍️  Caption:   {caption_out}")
    print(f"  🔬 Research:  {research_path}")
    print("=" * 50)

    # Print caption preview
    print("\n--- Caption Preview ---")
    print(cap[:500])
    print("---")

    return {
        "work_dir": work_dir,
        "main_image": main_image,
        "grid_paths": grid_paths,
        "research": research,
        "research_path": research_path,
        "reel_path": reel_path,
        "caption_path": caption_out,
    }


def main():
    parser = argparse.ArgumentParser(description="Daily reel pipeline for @mtlarchives")
    parser.add_argument("query", nargs="?", help="Search query (random if omitted)")
    parser.add_argument("--id", help="Specific photo ID to use")
    parser.add_argument("--output", "-o", help="Output directory")
    parser.add_argument("--grids", type=int, default=5, help="Number of grid crops (default: 5)")
    parser.add_argument("--no-reel", action="store_true", help="Skip video generation")
    parser.add_argument("--research-only", action="store_true", help="Only do search + research (no video/caption)")

    args = parser.parse_args()

    if args.research_only:
        args.no_reel = True

    run_pipeline(
        query=args.query,
        image_id=args.id,
        output_dir=args.output,
        num_grids=args.grids,
        skip_reel=args.no_reel,
    )


if __name__ == "__main__":
    main()
