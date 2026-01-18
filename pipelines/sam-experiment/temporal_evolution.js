#!/usr/bin/env node
/**
 * Temporal Style Evolution Analysis
 *
 * Analyzes how the visual centroid of Montreal's photo archive
 * moved through embedding space over time.
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

  // Try to extract year from various formats
  const match = dateStr.match(/(19\d{2}|18\d{2})/);
  if (match) return parseInt(match[1]);

  // Handle decade strings like "Décennie 1920"
  const decadeMatch = dateStr.match(/[Dd]écennie\s*(19\d{2}|18\d{2})/);
  if (decadeMatch) return parseInt(decadeMatch[1]);

  return null;
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  // Group photos by decade
  const decades = {};

  data.forEach(p => {
    const year = parseYear(p.date);
    if (year) {
      const decade = Math.floor(year / 10) * 10;
      if (!decades[decade]) decades[decade] = [];
      decades[decade].push(p);
    }
  });

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              TEMPORAL STYLE EVOLUTION ANALYSIS                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Calculate centroid for each decade
  const trajectory = [];

  Object.keys(decades)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .forEach(decade => {
      const photos = decades[decade];
      const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
      const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;

      // Calculate spread
      const spreadX = Math.sqrt(photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2), 0) / photos.length);
      const spreadY = Math.sqrt(photos.reduce((s, p) => s + Math.pow(p.y - avgY, 2), 0) / photos.length);

      trajectory.push({
        decade: parseInt(decade),
        count: photos.length,
        centroid: { x: avgX, y: avgY },
        spread: (spreadX + spreadY) / 2
      });
    });

  console.log('=== DECADE CENTROIDS ===\n');
  console.log('Decade'.padEnd(10) + 'Count'.padStart(7) + '  Centroid (x, y)'.padEnd(25) + 'Spread');
  console.log('─'.repeat(60));

  trajectory.forEach(t => {
    console.log(
      `${t.decade}s`.padEnd(10) +
      t.count.toString().padStart(7) +
      `  (${t.centroid.x.toFixed(3)}, ${t.centroid.y.toFixed(3)})`.padEnd(25) +
      t.spread.toFixed(4)
    );
  });

  // Calculate movement between decades
  console.log('\n=== STYLE EVOLUTION (movement between decades) ===\n');

  for (let i = 1; i < trajectory.length; i++) {
    const prev = trajectory[i - 1];
    const curr = trajectory[i];

    const dx = curr.centroid.x - prev.centroid.x;
    const dy = curr.centroid.y - prev.centroid.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Direction
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    let direction = '';
    if (angle >= -22.5 && angle < 22.5) direction = '→ East';
    else if (angle >= 22.5 && angle < 67.5) direction = '↗ NE';
    else if (angle >= 67.5 && angle < 112.5) direction = '↑ North';
    else if (angle >= 112.5 && angle < 157.5) direction = '↖ NW';
    else if (angle >= 157.5 || angle < -157.5) direction = '← West';
    else if (angle >= -157.5 && angle < -112.5) direction = '↙ SW';
    else if (angle >= -112.5 && angle < -67.5) direction = '↓ South';
    else direction = '↘ SE';

    console.log(`${prev.decade}s → ${curr.decade}s: ${direction} (distance: ${distance.toFixed(4)})`);
  }

  // Identify major style shifts
  console.log('\n=== MAJOR STYLE SHIFTS ===\n');

  const movements = [];
  for (let i = 1; i < trajectory.length; i++) {
    const prev = trajectory[i - 1];
    const curr = trajectory[i];
    const dx = curr.centroid.x - prev.centroid.x;
    const dy = curr.centroid.y - prev.centroid.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    movements.push({ from: prev.decade, to: curr.decade, distance });
  }

  movements
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 3)
    .forEach((m, i) => {
      console.log(`${i + 1}. ${m.from}s → ${m.to}s: distance ${m.distance.toFixed(4)}`);
    });

  // Output trajectory for visualization
  console.log('\n=== TRAJECTORY DATA (for visualization) ===\n');
  console.log('const DECADE_TRAJECTORY = [');
  trajectory.forEach(t => {
    console.log(`  { decade: ${t.decade}, x: ${t.centroid.x.toFixed(4)}, y: ${t.centroid.y.toFixed(4)}, count: ${t.count} },`);
  });
  console.log('];');

  // Summary insights
  console.log('\n=== INSIGHTS ===\n');

  const totalDistance = movements.reduce((s, m) => s + m.distance, 0);
  console.log(`Total stylistic journey: ${totalDistance.toFixed(4)} units across ${trajectory.length} decades`);

  // Find the decade with tightest cluster (most consistent style)
  const tightest = trajectory.reduce((min, t) => t.spread < min.spread ? t : min);
  console.log(`Most consistent decade: ${tightest.decade}s (spread: ${tightest.spread.toFixed(4)})`);

  // Find most diverse decade
  const widest = trajectory.reduce((max, t) => t.spread > max.spread ? t : max);
  console.log(`Most diverse decade: ${widest.decade}s (spread: ${widest.spread.toFixed(4)})`);
}

main().catch(console.error);
