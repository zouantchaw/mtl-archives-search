# CLIP Vectorize (GPU)

Generate CLIP image embeddings on a GPU instance and upsert to Cloudflare Vectorize.

## Setup

```bash
cd pipelines/vectorize
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_VECTORIZE_INDEX=mtl-archives-clip
export CLOUDFLARE_R2_PUBLIC_DOMAIN=pub-xxxxxxxx.r2.dev

python ingest_clip.py \
  --input ../../data/mtl_archives/manifest_vlm_complete.jsonl \
  --batch-size 64 \
  --workers 8 \
  --prefer-r2
```

Use `--limit` and `--offset` for quick tests.
