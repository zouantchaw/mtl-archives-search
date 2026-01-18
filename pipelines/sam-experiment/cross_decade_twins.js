#!/usr/bin/env node
/**
 * Cross-Decade Twins Analysis
 *
 * Finds pairs of photos from different decades that are visually
 * nearly identical. These could be:
 * 1. Same location photographed decades apart
 * 2. Mislabeled photos
 * 3. Technique persistence across eras
 * 4. Reprints/copies of older photos
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

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              CROSS-DECADE TWINS ANALYSIS                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Index photos by decade
  const byDecade = {};
  data.forEach(p => {
    const year = parseYear(p.date);
    if (year) {
      const decade = Math.floor(year / 10) * 10;
      if (!byDecade[decade]) byDecade[decade] = [];
      byDecade[decade].push(p);
    }
  });

  console.log('Photos by decade:');
  Object.keys(byDecade).sort().forEach(d => {
    console.log(`  ${d}s: ${byDecade[d].length} photos`);
  });
  console.log('');

  // Find cross-decade twins (very close in embedding space, different decades)
  const decades = Object.keys(byDecade).sort().map(Number);
  const twins = [];

  console.log('Searching for cross-decade twins (this may take a moment)...\n');

  // Compare each decade pair
  for (let i = 0; i < decades.length; i++) {
    for (let j = i + 1; j < decades.length; j++) {
      const d1 = decades[i];
      const d2 = decades[j];

      // Skip adjacent decades (less interesting)
      if (d2 - d1 < 20) continue;

      const photos1 = byDecade[d1];
      const photos2 = byDecade[d2];

      console.log(`  Comparing ${d1}s vs ${d2}s (${photos1.length} × ${photos2.length})...`);

      // For efficiency, use spatial indexing approximation
      // Group photos2 into grid cells
      const gridSize = 100;
      const grid = {};

      photos2.forEach(p => {
        const gx = Math.floor(p.x * gridSize);
        const gy = Math.floor(p.y * gridSize);
        const key = `${gx},${gy}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(p);
      });

      // For each photo in d1, check nearby cells
      photos1.forEach(p1 => {
        const gx = Math.floor(p1.x * gridSize);
        const gy = Math.floor(p1.y * gridSize);

        // Check 3x3 neighborhood
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = `${gx + dx},${gy + dy}`;
            const nearby = grid[key];
            if (!nearby) continue;

            nearby.forEach(p2 => {
              const dist = distance(p1, p2);
              if (dist < 0.015) { // Very close in embedding space
                twins.push({
                  photo1: p1,
                  photo2: p2,
                  decade1: d1,
                  decade2: d2,
                  distance: dist,
                  yearGap: d2 - d1
                });
              }
            });
          }
        }
      });
    }
  }

  // Sort by distance (closest first)
  twins.sort((a, b) => a.distance - b.distance);

  console.log(`\nFound ${twins.length} cross-decade twin pairs\n`);

  console.log('=== TOP CROSS-DECADE TWINS (20+ year gap) ===\n');

  twins.slice(0, 30).forEach((t, i) => {
    const name1 = (t.photo1.name || t.photo1.id).substring(0, 35);
    const name2 = (t.photo2.name || t.photo2.id).substring(0, 35);

    console.log(`${i + 1}. Distance: ${t.distance.toFixed(5)} | Gap: ${t.yearGap} years`);
    console.log(`   ${t.decade1}s: ${name1}`);
    console.log(`   ${t.decade2}s: ${name2}`);
    console.log('');
  });

  // Analyze decade pair distribution
  console.log('=== TWINS BY DECADE PAIR ===\n');

  const pairCounts = {};
  twins.forEach(t => {
    const key = `${t.decade1}s ↔ ${t.decade2}s`;
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  });

  Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pair, count]) => {
      console.log(`  ${pair}: ${count} twin pairs`);
    });

  // Find the most "twinned" photos (photos with multiple twins across decades)
  console.log('\n=== MOST TWINNED PHOTOS ===\n');

  const twinCounts = {};
  twins.forEach(t => {
    twinCounts[t.photo1.id] = (twinCounts[t.photo1.id] || 0) + 1;
    twinCounts[t.photo2.id] = (twinCounts[t.photo2.id] || 0) + 1;
  });

  const multiTwin = Object.entries(twinCounts)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  multiTwin.slice(0, 10).forEach(([id, count]) => {
    const photo = data.find(p => p.id === id);
    const name = (photo?.name || id).substring(0, 50);
    const year = parseYear(photo?.date);
    console.log(`  ${count} twins: ${name} (${year || 'unknown'})`);
  });

  // Output for visualization
  console.log('\n=== TWIN DATA FOR VISUALIZATION ===\n');
  console.log('const CROSS_DECADE_TWINS = [');
  twins.slice(0, 50).forEach(t => {
    console.log(`  { id1: "${t.photo1.id}", id2: "${t.photo2.id}", d1: ${t.decade1}, d2: ${t.decade2}, dist: ${t.distance.toFixed(5)}, gap: ${t.yearGap} },`);
  });
  console.log('];');

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total cross-decade twin pairs: ${twins.length}`);
  console.log(`Photos with multiple twins: ${multiTwin.length}`);
  console.log(`Closest twin pair distance: ${twins[0]?.distance.toFixed(5) || 'N/A'}`);
  console.log(`Largest year gap with twins: ${Math.max(...twins.map(t => t.yearGap))} years`);

  console.log('\n=== INSIGHTS ===\n');
  console.log('Cross-decade twins suggest:');
  console.log('1. Same locations photographed across eras');
  console.log('2. Consistent photographic techniques over time');
  console.log('3. Possible reprints or copies of historical photos');
  console.log('4. Subjects that remained visually unchanged');
}

main().catch(console.error);
