#!/usr/bin/env node
/**
 * Visual Outlier Detection
 *
 * Finds the most visually unique photos in the archive -
 * images that don't fit neatly into any cluster.
 * These could be rare subjects, unique techniques, or mislabeled items.
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

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              VISUAL OUTLIER DETECTION                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Method 1: Local Outlier Factor (simplified)
  // For each point, calculate average distance to k nearest neighbors
  // Outliers have high average distance

  console.log('Calculating local density for each photo (this may take a moment)...\n');

  const k = 15; // Number of neighbors to consider
  const photoScores = [];

  // Sample for speed (full dataset would be O(n²))
  const sampleSize = data.length; // Use all for accuracy

  for (let i = 0; i < sampleSize; i++) {
    if (i % 1000 === 0) console.log(`  Processing ${i}/${sampleSize}...`);

    const p = data[i];

    // Calculate distance to all other points
    const distances = [];
    for (let j = 0; j < data.length; j++) {
      if (i === j) continue;
      distances.push(distance(p, data[j]));
    }

    // Sort and get k nearest
    distances.sort((a, b) => a - b);
    const kNearest = distances.slice(0, k);
    const avgKDistance = kNearest.reduce((s, d) => s + d, 0) / k;

    // Also track the minimum distance (isolation)
    const minDistance = distances[0];

    photoScores.push({
      id: p.id,
      name: p.name,
      date: p.date,
      image_url: p.image_url,
      x: p.x,
      y: p.y,
      avgKDistance,
      minDistance,
      // Combined outlier score
      outlierScore: avgKDistance * 0.7 + minDistance * 0.3
    });
  }

  // Sort by outlier score (highest = most unique)
  photoScores.sort((a, b) => b.outlierScore - a.outlierScore);

  console.log('\n=== TOP 30 VISUAL OUTLIERS (Most Unique Photos) ===\n');
  console.log('Photo'.padEnd(50) + 'Score   Isolation  Position');
  console.log('─'.repeat(85));

  photoScores.slice(0, 30).forEach((p, i) => {
    const shortName = (p.name || p.id).substring(0, 47);
    console.log(
      `${i + 1}. ${shortName}`.padEnd(50) +
      p.outlierScore.toFixed(4).padEnd(8) +
      p.minDistance.toFixed(4).padEnd(11) +
      `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`
    );
  });

  // Analyze where outliers are located
  console.log('\n=== OUTLIER SPATIAL DISTRIBUTION ===\n');

  const top100 = photoScores.slice(0, 100);

  // Quadrant analysis
  const quadrants = {
    'Top-Left (0-0.5, 0-0.5)': 0,
    'Top-Right (0.5-1, 0-0.5)': 0,
    'Bottom-Left (0-0.5, 0.5-1)': 0,
    'Bottom-Right (0.5-1, 0.5-1)': 0,
  };

  top100.forEach(p => {
    if (p.x < 0.5 && p.y < 0.5) quadrants['Top-Left (0-0.5, 0-0.5)']++;
    else if (p.x >= 0.5 && p.y < 0.5) quadrants['Top-Right (0.5-1, 0-0.5)']++;
    else if (p.x < 0.5 && p.y >= 0.5) quadrants['Bottom-Left (0-0.5, 0.5-1)']++;
    else quadrants['Bottom-Right (0.5-1, 0.5-1)']++;
  });

  Object.entries(quadrants).forEach(([quad, count]) => {
    console.log(`  ${quad}: ${count} outliers`);
  });

  // Date distribution of outliers
  console.log('\n=== OUTLIER DATE DISTRIBUTION ===\n');

  const decades = {};
  top100.forEach(p => {
    const match = (p.date || '').match(/19(\d)\d/);
    if (match) {
      const decade = `19${match[1]}0s`;
      decades[decade] = (decades[decade] || 0) + 1;
    } else {
      decades['Unknown'] = (decades['Unknown'] || 0) + 1;
    }
  });

  Object.entries(decades)
    .sort((a, b) => b[1] - a[1])
    .forEach(([decade, count]) => {
      console.log(`  ${decade}: ${count} outliers`);
    });

  // Find "inliers" - the most typical/central photos
  console.log('\n=== MOST TYPICAL PHOTOS (Lowest Outlier Score) ===\n');

  const inliers = [...photoScores].sort((a, b) => a.outlierScore - b.outlierScore);

  inliers.slice(0, 10).forEach((p, i) => {
    const shortName = (p.name || p.id).substring(0, 50);
    console.log(`${i + 1}. ${shortName}`);
    console.log(`   Score: ${p.outlierScore.toFixed(4)} | Position: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  });

  // Output for visualization
  console.log('\n=== OUTLIER DATA FOR VISUALIZATION ===\n');
  console.log('const VISUAL_OUTLIERS = [');
  photoScores.slice(0, 50).forEach(p => {
    console.log(`  { id: "${p.id}", x: ${p.x.toFixed(4)}, y: ${p.y.toFixed(4)}, score: ${p.outlierScore.toFixed(4)}, name: "${(p.name || '').substring(0, 40).replace(/"/g, "'")}" },`);
  });
  console.log('];');

  // Density map data
  console.log('\n=== DENSITY MAP (10x10 grid) ===\n');

  const gridSize = 10;
  const density = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));

  data.forEach(p => {
    const gx = Math.min(gridSize - 1, Math.floor(p.x * gridSize));
    const gy = Math.min(gridSize - 1, Math.floor(p.y * gridSize));
    density[gy][gx]++;
  });

  // Print density grid
  console.log('     ' + Array(gridSize).fill(0).map((_, i) => (i / gridSize).toFixed(1).padStart(5)).join(''));
  density.forEach((row, y) => {
    const yLabel = (y / gridSize).toFixed(1);
    const cells = row.map(count => {
      if (count === 0) return '  ·  ';
      if (count < 50) return count.toString().padStart(5);
      if (count < 200) return (' ' + count).padStart(5);
      return count.toString().padStart(5);
    }).join('');
    console.log(`${yLabel} ${cells}`);
  });

  // Output density for visualization
  console.log('\nconst DENSITY_GRID = [');
  density.forEach((row, y) => {
    console.log(`  [${row.join(', ')}], // y=${(y/gridSize).toFixed(1)}`);
  });
  console.log('];');

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total photos: ${data.length}`);
  console.log(`Average outlier score: ${(photoScores.reduce((s, p) => s + p.outlierScore, 0) / photoScores.length).toFixed(4)}`);
  console.log(`Max outlier score: ${photoScores[0].outlierScore.toFixed(4)}`);
  console.log(`Min outlier score: ${inliers[0].outlierScore.toFixed(4)}`);

  const extremeOutliers = photoScores.filter(p => p.outlierScore > 0.15).length;
  console.log(`Extreme outliers (score > 0.15): ${extremeOutliers} (${(extremeOutliers / data.length * 100).toFixed(1)}%)`);
}

main().catch(console.error);
