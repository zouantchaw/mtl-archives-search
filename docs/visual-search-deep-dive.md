# Visual Search for Historical Archives: A Deep Dive

This document explains the visual search system we built for the Montreal Archives photo collection (~15,000 historical images), covering the key concepts from first principles.

## Table of Contents

1. [The Problem](#the-problem)
2. [Understanding Embeddings](#understanding-embeddings)
3. [CLIP: Connecting Vision and Language](#clip-connecting-vision-and-language)
4. [Vector Databases and Similarity Search](#vector-databases-and-similarity-search)
5. [Dimensionality Reduction with UMAP](#dimensionality-reduction-with-umap)
6. [The Complete Architecture](#the-complete-architecture)
7. [Browser-Side Inference with Transformers.js](#browser-side-inference-with-transformersjs)
8. [Files and Scripts Reference](#files-and-scripts-reference)

---

## The Problem

We have ~15,000 historical photographs from Montreal's archives. Traditional search only works if images have good metadata (titles, descriptions, tags). But:

- Many images have cryptic filenames like `VM97-3_7P47-76.jpg`
- Metadata is inconsistent or missing
- Users want to search by *what's in the image*, not just text fields

**Goal**: Enable searches like "park with trees" or "downtown buildings" and find visually relevant images, even if those words don't appear in the metadata.

---

## Understanding Embeddings

### What is an Embedding?

An embedding is a way to represent complex data (images, text, audio) as a list of numbers—a **vector**. These numbers capture the *semantic meaning* of the content.

```
"A photo of a cat" → [0.12, -0.45, 0.78, ..., 0.23]  (512 numbers)
[Image of a cat]   → [0.11, -0.44, 0.79, ..., 0.24]  (512 numbers)
```

The key insight: **similar things have similar vectors**. If two vectors are close together in this high-dimensional space, the things they represent are semantically similar.

### Measuring Similarity: Cosine Similarity

To find how similar two embeddings are, we use **cosine similarity**:

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

- Returns 1.0 for identical vectors
- Returns 0.0 for completely unrelated vectors
- Returns -1.0 for opposite vectors

This works because we're measuring the angle between vectors, not their magnitude.

### Why 512 Dimensions?

CLIP uses 512-dimensional vectors. Why so many?

- More dimensions = more capacity to capture nuance
- A 2D vector could only encode 2 features
- 512 dimensions can encode hundreds of visual concepts: color, texture, objects, composition, style, era, etc.

Think of it like describing a photo with 512 different scores, each measuring a different aspect.

---

## CLIP: Connecting Vision and Language

### The Innovation

**CLIP** (Contrastive Language-Image Pre-training) by OpenAI was trained on 400 million image-text pairs from the internet. The key innovation: it learns to put images and their descriptions in the **same embedding space**.

```
Text: "a red sports car"     → [0.5, 0.3, ...]  ─┐
                                                  ├── Close together!
Image: [photo of red Ferrari] → [0.5, 0.3, ...] ─┘
```

This means you can:
1. Encode a text query
2. Compare it directly to image embeddings
3. Find images that match the text semantically

### Two Encoders, One Space

CLIP has two separate neural networks:

```
┌─────────────────┐     ┌─────────────────┐
│  Text Encoder   │     │  Image Encoder  │
│  (Transformer)  │     │  (Vision Trans- │
│                 │     │   former/ResNet)│
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
    [512-dim vector]       [512-dim vector]
         │                       │
         └───────────┬───────────┘
                     │
              Same vector space!
```

### The Model We Used

```python
# We used: openai/clip-vit-base-patch32
# - ViT = Vision Transformer (image encoder)
# - Base = medium model size
# - Patch32 = splits images into 32x32 pixel patches
```

This model is a good balance of quality and speed. Larger models (ViT-Large) are more accurate but slower.

---

## Vector Databases and Similarity Search

### The Problem with Brute Force

With 15,000 images, each search would need to:
1. Compute cosine similarity with all 15,000 vectors
2. Sort to find top matches

That's 15,000 × 512 = 7.68 million floating-point operations per search. Doable, but doesn't scale.

### Cloudflare Vectorize

We use **Cloudflare Vectorize**, a vector database that uses approximate nearest neighbor (ANN) algorithms for fast search.

```typescript
// Query returns top matches in milliseconds
const results = await env.VECTORIZE.query(queryVector, {
  topK: 5,
  returnMetadata: "all"
});
```

**How ANN works** (simplified):
1. Vectors are organized into clusters during indexing
2. At query time, only nearby clusters are searched
3. Trade tiny accuracy loss for massive speed gain

### Indexing Our Images

```python
# pipelines/vectorize/ingest_clip.py

# 1. Load image from R2
image = Image.open(requests.get(image_url).content)

# 2. Generate CLIP embedding
inputs = processor(images=image, return_tensors="pt")
image_features = model.get_image_features(**inputs)
embedding = image_features / image_features.norm()  # Normalize!

# 3. Upsert to Vectorize
vectorize.upsert([{
    "id": "mtl_archives_metadata_123.json",
    "values": embedding.tolist(),
    "metadata": {"name": "...", "date": "..."}
}])
```

We ran this on a cloud GPU (Lambda Labs) because processing 15,000 images is compute-intensive.

---

## Dimensionality Reduction with UMAP

### Why Reduce Dimensions?

512 dimensions are great for search, but impossible to visualize. Humans can only perceive 2-3 dimensions. We need to project the embedding space down while preserving relationships.

### UMAP: Uniform Manifold Approximation and Projection

**UMAP** is a dimensionality reduction algorithm that preserves both local and global structure:

```python
import umap

reducer = umap.UMAP(
    n_components=2,      # Output dimensions
    n_neighbors=15,      # Local neighborhood size
    min_dist=0.1,        # How tightly to pack points
    metric="cosine",     # Match our similarity metric
    random_state=42,     # Reproducibility
)

embedding_2d = reducer.fit_transform(vectors_512d)
```

### What UMAP Preserves

- **Local structure**: Similar images stay close together
- **Clusters**: Groups of related images form visible clusters
- **Relative distances**: Further apart in 512D → further apart in 2D

### The Result

```
512D space:                      2D projection:
[0.12, -0.45, ..., 0.23] ──────► (0.32, 0.45)
[0.11, -0.44, ..., 0.24] ──────► (0.33, 0.44)  ← These stay close!
[0.89, 0.12, ..., -0.56] ──────► (0.87, 0.12)  ← This stays far
```

---

## The Complete Architecture

### Data Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA PIPELINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Source Images (R2)                                          │
│     └── 15,000 JPGs hosted on Cloudflare R2                     │
│                                                                 │
│  2. CLIP Embedding Generation (GPU)                             │
│     └── pipelines/vectorize/ingest_clip.py                      │
│     └── Runs on Lambda Labs cloud GPU                           │
│     └── Generates 512D vector per image                         │
│                                                                 │
│  3. Vector Storage (Vectorize)                                  │
│     └── mtl-archives-clip index                                 │
│     └── Enables fast similarity search                          │
│                                                                 │
│  4. UMAP Export (Local)                                         │
│     └── pipelines/vectorize/export_embeddings.py                │
│     └── Fetches vectors, runs UMAP, exports JSON                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Search Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        SEARCH FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User: "downtown buildings"                                     │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────┐                                        │
│  │ CLIP Text Encoder   │  (Transformers.js in browser)          │
│  │ Xenova/clip-vit-... │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                   │
│             ▼                                                   │
│      [512D query vector]                                        │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────────┐                                        │
│  │ Cosine Similarity   │  (vs all 14,715 image embeddings)      │
│  │ Computation         │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                   │
│             ▼                                                   │
│      Top 5 matches + highlighted points on map                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Visualization Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     VISUALIZATION                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Data Files:                                                    │
│  ├── embeddings_2d.json     (2D coords, metadata)               │
│  ├── embeddings_512d.bin    (28MB binary, full vectors)         │
│  └── embeddings_ids.json    (ID mapping)                        │
│                                                                 │
│  Libraries:                                                     │
│  ├── deck.gl                (2D WebGL scatter plot)             │
│  ├── Three.js               (3D point cloud)                    │
│  └── Transformers.js        (CLIP text encoding)                │
│                                                                 │
│  Features:                                                      │
│  ├── 2D/3D view toggle                                          │
│  ├── Semantic text search                                       │
│  ├── Top 5 results panel                                        │
│  ├── Click to zoom                                              │
│  ├── Hover tooltips with thumbnails                             │
│  └── Keyboard navigation                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Browser-Side Inference with Transformers.js

### The Challenge

Traditional ML inference requires a server with a GPU. But we wanted the visualization to work entirely in the browser—no backend needed for search.

### Transformers.js

[Transformers.js](https://huggingface.co/docs/transformers.js) by Hugging Face runs ML models directly in the browser using WebAssembly and WebGL.

```javascript
import { AutoTokenizer, CLIPTextModelWithProjection } from '@xenova/transformers';

// Load CLIP text encoder (downloads ~85MB model)
const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
const textModel = await CLIPTextModelWithProjection.from_pretrained(
  'Xenova/clip-vit-base-patch32',
  { quantized: true }  // Smaller model, ~22MB
);

// Encode text query
const inputs = tokenizer("downtown buildings", { padding: true, truncation: true });
const { text_embeds } = await textModel(inputs);

// text_embeds is now a 512D vector!
```

### Why This Matters

1. **Privacy**: User queries never leave their browser
2. **Speed**: No network latency for encoding
3. **Cost**: No server to run/pay for
4. **Offline**: Works without internet (after model loads)

### Quantization

We use a **quantized** model—weights are stored as 8-bit integers instead of 32-bit floats. This:
- Reduces model size by ~4x
- Speeds up inference
- Slightly reduces accuracy (usually imperceptible)

---

## Files and Scripts Reference

### Core Scripts

| File | Purpose |
|------|---------|
| `pipelines/vectorize/ingest_clip.py` | Generate CLIP embeddings for all images, upsert to Vectorize |
| `pipelines/vectorize/export_embeddings.py` | Fetch vectors from Vectorize, run UMAP, export for visualization |
| `pipelines/vectorize/test_visual_search.py` | CLI tool to test semantic search queries |
| `pipelines/vectorize/benchmark_visual_search.py` | Benchmark search quality across test queries |

### Data Files

| File | Size | Purpose |
|------|------|---------|
| `data/mtl_archives/vectors_cache.npz` | 62MB | Cached 512D vectors (NumPy format) |
| `data/mtl_archives/embeddings_2d.json` | 2MB | 2D UMAP coordinates + metadata |
| `data/mtl_archives/embeddings_512d.bin` | 29MB | Binary float32 array of all embeddings |
| `data/mtl_archives/embeddings_ids.json` | 500KB | Mapping of index → vector ID |

### Visualization

| File | Purpose |
|------|---------|
| `visualization/embedding_explorer.html` | Interactive 2D/3D embedding visualization with CLIP search |

### Running the Scripts

```bash
# Generate CLIP embeddings (requires GPU, or very patient)
CLOUDFLARE_AI_TOKEN="..." python pipelines/vectorize/ingest_clip.py

# Export for visualization (after embeddings exist in Vectorize)
python pipelines/vectorize/export_embeddings.py

# Test a search query
python pipelines/vectorize/test_visual_search.py "park with trees"

# Run benchmarks
python pipelines/vectorize/benchmark_visual_search.py

# Serve visualization locally
python -m http.server 8000
# Open: http://localhost:8000/visualization/embedding_explorer.html
```

---

## Key Concepts Summary

| Concept | What It Is | Why It Matters |
|---------|-----------|----------------|
| **Embedding** | Vector representation of data | Enables semantic comparison |
| **CLIP** | Vision-language model | Same space for images and text |
| **Cosine Similarity** | Angle between vectors | Measures semantic similarity |
| **Vectorize** | Vector database | Fast approximate nearest neighbor search |
| **UMAP** | Dimensionality reduction | Visualize high-dimensional data |
| **Transformers.js** | Browser ML inference | No server needed for search |
| **Quantization** | Model compression | Smaller, faster models |

---

## What We Built

Starting from 15,000 historical photos with poor metadata, we built:

1. **A semantic search system** that finds images by visual content
2. **An interactive visualization** showing the entire embedding space
3. **Browser-based search** that runs entirely client-side
4. **A results panel** showing top matches with thumbnails and scores

Users can now explore Montreal's visual history by simply describing what they're looking for—"church with steeple", "aerial view", "harbor with boats"—and instantly see relevant results, even when those terms don't appear in any metadata.

---

*Built with CLIP, Cloudflare Vectorize, UMAP, deck.gl, Three.js, and Transformers.js*
