#!/usr/bin/env python3
"""
VLM Image Captioning for MTL Archives
Run on Lambda Labs A100 GPU for fast batch processing.

Usage:
    python caption_images.py --input manifest_clean.jsonl --output manifest_vlm.jsonl

Requirements (install on Lambda):
    pip install torch transformers accelerate pillow requests tqdm
"""

import argparse
import json
import os
import sys
from io import BytesIO
from pathlib import Path
from typing import Optional
import requests
from PIL import Image
from tqdm import tqdm
import torch
from transformers import AutoProcessor, LlavaForConditionalGeneration

# Configuration
DEFAULT_MODEL = "llava-hf/llava-1.5-7b-hf"  # Good balance of speed/quality
BATCH_SIZE = 1  # VLMs typically process one at a time
MAX_NEW_TOKENS = 200
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def is_real_name(name: str) -> bool:
    """Check if a name is descriptive vs a cote code or filename."""
    if not name or len(name) < 5:
        return False
    # Looks like a filename
    if name.lower().endswith(('.jpg', '.jpeg', '.png', '.tif', '.tiff')):
        return False
    # Looks like a cote code (e.g., VM97,S3,D08,P298)
    if name.upper().startswith('VM') and any(c in name for c in ',_-'):
        import re
        if re.match(r'^VM\d+[,\-_]', name, re.IGNORECASE):
            return False
    # Just numbers and punctuation
    alpha_content = ''.join(c for c in name if c.isalpha() and c not in 'VM')
    return len(alpha_content) >= 3


def build_prompt(record: dict) -> str:
    """Build a contextual prompt for the VLM."""
    parts = []

    name = record.get('name', '').strip()
    date = None

    # Try to get date from various sources
    attrs = record.get('attributes_map', {})
    if attrs.get('Date'):
        date = attrs['Date']
    elif record.get('portal_record', {}).get('Date'):
        date = record['portal_record']['Date']

    has_real_name = name and is_real_name(name)

    if has_real_name or date:
        parts.append("This is an archival photograph from Montreal's city archives.")
        if has_real_name:
            parts.append(f'It is titled "{name}".')
        if date:
            parts.append(f"It is dated {date}.")
    else:
        parts.append("This is a historical photograph from Montreal's city archives.")

    parts.append("\nDescribe what you see in this image in 2-3 sentences. Focus on:")
    parts.append("- The main subject (building, street, park, people, event)")
    parts.append("- Notable visual details (architecture style, vehicles, clothing)")
    parts.append("- The setting (urban, rural, indoor, outdoor)")
    parts.append("\nBe specific and descriptive.")

    return " ".join(parts)


def get_image_url(record: dict) -> Optional[str]:
    """Get the image URL for a record."""
    # Prefer external_url (Montreal's servers)
    if record.get('external_url'):
        return record['external_url']
    return None


def fetch_image(url: str, timeout: int = 30) -> Optional[Image.Image]:
    """Fetch and open an image from URL."""
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        return Image.open(BytesIO(response.content)).convert('RGB')
    except Exception as e:
        print(f"Failed to fetch {url}: {e}", file=sys.stderr)
        return None


def needs_captioning(record: dict) -> bool:
    """Check if a record needs VLM captioning."""
    source = record.get('description_source', '')
    return source == 'synthetic' or 'synthetic' in source


def load_model(model_name: str):
    """Load the VLM model and processor."""
    print(f"Loading model {model_name}...")
    print(f"Device: {DEVICE}")

    if DEVICE == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    processor = AutoProcessor.from_pretrained(model_name)
    model = LlavaForConditionalGeneration.from_pretrained(
        model_name,
        torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
        device_map="auto" if DEVICE == "cuda" else None,
        low_cpu_mem_usage=True,
    )

    if DEVICE == "cuda":
        model = model.eval()

    print("Model loaded.")
    return model, processor


def caption_image(model, processor, image: Image.Image, prompt: str) -> str:
    """Generate a caption for an image."""
    # LLaVA prompt format
    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": prompt},
            ],
        },
    ]

    text_prompt = processor.apply_chat_template(conversation, add_generation_prompt=True)

    inputs = processor(
        text=text_prompt,
        images=image,
        return_tensors="pt",
    ).to(model.device)

    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            do_sample=False,
        )

    # Decode and extract the response
    full_response = processor.decode(output[0], skip_special_tokens=True)

    # Extract just the assistant's response (after the prompt)
    if "ASSISTANT:" in full_response:
        caption = full_response.split("ASSISTANT:")[-1].strip()
    else:
        # Fallback: take everything after the prompt
        caption = full_response[len(text_prompt):].strip()

    return caption


def main():
    parser = argparse.ArgumentParser(description="VLM Image Captioning for MTL Archives")
    parser.add_argument("--input", required=True, help="Input JSONL file (manifest_clean.jsonl)")
    parser.add_argument("--output", required=True, help="Output JSONL file (manifest_vlm.jsonl)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model to use (default: {DEFAULT_MODEL})")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of records to process")
    parser.add_argument("--offset", type=int, default=0, help="Skip first N records")
    parser.add_argument("--only-synthetic", action="store_true", default=True, help="Only caption synthetic descriptions")
    parser.add_argument("--all", action="store_true", help="Caption all records (override --only-synthetic)")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Load records
    print(f"Reading from: {input_path}")
    records = []
    with open(input_path, 'r') as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    # Apply offset and limit
    if args.offset > 0:
        records = records[args.offset:]
        print(f"Skipped {args.offset} records (offset)")

    if args.limit > 0:
        records = records[:args.limit]
        print(f"Limited to {args.limit} records")

    print(f"Total records: {len(records)}")

    # Filter to synthetic only if requested
    only_synthetic = args.only_synthetic and not args.all
    if only_synthetic:
        to_process = [r for r in records if needs_captioning(r)]
        print(f"Records needing captioning: {len(to_process)}")
    else:
        to_process = records

    if not to_process:
        print("No records to process.")
        return

    # Load model
    model, processor = load_model(args.model)

    # Process records
    print(f"\nProcessing {len(to_process)} images...")

    captioned = 0
    errors = 0

    with open(output_path, 'w') as out_f:
        for record in tqdm(records, desc="Captioning"):
            should_caption = not only_synthetic or needs_captioning(record)

            if should_caption:
                url = get_image_url(record)

                if not url:
                    record['vlm_caption'] = None
                    record['vlm_error'] = 'no_image_url'
                    errors += 1
                else:
                    image = fetch_image(url)

                    if image is None:
                        record['vlm_caption'] = None
                        record['vlm_error'] = 'fetch_failed'
                        errors += 1
                    else:
                        try:
                            prompt = build_prompt(record)
                            caption = caption_image(model, processor, image, prompt)
                            record['vlm_caption'] = caption
                            record['vlm_captioned_at'] = __import__('datetime').datetime.now().isoformat()
                            captioned += 1
                        except Exception as e:
                            record['vlm_caption'] = None
                            record['vlm_error'] = str(e)
                            errors += 1

            out_f.write(json.dumps(record) + '\n')

    print(f"\n=== Complete ===")
    print(f"Captioned: {captioned}")
    print(f"Errors: {errors}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
