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

# Safer restartable run: each chunk starts a fresh Python/CUDA process
python caption_images_resilient.py \
    --input ~/manifest_clean.jsonl \
    --output ~/manifest_vlm_test_resilient.jsonl \
    --limit 100 \
    --chunk-size 20 \
    --attempts-report ~/manifest_vlm_test_resilient_attempts.json

# Same resilient flow, but fetch images from Cloudflare R2
CLOUDFLARE_R2_PUBLIC_DOMAIN=pub-xxxxxxxx.r2.dev \
python caption_images_resilient.py \
    --input ~/manifest_clean.jsonl \
    --output ~/manifest_vlm_test_resilient_r2.jsonl \
    --source r2 \
    --limit 100 \
    --chunk-size 20 \
    --attempts-report ~/manifest_vlm_test_resilient_r2_attempts.json
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
--source         Image source for resilient runs: external or r2
--prompt-variant Structured prompt variant: detailed or compact
--only-synthetic Only caption records with synthetic descriptions (default)
--all            Caption all records
```

## Prompt Bakeoff

Use the autoresearch bakeoff commands before changing the full-run prompt/model:

```bash
npm run autoresearch:vlm:bakeoff-sample -- --limit 6
npm run autoresearch:vlm:managed -- \
  --input data/mtl_archives/reports/autoresearch_vlm_bakeoff/input.jsonl \
  --output detailed_llava7b.jsonl \
  --output-dir data/mtl_archives/reports/autoresearch_vlm_bakeoff \
  --source r2 \
  --prompt-variant detailed \
  --all
npm run autoresearch:vlm:bakeoff-report -- \
  --run detailed=data/mtl_archives/reports/autoresearch_vlm_bakeoff/detailed_llava7b.jsonl
```

Current recommendation: use `--prompt-variant detailed`. The 2026-05-24 bakeoff report is in `data/mtl_archives/reports/autoresearch_vlm_bakeoff/report.md`.

## Output Format

Each successfully captioned record keeps the backward-compatible `vlm_caption` field and adds structured metadata under `vlm_metadata`:

```json
{
  "metadata_filename": "mtl_archives_metadata_1.json",
  "name": "Parc Lafontaine",
  "description": "Parc Lafontaine. Capturée ou datée de Décennie 1930...",
  "vlm_caption": "A serene park scene showing tree-lined pathways with people strolling...",
  "vlm_captioned_at": "2026-05-24T10:30:00.000Z",
  "vlm_metadata_valid": true,
  "vlm_metadata_schema_version": 1,
  "vlm_metadata": {
    "schema_version": 1,
    "caption": "A serene park scene showing tree-lined pathways with people strolling...",
    "scene_type": "park",
    "visual_subjects": ["park", "trees", "pathway", "people"],
    "setting": "urban park",
    "season": "summer",
    "aerial_ground_document": "ground",
    "search_terms": ["park", "trees", "pathway", "Montreal"],
    "social_hook": "A quiet view of everyday public life in a Montreal park.",
    "print_quality": "good",
    "quality_notes": "Readable composition with moderate detail.",
    "missing_fields": []
  },
  "vlm_metadata_error": null
}
```

If the model returns malformed JSON, the runner does not crash. It stores the raw response in `vlm_raw_response`, keeps a best-effort `vlm_caption`, sets `vlm_metadata_valid` to `false`, and records the parse problem in `vlm_metadata_error`.

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
