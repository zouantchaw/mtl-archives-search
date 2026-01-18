#!/usr/bin/env node
/**
 * Anomaly Detection Analysis
 *
 * Finds photos where visual appearance (embedding position) disagrees
 * with stated date. These are either mislabeled or show interesting
 * photographic technique similarities across eras.
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

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  // Calculate decade centroids
  const decades = {};
  data.forEach(p => {
    const year = parseYear(p.date);
    if (year) {
      const decade = Math.floor(year / 10) * 10;
      if (!decades[decade]) decades[decade] = [];
      decades[decade].push(p);
    }
  });

  const decadeCentroids = {};
  Object.keys(decades).forEach(decade => {
    const photos = decades[decade];
    decadeCentroids[decade] = {
      x: photos.reduce((s, p) => s + p.x, 0) / photos.length,
      y: photos.reduce((s, p) => s + p.y, 0) / photos.length,
      count: photos.length
    };
  });

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              ANOMALY DETECTION: VISUAL/DATE MISMATCH                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  console.log('Decade centroids:');
  Object.keys(decadeCentroids).sort().forEach(decade => {
    const c = decadeCentroids[decade];
    console.log(`  ${decade}s: (${c.x.toFixed(3)}, ${c.y.toFixed(3)}) - ${c.count} photos`);
  });
  console.log('');

  // For each photo, calculate anomaly score
  // Score = how much closer the photo is to a different decade's centroid vs its own
  const anomalies = [];

  data.forEach(p => {
    const year = parseYear(p.date);
    if (!year) return;

    const ownDecade = Math.floor(year / 10) * 10;
    const ownCentroid = decadeCentroids[ownDecade];
    if (!ownCentroid) return;

    const distToOwn = distance(p, ownCentroid);

    // Find closest other decade
    let closestOther = null;
    let closestOtherDist = Infinity;
    let closestOtherDecade = null;

    Object.keys(decadeCentroids).forEach(decade => {
      if (parseInt(decade) === ownDecade) return;
      const d = distance(p, decadeCentroids[decade]);
      if (d < closestOtherDist) {
        closestOtherDist = d;
        closestOther = decadeCentroids[decade];
        closestOtherDecade = parseInt(decade);
      }
    });

    if (!closestOther) return;

    // Anomaly score: how much closer to other decade than own
    // Positive = closer to other decade
    const anomalyScore = distToOwn - closestOtherDist;

    if (anomalyScore > 0.05) { // Threshold for "significant" anomaly
      anomalies.push({
        id: p.id,
        name: p.name,
        image_url: p.image_url,
        statedYear: year,
        statedDecade: ownDecade,
        visualDecade: closestOtherDecade,
        score: anomalyScore,
        x: p.x,
        y: p.y,
        distToStated: distToOwn,
        distToVisual: closestOtherDist
      });
    }
  });

  // Sort by anomaly score (highest first)
  anomalies.sort((a, b) => b.score - a.score);

  console.log(`\n=== TOP ANOMALIES (${anomalies.length} total found) ===\n`);
  console.log('Photo'.padEnd(50) + 'Stated  Visual  Score');
  console.log('─'.repeat(75));

  anomalies.slice(0, 30).forEach(a => {
    const shortName = (a.name || a.id).substring(0, 47);
    console.log(
      shortName.padEnd(50) +
      `${a.statedDecade}s`.padEnd(8) +
      `${a.visualDecade}s`.padEnd(8) +
      a.score.toFixed(3)
    );
  });

  // Analyze anomaly patterns
  console.log('\n=== ANOMALY PATTERNS ===\n');

  const mismatchCounts = {};
  anomalies.forEach(a => {
    const key = `${a.statedDecade}s → ${a.visualDecade}s`;
    mismatchCounts[key] = (mismatchCounts[key] || 0) + 1;
  });

  Object.entries(mismatchCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([pattern, count]) => {
      console.log(`  ${pattern}: ${count} photos`);
    });

  // Output for visualization
  console.log('\n=== ANOMALY DATA FOR VISUALIZATION ===\n');
  console.log('const TOP_ANOMALIES = [');
  anomalies.slice(0, 50).forEach(a => {
    console.log(`  { id: "${a.id}", x: ${a.x.toFixed(4)}, y: ${a.y.toFixed(4)}, stated: ${a.statedDecade}, visual: ${a.visualDecade}, score: ${a.score.toFixed(3)} },`);
  });
  console.log('];');

  // Summary stats
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total photos analyzed: ${data.length}`);
  console.log(`Anomalies detected: ${anomalies.length} (${(anomalies.length / data.length * 100).toFixed(1)}%)`);
  console.log(`High-confidence anomalies (score > 0.15): ${anomalies.filter(a => a.score > 0.15).length}`);

  const majorMismatch = anomalies.filter(a => Math.abs(a.statedDecade - a.visualDecade) >= 20).length;
  console.log(`Cross-era anomalies (2+ decades off): ${majorMismatch}`);
}

main().catch(console.error);
