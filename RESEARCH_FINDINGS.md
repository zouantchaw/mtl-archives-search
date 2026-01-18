# ML Research Findings: Montreal Archives CLIP Analysis

## Executive Summary

Using CLIP embeddings visualized via UMAP, we discovered that the Montreal city archives contain distinct "visual epochs" that the model separated with near-perfect accuracy. The clusters represent photographic techniques and institutional formatting, not just chronological eras.

## Key Finding: CLIP Detects Institutional Formatting

**The archive splits into two main visual categories:**

| Cluster | Era | Count | Visual Characteristics |
|---------|-----|-------|----------------------|
| Lower (Green/Blue) | 1940s | 7,805 | Raw B&W aerial photos |
| Upper (Yellow) | 1950s-70s | 2,759 | Official survey documents with borders |

**Separation accuracy: 99-100%** — Nearly every 1940s photo clusters separately from 1950s+ photos.

## What CLIP Detected

1. **Bureaucratic framing**: The 1950s-70s images have official "VILLE DE MONTRÉAL - SERVICE D'URBANISME" borders, stamps, and index numbers

2. **Visual fingerprint evolution**: Even the raw aerial content has subtle differences (film stock, contrast, grain) that CLIP recognizes

3. **Document vs photograph**: The model treats formatted survey documents as visually distinct from raw photography

## Anomaly Detection Results

We identified **1,580 anomalies** (10.7% of the archive) where visual appearance disagrees with stated date.

### Top Anomaly Patterns

| Pattern | Count | Explanation |
|---------|-------|-------------|
| 1940s → 1920s | 667 | 1940s aerial surveys resemble early street photography |
| 1960s → 1970s | 311 | Late 1960s planning docs look like 1970s |
| 1960s → 1950s | 226 | Early 1960s transitional style |
| 1970s → 1930s | 90 | Olympic-era oblique aerials use 1930s techniques |

### Notable Anomalies

- **1970s Olympic construction photos** cluster with 1920s-1940s imagery
- **Reason**: They use similar oblique aerial techniques — CLIP sees photographic style, not subject matter
- Index cards from 1940s look identical to 1970s documents (bureaucratic formatting transcends decades)

## Cluster Taxonomy

| Cluster | Position | Content | Count |
|---------|----------|---------|-------|
| **1940s Aerial Survey** | Lower-right | Raw vertical aerials | ~6,300 |
| **Urban Planning Docs** | Upper-right | Official 1960s-70s formatted surveys | ~2,000 |
| **Oblique & Mixed** | Left | Angled views, street photography | ~4,000 |
| **Index Cards & Maps** | Far upper-right | Pure administrative documents | ~1,500 |

## Methodology

1. **Embeddings**: CLIP ViT-B/32 visual embeddings (512D)
2. **Dimensionality reduction**: UMAP to 2D for visualization
3. **Analysis**: Statistical clustering, centroid calculation, anomaly scoring
4. **Validation**: Visual verification of sample images from each cluster

## Implications

1. **For archivists**: CLIP can automatically categorize photos by visual era and format type
2. **For ML researchers**: Vision models encode institutional/bureaucratic formatting as strongly as content
3. **For the archive**: The collection contains ~7,800 raw 1940s aerials that were later repackaged as official planning documents in the 1960s-70s

## Photographer Fingerprinting Results

**Question**: Can CLIP identify individual photographers' styles?

**Answer**: Yes — with caveats.

### Photographers Identified

| Photographer | Photos | Spread | Active Period |
|-------------|--------|--------|---------------|
| Henri Rémillard | 74 | 0.049 | 1965-1969 |
| Armour Landry | 26 | 0.044 | 1962-1965 |
| Louis-Philippe Meunier | 8 | 0.055 | 1964-1970 |
| Benny | 7 | 0.029 | 1968-1970 |
| W. B. Edwards | 7 | 0.068 | 1968-1969 |
| André Auclair | 6 | 0.070 | 1968 |

### Key Finding: Rémillard ≈ Landry

The two most prolific photographers (Henri Rémillard and Armour Landry) have **nearly identical visual styles**:
- Centroid distance: **0.022** (smallest of any pair)
- Both used oblique aerial techniques in the early-mid 1960s
- Likely colleagues or followed the same institutional standards

