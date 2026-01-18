#!/usr/bin/env node
/**
 * Sub-Cluster Analysis
 *
 * Discovers hidden structure within major clusters using k-means.
 * The 1940s cluster alone has 7,800+ photos - what sub-groups exist?
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

function parseYear(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(19\d{2}|18\d{2})/);
  if (match) return parseInt(match[1]);
  const decadeMatch = dateStr.match(/[Dd]écennie\s*(19\d{2}|18\d{2})/);
  if (decadeMatch) return parseInt(decadeMatch[1]);
  return null;
}

function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Simple k-means clustering
function kmeans(points, k, maxIterations = 50) {
  // Initialize centroids randomly from data points
  const centroids = [];
  const used = new Set();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * points.length);
    if (!used.has(idx)) {
      used.add(idx);
      centroids.push({ x: points[idx].x, y: points[idx].y });
    }
  }

  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign points to nearest centroid
    const newAssignments = points.map(p => {
      let minDist = Infinity;
      let closest = 0;
      centroids.forEach((c, i) => {
        const d = distance(p, c);
        if (d < minDist) {
          minDist = d;
          closest = i;
        }
      });
      return closest;
    });

    // Check convergence
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      if (assignments[i] !== newAssignments[i]) changed = true;
    }
    assignments = newAssignments;
    if (!changed) break;

    // Update centroids
    for (let c = 0; c < k; c++) {
      const clusterPoints = points.filter((_, i) => assignments[i] === c);
      if (clusterPoints.length > 0) {
        centroids[c] = {
          x: clusterPoints.reduce((s, p) => s + p.x, 0) / clusterPoints.length,
          y: clusterPoints.reduce((s, p) => s + p.y, 0) / clusterPoints.length
        };
      }
    }
  }

  return { centroids, assignments };
}

// Extract common terms from photo names
function extractTerms(photos) {
  const terms = {};
  photos.forEach(p => {
    if (!p.name) return;
    const words = p.name.toLowerCase()
      .replace(/[\/\.\-_,]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !/^\d+$/.test(w) && !/^vm\d+/.test(w));

    words.forEach(w => {
      terms[w] = (terms[w] || 0) + 1;
    });
  });

  return Object.entries(terms)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  // Focus on the 1940s cluster (the largest)
  const photos1940s = data.filter(p => {
    const year = parseYear(p.date);
    return year && year >= 1940 && year < 1950;
  });

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              SUB-CLUSTER ANALYSIS: 1940s AERIAL SURVEY               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Analyzing ${photos1940s.length} photos from the 1940s\n`);

  // Try different k values
  const kValues = [3, 5, 8];

  for (const k of kValues) {
    console.log(`\n=== K-MEANS WITH K=${k} ===\n`);

    const { centroids, assignments } = kmeans(photos1940s, k);

    // Analyze each sub-cluster
    const clusters = [];
    for (let c = 0; c < k; c++) {
      const clusterPhotos = photos1940s.filter((_, i) => assignments[i] === c);

      // Calculate spread
      const avgX = clusterPhotos.reduce((s, p) => s + p.x, 0) / clusterPhotos.length;
      const avgY = clusterPhotos.reduce((s, p) => s + p.y, 0) / clusterPhotos.length;
      const spread = Math.sqrt(
        clusterPhotos.reduce((s, p) => s + Math.pow(p.x - avgX, 2) + Math.pow(p.y - avgY, 2), 0) / clusterPhotos.length
      );

      // Get year distribution
      const years = {};
      clusterPhotos.forEach(p => {
        const year = parseYear(p.date);
        if (year) years[year] = (years[year] || 0) + 1;
      });

      clusters.push({
        id: c,
        count: clusterPhotos.length,
        centroid: centroids[c],
        spread,
        photos: clusterPhotos,
        years,
        terms: extractTerms(clusterPhotos)
      });
    }

    // Sort by count
    clusters.sort((a, b) => b.count - a.count);

    clusters.forEach((cluster, idx) => {
      console.log(`📍 Sub-cluster ${idx + 1}: ${cluster.count} photos`);
      console.log(`   Position: (${cluster.centroid.x.toFixed(3)}, ${cluster.centroid.y.toFixed(3)}) | Spread: ${cluster.spread.toFixed(4)}`);

      // Year breakdown
      const yearList = Object.entries(cluster.years)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([y, c]) => `${y}: ${c}`);
      console.log(`   Years: ${yearList.join(', ')}`);

      // Common terms
      const termList = cluster.terms.slice(0, 5).map(t => t.term).join(', ');
      console.log(`   Keywords: ${termList || '(none)'}`);

      // Sample photos
      console.log('   Samples:');
      cluster.photos.slice(0, 2).forEach(p => {
        console.log(`     • ${(p.name || 'Untitled').substring(0, 60)}`);
      });
      console.log('');
    });
  }

  // Now analyze the FULL dataset for major visual regions
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              GLOBAL SUB-CLUSTER ANALYSIS                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const k = 8;
  console.log(`Running k-means with k=${k} on all ${data.length} photos...\n`);

  const { centroids, assignments } = kmeans(data, k);

  const globalClusters = [];
  for (let c = 0; c < k; c++) {
    const clusterPhotos = data.filter((_, i) => assignments[i] === c);
    const avgX = clusterPhotos.reduce((s, p) => s + p.x, 0) / clusterPhotos.length;
    const avgY = clusterPhotos.reduce((s, p) => s + p.y, 0) / clusterPhotos.length;

    // Decade distribution
    const decades = {};
    clusterPhotos.forEach(p => {
      const year = parseYear(p.date);
      if (year) {
        const decade = Math.floor(year / 10) * 10;
        decades[decade] = (decades[decade] || 0) + 1;
      }
    });

    globalClusters.push({
      id: c,
      count: clusterPhotos.length,
      centroid: { x: avgX, y: avgY },
      decades,
      terms: extractTerms(clusterPhotos),
      photos: clusterPhotos
    });
  }

  globalClusters.sort((a, b) => b.count - a.count);

  console.log('CLUSTER'.padEnd(12) + 'COUNT'.padStart(7) + '  POSITION'.padEnd(22) + 'PRIMARY DECADE  KEYWORDS');
  console.log('─'.repeat(90));

  globalClusters.forEach((cluster, idx) => {
    const topDecade = Object.entries(cluster.decades)
      .sort((a, b) => b[1] - a[1])[0];

    const keywords = cluster.terms.slice(0, 3).map(t => t.term).join(', ');

    console.log(
      `Cluster ${idx + 1}`.padEnd(12) +
      cluster.count.toString().padStart(7) +
      `  (${cluster.centroid.x.toFixed(2)}, ${cluster.centroid.y.toFixed(2)})`.padEnd(22) +
      (topDecade ? `${topDecade[0]}s (${topDecade[1]})`.padEnd(16) : ''.padEnd(16)) +
      keywords
    );
  });

  // Output for visualization
  console.log('\n=== CLUSTER DATA FOR VISUALIZATION ===\n');
  console.log('const SUB_CLUSTERS = [');
  globalClusters.forEach((c, i) => {
    const topDecade = Object.entries(c.decades).sort((a, b) => b[1] - a[1])[0];
    const label = c.terms[0]?.term || `cluster-${i}`;
    console.log(`  { id: ${i}, x: ${c.centroid.x.toFixed(4)}, y: ${c.centroid.y.toFixed(4)}, count: ${c.count}, label: "${label}", decade: ${topDecade?.[0] || 'null'} },`);
  });
  console.log('];');
}

main().catch(console.error);
