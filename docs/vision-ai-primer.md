# Vision AI Primer for MTL Archives

Understanding what we built, what it enables, and where we could go next.

---

## Part 1: What Are Embeddings?

### The Core Idea

An embedding is a way to represent something (text, image, audio) as a list of numbers — a **vector**.

```
"church" → [0.12, -0.45, 0.78, 0.33, ..., 0.21]  # 512 numbers
```

Why? Because computers can't understand "church" directly, but they CAN compare lists of numbers. If two vectors are similar (point in the same direction), the things they represent are similar.

```
"church"     → [0.12, -0.45, 0.78, ...]
"cathedral"  → [0.14, -0.42, 0.81, ...]  ← very similar vector
"bicycle"    → [0.89, 0.23, -0.15, ...]  ← very different vector
```

### How Similarity Works

We measure similarity using **cosine similarity** — essentially checking if two vectors point in the same direction:

- `1.0` = identical direction (perfect match)
- `0.0` = perpendicular (unrelated)
- `-1.0` = opposite direction

```javascript
// Simplified cosine similarity
function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot / (magnitude(a) * magnitude(b));
}
```

---

## Part 2: What is CLIP?

### The Breakthrough

**CLIP** (Contrastive Language-Image Pretraining) is a model from OpenAI that learned to understand images and text **in the same vector space**.

This is the key insight: CLIP can embed both images AND text into the same 512-dimensional space.

```
[Image of a church]  → [0.12, -0.45, 0.78, ...]
"a photograph of a church" → [0.14, -0.43, 0.76, ...]  ← similar!
```

### How CLIP Was Trained

OpenAI trained CLIP on 400 million image-text pairs from the internet. For each pair:

1. Embed the image → vector A
2. Embed the text caption → vector B
3. Train the model so A and B are similar

After training, CLIP understands that images of churches and the text "church" should produce similar vectors — even though one is pixels and one is words.

---

## Part 3: What Your App Does

### The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OFFLINE (one-time)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   15,000 photos ──→ CLIP image encoder ──→ 15,000 vectors   │
│                                                              │
│   Each photo becomes a 512-dimensional vector                │
│   Stored in: embeddings_512d.bin (~30MB)                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     RUNTIME (in browser)                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   1. App loads → downloads all 15k vectors into memory      │
│                                                              │
│   2. User types "church"                                    │
│            ↓                                                │
│      Xenova CLIP (runs in browser via WebAssembly)          │
│            ↓                                                │
│      "church" → [0.12, -0.45, 0.78, ...]                   │
│                                                              │
│   3. Compare against all 15k image vectors                  │
│            ↓                                                │
│      for each photo:                                        │
│        score = cosineSimilarity(queryVector, photoVector)   │
│            ↓                                                │
│      Sort by score, return top matches                      │
│                                                              │
│   4. Highlight matches in 3D point cloud                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### What This Enables

1. **Text-to-image search without metadata**
   - Type "horse" and find horse photos, even if no one tagged them as "horse"
   - The visual content itself is searchable

2. **Instant search (no server round-trip)**
   - All embeddings are in browser memory
   - Search is pure math — runs in milliseconds

3. **Visual similarity**
   - Could extend to: click a photo, find visually similar ones
   - Same principle — compare that photo's vector to all others

4. **The 3D point cloud**
   - Each photo's 512D vector is reduced to 2D/3D for visualization
   - Similar photos cluster together naturally

---

## Part 4: What Are VLMs?

### Beyond Embeddings

**VLM** (Vision Language Model) is a different beast. Instead of producing a vector, it produces **language**.

```
CLIP:
  [Image of church] → [0.12, -0.45, ...]  (vector)

VLM:
  [Image of church] + "What is this?" → "This is a Gothic church
  with stone architecture, likely from the early 1900s. There are
  people standing on the steps..."
```

VLMs are like ChatGPT but they can see images. Examples:
- GPT-4V (OpenAI)
- Claude with vision (Anthropic)
- Llama 3.2 Vision (Meta, available on Cloudflare)
- Qwen-VL (Alibaba, used by Tinker)

### What VLMs Can Do