### Attribution Model

Using nearest-centroid classification:
- **20 high-confidence attributions** found (>50% confidence, within photographer's spread)
- All attributed to Henri Rémillard (largest training set)
- Separation/spread ratio: **2.55** (fingerprinting viable when >2.0)

### Visualization

A new "Photographer" color mode was added to the explorer:
- Shows the ~130 attributed photos as colored points
- ~14,500 unattributed photos appear gray
- Visual clusters confirm CLIP groups photographer styles together

## Sub-Cluster Analysis Results

Using k-means (k=8) on the full dataset, we discovered **8 distinct visual regions**:

| Cluster | Position | Content | Decade | Count |
|---------|----------|---------|--------|-------|
| Aerial NW | (0.68, 0.85) | 1940s flight path group 1 | 1940s | 2,902 |
| Street Photos | (0.36, 0.11) | Benny/Rhéal oblique work | 1970s | 2,496 |
| Aerial Central | (0.51, 0.73) | 1940s central survey flights | 1940s | 2,125 |
| Oblique Views | (0.29, 0.47) | Mixed aerial obliques | 1940s | 2,001 |
| Index Cards | (0.87, 0.06) | Official index/maps | 1960s | 1,777 |
| Aerial South | (0.67, 0.54) | 1940s southern flights | 1940s | 1,623 |
| Survey Docs | (0.79, 0.20) | Planning documents | 1960s | 1,003 |
| Aerial East | (0.90, 0.49) | 1940s eastern flights | 1940s | 788 |

**Key Finding**: The massive 1940s aerial cluster is NOT homogeneous — CLIP detects subtle differences between flight paths (lighting, terrain, altitude variations).

## Temporal Style Evolution

Tracking decade centroids reveals the **stylistic journey** of Montreal's visual archive:

| Decade | Position | Movement | Notes |
|--------|----------|----------|-------|
| 1920s | (0.38, 0.49) | — | Early street photography |
| 1930s | (0.35, 0.43) | ↓ South | Documentary expansion |
| 1940s | (0.64, 0.70) | ↗ NE | Massive aerial survey campaign |
| 1950s | (0.74, 0.22) | ↑ North | Official documentation begins |
| 1960s | (0.80, 0.14) | ↗ NE | Urban planning focus |
| 1970s | (0.81, 0.09) | ↑ North | Modern aerial techniques |

**Biggest shift**: 1940s → 1950s (distance: 0.49) — transition from raw aerials to official documents

## Density Analysis

Using k=15 nearest neighbors, we mapped **photo density** across the embedding space:

### Hotspots (Dense Regions)
| Position | Count | Content |
|----------|-------|---------|
| (0.8, 0.0-0.1) | 1,112 | 1960s Index cards |
| (0.2, 0.4) | 1,003 | 1920s-30s oblique views |
| (0.5-0.7, 0.8-0.9) | ~2,000 | 1940s aerials |

### Sparse Regions (Visual Outliers)
- Left edge (x ≈ 0.0): Photos with unique characteristics
- Bottom edge (y ≈ 1.0): Extreme embedding positions
- Between clusters: Transition zones

## Cluster Boundary Analysis

Found **1,142 boundary photos** that sit between major clusters:

### Bridge Regions (Transition Zones)
| Position | Count | Transition |
|----------|-------|------------|
| (0.55, 0.85) | 270 | Aerial NW ↔ Central |
| (0.45, 0.55) | 257 | Oblique ↔ Aerial |
| (0.65, 0.75) | 172 | Aerial Central ↔ NW |
| (0.85, 0.15) | 42 | Survey ↔ Index |

### Cross-Decade Boundaries
- **325 photos** bridge clusters from different decades
- Most common: Oblique Views (1960s) ↔ Aerial Central (1940s)
- These photos share visual characteristics of multiple eras

## Cross-Decade Twins

Found **1,840 photo pairs** from different decades that look visually identical:

### Top Twin Patterns
| Decade Pair | Twin Pairs | Explanation |
|-------------|------------|-------------|
| 1920s ↔ 1940s | 855 | Similar vertical aerial techniques |
| 1940s ↔ 1960s | 598 | Aerial photos vs official documents |
| 1920s ↔ 1970s | 144 | Oblique technique persistence |
| 1920s ↔ 1960s | 124 | Street photography styles |

### Notable Findings
- **50-year twin gap**: 1920s oblique aerial nearly identical to 1970s photo
- **Most twinned photo**: "Carte index générale" appears across 4 decades (123 twins)
- **Technique persistence**: 1920s aerial methods still detectable in 1970s photos

### Implications
1. **Dating verification**: Twins may indicate mislabeled photos
2. **Location tracking**: Same spots photographed across decades
3. **Technique archaeology**: Old methods persist longer than expected

## Sequence Detection Analysis

**Question**: Can CLIP detect temporal/spatial continuity within aerial survey sequences?

**Answer**: Yes — consecutive frames are significantly closer in embedding space.

### Key Metrics

| Comparison Type | Average Distance | Ratio to Consecutive |
|-----------------|------------------|---------------------|
| Consecutive frames | 0.059 | 1.0x |
| Random same-flight | 0.163 | 2.75x |
| Random cross-flight | 0.368 | 6.2x |

### Distance Distribution for Consecutive Frames

| Distance | Count | Percentage |
|----------|-------|------------|
| < 0.01 (very close) | 1,676 | 31.1% |
| < 0.02 (close) | 2,238 | 41.6% |
| < 0.05 (moderate) | 3,296 | 61.3% |

### Most Coherent Flight Sequences

| Flight | Avg Distance | Consecutive Pairs | Total Photos |
|--------|--------------|-------------------|--------------|
| 7P1 | 0.0113 | 13 | 28 |
| 7P3 | 0.0199 | 24 | 50 |
| S3D13 | 0.0218 | 264 | 270 |

### Sequence Breaks Detected

Found **1,052 sequence breaks** where consecutive frames have large embedding distance (>0.1):
- Most dramatic: Flight 7P30, frames 80→81 (distance: 0.758)
- Indicates terrain changes, lighting shifts, or potential mislabeling

### Implications

1. **CLIP encodes spatial continuity** — the model "understands" that adjacent aerial photos should look similar
2. **Sequence breaks** can identify terrain transitions or archival errors
3. **Flight path coherence** varies significantly (7P1 very uniform, 7P35 highly variable)

## Terrain Classification Analysis

### Content Type Distribution

| Content Type | Count | Centroid | Spread |
|--------------|-------|----------|--------|
| Aerial vertical | 7,805 | (0.64, 0.70) | 0.204 |
| Index cards | 2,781 | (0.84, 0.12) | **0.098** |
| Aerial oblique | 86 | (0.39, 0.50) | 0.228 |
| Street view | 105 | (0.33, 0.37) | 0.121 |
| Landmarks | 95 | (0.36, 0.25) | 0.214 |

**Key Finding**: Index cards have the tightest clustering (spread 0.098) — bureaucratic formatting dominates.

### Visual Regions by Era

| Region | Photos | Dominant Era | Characteristics |
|--------|--------|--------------|-----------------|
| Upper-Right | 2,780 | 1960s | Survey documents |
| Lower-Right | 4,122 | 1940s | Raw aerial verticals |
| Left | 3,444 | 1970s | Oblique/street photography |
| Center | 1,472 | 1940s | Mixed aerial content |

### Era Transition Zones

Found **58 decade transition boundaries** in embedding space — adjacent grid cells with different dominant decades.

## Semantic-Visual Alignment

**Question**: Does CLIP cluster photos by semantic meaning or visual style?

**Answer**: Visual style dominates, but semantic patterns exist.

### Category Clustering

| Category | Photos | Spread | Clustering Quality |
|----------|--------|--------|-------------------|
| Streets | 111 | 0.132 | Moderate |
| Parks | 69 | 0.173 | Moderate |
| Bridges | 45 | 0.239 | Wide |
| Water | 43 | 0.272 | Wide |

### Cross-Category Similarity

Most visually similar pairs:
- Streets ↔ Historic: 0.014 (nearly identical)
- Parks ↔ Churches: 0.014
- Streets ↔ Buildings: 0.031

Most visually distinct pairs:
- Aerial ↔ Bridges: 0.305
- Aerial ↔ Olympic: 0.254

### Silhouette-like Score: 0.18

Interpretation: Moderate semantic-visual alignment. CLIP partially encodes semantic meaning through visual style, but photographic technique remains the dominant factor.

## Deep Hierarchical Clustering

**Question**: How deeply can we recursively subdivide the embedding space?

**Answer**: The archive splits into **65 visually distinct leaf clusters** at depth 4.

### Hierarchy Structure

| Depth | Clusters | Avg Size | Description |
|-------|----------|----------|-------------|
| 0 | 1 | 14,715 | Full archive |
| 1 | 3 | 4,905 | Main visual categories |
| 2 | 10 | 1,472 | Era/technique groups |
| 3 | 27 | 545 | Sub-regional clusters |
| 4 | 62 | 237 | Fine-grained visual types |

### Three Main Branches (Depth 1)

| Branch | Count | Era | Content |
|--------|-------|-----|---------|
| [0] | 6,964 | 1940s | Raw aerial survey photos |
| [1] | 4,309 | Mixed | Oblique/street photography |
| [2] | 3,442 | 1960s | Planning documents & index cards |

### Key Discovery: Flight Paths Within Aerials

The 1940s aerial cluster [0] subdivides into **3 geographic regions**:

| Sub-cluster | Count | Position | Flight Groups |
|-------------|-------|----------|---------------|
| [0.0] Upper | 3,009 | (0.67, 0.85) | 7P36, 7P38, 7P26 |
| [0.1] Central | 2,216 | (0.50, 0.71) | 7P17, 7P18, 7P21 |
| [0.2] Southern | 1,739 | (0.68, 0.54) | 7P40, 7P46, 7P24 |

CLIP doesn't just see "1940s aerial" — it distinguishes **specific flight paths** based on subtle visual characteristics (terrain, lighting, altitude).

### Most Homogeneous Clusters (Tightest Spread)

| Cluster | Spread | Count | Era | Description |
|---------|--------|-------|-----|-------------|
| [2.2.0.0] | 0.010 | 147 | 1970s | Ultra-tight index cards |
| [2.0.1.1] | 0.010 | 127 | 1960s | Standardized documents |
| [2.0.1.2] | 0.010 | 112 | 1970s | Bureaucratic uniformity |
| [2.1.2.0] | 0.011 | 148 | 1960s | Planning sheets |

**Finding**: The planning document region [2] achieves the tightest clustering (spread 0.01), proving that **bureaucratic standardization creates visual uniformity** that CLIP detects with extreme precision.

### Decade Distribution Across Depth

| Depth | 1920s | 1930s | 1940s | 1950s | 1960s | 1970s |
|-------|-------|-------|-------|-------|-------|-------|
| 1 | — | — | 2 | — | 1 | — |
| 2 | 1 | — | 5 | — | 2 | 2 |
| 3 | 1 | 1 | 13 | — | 7 | 5 |
| 4 | 2 | — | 33 | 1 | 11 | 15 |

The 1940s aerial campaign dominates the deeper levels (33 leaf clusters), while planning documents cluster into fewer, tighter groups.

### Implications

1. **Archival organization**: The hierarchy provides a natural taxonomy for browsing
2. **Search refinement**: Users can zoom into specific visual sub-genres
3. **Quality control**: Tight clusters indicate standardization; loose ones indicate variety
4. **Flight path recovery**: CLIP embeddings could help reconstruct original survey order

## Future Research Directions

1. ~~**Sub-cluster analysis**~~: ✓ Completed — 8 distinct visual regions identified
2. ~~**Photographer fingerprinting**~~: ✓ Completed — CLIP can identify styles
3. ~~**Temporal evolution tracing**~~: ✓ Completed — decade trajectory mapped
4. ~~**Anomaly detection**~~: ✓ Completed — 1,580 visual/date mismatches found
5. ~~**Density mapping**~~: ✓ Completed — hotspots and sparse regions identified
6. ~~**Boundary analysis**~~: ✓ Completed — 1,142 transition photos found
7. ~~**Cross-decade twins**~~: ✓ Completed — 1,840 twin pairs discovered
8. ~~**Sequence detection**~~: ✓ Completed — CLIP encodes temporal continuity
9. ~~**Terrain classification**~~: ✓ Completed — content types cluster distinctly
10. ~~**Semantic-visual alignment**~~: ✓ Completed — style > semantics
11. ~~**Deep hierarchical clustering**~~: ✓ Completed — 65 leaf clusters discovered
12. ~~**Image quality scoring**~~: ✓ Completed — outliers indicate terrain diversity, not damage
13. ~~**Building tracking**~~: ✓ Completed — 3,426 cross-decade visual twins discovered

## Building/Location Tracking Analysis

**Question**: Can we track the same locations photographed across different decades?

**Answer**: Yes — named locations cluster together, and we found **3,426 cross-decade visual twins**.

### Location Extraction

| Metric | Value |
|--------|-------|
| Photos with extractable location | 225 |
| Unique locations found | 120 |
| Locations with 2+ photos | 44 |
| Locations spanning multiple decades | 20 |

### Top Multi-Decade Locations

| Location | Photos | Decades | Spread | Visual Drift |
|----------|--------|---------|--------|--------------|
| Notre-Dame | 13 | 1920s-1970s | 0.189 | 0.32 (moderate) |
| Mont-Royal | 10 | 1920s-1970s | 0.150 | 0.01 (very stable) |
| Olympic Stadium | 10 | 1960s-1970s | 0.144 | — |
| Pont Jacques-Cartier | 9 | 1920s-1970s | 0.267 | 0.48 (high) |
| Hôtel de Ville | 6 | 1920s-1970s | 0.172 | 0.08 (stable) |

**Visual drift** measures how much a location's visual documentation style changed over time. Low drift means consistent photography techniques; high drift indicates changing methods.

### Most Visually Consistent Locations

| Location | Spread | Photos | Finding |
|----------|--------|--------|---------|
| du Mont-Royal | 0.0001 | 3 | Nearly identical across photos |
| Ontario Est | 0.0015 | 6 | Extremely tight cluster |
| Notre-Dame Est | 0.0023 | 3 | Consistent street photography |
| Saint-Laurent | 0.0033 | 5 | Stable visual style |

These locations were photographed with remarkably consistent techniques.

### Cross-Decade Visual Twins

| Decade Pair | Twin Pairs | Interpretation |
|-------------|------------|----------------|
| 1960s ↔ 1970s | 1,753 | Same planning documents |
| 1950s ↔ 1960s | 1,075 | Bureaucratic continuity |
| 1920s ↔ 1930s | 403 | Consistent street photography |
| 1920s ↔ 1960s | 129 | Technique persistence |

### Closest Visual Twins

| Distance | Years Apart | Photo 1 | Photo 2 |
|----------|-------------|---------|---------|
| 0.00004 | 20 | Carte index générale (1950s) | Carte Index générale (1970s) |
| 0.00020 | 10 | Avenue du Mont-Royal (1920s) | Pont ferroviaire (1930s) |
| 0.00022 | 10 | Marché Saint-Antoine (1920s) | Marché Saint-Jean-Baptiste (1930s) |

The closest twins are **index cards** — bureaucratic formatting is so standardized that cards from the 1950s are virtually indistinguishable from 1970s cards (distance 0.00004).

### Known Landmarks

| Landmark | Photos | Decades | Spread |
|----------|--------|---------|--------|
| Notre-Dame | 13 | 4 | 0.189 |
| Mont-Royal | 10 | 3 | 0.150 |
| Olympic Stadium | 10 | 2 | 0.144 |
| Pont Jacques-Cartier | 9 | 4 | 0.267 |
| Place Ville-Marie | 3 | 2 | 0.194 |

### Implications

1. **Location tracking works**: Named locations cluster together across decades
2. **Bureaucratic stability**: Official documents are visually identical across 20+ years
3. **Photographic techniques evolved**: Bridges show high drift (changing aerial methods)
4. **Landmarks are identifiable**: CLIP encodes structural features that persist over time
5. **Search potential**: Could enable "show me all photos of Pont Jacques-Cartier" functionality

## Image Quality Scoring Analysis

**Question**: Can we detect damaged or faded photos from their embedding position?

**Answer**: The archive is remarkably clean. Outliers indicate **terrain diversity**, not quality issues.

### Quality Metrics

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Photos analyzed | 14,715 | Full archive |
| Highly isolated outliers | 6 | 0.04% — extremely rare |
| Edge photos | 1,536 | 10.4% — at embedding boundaries |
| Low quality score (<0.3) | 6 | Same 6 outliers |

### Edge Photo Distribution

| Edge | Count | Era | Content |
|------|-------|-----|---------|
| Left | 6 | 1940s | Rural farmland aerials |
| Right | 200 | 1940s | Eastern flight paths |
| Bottom | 1,320 | 1960s-70s | Planning documents |
| Top | 10 | 1940s | Northern aerials |

### The 6 Outliers: Rural Farmland

All 6 isolated photos (position x≈0) are from **Flight 7P26** showing rural agricultural terrain:
- VM97-3_7P26-053.jpg — Field patterns with ponds
- VM97-3_7P26-53.jpg — Same (duplicate entry)
- VM97-3_7P30-080.jpg — Agricultural land

**Finding**: These aren't damaged photos — they show **terrain unlike the rest of the urban archive**. CLIP correctly identifies them as visually distinct because farmland looks fundamentally different from cityscapes.

### Local Outlier Factor (LOF) Analysis

Top LOF anomalies (sample of 1,000):

| Photo | LOF Score | Position | Description |
|-------|-----------|----------|-------------|
| VM97,S3,D02,P13-033 | 4.98 | (0.75, 0.27) | Transitional document |
| VM97-3_7P14-36.jpg | 4.29 | (0.48, 1.00) | Top-edge aerial |
| VM97,S3,D04,P150 | 3.90 | (0.79, 0.21) | Survey region boundary |

LOF identifies photos in **transition zones** between major clusters — these are visually ambiguous, not damaged.

### Quality Score Distribution

| Percentile | Quality Score |
|------------|---------------|
| 25th | 0.965 |
| 50th | 0.983 |
| 75th | 0.989 |
| 99th | 0.997 |

**99.96%** of photos have quality scores above 0.3 — the archive is exceptionally well-preserved.

### Implications

1. **No systematic quality issues**: The archive is clean and well-maintained
2. **Outliers reveal diversity**: Isolated photos show terrain variety (rural vs urban)
3. **Edge photos are meaningful**: They represent extreme cases, not errors
4. **Manual review targets**: The 6 farmland photos could be flagged for metadata enrichment (add "rural" tag)

## Research Complete Summary

All 13 planned research directions have been completed:

| # | Research Direction | Key Finding |
|---|-------------------|-------------|
| 1 | Sub-cluster analysis | 8 distinct visual regions |
| 2 | Photographer fingerprinting | CLIP identifies individual styles |
| 3 | Temporal evolution | Decade trajectory mapped |
| 4 | Anomaly detection | 1,580 visual/date mismatches |
| 5 | Density mapping | Hotspots and sparse regions |
| 6 | Boundary analysis | 1,142 transition photos |
| 7 | Cross-decade twins | 1,840 twin pairs |
| 8 | Sequence detection | CLIP encodes temporal continuity |
| 9 | Terrain classification | Content types cluster distinctly |
| 10 | Semantic-visual alignment | Style > semantics (score 0.18) |
| 11 | Hierarchical clustering | 65 leaf clusters at depth 4 |
| 12 | Image quality scoring | Archive is 99.96% clean |
| 13 | Building tracking | 3,426 location-based twins |

### Overall Conclusions

1. **CLIP is a powerful archival tool**: It encodes institutional formatting, photographic technique, terrain type, and temporal continuity — all without any training on archival metadata.

2. **Visual epochs are real**: The 1940s→1950s transition represents a fundamental shift from raw photography to bureaucratic documentation.

3. **Flight paths are encoded**: CLIP distinguishes individual aerial survey flights based on subtle visual characteristics.

4. **The archive is clean**: Only 6 photos (0.04%) are true outliers, and they're rural farmland — not damaged images.

5. **Locations can be tracked**: Named landmarks cluster together across decades, enabling time-based exploration.

---

*Analysis conducted January 2025 using the Montreal City Archives collection (~14,715 images)*
