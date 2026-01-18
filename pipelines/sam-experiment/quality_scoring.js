#!/usr/bin/env node
/**
 * Image Quality Scoring Analysis
 *
 * Hypothesis: Damaged, faded, or unusual photos may cluster in
 * specific regions of the embedding space or be outliers.
 *
 * We'll look for:
 * 1. Extreme outliers (far from any cluster)
 * 2. Photos with unusual embedding patterns
 * 3. Low-density regions that might indicate quality issues
 */

const https = require('https');

const DATA_URL = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings/embeddings_2d.json';

function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    });
  });
}

function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function centroid(points) {
  const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x: avgX, y: avgY };
}

// Calculate Local Outlier Factor (simplified)
function calculateLOF(points, k = 15) {
  const n = points.length;

  // For each point, find k nearest neighbors
  const kDistances = points.map((p, i) => {
    const distances = points
      .map((q, j) => ({ idx: j, dist: distance(p, q) }))
      .filter(d => d.idx !== i)
      .sort((a, b) => a.dist - b.dist);

    const kNeighbors = distances.slice(0, k);
    const kDist = kNeighbors[k - 1]?.dist || 0;

    return {
      idx: i,
      kNeighbors: kNeighbors.map(n => n.idx),
      kDist,
      reachabilityDistances: []
    };
  });

  // Calculate reachability distances
  kDistances.forEach(p => {
    p.reachabilityDistances = p.kNeighbors.map(neighborIdx => {
      const neighbor = kDistances[neighborIdx];
      const actualDist = distance(points[p.idx], points[neighborIdx]);
      return Math.max(neighbor.kDist, actualDist);
    });
  });

  // Calculate Local Reachability Density
  const lrds = kDistances.map(p => {
    const avgReach = p.reachabilityDistances.reduce((s, d) => s + d, 0) / k;
    return avgReach > 0 ? 1 / avgReach : 1000; // High density if avgReach is 0
  });

  // Calculate LOF
  return kDistances.map((p, i) => {
    const neighborLRDs = p.kNeighbors.map(idx => lrds[idx]);
    const avgNeighborLRD = neighborLRDs.reduce((s, d) => s + d, 0) / k;
    return avgNeighborLRD / lrds[i];
  });
}

// Calculate isolation score (average distance to k nearest neighbors)
function isolationScore(point, allPoints, k = 10) {
  const distances = allPoints
    .map(p => distance(point, p))
    .filter(d => d > 0)
    .sort((a, b) => a - b);

  return distances.slice(0, k).reduce((s, d) => s + d, 0) / k;
}

