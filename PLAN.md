# Issue #8: CLIP Embeddings Implementation Plan

## Current State
- Semantic search uses BGE text embeddings (`@cf/baai/bge-large-en-v1.5`, 1024 dims)
- Embeds text metadata only: `name + description + portal_title + portal_description`
- Search quality limited by metadata quality

## Goal
Replace text-only embeddings with CLIP image embeddings, enabling:
- Visual similarity search (find visually similar photos)
- Better search for photos with poor/missing metadata
- Concept-based queries ("art deco building", "aerial view")

## Architecture Decision

**Approach: Pre-compute image embeddings offline (Option 3 from issue)**

Why this approach:
- Cloudflare Workers AI has NO CLIP model
- Can use Hugging Face Transformers locally (free, no API costs)
- 14,822 images × one-time processing
- Query-time: generate CLIP text embedding → query Vectorize

## Implementation Steps

### Phase 1: New Vectorize Index
1. Create new Vectorize index `mtl-archives-clip` with 512 dimensions
   - Current `mtl-archives` index is 1024 dims (BGE), incompatible
   - Use 512 dims for ViT-B/32 model (good balance of quality/speed)

### Phase 2: Image Embedding Pipeline
2. Create Python script `pipelines/vectorize/ingest_clip.py`
   - Use Hugging Face `transformers` library
   - Model: `openai/clip-vit-base-patch32` (512 dims, widely used)
   - Read images from R2 (or local sync)
   - Batch process images → generate embeddings
   - Upsert to Vectorize via REST API

3. Dependencies
   - `transformers`, `torch`, `Pillow`
   - Same Cloudflare credentials as existing vectorize scripts

### Phase 3: Query-Time Text Embeddings
4. Runtime: Use HuggingFace Inference API (free tier)
   - Call HF Inference API from Worker for query text → embedding
   - Model: `openai/clip-vit-base-patch32` (same as image encoder)
   - Cache embeddings in KV for repeated queries
   - Free tier should handle moderate traffic

### Phase 4: Worker Changes
5. Update `api/worker.ts`:
   - New search mode `mode=clip` (or replace `semantic`)
   - Call external CLIP text encoder for query embedding
   - Query new `mtl-archives-clip` Vectorize index
   - Cache query embeddings in KV

### Phase 5: Evaluation
6. Compare search quality:
   - Same test queries on BGE (text) vs CLIP (image)
   - Especially queries where metadata is poor
   - Use `pipelines/vectorize/evaluate_search_quality.js` as baseline

## Cost Estimate

| Item | Cost |
|------|------|
| Image embedding generation (one-time) | Free (local Python) |
| Vectorize storage (~15k vectors × 512 dims) | Included in plan |
| Query embeddings (HuggingFace) | Free tier |
| KV caching | Included in plan |

## Files to Create/Modify

### New Files
- `pipelines/vectorize/ingest_clip.py` - Image embedding generation
- `pipelines/vectorize/requirements.txt` - Python dependencies

### Modified Files
- `wrangler.toml` - Add new Vectorize index binding
- `api/worker.ts` - Add CLIP search mode, external API call

## Decisions Made

1. **Image source**: R2 only → Download/stream from R2 during batch processing
2. **Query embedding service**: HuggingFace Inference API (free tier)
3. **Keep BGE as fallback?**: Yes, keep both during evaluation, then decide

## Next Steps

1. [ ] Create new Vectorize index `mtl-archives-clip`
2. [ ] Write `ingest_clip.py` script
3. [ ] Test on small batch (100 images)
4. [ ] Run full ingestion (~15k images)
5. [ ] Set up Replicate for query embeddings
6. [ ] Update Worker with CLIP search mode
7. [ ] Evaluate quality vs BGE baseline
