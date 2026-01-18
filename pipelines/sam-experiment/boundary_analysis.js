#!/usr/bin/env node
/**
 * Cluster Boundary Analysis
 *
 * Finds photos that sit at the transition points between major clusters.
 * These "boundary photos" are interesting because they:
 * 1. Show visual evolution between eras
 * 2. May be mislabeled or have ambiguous dates
 * 3. Represent hybrid styles bridging techniques
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

function parseYear(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(19\d{2}|18\d{2})/);
  if (match) return parseInt(match[1]);
  return null;
}

// Major cluster centroids (from previous analysis)
const CLUSTERS = [
  { id: 'aerial_nw', x: 0.6764, y: 0.8544, label: '1940s Aerial NW', decade: 1940 },
  { id: 'street', x: 0.3579, y: 0.1077, label: '1970s Street Photos', decade: 1970 },
  { id: 'aerial_central', x: 0.5067, y: 0.7283, label: '1940s Aerial Central', decade: 1940 },
  { id: 'oblique', x: 0.2901, y: 0.4721, label: 'Oblique Views', decade: 1960 },
  { id: 'index', x: 0.8663, y: 0.0635, label: '1960s Index Cards', decade: 1960 },
  { id: 'aerial_south', x: 0.6728, y: 0.5422, label: '1940s Aerial South', decade: 1940 },
  { id: 'survey', x: 0.7862, y: 0.2036, label: '1960s Survey Docs', decade: 1960 },
  { id: 'aerial_east', x: 0.8995, y: 0.4931, label: '1940s Aerial East', decade: 1940 },
];

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              CLUSTER BOUNDARY ANALYSIS                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // For each photo, find distance to two nearest clusters
  // Boundary photos are those where dist1 ≈ dist2 (equidistant from two clusters)
  const boundaryPhotos = [];

  data.forEach(p => {
    const distances = CLUSTERS.map(c => ({
      cluster: c,
      dist: distance(p, c)
    })).sort((a, b) => a.dist - b.dist);

    const nearest = distances[0];
    const secondNearest = distances[1];

    // Boundary score: how close are the two nearest clusters
    // Low ratio = very much on boundary
    const boundaryScore = nearest.dist / (secondNearest.dist + 0.0001);

    // Only consider if genuinely between clusters (not just at center of one)
    if (boundaryScore > 0.7 && nearest.dist < 0.2) {
      boundaryPhotos.push({
        id: p.id,
        name: p.name,
        date: p.date,
        x: p.x,
        y: p.y,
        cluster1: nearest.cluster.label,
        cluster2: secondNearest.cluster.label,
        decade1: nearest.cluster.decade,
        decade2: secondNearest.cluster.decade,
        boundaryScore,
        dist1: nearest.dist,
        dist2: secondNearest.dist
      });
    }
  });

  // Sort by boundary score (closest to 1.0 = most on boundary)
  boundaryPhotos.sort((a, b) => b.boundaryScore - a.boundaryScore);

  console.log(`Found ${boundaryPhotos.length} boundary photos\n`);

  console.log('=== TOP BOUNDARY PHOTOS (Between Two Clusters) ===\n');
  console.log('Photo'.padEnd(45) + 'Between'.padEnd(35) + 'Score');
  console.log('─'.repeat(90));

  boundaryPhotos.slice(0, 30).forEach((p, i) => {
    const shortName = (p.name || p.id).substring(0, 42);
    const between = `${p.cluster1} ↔ ${p.cluster2}`.substring(0, 32);
    console.log(
      `${i + 1}. ${shortName}`.padEnd(45) +
      between.padEnd(35) +
      p.boundaryScore.toFixed(3)
    );
  });

  // Analyze which cluster pairs have the most boundary photos
  console.log('\n=== CLUSTER PAIR BOUNDARIES ===\n');

  const pairCounts = {};
  boundaryPhotos.forEach(p => {
    const key = [p.cluster1, p.cluster2].sort().join(' ↔ ');
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  });

  Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([pair, count]) => {
      console.log(`  ${pair}: ${count} boundary photos`);
    });

  // Cross-decade boundaries (most interesting)
  console.log('\n=== CROSS-DECADE BOUNDARIES ===\n');

  const crossDecade = boundaryPhotos.filter(p => p.decade1 !== p.decade2);
  console.log(`Found ${crossDecade.length} photos bridging different decades\n`);

  crossDecade.slice(0, 20).forEach((p, i) => {
    const year = parseYear(p.date);
    const shortName = (p.name || p.id).substring(0, 40);
    console.log(`${i + 1}. ${shortName}`);
    console.log(`   Stated: ${year || 'unknown'} | Between: ${p.cluster1} ↔ ${p.cluster2}`);
    console.log(`   Position: (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) | Score: ${p.boundaryScore.toFixed(3)}`);
    console.log('');
  });

  // Find "bridge" regions - areas with high density of boundary photos
  console.log('=== BRIDGE REGIONS (High Boundary Density) ===\n');

  const gridSize = 10;
  const boundaryGrid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));

  boundaryPhotos.forEach(p => {
    const gx = Math.min(gridSize - 1, Math.floor(p.x * gridSize));
    const gy = Math.min(gridSize - 1, Math.floor(p.y * gridSize));
    boundaryGrid[gy][gx]++;
  });

  // Find hot spots
  const hotSpots = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (boundaryGrid[y][x] >= 10) {
        hotSpots.push({
          x: (x + 0.5) / gridSize,
          y: (y + 0.5) / gridSize,
          count: boundaryGrid[y][x]
        });
      }
    }
  }

  hotSpots.sort((a, b) => b.count - a.count);
  hotSpots.forEach(h => {
    console.log(`  (${h.x.toFixed(2)}, ${h.y.toFixed(2)}): ${h.count} boundary photos`);
  });

  // Output for visualization
  console.log('\n=== BOUNDARY DATA FOR VISUALIZATION ===\n');
  console.log('const BOUNDARY_HOTSPOTS = [');
  hotSpots.slice(0, 10).forEach(h => {
    console.log(`  { x: ${h.x.toFixed(3)}, y: ${h.y.toFixed(3)}, count: ${h.count} },`);
  });
  console.log('];');

  console.log('\nconst CROSS_DECADE_BOUNDARIES = [');
  crossDecade.slice(0, 30).forEach(p => {
    console.log(`  { id: "${p.id}", x: ${p.x.toFixed(4)}, y: ${p.y.toFixed(4)}, c1: "${p.cluster1}", c2: "${p.cluster2}", score: ${p.boundaryScore.toFixed(3)} },`);
  });
  console.log('];');

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total boundary photos: ${boundaryPhotos.length}`);
  console.log(`Cross-decade boundaries: ${crossDecade.length}`);
  console.log(`Bridge hot spots found: ${hotSpots.length}`);

  // Insight: what does it mean?
  console.log('\n=== INSIGHTS ===\n');
  console.log('Boundary photos represent:');
  console.log('1. Visual evolution - transitional styles between eras');
  console.log('2. Technique persistence - old methods used in newer photos');
  console.log('3. Potential mislabeling - dates may need verification');
  console.log('4. Hybrid subjects - content spanning multiple categories');
}

main().catch(console.error);