| Task | Input | Output |
|------|-------|--------|
| **Captioning** | Image | "A black and white photo of a church on a snowy day" |
| **Classification** | Image + categories | "church" (from list of options) |
| **Q&A** | Image + question | Answer about the image |
| **Description** | Image | Detailed analysis |

---

## Part 5: Classification vs Embeddings

### Two Different Tools

| | CLIP Embeddings | VLM Classification |
|---|---|---|
| **Output** | Vector (numbers) | Category (text) |
| **Good for** | Similarity search, clustering | Labeling, tagging |
| **Speed** | Very fast | Slower (LLM inference) |
| **Cost** | One-time compute | Per-image API cost |

### When to Use Which

**Use CLIP embeddings when:**
- "Find photos similar to X"
- "Search by visual concept"
- Need real-time search
- Want to cluster/visualize

**Use VLM classification when:**
- "Tag every photo with a category"
- "Generate descriptions for photos with bad metadata"
- "Detect what decade this photo is from"
- Need structured labels for filtering

### They Complement Each Other

```
Current (CLIP only):
  User searches "church" → finds church-like images

  Problem: Can't filter by "show only churches" because
  photos aren't labeled

With VLM classification added:
  Offline: VLM tags each photo → {category: "church", era: "1920s", ...}
  Stored in D1 database

  Now user can:
  - Filter: "Show only churches"
  - Combine: "Churches from the 1920s"
  - Search within category: "church" + text search
```

---

## Part 6: Zero-Shot vs Fine-Tuning

### Zero-Shot Classification

Use the model as-is. Just ask it.

```python
prompt = """
Look at this image. Classify it into ONE of these categories:
- church
- street_scene
- portrait
- aerial_view
- building
- landscape

Reply with just the category name.
"""

response = vlm.analyze(image, prompt)
# Returns: "church"
```

**Pros:** No training, works immediately
**Cons:** May not understand your specific nuances

### Fine-Tuning (what Tinker does)

Train the model on YOUR labeled examples.

```
Training data:
  photo_001.jpg → "church"
  photo_002.jpg → "street_scene"
  photo_003.jpg → "church"
  ... (500+ examples)

After training:
  Model learns what YOUR archives' churches look like
  (Montreal churches from 1900s, specific photographic style, etc.)
```

**Pros:** Better accuracy for your specific domain
**Cons:** Need labeled data, GPU compute, time

---

## Part 7: Options for MTL Archives

### What You Have Now

```
✓ CLIP embeddings for all 15k photos
✓ Visual search in browser
✓ 3D point cloud visualization
✓ BGE embeddings for text/metadata search
```

### What You Could Add

#### Option A: Cloudflare Workers AI (Zero-Shot)

```
You already have: env.AI binding

Model: @cf/meta/llama-3.2-11b-vision-instruct

Pipeline:
  1. For each photo in R2
  2. Call Workers AI with image + classification prompt
  3. Store result in D1: {photo_id, category, confidence}
  4. Add category filters to your UI
```

**Effort:** Days
**Cost:** Workers AI free tier, then usage-based

#### Option B: Tinker + Qwen (Fine-Tuned)

```
Framework: tinker-cookbook/vlm_classifier

Pipeline:
  1. Label 500-1000 photos manually
  2. Create custom dataset class
  3. Fine-tune Qwen-VL on GPU cluster
  4. Run inference on all 15k photos
  5. Store results in D1
```

**Effort:** Weeks
**Cost:** GPU compute ($$), labeling time

#### Option C: Hybrid

```
1. Start with zero-shot (Option A)
2. Review results, correct mistakes
3. Use corrections as training data
4. Fine-tune if accuracy isn't good enough
```

---

## Summary

| Concept | What it does | Your app uses it for |
|---------|--------------|---------------------|
| **Embeddings** | Convert things to vectors | Similarity search |
| **CLIP** | Same vector space for images & text | Visual search without metadata |
| **VLM** | Image → language | (potential) Auto-tagging |
| **Zero-shot** | Use model directly, no training | Quick classification |
| **Fine-tuning** | Train on your data | Better accuracy |

Your current CLIP-based search is powerful for **finding similar things**. VLM classification would add the ability to **label and filter things** — they're complementary tools.
