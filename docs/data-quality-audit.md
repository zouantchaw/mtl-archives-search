# Data Quality Audit: MTL Archives

## Executive Summary

**97% of photos have no meaningful text description.** The current "descriptions" are auto-generated placeholders that provide zero semantic value for search.

| Metric | Value |
|--------|-------|
| Total records | 14,822 |
| Real descriptions | 154 (1%) |
| Synthetic (useless) | 14,471 (97.6%) |
| Partially synthetic | 188 (1.3%) |

---

## Current Pipeline

```
manifest_enriched.jsonl
        ↓
clean-metadata.ts (normalize, expand abbreviations, generate synthetic)
        ↓
manifest_clean.jsonl
        ↓
ingest-text.ts (BGE embeddings) → Vectorize
```

### What clean-metadata.ts Does

1. **Text normalization**: Unicode NFC, curly quotes → straight quotes
2. **Abbreviation expansion**: "S/O", "n/a" → empty string
3. **Series parsing**: Extracts specific location from "Le reportage photographique..." patterns
4. **Synthetic generation**: If no description, creates one from name + date + cote

### The Problem

When description is missing (97% of cases), `buildSyntheticDescription()` creates:

```json
{
  "name": "VM97,S3,D08,P298",
  "description": "VM97,S3,D08,P298. Capturée ou datée de 1966. Détails supplémentaires non disponibles; description générée automatiquement."
}
```

**This is what gets embedded for semantic search.** When a user searches "church" or "street scene", these records will never match.

---

## Data Quality Issues

### Issue 1: Names are Often Useless

Many records have names that are just:
- Cote codes: `"VM97,S3,D08,P298"`
- Filenames: `"VM97-3_7P14-30.jpg"`
- Generic: `"Photographie"`

**Impact**: Synthetic descriptions built from these names are meaningless.

### Issue 2: Missing Descriptions

Source breakdown:
```
original:                    154  (1.0%)  ← Real descriptions
synthetic:                14,471 (97.6%)  ← Generated garbage
original+synthetic:          131  (0.9%)  ← Short real + padding
original+series-parsed:        9  (0.1%)  ← Extracted from series
original+series-parsed+syn:   57  (0.4%)  ← Extracted + padding
```

### Issue 3: Semantic Mismatch

The embedding text has no connection to what's IN the image:

| What's Embedded | What User Searches |
|-----------------|-------------------|
| "VM97,S3,D08,P298. Capturée 1966." | "church", "park", "street scene" |
| "Photographie d'archive." | "people walking", "old car" |
| Cote code + date | Visual content |

---

## Solutions

### Solution A: VLM Captioning (Recommended)

Use a Vision Language Model to generate descriptions from the actual images.

```
For each image without description:
  1. Fetch image from R2
  2. Send to VLM: "Describe this historical photo in 2-3 sentences"
  3. Store result as vlm_description
  4. Re-embed with real description
```

**Before:**
```json
{
  "name": "VM97,S3,D08,P298",
  "description": "VM97,S3,D08,P298. Capturée ou datée de 1966."
}
```

**After:**
```json
{
  "name": "VM97,S3,D08,P298",
  "description": "VM97,S3,D08,P298. Capturée ou datée de 1966.",
  "vlm_description": "A black and white photograph of a Gothic church with tall spires. Several people are walking on the sidewalk in front of the building. Vintage cars are parked along the street."
}
```

**Options:**
| Provider | Model | Cost | Notes |
|----------|-------|------|-------|
| Cloudflare Workers AI | llama-3.2-11b-vision | Free tier | Already in your stack |
| Anthropic | Claude Sonnet | ~$0.01/image | Highest quality |
| Replicate | Various | ~$0.001/image | Cheapest |

**Estimated time for 14k images:**
- Cloudflare (2 req/sec): ~2 hours
- Anthropic (50 req/min): ~5 hours

### Solution B: VLM Classification + Captioning

Add structured tags in addition to descriptions:

```json
{
  "vlm_description": "A Gothic church with people walking...",
  "vlm_tags": {
    "category": "religious_building",
    "subjects": ["church", "pedestrians", "street"],
    "era_guess": "1920s",
    "setting": "urban"
  }
}
```

**Benefits:**
- Enables faceted search (filter by category)
- Tags can supplement embeddings
- Structured data for future features

### Solution C: Improved Synthetic Generation (Partial Fix)

If VLM is not feasible, improve the synthetic logic:

1. **Parse cote codes** to extract meaningful info:
   ```
   VM94,SY,SS1,SSS17,D180 → "Archives series VM94, subseries SSS17"
   ```

2. **Use aerial_matches** if available (some records have location matches)

3. **Extract date ranges** more meaningfully:
   ```
   "Décennie 1930" → "1930s photograph"
   ```

**Impact**: Marginal improvement. Still no visual content.

---

## Recommended Approach

### Phase 1: Quick Win with Cloudflare Workers AI

1. Create a batch script that:
   - Reads manifest_clean.jsonl
   - For each record with `description_source: "synthetic"`
   - Fetches image from R2
   - Calls Workers AI llama-3.2-vision for caption
   - Writes to manifest_vlm.jsonl

2. Update ingest-text.ts to use vlm_description when available

3. Re-run BGE embedding pipeline

### Phase 2: Evaluate Quality

- Sample 100 VLM descriptions manually
- Check for hallucinations, errors
- Decide if fine-tuning (Tinker) is needed

### Phase 3: Iterate

If quality is good:
- Deploy to production
- Consider adding classification tags

If quality is poor:
- Try different models (Claude, GPT-4V)
- Consider Tinker fine-tuning with manual corrections

---

## Implementation Sketch

```typescript
// packages/scripts/src/vlm/caption-images.ts

const BATCH_SIZE = 10;
const VLM_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

async function captionImage(imageUrl: string): Promise<string> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${VLM_MODEL}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_TOKEN}` },
      body: JSON.stringify({
        image: [imageUrl],
        prompt: "Describe this historical photograph from Montreal's archives in 2-3 sentences. Focus on what you see: buildings, people, vehicles, street scenes, landmarks.",
        max_tokens: 150
      })
    }
  );
  const json = await response.json();
  return json.result?.response || '';
}

async function main() {
  // Read manifest, filter synthetic-only records
  // For each, fetch image URL, call captionImage
  // Write enriched manifest
}
```

---

## Metrics to Track

After VLM enrichment, measure:

1. **Description length**: Average chars should increase significantly
2. **Search recall**: Does "church" now find church images?
3. **Embedding diversity**: Are vectors more spread out in space?

---

## Current vs Target State

```
CURRENT:
  User searches "church"
    → BGE embeds "church"
    → Vectorize returns top matches
    → Results: random photos (embeddings don't match)

TARGET:
  User searches "church"
    → BGE embeds "church"
    → Vectorize returns records where vlm_description mentions church
    → Results: actual church photos
```

---

## Next Steps

1. [ ] Review this audit with team
2. [ ] Choose VLM provider (recommend: start with Cloudflare Workers AI)
3. [ ] Create caption-images.ts script
4. [ ] Run on sample (100 images) to validate quality
5. [ ] Run on full dataset (14k images)
6. [ ] Update embedding pipeline to use VLM descriptions
7. [ ] Re-index Vectorize
8. [ ] Test search quality
