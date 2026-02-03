import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from math import sqrt
from typing import Any, Dict, Iterable, Optional, Set, Tuple
from urllib.parse import quote

import requests
from PIL import Image
import pytesseract
from pytesseract import Output


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return ' '.join(str(value).split()).strip()


def get_image_url(record: Dict[str, Any], prefer_r2: bool, r2_domain: Optional[str]) -> Optional[str]:
    filename = record.get('resolved_image_filename') or record.get('image_filename')
    if filename and prefer_r2 and r2_domain:
        return f"https://{r2_domain}/{quote(filename)}"
    if record.get('external_url'):
        return record['external_url']
    if filename and r2_domain:
        return f"https://{r2_domain}/{quote(filename)}"
    return None


def download_image(url: str, timeout: int) -> bytes:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.content


Image.MAX_IMAGE_PIXELS = None


def prepare_image(image_bytes: bytes, max_dimension: int, max_pixels: int) -> Tuple[Image.Image, Dict[str, Any]]:
    image = Image.open(BytesIO(image_bytes))
    width, height = image.size
    original = {'width': width, 'height': height}
    downscaled = False

    scale = 1.0
    if max_dimension and max(width, height) > max_dimension:
        scale = min(scale, max_dimension / float(max(width, height)))

    if max_pixels and (width * height) > max_pixels:
        scale = min(scale, sqrt(max_pixels / float(width * height)))

    if scale < 1.0:
        new_width = max(1, int(width * scale))
        new_height = max(1, int(height * scale))
        image = image.resize((new_width, new_height), Image.LANCZOS)
        downscaled = True

    if image.mode not in ('RGB', 'L'):
        image = image.convert('RGB')
    image = image.convert('L')

    processed = {'width': image.width, 'height': image.height}
    return image, {
        'ocr_original_width': original['width'],
        'ocr_original_height': original['height'],
        'ocr_processed_width': processed['width'],
        'ocr_processed_height': processed['height'],
        'ocr_downscaled': downscaled,
    }


def run_ocr(image: Image.Image, lang: str, psm: int) -> Dict[str, Any]:
    data = pytesseract.image_to_data(image, lang=lang, config=f'--psm {psm}', output_type=Output.DICT)
    words = [clean_text(text) for text in data.get('text', []) if clean_text(text)]
    conf_values = [int(c) for c in data.get('conf', []) if c not in ('-1', '', None)]

    text = ' '.join(words)
    avg_conf = (sum(conf_values) / len(conf_values) / 100.0) if conf_values else 0.0

    return {
        'ocr_text': text,
        'ocr_confidence': round(avg_conf, 4),
        'ocr_word_count': len(words),
    }


def load_processed_ids(output_path: str, retry_errors: bool) -> Set[str]:
    processed: Set[str] = set()
    if not os.path.exists(output_path):
        return processed

    with open(output_path, 'r', encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            metadata_filename = record.get('metadata_filename')
            if not metadata_filename:
                continue
            if retry_errors and record.get('ocr_error'):
                continue
            processed.add(metadata_filename)
            print("metadata_filename", metadata_filename)

    return processed


def process_record(record: Dict[str, Any], prefer_r2: bool, r2_domain: Optional[str], lang: str,
                   timeout: int, psm: int, max_dimension: int, max_pixels: int) -> Dict[str, Any]:
    metadata_filename = record.get('metadata_filename')
    payload = {
        'metadata_filename': metadata_filename,
        'ocr_text': '',
        'ocr_confidence': 0.0,
        'ocr_word_count': 0,
        'ocr_language': lang,
        'ocr_source': 'tesseract',
        'ocr_generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'ocr_error': None,
    }

    image_url = get_image_url(record, prefer_r2, r2_domain)
    if not image_url:
        payload['ocr_error'] = 'no_image_url'
        return payload

    try:
        image_bytes = download_image(image_url, timeout)
        image, meta = prepare_image(image_bytes, max_dimension, max_pixels)
        ocr_result = run_ocr(image, lang, psm)
        payload.update(meta)
        payload.update(ocr_result)
    except Exception as exc:
        payload['ocr_error'] = str(exc)

    return payload


def iterate_records(path: str) -> Iterable[Dict[str, Any]]:
    with open(path, 'r', encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def main() -> None:
    parser = argparse.ArgumentParser(description='Run OCR on manifest images and output JSONL.')
    parser.add_argument('--input', default='data/mtl_archives/manifest_linked.jsonl')
    parser.add_argument('--output', default='data/mtl_archives/manifest_ocr.jsonl')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--prefer-r2', action='store_true')
    parser.add_argument('--timeout', type=int, default=60)
    parser.add_argument('--lang', default='fra+eng')
    parser.add_argument('--psm', type=int, default=6)
    parser.add_argument('--log-every', type=int, default=100)
    parser.add_argument('--max-dimension', type=int, default=4096)
    parser.add_argument('--max-pixels', type=int, default=90000000)
    parser.add_argument('--retry-errors', action='store_true')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f'Input file not found: {args.input}', file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    r2_domain = os.environ.get('CLOUDFLARE_R2_PUBLIC_DOMAIN')
    prefer_r2 = args.prefer_r2 or os.environ.get('OCR_PREFER_R2') in ('1', 'true', 'True')

    processed_ids: Set[str] = set()
    if args.resume:
        processed_ids = load_processed_ids(args.output, args.retry_errors)
        print(f'Resume enabled. Already processed: {len(processed_ids)}')

    records = list(iterate_records(args.input))
    if args.offset:
        records = records[args.offset:]
    if args.limit:
        records = records[:args.limit]

    total = len(records)
    print(f'Processing {total} records with {args.workers} workers')

    output_handle = open(args.output, 'a' if args.resume else 'w', encoding='utf-8')

    processed = 0
    skipped = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = []
        for record in records:
            metadata_filename = record.get('metadata_filename')
            if args.resume and metadata_filename in processed_ids:
                skipped += 1
                continue
            futures.append(executor.submit(
                process_record,
                record,
                prefer_r2,
                r2_domain,
                args.lang,
                args.timeout,
                args.psm,
                args.max_dimension,
                args.max_pixels,
            ))

        for future in as_completed(futures):
            result = future.result()
            output_handle.write(json.dumps(result) + '\n')
            processed += 1
            if processed % args.log_every == 0 or processed == total:
                print(f'Processed {processed}/{total} (skipped {skipped})')

    output_handle.close()
    print('OCR complete')


if __name__ == '__main__':
    main()
