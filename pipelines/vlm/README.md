# VLM Captioning Pipeline

Generate image captions using a Vision Language Model on Lambda Labs GPU.

## Quick Start (Lambda Labs)

### 1. Launch Instance

- Go to [Lambda Labs Cloud](https://lambda.ai/)
- Launch an **A100 40GB** instance (~$1.29/hr)
- SSH into the instance

### 2. Setup

```bash
# Clone repo (or scp the files)
git clone <your-repo> mtl-archives-search
cd mtl-archives-search/pipelines/vlm

# Install dependencies
pip install -r requirements.txt

# Upload your manifest_clean.jsonl
scp data/mtl_archives/manifest_clean.jsonl ubuntu@<lambda-ip>:~/manifest_clean.jsonl
```

### 3. Run

```bash
# Full dataset (~14k synthetic records)
python caption_images.py \
    --input ~/manifest_clean.jsonl \
    --output ~/manifest_vlm.jsonl

# Test with 100 images first
python caption_images.py \
    --input ~/manifest_clean.jsonl \
    --output ~/manifest_vlm_test.jsonl \
    --limit 100
```

### 4. Download Results

```bash
# From your local machine
scp ubuntu@<lambda-ip>:~/manifest_vlm.jsonl data/mtl_archives/manifest_vlm.jsonl
```

## Estimated Time & Cost

| GPU | Time for 14k images | Cost |
|-----|---------------------|------|
| A100 40GB | ~2-3 hours | ~$3-4 |
| A100 80GB | ~2-3 hours | ~$4-5 |
| H100 | ~1-2 hours | ~$4-6 |

## Model Options

Default: `llava-hf/llava-1.5-7b-hf` (good balance)

Alternatives:
```bash
# Larger, better quality
python caption_images.py --model llava-hf/llava-1.5-13b-hf ...

# Faster, lower quality
python caption_images.py --model llava-hf/bakLlava-v1-hf ...
```

## CLI Options

```
--input          Input JSONL file (required)
--output         Output JSONL file (required)
--model          VLM model to use (default: llava-hf/llava-1.5-7b-hf)
--limit          Process only first N records
--offset         Skip first N records
--only-synthetic Only caption records with synthetic descriptions (default)
--all            Caption all records
```

## Output Format

Each record in the output will have new fields:

```json
{
  "metadata_filename": "mtl_archives_metadata_1.json",
  "name": "Parc Lafontaine",
  "description": "Parc Lafontaine. Capturée ou datée de Décennie 1930...",
  "vlm_caption": "A serene park scene showing tree-lined pathways with people strolling...",
  "vlm_captioned_at": "2025-12-16T10:30:00.000Z"
}
```

## Troubleshooting

**Out of memory:**
- Use a smaller model (`bakLlava-v1-hf`)
- Or use A100 80GB instance

**Slow image downloads:**
- Images are fetched from Montreal's servers
- Network is usually the bottleneck, not GPU

**Model download slow:**
- First run downloads ~14GB of model weights
- Subsequent runs use cached weights