// Calculate edge proximity (distance to embedding space boundaries)
function edgeProximity(point) {
  const margins = [
    point.x,           // distance to left edge
    1 - point.x,       // distance to right edge
    point.y,           // distance to bottom edge
    1 - point.y        // distance to top edge
  ];
  return Math.min(...margins);
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              IMAGE QUALITY SCORING ANALYSIS                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Calculate isolation scores for all photos
  console.log('Calculating isolation scores (average distance to 10 nearest neighbors)...\n');

  const scored = data.map(p => ({
    ...p,
    isolation: isolationScore(p, data, 10),
    edgeProximity: edgeProximity(p)
  }));

  // Sort by isolation
  scored.sort((a, b) => b.isolation - a.isolation);

  console.log('=== MOST ISOLATED PHOTOS (Potential Outliers) ===\n');
  console.log('Isolation scores (higher = more isolated from neighbors):\n');

  scored.slice(0, 30).forEach((p, i) => {
    const shortName = (p.name || p.id).substring(0, 50);
    const date = p.date || 'Unknown';
    console.log(`${(i + 1).toString().padStart(2)}. ${p.isolation.toFixed(4)} | (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) | ${date}`);
    console.log(`    ${shortName}`);
  });

  // Analyze edge photos (near embedding space boundaries)
  console.log('\n=== EDGE PHOTOS (Near Embedding Space Boundaries) ===\n');

  const edgePhotos = scored.filter(p => p.edgeProximity < 0.05);
  console.log(`Photos within 0.05 of edge: ${edgePhotos.length}\n`);

  // Group by edge
  const byEdge = {
    left: edgePhotos.filter(p => p.x < 0.05),
    right: edgePhotos.filter(p => p.x > 0.95),
    bottom: edgePhotos.filter(p => p.y < 0.05),
    top: edgePhotos.filter(p => p.y > 0.95)
  };

  Object.entries(byEdge).forEach(([edge, photos]) => {
    if (photos.length === 0) return;

    console.log(`📍 ${edge.toUpperCase()} EDGE: ${photos.length} photos`);

    // Decade distribution
    const decades = {};
    photos.forEach(p => {
      const year = p.date?.match(/(19\d{2})/)?.[1];
      if (year) {
        const decade = Math.floor(parseInt(year) / 10) * 10;
        decades[decade] = (decades[decade] || 0) + 1;
      }
    });
    const decadeStr = Object.entries(decades)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, c]) => `${d}s: ${c}`)
      .join(', ');

    console.log(`   Decades: ${decadeStr || 'Unknown'}`);

    // Common terms
    const terms = {};
    photos.forEach(p => {
      if (!p.name) return;
      const words = p.name.toLowerCase().split(/[\s\-\/\.,]+/).filter(w => w.length > 3);
      words.forEach(w => terms[w] = (terms[w] || 0) + 1);
    });
    const topTerms = Object.entries(terms)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => term);

    console.log(`   Terms: ${topTerms.join(', ') || 'N/A'}`);

    // Sample photos
    photos.slice(0, 3).forEach(p => {
      console.log(`   • ${(p.name || p.id).substring(0, 50)}`);
    });
    console.log('');
  });

  // Look for potential quality issues based on patterns
  console.log('=== POTENTIAL QUALITY ANOMALIES ===\n');

  // Photos in extremely sparse regions
  const sparseThreshold = 0.08;
  const sparsePhotos = scored.filter(p => p.isolation > sparseThreshold);
  console.log(`Photos in sparse regions (isolation > ${sparseThreshold}): ${sparsePhotos.length}\n`);

  // Analyze characteristics of sparse photos
  const sparseDecades = {};
  sparsePhotos.forEach(p => {
    const year = p.date?.match(/(19\d{2})/)?.[1];
    if (year) {
      const decade = Math.floor(parseInt(year) / 10) * 10;
      sparseDecades[decade] = (sparseDecades[decade] || 0) + 1;
    }
  });

  console.log('Sparse photos by decade:');
  Object.entries(sparseDecades)
    .sort((a, b) => b[1] - a[1])
    .forEach(([decade, count]) => {
      const pct = (count / sparsePhotos.length * 100).toFixed(1);
      console.log(`  ${decade}s: ${count} (${pct}%)`);
    });

  // Find cluster of similar outliers (might indicate systematic quality issue)
  console.log('\n=== OUTLIER CLUSTERING ===\n');
  console.log('Checking if outliers cluster together (systematic issue)...\n');

  if (sparsePhotos.length > 10) {
    const outlierCentroid = centroid(sparsePhotos);
    const outlierSpread = Math.sqrt(
      sparsePhotos.reduce((s, p) =>
        s + Math.pow(p.x - outlierCentroid.x, 2) + Math.pow(p.y - outlierCentroid.y, 2), 0
      ) / sparsePhotos.length
    );

    console.log(`Outlier centroid: (${outlierCentroid.x.toFixed(3)}, ${outlierCentroid.y.toFixed(3)})`);
    console.log(`Outlier spread: ${outlierSpread.toFixed(4)}`);

    if (outlierSpread < 0.2) {
      console.log('\n⚠️  OUTLIERS CLUSTER TOGETHER — May indicate systematic quality issue');
    } else {
      console.log('\n✓ Outliers are scattered — likely individual anomalies, not systematic');
    }
  }

  // Analyze photos by name patterns that might indicate issues
  console.log('\n=== NAME PATTERN ANALYSIS ===\n');

  const patterns = {
    damaged: data.filter(p => /damage|torn|faded|deteriorat/i.test(p.name || '')),
    missing: data.filter(p => /missing|lost|incomplete/i.test(p.name || '')),
    copy: data.filter(p => /copy|copie|duplicate|dup/i.test(p.name || '')),
    unknown: data.filter(p => /unknown|inconnu|non.identifi/i.test(p.name || '')),
    test: data.filter(p => /test|essai|trial/i.test(p.name || ''))
  };

  Object.entries(patterns).forEach(([pattern, photos]) => {
    if (photos.length === 0) return;

    console.log(`📌 "${pattern}" pattern: ${photos.length} photos`);
    if (photos.length > 0 && photos.length <= 10) {
      photos.forEach(p => {
        console.log(`   • ${(p.name || p.id).substring(0, 50)} — (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
      });
    } else if (photos.length > 10) {
      const center = centroid(photos);
      console.log(`   Centroid: (${center.x.toFixed(3)}, ${center.y.toFixed(3)})`);
    }
  });

  // Calculate LOF for a sample (computationally expensive for full dataset)
  console.log('\n=== LOCAL OUTLIER FACTOR (Sample) ===\n');
  console.log('Computing LOF for 1000 random photos...\n');

  const sample = [...data].sort(() => Math.random() - 0.5).slice(0, 1000);
  const lofScores = calculateLOF(sample, 10);

  const sampleWithLOF = sample.map((p, i) => ({
    ...p,
    lof: lofScores[i]
  })).sort((a, b) => b.lof - a.lof);

  console.log('Top 15 LOF anomalies (higher = more anomalous):\n');
  sampleWithLOF.slice(0, 15).forEach((p, i) => {
    const shortName = (p.name || p.id).substring(0, 45);
    console.log(`${(i + 1).toString().padStart(2)}. LOF: ${p.lof.toFixed(2)} | (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) | ${shortName}`);
  });

  // Calculate quality score distribution
  console.log('\n=== QUALITY SCORE DISTRIBUTION ===\n');

  // Composite quality score: lower isolation + not on edge = higher quality
  const qualityScored = scored.map(p => ({
    ...p,
    quality: (1 - Math.min(p.isolation / 0.1, 1)) * 0.5 +
             (Math.min(p.edgeProximity / 0.1, 1)) * 0.5
  })).sort((a, b) => a.quality - b.quality);

  const quartiles = [0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map(q => {
    const idx = Math.floor(q * qualityScored.length);
    return { q, quality: qualityScored[idx].quality };
  });

  console.log('Quality score percentiles (0-1, lower = potentially problematic):');
  quartiles.forEach(({ q, quality }) => {
    console.log(`  ${(q * 100).toString().padStart(2)}th percentile: ${quality.toFixed(4)}`);
  });

  const lowQuality = qualityScored.filter(p => p.quality < 0.3);
  console.log(`\nPhotos with quality score < 0.3: ${lowQuality.length} (${(lowQuality.length / data.length * 100).toFixed(1)}%)`);

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total photos analyzed: ${data.length}`);
  console.log(`Highly isolated (potential outliers): ${sparsePhotos.length}`);
  console.log(`Edge photos: ${edgePhotos.length}`);
  console.log(`Low quality score (<0.3): ${lowQuality.length}`);

  console.log('\n=== KEY INSIGHTS ===\n');
  console.log('1. Isolated photos in sparse regions may indicate unique/damaged content');
  console.log('2. Edge photos often represent extreme cases or unusual techniques');
  console.log('3. Clustered outliers suggest systematic issues; scattered outliers are individual');
  console.log('4. Quality scoring can help prioritize photos for manual review');

  // Output candidates for review
  console.log('\n=== TOP CANDIDATES FOR MANUAL QUALITY REVIEW ===\n');
  lowQuality.slice(0, 20).forEach((p, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. Score: ${p.quality.toFixed(3)} | ${p.date || 'Unknown'}`);
    console.log(`    ${(p.name || p.id).substring(0, 60)}`);
    console.log(`    Position: (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) | Isolation: ${p.isolation.toFixed(4)}`);
  });
}

main().catch(console.error);
