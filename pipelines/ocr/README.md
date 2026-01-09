# OCR Pipeline

Runs Tesseract OCR over archive images and writes `manifest_ocr.jsonl`.

## Requirements

- Python 3.10+
- Tesseract (with English + French language packs)

Ubuntu install:

```
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra
```

## Setup

```
python3 -m venv .venv
. .venv/bin/activate
pip install -r pipelines/ocr/requirements.txt
```

## Run

```
python pipelines/ocr/ocr-images.py \
  --input data/mtl_archives/manifest_linked.jsonl \
  --output data/mtl_archives/manifest_ocr.jsonl \
  --workers 8 \
  --prefer-r2 \
  --resume
```

Options:
- `--lang fra+eng` (default) for bilingual OCR
- `--psm 6` for block text (tweak if needed)
- `--log-every 100` to reduce log spam
- `--max-dimension 4096` to downscale huge images
- `--max-pixels 90000000` to cap total pixels before downscaling
- `--retry-errors` to reprocess only failed OCR rows

Set `OCR_PREFER_R2=1` to force R2 image URLs.
